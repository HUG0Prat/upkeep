import { compareVersions, isNewer, majorOf } from './versions';
import { ruleActions } from './rules';
import { DEFAULT_SETTINGS, KIND_ORDER, type Settings, type UpdateItem } from './types';

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\((x64|x86|64-bit|32-bit|[a-z]{2}(-[a-z]{2})?)[^)]*\)/g, '')
    .replace(/\b(x64|x86|64-bit|32-bit|version|edition)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function mergeDuplicates(items: UpdateItem[], providerOrder: string[], providerName: (id: string) => string): UpdateItem[] {
  const rank = (id: string) => {
    const i = providerOrder.indexOf(id);
    return i < 0 ? 999 : i;
  };
  const groups = new Map<string, UpdateItem[]>();
  const out: UpdateItem[] = [];
  for (const it of items) {
    if (it.kind !== 'package' || !it.availableVersion) {
      out.push(it);
      continue;
    }
    const k = `${normalizeName(it.name)}@${it.availableVersion.replace(/^v/i, '')}`;
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }
  for (const g of groups.values()) {
    g.sort((a, b) => rank(a.providerId) - rank(b.providerId));
    const [main, ...others] = g;
    const distinct = others.filter((o) => o.providerId !== main.providerId);
    out.push(distinct.length ? { ...main, alsoVia: distinct.map((o) => providerName(o.providerId)) } : main);
    out.push(...others.filter((o) => o.providerId === main.providerId));
  }
  return out;
}

export function effectiveSettings(s: Settings): Settings {
  const profile = s.profiles.find((p) => p.id === s.activeProfile);
  if (!profile) return s;
  const o = profile.overrides;
  return {
    ...s,
    providers: { ...s.providers, ...(o.providers ?? {}) },
    notifications: o.notifications ?? s.notifications,
    intervalMinutes: o.intervalMinutes ?? s.intervalMinutes,
    autoUpdatesEnabled: o.autoUpdatesEnabled ?? s.autoUpdatesEnabled,
    autoReboot: o.autoReboot ?? s.autoReboot,
    respectFocus: o.respectFocus ?? s.respectFocus,
    skipOnMetered: o.skipOnMetered ?? s.skipOnMetered,
  };
}

export function migrateSettings(raw: Partial<Settings> | undefined): Settings {
  const s = { ...DEFAULT_SETTINGS, ...(raw ?? {}) } as Settings;
  s.autoUpdate = { ...DEFAULT_SETTINGS.autoUpdate, ...(raw?.autoUpdate ?? {}) };
  s.autoWindow = { ...DEFAULT_SETTINGS.autoWindow, ...(raw?.autoWindow ?? {}) };
  s.sort = { ...DEFAULT_SETTINGS.sort, ...(raw?.sort ?? {}) };
  s.securityFeeds = { ...DEFAULT_SETTINGS.securityFeeds, ...(raw?.securityFeeds ?? {}) };
  s.columns = { ...DEFAULT_SETTINGS.columns, ...(raw?.columns ?? {}) };
  if (!Array.isArray(s.profiles) || !s.profiles.length) s.profiles = DEFAULT_SETTINGS.profiles;
  if (!s.profiles.some((p) => p.id === s.activeProfile)) s.activeProfile = s.profiles[0].id;
  if (!s.profiles.some((p) => p.id === s.defaultProfile)) s.defaultProfile = s.profiles[0].id;
  if (!Array.isArray(s.rules)) s.rules = [];
  return s;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function inTimeWindow(date: Date, w: Settings['autoWindow']): boolean {
  if (!w.enabled) return true;
  const now = date.getHours() * 60 + date.getMinutes();
  const start = toMinutes(w.start);
  const end = toMinutes(w.end);
  const overnight = start > end;
  const day = overnight && now < end ? (date.getDay() + 6) % 7 : date.getDay();
  if (!w.days.includes(day)) return false;
  if (start === end) return true;
  return overnight ? now >= start || now < end : now >= start && now < end;
}

const SIZE_RE = /(\d+(?:[.,]\d+)?)\s*(KB|MB|GB|Ko|Mo|Go)\s*\/\s*(\d+(?:[.,]\d+)?)\s*(KB|MB|GB|Ko|Mo|Go)/i;
const UNIT: Record<string, number> = { kb: 1, ko: 1, mb: 1024, mo: 1024, gb: 1048576, go: 1048576 };

export function parseProgress(line: string): number | undefined {
  const s = line.match(SIZE_RE);
  if (s) {
    const done = parseFloat(s[1].replace(',', '.')) * UNIT[s[2].toLowerCase()];
    const total = parseFloat(s[3].replace(',', '.')) * UNIT[s[4].toLowerCase()];
    if (total > 0) return Math.min(100, Math.round((done / total) * 100));
  }
  const p = line.match(/(?:^|\s|\[)(\d{1,3}(?:[.,]\d+)?)\s?%/);
  if (p) {
    const v = parseFloat(p[1].replace(',', '.'));
    if (v >= 0 && v <= 100) return Math.round(v);
  }
  return undefined;
}

export interface FilterContext {
  now: number;
  pendingRebootKeys: Set<string>;
}

export interface FilterResult {
  visible: UpdateItem[];
  hiddenAbsent: number;
  hiddenQuarantine: number;
  hiddenPreview: number;
  hiddenByWindows: number;
}

export function filterUpdates(items: UpdateItem[], s: Settings, ctx: FilterContext): FilterResult {
  const res: FilterResult = { visible: [], hiddenAbsent: 0, hiddenQuarantine: 0, hiddenPreview: 0, hiddenByWindows: 0 };
  for (const raw of items) {
    const ign = s.ignored[raw.key];
    if (ign === '*' || (ign !== undefined && ign === raw.availableVersion)) continue;
    if (ctx.pendingRebootKeys.has(`${raw.key}@${raw.availableVersion}`)) continue;
    if (ruleActions(s.rules, raw).has('ignore')) continue;
    if ((raw.kind === 'driver' || raw.kind === 'firmware') && raw.currentVersion && raw.availableVersion) {
      const c = compareVersions(raw.availableVersion, raw.currentVersion);
      if (!Number.isNaN(c) && c <= 0 && !(raw.availableDate && raw.currentDate && raw.availableDate > raw.currentDate)) continue;
    } else if (raw.currentVersion && raw.availableVersion && !isNewer(raw.availableVersion, raw.currentVersion)) {
      continue;
    }
    const pin = s.pins[raw.key];
    if (pin && majorOf(raw.availableVersion) !== pin) continue;

    const item = { ...raw };
    const published = item.publishedAt ?? item.firstSeen;
    const securityBypass = item.security || /definition|définition|defender/i.test(`${item.name} ${item.category ?? ''}`);
    if (s.quarantineDays > 0 && published && !securityBypass) {
      const until = published + s.quarantineDays * 86_400_000;
      if (until > ctx.now) item.quarantineUntil = until;
    }

    if (item.hiddenByWindows && !s.showWindowsHidden) {
      res.hiddenByWindows++;
      continue;
    }
    if (item.deviceAbsent && s.hideAbsentDevices) {
      res.hiddenAbsent++;
      continue;
    }
    if (item.optional && s.hideOptionalDrivers) {
      res.hiddenPreview++;
      continue;
    }
    if (item.preview && s.hidePreview) {
      res.hiddenPreview++;
      continue;
    }
    if (item.quarantineUntil && !s.showQuarantined) {
      res.hiddenQuarantine++;
      continue;
    }
    res.visible.push(item);
  }
  return res;
}

export function installOrder(a: UpdateItem, b: UpdateItem): number {
  return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
}

export function csvEscape(v: unknown): string {
  const s = v === undefined || v === null ? '' : String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
