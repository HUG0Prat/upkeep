import { cleanLines, commandExists, powershell, powershellJson, run } from './exec';
import { normalizeName } from '../../shared/logic';
import type { InventoryItem } from '../../shared/types';

export interface ArpEntry {
  name: string;
  version?: string;
  publisher?: string;
  installDate?: string;
  sizeBytes?: number;
  iconPath?: string;
}

let arpCache: { at: number; data: ArpEntry[] } | null = null;

const ARP_SCRIPT = String.raw`
$paths = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
         'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
         'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
$seen = @{}
$r = foreach ($p in $paths) {
  Get-ItemProperty $p -ErrorAction SilentlyContinue | Where-Object {
    $_.DisplayName -and $_.SystemComponent -ne 1 -and -not $_.ParentKeyName -and $_.ReleaseType -notmatch 'Update|Hotfix'
  } | ForEach-Object {
    $k = "$($_.DisplayName)|$($_.DisplayVersion)"
    if (-not $seen[$k]) {
      $seen[$k] = 1
      $icon = if ($_.DisplayIcon) { ($_.DisplayIcon -split ',')[0].Trim('"') } else { $null }
      [pscustomobject]@{
        name = $_.DisplayName; version = $_.DisplayVersion; publisher = $_.Publisher
        installDate = if ($_.InstallDate -match '^\d{8}$') { $_.InstallDate.Insert(6,'-').Insert(4,'-') } else { $null }
        sizeBytes = if ($_.EstimatedSize) { [double]$_.EstimatedSize * 1024 } else { $null }
        iconPath = $icon
      }
    }
  }
}
ConvertTo-Json -InputObject @($r) -Compress`;

export async function readArp(): Promise<ArpEntry[]> {
  if (arpCache && Date.now() - arpCache.at < 5 * 60_000) return arpCache.data;
  const data = await powershellJson<ArpEntry[]>(ARP_SCRIPT, { timeoutMs: 120_000 });
  arpCache = { at: Date.now(), data: [data].flat().filter(Boolean) };
  return arpCache.data;
}

interface StoreApp {
  name: string;
  version: string;
  publisher?: string;
}

async function readStoreApps(): Promise<StoreApp[]> {
  const r = await powershellJson<StoreApp[]>(
    String.raw`
$r = Get-AppxPackage -PackageTypeFilter Main -ErrorAction SilentlyContinue |
  Where-Object { $_.SignatureKind -eq 'Store' -and -not $_.IsFramework -and -not $_.NonRemovable } |
  ForEach-Object { [pscustomobject]@{ name = $_.Name; version = [string]$_.Version; publisher = ($_.Publisher -replace '^CN=([^,]+).*','$1') } }
ConvertTo-Json -InputObject @($r) -Compress`,
    { timeoutMs: 120_000 },
  );
  return [r].flat().filter(Boolean);
}

interface WingetInstalled {
  name: string;
  id: string;
  source: string;
}

export async function readWingetInstalled(): Promise<WingetInstalled[]> {
  if (!(await commandExists('winget'))) return [];
  const mod = await powershell('if (Get-Module -ListAvailable Microsoft.WinGet.Client) { "yes" }', { timeoutMs: 30_000 });
  if (mod.stdout.includes('yes')) {
    const r = await powershellJson<WingetInstalled[]>(
      'Import-Module Microsoft.WinGet.Client; $r = Get-WinGetPackage | ForEach-Object { [pscustomobject]@{ name = $_.Name; id = $_.Id; source = [string]$_.Source } }; ConvertTo-Json -InputObject @($r) -Compress',
      { timeoutMs: 180_000 },
    );
    return [r].flat().filter(Boolean);
  }
  const res = await run('winget', ['list', '--accept-source-agreements', '--disable-interactivity'], { timeoutMs: 180_000 });
  const lines = cleanLines(res.stdout);
  const sep = lines.findIndex((l) => /^-{20,}$/.test(l.trim()));
  if (sep < 1) return [];
  const starts = [...lines[sep - 1].matchAll(/\S+/g)].map((m) => m.index!);
  const col = (l: string, i: number) => l.substring(starts[i], i + 1 < starts.length ? starts[i + 1] : undefined).trim();
  const srcCol = starts.length - 1;
  return lines
    .slice(sep + 1)
    .filter((l) => l.trim() && l.length > starts[2])
    .map((l) => ({ name: col(l, 0), id: col(l, 1), source: col(l, srcCol) }))
    .filter((r) => r.id && !/\s/.test(r.id));
}

export async function readInventory(tracked: Record<string, string>): Promise<InventoryItem[]> {
  const [arp, store, wg] = await Promise.all([
    readArp(),
    readStoreApps().catch(() => [] as StoreApp[]),
    readWingetInstalled().catch(() => [] as WingetInstalled[]),
  ]);
  const byName = new Map<string, WingetInstalled>();
  for (const w of wg) byName.set(normalizeName(w.name), w);

  const items: InventoryItem[] = arp.map((a) => {
    const w = byName.get(normalizeName(a.name));
    const managedBy: string[] = [];
    let wingetId: string | undefined;
    if (w?.source && /winget|msstore/i.test(w.source)) {
      managedBy.push(w.source);
      wingetId = w.id;
    }
    if (tracked[a.name]) {
      managedBy.push('winget (associé)');
      wingetId = tracked[a.name];
    }
    return { ...a, source: 'arp' as const, managedBy, wingetId };
  });
  for (const s of store) items.push({ name: s.name, version: s.version, publisher: s.publisher, source: 'store', managedBy: ['msstore'] });
  return items.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

export interface WingetSearchResult {
  name: string;
  id: string;
  version: string;
}

export async function searchWinget(query: string): Promise<WingetSearchResult[]> {
  const res = await run('winget', ['search', '--name', query, '--source', 'winget', '--accept-source-agreements', '--disable-interactivity'], {
    timeoutMs: 60_000,
  });
  return parseWingetSearch(res.stdout).slice(0, 15);
}

/** Tableau texte de « winget search » : Nom, Id, Version, [Correspondance], Source. Les identifiants tronqués (…) sont écartés. */
export function parseWingetSearch(stdout: string): WingetSearchResult[] {
  const lines = cleanLines(stdout);
  const sep = lines.findIndex((l) => /^-{20,}$/.test(l.trim()));
  if (sep < 1) return [];
  const starts = [...lines[sep - 1].matchAll(/\S+/g)].map((m) => m.index!);
  const col = (l: string, i: number) => l.substring(starts[i], i + 1 < starts.length ? starts[i + 1] : undefined).trim();
  return lines
    .slice(sep + 1)
    .filter((l) => l.trim() && !l.startsWith('<') && l.length > starts[2])
    .map((l) => ({ name: col(l, 0), id: col(l, 1), version: col(l, 2) }))
    .filter((r) => r.id && !/\s/.test(r.id) && !r.id.endsWith('…'));
}
