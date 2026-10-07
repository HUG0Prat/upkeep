import { powershellJson } from './exec';
import { readArp } from './inventory';
import type { DiskInfo, GpuInfo, HardwareInfo, PeripheralInfo, SystemInfo, VendorTool } from '../../shared/types';

interface RawHw {
  cpu: string;
  ramGB: number;
  board: string;
  gpus: { name: string; driverVersion: string; driverDate: string }[];
  disks: { model: string; firmware: string; mediaType: string; bus: string; sizeGB: number }[];
  usbVids: string[];
  battery?: { charge: number; status: number; design?: number; full?: number };
}

const HW_SCRIPT = String.raw`
$cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1).Name.Trim()
$ram = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB, 1)
$bb = Get-CimInstance Win32_BaseBoard
$gpus = @(Get-CimInstance Win32_VideoController | ForEach-Object {
  [pscustomobject]@{ name = $_.Name; driverVersion = $_.DriverVersion; driverDate = if ($_.DriverDate) { $_.DriverDate.ToString('yyyy-MM-dd') } else { $null } }
})
$disks = @(Get-PhysicalDisk -ErrorAction SilentlyContinue | ForEach-Object {
  [pscustomobject]@{ model = $_.FriendlyName; firmware = $_.FirmwareVersion; mediaType = [string]$_.MediaType; bus = [string]$_.BusType; sizeGB = [math]::Round($_.Size / 1GB) }
})
$vids = @(Get-CimInstance Win32_PnPEntity -Filter "DeviceID LIKE 'USB\\VID_%' OR DeviceID LIKE 'HID\\VID_%'" -ErrorAction SilentlyContinue |
  ForEach-Object { if ($_.DeviceID -match 'VID_([0-9A-F]{4})') { $Matches[1] } } | Sort-Object -Unique)
$bat = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
$batInfo = $null
if ($bat) {
  $full = (Get-CimInstance -Namespace root\wmi -ClassName BatteryFullChargedCapacity -ErrorAction SilentlyContinue | Select-Object -First 1).FullChargedCapacity
  $design = (Get-CimInstance -Namespace root\wmi -ClassName BatteryStaticData -ErrorAction SilentlyContinue | Select-Object -First 1).DesignedCapacity
  $batInfo = [pscustomobject]@{ charge = $bat.EstimatedChargeRemaining; status = $bat.BatteryStatus; design = $design; full = $full }
}
[pscustomobject]@{ cpu = $cpu; ramGB = $ram; board = "$($bb.Manufacturer) $($bb.Product)"; gpus = $gpus; disks = $disks; usbVids = $vids; battery = $batInfo } | ConvertTo-Json -Depth 4 -Compress`;

interface ToolDef {
  match: RegExp;
  vendor: string;
  tool: string;
  arp: RegExp;
  wingetId?: string;
  url: string;
}

const DISK_TOOLS: ToolDef[] = [
  { match: /samsung/i, vendor: 'Samsung', tool: 'Samsung Magician', arp: /magician/i, wingetId: 'XPDDT99J9GKB5C', url: 'https://semiconductor.samsung.com/consumer-storage/support/tools/' },
  { match: /crucial|^ct\d/i, vendor: 'Crucial', tool: 'Crucial Storage Executive', arp: /storage executive/i, wingetId: 'Crucial.StorageExecutive', url: 'https://www.crucial.com/support/storage-executive' },
  { match: /kingston/i, vendor: 'Kingston', tool: 'Kingston SSD Manager', arp: /ssd manager/i, wingetId: 'Kingston.SSDManager', url: 'https://www.kingston.com/en/support/technical/ssdmanager' },
  { match: /\bwd\b|western digital|sandisk/i, vendor: 'Western Digital', tool: 'WD Dashboard', arp: /dashboard/i, url: 'https://support-en.wd.com/app/products/downloads/softwaredownloads' },
  { match: /sk ?hynix|hfs\d/i, vendor: 'SK hynix', tool: 'Drive Manager', arp: /drive manager/i, url: 'https://ssd.skhynix.com/download/' },
  { match: /intel|solidigm/i, vendor: 'Solidigm', tool: 'Solidigm Storage Tool', arp: /solidigm|storage tool/i, url: 'https://www.solidigm.com/support-page/drivers-downloads.html' },
  { match: /seagate|st\d{4}/i, vendor: 'Seagate', tool: 'SeaTools', arp: /seatools/i, url: 'https://www.seagate.com/support/downloads/seatools/' },
];

