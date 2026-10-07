import { join } from 'node:path';
import { cleanLines, commandExists, powershell, powershellJson, run, safeId } from '../lib/exec';
import { readArp } from '../lib/inventory';
import { downloadsDir } from '../lib/paths';
import { makeKey, type CheckContext, type InstallContext, type Provider } from './types';
import { isNewer, isPreviewVersion } from '../../shared/versions';
import type { UpdateDetails, UpdateItem } from '../../shared/types';

const COMMON = ['--accept-source-agreements', '--disable-interactivity'];
const TRACKED = 'Associé manuellement';

export function parseWingetTable(output: string): Omit<UpdateItem, 'key' | 'providerId' | 'kind'>[] {
  const lines = cleanLines(output);
  const sep = lines.findIndex((l) => /^-{20,}$/.test(l.trim()));
  if (sep < 1) return [];
  const header = lines[sep - 1];
  const starts = [...header.matchAll(/\S+/g)].map((m) => m.index!);
  if (starts.length < 4) return [];

  const col = (line: string, i: number) =>
    line.substring(starts[i], i + 1 < starts.length ? starts[i + 1] : undefined).trim();

  const rows = [];
  for (const line of lines.slice(sep + 1)) {
    if (!line.trim()) break;
    if (line.length <= starts[3]) continue;
    const id = col(line, 1);
    const available = col(line, 3);
    if (!id || /\s/.test(id) || !available) continue;
    rows.push({
      id,
      name: col(line, 0),
      currentVersion: col(line, 2),
      availableVersion: available,
      source: starts.length > 4 ? col(line, 4) : 'winget',
    });
  }
  return rows;
}

export function parseWingetShow(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let last: string | null = null;
  for (const line of cleanLines(text)) {
    const m = line.match(/^([^\s:][^:]{0,40}?)\s*:\s?(.*)$/);
    if (m && !/^https?$/i.test(m[1])) {
      last = m[1].trim();
      out[last] = m[2].trim();
    } else if (last && /^\s+\S/.test(line)) {
      out[last] = `${out[last]}\n${line.trim()}`.trim();
    }
  }
  return out;
}

function pick(fields: Record<string, string>, re: RegExp): string | undefined {
  const k = Object.keys(fields).find((x) => re.test(x));
  return k ? fields[k] || undefined : undefined;
}

export function wingetDetails(fields: Record<string, string>): UpdateDetails {
  const date = pick(fields, /release date|date de (publication|sortie|version)/i);
  return {
    description: pick(fields, /^description$/i),
    publisher: pick(fields, /^(publisher|éditeur|editeur)$/i),
    license: pick(fields, /^(license|licence)$/i),
    homepage: pick(fields, /homepage|page d.accueil/i),
    releaseNotesUrl: pick(fields, /release notes url|url des notes/i),
    releaseNotes: pick(fields, /^(release notes|notes de (publication|version))$/i),
    publishedAt: date ? Date.parse(date) || undefined : undefined,
  };
}

let useModule = false;

async function moduleAvailable(): Promise<boolean> {
  const r = await powershell('if (Get-Module -ListAvailable Microsoft.WinGet.Client) { "yes" }', { timeoutMs: 30_000 });
  return r.stdout.includes('yes');
}

interface ModuleRow {
  Id: string;
  Name: string;
  Current: string;
  Available: string;
  Source: string;
}

