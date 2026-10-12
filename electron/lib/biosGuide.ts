import { powershellJson } from './exec';
import { t } from '../../shared/i18n';
import type { BiosFeature, BiosGuide } from '../../shared/types';

export interface FirmwareInfo {
  manufacturer: string;
  model: string;
  family?: string;
  boardVendor?: string;
  biosVendor?: string;
  biosVersion?: string;
  biosDate?: string;
  firmwareType: 'UEFI' | 'Legacy' | 'unknown';
  cpuVendor: 'intel' | 'amd' | 'other';
  bitlockerOn: boolean;
}

const FIRMWARE_SCRIPT = String.raw`
$cs = Get-CimInstance Win32_ComputerSystem
$bios = Get-CimInstance Win32_BIOS
$bb = Get-CimInstance Win32_BaseBoard -ErrorAction SilentlyContinue
$csp = Get-CimInstance Win32_ComputerSystemProduct -ErrorAction SilentlyContinue
$cpu = (Get-CimInstance Win32_Processor | Select-Object -First 1).Manufacturer
$bl = try { [int](New-Object -ComObject Shell.Application).NameSpace($env:SystemDrive).Self.ExtendedProperty('System.Volume.BitLockerProtection') } catch { 0 }
[pscustomobject]@{
  manufacturer = $cs.Manufacturer; model = $cs.Model; family = if ($csp.Version -and $csp.Version -notmatch '^\s*$|none|to be filled') { $csp.Version } else { $cs.SystemFamily }
  boardVendor = $bb.Manufacturer; biosVendor = $bios.Manufacturer; biosVersion = $bios.SMBIOSBIOSVersion
  biosDate = if ($bios.ReleaseDate) { $bios.ReleaseDate.ToString('yyyy-MM-dd') } else { $null }
  firmwareType = [string]$env:firmware_type; cpu = [string]$cpu; bitlocker = $bl
} | ConvertTo-Json -Compress`;

export async function readFirmwareInfo(): Promise<FirmwareInfo> {
  const r = await powershellJson<{
    manufacturer: string;
    model: string;
    family?: string;
    boardVendor?: string;
    biosVendor?: string;
    biosVersion?: string;
    biosDate?: string;
    firmwareType: string;
    cpu: string;
    bitlocker: number;
  }>(FIRMWARE_SCRIPT, { timeoutMs: 60_000 });
  return {
    manufacturer: r.manufacturer?.trim() ?? '',
    model: r.model?.trim() ?? '',
    family: r.family?.trim() || undefined,
    boardVendor: r.boardVendor?.trim() || undefined,
    biosVendor: r.biosVendor?.trim() || undefined,
    biosVersion: r.biosVersion?.trim() || undefined,
    biosDate: r.biosDate ?? undefined,
    firmwareType: /uefi/i.test(r.firmwareType) ? 'UEFI' : /legacy/i.test(r.firmwareType) ? 'Legacy' : 'unknown',
    cpuVendor: /intel/i.test(r.cpu) ? 'intel' : /amd/i.test(r.cpu) ? 'amd' : 'other',
    bitlockerOn: r.bitlocker === 1 || r.bitlocker === 3,
  };
}

interface Procedure {
  entry: string;
  secureboot: string[];
  tpm: (cpu: FirmwareInfo['cpuVendor']) => string[];
  virtualization: (cpu: FirmwareInfo['cpuVendor']) => string[];
  notes?: string[];
}

const ptt = (cpu: FirmwareInfo['cpuVendor'], intel: string, amd: string) => (cpu === 'amd' ? amd : intel);
const vt = (cpu: FirmwareInfo['cpuVendor'], intel: string, amd: string) => (cpu === 'amd' ? amd : intel);

