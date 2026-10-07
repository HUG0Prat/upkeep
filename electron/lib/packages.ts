import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanLines, commandExists, powershellJson, run, safeId } from './exec';
import { parseCargoList, parseDotnetTools } from '../providers/devtools';
import { parseCodeExtensions } from '../providers/apps';

export interface PackageBundle {
  format: 'upkeep-packages';
  version: 1;
  createdAt: string;
  computer: string;
  winget?: unknown;
  scoop?: string[];
  npm?: string[];
  pip?: string[];
  pipx?: string[];
  cargo?: string[];
  dotnet?: string[];
  vscode?: string[];
}

export async function exportPackages(log: (l: string) => void): Promise<PackageBundle> {
  const b: PackageBundle = { format: 'upkeep-packages', version: 1, createdAt: new Date().toISOString(), computer: process.env.COMPUTERNAME ?? '' };
  const dir = await mkdtemp(join(tmpdir(), 'upkeep-export-'));
  try {
    if (await commandExists('winget')) {
      log('winget export…');
      const f = join(dir, 'winget.json');
      await run('winget', ['export', '-o', f, '--accept-source-agreements', '--disable-interactivity'], { timeoutMs: 300_000 });
      b.winget = JSON.parse((await readFile(f, 'utf8').catch(() => '{}')).replace(/^﻿/, ''));
    }
    if (await commandExists('scoop')) {
      log('scoop list…');
      const r = await powershellJson<{ Name: string }[] | { Name: string }>("$r = @(scoop list 6>$null | Where-Object { $_ -isnot [string] }); ConvertTo-Json -InputObject $r -Compress", {
        timeoutMs: 120_000,
      });
      b.scoop = [r].flat().filter(Boolean).map((x) => x.Name);
    }
    if (await commandExists('npm')) {
      log('npm ls -g…');
      const r = await run('npm ls -g --depth=0 --json', [], { shell: true, timeoutMs: 120_000 });
      b.npm = Object.keys((JSON.parse(r.stdout || '{}') as { dependencies?: object }).dependencies ?? {}).filter((n) => n !== 'npm' && n !== 'corepack');
    }
    for (const py of [['py', '-3'], ['python']]) {
      const r = await run(py[0], [...py.slice(1), '-m', 'pip', 'list', '--not-required', '--format=json', '--disable-pip-version-check'], { timeoutMs: 120_000 });
      if (r.code === 0) {
        log('pip list…');
        b.pip = (JSON.parse(r.stdout || '[]') as { name: string }[]).map((p) => p.name).filter((n) => !/^(pip|setuptools|wheel)$/i.test(n));
        break;
      }
    }
    if (await commandExists('pipx')) {
      const r = await run('pipx', ['list', '--short'], { timeoutMs: 60_000 });
      b.pipx = cleanLines(r.stdout).map((l) => l.split(' ')[0]).filter(Boolean);
    }
    if (await commandExists('cargo')) {
      log('cargo install --list…');
      b.cargo = parseCargoList((await run('cargo', ['install', '--list'], { timeoutMs: 60_000 })).stdout).filter((c) => !c.local).map((c) => c.name);
    }
    if (await commandExists('dotnet')) {
      b.dotnet = parseDotnetTools((await run('dotnet', ['tool', 'list', '-g'], { timeoutMs: 60_000 })).stdout).map((t) => t.id);
    }
    if (await commandExists('code')) {
      log('extensions VS Code…');
      b.vscode = parseCodeExtensions((await run('code --list-extensions --show-versions', [], { shell: true, timeoutMs: 60_000 })).stdout).map((e) => e.id);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return b;
}

export async function importPackages(b: PackageBundle, log: (l: string) => void, signal: AbortSignal): Promise<boolean> {
  if (b.format !== 'upkeep-packages') throw new Error('Fichier non reconnu (export UpKeep attendu).');
  let ok = true;
  const step = async (label: string, cmd: string, args: string[], shell = false) => {
    if (signal.aborted) return;
    log(`▶ ${label}`);
    const r = await run(cmd, args, { onLine: log, timeoutMs: 3 * 3600_000, signal, shell });
    if (r.code !== 0) {
      ok = false;
      log(`✖ ${label} : code ${r.code}`);
    }
  };
  const dir = await mkdtemp(join(tmpdir(), 'upkeep-import-'));
  try {
    if (b.winget && (await commandExists('winget'))) {
      const f = join(dir, 'winget.json');
      await writeFile(f, JSON.stringify(b.winget), 'utf8');
      await step('winget import', 'winget', ['import', '-i', f, '--ignore-unavailable', '--ignore-versions', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity']);
    }
    if (b.scoop?.length && (await commandExists('scoop'))) await step('scoop install', 'powershell.exe', ['-NoProfile', '-Command', `scoop install ${b.scoop.map(safeId).join(' ')}`]);
    if (b.npm?.length && (await commandExists('npm'))) await step('npm install -g', `npm install -g ${b.npm.map(safeId).join(' ')}`, [], true);
    if (b.pip?.length) await step('pip install', 'py', ['-3', '-m', 'pip', 'install', ...b.pip.map(safeId)]);
    if (b.pipx?.length && (await commandExists('pipx'))) for (const p of b.pipx) await step(`pipx install ${p}`, 'pipx', ['install', safeId(p)]);
    if (b.cargo?.length && (await commandExists('cargo'))) for (const c of b.cargo) await step(`cargo install ${c}`, 'cargo', ['install', safeId(c)]);
    if (b.dotnet?.length && (await commandExists('dotnet'))) for (const t of b.dotnet) await step(`dotnet tool install ${t}`, 'dotnet', ['tool', 'install', '-g', safeId(t)]);
    if (b.vscode?.length && (await commandExists('code'))) for (const e of b.vscode) await step(`code --install-extension ${e}`, `code --install-extension ${safeId(e)}`, [], true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return ok;
}
