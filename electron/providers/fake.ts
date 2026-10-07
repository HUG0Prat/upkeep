import { makeKey, type Provider } from './types';
import { t } from '../../shared/i18n';
import type { EolItem, SecurityCheck, SystemInfo, UpdateItem, UpdateKind } from '../../shared/types';

const now = Date.now();
const day = 86_400_000;

function item(providerId: string, kind: UpdateKind, id: string, name: string, cur: string, next: string, extra: Partial<UpdateItem> = {}): UpdateItem {
  return {
    key: makeKey(providerId, id),
    providerId,
    kind,
    id,
    name,
    currentVersion: cur,
    availableVersion: next,
    source: providerId,
    publishedAt: now - 10 * day,
    supportsVersions: kind === 'package',
    ...extra,
  };
}

const state: Record<string, UpdateItem[]> = {
  'fake-pkg': [
    item('fake-pkg', 'package', 'Mozilla.Firefox', 'Mozilla Firefox', '156.0', '157.0.1', { security: true, severity: 'important', publisher: 'Mozilla' }),
    item('fake-pkg', 'package', 'Git.Git', 'Git', '2.50.0', '2.51.1', { publisher: 'The Git Development Community' }),
    item('fake-pkg', 'package', 'Microsoft.PowerToys', 'PowerToys', '0.95.0', '0.96.0-preview', { preview: true }),
    item('fake-pkg', 'package', 'VideoLAN.VLC', 'VLC media player', '3.0.20', '3.0.21', { publishedAt: now - day }),
  ],
  'fake-drv': [
    item('fake-drv', 'driver', 'intel-wifi', 'Intel - net - 23.120.0.3', '23.60.1.2', '23.120.0.3', { requiresAdmin: true, currentDate: '2024-03-01', availableDate: '2026-05-10' }),
    item('fake-drv', 'driver', 'razer', 'Razer Inc - HIDClass - 6.2.9200.16547', '', '6.2.9200.16547', { requiresAdmin: true, deviceAbsent: true }),
  ],
  'fake-fw': [item('fake-fw', 'firmware', 'bios', 'BIOS Update', 'CTS1.20', 'CTS1.32', { requiresAdmin: true, requiresReboot: true, severity: 'critical' })],
  'fake-sys': [item('fake-sys', 'system', 'kb1', '2026-10 Cumulative Update for Windows 11 (KB5099999)', '', 'KB5099999', { requiresAdmin: true, requiresReboot: true, security: true, cves: ['CVE-2026-1234'] })],
};

const DETAILS: Record<string, () => string> = {
  'intel-wifi': () => t('Pour : {name}', { name: 'Intel(R) Wi-Fi 6 AX203' }),
  razer: () => t('Périphérique absent : {name}', { name: 'Razer Viper Mini' }),
};

function fake(id: string, name: string, kind: UpdateKind, group: Provider['group']): Provider {
  return {
    id,
    name,
    kind,
    group,
    description: `Source factice (${name})`,
    detect: async () => true,
    async check(ctx) {
      ctx.trace('fake', JSON.stringify(state[id], null, 1));
      await new Promise((r) => setTimeout(r, 300));
      return state[id].map((i) => (DETAILS[i.id] ? { ...i, details: DETAILS[i.id]() } : i));
    },
    async install(items, ctx) {
      for (const [i, it] of items.entries()) {
        ctx.log(`Installation de ${it.name} ${it.targetVersion ?? it.availableVersion}…`);
        for (let p = 0; p <= 100; p += 25) {
          ctx.log(`  ${p}%`);
          ctx.progress(Math.round(((i + p / 100) / items.length) * 100));
          await new Promise((r) => setTimeout(r, 120));
        }
        state[id] = state[id].filter((x) => x.key !== it.key);
      }
      return { success: true, rebootRequired: items.some((i) => i.requiresReboot) };
    },
    async listVersions(it) {
      return [it.availableVersion ?? '1.0', it.currentVersion ?? '0.9', '0.8'];
    },
    async details(it) {
      return { description: `Description de ${it.name}`, publisher: it.publisher, homepage: 'https://example.org', license: 'MIT' };
    },
    download: async (_items, ctx) => {
      ctx.log('Téléchargé (factice).');
      return { success: true };
    },
  };
}

export const fakeProviders: Provider[] = [
  fake('fake-pkg', 'Paquets (démo)', 'package', 'Paquets'),
  fake('fake-sys', 'Windows (démo)', 'system', 'Windows'),
  fake('fake-drv', 'Pilotes (démo)', 'driver', 'Pilotes & firmware'),
  fake('fake-fw', 'Firmware (démo)', 'firmware', 'Pilotes & firmware'),
];

export const FAKE_SYSTEM: Partial<SystemInfo> = {
  manufacturer: 'Contoso',
  model: 'Laptop 15',
  biosVersion: 'CTS1.20',
  biosDate: '2025-11-04',
  os: 'Microsoft Windows 11 Pro 10.0.26200',
};

export function fakeSecurityChecks(): SecurityCheck[] {
  return [
    { id: 'defender', label: t('Antivirus Microsoft Defender'), status: 'ok', value: t('actif · définitions de {n} jour(s)', { n: 1 }) },
    { id: 'firewall', label: t('Pare-feu Windows'), status: 'ok', value: t('actif sur tous les profils') },
    { id: 'bitlocker', label: t('Chiffrement BitLocker du disque système'), status: 'ok', value: t('actif') },
    { id: 'secureboot', label: t('Démarrage sécurisé (Secure Boot)'), status: 'ok', value: t('actif') },
    { id: 'tpm', label: 'TPM', status: 'ok', value: t('présent · version {v}', { v: '2.0' }) },
    { id: 'uac', label: t('Contrôle de compte d’utilisateur (UAC)'), status: 'ok', value: t('actif') },
    { id: 'smartscreen', label: 'SmartScreen', status: 'ok', value: t('actif') },
  ];
}

export function fakeEol(): EolItem[] {
  return [
    { product: 'Windows 11 25H2', installed: '26200', cycle: '25H2', eol: '2027-10-12', status: 'ok', latest: '10.0.26200', link: 'https://endoflife.date/windows' },
    { product: 'Node.js 22', installed: '22.20.0', cycle: '22', eol: '2027-04-30', status: 'ok', latest: '22.21.0', link: 'https://endoflife.date/nodejs' },
    { product: 'Python 3.9', installed: '3.9.13', cycle: '3.9', eol: '2025-10-31', status: 'eol', latest: '3.9.25', link: 'https://endoflife.date/python' },
  ];
}
