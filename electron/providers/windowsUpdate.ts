import { powershellJson } from '../lib/exec';
import { t } from '../../shared/i18n';
import { makeKey, type CheckContext, type Provider } from './types';
import type { Severity, UpdateItem } from '../../shared/types';

interface WuEntry {
  Id: string;
  Driver: boolean;
  Title: string;
  Hidden: boolean;
  DriverClass: string | null;
  Manufacturer: string | null;
  Model: string | null;
  HardwareId: string | null;
  VerDate: string | null;
  Size: number | null;
  Reboot: boolean;
  Current: string | null;
  CurrentDate: string | null;
  DeviceName: string | null;
  Present: boolean;
  Description: string | null;
  SupportUrl: string | null;
  Kb: string | null;
  Severity: string | null;
  Categories: string | null;
  Cves: string | null;
  Deployed: string | null;
  BrowseOnly: boolean;
}

const searchScript = (serverSelection: number) => String.raw`
$session = New-Object -ComObject Microsoft.Update.Session
$searcher = $session.CreateUpdateSearcher()
$searcher.ServerSelection = ${serverSelection}
$updates = @()
foreach ($h in 0, 1) {
  $res = $searcher.Search("IsInstalled=0 and IsHidden=$h")
  foreach ($u in $res.Updates) { $updates += ,@($u, [bool]$h) }
}

$installed = @{}; $present = @{}; $dateOf = @{}
if (@($updates | Where-Object { $_[0].Type -eq 2 }).Count) {
  $byDevice = @{}
  Get-CimInstance Win32_PnPSignedDriver -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.DeviceID -and $_.DriverVersion) { $byDevice[$_.DeviceID] = $_ }
  }
  Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue | ForEach-Object {
    $d = $byDevice[$_.DeviceID]
    foreach ($id in @($_.HardwareID) + @($_.CompatibleID)) {
      if (-not $id) { continue }
      $k = $id.ToLower()
      if (-not $present.ContainsKey($k)) { $present[$k] = $_.Name }
      if ($d -and -not $installed.ContainsKey($k)) {
        $installed[$k] = $d.DriverVersion
        if ($d.DriverDate) { $dateOf[$k] = ([datetime]$d.DriverDate).ToString('yyyy-MM-dd') }
      }
    }
  }
}

$out = foreach ($pair in $updates) {
  $u = $pair[0]
  $isDriver = $u.Type -eq 2
  $hw = if ($isDriver) { $u.DriverHardwareID } else { $null }
  $k = if ($hw) { $hw.ToLower() } else { $null }
  [pscustomobject]@{
    Id           = $u.Identity.UpdateID
    Driver       = $isDriver
    Title        = $u.Title
    Hidden       = $pair[1]
    DriverClass  = if ($hw) { $u.DriverClass } else { $null }
    Manufacturer = if ($hw) { $u.DriverManufacturer } else { $null }
    Model        = if ($hw) { $u.DriverModel } else { $null }
    HardwareId   = $hw
    VerDate      = if ($hw -and $u.DriverVerDate) { $u.DriverVerDate.ToString('yyyy-MM-dd') } else { $null }
    Size         = [double]$u.MaxDownloadSize
    Reboot       = [bool]($u.InstallationBehavior.RebootBehavior -ne 0)
    Current      = if ($k) { $installed[$k] } else { $null }
    CurrentDate  = if ($k) { $dateOf[$k] } else { $null }
    DeviceName   = if ($k) { $present[$k] } else { $null }
    Present      = [bool]($k -and $present.ContainsKey($k))
    Description  = $u.Description
    SupportUrl   = $u.SupportUrl
    Kb           = (@($u.KBArticleIDs) | ForEach-Object { "KB$_" }) -join ','
    Severity     = $u.MsrcSeverity
    Categories   = (@($u.Categories) | ForEach-Object { $_.Name }) -join ', '
    Cves         = (@($u.CveIDs) | ForEach-Object { $_ }) -join ','
    Deployed     = if ($u.LastDeploymentChangeTime) { $u.LastDeploymentChangeTime.ToString('o') } else { $null }
    BrowseOnly   = [bool]$u.BrowseOnly
  }
}
if (@($out).Count) { ConvertTo-Json -InputObject @($out) -Depth 3 -Compress }
`;


let shared: { at: number; key: string; data: Promise<WuEntry[]> } | null = null;

async function searchAll(ctx: CheckContext): Promise<WuEntry[]> {
  const sel = ctx.settings.respectPolicies && ctx.policy?.wsusServer ? 0 : 2;
  const key = String(sel);
  if (!shared || shared.key !== key || Date.now() - shared.at > 120_000) {
    const data = powershellJson<WuEntry[] | WuEntry>(searchScript(sel), { timeoutMs: ctx.timeoutMs }).then((r) => [r].flat().filter(Boolean));
    shared = { at: Date.now(), key, data };
    data.catch(() => (shared = null));
  }
  return shared.data;
}

