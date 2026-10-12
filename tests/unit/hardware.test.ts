import { describe, expect, it } from 'vitest';
import { buildUsbPorts, type RawUsbPort } from '../../electron/lib/ports';
import { cleanDriverQuery, parseCatalogSearch, parseDownloadDialog } from '../../electron/lib/drivers';
import { buildBiosGuide, type FirmwareInfo } from '../../electron/lib/biosGuide';
import { healthChecks, type RawHealth } from '../../electron/lib/health';
import { catalogHardwareId } from '../../shared/logic';

const HUB = '\\\\?\\usb#root_hub30#4&84aac64&0&0#{f18a0e88-c30c-11d0-8815-00a0c906bed8}';
const port = (p: Partial<RawUsbPort> & { port: number }): RawUsbPort => ({
  hub: HUB,
  hubName: 'Hub USB racine (USB 3.0)',
  status: 0,
  speed: 0,
  isHub: false,
  flags: 1,
  companionPort: 0,
  companionHub: 'USB#ROOT_HUB30#4&84aac64&0&0#{f18a0e88-c30c-11d0-8815-00a0c906bed8}',
  protocols: 3,
  superSpeed: false,
  problem: 0,
  ...p,
});

describe('ports USB', () => {
  it('regroupe les ports compagnons USB 2/USB 3 d’un même connecteur et écarte les ports internes', () => {
    const { ports, internal } = buildUsbPorts([
      port({ port: 1, companionPort: 13 }),
      port({ port: 2, flags: 9, companionPort: 14 }),
      port({ port: 4, flags: 0 }),
      port({ port: 10, flags: 0, status: 1, device: 'Bluetooth' }),
      port({ port: 13, protocols: 4, companionPort: 1 }),
      port({ port: 14, protocols: 4, flags: 11, companionPort: 2, status: 1, superSpeed: true, device: 'Clé USB' }),
    ]);
    expect(internal).toBe(2);
    expect(ports).toHaveLength(2);
    expect(ports[0]).toMatchObject({ label: 'USB 3', state: 'free' });
    expect(ports[1]).toMatchObject({ label: 'USB-C', state: 'used', device: 'Clé USB', detail: 'SuperSpeed (5 Gbit/s+)' });
  });

  it('signale les ports défaillants (surintensité, échec d’énumération, code 43)', () => {
    const { ports } = buildUsbPorts([
      port({ port: 1, status: 4 }),
      port({ port: 2, status: 2 }),
      port({ port: 3, status: 1, problem: 43, device: 'Périphérique USB inconnu' }),
      port({ port: 5, status: 1, problem: 28, device: 'Manette' }),
    ]);
    expect(ports.map((p) => p.state)).toEqual(['fault', 'fault', 'fault', 'used']);
    expect(ports[0].detail).toMatch(/Surintensité/);
    expect(ports[3].detail).toMatch(/code 28/);
  });

  it('un hub externe sans information ACPI est considéré comme accessible', () => {
    const { ports, internal } = buildUsbPorts([port({ port: 1, flags: -1, hub: '\\\\?\\usb#vid_05e3&pid_0610#x#{f18a0e88-c30c-11d0-8815-00a0c906bed8}' })]);
    expect(internal).toBe(0);
    expect(ports).toHaveLength(1);
  });
});

const CATALOG_ROW = (id: string, title: string, cls: string) => `
	</tr><tr id="${id}_R1" style="border-width:0px;">
		<td class="resultsbottomBorder" id="${id}_C0_R1">
                    </td><td class="resultsbottomBorder resultspadding" id="${id}_C1_R1">
                        <a id='${id}_link' href= "javascript:void(0);" onclick='goToDetails("${id}");'>
                            ${title}
                        </a>
                    </td><td class="resultsbottomBorder resultspadding" id="${id}_C2_R1">
                        Windows 11 Client,  version 22H2 and later,  Servicing Drivers
                    </td><td class="resultsbottomBorder resultspadding" id="${id}_C3_R1">
                        ${cls}
                    </td><td class="resultsbottomBorder resultspadding " id="${id}_C4_R1">
                        5/13/2026
                    </td><td class="resultsbottomBorder resultspadding" id="${id}_C5_R1">
                        24.1050.0.3
                    </td><td class="resultsbottomBorder resultspadding resultsSizeWidth" id="${id}_C6_R1">
                       <span id="${id}_size">667 KB</span>
                       <span class="noDisplay" id="${id}_originalSize">683465</span>
                    </td>`;

