import { compareVersions } from '../../shared/versions';
import { t } from '../../shared/i18n';
import type { EolItem, SecurityCheck, SystemInfo, UpdateItem } from '../../shared/types';
import { commandExists, powershellJson, run } from './exec';
import { fetchJson } from './http';
import { loadJson, saveJson } from './storage';

const DAY = 86_400_000;


async function cached<T>(name: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const c = loadJson<{ at: number; data: T } | null>(name, null);
  if (c && Date.now() - c.at < ttlMs) return c.data;
  try {
    const data = await fetcher();
    saveJson(name, { at: Date.now(), data });
    return data;
  } catch (err) {
    if (c) return c.data;
    throw err;
  }
}


interface EolCycle {
  cycle: string;
  releaseDate?: string;
  eol: string | boolean;
  latest?: string;
}

export function eolCycles(product: string): Promise<EolCycle[]> {
  return cached(`eol-${product}.json`, DAY, () => fetchJson<EolCycle[]>(`https://endoflife.date/api/${product}.json`));
}

export function eolStatus(eol: string | boolean, now = Date.now()): EolItem['status'] {
  if (eol === true) return 'eol';
  if (!eol) return 'ok';
  const end = Date.parse(eol);
  if (end < now) return 'eol';
  return end - now < 180 * DAY ? 'soon' : 'ok';
}

interface WinVersion {
  DisplayVersion: string;
  EditionID: string;
  CurrentBuild: string;
  UBR: number;
}

export async function windowsVersion(): Promise<WinVersion> {
  return powershellJson<WinVersion>(
    "Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion' | Select-Object DisplayVersion, EditionID, CurrentBuild, UBR | ConvertTo-Json -Compress",
    { timeoutMs: 30_000 },
  );
}

export function windowsCycle(v: WinVersion): string {
  const family = Number(v.CurrentBuild) >= 22000 ? '11' : '10';
  const edition = /enterprise|education|iot/i.test(v.EditionID) ? 'e' : 'w';
  return `${family}-${v.DisplayVersion.toLowerCase()}-${edition}`;
}

export function newerWindowsCycle(cycles: EolCycle[], current: string): EolCycle | undefined {
  const [family, , edition] = current.split('-');
  const cur = cycles.find((c) => c.cycle === current);
  if (!cur?.releaseDate) return undefined;
  return cycles
    .filter((c) => c.cycle.startsWith(`${family}-`) && c.cycle.endsWith(`-${edition}`) && !/lts|iot/.test(c.cycle))
    .filter((c) => c.releaseDate! > cur.releaseDate! && compareVersions(c.latest, cur.latest) > 0)
    .sort((a, b) => (a.releaseDate! < b.releaseDate! ? 1 : -1))[0];
}

interface Runtime {
  product: string;
  label: string;
  version: string;
}

async function installedRuntimes(): Promise<Runtime[]> {
  const out: Runtime[] = [];
  if (await commandExists('py')) {
    const r = await run('py', ['--list'], { timeoutMs: 20_000 });
    for (const m of r.stdout.matchAll(/-V:(\d+\.\d+)/g)) out.push({ product: 'python', label: 'Python', version: m[1] });
  } else if (await commandExists('python')) {
    const m = (await run('python', ['--version'], { timeoutMs: 20_000 })).stdout.match(/(\d+\.\d+)/);
    if (m) out.push({ product: 'python', label: 'Python', version: m[1] });
  }
  if (await commandExists('node')) {
    const m = (await run('node', ['--version'], { timeoutMs: 20_000 })).stdout.match(/v?(\d+)\.(\d+)\.(\d+)/);
    if (m) out.push({ product: 'nodejs', label: 'Node.js', version: `${m[1]}.${m[2]}.${m[3]}` });
  }
  if (await commandExists('dotnet')) {
    const r = await run('dotnet', ['--list-runtimes'], { timeoutMs: 20_000 });
    const seen = new Set<string>();
    for (const m of r.stdout.matchAll(/Microsoft\.NETCore\.App (\d+)\.(\d+)\.(\d+)/g)) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      out.push({ product: 'dotnet', label: '.NET', version: `${m[1]}.${m[2]}.${m[3]}` });
    }
  }
  if (await commandExists('java')) {
    const r = await run('java', ['-version'], { timeoutMs: 20_000 });
    const m = (r.stderr + r.stdout).match(/version "(\d+)(?:\.(\d+))?/);
    if (m) out.push({ product: 'java', label: 'Java (OpenJDK)', version: m[2] && m[1] === '1' ? m[2] : m[1] });
  }
  return out;
}

