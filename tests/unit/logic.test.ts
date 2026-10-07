import { describe, expect, it } from 'vitest';
import { compareVersions, isNewer, isPreviewVersion, majorOf } from '../../shared/versions';
import { globToRegex, ruleActions } from '../../shared/rules';
import { explainError, isNetworkError } from '../../shared/errorCodes';
import { effectiveSettings, filterUpdates, inTimeWindow, installOrder, mergeDuplicates, migrateSettings, normalizeName, parseProgress } from '../../shared/logic';
import { DEFAULT_SETTINGS, type UpdateItem } from '../../shared/types';

const item = (p: Partial<UpdateItem>): UpdateItem => ({ key: `${p.providerId ?? 'winget'}:${p.id ?? 'x'}`, providerId: 'winget', kind: 'package', id: 'x', name: 'X', ...p });

describe('versions', () => {
  it('compare numériquement', () => {
    expect(compareVersions('1.10', '1.9')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0', '2.0.0-beta.1')).toBeGreaterThan(0);
    expect(compareVersions('v1.2.0', '1.2')).toBe(0);
    expect(compareVersions('23.120.0.3', '23.60.1.2')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-rc.2', '1.0.0-rc.10')).toBeLessThan(0);
    expect(Number.isNaN(compareVersions('Unknown', '1.0'))).toBe(true);
  });
  it('isNewer reste permissif quand on ne sait pas comparer', () => {
    expect(isNewer('3.0.1', '2.7.13.0')).toBe(true);
    expect(isNewer('1.0', '1.0.0')).toBe(false);
    expect(isNewer('abc', 'def')).toBe(true);
  });
  it('détecte les préversions et la version majeure', () => {
    expect(isPreviewVersion('0.96.0-preview')).toBe(true);
    expect(isPreviewVersion('1.2.3')).toBe(false);
    expect(majorOf('v14.1.0')).toBe('14');
  });
});

describe('règles', () => {
  it('joker', () => {
    expect(globToRegex('*.Preview').test('Microsoft.PowerToys.Preview')).toBe(true);
    expect(globToRegex('Micro?oft.*').test('Microsoft.Edge')).toBe(true);
    expect(globToRegex('chrome').test('Google Chrome')).toBe(false);
  });
  it('actions cumulées', () => {
    const rules = [
      { id: '1', pattern: '*chrome*', field: 'name' as const, action: 'ignore' as const, enabled: true },
      { id: '2', pattern: 'winget', field: 'source' as const, action: 'silent' as const, enabled: true },
      { id: '3', pattern: '*', field: 'any' as const, action: 'auto' as const, enabled: false },
    ];
    const a = ruleActions(rules, item({ name: 'Google Chrome', source: 'winget' }));
    expect([...a].sort()).toEqual(['ignore', 'silent']);
  });
});

describe('codes d’erreur', () => {
  it('reconnaît les codes hexadécimaux et décimaux', () => {
    expect(explainError(['Échec : 0x8A150101'])).toMatch(/en cours d’utilisation/);
    expect(explainError(['exit code: -1978334975'])).toMatch(/0x8A150101/);
    expect(explainError(['code de sortie : 1618'])).toMatch(/MSI/);
    expect(explainError(['tout va bien'])).toBeUndefined();
  });
  it('erreurs réseau', () => {
    expect(isNetworkError('HRESULT 0x80072EE7')).toBe(true);
    expect(isNetworkError('accès refusé')).toBe(false);
  });
});

describe('fusion des doublons', () => {
  it('garde la source prioritaire et note les autres', () => {
    const out = mergeDuplicates(
      [
        item({ providerId: 'browsers', id: 'firefox', key: 'browsers:firefox', name: 'Mozilla Firefox', availableVersion: '157.0.1' }),
        item({ providerId: 'winget', id: 'Mozilla.Firefox', key: 'winget:Mozilla.Firefox', name: 'Mozilla Firefox (x64 fr)', availableVersion: '157.0.1' }),
        item({ providerId: 'winget', id: 'Git.Git', key: 'winget:Git.Git', name: 'Git', availableVersion: '2.51.1' }),
      ],
      ['winget', 'browsers'],
      (id) => id.toUpperCase(),
    );
    expect(out).toHaveLength(2);
    const ff = out.find((o) => o.name.startsWith('Mozilla'))!;
    expect(ff.providerId).toBe('winget');
    expect(ff.alsoVia).toEqual(['BROWSERS']);
  });
  it('normalise les noms', () => {
    expect(normalizeName('Mozilla Firefox (x64 fr)')).toBe('mozilla firefox');
  });
});

describe('filtres', () => {
  const now = Date.parse('2026-10-07T12:00:00Z');
  const ctx = { now, pendingRebootKeys: new Set<string>() };
  it('ignorés, quarantaine, absents, pilotes plus anciens, épinglage', () => {
    const s = { ...DEFAULT_SETTINGS, ignored: { 'winget:ign': '*' }, pins: { 'winget:pin': '2' } };
    const r = filterUpdates(
      [
        item({ id: 'ign', key: 'winget:ign' }),
        item({ id: 'new', key: 'winget:new', publishedAt: now - 86_400_000, currentVersion: '1', availableVersion: '2' }),
        item({ id: 'old', key: 'winget:old', publishedAt: now - 10 * 86_400_000, currentVersion: '1', availableVersion: '2' }),
        item({ id: 'sec', key: 'winget:sec', publishedAt: now - 3600_000, security: true, currentVersion: '1', availableVersion: '2' }),
        item({ id: 'abs', key: 'windowsupdate:abs', providerId: 'windowsupdate', kind: 'driver', deviceAbsent: true }),
        item({ id: 'drv', key: 'windowsupdate:drv', providerId: 'windowsupdate', kind: 'driver', currentVersion: '10.0.2', availableVersion: '10.0.1' }),
        item({ id: 'pin', key: 'winget:pin', currentVersion: '2.9', availableVersion: '3.0' }),
      ],
      s,
      ctx,
    );
    expect(r.visible.map((v) => v.id).sort()).toEqual(['old', 'sec']);
    expect(r.hiddenQuarantine).toBe(1);
    expect(r.hiddenAbsent).toBe(1);
  });
  it('quarantaine à 0 jour = tout visible', () => {
    const r = filterUpdates([item({ publishedAt: now, currentVersion: '1', availableVersion: '2' })], { ...DEFAULT_SETTINGS, quarantineDays: 0 }, ctx);
    expect(r.visible).toHaveLength(1);
  });
  it('mises à jour en attente de redémarrage', () => {
    const r = filterUpdates([item({ key: 'k', availableVersion: '2' })], DEFAULT_SETTINGS, { now, pendingRebootKeys: new Set(['k@2']) });
    expect(r.visible).toHaveLength(0);
  });
});

describe('profils et paramètres', () => {
  it('le profil surcharge les paramètres', () => {
    const s = migrateSettings({ activeProfile: 'game', notifications: true, providers: { npm: true } });
    const e = effectiveSettings(s);
    expect(e.notifications).toBe(false);
    expect(e.intervalMinutes).toBe(720);
    expect(e.providers.npm).toBe(true);
  });
  it('migre un ancien fichier', () => {
    const s = migrateSettings({ intervalMinutes: 60, activeProfile: 'inconnu' } as never);
    expect(s.quarantineDays).toBe(3);
    expect(s.activeProfile).toBe('default');
    expect(s.autoWindow.start).toBe('02:00');
  });
});

describe('plage horaire', () => {
  const w = { enabled: true, start: '22:00', end: '06:00', days: [1] };
  it('plage de nuit qui passe minuit', () => {
    expect(inTimeWindow(new Date(2026, 9, 5, 23, 0), w)).toBe(true);
    expect(inTimeWindow(new Date(2026, 9, 6, 3, 0), w)).toBe(true);
    expect(inTimeWindow(new Date(2026, 9, 6, 23, 0), w)).toBe(false);
    expect(inTimeWindow(new Date(2026, 9, 5, 12, 0), w)).toBe(false);
  });
  it('désactivée = toujours', () => {
    expect(inTimeWindow(new Date(), { ...w, enabled: false })).toBe(true);
  });
});

describe('progression', () => {
  it('lit les tailles et les pourcentages', () => {
    expect(parseProgress('  ██████  12.0 MB / 48.0 MB')).toBe(25);
    expect(parseProgress('Téléchargement 42%')).toBe(42);
    expect(parseProgress('rien')).toBeUndefined();
  });
});

describe('ordre d’installation', () => {
  it('firmware en dernier', () => {
    const list = [item({ kind: 'firmware' }), item({ kind: 'package' }), item({ kind: 'driver' }), item({ kind: 'system' })].sort(installOrder);
    expect(list.map((i) => i.kind)).toEqual(['package', 'system', 'driver', 'firmware']);
  });
});
