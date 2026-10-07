import { randomBytes } from 'node:crypto';

export type LinkAction = 'install' | 'snooze' | 'ignore';

interface Pending {
  keys: string[];
  versions: Record<string, string | undefined>;
  expires: number;
}

const pending = new Map<string, Pending>();

export function createLinkToken(items: { key: string; availableVersion?: string }[], ttlMs = 86_400_000): string {
  const token = randomBytes(16).toString('hex');
  pending.set(token, {
    keys: items.map((i) => i.key),
    versions: Object.fromEntries(items.map((i) => [i.key, i.availableVersion])),
    expires: Date.now() + ttlMs,
  });
  for (const [k, v] of pending) if (v.expires < Date.now()) pending.delete(k);
  return token;
}

export type ParsedLink =
  | { kind: 'open'; page: string }
  | { kind: 'action'; action: LinkAction; keys: string[]; versions: Record<string, string | undefined> }
  | null;

export function parseLink(url: string): ParsedLink {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'upkeep:') return null;
  if (u.host === 'open') {
    const page = u.pathname.replace(/^\//, '');
    return { kind: 'open', page: /^[a-z]{1,20}$/.test(page) ? page : 'updates' };
  }
  if (u.host !== 'action') return null;
  const action = u.pathname.replace(/^\//, '') as LinkAction;
  const token = u.searchParams.get('token') ?? '';
  const p = pending.get(token);
  if (!p || p.expires < Date.now() || !['install', 'snooze', 'ignore'].includes(action)) return null;
  pending.delete(token);
  return { kind: 'action', action, keys: p.keys, versions: p.versions };
}
