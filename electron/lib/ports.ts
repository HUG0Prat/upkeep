import { powershellJson } from './exec';
import { t } from '../../shared/i18n';
import type { PortInfo, PortsReport } from '../../shared/types';

/**
 * Lecture des ports USB par les IOCTL des hubs, comme USBView : état de connexion de chaque port (libre, occupé,
 * surintensité, échec d'énumération…), ports internes signalés par l'ACPI et ports compagnons USB 2/USB 3 d'un même
 * connecteur. Le type C# est compilé une fois par hôte PowerShell (C# 5 : Windows PowerShell 5.1).
 */
const USB_TYPE = String.raw`
if (-not ('UkUsbPorts' -as [type])) {
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class UkUsbPorts {
  [StructLayout(LayoutKind.Sequential)] struct IfData { public int cbSize; public Guid g; public int Flags; public IntPtr Reserved; }
  [StructLayout(LayoutKind.Sequential)] struct DevData { public int cbSize; public Guid g; public int DevInst; public IntPtr Reserved; }
  [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr SetupDiGetClassDevs(ref Guid g, string e, IntPtr h, int f);
  [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr SetupDiGetClassDevs(IntPtr g, string e, IntPtr h, int f);
  [DllImport("setupapi.dll", SetLastError = true)] static extern bool SetupDiEnumDeviceInterfaces(IntPtr s, IntPtr d, ref Guid g, int i, ref IfData o);
  [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr s, ref IfData d, IntPtr o, int size, out int req, ref DevData info);
  [DllImport("setupapi.dll", SetLastError = true)] static extern bool SetupDiEnumDeviceInfo(IntPtr s, int i, ref DevData d);
  [DllImport("setupapi.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool SetupDiGetDeviceRegistryProperty(IntPtr s, ref DevData d, int p, out int t, byte[] b, int size, out int req);
  [DllImport("setupapi.dll")] static extern bool SetupDiDestroyDeviceInfoList(IntPtr s);
  [DllImport("cfgmgr32.dll")] static extern int CM_Get_DevNode_Status(out int status, out int problem, int devInst, int flags);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateFile(string n, uint a, uint s, IntPtr sa, uint c, uint f, IntPtr t);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool DeviceIoControl(IntPtr h, uint code, byte[] i, int il, byte[] o, int ol, out int ret, IntPtr ov);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

  static string Prop(IntPtr set, ref DevData d, int p) {
    var b = new byte[2048]; int t, req;
    if (!SetupDiGetDeviceRegistryProperty(set, ref d, p, out t, b, b.Length, out req)) return null;
    return Encoding.Unicode.GetString(b, 0, Math.Max(0, req - 2)).Split('\0')[0];
  }

  class Dev { public string Name; public int Problem; }

  static Dictionary<string, Dev> DevicesByDriverKey() {
    var map = new Dictionary<string, Dev>(StringComparer.OrdinalIgnoreCase);
    IntPtr set = SetupDiGetClassDevs(IntPtr.Zero, null, IntPtr.Zero, 0x2 | 0x4);
    var d = new DevData(); d.cbSize = Marshal.SizeOf(d);
    for (int i = 0; SetupDiEnumDeviceInfo(set, i, ref d); i++) {
      string key = Prop(set, ref d, 9);
      if (key == null) continue;
      int st, pb;
      if (CM_Get_DevNode_Status(out st, out pb, d.DevInst, 0) != 0) { st = 0; pb = 0; }
      map[key] = new Dev { Name = Prop(set, ref d, 12) ?? Prop(set, ref d, 0), Problem = (st & 0x400) != 0 ? pb : 0 };
    }
    SetupDiDestroyDeviceInfoList(set);
    return map;
  }

  static byte[] Ioctl(IntPtr h, uint code, byte[] input, int outSize) {
    var o = new byte[outSize]; int ret;
    return DeviceIoControl(h, code, input, input.Length, o, o.Length, out ret, IntPtr.Zero) ? o : null;
  }

  static byte[] PortInput(int port, int size) {
    var b = new byte[size]; BitConverter.GetBytes(port).CopyTo(b, 0); return b;
  }

  public static List<object> Read() {
    var res = new List<object>();
    var devs = DevicesByDriverKey();
    Guid hubGuid = new Guid("f18a0e88-c30c-11d0-8815-00a0c906bed8");
    IntPtr set = SetupDiGetClassDevs(ref hubGuid, null, IntPtr.Zero, 0x2 | 0x10);
    var di = new IfData(); di.cbSize = Marshal.SizeOf(di);
    for (int i = 0; SetupDiEnumDeviceInterfaces(set, IntPtr.Zero, ref hubGuid, i, ref di); i++) {
      var info = new DevData(); info.cbSize = Marshal.SizeOf(info);
      int req; SetupDiGetDeviceInterfaceDetail(set, ref di, IntPtr.Zero, 0, out req, ref info);
      if (req <= 0) continue;
      IntPtr buf = Marshal.AllocHGlobal(req);
      Marshal.WriteInt32(buf, IntPtr.Size == 8 ? 8 : 6);
      string path = null;
      if (SetupDiGetDeviceInterfaceDetail(set, ref di, buf, req, out req, ref info)) path = Marshal.PtrToStringUni(new IntPtr(buf.ToInt64() + 4));
      Marshal.FreeHGlobal(buf);
      if (path == null) continue;
      string hubName = Prop(set, ref info, 12) ?? Prop(set, ref info, 0);
      IntPtr h = CreateFile(path, 0x40000000, 0x2, IntPtr.Zero, 3, 0, IntPtr.Zero);
      if (h == new IntPtr(-1)) continue;
      try {
        var node = Ioctl(h, 0x220408, new byte[76], 76);
        if (node == null) continue;
        int n = node[6];
        for (int p = 1; p <= n; p++) {
          var c = Ioctl(h, 0x220448, PortInput(p, 512), 512);
          if (c == null) continue;
          int status = BitConverter.ToInt32(c, 31);
          var props = Ioctl(h, 0x220458, PortInput(p, 512), 512);
          var v2in = PortInput(p, 16); BitConverter.GetBytes(16).CopyTo(v2in, 4); BitConverter.GetBytes(7).CopyTo(v2in, 8);
          var v2 = Ioctl(h, 0x22045C, v2in, 16);
          string devName = null; int problem = 0;
          if (status != 0) {
            var k = Ioctl(h, 0x220420, PortInput(p, 1024), 1024);
            if (k != null) {
              Dev d;
              if (devs.TryGetValue(Encoding.Unicode.GetString(k, 8, 1016).Split('\0')[0], out d)) { devName = d.Name; problem = d.Problem; }
            }
          }
          var row = new Dictionary<string, object>();
          row["hub"] = path; row["hubName"] = hubName; row["port"] = p; row["status"] = status; row["speed"] = (int)c[23]; row["isHub"] = c[24] != 0;
          row["flags"] = props == null ? -1 : BitConverter.ToInt32(props, 8);
          row["companionPort"] = props == null ? 0 : (int)BitConverter.ToUInt16(props, 14);
          row["companionHub"] = props == null ? null : Encoding.Unicode.GetString(props, 16, 496).Split('\0')[0];
          row["protocols"] = v2 == null ? 0 : BitConverter.ToInt32(v2, 8);
          row["superSpeed"] = v2 != null && (BitConverter.ToInt32(v2, 12) & 1) != 0;
          row["device"] = devName; row["problem"] = problem;
          res.Add(row);
        }
      } finally { CloseHandle(h); }
    }
    SetupDiDestroyDeviceInfoList(set);
    return res;
  }
}
'@
}`;