/** Chemins de menus les plus courants par constructeur ; les libellés des menus restent en anglais comme dans les BIOS. */
const PROCEDURES: { match: (f: FirmwareInfo) => boolean; name: string; proc: Procedure }[] = [
  {
    name: 'Lenovo ThinkPad / ThinkCentre',
    match: (f) => /lenovo/i.test(f.manufacturer) && /think/i.test(`${f.family} ${f.model}`),
    proc: {
      entry: 'F1 (ThinkPad : Entrée puis F1)',
      secureboot: ['Security › Secure Boot', 'Secure Boot : On'],
      tpm: () => ['Security › Security Chip', 'Security Chip : Enabled (Discrete TPM ou Firmware TPM)'],
      virtualization: (c) => ['Security › Virtualization', vt(c, 'Intel Virtualization Technology : On', 'AMD V(TM) Technology : On')],
    },
  },
  {
    name: 'Lenovo IdeaPad / Yoga / Legion / LOQ',
    match: (f) => /lenovo/i.test(f.manufacturer),
    proc: {
      entry: 'F2 (ou Fn+F2, ou le bouton Novo puis « BIOS Setup »)',
      secureboot: ['Security › Secure Boot', 'Secure Boot : Enabled'],
      tpm: (c) => ['Security', ptt(c, 'Intel Platform Trust Technology : Enabled', 'AMD Platform Security Processor : Enabled')],
      virtualization: (c) => ['Configuration', vt(c, 'Intel Virtual Technology : Enabled', 'AMD SVM Technology : Enabled')],
    },
  },
  {
    name: 'Dell',
    match: (f) => /dell/i.test(f.manufacturer),
    proc: {
      entry: 'F2 (F12 ouvre le menu de démarrage unique)',
      secureboot: ['Boot Configuration (ancien BIOS : Secure Boot › Secure Boot Enable)', 'Enable Secure Boot : On', 'Secure Boot Mode : Deployed Mode'],
      tpm: () => ['Security › TPM 2.0 Security', 'TPM On : coché', 'Activate (ou Enabled)'],
      virtualization: (c) => ['Virtualization Support (ou Virtualization)', vt(c, 'Enable Intel Virtualization Technology : On', 'AMD Virtualization : On')],
    },
  },
  {
    name: 'HP',
    match: (f) => /hp|hewlett/i.test(f.manufacturer),
    proc: {
      entry: 'Échap puis F10 (appuyez plusieurs fois dès l’allumage)',
      secureboot: ['Advanced › Secure Boot Configuration (gamme grand public : System Configuration › Boot Options)', 'Configure Legacy Support and Secure Boot : Legacy Support Disable and Secure Boot Enable'],
      tpm: () => ['Security › TPM Embedded Security', 'TPM Device : Available', 'TPM State : Enable'],
      virtualization: () => ['Advanced › System Options (gamme grand public : System Configuration)', 'Virtualization Technology (VTx) : coché / Enabled'],
    },
  },
  {
    name: 'ASUS',
    match: (f) => /asus/i.test(`${f.manufacturer} ${f.boardVendor}`),
    proc: {
      entry: 'F2 (portables) ou Suppr (cartes mères), puis F7 pour le mode avancé',
      secureboot: ['Boot › Secure Boot (portables : Security › Secure Boot Control)', 'OS Type : Windows UEFI mode (portables : Secure Boot Control : Enabled)'],
      tpm: (c) => [ptt(c, 'Advanced › PCH-FW Configuration', 'Advanced › AMD fTPM configuration'), ptt(c, 'PTT : Enable', 'Firmware TPM : Enable')],
      virtualization: (c) => [vt(c, 'Advanced › CPU Configuration', 'Advanced › CPU Configuration'), vt(c, 'Intel (VMX) Virtualization Technology : Enabled', 'SVM Mode : Enabled')],
    },
  },
  {
    name: 'MSI',
    match: (f) => /micro-star|msi/i.test(`${f.manufacturer} ${f.boardVendor}`),
    proc: {
      entry: 'Suppr (portables : Suppr ou F2), puis F7 pour le mode avancé',
      secureboot: ['Settings › Advanced › Windows OS Configuration', 'BIOS UEFI/CSM Mode : UEFI', 'Secure Boot › Secure Boot : Enabled'],
      tpm: (c) => ['Settings › Security › Trusted Computing', 'Security Device Support : Enable', ptt(c, 'TPM Device Selection : PTT', 'AMD fTPM switch : AMD CPU fTPM')],
      virtualization: (c) => ['OC › CPU Features', vt(c, 'Intel Virtualization Tech : Enabled', 'SVM Mode : Enabled')],
    },
  },
  {
    name: 'Gigabyte / Aorus',
    match: (f) => /gigabyte|aorus/i.test(`${f.manufacturer} ${f.boardVendor}`),
    proc: {
      entry: 'Suppr, puis F2 pour le mode avancé',
      secureboot: ['Boot › CSM Support : Disabled', 'Boot › Secure Boot : Enabled'],
      tpm: (c) => ['Settings › Miscellaneous', ptt(c, 'Intel Platform Trust Technology (PTT) : Enabled', 'AMD CPU fTPM : Enabled')],
      virtualization: (c) => [vt(c, 'Tweaker › Advanced CPU Settings', 'Tweaker › Advanced CPU Settings'), vt(c, 'Intel Virtualization Technology : Enabled', 'SVM Mode : Enabled')],
    },
  },
  {
    name: 'ASRock',
    match: (f) => /asrock/i.test(`${f.manufacturer} ${f.boardVendor}`),
    proc: {
      entry: 'F2 ou Suppr',
      secureboot: ['Boot › CSM : Disabled', 'Security › Secure Boot : Enabled'],
      tpm: (c) => ['Security', ptt(c, 'Intel Platform Trust Technology : Enabled', 'AMD fTPM switch : AMD CPU fTPM')],
      virtualization: (c) => ['Advanced › CPU Configuration', vt(c, 'Intel Virtualization Technology : Enabled', 'SVM Mode : Enabled')],
    },
  },
  {
    name: 'Acer',
    match: (f) => /acer/i.test(f.manufacturer),
    proc: {
      entry: 'F2',
      secureboot: ['Security › Set Supervisor Password (souvent exigé avant de modifier Secure Boot)', 'Boot › Secure Boot : Enabled'],
      tpm: () => ['Security (ou Advanced) › TPM', 'TPM : Enabled'],
      virtualization: () => ['Advanced (ou Main)', 'Intel VTX / AMD-V : Enabled'],
      notes: ['Le mot de passe superviseur peut être supprimé une fois le réglage fait (laissez le champ vide).'],
    },
  },
  {
    name: 'Microsoft Surface',
    match: (f) => /microsoft/i.test(f.manufacturer) && /surface/i.test(f.model),
    proc: {
      entry: 'Éteignez, maintenez Volume + puis appuyez sur le bouton d’alimentation ; relâchez Volume + au logo',
      secureboot: ['Security › Secure Boot', 'Microsoft Only'],
      tpm: () => ['Security', 'TPM : activé (toujours présent sur Surface)'],
      virtualization: () => ['Toujours activée sur Surface : aucun réglage nécessaire'],
    },
  },
];

