import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { commandExists, run, safeId } from '../lib/exec';
import { mapLimit } from '../lib/http';
import { npmInfo, registryDetails, sortVersionsDesc } from '../lib/registries';
import { makeKey, type CheckContext, type InstallContext, type Provider } from './types';
import { isNewer, isPreviewVersion } from '../../shared/versions';
import type { UpdateItem } from '../../shared/types';

type Installed = { name: string; version: string }[];

function toItems(providerId: string, list: { name: string; current: string; latest: string; publishedAt?: number }[]): UpdateItem[] {
  return list.map((p) => ({
    key: makeKey(providerId, p.name),
    providerId,
    kind: 'package',
    id: p.name,
    name: p.name,
    currentVersion: p.current,
    availableVersion: p.latest,
    publishedAt: p.publishedAt,
    source: 'npm',
    preview: isPreviewVersion(p.latest),
    supportsVersions: true,
  }));
}

async function compareWithRegistry(providerId: string, installed: Installed): Promise<UpdateItem[]> {
  const rows = await mapLimit(installed, 6, async (p) => {
    try {
      const info = await npmInfo(p.name);
      return info.latest && isNewer(info.latest, p.version) ? { name: p.name, current: p.version, latest: info.latest, publishedAt: info.publishedAt } : null;
    } catch {
      return null;
    }
  });
  return toItems(providerId, rows.filter((r): r is NonNullable<typeof r> => !!r));
}

async function shellInstall(cmd: (spec: string) => string, items: UpdateItem[], ctx: InstallContext) {
  const specs = items.map((i) => `${safeId(i.id)}@${i.targetVersion ? safeId(i.targetVersion) : 'latest'}`).join(' ');
  ctx.log(`▶ ${cmd(specs)}`);
  const res = await run(cmd(specs), [], { shell: true, onLine: ctx.log, timeoutMs: 30 * 60_000, signal: ctx.signal });
  return { success: res.code === 0 };
}

const common = {
  kind: 'package' as const,
  group: 'Développement' as const,
  osvEcosystem: 'npm',
  async listVersions(item: UpdateItem) {
    return sortVersionsDesc((await npmInfo(item.id)).versions ?? []).slice(0, 60);
  },
  async details(item: UpdateItem) {
    return registryDetails(await npmInfo(item.id));
  },
};

export const npmProvider: Provider = {
  ...common,
  id: 'npm',
  name: 'npm (global)',
  description: 'Paquets Node.js installés globalement avec npm',
  detect: () => commandExists('npm'),
  async check(ctx: CheckContext) {
    const res = await run('npm outdated -g --json', [], { shell: true, timeoutMs: ctx.timeoutMs });
    ctx.trace('npm outdated -g --json', res.stdout + res.stderr);
    const text = res.stdout.trim();
    if (!text) return [];
    const data = JSON.parse(text) as Record<string, { current?: string; latest?: string }>;
    const list = Object.entries(data).filter(([, v]) => v.latest && v.current && v.current !== v.latest);
    const dated = await mapLimit(list, 6, async ([name, v]) => {
      const info = await npmInfo(name).catch(() => undefined);
      return { name, current: v.current!, latest: v.latest!, publishedAt: info?.publishedAt };
    });
    return toItems('npm', dated);
  },
  install: (items, ctx) => shellInstall((s) => `npm install -g ${s}`, items, ctx),
};

export const pnpmProvider: Provider = {
  ...common,
  id: 'pnpm',
  name: 'pnpm (global)',
  description: 'Paquets Node.js installés globalement avec pnpm',
  detect: () => commandExists('pnpm'),
  async check(ctx) {
    const res = await run('pnpm ls -g --json --depth=0', [], { shell: true, timeoutMs: ctx.timeoutMs });
    ctx.trace('pnpm ls -g --json', res.stdout + res.stderr);
    const data = JSON.parse(res.stdout.trim() || '[]') as { dependencies?: Record<string, { version: string }> }[];
    const installed = data.flatMap((d) => Object.entries(d.dependencies ?? {}).map(([name, v]) => ({ name, version: v.version })));
    return compareWithRegistry('pnpm', installed);
  },
  install: (items, ctx) => shellInstall((s) => `pnpm add -g ${s}`, items, ctx),
};

export const yarnProvider: Provider = {
  ...common,
  id: 'yarn',
  name: 'Yarn classic (global)',
  description: 'Paquets Node.js installés avec « yarn global add »',
  detect: () => commandExists('yarn'),
  async check(ctx) {
    const dirRes = await run('yarn global dir', [], { shell: true, timeoutMs: 60_000 });
    const dir = dirRes.stdout.trim().split(/\r?\n/).pop() ?? '';
    ctx.trace('yarn global dir', dirRes.stdout + dirRes.stderr);
    if (!dir) return [];
    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8').catch(() => '{}')) as { dependencies?: Record<string, string> };
    const installed: Installed = [];
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      try {
        const p = JSON.parse(await readFile(join(dir, 'node_modules', name, 'package.json'), 'utf8')) as { version: string };
        installed.push({ name, version: p.version });
      } catch {
      }
    }
    return compareWithRegistry('yarn', installed);
  },
  install: (items, ctx) => shellInstall((s) => `yarn global add ${s}`, items, ctx),
};

export const bunProvider: Provider = {
  ...common,
  id: 'bun',
  name: 'Bun (global)',
  description: 'Paquets installés avec « bun add -g »',
  detect: () => commandExists('bun'),
  async check(ctx) {
    const res = await run('bun', ['pm', 'ls', '-g'], { timeoutMs: ctx.timeoutMs });
    ctx.trace('bun pm ls -g', res.stdout + res.stderr);
    const installed = [...res.stdout.matchAll(/(?:├──|└──)\s+(@?[^@\s]+)@(\S+)/g)].map((m) => ({ name: m[1], version: m[2] }));
    return compareWithRegistry('bun', installed);
  },
  install: (items, ctx) => shellInstall((s) => `bun add -g ${s}`, items, ctx),
};