async function checkWithModule(ctx: CheckContext, source: 'winget' | 'msstore'): Promise<UpdateItem[]> {
  const rows = await powershellJson<ModuleRow[] | ModuleRow>(
    String.raw`
Import-Module Microsoft.WinGet.Client
$r = @(Get-WinGetPackage | Where-Object { $_.IsUpdateAvailable } | ForEach-Object {
  [pscustomobject]@{ Id = $_.Id; Name = $_.Name; Current = [string]$_.InstalledVersion; Available = [string]@($_.AvailableVersions)[0]; Source = [string]$_.Source }
})
if ($r.Count) { ConvertTo-Json -InputObject $r -Compress }`,
    { timeoutMs: ctx.timeoutMs },
  );
  ctx.trace('Get-WinGetPackage', JSON.stringify(rows, null, 1));
  return [rows]
    .flat()
    .filter((r) => r && (source === 'msstore' ? r.Source === 'msstore' : r.Source !== 'msstore'))
    .filter((r) => ctx.settings.includeUnknownVersions || !/unknown|inconnu/i.test(r.Current))
    .map((r) => toItem(source, { id: r.Id, name: r.Name, currentVersion: r.Current, availableVersion: r.Available, source: r.Source }));
}

function toItem(providerId: 'winget' | 'msstore', r: Omit<UpdateItem, 'key' | 'providerId' | 'kind'>): UpdateItem {
  return {
    ...r,
    key: makeKey(providerId, r.id),
    providerId,
    kind: 'package',
    iconName: r.name,
    preview: isPreviewVersion(r.availableVersion),
    supportsVersions: providerId === 'winget',
    supportsDownload: providerId === 'winget',
  };
}

async function checkText(ctx: CheckContext, source: 'winget' | 'msstore'): Promise<UpdateItem[]> {
  const args = ['upgrade', ...COMMON, '--source', source];
  if (ctx.settings.includeUnknownVersions) args.push('--include-unknown');
  const res = await run('winget', args, { timeoutMs: ctx.timeoutMs });
  ctx.trace(`winget ${args.join(' ')}`, res.stdout + res.stderr);
  return parseWingetTable(res.stdout).map((r) => toItem(source, r));
}

async function checkTracked(ctx: CheckContext, known: Set<string>): Promise<UpdateItem[]> {
  const tracked = Object.entries(ctx.settings.trackedPrograms).filter(([, id]) => !known.has(id));
  if (!tracked.length) return [];
  const arp = await readArp();
  const out: UpdateItem[] = [];
  for (const [arpName, id] of tracked) {
    const installed = arp.find((a) => a.name === arpName);
    if (!installed) continue;
    const res = await run('winget', ['show', '--id', safeId(id), '--exact', ...COMMON], { timeoutMs: 60_000 });
    const fields = parseWingetShow(res.stdout);
    const latest = pick(fields, /^version$/i);
    ctx.trace(`winget show ${id}`, res.stdout);
    if (latest && installed.version && isNewer(latest, installed.version)) {
      out.push({
        ...toItem('winget', { id, name: arpName, currentVersion: installed.version, availableVersion: latest, source: 'winget' }),
        category: TRACKED,
        publisher: installed.publisher,
      });
    }
  }
  return out;
}

function installArgs(item: UpdateItem, ctx: InstallContext, source: string): string[] {
  const opts = ctx.settings.packageOptions[item.key] ?? {};
  const tracked = item.category === TRACKED;
  const verb = item.targetVersion || tracked ? 'install' : 'upgrade';
  const args = [verb, '--id', safeId(item.id), '--exact', '--silent', '--accept-package-agreements', ...COMMON, '--source', source];
  if (item.targetVersion) args.push('--version', item.targetVersion, '--force');
  if (tracked) args.push('--force');
  if (opts.scope) args.push('--scope', opts.scope);
  if (opts.architecture) args.push('--architecture', opts.architecture);
  if (opts.customArgs?.trim()) args.push('--custom', opts.customArgs.trim());
  return args;
}

async function installWith(source: 'winget' | 'msstore', items: UpdateItem[], ctx: InstallContext) {
  let ok = 0;
  let reboot = false;
  for (const item of items) {
    if (ctx.signal.aborted) break;
    const args = installArgs(item, ctx, source);
    ctx.log(`▶ winget ${args.join(' ')}`);
    const res = await run('winget', args, { onLine: ctx.log, timeoutMs: 60 * 60_000, signal: ctx.signal });
    const needsReboot = res.code >>> 0 === 0x8a150109;
    if (res.code === 0 || needsReboot) ok++;
    else ctx.log(`✖ ${item.id} : code ${res.code} (0x${(res.code >>> 0).toString(16).toUpperCase()})`);
    if (needsReboot) reboot = true;
  }
  return { success: ok === items.length, rebootRequired: reboot };
}

