import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { cleanLines, powershellJson, psQuote, run } from './exec';
import { parseWingetSearch, readWingetInstalled } from './inventory';
import { t } from '../../shared/i18n';
import type { PackageSearchResult, PackageSource } from '../../shared/types';

const LIMIT = 40;
const TIMEOUT_MS = 90_000;
const INSTALLED_TTL_MS = 2 * 60_000;
const COMMON = ['--accept-source-agreements', '--disable-interactivity'];

/** Lettres, chiffres, espaces et ponctuation courante des noms de logiciels ; rien qui serve à PowerShell. */
export function cleanQuery(q: string): string {
  const s = q.trim().replace(/\s+/g, ' ');
  if (s.length < 2 || s.length > 100 || !/^[\p{L}\p{N} .+#_@/-]+$/u.test(s)) throw new Error(t('Recherche refusée : 2 à 100 caractères, lettres, chiffres et . + # _ @ / -'));
  return s;
}

export function parseChocoSearch(stdout: string): { id: string; version: string }[] {
  return cleanLines(stdout)
    .map((l) => l.split('|'))
    .filter((p) => p.length >= 2 && /^[\w.+-]+$/.test(p[0]))
    .map(([id, version]) => ({ id, version }));
}

async function searchWingetSource(q: string, source: 'winget' | 'msstore'): Promise<PackageSearchResult[]> {
  const res = await run('winget', ['search', '--query', q, '--source', source, '--count', String(LIMIT), ...COMMON], { timeoutMs: TIMEOUT_MS });
  return parseWingetSearch(res.stdout).map((r) => ({ source, id: r.id, name: r.name, version: /^(unknown|inconnu)/i.test(r.version) ? undefined : r.version }));
}

interface ScoopRow {
  Name: string;
  Version: string;
  Source: string;
}

async function searchScoop(q: string): Promise<PackageSearchResult[]> {
  const rows = await powershellJson<ScoopRow[] | ScoopRow>(
    `$r = @(scoop search ${psQuote(q)} 6>$null | Where-Object { $_ -isnot [string] } | Select-Object -First ${LIMIT} Name, Version, Source); if ($r.Count) { ConvertTo-Json -InputObject $r -Compress }`,
    { timeoutMs: TIMEOUT_MS },
  );
  return [rows]
    .flat()
    .filter((r) => r?.Name)
    .map((r) => ({ source: 'scoop' as const, id: r.Source ? `${r.Source}/${r.Name}` : r.Name, name: r.Name, version: r.Version || undefined, detail: r.Source || undefined }));
}

async function searchChoco(q: string): Promise<PackageSearchResult[]> {
  const res = await run('choco', ['search', q, '-r', '--page-size', String(LIMIT), '--no-color'], { timeoutMs: TIMEOUT_MS });
  return parseChocoSearch(res.stdout).map((r) => ({ source: 'choco', id: r.id, name: r.id, version: r.version }));
}

const SEARCHERS: Record<PackageSource, (q: string) => Promise<PackageSearchResult[]>> = {
  winget: (q) => searchWingetSource(q, 'winget'),
  msstore: (q) => searchWingetSource(q, 'msstore'),
  scoop: searchScoop,
  choco: searchChoco,
};

// Identifiants déjà installés, par source (minuscules). winget list est lent : résultat gardé deux minutes.
let installedCache: { at: number; data: Promise<Record<PackageSource, Set<string>>> } | undefined;

function dirNames(dir: string): string[] {
  try {
    return existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name.toLowerCase()) : [];
  } catch {
    return [];
  }
}

async function readInstalled(): Promise<Record<PackageSource, Set<string>>> {
  const wg = await readWingetInstalled().catch(() => []);
  const ids = (src: string) => new Set(wg.filter((w) => (w.source || '').toLowerCase() === src).map((w) => w.id.toLowerCase()));
  const scoopRoots = [process.env.SCOOP ?? join(homedir(), 'scoop'), process.env.SCOOP_GLOBAL ?? join(process.env.ProgramData ?? 'C:\\ProgramData', 'scoop')];
  return {
    winget: ids('winget'),
    msstore: ids('msstore'),
    scoop: new Set(scoopRoots.flatMap((r) => dirNames(join(r, 'apps'))).filter((n) => n !== 'scoop')),
    choco: new Set(dirNames(join(process.env.ChocolateyInstall ?? join(process.env.ProgramData ?? 'C:\\ProgramData', 'chocolatey'), 'lib'))),
  };
}

export function invalidateInstalled(): void {
  installedCache = undefined;
}

function installedSets(): Promise<Record<PackageSource, Set<string>>> {
  if (!installedCache || Date.now() - installedCache.at > INSTALLED_TTL_MS) installedCache = { at: Date.now(), data: readInstalled() };
  return installedCache.data;
}

/** Interroge les catalogues demandés en parallèle ; l'échec d'un catalogue n'empêche pas les autres de répondre. */
export async function searchPackages(query: string, sources: PackageSource[]): Promise<{ results: PackageSearchResult[]; errors: Partial<Record<PackageSource, string>> }> {
  const q = cleanQuery(query);
  const [installed, ...settled] = await Promise.all([installedSets(), ...sources.map((s) => SEARCHERS[s](q).then((r) => ({ s, r }), (e: Error) => ({ s, e })))]);
  const results: PackageSearchResult[] = [];
  const errors: Partial<Record<PackageSource, string>> = {};
  for (const x of settled) {
    if ('e' in x) {
      errors[x.s] = x.e.message;
      continue;
    }
    // Scoop : le dossier d'installation porte le nom du paquet, sans le bucket.
    for (const r of x.r) results.push({ ...r, installed: installed[x.s].has((x.s === 'scoop' ? r.name : r.id).toLowerCase()) });
  }
  return { results, errors };
}
