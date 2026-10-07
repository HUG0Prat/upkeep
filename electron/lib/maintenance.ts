import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cleanLines, commandExists, powershellJson, run } from './exec';
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

async function folderSize(path: string): Promise<number> {
  if (!existsSync(path)) return 0;
  try {
    const r = await powershellJson<number>(
      `[double]((Get-ChildItem -LiteralPath '${path.replace(/'/g, "''")}' -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum) | ConvertTo-Json`,
      { timeoutMs: 120_000 },
    );
    return Number(r) || 0;
  } catch {
    return 0;
  }
}

const LOCAL = process.env.LOCALAPPDATA ?? '';
const WINGET_TEMP = join(process.env.TEMP ?? '', 'WinGet');
const WU_CACHE = join(process.env.SystemRoot ?? 'C:\\Windows', 'SoftwareDistribution', 'Download');

let lastDrivers: DriverPackage[] = [];

export async function listCleanup(): Promise<CleanupItem[]> {
  const items: CleanupItem[] = [];
  const drv = await run('pnputil.exe', ['/enum-drivers'], { timeoutMs: 120_000 });
  lastDrivers = supersededDrivers(parsePnputilDrivers(drv.stdout));
  items.push({
    id: 'old-drivers',
    label: t('Anciennes versions de pilotes'),
    description: t('Paquets remplacés par une version plus récente dans le magasin de pilotes. Windows refuse de supprimer ceux encore utilisés.'),
    count: lastDrivers.length,
    requiresAdmin: true,
  });
  items.push({
    id: 'wu-cache',
    label: t('Cache de Windows Update'),
    description: t('Fichiers déjà installés conservés par Windows Update (retéléchargés si besoin).'),
    sizeBytes: await folderSize(WU_CACHE),
    requiresAdmin: true,
  });
  items.push({
    id: 'winget-cache',
    label: t('Installeurs temporaires de winget'),
    description: t('Installeurs téléchargés par winget lors des mises à jour.'),
    sizeBytes: await folderSize(WINGET_TEMP),
    requiresAdmin: false,
  });
  items.push({
    id: 'upkeep-downloads',
    label: t('Téléchargements d’UpKeep'),
    description: t('Pilotes et installeurs téléchargés par UpKeep (NVIDIA, Dell, HP, ASUS, « Télécharger seulement »).'),
    sizeBytes: await folderSize(downloadsDir()),
    requiresAdmin: false,
  });
  if (await commandExists('npm')) {
    items.push({
      id: 'npm-cache',
      label: t('Cache npm'),
      description: t('Paquets Node.js en cache (npm les retélécharge au besoin).'),
      sizeBytes: await folderSize(join(LOCAL, 'npm-cache')),
      requiresAdmin: false,
    });
  }
  const pipCache = join(LOCAL, 'pip', 'cache');
  if (existsSync(pipCache)) {
    items.push({ id: 'pip-cache', label: t('Cache pip'), description: t('Paquets Python en cache.'), sizeBytes: await folderSize(pipCache), requiresAdmin: false });
  }
  return items;
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

export function cleanupOps(id: string): ElevatedOp[] {
  if (id === 'wu-cache') return [{ op: 'cleanup-wu-cache' }];
  if (id === 'old-drivers') return lastDrivers.map((d) => ({ op: 'driver-delete' as const, inf: d.inf }));
  return [];
}
