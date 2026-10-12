import { powershellJson } from './exec';
import { fetchText } from './http';
import { t } from '../../shared/i18n';
import type { DriverInfo, DriverSearchResult } from '../../shared/types';

const DRIVERS_SCRIPT = String.raw`
$err = @{}
Get-CimInstance Win32_PnPEntity -Filter 'ConfigManagerErrorCode <> 0' -ErrorAction SilentlyContinue | ForEach-Object { $err[$_.DeviceID] = [int]$_.ConfigManagerErrorCode }
$r = @(Get-CimInstance Win32_PnPSignedDriver -ErrorAction SilentlyContinue | Where-Object { $_.DeviceName } | ForEach-Object {
  [pscustomobject]@{
    device = $_.DeviceName; className = $_.DeviceClass; provider = $_.DriverProviderName; manufacturer = $_.Manufacturer
    version = $_.DriverVersion; date = if ($_.DriverDate) { $_.DriverDate.ToString('yyyy-MM-dd') } else { $null }
    inf = $_.InfName; signed = [bool]$_.IsSigned; hardwareId = $_.HardWareID; problem = $err[$_.DeviceID]
  }
})
ConvertTo-Json -InputObject $r -Compress`;

/** Pilotes des périphériques présents, un par périphérique. */
export async function readDrivers(): Promise<DriverInfo[]> {
  const r = await powershellJson<DriverInfo[] | DriverInfo>(DRIVERS_SCRIPT, { timeoutMs: 180_000 });
  return [r]
    .flat()
    .filter(Boolean)
    .map((d) => ({ ...d, problem: d.problem || undefined }))
    // Sans fichier .inf : services et énumérateurs logiciels, sauf s'ils sont en erreur (pilote manquant).
    .filter((d) => d.inf || d.problem)
    .sort((a, b) => (a.className ?? '').localeCompare(b.className ?? '') || a.device.localeCompare(b.device));
}

const CATALOG = 'https://www.catalog.update.microsoft.com';

/** Noms, modèles et identifiants matériels (PCI\VEN_8086&DEV_51F0, USB\VID_046D…) ; rien d'autre. */
export function cleanDriverQuery(q: string): string {
  const s = q.trim().replace(/\s+/g, ' ');
  if (s.length < 2 || s.length > 120 || !/^[\p{L}\p{N} .+#_&\\()/-]+$/u.test(s)) {
    throw new Error(t('Recherche refusée : 2 à 120 caractères, lettres, chiffres et . + # _ & \\ ( ) / -'));
  }
  return s;
}

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/** Page de résultats du catalogue : une ligne par mise à jour, cellules repérées par « {guid}_C{n}_R{ligne} ». */
export function parseCatalogSearch(html: string): DriverSearchResult[] {
  const out: DriverSearchResult[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<tr id="([0-9a-f-]{36})_R\d+"/gi)) {
    const id = m[1].toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    const cell = (n: number) => {
      const c = html.match(new RegExp(`id="${m[1]}_C${n}_R\\d+">([\\s\\S]*?)</td>`, 'i'));
      return c ? decode(c[1]) : '';
    };
    const original = html.match(new RegExp(`id="${m[1]}_originalSize">(\\d+)<`, 'i'))?.[1];
    const size = html.match(new RegExp(`id="${m[1]}_size">([^<]*)<`, 'i'))?.[1]?.trim() ?? '';
    out.push({
      id,
      title: cell(1),
      products: cell(2),
      classification: cell(3),
      date: cell(4),
      version: cell(5),
      size,
      sizeBytes: original ? Number(original) : undefined,
    });
  }
  return out.filter((r) => r.title);
}

/** Pilotes uniquement : le catalogue mélange pilotes, correctifs Windows et définitions Defender. */
export async function searchDriverCatalog(query: string): Promise<DriverSearchResult[]> {
  const q = cleanDriverQuery(query);
  const html = await fetchText(`${CATALOG}/Search.aspx?q=${encodeURIComponent(q)}`, { timeoutMs: 60_000 });
  return parseCatalogSearch(html).filter((r) => /driver|pilote|treiber|controlador/i.test(`${r.classification} ${r.title}`));
}

export interface CatalogFile {
  url: string;
  /** SHA-256 en hexadécimal (le catalogue le donne en base64). */
  sha256?: string;
}

export function parseDownloadDialog(html: string): CatalogFile[] {
  const files: CatalogFile[] = [];
  for (const m of html.matchAll(/downloadInformation\[0\]\.files\[(\d+)\]\.url\s*=\s*'([^']+)'/g)) {
    const sha = html.match(new RegExp(`downloadInformation\\[0\\]\\.files\\[${m[1]}\\]\\.sha256\\s*=\\s*'([^']*)'`))?.[1];
    files.push({ url: m[2], sha256: sha ? Buffer.from(sha, 'base64').toString('hex') : undefined });
  }
  return files;
}

/** Fichiers .cab d'une mise à jour du catalogue, servis uniquement par les serveurs Windows Update. */
export async function catalogFiles(updateId: string): Promise<CatalogFile[]> {
  if (!/^[0-9a-f-]{36}$/i.test(updateId)) throw new Error(t('Identifiant de mise à jour invalide.'));
  const body = new URLSearchParams({ updateIDs: JSON.stringify([{ size: 0, languages: '', uidInfo: updateId, updateID: updateId }]) });
  const html = await fetchText(`${CATALOG}/DownloadDialog.aspx`, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeoutMs: 60_000,
  });
  return parseDownloadDialog(html).filter((f) => {
    try {
      const u = new URL(f.url);
      return u.protocol === 'https:' && /(^|\.)(windowsupdate\.com|microsoft\.com)$/i.test(u.hostname) && /\.cab$/i.test(u.pathname);
    } catch {
      return false;
    }
  });
}