export function matchCycle(cycles: EolCycle[], version: string): EolCycle | undefined {
  const parts = version.split('.');
  return cycles.find((c) => c.cycle === `${parts[0]}.${parts[1]}`) ?? cycles.find((c) => c.cycle === parts[0]);
}

export async function eolReport(): Promise<EolItem[]> {
  const items: EolItem[] = [];
  try {
    const v = await windowsVersion();
    const cycle = windowsCycle(v);
    const c = (await eolCycles('windows')).find((x) => x.cycle === cycle);
    if (c) {
      items.push({
        product: `Windows ${cycle.split('-')[0]} ${v.DisplayVersion}`,
        installed: `${v.CurrentBuild}.${v.UBR}`,
        cycle,
        eol: typeof c.eol === 'string' ? c.eol : false,
        status: eolStatus(c.eol),
        latest: c.latest,
        link: 'https://endoflife.date/windows',
      });
    }
  } catch {
  }
  for (const r of await installedRuntimes()) {
    try {
      const c = matchCycle(await eolCycles(r.product), r.version);
      if (!c) continue;
      items.push({
        product: `${r.label} ${c.cycle}`,
        installed: r.version,
        cycle: c.cycle,
        eol: typeof c.eol === 'string' ? c.eol : false,
        status: eolStatus(c.eol),
        latest: c.latest,
        link: `https://endoflife.date/${r.product}`,
      });
    } catch {
    }
  }
  return items;
}


interface KevEntry {
  cveID: string;
  vendorProject: string;
  product: string;
  dateAdded: string;
  knownRansomwareCampaignUse?: string;
}

export async function kevCatalog(): Promise<KevEntry[]> {
  return cached('kev.json', DAY, async () => {
    const j = await fetchJson<{ vulnerabilities: KevEntry[] }>('https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json', {
      timeoutMs: 60_000,
    });
    return j.vulnerabilities.map(({ cveID, vendorProject, product, dateAdded, knownRansomwareCampaignUse }) => ({
      cveID,
      vendorProject,
      product,
      dateAdded,
      knownRansomwareCampaignUse,
    }));
  });
}

export function annotateExploited(items: UpdateItem[], kev: KevEntry[]): number {
  const ids = new Set(kev.map((k) => k.cveID));
  let n = 0;
  for (const i of items) {
    if (i.cves?.some((c) => ids.has(c))) {
      i.exploited = true;
      i.security = true;
      i.severity = 'critical';
      n++;
    }
  }
  return n;
}


const CPE: [RegExp, string][] = [
  [/^7-zip/i, '7-zip:7-zip'],
  [/^vlc/i, 'videolan:vlc_media_player'],
  [/firefox/i, 'mozilla:firefox'],
  [/thunderbird/i, 'mozilla:thunderbird'],
  [/google chrome/i, 'google:chrome'],
  [/notepad\+\+/i, 'notepad-plus-plus:notepad\\+\\+'],
  [/acrobat reader|adobe reader/i, 'adobe:acrobat_reader_dc'],
  [/^zoom/i, 'zoom:zoom'],
  [/winrar/i, 'rarlab:winrar'],
  [/^git( |$)/i, 'git-scm:git'],
  [/putty/i, 'putty:putty'],
  [/winscp/i, 'winscp:winscp'],
  [/keepass/i, 'keepass:keepass'],
  [/libreoffice/i, 'libreoffice:libreoffice'],
  [/^python 3/i, 'python:python'],
  [/node\.?js/i, 'nodejs:node.js'],
  [/wireshark/i, 'wireshark:wireshark'],
  [/filezilla/i, 'filezilla-project:filezilla_client'],
  [/^obs studio/i, 'obsproject:obs_studio'],
  [/visual studio code/i, 'microsoft:visual_studio_code'],
  [/teamviewer/i, 'teamviewer:teamviewer'],
  [/anydesk/i, 'anydesk:anydesk'],
  [/^openssl/i, 'openssl:openssl'],
  [/postgresql/i, 'postgresql:postgresql'],
  [/docker desktop/i, 'docker:desktop'],
];