const PERIPHERAL_TOOLS: Record<string, Omit<ToolDef, 'match'>[]> = {
  '046D': [
    { vendor: 'Logitech', tool: 'Logitech G HUB', arp: /g hub/i, wingetId: 'Logitech.GHUB', url: 'https://www.logitechg.com/innovation/g-hub.html' },
    { vendor: 'Logitech', tool: 'Logi Options+', arp: /options\+|options plus/i, wingetId: 'Logitech.OptionsPlus', url: 'https://www.logitech.com/software/logi-options-plus.html' },
  ],
  '1532': [{ vendor: 'Razer', tool: 'Razer Synapse 4', arp: /synapse/i, wingetId: 'RazerInc.RazerInstaller.Synapse4', url: 'https://www.razer.com/synapse-4' }],
  '1038': [{ vendor: 'SteelSeries', tool: 'SteelSeries GG', arp: /steelseries/i, wingetId: 'SteelSeries.GG', url: 'https://steelseries.com/gg' }],
  '1B1C': [{ vendor: 'Corsair', tool: 'Corsair iCUE', arp: /icue/i, wingetId: 'Corsair.iCUE.5', url: 'https://www.corsair.com/icue' }],
};

const SUPPORT_URLS: [RegExp, (sys: SystemInfo) => string][] = [
  [/lenovo/i, () => 'https://pcsupport.lenovo.com/'],
  [/dell/i, () => 'https://www.dell.com/support/home/'],
  [/hp|hewlett/i, () => 'https://support.hp.com/drivers'],
  [/asus/i, (s) => `https://www.asus.com/support/searchresult/?searchType=support&searchKey=${encodeURIComponent(s.model)}`],
  [/micro-star|msi/i, (s) => `https://www.msi.com/search/${encodeURIComponent(s.model)}`],
  [/acer/i, () => 'https://www.acer.com/support/drivers-and-manuals'],
  [/gigabyte/i, () => 'https://www.gigabyte.com/Support'],
  [/microsoft/i, () => 'https://support.microsoft.com/surface/download-drivers-and-firmware-for-surface'],
];

export function supportUrlFor(sys: SystemInfo): string | undefined {
  return SUPPORT_URLS.find(([re]) => re.test(sys.manufacturer))?.[1](sys);
}

function gpuVendor(name: string): GpuInfo['vendor'] {
  if (/nvidia|geforce|quadro|rtx/i.test(name)) return 'nvidia';
  if (/amd|radeon/i.test(name)) return 'amd';
  if (/intel/i.test(name)) return 'intel';
  return 'other';
}

export async function readGpus(): Promise<GpuInfo[]> {
  const r = await powershellJson<RawHw['gpus']>(
    "$g = @(Get-CimInstance Win32_VideoController | ForEach-Object { [pscustomobject]@{ name = $_.Name; driverVersion = $_.DriverVersion; driverDate = if ($_.DriverDate) { $_.DriverDate.ToString('yyyy-MM-dd') } else { $null } } }); ConvertTo-Json -InputObject $g -Compress",
    { timeoutMs: 60_000 },
  );
  return [r].flat().map((g) => ({ ...g, vendor: gpuVendor(g.name) }));
}

export async function readHardware(sys: SystemInfo): Promise<HardwareInfo> {
  const [raw, arp] = await Promise.all([powershellJson<RawHw>(HW_SCRIPT, { timeoutMs: 120_000 }), readArp().catch(() => [])]);
  const installed = (re: RegExp) => arp.some((a) => re.test(a.name));
  const toTool = (t: Omit<ToolDef, 'match'>): VendorTool => ({ name: t.tool, installed: installed(t.arp), wingetId: t.wingetId, url: t.url });

  const disks: DiskInfo[] = [raw.disks].flat().filter(Boolean).map((d) => {
    const def = DISK_TOOLS.find((t) => t.match.test(d.model));
    const oem = /^micron mtfd|samsung (pm|mz)/i.test(d.model);
    return { ...d, vendor: def?.vendor ?? (oem ? 'OEM' : undefined), tool: def && !oem ? toTool(def) : undefined };
  });

  const peripherals: PeripheralInfo[] = [];
  for (const vid of [raw.usbVids].flat().filter(Boolean)) {
    for (const t of PERIPHERAL_TOOLS[vid.toUpperCase()] ?? []) {
      peripherals.push({ vendor: t.vendor, name: `Périphérique ${t.vendor} connecté`, tool: toTool(t) });
    }
  }

  let battery: HardwareInfo['battery'];
  if (raw.battery) {
    const b = raw.battery;
    battery = {
      charge: b.charge,
      onAc: b.status === 2 || b.status >= 6,
      health: b.design && b.full ? Math.round((b.full / b.design) * 100) : undefined,
    };
  }

  return {
    cpu: raw.cpu,
    ramGB: raw.ramGB,
    board: raw.board,
    gpus: [raw.gpus].flat().filter(Boolean).map((g) => ({ ...g, vendor: gpuVendor(g.name) })),
    disks,
    peripherals,
    battery,
    supportUrl: supportUrlFor(sys),
  };
}
