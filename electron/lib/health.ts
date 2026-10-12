import { powershellJson } from './exec';
import { t } from '../../shared/i18n';
import type { ProblemDevice, SecurityCheck } from '../../shared/types';

/**
 * Indicateurs de santé lisibles sans droits administrateur. Les compteurs SMART (usure, température) et la sonde
 * thermique ACPI exigent souvent l'administrateur : ils sont lus quand c'est possible, ignorés sinon.
 */
const HEALTH_SCRIPT = String.raw`
$since = (Get-Date).AddDays(-30)
function Count-Events($filter) { try { @(Get-WinEvent -FilterHashtable $filter -MaxEvents 500 -ErrorAction Stop).Count } catch { 0 } }
$disks = @(Get-PhysicalDisk -ErrorAction SilentlyContinue | ForEach-Object {
  $r = try { $_ | Get-StorageReliabilityCounter -ErrorAction Stop } catch { $null }
  [pscustomobject]@{
    name = $_.FriendlyName; health = [string]$_.HealthStatus; op = ($_.OperationalStatus -join ', ')
    temp = if ($r) { $r.Temperature } else { $null }; wear = if ($r) { $r.Wear } else { $null }
    readErrors = if ($r) { $r.ReadErrorsUncorrected } else { $null }; hours = if ($r) { $r.PowerOnHours } else { $null }
  }
})
$predict = @(Get-CimInstance -Namespace root\wmi -ClassName MSStorageDriver_FailurePredictStatus -ErrorAction SilentlyContinue | Where-Object { $_.PredictFailure }).Count
$cycles = (Get-CimInstance -Namespace root\wmi -ClassName BatteryCycleCount -ErrorAction SilentlyContinue | Select-Object -First 1).CycleCount
$temps = @(Get-CimInstance -Namespace root\wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue | ForEach-Object { [math]::Round($_.CurrentTemperature / 10 - 273.15) } | Where-Object { $_ -gt 0 -and $_ -lt 130 })
$problems = @(Get-CimInstance Win32_PnPEntity -Filter 'ConfigManagerErrorCode <> 0' -ErrorAction SilentlyContinue | Where-Object { $_.ConfigManagerErrorCode -notin 22, 45 } | ForEach-Object {
  [pscustomobject]@{ name = if ($_.Name) { $_.Name } else { $_.DeviceID }; className = $_.PNPClass; code = [int]$_.ConfigManagerErrorCode }
})
$mem = try { Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-MemoryDiagnostics-Results' } -MaxEvents 1 -ErrorAction Stop } catch { $null }
[pscustomobject]@{
  disks = $disks; predictFailure = $predict; cycles = $cycles; temps = $temps; problems = $problems
  whea = Count-Events @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-WHEA-Logger'; StartTime = $since }
  wheaFatal = Count-Events @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-WHEA-Logger'; Level = 1, 2; StartTime = $since }
  diskErrors = Count-Events @{ LogName = 'System'; ProviderName = 'disk', 'Ntfs', 'stornvme', 'storahci'; Id = 7, 11, 51, 55, 129, 153; StartTime = $since }
  unexpected = Count-Events @{ LogName = 'System'; ProviderName = 'Microsoft-Windows-Kernel-Power'; Id = 41; StartTime = $since }
  memoryTest = if ($mem) { [pscustomobject]@{ id = $mem.Id; date = $mem.TimeCreated.ToString('yyyy-MM-dd') } } else { $null }
} | ConvertTo-Json -Depth 4 -Compress`;

export interface RawHealth {
  disks: RawDisk[] | RawDisk;
  predictFailure: number;
  cycles?: number | null;
  temps: number[] | number;
  problems: ProblemDevice[] | ProblemDevice;
  whea: number;
  wheaFatal: number;
  diskErrors: number;
  unexpected: number;
  memoryTest?: { id: number; date: string } | null;
}

interface RawDisk {
  name: string;
  health: string;
  op: string;
  temp?: number | null;
  wear?: number | null;
  readErrors?: number | null;
  hours?: number | null;
}

/** Libellés des codes d'erreur du Gestionnaire de périphériques les plus courants. */
export const DEVICE_ERRORS: Record<number, string> = {
  1: 'mal configuré',
  3: 'pilote endommagé ou mémoire insuffisante',
  10: 'ne peut pas démarrer',
  12: 'ressources insuffisantes',
  14: 'redémarrage nécessaire',
  18: 'pilotes à réinstaller',
  19: 'configuration du registre endommagée',
  21: 'en cours de suppression',
  24: 'absent ou mal installé',
  28: 'pilote non installé',
  29: 'désactivé par le firmware',
  31: 'ne fonctionne pas correctement',
  32: 'service du pilote désactivé',
  37: 'échec d’initialisation du pilote',
  39: 'pilote endommagé ou manquant',
  43: 'arrêté : le périphérique a signalé un problème',
  48: 'pilote bloqué (incompatibilité connue)',
  52: 'signature du pilote invalide',
};

export function deviceErrorLabel(code: number): string {
  return DEVICE_ERRORS[code] ? t(DEVICE_ERRORS[code]) : t('erreur (code {n})', { n: code });
}