const PORTS_SCRIPT = String.raw`
${USB_TYPE}
$usb = @([UkUsbPorts]::Read())
$net = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.NdisPhysicalMedium -eq 14 } | ForEach-Object {
  [pscustomobject]@{ name = $_.Name; description = $_.InterfaceDescription; status = [string]$_.Status; speed = [string]$_.LinkSpeed }
})
$names = @{}
Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorID -ErrorAction SilentlyContinue | ForEach-Object {
  $names[$_.InstanceName] = (($_.UserFriendlyName | Where-Object { $_ -ne 0 } | ForEach-Object { [char]$_ }) -join '')
}
$displays = @(Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorConnectionParams -ErrorAction SilentlyContinue | Where-Object { $_.Active } | ForEach-Object {
  [pscustomobject]@{ id = $_.InstanceName; name = $names[$_.InstanceName]; tech = [long]$_.VideoOutputTechnology }
})
[pscustomobject]@{ usb = $usb; net = $net; displays = $displays } | ConvertTo-Json -Depth 4 -Compress`;

export interface RawUsbPort {
  hub: string;
  hubName?: string;
  port: number;
  /** USB_CONNECTION_STATUS. */
  status: number;
  speed: number;
  isHub: boolean;
  /** USB_PORT_PROPERTIES : bit 0 accessible à l'utilisateur, bit 3 connecteur USB-C ; -1 inconnu. */
  flags: number;
  companionPort: number;
  companionHub?: string | null;
  /** USB_PROTOCOLS : bit 0 USB 1.1, bit 1 USB 2, bit 2 USB 3. */
  protocols: number;
  superSpeed: boolean;
  device?: string | null;
  problem: number;
}

interface RawPorts {
  usb: RawUsbPort[] | RawUsbPort;
  net: { name: string; description: string; status: string; speed: string }[] | { name: string; description: string; status: string; speed: string };
  displays: { id: string; name?: string; tech: number }[] | { id: string; name?: string; tech: number };
}