export const wingetProvider: Provider = {
  id: 'winget',
  name: 'WinGet',
  kind: 'package',
  group: 'Paquets',
  description: 'Gestionnaire de paquets Windows (Microsoft)',
  async detect() {
    const ok = await commandExists('winget');
    useModule = ok && (await moduleAvailable());
    return ok;
  },
  note: () =>
    useModule
      ? 'Détection via le module PowerShell Microsoft.WinGet.Client.'
      : 'Détection par lecture du texte de winget (les identifiants très longs peuvent être tronqués). Installez le module pour une détection fiable.',
  async check(ctx) {
    let items: UpdateItem[];
    try {
      items = useModule ? await checkWithModule(ctx, 'winget') : await checkText(ctx, 'winget');
    } catch (err) {
      if (!useModule) throw err;
      ctx.trace('module en échec, repli sur le texte', String(err));
      items = await checkText(ctx, 'winget');
    }
    const tracked = await checkTracked(ctx, new Set(items.map((i) => i.id)));
    return [...items, ...tracked];
  },
  install: (items, ctx) => installWith('winget', items, ctx),
  async download(items, ctx) {
    let ok = 0;
    for (const item of items) {
      const dir = join(downloadsDir(), item.id);
      ctx.log(`▶ winget download ${item.id} → ${dir}`);
      const res = await run('winget', ['download', '--id', safeId(item.id), '--exact', '-d', dir, '--accept-package-agreements', ...COMMON], {
        onLine: ctx.log,
        timeoutMs: 60 * 60_000,
        signal: ctx.signal,
      });
      if (res.code === 0) ok++;
    }
    return { success: ok === items.length };
  },
  async listVersions(item) {
    const res = await run('winget', ['show', '--id', safeId(item.id), '--exact', '--versions', ...COMMON], { timeoutMs: 60_000 });
    const lines = cleanLines(res.stdout);
    const sep = lines.findIndex((l) => /^-{3,}$/.test(l.trim()));
    return lines
      .slice(sep + 1)
      .map((l) => l.trim())
      .filter((l) => l && /\d/.test(l) && !/\s/.test(l));
  },
  async details(item) {
    const res = await run('winget', ['show', '--id', safeId(item.id), '--exact', ...COMMON], { timeoutMs: 60_000 });
    return wingetDetails(parseWingetShow(res.stdout));
  },
  actions: [
    {
      id: 'install-module',
      label: 'Installer le module Microsoft.WinGet.Client',
      async run(log) {
        log('Installation du module Microsoft.WinGet.Client (portée utilisateur)…');
        const r = await powershell(
          'Install-PackageProvider -Name NuGet -MinimumVersion 2.8.5.201 -Scope CurrentUser -Force | Out-Null;' +
            'Install-Module Microsoft.WinGet.Client -Scope CurrentUser -Force -AllowClobber; "OK"',
          { onLine: log, timeoutMs: 10 * 60_000 },
        );
        useModule = await moduleAvailable();
        return r.code === 0 && useModule;
      },
    },
  ],
};

export const msstoreProvider: Provider = {
  id: 'msstore',
  name: 'Microsoft Store',
  kind: 'package',
  group: 'Applications',
  description: 'Applications du Microsoft Store (via winget, source msstore)',
  detect: () => commandExists('winget'),
  async check(ctx) {
    if (useModule) {
      try {
        return await checkWithModule(ctx, 'msstore');
      } catch (err) {
        ctx.trace('module en échec, repli sur le texte', String(err));
      }
    }
    return checkText(ctx, 'msstore');
  },
  install: (items, ctx) => installWith('msstore', items, ctx),
};
