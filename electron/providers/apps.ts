import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { commandExists, powershellJson, psQuote, run, safeId } from '../lib/exec';
import { fetchJson, mapLimit } from '../lib/http';
import { makeKey, type Provider } from './types';
import { isNewer } from '../../shared/versions';
import type { UpdateItem } from '../../shared/types';


interface MarketExt {
  publisher: { publisherName: string };
  extensionName: string;
  displayName: string;
  shortDescription?: string;
  versions: { version: string; lastUpdated: string; properties?: { key: string; value: string }[] }[];
}

export function parseCodeExtensions(text: string): { id: string; version: string }[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim().match(/^([\w-]+\.[\w.-]+)@(\S+)$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ id: m[1], version: m[2] }));
}

const isPreRelease = (v: MarketExt['versions'][number]) =>
  !!v.properties?.some((p) => p.key === 'Microsoft.VisualStudio.Code.PreRelease' && p.value === 'true');

async function queryMarketplace(ids: string[], latestOnly: boolean): Promise<MarketExt[]> {
  const out: MarketExt[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const j = await fetchJson<{ results: { extensions: MarketExt[] }[] }>(
      'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json;api-version=3.0-preview.1' },
        body: JSON.stringify({
          filters: [{ criteria: chunk.map((value) => ({ filterType: 7, value })), pageSize: chunk.length }],
          flags: 0x1 | 0x10 | (latestOnly ? 0x200 : 0),
        }),
      },
    );
    out.push(...(j.results[0]?.extensions ?? []));
  }
  return out;
}

async function latestVersions(ids: string[]): Promise<MarketExt[]> {
  const latest = await queryMarketplace(ids, true);
  const needFull = latest.filter((m) => m.versions[0] && isPreRelease(m.versions[0])).map((m) => `${m.publisher.publisherName}.${m.extensionName}`);
  if (!needFull.length) return latest;
  const full = new Map((await queryMarketplace(needFull, false)).map((m) => [`${m.publisher.publisherName}.${m.extensionName}`.toLowerCase(), m]));
  return latest.map((m) => full.get(`${m.publisher.publisherName}.${m.extensionName}`.toLowerCase()) ?? m);
}

export const vscodeProvider: Provider = {
  id: 'vscode',
  name: 'Extensions VS Code',
  kind: 'package',
  group: 'Développement',
  description: 'Extensions Visual Studio Code dont une version plus récente existe sur le Marketplace',
  detect: () => commandExists('code'),
  async check(ctx) {
    const res = await run('code --list-extensions --show-versions', [], { shell: true, timeoutMs: ctx.timeoutMs });
    ctx.trace('code --list-extensions --show-versions', res.stdout + res.stderr);
    const installed = parseCodeExtensions(res.stdout);
    if (!installed.length) return [];
    const market = await latestVersions(installed.map((e) => e.id));
    const byId = new Map(market.map((m) => [`${m.publisher.publisherName}.${m.extensionName}`.toLowerCase(), m]));
    const out: UpdateItem[] = [];
    for (const e of installed) {
      const m = byId.get(e.id.toLowerCase());
      if (!m) continue;
      const installedIsPre = m.versions.some((v) => v.version === e.version && isPreRelease(v));
      const latest = m.versions.find((v) => installedIsPre || !isPreRelease(v));
      if (!latest || !isNewer(latest.version, e.version)) continue;
      const pre = isPreRelease(latest);
      out.push({
        key: makeKey('vscode', e.id),
        providerId: 'vscode',
        kind: 'package',
        id: e.id,
        name: m.displayName || e.id,
        currentVersion: e.version,
        availableVersion: latest.version,
        publishedAt: Date.parse(latest.lastUpdated),
        publisher: m.publisher.publisherName,
        details: m.shortDescription?.slice(0, 140),
        homepage: `https://marketplace.visualstudio.com/items?itemName=${e.id}`,
        source: 'VS Marketplace',
        preview: pre,
        supportsVersions: true,
      });
    }
    return out;
  },
  async install(items, ctx) {
    let ok = 0;
    for (const i of items) {
      const spec = i.targetVersion ? `${safeId(i.id)}@${safeId(i.targetVersion)}` : safeId(i.id);
      const res = await run(`code --install-extension ${spec} --force`, [], { shell: true, onLine: ctx.log, timeoutMs: 10 * 60_000, signal: ctx.signal });
      if (res.code === 0) ok++;
    }
    return { success: ok === items.length };
  },
};