const USB_FAULTS: Record<number, string> = {
  2: 'Échec d’énumération : un périphérique est détecté mais ne répond pas',
  3: 'Défaillance générale du port',
  4: 'Surintensité : le port a coupé l’alimentation (court-circuit, câble ou périphérique défectueux)',
  5: 'Puissance insuffisante pour le périphérique branché',
  6: 'Bande passante USB insuffisante',
  7: 'Trop de hubs USB chaînés',
};

const normHub = (s?: string | null) => (s ?? '').toLowerCase().replace(/^\\\\[?.]\\/, '');

const portLabel = (p: RawUsbPort): string => {
  if (p.flags >= 0 && p.flags & 8) return 'USB-C';
  if (p.protocols & 4) return 'USB 3';
  if (p.protocols & 2) return 'USB 2';
  return 'USB';
};

/**
 * Regroupe les ports compagnons (un connecteur USB 3 apparaît comme un port USB 2 et un port USB 3 du même hub) et
 * écarte les ports internes. L'état du connecteur combine celui de ses deux ports : un défaut l'emporte.
 */
export function buildUsbPorts(raw: RawUsbPort[]): { ports: PortInfo[]; internal: number } {
  const byKey = new Map(raw.map((p) => [`${normHub(p.hub)}#${p.port}`, p]));
  const seen = new Set<string>();
  const ports: PortInfo[] = [];
  let internal = 0;
  for (const p of raw) {
    const key = `${normHub(p.hub)}#${p.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const group = [p];
    if (p.companionPort > 0) {
      const ck = `${normHub(p.companionHub) || normHub(p.hub)}#${p.companionPort}`;
      const c = byKey.get(ck);
      if (c && !seen.has(ck)) {
        seen.add(ck);
        group.push(c);
      }
    }
    // Sans information ACPI (flags inconnus, hubs externes), le port est considéré comme accessible.
    if (group.every((g) => g.flags >= 0 && !(g.flags & 1))) {
      internal++;
      continue;
    }
    const fault = group.find((g) => USB_FAULTS[g.status] || g.problem === 43);
    const used = group.find((g) => g.status === 1 || g.status >= 8);
    const labels = group.map(portLabel);
    const label = labels.includes('USB-C') ? 'USB-C' : labels.includes('USB 3') ? 'USB 3' : labels[0];
    const base: PortInfo = {
      id: group.map((g) => `${normHub(g.hub)}#${g.port}`).sort().join('+'),
      kind: 'usb',
      label,
      location: p.hubName ?? undefined,
      state: 'free',
    };
    if (fault) {
      ports.push({
        ...base,
        state: 'fault',
        device: fault.device ?? undefined,
        detail: USB_FAULTS[fault.status] ? t(USB_FAULTS[fault.status]) : t('Le périphérique branché ne répond pas correctement (code 43)'),
      });
    } else if (used) {
      const speed = used.superSpeed || used.speed >= 3 ? 'SuperSpeed (5 Gbit/s+)' : ['Low Speed (1,5 Mbit/s)', 'Full Speed (12 Mbit/s)', 'High Speed (480 Mbit/s)'][used.speed];
      ports.push({
        ...base,
        state: 'used',
        device: used.device ?? (used.isHub ? t('Hub USB') : undefined),
        detail: used.problem ? t('Pilote en erreur (code {n})', { n: used.problem }) : speed,
      });
    } else {
      ports.push(base);
    }
  }
  return { ports, internal };
}

const DISPLAY_TECH: Record<number, string> = {
  0: 'VGA',
  4: 'DVI',
  5: 'HDMI',
  6: 'LVDS',
  10: 'DisplayPort',
  11: 'eDP',
  12: 'UDI',
  15: 'Miracast',
};

export async function readPorts(): Promise<PortsReport> {
  const raw = await powershellJson<RawPorts>(PORTS_SCRIPT, { timeoutMs: 120_000 });
  const { ports, internal } = buildUsbPorts([raw.usb].flat().filter(Boolean));
  for (const n of [raw.net].flat().filter(Boolean)) {
    const up = /^up$/i.test(n.status);
    ports.push({
      id: `net#${n.name}`,
      kind: 'ethernet',
      label: 'Ethernet',
      location: n.description,
      state: up ? 'used' : 'free',
      device: up ? t('Câble branché') : undefined,
      detail: up ? n.speed : /disabled/i.test(n.status) ? t('carte désactivée') : undefined,
    });
  }
  for (const d of [raw.displays].flat().filter(Boolean)) {
    const internalScreen = d.tech === 11 || d.tech === 6 || d.tech === 0x80000000 || d.tech === -2147483648;
    ports.push({
      id: `display#${d.id}`,
      kind: 'display',
      label: internalScreen ? t('Écran intégré') : (DISPLAY_TECH[d.tech] ?? t('Sortie vidéo')),
      state: 'used',
      device: d.name?.replace(/\0/g, '').trim() || t('Écran'),
    });
  }
  return { ports, internal, at: Date.now() };
}
