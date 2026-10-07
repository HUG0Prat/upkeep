import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { powershell, run } from '../lib/exec';
import { download, fetchJson, fetchText, verifySignature } from '../lib/http';
import { readGpus } from '../lib/hardware';
import { readArp } from '../lib/inventory';
import { downloadsDir } from '../lib/paths';
import type { ElevatedOp } from '../lib/elevatedOps';
import { makeKey, type InstallContext, type Provider } from './types';
import { compareVersions, isNewer } from '../../shared/versions';
import { t } from '../../shared/i18n';
import type { GpuInfo, UpdateItem } from '../../shared/types';

let gpuCache: GpuInfo[] | null = null;
async function gpus(): Promise<GpuInfo[]> {
  gpuCache ??= await readGpus().catch(() => []);
  return gpuCache;
}

export function nvidiaVersion(windowsVersion?: string): string | undefined {
  if (!windowsVersion) return undefined;
  const digits = windowsVersion.split('.').slice(-2).join('');
  if (digits.length < 5) return undefined;
  const last5 = digits.slice(-5);
  return `${last5.slice(0, 3)}.${last5.slice(3)}`;
}

let productCache: { at: number; list: { psid: string; pfid: string; name: string }[] } | null = null;

async function nvidiaProducts() {
  if (productCache && Date.now() - productCache.at < 86_400_000) return productCache.list;
  const xml = await fetchText('https://www.nvidia.com/Download/API/lookupValueSearch.aspx?TypeID=3', { timeoutMs: 60_000 });
  const list = [...xml.matchAll(/<LookupValue ParentID="(\d+)"[^>]*>\s*<Name>([^<]+)<\/Name>\s*<Value>(\d+)<\/Value>/g)].map((m) => ({
    psid: m[1],
    name: m[2].trim(),
    pfid: m[3],
  }));
  productCache = { at: Date.now(), list };
  return list;
}

interface NvDriver {
  Name: string;
  Version: string;
  ReleaseDateTime: string;
  DownloadURL: string;
  DownloadURLFileSize: string;
  DetailsURL: string;
}

async function nvidiaLatest(psid: string, pfid: string, studio: boolean): Promise<NvDriver | null> {
  const url =
    'https://gfwsl.geforce.com/services_toolkit/services/com/nvidia/services/AjaxDriverService.php?func=DriverManualLookup' +
    `&psid=${psid}&pfid=${pfid}&osID=57&languageCode=1033&beta=0&isWHQL=1&dltype=-1&dch=1&upCRD=${studio ? 1 : 0}&qnf=0&sort1=0&numberOfResults=1`;
  const j = await fetchJson<{ Success: string; IDS?: { downloadInfo: Record<string, string> }[] }>(url);
  const d = j.IDS?.[0]?.downloadInfo;
  if (j.Success !== '1' || !d || d.Success !== '1') return null;
  const dec = (k: string) => decodeURIComponent(d[k] ?? '');
  return {
    Name: dec('Name'),
    Version: dec('Version'),
    ReleaseDateTime: dec('ReleaseDateTime'),
    DownloadURL: dec('DownloadURL'),
    DownloadURLFileSize: dec('DownloadURLFileSize'),
    DetailsURL: dec('DetailsURL'),
  };
}

function parseSize(s: string): number | undefined {
  const m = s.match(/([\d.]+)\s*(KB|MB|GB)/i);
  if (!m) return undefined;
  return Math.round(parseFloat(m[1]) * { KB: 1024, MB: 1048576, GB: 1073741824 }[m[2].toUpperCase() as 'KB' | 'MB' | 'GB']);
}

const nvDownloads = new Map<string, string>();
let nvNote: string | undefined;

export function fileSha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(path)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

export async function fetchInstaller(url: string, folder: string, ctx: InstallContext, expectedSigner: RegExp): Promise<{ path: string; sha256: string }> {
  const dir = join(downloadsDir(), folder);
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, basename(new URL(url).pathname));
  if (!existsSync(dest)) {
    ctx.log(t('Téléchargement de {file}…', { file: basename(dest) }));
    await download(
      url,
      dest + '.part',
      (pct, done, total) => {
        if (pct >= 0) ctx.progress(pct);
        if (pct % 10 === 0) ctx.log(`  ${(done / 1048576).toFixed(0)} Mo / ${(total / 1048576).toFixed(0)} Mo`);
      },
      ctx.signal,
    );
    await rename(dest + '.part', dest);
  } else {
    ctx.log(t('Installeur déjà téléchargé : {path}', { path: dest }));
  }
  const sig = await verifySignature(dest);
  ctx.log(`Signature : ${sig.status}${sig.signer ? ` — ${sig.signer}` : ''}`);
  if (!sig.valid || !expectedSigner.test(sig.signer ?? '')) {
    throw new Error(t('Signature numérique invalide ou éditeur inattendu : installation bloquée.'));
  }
  return { path: dest, sha256: await fileSha256(dest) };
}