export function healthChecks(raw: RawHealth, battery?: { health?: number }): SecurityCheck[] {
  const checks: SecurityCheck[] = [];
  for (const d of [raw.disks].flat().filter(Boolean)) {
    const bad = /unhealthy|défectueux|fehlerhaft/i.test(d.health) || (d.readErrors ?? 0) > 0;
    const warn = /warning|avertissement|warnung/i.test(d.health) || (d.wear ?? 0) >= 80 || (d.temp ?? 0) >= 65;
    const parts = [d.health && !/^healthy$/i.test(d.health) ? d.health : t('en bonne santé')];
    if (d.wear !== null && d.wear !== undefined) parts.push(t('usure {n} %', { n: d.wear }));
    if (d.temp) parts.push(`${d.temp} °C`);
    if (d.hours) parts.push(t('{n} h de fonctionnement', { n: d.hours }));
    if (d.readErrors) parts.push(t('{n} erreur(s) de lecture non corrigée(s)', { n: d.readErrors }));
    checks.push({
      id: `disk:${d.name}`,
      label: t('Disque {name}', { name: d.name }),
      status: bad ? 'bad' : warn ? 'warn' : /^healthy$/i.test(d.health) ? 'ok' : 'unknown',
      value: parts.join(' · '),
      advice: bad ? t('Sauvegardez vos données sans attendre : le disque signale des erreurs.') : (d.wear ?? 0) >= 80 ? t('Le SSD approche de sa fin de vie théorique.') : undefined,
    });
  }
  if (raw.predictFailure > 0) {
    checks.push({
      id: 'smart',
      label: 'SMART',
      status: 'bad',
      value: t('{n} disque(s) annoncent une panne prochaine', { n: raw.predictFailure }),
      advice: t('Sauvegardez vos données sans attendre : le disque signale des erreurs.'),
    });
  }
  checks.push({
    id: 'disk-events',
    label: t('Erreurs de disque (30 jours)'),
    status: raw.diskErrors > 10 ? 'bad' : raw.diskErrors > 0 ? 'warn' : 'ok',
    value: raw.diskErrors ? t('{n} erreur(s) dans le journal système', { n: raw.diskErrors }) : t('aucune'),
    advice: raw.diskErrors ? t('Secteurs défectueux, câble ou contrôleur : lancez une vérification du disque.') : undefined,
  });
  checks.push({
    id: 'whea',
    label: t('Erreurs matérielles WHEA (30 jours)'),
    status: raw.wheaFatal ? 'bad' : raw.whea > 20 ? 'warn' : 'ok',
    value: raw.whea ? t('{n} erreur(s) dont {f} grave(s)', { n: raw.whea, f: raw.wheaFatal }) : t('aucune'),
    advice: raw.wheaFatal
      ? t('Processeur, mémoire ou bus PCIe signalent des erreurs : vérifiez la mémoire et la température, et mettez à jour le BIOS.')
      : raw.whea > 20
        ? t('Erreurs corrigées fréquentes : souvent un périphérique PCIe ou un réglage d’économie d’énergie.')
        : undefined,
  });
  checks.push({
    id: 'shutdowns',
    label: t('Arrêts inattendus (30 jours)'),
    status: raw.unexpected > 3 ? 'warn' : 'ok',
    value: raw.unexpected ? t('{n} arrêt(s) brutal(aux)', { n: raw.unexpected }) : t('aucun'),
    advice: raw.unexpected > 3 ? t('Coupures de courant, surchauffe ou alimentation défaillante.') : undefined,
  });
  const mt = raw.memoryTest;
  checks.push({
    id: 'memory',
    label: t('Mémoire vive'),
    status: !mt ? 'unknown' : mt.id === 1102 || mt.id === 1202 ? 'bad' : 'ok',
    value: !mt
      ? t('jamais testée')
      : mt.id === 1102 || mt.id === 1202
        ? t('erreurs détectées le {date}', { date: mt.date })
        : t('aucune erreur au dernier test ({date})', { date: mt.date }),
    advice: mt && (mt.id === 1102 || mt.id === 1202) ? t('Une barrette est probablement défectueuse.') : undefined,
  });
  const temps = [raw.temps].flat().filter((x): x is number => typeof x === 'number');
  if (temps.length) {
    const max = Math.max(...temps);
    checks.push({
      id: 'temperature',
      label: t('Température (zone thermique ACPI)'),
      status: max >= 90 ? 'bad' : max >= 80 ? 'warn' : 'ok',
      value: `${max} °C`,
      advice: max >= 80 ? t('Nettoyez les grilles d’aération et vérifiez les ventilateurs.') : undefined,
    });
  }
  if (battery?.health !== undefined || raw.cycles) {
    const h = battery?.health;
    checks.push({
      id: 'battery',
      label: t('Batterie'),
      status: h === undefined ? 'unknown' : h < 50 ? 'bad' : h < 75 ? 'warn' : 'ok',
      value: [h !== undefined ? t('{n} % de la capacité d’origine', { n: h }) : null, raw.cycles ? t('{n} cycle(s)', { n: raw.cycles }) : null].filter(Boolean).join(' · '),
      advice: h !== undefined && h < 50 ? t('Autonomie fortement réduite : la batterie est à remplacer.') : undefined,
    });
  }
  const problems = problemDevices(raw);
  checks.push({
    id: 'devices',
    label: t('Périphériques'),
    status: problems.some((p) => [10, 31, 39, 43, 52].includes(p.code)) ? 'bad' : problems.length ? 'warn' : 'ok',
    value: problems.length ? t('{n} périphérique(s) en erreur', { n: problems.length }) : t('tous fonctionnent'),
  });
  return checks;
}

export function readHealth(): Promise<RawHealth> {
  return powershellJson<RawHealth>(HEALTH_SCRIPT, { timeoutMs: 120_000 });
}

export function problemDevices(raw: RawHealth): ProblemDevice[] {
  return [raw.problems].flat().filter(Boolean);
}
