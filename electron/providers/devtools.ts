import { commandExists, cleanLines, powershell, powershellJson, psQuote, run, safeId } from '../lib/exec';
import { mapLimit } from '../lib/http';
import { cratesInfo, nugetInfo, registryDetails, sortVersionsDesc } from '../lib/registries';
import { makeKey, type Provider } from './types';
import { isNewer } from '../../shared/versions';
import type { UpdateItem } from '../../shared/types';

export function parseCargoList(text: string): { name: string; version: string; local: boolean }[] {
  return [...text.matchAll(/^(\S+) v(\S+?)( \([^)]*\))?:\s*$/gm)].map((m) => ({ name: m[1], version: m[2], local: !!m[3] }));
}

export const cargoProvider: Provider = {
  id: 'cargo',
  name: 'Cargo (Rust)',
  kind: 'package',
  group: 'Développement',
  description: 'Binaires Rust installés avec « cargo install »',
  osvEcosystem: 'crates.io',
  detect: () => commandExists('cargo'),
  async check(ctx) {
    const res = await run('cargo', ['install', '--list'], { timeoutMs: ctx.timeoutMs });
    ctx.trace('cargo install --list', res.stdout + res.stderr);
    const installed = parseCargoList(res.stdout).filter((p) => !p.local);
    const rows = await mapLimit(installed, 4, async (p) => {
      const info = await cratesInfo(p.name).catch(() => undefined);
      if (!info?.latest || !isNewer(info.latest, p.version)) return null;
      const item: UpdateItem = {
        key: makeKey('cargo', p.name),
        providerId: 'cargo',
        kind: 'package',
        id: p.name,
        name: p.name,
        currentVersion: p.version,
        availableVersion: info.latest,
        publishedAt: info.publishedAt,
        source: 'crates.io',
        homepage: info.homepage,
        supportsVersions: true,
      };
      return item;
    });
    return rows.filter((r): r is UpdateItem => !!r);
  },
  async install(items, ctx) {
    let ok = 0;
    for (const i of items) {
      const args = ['install', safeId(i.id), '--locked'];
      if (i.targetVersion) args.push('--version', safeId(i.targetVersion), '--force');
      ctx.log(`▶ cargo ${args.join(' ')}`);
      let res = await run('cargo', args, { onLine: ctx.log, timeoutMs: 60 * 60_000, signal: ctx.signal });
      if (res.code !== 0 && /lock/i.test(res.stderr)) {
        res = await run('cargo', args.filter((a) => a !== '--locked'), { onLine: ctx.log, timeoutMs: 60 * 60_000, signal: ctx.signal });
      }
      if (res.code === 0) ok++;
    }
    return { success: ok === items.length };
  },
  async listVersions(item) {
    return sortVersionsDesc((await cratesInfo(item.id)).versions ?? []).slice(0, 60);
  },
  async details(item) {
    return registryDetails(await cratesInfo(item.id));
  },
};

export function parseDotnetTools(text: string): { id: string; version: string }[] {
  const lines = cleanLines(text);
  const sep = lines.findIndex((l) => /^-{10,}/.test(l.trim()));
  return lines
    .slice(sep + 1)
    .map((l) => l.trim().split(/\s{2,}|\s+/))
    .filter((p) => p.length >= 2 && /\d/.test(p[1]))
    .map((p) => ({ id: p[0], version: p[1] }));
}