export const nvidiaProvider: Provider = {
  id: 'nvidia',
  name: 'NVIDIA GeForce',
  kind: 'driver',
  group: 'Pilotes & firmware',
  description: 'Dernier pilote Game Ready ou Studio publié par NVIDIA pour votre carte graphique',
  note: () => nvNote,
  async detect() {
    return (await gpus()).some((g) => g.vendor === 'nvidia');
  },
  async check(ctx) {
    const out: UpdateItem[] = [];
    const products = await nvidiaProducts();
    for (const g of (await gpus()).filter((x) => x.vendor === 'nvidia')) {
      const short = g.name.replace(/^NVIDIA\s+/i, '').trim();
      const p = products.find((x) => x.name.toLowerCase() === short.toLowerCase()) ?? products.find((x) => short.toLowerCase().includes(x.name.toLowerCase()));
      if (!p) {
        ctx.trace('produit NVIDIA introuvable', short);
        continue;
      }
      const studio = ctx.settings.nvidiaBranch === 'studio';
      let drv = await nvidiaLatest(p.psid, p.pfid, studio);
      nvNote = undefined;
      if (!drv && studio) {
        nvNote = 'Aucun pilote Studio publié pour ce GPU : UpKeep propose la branche Game Ready.';
        drv = await nvidiaLatest(p.psid, p.pfid, false);
      }
      ctx.trace(`NVIDIA ${short} (psid ${p.psid}, pfid ${p.pfid})`, JSON.stringify(drv, null, 1));
      const current = nvidiaVersion(g.driverVersion);
      if (!drv || !isNewer(drv.Version, current)) continue;
      nvDownloads.set(g.name, drv.DownloadURL);
      out.push({
        key: makeKey('nvidia', g.name),
        providerId: 'nvidia',
        kind: 'driver',
        id: g.name,
        name: `${drv.Name} — ${short}`,
        currentVersion: current,
        currentDate: g.driverDate,
        availableVersion: drv.Version,
        publishedAt: Date.parse(drv.ReleaseDateTime) || undefined,
        sizeBytes: parseSize(drv.DownloadURLFileSize),
        releaseNotesUrl: drv.DetailsURL,
        homepage: drv.DetailsURL,
        publisher: 'NVIDIA',
        source: 'NVIDIA',
        category: 'Display',
        requiresAdmin: true,
        supportsDownload: true,
      });
    }
    return out;
  },
  async elevatedOps(items, ctx) {
    const ops: ElevatedOp[] = [];
    for (const i of items) {
      const url = nvDownloads.get(i.id);
      if (!url) throw new Error(t('Lien de téléchargement inconnu : relancez une vérification.'));
      const exe = await fetchInstaller(url, 'nvidia', ctx, /NVIDIA/i);
      if (ctx.downloadOnly) ops.push({ op: 'simulate', text: t('Téléchargé : {path}', { path: exe.path }) });
      else ops.push({ op: 'run-installer', vendor: 'nvidia', path: exe.path, sha256: exe.sha256 });
    }
    return ops;
  },
};


let amdNote: string | undefined;

export const amdProvider: Provider = {
  id: 'amd',
  name: 'AMD Radeon',
  kind: 'driver',
  group: 'Pilotes & firmware',
  description: 'Version du pilote AMD Software: Adrenalin Edition installée',
  experimental: true,
  note: () => amdNote,
  async detect() {
    return (await gpus()).some((g) => g.vendor === 'amd');
  },
  async check(ctx) {
    const r = await powershell("(Get-ItemProperty 'HKLM:\\SOFTWARE\\AMD\\CN' -ErrorAction SilentlyContinue).RadeonSoftwareVersion", { timeoutMs: 30_000 });
    const version = r.stdout.trim() || (await gpus()).find((g) => g.vendor === 'amd')?.driverVersion;
    ctx.trace('AMD', r.stdout + r.stderr);
    amdNote = t('Version installée : {v}. AMD ne publie pas d’API de versions et son site bloque les accès automatiques : utilisez « Rechercher les mises à jour » dans AMD Software.', {
      v: version ?? t('inconnue'),
    });
    return [];
  },
  actions: [
    {
      id: 'open-amd',
      label: 'Ouvrir la page des pilotes AMD',
      async run() {
        await run('explorer.exe', ['https://www.amd.com/en/support/download/drivers.html']);
        return true;
      },
    },
  ],
};


