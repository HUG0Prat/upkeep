import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { cleanLines, commandExists, powershell, powershellJson, psQuote, run } from './exec';
import { downloadsDir } from './paths';
import { compareVersions } from '../../shared/versions';
import { t } from '../../shared/i18n';
import type { CleanupItem } from '../../shared/types';
import type { ElevatedOp } from './elevatedOps';

export interface DriverPackage {
  inf: string;
  original: string;
  provider: string;
  className: string;
  version: string;
  date: string;
}

export function parsePnputilDrivers(text: string): DriverPackage[] {
  const blocks = text.split(/\r?\n\s*\r?\n/);
  const out: DriverPackage[] = [];
  for (const b of blocks) {
    const values = cleanLines(b)
      .map((l) => l.match(/^[^:]+:\s*(.*)$/)?.[1]?.trim())
      .filter((v): v is string => v !== undefined);
    const inf = values.find((v) => /^oem\d+\.inf$/i.test(v));
    if (!inf) continue;
    const i = values.indexOf(inf);
    const verLine = values.find((v) => /^\d{1,2}\/\d{1,2}\/\d{4}\s+[\d.]+$/.test(v) || /^\d{4}-\d{2}-\d{2}\s+[\d.]+$/.test(v));
    const [date, version] = verLine ? verLine.split(/\s+/) : ['', ''];
    out.push({ inf: inf.toLowerCase(), original: values[i + 1] ?? '', provider: values[i + 2] ?? '', className: values[i + 3] ?? '', version, date });
  }
  return out;
}

export function supersededDrivers(list: DriverPackage[]): DriverPackage[] {
  const groups = new Map<string, DriverPackage[]>();
  for (const d of list) {
    const k = `${d.original.toLowerCase()}|${d.provider.toLowerCase()}`;
    groups.set(k, [...(groups.get(k) ?? []), d]);
  }
  const old: DriverPackage[] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    g.sort((a, b) => compareVersions(b.version, a.version));
    old.push(...g.slice(1));
  }
  return old;
}

/** Taille d'un dossier ; undefined si la mesure a échoué (délai dépassé) : le nettoyage reste alors proposé. */
async function folderSize(path: string): Promise<number | undefined> {
  if (!existsSync(path)) return 0;
  try {
    const r = await powershellJson<number>(
      `[double]((Get-ChildItem -LiteralPath ${psQuote(path)} -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum) | ConvertTo-Json`,
      { timeoutMs: 120_000 },
    );
    return Number(r) || 0;
  } catch {
    return undefined;
  }
}

async function sizeOf(paths: string[]): Promise<number | undefined> {
  const sizes = await Promise.all(paths.map(folderSize));
  return sizes.some((s) => s === undefined) ? undefined : sizes.reduce<number>((a, b) => a + (b ?? 0), 0);
}

const LOCAL = process.env.LOCALAPPDATA ?? '';
const ROAMING = process.env.APPDATA ?? '';
const WINDIR = process.env.SystemRoot ?? 'C:\\Windows';
const PROGRAMDATA = process.env.ProgramData ?? 'C:\\ProgramData';
const USER_TEMP = process.env.TEMP ?? join(LOCAL, 'Temp');
const WINGET_TEMP = join(USER_TEMP, 'WinGet');
const WU_CACHE = join(WINDIR, 'SoftwareDistribution', 'Download');
const DO_CACHE = join(WINDIR, 'ServiceProfiles', 'NetworkService', 'AppData', 'Local', 'Microsoft', 'Windows', 'DeliveryOptimization', 'Cache');
const THUMBS = join(LOCAL, 'Microsoft', 'Windows', 'Explorer');
const USER_CRASH = [join(LOCAL, 'CrashDumps'), join(LOCAL, 'Microsoft', 'Windows', 'WER')];
const SYSTEM_CRASH = [join(WINDIR, 'Minidump'), join(WINDIR, 'LiveKernelReports'), join(PROGRAMDATA, 'Microsoft', 'Windows', 'WER')];
const SYSTEM_TEMP = join(WINDIR, 'Temp');
const WINDOWS_OLD = `${process.env.SystemDrive ?? 'C:'}\\Windows.old`;
const SCOOP_CACHE = join(process.env.SCOOP ?? join(process.env.USERPROFILE ?? '', 'scoop'), 'cache');
const THUMB_FILE = /^(thumbcache|iconcache)_.*\.db$/i;