const GENERIC: Procedure = {
  entry: 'Suppr, F2, F10 ou Échap selon le modèle (le message s’affiche brièvement au logo)',
  secureboot: ['Onglet Boot ou Security', 'CSM / Legacy Support : Disabled', 'Secure Boot : Enabled (mode Standard)'],
  tpm: (c) => ['Onglet Security ou Advanced', ptt(c, 'Intel PTT (Platform Trust Technology) : Enabled', 'AMD fTPM / PSP : Enabled')],
  virtualization: (c) => ['Onglet Advanced › CPU Configuration', vt(c, 'Intel Virtualization Technology (VT-x) : Enabled', 'SVM Mode : Enabled')],
};

const FEATURE_NAME: Record<BiosFeature, string> = {
  secureboot: 'Secure Boot',
  tpm: 'TPM',
  virtualization: 'virtualisation',
};

export function buildBiosGuide(f: FirmwareInfo, feature: BiosFeature): BiosGuide {
  const found = PROCEDURES.find((p) => p.match(f));
  const proc = found?.proc ?? GENERIC;
  const menu = feature === 'secureboot' ? proc.secureboot : feature === 'tpm' ? proc.tpm(f.cpuVendor) : proc.virtualization(f.cpuVendor);
  const uefi = f.firmwareType === 'UEFI';
  const steps = [
    uefi ? t('Cliquez sur « Redémarrer vers le BIOS » : le PC redémarre directement dans les réglages UEFI.') : t('Redémarrez le PC et appuyez sur {key} dès l’allumage.', { key: t(proc.entry) }),
    ...menu.map((m) => t(m)),
    t('Enregistrez et quittez (généralement F10, puis « Yes »). Windows redémarre normalement.'),
    t('Revenez dans UpKeep › Sécurité et cliquez sur Actualiser pour vérifier.'),
  ];
  const warnings: string[] = [];
  if (f.bitlockerOn) warnings.push(t('BitLocker est actif : modifier ces réglages peut déclencher une demande de clé de récupération. UpKeep suspend BitLocker pour ce redémarrage ; gardez quand même la clé à portée (compte Microsoft › Appareils).'));
  if (feature === 'secureboot' && !uefi) {
    warnings.push(t('Windows démarre en mode hérité (Legacy/CSM) : activer Secure Boot ou désactiver CSM l’empêcherait de démarrer. Il faut d’abord convertir le disque en GPT (outil mbr2gpt de Microsoft).'));
  }
  if (feature === 'tpm') warnings.push(t('Activer un TPM est sans risque ; ne choisissez jamais « Clear TPM » ou « Reset » : cela efface les clés BitLocker et Windows Hello.'));
  for (const n of proc.notes ?? []) warnings.push(t(n));
  warnings.push(t('Les menus varient selon la version du BIOS : si un intitulé diffère, cherchez un nom proche ou consultez la documentation du constructeur.'));
  const who = [f.manufacturer, f.family && !f.model.includes(f.family) ? f.family : '', f.model].filter(Boolean).join(' ');
  return {
    feature,
    machine: found ? `${who} (${found.name})` : who,
    bios: [f.biosVendor, f.biosVersion, f.biosDate && `(${f.biosDate})`].filter(Boolean).join(' '),
    firmwareType: f.firmwareType,
    entry: t(proc.entry),
    steps,
    warnings,
    docsUrl: `https://www.bing.com/search?q=${encodeURIComponent(`${who} BIOS enable ${FEATURE_NAME[feature]}`)}`,
    canRebootToFirmware: uefi,
    bitlockerOn: f.bitlockerOn,
  };
}