export function mapWuDriver(d: WuEntry): UpdateItem {
  const isFirmware = (d.DriverClass ?? '').toLowerCase() === 'firmware';
  return {
    key: makeKey('windowsupdate', d.Id),
    providerId: 'windowsupdate',
    kind: isFirmware ? 'firmware' : 'driver',
    id: d.Id,
    name: d.Title,
    currentVersion: d.Current ?? undefined,
    currentDate: d.CurrentDate ?? undefined,
    availableVersion: versionFromTitle(d.Title) ?? d.VerDate ?? undefined,
    availableDate: d.VerDate ?? undefined,
    publishedAt: d.Deployed ? Date.parse(d.Deployed) : undefined,
    source: 'Windows Update',
    category: d.DriverClass ?? undefined,
    publisher: d.Manufacturer ?? undefined,
    details: d.Present ? t('Pour : {name}', { name: d.DeviceName ?? d.Model ?? d.HardwareId ?? '' }) : t('Périphérique absent : {name}', { name: d.Model ?? d.HardwareId ?? '' }),
    deviceAbsent: !d.Present,
    hardwareId: d.HardwareId ?? undefined,
    hiddenByWindows: d.Hidden,
    optional: d.BrowseOnly,
    homepage: d.SupportUrl ?? undefined,
    sizeBytes: d.Size ?? undefined,
    requiresReboot: d.Reboot || isFirmware,
    requiresAdmin: true,
    supportsDownload: true,
  };
}

export function mapWuSoftware(d: WuEntry): UpdateItem {
  const cats = d.Categories ?? '';
  const severity = severityOf(d.Severity, cats);
  const cves = d.Cves ? d.Cves.split(',').filter(Boolean) : [];
  return {
    key: makeKey('wusoftware', d.Id),
    providerId: 'wusoftware',
    kind: 'system',
    id: d.Id,
    name: d.Title,
    availableVersion: d.Kb || undefined,
    publishedAt: d.Deployed ? Date.parse(d.Deployed) : undefined,
    source: 'Windows Update',
    category: cats.split(', ')[0] || undefined,
    details: [d.Kb, cats].filter(Boolean).join(' · '),
    homepage: d.SupportUrl ?? undefined,
    sizeBytes: d.Size ?? undefined,
    requiresReboot: d.Reboot,
    requiresAdmin: true,
    hiddenByWindows: d.Hidden,
    preview: d.BrowseOnly || /preview|aperçu/i.test(d.Title),
    severity,
    security: !!severity || cves.length > 0 || /definition|défini|security|sécurité/i.test(cats),
    cves,
    supportsDownload: true,
  };
}

let driverNote: string | undefined;

function versionFromTitle(title: string): string | undefined {
  return title.match(/(\d+(?:\.\d+){1,4})\)?\s*$/)?.[1];
}

function severityOf(msrc: string | null, categories: string): Severity | undefined {
  const m = (msrc ?? '').toLowerCase();
  if (m === 'critical') return 'critical';
  if (m === 'important') return 'important';
  if (m === 'moderate' || m === 'low') return 'recommended';
  if (/security|sécurité|critical|critique/i.test(categories)) return 'important';
  return undefined;
}

export const windowsUpdateProvider: Provider = {
  id: 'windowsupdate',
  name: 'Windows Update (pilotes & firmware)',
  kind: 'driver',
  group: 'Pilotes & firmware',
  description: 'Pilotes et firmwares (UEFI/BIOS, contrôleurs…) distribués par Windows Update',
  async detect() {
    return process.platform === 'win32';
  },
  note: () => driverNote,
  async check(ctx) {
    if (ctx.settings.respectPolicies && ctx.policy?.driversExcluded) {
      driverNote = 'Pilotes non proposés : une stratégie de l’organisation les exclut de Windows Update (désactivez « Respecter les stratégies » pour passer outre).';
      return [];
    }
    driverNote = undefined;
    const raw = (await searchAll(ctx)).filter((d) => d.Driver);
    ctx.trace('Windows Update (pilotes)', JSON.stringify(raw, null, 1));
    return raw.map(mapWuDriver);
  },
  async elevatedOps(items, ctx) {
    return [{ op: 'wu-install', type: 'Driver', ids: items.map((i) => i.id), downloadOnly: ctx.downloadOnly }];
  },
  async details(item) {
    return { description: item.details, homepage: item.homepage, publisher: item.publisher, publishedAt: item.publishedAt };
  },
};

export const windowsSoftwareProvider: Provider = {
  id: 'wusoftware',
  name: 'Windows Update (système)',
  kind: 'system',
  group: 'Windows',
  description: 'Mises à jour cumulatives, Defender, .NET, Office et autres produits Microsoft',
  async detect() {
    return process.platform === 'win32';
  },
  async check(ctx) {
    const raw = (await searchAll(ctx)).filter((d) => !d.Driver);
    ctx.trace('Windows Update (système)', JSON.stringify(raw, null, 1));
    return raw.map(mapWuSoftware);
  },
  async elevatedOps(items, ctx) {
    return [{ op: 'wu-install', type: 'Software', ids: items.map((i) => i.id), downloadOnly: ctx.downloadOnly }];
  },
  async details(item) {
    return { description: item.details, homepage: item.homepage, publishedAt: item.publishedAt };
  },
};