export function cpeFor(name: string): string | undefined {
  return CPE.find(([re]) => re.test(name.trim()))?.[1];
}

let nvdBusy = false;

export async function annotateNvd(items: UpdateItem[], onUpdate: () => void): Promise<void> {
  if (nvdBusy) return;
  nvdBusy = true;
  try {
    const cache = loadJson<Record<string, { at: number; cves: string[] }>>('nvd.json', {});
    for (const i of items) {
      const cpe = cpeFor(i.name);
      const v = i.currentVersion?.replace(/^v/i, '');
      if (!cpe || !v || !/^[\w.]+$/.test(v)) continue;
      const k = `${cpe}:${v}`;
      let entry = cache[k];
      if (!entry || Date.now() - entry.at > 7 * DAY) {
        try {
          const j = await fetchJson<{ vulnerabilities: { cve: { id: string } }[] }>(
            `https://services.nvd.nist.gov/rest/json/cves/2.0?virtualMatchString=cpe:2.3:a:${cpe}:${v}&resultsPerPage=50`,
            { timeoutMs: 30_000 },
          );
          entry = { at: Date.now(), cves: j.vulnerabilities.map((x) => x.cve.id) };
          cache[k] = entry;
          saveJson('nvd.json', cache);
        } catch {
          continue;
        }
        await new Promise((r) => setTimeout(r, 6500));
      }
      if (entry.cves.length) {
        i.security = true;
        i.severity ??= 'important';
        i.cves = [...new Set([...(i.cves ?? []), ...entry.cves])].slice(0, 50);
        onUpdate();
      }
    }
  } finally {
    nvdBusy = false;
  }
}


interface RawChecks {
  defender?: { AntivirusEnabled: boolean; RealTimeProtectionEnabled: boolean; AntivirusSignatureAge: number };
  firewall: { Name: string; Enabled: boolean }[];
  bitlocker?: number;
  secureBoot?: number;
  tpm: string;
  uac?: number;
  smartScreen?: string;
}

const CHECKS_SCRIPT = String.raw`
$o = [ordered]@{}
try { $d = Get-MpComputerStatus -ErrorAction Stop; $o.defender = [pscustomobject]@{ AntivirusEnabled = $d.AntivirusEnabled; RealTimeProtectionEnabled = $d.RealTimeProtectionEnabled; AntivirusSignatureAge = $d.AntivirusSignatureAge } } catch { }
$o.firewall = @(Get-NetFirewallProfile -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{ Name = [string]$_.Name; Enabled = [bool]$_.Enabled } })
try { $o.bitlocker = [int](New-Object -ComObject Shell.Application).NameSpace($env:SystemDrive).Self.ExtendedProperty('System.Volume.BitLockerProtection') } catch { }
$sb = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\SecureBoot\State' -ErrorAction SilentlyContinue).UEFISecureBootEnabled
if ($null -ne $sb) { $o.secureBoot = [int]$sb }
$o.tpm = (tpmtool.exe getdeviceinformation 2>$null) -join "\n"
$o.uac = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -ErrorAction SilentlyContinue).EnableLUA
$o.smartScreen = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer' -ErrorAction SilentlyContinue).SmartScreenEnabled
[pscustomobject]$o | ConvertTo-Json -Depth 4 -Compress`;

export function parseTpm(text: string): { present?: boolean; version?: string } {
  const yes = /(pr.{0,2}sent|present|vorhanden)[^:\n]*:\s*(vrai|true|oui|yes|wahr|verdadero|s.)\b/i;
  const no = /(pr.{0,2}sent|present|vorhanden)[^:\n]*:\s*(faux|false|non|no|falsch)\b/i;
  const present = yes.test(text) ? true : no.test(text) ? false : undefined;
  const version = text.match(/version[^:\n]*:\s*([\d.]+)/i)?.[1];
  return { present, version };
}