interface Browser {
  id: string;
  name: string;
  paths: string[];
  wingetId?: string;
  latest(): Promise<{ version: string; publishedAt?: number; cves?: string[] }>;
  homepage: string;
}

const PF = process.env.ProgramFiles ?? 'C:\\Program Files';
const PF86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
const LAD = process.env.LOCALAPPDATA ?? '';

const BROWSERS: Browser[] = [
  {
    id: 'chrome',
    name: 'Google Chrome',
    paths: [join(PF, 'Google\\Chrome\\Application\\chrome.exe'), join(PF86, 'Google\\Chrome\\Application\\chrome.exe'), join(LAD, 'Google\\Chrome\\Application\\chrome.exe')],
    wingetId: 'Google.Chrome',
    homepage: 'https://chromereleases.googleblog.com/',
    async latest() {
      const j = await fetchJson<{ versions: { version: string }[] }>(
        'https://versionhistory.googleapis.com/v1/chrome/platforms/win64/channels/stable/versions?pageSize=1',
      );
      return { version: j.versions[0].version };
    },
  },
  {
    id: 'edge',
    name: 'Microsoft Edge',
    paths: [join(PF86, 'Microsoft\\Edge\\Application\\msedge.exe'), join(PF, 'Microsoft\\Edge\\Application\\msedge.exe')],
    homepage: 'https://learn.microsoft.com/deployedge/microsoft-edge-relnote-security',
    async latest() {
      const j = await fetchJson<{ Product: string; Releases: { Platform: string; Architecture: string; ProductVersion: string; PublishedTime: string; CVEs?: string[] }[] }[]>(
        'https://edgeupdates.microsoft.com/api/products',
      );
      const r = j.find((p) => p.Product === 'Stable')?.Releases.find((x) => x.Platform === 'Windows' && x.Architecture === 'x64');
      if (!r) throw new Error('Version Edge introuvable');
      return { version: r.ProductVersion, publishedAt: Date.parse(r.PublishedTime), cves: r.CVEs };
    },
  },
  {
    id: 'firefox',
    name: 'Mozilla Firefox',
    paths: [join(PF, 'Mozilla Firefox\\firefox.exe'), join(PF86, 'Mozilla Firefox\\firefox.exe')],
    wingetId: 'Mozilla.Firefox',
    homepage: 'https://www.mozilla.org/firefox/notes/',
    async latest() {
      const j = await fetchJson<{ LATEST_FIREFOX_VERSION: string }>('https://product-details.mozilla.org/1.0/firefox_versions.json');
      return { version: j.LATEST_FIREFOX_VERSION };
    },
  },
];

async function fileVersions(paths: string[]): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const r = await powershellJson<Record<string, string>>(
    `$h = @{}; foreach ($p in @(${paths.map(psQuote).join(',')})) { $h[$p] = (Get-Item -LiteralPath $p).VersionInfo.ProductVersion }; $h | ConvertTo-Json -Compress`,
    { timeoutMs: 30_000 },
  );
  return r ?? {};
}

