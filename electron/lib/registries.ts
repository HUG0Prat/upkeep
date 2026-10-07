import { fetchJson } from './http';
import { compareVersions, isPreviewVersion } from '../../shared/versions';
import type { UpdateDetails } from '../../shared/types';

export interface RegistryInfo {
  latest?: string;
  publishedAt?: number;
  homepage?: string;
  description?: string;
  license?: string;
  versions?: string[];
}

export async function npmInfo(name: string): Promise<RegistryInfo> {
  const enc = name.startsWith('@') ? `@${encodeURIComponent(name.slice(1))}` : encodeURIComponent(name);
  const j = await fetchJson<{
    'dist-tags'?: { latest?: string };
    time?: Record<string, string>;
    homepage?: string;
    description?: string;
    license?: string;
    versions?: Record<string, unknown>;
  }>(`https://registry.npmjs.org/${enc}`, { headers: { Accept: 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8' } });
  const latest = j['dist-tags']?.latest;
  return {
    latest,
    publishedAt: latest && j.time?.[latest] ? Date.parse(j.time[latest]) : undefined,
    homepage: j.homepage,
    description: j.description,
    license: typeof j.license === 'string' ? j.license : undefined,
    versions: j.versions ? Object.keys(j.versions) : undefined,
  };
}

export async function pypiInfo(name: string): Promise<RegistryInfo> {
  const j = await fetchJson<{
    info: { version: string; home_page?: string; summary?: string; license?: string; project_urls?: Record<string, string> };
    urls?: { upload_time_iso_8601?: string }[];
    releases?: Record<string, unknown>;
  }>(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
  const up = j.urls?.[0]?.upload_time_iso_8601;
  return {
    latest: j.info.version,
    publishedAt: up ? Date.parse(up) : undefined,
    homepage: j.info.home_page || j.info.project_urls?.Homepage || j.info.project_urls?.Source,
    description: j.info.summary,
    license: j.info.license?.slice(0, 80),
    versions: j.releases ? Object.keys(j.releases) : undefined,
  };
}

export async function nugetInfo(id: string): Promise<RegistryInfo> {
  const j = await fetchJson<{ versions: string[] }>(`https://api.nuget.org/v3-flatcontainer/${id.toLowerCase()}/index.json`);
  const stable = j.versions.filter((v) => !isPreviewVersion(v) && !v.includes('-'));
  return { latest: stable[stable.length - 1] ?? j.versions[j.versions.length - 1], versions: j.versions };
}

export async function cratesInfo(name: string): Promise<RegistryInfo> {
  const j = await fetchJson<{
    crate: { max_stable_version?: string; newest_version: string; updated_at?: string; homepage?: string; repository?: string; description?: string };
    versions?: { num: string; created_at: string; yanked: boolean }[];
  }>(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`);
  const latest = j.crate.max_stable_version ?? j.crate.newest_version;
  const v = j.versions?.find((x) => x.num === latest);
  return {
    latest,
    publishedAt: v ? Date.parse(v.created_at) : undefined,
    homepage: j.crate.homepage ?? j.crate.repository,
    description: j.crate.description,
    versions: j.versions?.filter((x) => !x.yanked).map((x) => x.num),
  };
}

export function registryDetails(info: RegistryInfo): UpdateDetails {
  return {
    description: info.description,
    homepage: info.homepage,
    license: info.license,
    publishedAt: info.publishedAt,
  };
}

export function sortVersionsDesc(versions: string[]): string[] {
  return [...versions].sort((a, b) => {
    const c = compareVersions(b, a);
    return Number.isNaN(c) ? 0 : c;
  });
}


interface OsvQuery {
  name: string;
  ecosystem: string;
  version: string;
}

export async function osvBatch(queries: OsvQuery[]): Promise<string[][]> {
  if (!queries.length) return [];
  const out: string[][] = [];
  for (let i = 0; i < queries.length; i += 500) {
    const chunk = queries.slice(i, i + 500);
    const j = await fetchJson<{ results: { vulns?: { id: string }[] }[] }>('https://api.osv.dev/v1/querybatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries: chunk.map((q) => ({ package: { name: q.name, ecosystem: q.ecosystem }, version: q.version })) }),
    });
    out.push(...j.results.map((r) => (r.vulns ?? []).map((v) => v.id)));
  }
  return out;
}

export async function osvAliases(ids: string[], limit = 30): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  await Promise.all(
    ids.slice(0, limit).map(async (id) => {
      try {
        const j = await fetchJson<{ aliases?: string[] }>(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`);
        map.set(id, (j.aliases ?? []).filter((a) => a.startsWith('CVE-')));
      } catch {
      }
    }),
  );
  return map;
}


export function githubRepo(url?: string): string | undefined {
  const m = url?.match(/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?]|$)/i);
  return m ? `${m[1]}/${m[2]}` : undefined;
}

const ghCache = new Map<string, { at: number; data: Promise<{ tag_name: string; name?: string; body?: string; draft: boolean; prerelease: boolean; published_at: string }[]> }>();

export async function githubNotesBetween(repo: string, from?: string, to?: string): Promise<string | undefined> {
  let entry = ghCache.get(repo);
  if (!entry || Date.now() - entry.at > 3600_000) {
    entry = { at: Date.now(), data: fetchGithubReleases(repo) };
    ghCache.set(repo, entry);
    entry.data.catch(() => ghCache.delete(repo));
  }
  const releases = await entry.data;
  return notesBetween(releases, from, to);
}

function fetchGithubReleases(repo: string) {
  return fetchJson<{ tag_name: string; name?: string; body?: string; draft: boolean; prerelease: boolean; published_at: string }[]>(
    `https://api.github.com/repos/${repo}/releases?per_page=50`,
    { headers: { Accept: 'application/vnd.github+json' } },
  );
}

function notesBetween(releases: { tag_name: string; name?: string; body?: string; draft: boolean; prerelease: boolean; published_at: string }[], from?: string, to?: string): string | undefined {
  const between = releases
    .filter((r) => !r.draft && !r.prerelease)
    .filter((r) => {
      const v = r.tag_name.replace(/^[^\d]*/, '');
      const afterFrom = !from || compareVersions(v, from) > 0;
      const upToTo = !to || !(compareVersions(v, to) > 0);
      return afterFrom && upToTo;
    })
    .slice(0, 20);
  if (!between.length) return undefined;
  return between
    .map((r) => `## ${r.name || r.tag_name} — ${r.published_at.slice(0, 10)}\n\n${(r.body ?? '').trim()}`)
    .join('\n\n')
    .slice(0, 30_000);
}
