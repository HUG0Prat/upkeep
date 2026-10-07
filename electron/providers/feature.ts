import { run } from '../lib/exec';
import { eolCycles, newerWindowsCycle, windowsCycle, windowsVersion } from '../lib/security';
import { makeKey, type Provider } from './types';
import { t } from '../../shared/i18n';

export const windowsFeatureProvider: Provider = {
  id: 'wfeature',
  name: 'Windows (version)',
  kind: 'system',
  group: 'Windows',
  description: 'Nouvelle version annuelle de Windows (mise à jour de fonctionnalités)',
  detect: async () => process.platform === 'win32',
  async check(ctx) {
    const v = await windowsVersion();
    const cycle = windowsCycle(v);
    const cycles = await eolCycles('windows');
    const next = newerWindowsCycle(cycles, cycle);
    ctx.trace('Windows', JSON.stringify({ v, cycle, next }, null, 1));
    if (!next) return [];
    const label = next.cycle.split('-')[1].toUpperCase();
    return [
      {
        key: makeKey('wfeature', next.cycle),
        providerId: 'wfeature',
        kind: 'system',
        id: next.cycle,
        name: t('Windows {family} version {v}', { family: next.cycle.split('-')[0], v: label }),
        currentVersion: `${v.DisplayVersion} (${v.CurrentBuild}.${v.UBR})`,
        availableVersion: `${label} (${next.latest ?? '?'})`,
        publishedAt: next.releaseDate ? Date.parse(next.releaseDate) : undefined,
        source: 'Windows Update',
        category: t('Mise à jour de fonctionnalités'),
        details: t('Proposée par Windows Update quand votre PC est éligible ; UpKeep ouvre Windows Update pour la lancer.'),
        homepage: 'https://learn.microsoft.com/windows/release-health/',
        manualUrl: 'ms-settings:windowsupdate',
        requiresReboot: true,
      },
    ];
  },
  async install(_items, ctx) {
    await run('explorer.exe', ['ms-settings:windowsupdate']);
    ctx.log(t('Windows Update est ouvert : cliquez sur « Télécharger et installer » si la version est proposée.'));
    return { success: true };
  },
};