export async function securityChecks(system: SystemInfo): Promise<SecurityCheck[]> {
  const r = await powershellJson<RawChecks>(CHECKS_SCRIPT, { timeoutMs: 60_000 });
  const checks: SecurityCheck[] = [];
  const d = r.defender;
  checks.push(
    d
      ? {
          id: 'defender',
          label: t('Antivirus Microsoft Defender'),
          status: d.AntivirusEnabled && d.RealTimeProtectionEnabled ? (d.AntivirusSignatureAge > 3 ? 'warn' : 'ok') : 'bad',
          value: d.AntivirusEnabled
            ? t('actif · définitions de {n} jour(s)', { n: d.AntivirusSignatureAge })
            : t('désactivé'),
          advice: d.AntivirusSignatureAge > 3 ? t('Mettez à jour les définitions (onglet Windows des mises à jour).') : undefined,
        }
      : { id: 'defender', label: t('Antivirus Microsoft Defender'), status: 'unknown', value: t('non disponible (autre antivirus ?)') },
  );
  const fw = [r.firewall].flat().filter(Boolean);
  const fwOff = fw.filter((p) => !p.Enabled).map((p) => p.Name);
  checks.push({
    id: 'firewall',
    label: t('Pare-feu Windows'),
    status: !fw.length ? 'unknown' : fwOff.length ? 'bad' : 'ok',
    value: !fw.length ? t('inconnu') : fwOff.length ? t('désactivé pour : {list}', { list: fwOff.join(', ') }) : t('actif sur tous les profils'),
  });
  const bl = r.bitlocker;
  checks.push({
    id: 'bitlocker',
    label: t('Chiffrement BitLocker du disque système'),
    status: bl === 1 || bl === 3 || bl === 5 ? 'ok' : bl === 2 ? 'warn' : 'unknown',
    value: bl === 1 ? t('actif') : bl === 3 ? t('chiffrement en cours') : bl === 5 ? t('suspendu') : bl === 2 ? t('désactivé') : t('non disponible'),
    advice: bl === 2 ? t('Sans chiffrement, les données sont lisibles si le PC est volé.') : undefined,
  });
  checks.push({
    id: 'secureboot',
    label: t('Démarrage sécurisé (Secure Boot)'),
    status: r.secureBoot === 1 ? 'ok' : r.secureBoot === 0 ? 'warn' : 'unknown',
    value: r.secureBoot === 1 ? t('activé') : r.secureBoot === 0 ? t('désactivé') : t('inconnu (BIOS hérité ?)'),
    advice: r.secureBoot === 0 ? t('Activable dans les réglages UEFI/BIOS ; protège contre les rootkits de démarrage.') : undefined,
  });
  const tpm = parseTpm(r.tpm ?? '');
  checks.push({
    id: 'tpm',
    label: 'TPM',
    status: tpm.present ? (tpm.version?.startsWith('2') ? 'ok' : 'warn') : tpm.present === false ? 'bad' : 'unknown',
    value: tpm.present ? t('présent · version {v}', { v: tpm.version ?? '?' }) : tpm.present === false ? t('absent') : t('inconnu'),
  });
  checks.push({
    id: 'uac',
    label: t('Contrôle de compte d’utilisateur (UAC)'),
    status: r.uac === 0 ? 'bad' : r.uac === 1 ? 'ok' : 'unknown',
    value: r.uac === 0 ? t('désactivé') : r.uac === 1 ? t('actif') : t('inconnu'),
  });
  checks.push({
    id: 'smartscreen',
    label: 'SmartScreen',
    status: /off/i.test(r.smartScreen ?? '') ? 'warn' : 'ok',
    value: /off/i.test(r.smartScreen ?? '') ? t('désactivé') : t('actif'),
  });
  checks.push({ id: 'bios', label: 'BIOS', status: 'ok', value: `${system.biosVersion}${system.biosDate ? ` (${system.biosDate})` : ''}` });
  return checks;
}