describe('catalogue Microsoft Update', () => {
  it('lit les lignes de résultats', () => {
    const html = CATALOG_ROW('d96c7a74-f270-4e21-a31e-2d90520f4e22', 'Intel Corporation SoftwareComponent Driver Update (24.1050.0.3)', 'Drivers (Other Hardware)') +
      CATALOG_ROW('11111111-2222-3333-4444-555555555555', 'Realtek &amp; Co - Extension', 'Drivers (Sound)');
    const r = parseCatalogSearch(html);
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({
      id: 'd96c7a74-f270-4e21-a31e-2d90520f4e22',
      title: 'Intel Corporation SoftwareComponent Driver Update (24.1050.0.3)',
      products: 'Windows 11 Client, version 22H2 and later, Servicing Drivers',
      classification: 'Drivers (Other Hardware)',
      date: '5/13/2026',
      version: '24.1050.0.3',
      size: '667 KB',
      sizeBytes: 683465,
    });
    expect(r[1].title).toBe('Realtek & Co - Extension');
  });

  it('lit l’URL et l’empreinte SHA-256 (base64 → hexadécimal) du téléchargement', () => {
    const html = `downloadInformation[0].files[0].url = 'https://catalog.s.download.windowsupdate.com/c/msdownload/update/driver/drvs/2026/07/x.cab';
downloadInformation[0].files[0].digest = 'tVQAR3Q5GCjAKepWhRqu3cvB2zs=';
downloadInformation[0].files[0].sha256 = '1ajj/4tSg+I4usK3a5h0vXuHBHe3IcHSGuDYjryzyQU=';`;
    expect(parseDownloadDialog(html)).toEqual([
      { url: 'https://catalog.s.download.windowsupdate.com/c/msdownload/update/driver/drvs/2026/07/x.cab', sha256: 'd5a8e3ff8b5283e238bac2b76b9874bd7b870477b721c1d21ae0d88ebcb3c905' },
    ]);
  });

  it('accepte les identifiants matériels et refuse le reste', () => {
    expect(cleanDriverQuery('  PCI\\VEN_8086&DEV_51F0 ')).toBe('PCI\\VEN_8086&DEV_51F0');
    expect(() => cleanDriverQuery('x')).toThrow();
    expect(() => cleanDriverQuery('a"; <script>')).toThrow();
  });

  it('simplifie l’identifiant matériel pour la recherche', () => {
    expect(catalogHardwareId('PCI\\VEN_8086&DEV_51F0&SUBSYS_00748086&REV_01')).toBe('PCI\\VEN_8086&DEV_51F0');
    expect(catalogHardwareId('USB\\VID_8087&PID_0026&REV_0002')).toBe('USB\\VID_8087&PID_0026');
  });
});

const FW: FirmwareInfo = {
  manufacturer: 'LENOVO',
  model: '21HD',
  family: 'ThinkPad T14 Gen 4',
  biosVendor: 'LENOVO',
  biosVersion: 'R2FET55W',
  firmwareType: 'UEFI',
  cpuVendor: 'intel',
  bitlockerOn: false,
};

describe('aide BIOS', () => {
  it('choisit la procédure du constructeur et propose le redémarrage UEFI', () => {
    const g = buildBiosGuide(FW, 'secureboot');
    expect(g.machine).toContain('ThinkPad');
    expect(g.entry).toMatch(/F1/);
    expect(g.steps.join('\n')).toMatch(/Security › Secure Boot/);
    expect(g.canRebootToFirmware).toBe(true);
    expect(g.docsUrl).toMatch(/^https:\/\/www\.bing\.com\/search\?q=/);
  });

  it('prévient en mode hérité et quand BitLocker est actif', () => {
    const g = buildBiosGuide({ ...FW, manufacturer: 'Contoso', family: undefined, firmwareType: 'Legacy', bitlockerOn: true }, 'secureboot');
    expect(g.canRebootToFirmware).toBe(false);
    expect(g.warnings.join('\n')).toMatch(/mbr2gpt/);
    expect(g.warnings.join('\n')).toMatch(/BitLocker/);
  });

  it('adapte le réglage au processeur (Intel PTT / AMD fTPM)', () => {
    expect(buildBiosGuide({ ...FW, manufacturer: 'ASUS', cpuVendor: 'amd' }, 'tpm').steps.join('\n')).toMatch(/fTPM/);
    expect(buildBiosGuide({ ...FW, manufacturer: 'ASUS', cpuVendor: 'intel' }, 'tpm').steps.join('\n')).toMatch(/PTT/);
  });
});

describe('santé des composants', () => {
  const raw: RawHealth = {
    disks: [{ name: 'SSD', health: 'Healthy', op: 'OK', wear: 85, temp: 40 }],
    predictFailure: 0,
    cycles: 300,
    temps: [],
    problems: { name: 'Périphérique USB inconnu', className: 'USB', code: 43 },
    whea: 2,
    wheaFatal: 1,
    diskErrors: 0,
    unexpected: 0,
    memoryTest: { id: 1202, date: '2026-09-01' },
  };
  it('classe les indicateurs', () => {
    const c = Object.fromEntries(healthChecks(raw, { health: 60 }).map((x) => [x.id, x.status]));
    expect(c).toMatchObject({ 'disk:SSD': 'warn', 'disk-events': 'ok', whea: 'bad', memory: 'bad', battery: 'warn', devices: 'bad' });
    expect(c.temperature).toBeUndefined();
  });
});