let intelNote: string | undefined;
const INTEL_GFX_PAGE = 'https://www.intel.com/content/www/us/en/download/785597/intel-arc-graphics-windows.html';

export function isIntelXe(name: string): boolean {
  return /arc|iris\s*xe|xe graphics|uhd graphics/i.test(name);
}

export function parseIntelGraphicsVersion(html: string): string | undefined {
  const versions = [...new Set([...html.matchAll(/\b(3\d\.0\.10[01]\.\d{4})\b/g)].map((m) => m[1]))];
  return versions.sort((a, b) => compareVersions(b, a))[0];
}

export const intelProvider: Provider = {
  id: 'intel',
  name: 'Intel (graphique)',
  kind: 'driver',
  group: 'Pilotes & firmware',
  description: 'Pilote graphique Intel comparé à la dernière version publiée par Intel ; Intel DSA pour le Wi-Fi et le Bluetooth',
  experimental: true,
  note: () => intelNote,
  async detect() {
    return (await gpus()).some((g) => g.vendor === 'intel');
  },
  async check(ctx) {
    const installedDsa = (await readArp()).some((a) => /driver (&|and) support assistant/i.test(a.name));
    const ig = (await gpus()).find((g) => g.vendor === 'intel');
    intelNote = installedDsa
      ? t('Intel DSA est installé : il gère aussi les pilotes Wi-Fi et Bluetooth Intel.')
      : t('Pour les pilotes Wi-Fi et Bluetooth Intel, installez Intel DSA (action ci-dessous).');
    if (!ig || !isIntelXe(ig.name)) {
      intelNote += ' ' + t('Ce GPU Intel n’utilise pas le pilote unifié Xe : vérification automatique indisponible.');
      return [];
    }
    const html = await fetchText(INTEL_GFX_PAGE, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', Accept: 'text/html' }, timeoutMs: 60_000 });
    const latest = parseIntelGraphicsVersion(html);
    ctx.trace('Intel', JSON.stringify({ installedDsa, gpu: ig, latest }, null, 1));
    if (!latest || !ig.driverVersion || !isNewer(latest, ig.driverVersion)) return [];
    return [
      {
        key: makeKey('intel', 'graphics'),
        providerId: 'intel',
        kind: 'driver',
        id: 'graphics',
        name: `Intel Graphics Driver — ${ig.name}`,
        currentVersion: ig.driverVersion,
        currentDate: ig.driverDate,
        availableVersion: latest,
        publisher: 'Intel',
        source: 'Intel',
        category: 'Display',
        homepage: INTEL_GFX_PAGE,
        manualUrl: INTEL_GFX_PAGE,
        details: t('Installation depuis le site d’Intel (l’installeur Intel n’est pas silencieux).'),
      },
    ];
  },
  async install(items, ctx) {
    for (const i of items) if (i.manualUrl) await run('explorer.exe', [i.manualUrl]);
    ctx.log(t('Page de téléchargement Intel ouverte dans le navigateur.'));
    return { success: true };
  },
  actions: [
    {
      id: 'install-dsa',
      label: 'Installer Intel DSA (winget)',
      async run(log) {
        const r = await run(
          'winget',
          ['install', '--id', 'Intel.IntelDriverAndSupportAssistant', '--exact', '--silent', '--accept-package-agreements', '--accept-source-agreements'],
          { onLine: log, timeoutMs: 20 * 60_000 },
        );
        return r.code === 0;
      },
    },
    {
      id: 'open-dsa',
      label: 'Ouvrir Intel DSA',
      async run() {
        await run('explorer.exe', ['https://www.intel.com/content/www/us/en/support/intel-driver-support-assistant.html']);
        return true;
      },
    },
  ],
};
