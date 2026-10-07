import { cleanLines, commandExists, powershell, powershellJson, psQuote, run, safeId } from '../lib/exec';
import { makeKey, type Provider } from './types';

interface ScoopStatus {
  Name: string;
  'Installed Version': string | null;
  'Latest Version': string | null;
  Info?: string;
}

export const scoopProvider: Provider = {
  id: 'scoop',
  name: 'Scoop',
  kind: 'package',
  group: 'Paquets',
  description: 'Installateur en ligne de commande pour Windows',
  detect: () => commandExists('scoop'),
  async check(ctx) {
    const raw = await powershellJson<ScoopStatus | ScoopStatus[]>(
      '$r = @(scoop status 6>$null | Where-Object { $_ -isnot [string] }); if ($r.Count) { ConvertTo-Json -InputObject $r -Depth 2 -Compress }',
      { timeoutMs: ctx.timeoutMs },
    );
    ctx.trace('scoop status', JSON.stringify(raw, null, 1));
    return [raw]
      .flat()
      .filter((s) => s && s['Latest Version'] && s['Installed Version'])
      .map((s) => ({
        key: makeKey('scoop', s.Name),
        providerId: 'scoop',
        kind: 'package' as const,
        id: s.Name,
        name: s.Name,
        iconName: s.Name,
        currentVersion: s['Installed Version'] ?? undefined,
        availableVersion: s['Latest Version'] ?? undefined,
        source: 'scoop',
        details: s.Info || undefined,
      }));
  },
  async install(items, ctx) {
    const names = items.map((i) => psQuote(safeId(i.id))).join(',');
    const res = await powershell(`scoop update ${names} *>&1 | ForEach-Object { "$_" }`, {
      onLine: ctx.log,
      timeoutMs: 30 * 60_000,
      signal: ctx.signal,
    });
    return { success: res.code === 0 };
  },
};

export const chocoProvider: Provider = {
  id: 'choco',
  name: 'Chocolatey',
  kind: 'package',
  group: 'Paquets',
  description: 'Gestionnaire de paquets Chocolatey (nécessite les droits administrateur)',
  detect: () => commandExists('choco'),
  async check(ctx) {
    const res = await run('choco', ['outdated', '-r', '--ignore-unfound', '--no-color'], { timeoutMs: ctx.timeoutMs });
    ctx.trace('choco outdated -r', res.stdout + res.stderr);
    return cleanLines(res.stdout)
      .map((l) => l.split('|'))
      .filter((p) => p.length >= 3 && p[0] && p[2] && p[3] !== 'true')
      .map(([id, current, available]) => ({
        key: makeKey('choco', id),
        providerId: 'choco',
        kind: 'package' as const,
        id,
        name: id,
        iconName: id,
        currentVersion: current,
        availableVersion: available,
        source: 'chocolatey',
        requiresAdmin: true,
        supportsVersions: true,
      }));
  },
  async elevatedOps(items) {
    return items.map((i) => ({ op: 'choco-upgrade' as const, id: safeId(i.id), version: i.targetVersion }));
  },
  async listVersions(item) {
    const res = await run('choco', ['search', safeId(item.id), '--exact', '--all-versions', '-r'], { timeoutMs: 60_000 });
    return cleanLines(res.stdout)
      .map((l) => l.split('|')[1])
      .filter(Boolean);
  },
};