export const browsersProvider: Provider = {
  id: 'browsers',
  name: 'Navigateurs',
  kind: 'package',
  group: 'Applications',
  description: 'Chrome, Edge et Firefox comparés à la dernière version stable publiée',
  async detect() {
    return BROWSERS.some((b) => b.paths.some((p) => existsSync(p)));
  },
  async check(ctx) {
    const found = BROWSERS.map((b) => ({ b, path: b.paths.find((p) => existsSync(p)) })).filter((x): x is { b: Browser; path: string } => !!x.path);
    const versions = await fileVersions(found.map((f) => f.path));
    ctx.trace('versions installées', JSON.stringify(versions, null, 1));
    const rows = await mapLimit(found, 3, async ({ b, path }) => {
      const current = versions[path];
      const latest = await b.latest().catch((err) => {
        ctx.trace(`${b.name} : dernière version`, String(err));
        return undefined;
      });
      if (!latest || !current || !isNewer(latest.version, current)) return null;
      const item: UpdateItem = {
        key: makeKey('browsers', b.id),
        providerId: 'browsers',
        kind: 'package',
        id: b.id,
        name: b.name,
        iconName: b.name,
        currentVersion: current,
        availableVersion: latest.version,
        publishedAt: latest.publishedAt,
        homepage: b.homepage,
        source: 'Éditeur',
        security: true,
        cves: latest.cves,
        severity: latest.cves?.length ? 'critical' : 'important',
      };
      return item;
    });
    return rows.filter((r): r is UpdateItem => !!r);
  },
  async install(items, ctx) {
    let ok = 0;
    for (const i of items) {
      const b = BROWSERS.find((x) => x.id === i.id);
      if (!b) continue;
      if (b.id === 'edge') {
        const exe = join(PF86, 'Microsoft\\EdgeUpdate\\MicrosoftEdgeUpdate.exe');
        const res = await run(exe, ['/ua', '/installsource', 'scheduler'], { onLine: ctx.log, timeoutMs: 20 * 60_000, signal: ctx.signal });
        ctx.log('Mise à jour d’Edge demandée au service Microsoft Edge Update.');
        if (res.code === 0) ok++;
        continue;
      }
      const res = await run(
        'winget',
        ['upgrade', '--id', b.wingetId!, '--exact', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'],
        { onLine: ctx.log, timeoutMs: 30 * 60_000, signal: ctx.signal },
      );
      if (res.code === 0) ok++;
    }
    return { success: ok === items.length };
  },
};


const DOCKER_FALLBACK = join(PF, 'Docker\\Docker\\resources\\bin\\docker.exe');
let dockerExe = 'docker';
let dockerNote: string | undefined;

export function dockerHubRef(repo: string): { ns: string; name: string } | null {
  const parts = repo.split('/');
  if (parts.length > 2 || (parts.length === 2 && /[.:]/.test(parts[0])) || repo === 'localhost') return null;
  return parts.length === 1 ? { ns: 'library', name: parts[0] } : { ns: parts[0], name: parts[1] };
}

export const dockerProvider: Provider = {
  id: 'docker',
  name: 'Images Docker',
  kind: 'package',
  group: 'Développement',
  description: 'Images locales dont une version plus récente est publiée sur Docker Hub',
  note: () => dockerNote,
  async detect() {
    if (await commandExists('docker')) dockerExe = 'docker';
    else if (existsSync(DOCKER_FALLBACK)) dockerExe = DOCKER_FALLBACK;
    else return false;
    return true;
  },
  async check(ctx) {
    const info = await run(dockerExe, ['info', '--format', '{{.ServerVersion}}'], { timeoutMs: 30_000 });
    if (info.code !== 0) {
      dockerNote = 'Docker n’est pas démarré : les images ne peuvent pas être vérifiées.';
      ctx.trace('docker info', info.stderr);
      return [];
    }
    dockerNote = undefined;
    const ls = await run(dockerExe, ['image', 'ls', '--format', '{{json .}}'], { timeoutMs: ctx.timeoutMs });
    ctx.trace('docker image ls', ls.stdout);
    const images = ls.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { Repository: string; Tag: string; ID: string; CreatedAt: string })
      .filter((i) => i.Tag !== '<none>' && i.Repository !== '<none>');
    const rows = await mapLimit(images, 4, async (img) => {
      const ref = dockerHubRef(img.Repository);
      if (!ref) return null;
      const insp = await run(dockerExe, ['image', 'inspect', '--format', '{{json .RepoDigests}}', img.ID], { timeoutMs: 30_000 });
      const local = (JSON.parse(insp.stdout.trim() || '[]') as string[]).map((d) => d.split('@')[1]);
      const remote = await fetchJson<{ digest?: string; last_updated?: string }>(
        `https://hub.docker.com/v2/repositories/${ref.ns}/${ref.name}/tags/${encodeURIComponent(img.Tag)}`,
      ).catch(() => undefined);
      if (!remote?.digest || !local.length || local.includes(remote.digest)) return null;
      const item: UpdateItem = {
        key: makeKey('docker', `${img.Repository}:${img.Tag}`),
        providerId: 'docker',
        kind: 'package',
        id: `${img.Repository}:${img.Tag}`,
        name: `${img.Repository}:${img.Tag}`,
        currentVersion: local[0].slice(7, 19),
        availableVersion: remote.digest.slice(7, 19),
        publishedAt: remote.last_updated ? Date.parse(remote.last_updated) : undefined,
        details: 'Nouvelle image publiée sous le même tag',
        homepage: `https://hub.docker.com/${ref.ns === 'library' ? '_' : 'r/' + ref.ns}/${ref.name}`,
        source: 'Docker Hub',
      };
      return item;
    });
    return rows.filter((r): r is UpdateItem => !!r);
  },
  async install(items, ctx) {
    let ok = 0;
    for (const i of items) {
      const res = await run(dockerExe, ['pull', safeId(i.id)], { onLine: ctx.log, timeoutMs: 60 * 60_000, signal: ctx.signal });
      if (res.code === 0) ok++;
    }
    return { success: ok === items.length };
  },
};
