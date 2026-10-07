import { powershell, powershellJson } from './exec';
import type { Conditions, SystemInfo, UpdatePolicy } from '../../shared/types';

export async function getSystemInfo(): Promise<SystemInfo> {
  try {
    return await powershellJson<SystemInfo>(
      String.raw`
$cs = Get-CimInstance Win32_ComputerSystem
$csp = Get-CimInstance Win32_ComputerSystemProduct
$bios = Get-CimInstance Win32_BIOS
$os = Get-CimInstance Win32_OperatingSystem
$model = if ($cs.Manufacturer -match 'lenovo' -and $csp.Version) { "$($csp.Version) ($($cs.Model))" } else { $cs.Model }
[pscustomobject]@{
  manufacturer = $cs.Manufacturer
  model        = $model
  biosVersion  = $bios.SMBIOSBIOSVersion
  biosDate     = if ($bios.ReleaseDate) { $bios.ReleaseDate.ToString('yyyy-MM-dd') } else { $null }
  os           = "$($os.Caption) $($os.Version)"
} | ConvertTo-Json -Compress`,
      { timeoutMs: 60_000 },
    );
  } catch (err) {
    console.error('[system] lecture des informations matérielles impossible :', err);
    return { manufacturer: 'Inconnu', model: 'Inconnu', biosVersion: '?', os: process.platform };
  }
}

export async function isElevated(): Promise<boolean> {
  const res = await powershell(
    '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)',
  );
  return res.stdout.trim().toLowerCase() === 'true';
}

export async function readUpdatePolicy(): Promise<UpdatePolicy> {
  try {
    return await powershellJson<UpdatePolicy>(
      String.raw`
$wu = Get-ItemProperty 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate' -ErrorAction SilentlyContinue
$au = Get-ItemProperty 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU' -ErrorAction SilentlyContinue
$mdm = @(Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Enrollments' -ErrorAction SilentlyContinue | Where-Object { (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).ProviderID -eq 'MS DM Server' }).Count -gt 0
[pscustomobject]@{
  wsusServer = if ($au.UseWUServer -eq 1) { $wu.WUServer } else { $null }
  intune = $mdm
  driversExcluded = [bool]($wu.ExcludeWUDriversInQualityUpdate -eq 1)
} | ConvertTo-Json -Compress`,
      { timeoutMs: 30_000 },
    );
  } catch {
    return { intune: false, driversExcluded: false };
  }
}

export async function isMetered(): Promise<boolean> {
  const r = await powershell(
    String.raw`
[void][Windows.Networking.Connectivity.NetworkInformation, Windows.Networking.Connectivity, ContentType = WindowsRuntime]
$p = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
if (-not $p) { 'offline' } else { $c = $p.GetConnectionCost(); if ($c.NetworkCostType -ne 'Unrestricted' -or $c.Roaming -or $c.OverDataLimit) { 'metered' } else { 'ok' } }`,
    { timeoutMs: 30_000 },
  );
  return r.stdout.includes('metered');
}

export async function isFocusBusy(): Promise<boolean> {
  const r = await powershell(
    String.raw`
if (-not ('AM.Shell' -as [type])) { Add-Type -Namespace AM -Name Shell -MemberDefinition '[DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state);' }
$s = 0; [void][AM.Shell]::SHQueryUserNotificationState([ref]$s); $s`,
    { timeoutMs: 30_000 },
  );
  return [2, 3, 4, 6].includes(Number(r.stdout.trim()));
}

export async function batteryStatus(): Promise<{ level?: number; onAc: boolean }> {
  try {
    const r = await powershellJson<{ level?: number; status?: number }>(
      "$b = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1; if ($b) { [pscustomobject]@{ level = $b.EstimatedChargeRemaining; status = $b.BatteryStatus } | ConvertTo-Json -Compress } else { '{}' }",
      { timeoutMs: 30_000 },
    );
    return { level: r.level, onAc: r.status === undefined || r.status !== 1 };
  } catch {
    return { onAc: true };
  }
}

export async function activeHours(): Promise<{ start: number; end: number }> {
  try {
    const r = await powershellJson<{ start: number; end: number }>(
      "$s = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\WindowsUpdate\\UX\\Settings' -ErrorAction SilentlyContinue; " +
        "[pscustomobject]@{ start = if ($null -ne $s.ActiveHoursStart) { [int]$s.ActiveHoursStart } else { 8 }; end = if ($null -ne $s.ActiveHoursEnd) { [int]$s.ActiveHoursEnd } else { 17 } } | ConvertTo-Json -Compress",
      { timeoutMs: 20_000 },
    );
    return r;
  } catch {
    return { start: 8, end: 17 };
  }
}

export const defaultConditions = (): Conditions => ({ metered: false, onBattery: false, focusBusy: false, online: true });