export const dotnetToolsProvider: Provider = {
  id: 'dotnet',
  name: 'Outils .NET (global)',
  kind: 'package',
  group: 'Développement',
  description: 'Outils installés avec « dotnet tool install -g »',
  osvEcosystem: 'NuGet',
  detect: () => commandExists('dotnet'),
  async check(ctx) {
    const res = await run('dotnet', ['tool', 'list', '-g'], { timeoutMs: ctx.timeoutMs });
    ctx.trace('dotnet tool list -g', res.stdout + res.stderr);
    const rows = await mapLimit(parseDotnetTools(res.stdout), 6, async (t) => {
      const info = await nugetInfo(t.id).catch(() => undefined);
      if (!info?.latest || !isNewer(info.latest, t.version)) return null;
      const item: UpdateItem = {
        key: makeKey('dotnet', t.id),
        providerId: 'dotnet',
        kind: 'package',
        id: t.id,
        name: t.id,
        currentVersion: t.version,
        availableVersion: info.latest,
        source: 'NuGet',
        homepage: `https://www.nuget.org/packages/${t.id}`,
        supportsVersions: true,
      };
      return item;
    });
    return rows.filter((r): r is UpdateItem => !!r);
  },
  async install(items, ctx) {
    let ok = 0;
    for (const i of items) {
      const args = ['tool', 'update', '-g', safeId(i.id)];
      if (i.targetVersion) args.push('--version', safeId(i.targetVersion), '--allow-downgrade');
      const res = await run('dotnet', args, { onLine: ctx.log, timeoutMs: 30 * 60_000, signal: ctx.signal });
      if (res.code === 0) ok++;
    }
    return { success: ok === items.length };
  },
  async listVersions(item) {
    return sortVersionsDesc((await nugetInfo(item.id)).versions ?? []).slice(0, 60);
  },
};

interface PsModule {
  Name: string;
  Version: string;
  Latest: string;
  AllUsers: boolean;
  ProjectUri?: string;
  Published?: string;
  Description?: string;
}

export const psGalleryProvider: Provider = {
  id: 'psgallery',
  name: 'PowerShell Gallery',
  kind: 'package',
  group: 'Développement',
  description: 'Modules PowerShell installés avec Install-Module',
  async detect() {
    const r = await powershell('if (Get-Command Get-InstalledModule -ErrorAction SilentlyContinue) { "yes" }', { timeoutMs: 30_000 });
    return r.stdout.includes('yes');
  },
  async check(ctx) {
    const raw = await powershellJson<PsModule[] | PsModule>(
      String.raw`
$inst = @(Get-InstalledModule -ErrorAction SilentlyContinue | Where-Object { $_.Repository -eq 'PSGallery' })
if (-not $inst.Count) { return }
$latest = @{}
Find-Module -Name ($inst.Name) -Repository PSGallery -ErrorAction SilentlyContinue | ForEach-Object { $latest[$_.Name] = $_ }
$r = foreach ($m in $inst) {
  $l = $latest[$m.Name]
  if ($l -and ([version]$l.Version -gt [version]$m.Version)) {
    [pscustomobject]@{ Name = $m.Name; Version = [string]$m.Version; Latest = [string]$l.Version; AllUsers = [bool]($m.InstalledLocation -like "$env:ProgramFiles*");
      ProjectUri = [string]$l.ProjectUri; Published = if ($l.PublishedDate) { $l.PublishedDate.ToString('o') } else { $null }; Description = $l.Description }
  }
}
if (@($r).Count) { ConvertTo-Json -InputObject @($r) -Compress }`,
      { timeoutMs: ctx.timeoutMs },
    );
    ctx.trace('Get-InstalledModule / Find-Module', JSON.stringify(raw, null, 1));
    return [raw]
      .flat()
      .filter(Boolean)
      .map((m) => ({
        key: makeKey('psgallery', m.Name),
        providerId: 'psgallery',
        kind: 'package' as const,
        id: m.Name,
        name: m.Name,
        currentVersion: m.Version,
        availableVersion: m.Latest,
        publishedAt: m.Published ? Date.parse(m.Published) : undefined,
        homepage: m.ProjectUri || `https://www.powershellgallery.com/packages/${m.Name}`,
        details: m.Description?.slice(0, 160),
        source: 'PSGallery',
        requiresAdmin: m.AllUsers,
      }));
  },
  async install(items, ctx) {
    const names = items.map((i) => psQuote(safeId(i.id))).join(',');
    const res = await powershell(`Update-Module -Name ${names} -Force -AcceptLicense -ErrorAction Continue *>&1 | ForEach-Object { "$_" }`, {
      onLine: ctx.log,
      timeoutMs: 30 * 60_000,
      signal: ctx.signal,
    });
    return { success: res.code === 0 };
  },
  async elevatedOps(items) {
    return [{ op: 'psgallery-update', names: items.map((i) => safeId(i.id)) }];
  },
};
