import { existsSync } from 'node:fs';
import { run, safeId } from '../lib/exec';
import { fetchJson } from '../lib/http';
import { makeKey, type Provider } from './types';
import { compareVersions } from '../../shared/versions';
import type { UpdateItem } from '../../shared/types';

const WSL = 'C:\\Windows\\System32\\wsl.exe';

async function distros(): Promise<string[]> {
  const r = await run(WSL, ['-l', '-q'], { utf16: true, timeoutMs: 30_000 });
  return r.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^docker-desktop/i.test(l));
}

type Pm = 'apt' | 'dnf' | 'pacman' | 'zypper';

function sh(distro: string, cmd: string, timeoutMs: number, onLine?: (l: string) => void) {
  return run(WSL, ['-d', distro, '-u', 'root', '--', 'sh', '-c', cmd], { timeoutMs, onLine });
}

async function packageManager(distro: string): Promise<Pm | null> {
  const r = await sh(distro, 'for p in apt-get dnf pacman zypper; do command -v $p >/dev/null 2>&1 && echo $p && break; done', 60_000);
  const pm = r.stdout.trim();
  return pm === 'apt-get' ? 'apt' : ((['dnf', 'pacman', 'zypper'] as Pm[]).find((x) => x === pm) ?? null);
}

export function parseUpgradable(pm: Pm, text: string): { name: string; current?: string; latest: string }[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (pm === 'apt') {
    return lines
      .map((l) => l.match(/^([^/\s]+)\/\S+\s+(\S+)\s+\S+\s+\[[^:]+:\s*([^\]]+)\]/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => ({ name: m[1], latest: m[2], current: m[3].trim() }));
  }
  if (pm === 'pacman') {
    return lines.map((l) => l.match(/^(\S+)\s+(\S+)\s+->\s+(\S+)/)).filter((m): m is RegExpMatchArray => !!m).map((m) => ({ name: m[1], current: m[2], latest: m[3] }));
  }
  if (pm === 'zypper') {
    return lines
      .map((l) => l.split('|').map((x) => x.trim()))
      .filter((p) => p.length >= 5 && p[0] === 'v')
      .map((p) => ({ name: p[2], current: p[3], latest: p[4] }));
  }
  return lines
    .map((l) => l.match(/^(\S+)\.(?:x86_64|noarch|aarch64|i686)\s+(\S+)\s+\S+$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ name: m[1], latest: m[2] }));
}

const LIST_CMD: Record<Pm, string> = {
  apt: 'apt-get update -qq >/dev/null 2>&1; apt list --upgradable 2>/dev/null',
  dnf: 'dnf -q check-update 2>/dev/null; true',
  pacman: 'pacman -Sy >/dev/null 2>&1; pacman -Qu',
  zypper: 'zypper -q refresh >/dev/null 2>&1; zypper -q list-updates',
};

const UPGRADE_CMD: Record<Pm, (pkgs: string) => string> = {
  apt: (p) => `DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade ${p}`,
  dnf: (p) => `dnf -y upgrade ${p}`,
  pacman: (p) => `pacman -S --noconfirm ${p}`,
  zypper: (p) => `zypper -n update ${p}`,
};

const pmCache = new Map<string, Pm>();

export const wslPackagesProvider: Provider = {
  id: 'wsl-packages',
  name: 'Distributions WSL',
  kind: 'package',
  group: 'Développement',
  description: 'Paquets apt / dnf / pacman / zypper des distributions WSL (démarre les distributions pour vérifier)',
  defaultEnabled: false,
  async detect() {
    return existsSync(WSL) && (await distros()).length > 0;
  },
  async check(ctx) {
    const out: UpdateItem[] = [];
    for (const d of await distros()) {
      const pm = pmCache.get(d) ?? (await packageManager(d));
      if (!pm) continue;
      pmCache.set(d, pm);
      const r = await sh(d, LIST_CMD[pm], ctx.timeoutMs);
      ctx.trace(`${d} (${pm})`, r.stdout + r.stderr);
      for (const p of parseUpgradable(pm, r.stdout)) {
        out.push({
          key: makeKey('wsl-packages', `${d}/${p.name}`),
          providerId: 'wsl-packages',
          kind: 'package',
          id: `${d}/${p.name}`,
          name: p.name,
          currentVersion: p.current,
          availableVersion: p.latest,
          source: `WSL ${d}`,
          category: d,
        });
      }
    }
    return out;
  },
  async install(items, ctx) {
    const byDistro = new Map<string, string[]>();
    for (const i of items) {
      const [d, ...rest] = i.id.split('/');
      byDistro.set(d, [...(byDistro.get(d) ?? []), safeId(rest.join('/'))]);
    }
    let ok = true;
    for (const [d, pkgs] of byDistro) {
      const pm = pmCache.get(d) ?? (await packageManager(d));
      if (!pm) continue;
      ctx.log(`▶ ${d} : ${UPGRADE_CMD[pm](pkgs.join(' '))}`);
      const r = await sh(d, UPGRADE_CMD[pm](pkgs.join(' ')), 60 * 60_000, ctx.log);
      if (r.code !== 0) ok = false;
    }
    return { success: ok };
  },
};

export function parseWslVersion(text: string): string | undefined {
  return text.replace(/\0/g, '').match(/(\d+\.\d+\.\d+(?:\.\d+)?)/)?.[1];
}

export const wslCoreProvider: Provider = {
  id: 'wsl-core',
  name: 'WSL',
  kind: 'system',
  group: 'Windows',
  description: 'Sous-système Windows pour Linux (noyau et outils) comparé aux versions publiées sur GitHub',
  detect: async () => existsSync(WSL),
  async check(ctx) {
    const r = await run(WSL, ['--version'], { utf16: true, timeoutMs: 30_000 });
    ctx.trace('wsl --version', r.stdout + r.stderr);
    const current = parseWslVersion(r.stdout);
    if (!current) return [];
    const releases = await fetchJson<{ tag_name: string; prerelease: boolean; published_at: string; html_url: string }[]>(
      'https://api.github.com/repos/microsoft/WSL/releases?per_page=15',
    );
    const latest = releases.find((x) => ctx.settings.wslPrerelease || !x.prerelease);
    if (!latest) return [];
    const c = compareVersions(latest.tag_name, current);
    if (Number.isNaN(c) || c <= 0) return [];
    return [
      {
        key: makeKey('wsl-core', 'wsl'),
        providerId: 'wsl-core',
        kind: 'system',
        id: 'wsl',
        name: 'Sous-système Windows pour Linux',
        currentVersion: current,
        availableVersion: latest.tag_name,
        publishedAt: Date.parse(latest.published_at),
        releaseNotesUrl: latest.html_url,
        preview: latest.prerelease,
        source: 'GitHub',
        requiresAdmin: true,
      },
    ];
  },
  async elevatedOps(_items, ctx) {
    return [{ op: 'wsl-update', prerelease: ctx.settings.wslPrerelease }];
  },
};