function safeEntries(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Dossiers de cache des navigateurs (profils Chromium et Firefox) : uniquement les caches, jamais l'historique, les cookies ni les mots de passe. */
export function browserCacheDirs(): string[] {
  const dirs: string[] = [];
  const chromium = [
    join(LOCAL, 'Google', 'Chrome', 'User Data'),
    join(LOCAL, 'Microsoft', 'Edge', 'User Data'),
    join(LOCAL, 'BraveSoftware', 'Brave-Browser', 'User Data'),
    join(LOCAL, 'Vivaldi', 'User Data'),
    join(ROAMING, 'Opera Software', 'Opera Stable'),
  ];
  for (const root of chromium) {
    if (!existsSync(root)) continue;
    const profiles = [root, ...safeEntries(root).filter((d) => d.isDirectory() && /^(Default|Profile \d+)$/.test(d.name)).map((d) => join(root, d.name))];
    for (const p of profiles) for (const c of ['Cache', 'Code Cache', 'GPUCache']) if (existsSync(join(p, c))) dirs.push(join(p, c));
  }
  const ff = join(LOCAL, 'Mozilla', 'Firefox', 'Profiles');
  for (const p of safeEntries(ff)) if (p.isDirectory() && existsSync(join(ff, p.name, 'cache2'))) dirs.push(join(ff, p.name, 'cache2'));
  return dirs;
}

function thumbnailSize(): number {
  return safeEntries(THUMBS)
    .filter((f) => f.isFile() && THUMB_FILE.test(f.name))
    .reduce((s, f) => {
      try {
        return s + statSync(join(THUMBS, f.name)).size;
      } catch {
        return s;
      }
    }, 0);
}

async function recycleBinSize(): Promise<number | undefined> {
  try {
    const r = await powershellJson<number>(
      '$s = 0; (New-Object -ComObject Shell.Application).NameSpace(10).Items() | ForEach-Object { $s += [double]$_.Size }; $s | ConvertTo-Json',
      { timeoutMs: 120_000 },
    );
    return Number(r) || 0;
  } catch {
    return undefined;
  }
}

let lastDrivers: DriverPackage[] = [];

export async function listCleanup(): Promise<CleanupItem[]> {
  const item = (id: string, label: string, description: string, requiresAdmin: boolean, size: Promise<number | undefined> | number) =>
    Promise.resolve(size).then((sizeBytes): CleanupItem => ({ id, label, description, requiresAdmin, sizeBytes, sizeUnknown: sizeBytes === undefined || undefined }));
  const pending: Promise<CleanupItem>[] = [
    run('pnputil.exe', ['/enum-drivers'], { timeoutMs: 120_000 }).then((drv) => {
      lastDrivers = supersededDrivers(parsePnputilDrivers(drv.stdout));
      return {
        id: 'old-drivers',
        label: t('Anciennes versions de pilotes'),
        description: t('Paquets remplacés par une version plus récente dans le magasin de pilotes. Windows refuse de supprimer ceux encore utilisés.'),
        count: lastDrivers.length,
        requiresAdmin: true,
      };
    }),
    item('user-temp', t('Fichiers temporaires'), t('Dossier temporaire de votre session (fichiers de plus de 24 h ; ceux encore ouverts sont conservés).'), false, folderSize(USER_TEMP)),
    item('recycle-bin', t('Corbeille'), t('Fichiers supprimés en attente dans la Corbeille de tous les lecteurs. Ils ne pourront plus être restaurés.'), false, recycleBinSize()),
    item(
      'browser-cache',
      t('Cache des navigateurs'),
      t('Chrome, Edge, Brave, Vivaldi, Opera et Firefox : pages et images en cache. Historique, cookies et mots de passe sont conservés ; fermez les navigateurs pour tout libérer.'),
      false,
      sizeOf(browserCacheDirs()),
    ),
    item('thumbnails', t('Cache des miniatures'), t('Aperçus d’images et de vidéos de l’Explorateur, recréés à l’affichage.'), false, thumbnailSize()),
    item('user-crash', t('Rapports d’erreurs et vidages de plantage'), t('Rapports d’erreurs Windows et fichiers de vidage des applications de votre session.'), false, sizeOf(USER_CRASH)),
    item('wu-cache', t('Cache de Windows Update'), t('Fichiers déjà installés conservés par Windows Update (retéléchargés si besoin).'), true, folderSize(WU_CACHE)),
    item('delivery-optimization', t('Cache d’optimisation de la distribution'), t('Mises à jour partagées avec les autres PC du réseau local ou d’Internet.'), true, folderSize(DO_CACHE)),
    item('system-temp', t('Fichiers temporaires de Windows'), t('Dossier Windows\\Temp (fichiers de plus de 24 h).'), true, folderSize(SYSTEM_TEMP)),
    item(
      'system-crash',
      t('Vidages mémoire et rapports système'),
      t('Minidumps des écrans bleus, rapports du noyau et rapports d’erreurs de tous les utilisateurs. Utiles seulement pour diagnostiquer un plantage.'),
      true,
      sizeOf([...SYSTEM_CRASH, join(WINDIR, 'MEMORY.DMP')]),
    ),
    Promise.resolve({
      id: 'component-store',
      label: t('Composants Windows remplacés'),
      description: t('Anciennes versions des composants système conservées après les mises à jour (DISM). Peut durer plusieurs minutes ; les mises à jour déjà installées ne pourront plus être désinstallées.'),
      requiresAdmin: true,
      sizeUnknown: true,
    }),
    item('winget-cache', t('Installeurs temporaires de winget'), t('Installeurs téléchargés par winget lors des mises à jour.'), false, folderSize(WINGET_TEMP)),
    item('upkeep-downloads', t('Téléchargements d’UpKeep'), t('Pilotes et installeurs téléchargés par UpKeep (NVIDIA, Dell, HP, ASUS, « Télécharger seulement »).'), false, folderSize(downloadsDir())),
  ];
  if (existsSync(WINDOWS_OLD)) {
    pending.push(
      item(
        'windows-old',
        t('Installation précédente de Windows'),
        t('Dossier Windows.old laissé par une mise à niveau. Le supprimer empêche de revenir à la version précédente de Windows.'),
        true,
        folderSize(WINDOWS_OLD),
      ),
    );
  }
  if (await commandExists('npm')) {
    pending.push(item('npm-cache', t('Cache npm'), t('Paquets Node.js en cache (npm les retélécharge au besoin).'), false, folderSize(join(LOCAL, 'npm-cache'))));
  }
  const pipCache = join(LOCAL, 'pip', 'cache');
  if (existsSync(pipCache)) pending.push(item('pip-cache', t('Cache pip'), t('Paquets Python en cache.'), false, folderSize(pipCache)));
  if (existsSync(SCOOP_CACHE)) pending.push(item('scoop-cache', t('Cache Scoop'), t('Archives téléchargées par Scoop.'), false, folderSize(SCOOP_CACHE)));
  return Promise.all(pending);
}

/** Vide un dossier fichier par fichier : les fichiers verrouillés, trop récents ou les liens sont laissés en place. */
export function purge(dir: string, log: (l: string) => void, minAgeMs = 0): number {
  if (!existsSync(dir)) return 0;
  let freed = 0;
  let skipped = 0;
  const now = Date.now();
  const walk = (d: string): boolean => {
    let empty = true;
    for (const e of safeEntries(d)) {
      const p = join(d, e.name);
      try {
        if (e.isSymbolicLink()) {
          empty = false;
        } else if (e.isDirectory()) {
          if (walk(p)) rmSync(p, { recursive: true, force: true });
          else empty = false;
        } else {
          const st = statSync(p);
          if (minAgeMs && now - st.mtimeMs < minAgeMs) {
            empty = false;
            continue;
          }
          rmSync(p, { force: true });
          freed += st.size;
        }
      } catch {
        skipped++;
        empty = false;
      }
    }
    return empty;
  };
  walk(dir);
  log(
    t('{dir} : {mb} Mo libérés', { dir, mb: (freed / 1048576).toFixed(0) }) +
      (skipped ? t(' ({n} fichier(s) en cours d’utilisation conservé(s))', { n: skipped }) : ''),
  );
  return freed;
}

export async function cleanUser(id: string, log: (l: string) => void): Promise<boolean> {
  switch (id) {
    case 'winget-cache':
      rmSync(WINGET_TEMP, { recursive: true, force: true });
      log(t('Installeurs temporaires de winget supprimés.'));
      return true;
    case 'upkeep-downloads':
      rmSync(downloadsDir(), { recursive: true, force: true });
      log(t('Téléchargements d’UpKeep supprimés.'));
      return true;
    case 'user-temp':
      purge(USER_TEMP, log, 86_400_000);
      return true;
    case 'browser-cache':
      for (const d of browserCacheDirs()) purge(d, log);
      return true;
    case 'user-crash':
      for (const d of USER_CRASH) purge(d, log);
      return true;
    case 'scoop-cache':
      purge(SCOOP_CACHE, log);
      return true;
    case 'thumbnails': {
      let n = 0;
      for (const f of safeEntries(THUMBS)) {
        if (!f.isFile() || !THUMB_FILE.test(f.name)) continue;
        try {
          rmSync(join(THUMBS, f.name), { force: true });
          n++;
        } catch {
          // Ouvert par l'Explorateur : recréé de toute façon à la prochaine ouverture de session.
        }
      }
      log(t('{n} fichier(s) de miniatures supprimé(s) ; ceux ouverts par l’Explorateur sont conservés.', { n }));
      return true;
    }
    case 'recycle-bin': {
      const r = await powershell('Clear-RecycleBin -Force -ErrorAction SilentlyContinue; "ok"', { timeoutMs: 300_000 });
      log(r.code === 0 ? t('Corbeille vidée.') : r.stderr);
      return r.code === 0;
    }
    case 'npm-cache': {
      const r = await run('npm cache clean --force', [], { shell: true, onLine: log, timeoutMs: 300_000 });
      return r.code === 0;
    }
    case 'pip-cache': {
      const r = await run('py', ['-3', '-m', 'pip', 'cache', 'purge'], { onLine: log, timeoutMs: 300_000 });
      return r.code === 0;
    }
    default:
      return false;
  }
}

const SYSTEM_TARGETS = ['delivery-optimization', 'system-temp', 'system-crash', 'component-store', 'windows-old'] as const;
export type SystemCleanupTarget = (typeof SYSTEM_TARGETS)[number];

export function cleanupOps(id: string): ElevatedOp[] {
  if (id === 'wu-cache') return [{ op: 'cleanup-wu-cache' }];
  if ((SYSTEM_TARGETS as readonly string[]).includes(id)) return [{ op: 'cleanup-system', target: id as SystemCleanupTarget }];
  if (id === 'old-drivers') return lastDrivers.map((d) => ({ op: 'driver-delete' as const, inf: d.inf }));
  return [];
}
