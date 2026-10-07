import { commandExists, run, safeId } from '../lib/exec';
import { mapLimit } from '../lib/http';
import { pypiInfo, registryDetails, sortVersionsDesc } from '../lib/registries';
import { makeKey, type Provider } from './types';
import { isNewer, isPreviewVersion } from '../../shared/versions';
import type { UpdateItem } from '../../shared/types';

let launcher: string[] | null = null;

async function findPython(): Promise<string[] | null> {
  for (const cmd of [['py', '-3'], ['python']]) {
    const res = await run(cmd[0], [...cmd.slice(1), '-m', 'pip', '--version'], { timeoutMs: 20_000 });
    if (res.code === 0) return cmd;
  }
  return null;
}

const pypiCommon = {
  kind: 'package' as const,
  group: 'Développement' as const,
  osvEcosystem: 'PyPI',
  async listVersions(item: UpdateItem) {
    return sortVersionsDesc((await pypiInfo(item.id)).versions ?? []).slice(0, 60);
  },
  async details(item: UpdateItem) {
    return registryDetails(await pypiInfo(item.id));
  },
};

export const pipProvider: Provider = {
  ...pypiCommon,
  id: 'pip',
  name: 'pip (Python)',
  description: 'Paquets Python de l’interpréteur par défaut',
  async detect() {
    launcher = await findPython();
    return launcher !== null;
  },
  async check(ctx) {
    if (!launcher) return [];
    const res = await run(
      launcher[0],
      [...launcher.slice(1), '-m', 'pip', 'list', '--outdated', '--format=json', '--disable-pip-version-check'],
      { timeoutMs: ctx.timeoutMs },
    );
    ctx.trace('pip list --outdated', res.stdout + res.stderr);
    if (res.code !== 0) throw new Error(res.stderr.trim() || 'pip list a échoué');
    const data = JSON.parse(res.stdout.trim() || '[]') as { name: string; version: string; latest_version: string }[];
    return mapLimit(data, 6, async (p): Promise<UpdateItem> => {
      const info = await pypiInfo(p.name).catch(() => undefined);
      return {
        key: makeKey('pip', p.name),
        providerId: 'pip',
        kind: 'package',
        id: p.name,
        name: p.name,
        currentVersion: p.version,
        availableVersion: p.latest_version,
        publishedAt: info?.publishedAt,
        source: 'PyPI',
        preview: isPreviewVersion(p.latest_version),
        supportsVersions: true,
      };
    });
  },
  async install(items, ctx) {
    if (!launcher) return { success: false };
    const specs = items.map((i) => (i.targetVersion ? `${safeId(i.id)}==${safeId(i.targetVersion)}` : safeId(i.id)));
    const res = await run(
      launcher[0],
      [...launcher.slice(1), '-m', 'pip', 'install', '--upgrade', '--disable-pip-version-check', ...specs],
      { onLine: ctx.log, timeoutMs: 30 * 60_000, signal: ctx.signal },
    );
    return { success: res.code === 0 };
  },
};

export const pipxProvider: Provider = {
  ...pypiCommon,
  id: 'pipx',
  name: 'pipx',
  description: 'Applications Python isolées installées avec pipx',
  detect: () => commandExists('pipx'),
  async check(ctx) {
    const res = await run('pipx', ['list', '--json'], { timeoutMs: ctx.timeoutMs });
    ctx.trace('pipx list --json', res.stdout + res.stderr);
    const data = JSON.parse(res.stdout || '{}') as {
      venvs?: Record<string, { metadata: { main_package: { package: string; package_version: string } } }>;
    };
    const installed = Object.values(data.venvs ?? {}).map((v) => v.metadata.main_package);
    const rows = await mapLimit(installed, 6, async (p) => {
      const info = await pypiInfo(p.package).catch(() => undefined);
      if (!info?.latest || !isNewer(info.latest, p.package_version)) return null;
      return {
        key: makeKey('pipx', p.package),
        providerId: 'pipx',
        kind: 'package' as const,
        id: p.package,
        name: p.package,
        currentVersion: p.package_version,
        availableVersion: info.latest,
        publishedAt: info.publishedAt,
        source: 'PyPI',
        supportsVersions: true,
      };
    });
    return rows.filter((r): r is NonNullable<typeof r> => !!r);
  },
  async install(items, ctx) {
    let ok = 0;
    for (const i of items) {
      const args = i.targetVersion ? ['install', '--force', `${safeId(i.id)}==${safeId(i.targetVersion)}`] : ['upgrade', safeId(i.id)];
      const res = await run('pipx', args, { onLine: ctx.log, timeoutMs: 30 * 60_000, signal: ctx.signal });
      if (res.code === 0) ok++;
    }
    return { success: ok === items.length };
  },
};
