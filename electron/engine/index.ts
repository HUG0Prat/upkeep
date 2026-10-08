import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { FAKE, providers, getProvider } from '../providers';
import { FAKE_SYSTEM, fakeEol, fakePackageSearch, fakeSecurityChecks } from '../providers/fake';
import { makeKey, type Provider } from '../providers/types';
import { safeId } from '../lib/exec';
import { invalidateInstalled, searchPackages } from '../lib/packageSearch';
import { loadJson, saveJson, saveJsonSync } from '../lib/storage';
import { batteryStatus, defaultConditions, getSystemInfo, isElevated, isFocusBusy, isMetered, readUpdatePolicy } from '../lib/system';
import { helperStatus, installHelper, isCheckTaskInstalled, uninstallHelper, type HelperStatus } from '../lib/helper';
import { githubNotesBetween, githubRepo, osvAliases, osvBatch } from '../lib/registries';
import { readInventory, searchWinget } from '../lib/inventory';
import { readHardware } from '../lib/hardware';
import { mapLimit } from '../lib/http';
import { annotateExploited, annotateNvd, eolReport, kevCatalog, securityChecks } from '../lib/security';
import { cleanupOps, cleanUser, listCleanup } from '../lib/maintenance';
import type { ElevatedOp } from '../lib/elevatedOps';
import { JobQueue, type QueuedJob } from './queue';
import { RebootManager } from './reboot';
import { csvEscape, effectiveSettings, filterUpdates, inTimeWindow, installOrder, mergeDuplicates, migrateSettings } from '../../shared/logic';
import { ruleActions } from '../../shared/rules';
import { t } from '../../shared/i18n';
import type {
  AppState,
  CleanupItem,
  Conditions,
  HardwareInfo,
  InstallJob,
  InventoryItem,
  JobType,
  Lang,
  MonthlyStat,
  PackageSearchResult,
  PackageSource,
  PackageSourceInfo,
  ProviderInfo,
  SecurityReport,
  SelfUpdateState,
  Settings,
  SystemInfo,
  UpdateDetails,
  UpdateItem,
  UpdatePolicy,
  WeeklySummary,
} from '../../shared/types';

const MAX_JOBS_KEPT = 150;
const TICK_MS = 60_000;
const STATE_LOG_LINES = 40;

const DEFAULT_TIMEOUT_MIN: Record<string, number> = {
  windowsupdate: 10,
  wusoftware: 10,
  lenovo: 10,
  dell: 15,
  hp: 20,
  'wsl-packages': 15,
  cargo: 5,
  vscode: 5,
};

interface ProviderRuntime {
  available: boolean;
  checking: boolean;
  lastCheck?: number;
  durationMs?: number;
  error?: string;
  updates: UpdateItem[];
  trace: string;
}

export interface InstallOptions {
  auto?: boolean;
  downloadOnly?: boolean;
  versions?: Record<string, string>;
}

export class UpdateEngine extends EventEmitter {
  settings: Settings;
  private system: SystemInfo = { manufacturer: '…', model: '…', biosVersion: '…', os: '…' };
  private admin = false;
  private policy: UpdatePolicy = { intune: false, driversExcluded: false };
  private conditions: Conditions = defaultConditions();
  private runtime = new Map<string, ProviderRuntime>();
  private jobs: InstallJob[] = loadJson<InstallJob[]>('history.json', []);
  readonly queue: JobQueue;
  readonly reboot: RebootManager;
  private tickTimer?: NodeJS.Timeout;
  private lastFullCheck?: number;
  private notified = new Set<string>(loadJson<string[]>('notified.json', []));
  private firstSeen: Record<string, number> = loadJson('first-seen.json', {});
  private pendingNotify: UpdateItem[] = [];
  private emitPending = false;
  private lastConditions = 0;
  private helper: HelperStatus = 'absent';
  private checkTaskInstalled = false;
  private detailsCache = new Map<string, UpdateDetails>();
  private securityCache?: { at: number; data: Promise<SecurityReport> };
  private invCache?: { at: number; key: string; data: Promise<InventoryItem[]> };
  private hwCache?: { at: number; data: Promise<HardwareInfo> };
  private lastWeekly = loadJson<number>('weekly.json', 0);
  appVersion = '0.0.0';
  lang: Lang = 'fr';
  portable = false;
  private selfUpdate: SelfUpdateState = { mode: 'off', status: 'idle' };

  constructor() {
    super();
    this.settings = migrateSettings(loadJson<Partial<Settings>>('settings.json', {}));
    const detected = loadJson<Record<string, boolean>>('detect.json', {});
    for (const p of providers) this.runtime.set(p.id, { available: !!detected[p.id], checking: false, updates: [], trace: '' });
    const cache = loadJson<Record<string, { at: number; items: UpdateItem[] }>>('cache.json', {});
    for (const [id, c] of Object.entries(cache)) {
      const rt = this.runtime.get(id);
      // Un cache écrit avant la conversion [string] de LSUClient peut contenir des versions objets : on l'ignore.
      if (rt && c.items.every((i) => [i.currentVersion, i.availableVersion].every((v) => v == null || typeof v === 'string'))) {
        rt.updates = c.items;
        rt.lastCheck = c.at;
      }
    }
    for (const j of this.jobs) if (j.status === 'running' || j.status === 'queued') j.status = 'interrupted';
    this.reboot = new RebootManager(FAKE, () => this.changed());
    this.queue = new JobQueue({
      settings: () => this.settings,
      jobs: () => this.jobs,
      useHelper: () => this.settings.useElevatedHelper && this.helper === 'ok',
      changed: () => this.changed(),
      jobDone: (job, q) => this.onJobDone(job, q),
    });
  }

  get eff(): Settings {
    return effectiveSettings(this.settings);
  }

  async init(): Promise<void> {
    [this.system, this.admin, this.policy] = await Promise.all([getSystemInfo(), isElevated(), readUpdatePolicy()]);
    if (FAKE) this.system = { ...this.system, ...FAKE_SYSTEM };
    await Promise.all(providers.map((p) => this.detect(p)));
    saveJson('detect.json', Object.fromEntries([...this.runtime].map(([id, rt]) => [id, rt.available])));
    this.helper = FAKE ? 'absent' : await helperStatus().catch(() => 'absent' as const);
    this.checkTaskInstalled = FAKE ? false : await isCheckTaskInstalled().catch(() => false);
    void this.refreshConditions(true);
    this.tickTimer = setInterval(() => void this.tick(), TICK_MS);
    setTimeout(() => this.warmCaches(), 20_000);
    this.changed();
  }

  dispose(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    saveJsonSync('history.json', this.jobs);
  }

  private isEnabled(p: Provider): boolean {
    const applicable = p.isApplicable?.(this.system) ?? true;
    const def = applicable && p.defaultEnabled !== false;
    return this.eff.providers[p.id] ?? def;
  }

  private providerInterval(p: Provider): number {
    return this.settings.providerIntervals[p.id] || this.eff.intervalMinutes;
  }

  private timeoutMs(id: string): number {
    return (this.settings.providerTimeouts[id] || DEFAULT_TIMEOUT_MIN[id] || 3) * 60_000;
  }

  private nextDue(p: Provider): number | undefined {
    const rt = this.runtime.get(p.id)!;
    if (!this.isEnabled(p) || !rt.available) return undefined;
    return (rt.lastCheck ?? 0) + this.providerInterval(p) * 60_000;
  }

  private pendingRebootKeys(): Set<string> {
    const keys = new Set<string>();
    if (!this.reboot.isPending(this.jobs)) return keys;
    for (const j of this.jobs) {
      if (j.status === 'success' && j.rebootRequired && !j.simulated) for (const i of j.items) keys.add(`${i.key}@${i.availableVersion}`);
    }
    return keys;
  }

  private rawUpdates(): UpdateItem[] {
    const order = providers.map((p) => p.id);
    const items = providers.flatMap((p) => (this.isEnabled(p) ? this.runtime.get(p.id)!.updates : []));
    for (const i of items) i.firstSeen = this.firstSeen[`${i.key}@${i.availableVersion}`] ?? i.firstSeen;
    return mergeDuplicates(items, order, (id) => getProvider(id)?.name ?? id);
  }

  private filtered() {
    return filterUpdates(this.rawUpdates(), this.eff, { now: Date.now(), pendingRebootKeys: this.pendingRebootKeys() });
  }

  visibleUpdates(): UpdateItem[] {
    return this.filtered().visible;
  }

  getState(): AppState {
    const f = this.filtered();
    const providerInfos: ProviderInfo[] = providers.map((p) => {
      const rt = this.runtime.get(p.id)!;
      return {
        id: p.id,
        name: p.name,
        kind: p.kind,
        group: p.group,
        description: p.description,
        applicable: p.isApplicable?.(this.system) ?? true,
        available: rt.available,
        enabled: this.isEnabled(p),
        checking: rt.checking,
        lastCheck: rt.lastCheck,
        nextCheck: this.nextDue(p),
        error: rt.error,
        count: f.visible.filter((u) => u.providerId === p.id).length,
        setupLabel: p.setup?.label,
        actions: p.actions?.map((a) => ({ id: a.id, label: a.label })),
        hasTrace: !!rt.trace,
        durationMs: rt.durationMs,
        note: p.note?.(),
        experimental: p.experimental,
        autoUpdate: !!this.settings.autoUpdate.providers[p.id],
        intervalMinutes: this.settings.providerIntervals[p.id] || 0,
        timeoutMinutes: this.settings.providerTimeouts[p.id] || DEFAULT_TIMEOUT_MIN[p.id] || 3,
      };
    });
    const dues = providers.map((p) => this.nextDue(p)).filter((x): x is number => !!x);
    return {
      updates: f.visible,
      providers: providerInfos,
      jobs: this.jobs.map((j) => (j.log.length > STATE_LOG_LINES ? { ...j, log: j.log.slice(-STATE_LOG_LINES), logLength: j.log.length } : j)),
      lastFullCheck: this.lastFullCheck,
      nextCheck: dues.length ? Math.min(...dues) : undefined,
      system: this.system,
      isAdmin: this.admin,
      settings: this.settings,
      effective: this.eff,
      hiddenAbsent: f.hiddenAbsent,
      hiddenQuarantine: f.hiddenQuarantine,
      hiddenPreview: f.hiddenPreview,
      hiddenByWindows: f.hiddenByWindows,
      pendingReboot: this.reboot.isPending(this.jobs),
      scheduledReboot: this.reboot.scheduled,
      conditions: this.conditions,
      policy: this.policy,
      helperInstalled: this.helper === 'ok',
      scheduledTaskInstalled: this.checkTaskInstalled,
      appVersion: this.appVersion,
      selfUpdate: this.selfUpdate,
      portable: this.portable,
      fake: FAKE,
      lang: this.lang,
      autoBlockers: this.autoBlockers(),
    };
  }

  setSelfUpdate(state: SelfUpdateState): void {
    this.selfUpdate = state;
    this.changed();
  }

  jobLog(id: string): string[] {
    return this.jobs.find((j) => j.id === id)?.log ?? [];
  }

  private changed(): void {
    if (this.emitPending) return;
    this.emitPending = true;
    setTimeout(() => {
      this.emitPending = false;
      this.emit('state', this.getState());
    }, 150);
  }

  private async detect(p: Provider): Promise<void> {
    const rt = this.runtime.get(p.id)!;
    try {
      rt.available = await p.detect();
    } catch (err) {
      rt.available = false;
      rt.error = String(err);
    }
  }

  private saveCache(): void {
    const cache: Record<string, { at: number; items: UpdateItem[] }> = {};
    for (const [id, rt] of this.runtime) if (rt.lastCheck) cache[id] = { at: rt.lastCheck, items: rt.updates };
    saveJson('cache.json', cache);
  }

  async checkProvider(id: string): Promise<void> {
    const p = getProvider(id);
    const rt = this.runtime.get(id);
    if (!p || !rt || rt.checking || !rt.available) return;
    rt.checking = true;
    rt.error = undefined;
    this.changed();
    const started = Date.now();
    const traces: string[] = [];
    const attempt = async () => {
      const ms = this.timeoutMs(id);
      const ctx = {
        settings: this.settings,
        system: this.system,
        policy: this.policy,
        timeoutMs: ms,
        trace: (label: string, text: string) => traces.push(`### ${label}\n${text}`),
      };
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(t('Délai de {n} min dépassé', { n: Math.round(ms / 60_000) }))), ms + 5_000);
      });
      try {
        return await Promise.race([p.check(ctx), timeout]);
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      let items: UpdateItem[];
      try {
        items = await attempt();
      } catch (err) {
        if (!this.settings.retryOnFailure) throw err;
        traces.push(`### ${t('Échec, nouvelle tentative dans 5 s')}\n${String(err)}`);
        await new Promise((r) => setTimeout(r, 5_000));
        items = await attempt();
      }
      const now = Date.now();
      for (const i of items) {
        const k = `${i.key}@${i.availableVersion}`;
        this.firstSeen[k] ??= now;
        i.firstSeen = this.firstSeen[k];
      }
      saveJson('first-seen.json', this.firstSeen);
      if (p.osvEcosystem) await this.annotateOsv(p.osvEcosystem, items, traces);
      rt.updates = items;
    } catch (err) {
      rt.error = err instanceof Error ? err.message : String(err);
      console.error(`[${id}] vérification échouée :`, err);
    } finally {
      rt.checking = false;
      rt.lastCheck = Date.now();
      rt.durationMs = rt.lastCheck - started;
      console.info(`[perf] vérification ${id} : ${rt.durationMs} ms${rt.error ? ' (erreur)' : ''}`);
      rt.trace = `${new Date().toLocaleString()}\n\n${traces.join('\n\n')}`.slice(0, 400_000);
      this.saveCache();
      this.changed();
    }
  }

  private async annotateOsv(ecosystem: string, items: UpdateItem[], traces: string[]): Promise<void> {
    const targets = items.filter((i) => i.currentVersion);
    if (!targets.length) return;
    try {
      const res = await osvBatch(targets.map((i) => ({ name: i.id, ecosystem, version: i.currentVersion! })));
      const aliases = await osvAliases([...new Set(res.flat())]);
      targets.forEach((i, idx) => {
        const ids = res[idx];
        if (!ids?.length) return;
        i.security = true;
        i.severity ??= 'important';
        i.cves = [...new Set(ids.flatMap((id) => (aliases.get(id)?.length ? aliases.get(id)! : [id])))];
      });
      traces.push(`### OSV.dev (${ecosystem})\n${targets.map((x, i) => `${x.id}@${x.currentVersion}: ${res[i]?.join(', ') || '-'}`).join('\n')}`);
    } catch (err) {
      traces.push(`### OSV.dev\n${String(err)}`);
    }
  }

  private async checkMany(list: Provider[]): Promise<void> {
    await mapLimit(list, Math.max(1, this.settings.maxParallelChecks), (p) => this.checkProvider(p.id));
  }

  async checkAll(): Promise<void> {
    await this.checkMany(providers.filter((p) => this.isEnabled(p) && this.runtime.get(p.id)!.available));
    this.lastFullCheck = Date.now();
    await this.afterCheck();
  }

  async startupCheck(): Promise<void> {
    const ttl = this.settings.cacheMinutes * 60_000;
    await this.checkMany(
      providers.filter((p) => {
        const rt = this.runtime.get(p.id)!;
        return this.isEnabled(p) && rt.available && (!rt.lastCheck || Date.now() - rt.lastCheck > ttl);
      }),
    );
    this.lastFullCheck = Date.now();
    await this.afterCheck();
  }

  private async securityFeeds(): Promise<void> {
    if (FAKE) return;
    const feeds = this.settings.securityFeeds;
    const all = providers.flatMap((p) => this.runtime.get(p.id)!.updates);
    if (feeds.kev) {
      try {
        if (annotateExploited(all, await kevCatalog())) this.changed();
      } catch (err) {
        console.warn('[sécurité] catalogue KEV indisponible :', err);
      }
    }
    if (feeds.nvd) {
      const desktop = this.visibleUpdates().filter((u) => ['winget', 'msstore', 'browsers', 'scoop', 'choco'].includes(u.providerId));
      const byKey = new Map(all.map((u) => [u.key, u]));
      void annotateNvd(
        desktop.map((d) => byKey.get(d.key) ?? d),
        () => this.changed(),
      );
    }
  }

  private async afterCheck(): Promise<void> {
    await this.securityFeeds();
    const visible = this.visibleUpdates();
    const fresh = visible.filter((u) => !this.notified.has(`${u.key}@${u.availableVersion}`) && !ruleActions(this.settings.rules, u).has('silent'));
    if (fresh.length) {
      for (const u of fresh) this.notified.add(`${u.key}@${u.availableVersion}`);
      saveJson('notified.json', [...this.notified].slice(-3000));
      this.pendingNotify.push(...fresh);
      await this.flushNotifications();
    }
    await this.runAutoUpdates();
    this.emit('checked', visible);
    this.changed();
  }

  private async flushNotifications(): Promise<void> {
    if (!this.pendingNotify.length) return;
    if (Date.now() < this.settings.snoozeUntil) return;
    if (this.eff.respectFocus) {
      await this.refreshConditions();
      if (this.conditions.focusBusy) return;
    }
    const items = this.pendingNotify;
    this.pendingNotify = [];
    if (this.eff.notifications) this.emit('new-updates', items);
  }

  async refreshConditions(force = false): Promise<void> {
    if (FAKE) return;
    if (!force && Date.now() - this.lastConditions < 2 * 60_000) return;
    this.lastConditions = Date.now();
    const [metered, focusBusy, bat] = await Promise.all([isMetered().catch(() => false), isFocusBusy().catch(() => false), batteryStatus()]);
    this.conditions = { ...this.conditions, metered, focusBusy, onBattery: !bat.onAc, batteryLevel: bat.level };
    this.changed();
  }

  setPower(onBattery: boolean): void {
    this.conditions = { ...this.conditions, onBattery };
    this.changed();
  }

  setOnline(online: boolean): void {
    const was = this.conditions.online;
    this.conditions = { ...this.conditions, online };
    this.changed();
    if (online && !was && this.settings.checkOnResume) void this.checkStale(10);
  }

  async checkStale(minutes: number): Promise<void> {
    const targets = providers.filter((p) => {
      const rt = this.runtime.get(p.id)!;
      return this.isEnabled(p) && rt.available && (rt.error || !rt.lastCheck || Date.now() - rt.lastCheck > minutes * 60_000);
    });
    if (!targets.length) return;
    await this.checkMany(targets);
    await this.afterCheck();
  }

  private async tick(): Promise<void> {
    const due = providers.filter((p) => {
      const d = this.nextDue(p);
      return d !== undefined && d <= Date.now() && !this.runtime.get(p.id)!.checking;
    });
    if (due.length) {
      await this.checkMany(due);
      this.lastFullCheck = Date.now();
      await this.afterCheck();
    } else {
      await this.flushNotifications();
      await this.runAutoUpdates();
    }
    await this.reboot.housekeeping(this.jobs, this.eff, (ev, at) => this.emit(ev, at));
    this.weeklyHousekeeping();
  }

  weeklySummary(now = Date.now()): WeeklySummary {
    const from = now - 7 * 86_400_000;
    const installed = { package: 0, system: 0, driver: 0, firmware: 0 };
    let failed = 0;
    for (const j of this.jobs) {
      if ((j.finishedAt ?? 0) < from || j.simulated) continue;
      if (j.status === 'success' && (j.type === 'install' || j.type === 'rollback')) for (const i of j.items) installed[i.kind]++;
      if (j.status === 'failed') failed++;
    }
    const f = this.filtered();
    return {
      from,
      to: now,
      installed,
      failed,
      ignored: Object.keys(this.settings.ignored).length,
      quarantined: f.hiddenQuarantine,
      pending: f.visible.length,
    };
  }

  private weeklyHousekeeping(): void {
    if (!this.settings.weeklySummary) return;
    const d = new Date();
    if (d.getDay() !== 1 || d.getHours() < 9 || Date.now() - this.lastWeekly < 6 * 86_400_000) return;
    this.lastWeekly = Date.now();
    saveJson('weekly.json', this.lastWeekly);
    this.emit('weekly-summary', this.weeklySummary());
  }

  private autoAllowed(u: UpdateItem): boolean {
    const per = this.settings.autoUpdate.packages[u.key];
    const rules = ruleActions(this.settings.rules, u);
    if (per === 'never' || rules.has('never-auto')) return false;
    if (u.quarantineUntil || u.preview || u.manualUrl) return false;
    const wanted = per === 'auto' || rules.has('auto') || !!this.settings.autoUpdate.providers[u.providerId];
    if (!wanted) return false;
    if (u.kind === 'firmware' && per !== 'auto') return false;
    if (u.requiresAdmin && !(this.settings.useElevatedHelper && this.helper === 'ok')) return false;
    return true;
  }

  autoBlockers(): string[] {
    const e = this.eff;
    const out: string[] = [];
    if (!e.autoUpdatesEnabled) out.push('désactivées');
    if (!inTimeWindow(new Date(), e.autoWindow)) out.push('hors plage horaire');
    if (e.skipOnMetered && this.conditions.metered) out.push('connexion limitée');
    if (this.conditions.onBattery && (this.conditions.batteryLevel ?? 100) < e.skipOnBatteryBelow) out.push('batterie faible');
    if (e.respectFocus && this.conditions.focusBusy) out.push('plein écran / ne pas déranger');
    return out;
  }

  private async runAutoUpdates(): Promise<void> {
    if (!this.eff.autoUpdatesEnabled) return;
    const busy = this.queue.busyKeys();
    const candidates = this.visibleUpdates().filter((u) => !busy.has(u.key) && this.autoAllowed(u));
    if (!candidates.length) return;
    await this.refreshConditions();
    if (this.autoBlockers().length) return;
    this.install(candidates.map((c) => c.key), { auto: true });
  }

  updateSettings(patch: Partial<Settings>): Settings {
    this.settings = migrateSettings({ ...this.settings, ...patch });
    saveJson('settings.json', this.settings);
    this.emit('settings', this.settings);
    this.changed();
    return this.settings;
  }

  replaceSettings(raw: Partial<Settings>): Settings {
    return this.updateSettings(migrateSettings(raw));
  }

  ignore(key: string, version: string | '*'): void {
    this.updateSettings({ ignored: { ...this.settings.ignored, [key]: version } });
  }

  unignore(key: string): void {
    const { [key]: _removed, ...rest } = this.settings.ignored;
    this.updateSettings({ ignored: rest });
  }

  snooze(hours: number): void {
    this.updateSettings({ snoozeUntil: Date.now() + hours * 3600_000 });
  }

  findItems(keys: string[]): UpdateItem[] {
    const all = providers.flatMap((p) => this.runtime.get(p.id)!.updates);
    return keys.map((k) => all.find((u) => u.key === k)).filter((u): u is UpdateItem => !!u);
  }

  async firmwareGuard(items: UpdateItem[]): Promise<void> {
    if (!items.some((i) => i.kind === 'firmware') || FAKE || this.settings.simulateInstalls) return;
    const bat = await batteryStatus();
    if (this.settings.requireAcForFirmware && !bat.onAc) throw new Error(t('Branchez le chargeur secteur avant une mise à jour de firmware/BIOS.'));
    if (bat.level !== undefined && bat.level < this.settings.minBatteryForFirmware) {
      throw new Error(t('Batterie à {n} % : il faut au moins {min} % pour un firmware/BIOS.', { n: bat.level, min: this.settings.minBatteryForFirmware }));
    }
  }

  private newJob(type: JobType, providerId: string, items: UpdateItem[], extra: Partial<InstallJob> = {}): InstallJob {
    return {
      id: randomUUID(),
      type,
      providerId,
      items,
      status: 'queued',
      queuedAt: Date.now(),
      log: [],
      attempt: 1,
      simulated: this.settings.simulateInstalls || undefined,
      ...extra,
    };
  }

  private enqueue(q: QueuedJob): void {
    this.jobs.unshift(q.job);
    this.jobs.splice(MAX_JOBS_KEPT);
    this.queue.enqueue(q);
  }

  install(keys: string[], opts: InstallOptions = {}): InstallJob[] {
    const items = this.findItems(keys).map((i) => (opts.versions?.[i.key] ? { ...i, targetVersion: opts.versions[i.key] } : i));
    return this.queueItems(items, opts);
  }

  /** Catalogues interrogeables par la recherche de paquets, avec leur disponibilité sur ce PC. */
  packageSources(): PackageSourceInfo[] {
    const ids: PackageSource[] = ['winget', 'msstore', 'scoop', 'choco'];
    const names: Record<PackageSource, string> = { winget: 'WinGet', msstore: 'Microsoft Store', scoop: 'Scoop', choco: 'Chocolatey' };
    return ids.map((id) => {
      if (FAKE) return { id, name: names[id], available: id === 'winget' || id === 'scoop', enabled: true };
      const p = getProvider(id);
      return { id, name: names[id], available: !!p && !!this.runtime.get(id)?.available, enabled: !!p && this.isEnabled(p) };
    });
  }

  searchPackages(query: string, sources: PackageSource[]) {
    const available = new Set(this.packageSources().filter((s) => s.available).map((s) => s.id));
    const wanted = sources.filter((s) => available.has(s));
    return FAKE ? fakePackageSearch(query, wanted) : searchPackages(query, wanted);
  }

  /** Installe des paquets absents du PC, trouvés par la recherche : mêmes tâches, file et historique que les mises à jour. */
  installPackages(list: PackageSearchResult[]): InstallJob[] {
    const available = new Set(this.packageSources().filter((s) => s.available).map((s) => s.id));
    const items = list.map((r): UpdateItem => {
      if (!available.has(r.source)) throw new Error(t('Source indisponible : {name}', { name: r.source }));
      const providerId = FAKE ? 'fake-pkg' : r.source;
      return {
        key: makeKey(providerId, safeId(r.id)),
        providerId,
        kind: 'package',
        id: r.id,
        name: r.name,
        availableVersion: r.version,
        source: r.source,
        iconName: r.name,
        requiresAdmin: r.source === 'choco',
        newInstall: true,
      };
    });
    return this.queueItems(items, {});
  }

  private queueItems(items: UpdateItem[], opts: InstallOptions): InstallJob[] {
    const byProvider = new Map<string, UpdateItem[]>();
    for (const u of [...items].sort(installOrder)) byProvider.set(u.providerId, [...(byProvider.get(u.providerId) ?? []), u]);
    const created: InstallJob[] = [];
    for (const [providerId, list] of byProvider) {
      const p = getProvider(providerId);
      if (!p) continue;
      const type: JobType = opts.downloadOnly ? 'download' : list.some((i) => i.targetVersion) ? 'rollback' : 'install';
      const job = this.newJob(type, providerId, list, { auto: opts.auto });
      job.previousVersions = Object.fromEntries(list.filter((i) => i.currentVersion).map((i) => [i.key, i.currentVersion!]));
      const useElevated = !!p.elevatedOps && (!p.install || list.some((i) => i.requiresAdmin)) && !(opts.downloadOnly && p.download);
      const q: QueuedJob = { job, downloadOnly: opts.downloadOnly };
      if (useElevated) {
        job.elevated = true;
        q.elevated = (ctx) => p.elevatedOps!(list, ctx);
      } else if (opts.downloadOnly && p.download) {
        q.runner = (ctx) => p.download!(list, ctx);
      } else if (p.install) {
        q.runner = (ctx) => this.withProcessHandling(job, list, ctx, () => p.install!(list, ctx));
      } else {
        continue;
      }
      this.enqueue(q);
      created.push(job);
    }
    return created;
  }

  retryJob(id: string): InstallJob[] {
    const src = this.jobs.find((j) => j.id === id);
    if (!src?.items.length) return [];
    // Installations lancées depuis la recherche : elles ne figurent pas parmi les mises à jour détectées.
    if (src.items.every((i) => i.newInstall)) return this.queueItems(src.items, {});
    const keys = src.items.map((i) => i.key);
    const versions = Object.fromEntries(src.items.filter((i) => i.targetVersion).map((i) => [i.key, i.targetVersion!]));
    return this.install(keys, { downloadOnly: src.type === 'download', versions });
  }

  private async withProcessHandling(job: InstallJob, items: UpdateItem[], ctx: Parameters<NonNullable<Provider['install']>>[1], fn: () => Promise<{ success: boolean; rebootRequired?: boolean }>) {
    const { run } = await import('../lib/exec');
    const relaunch: string[] = [];
    for (const i of items) {
      const o = this.settings.packageOptions[i.key];
      if (!o?.closeProcess) continue;
      const name = o.closeProcess.replace(/\.exe$/i, '');
      if (!/^[\w .-]+$/.test(name)) continue;
      const r = await run(
        'powershell.exe',
        ['-NoProfile', '-Command', `$p = Get-Process -Name '${name}' -ErrorAction SilentlyContinue; if ($p) { ($p | Select-Object -First 1).Path; $p | ForEach-Object { [void]$_.CloseMainWindow() }; Start-Sleep 5; $p | Where-Object { -not $_.HasExited } | Stop-Process -Force }`],
        { timeoutMs: 60_000 },
      );
      const path = r.stdout.trim().split(/\r?\n/)[0];
      if (path) {
        ctx.log(t('Application « {name} » fermée avant la mise à jour.', { name }));
        if (o.relaunch) relaunch.push(path);
      }
    }
    const res = await fn();
    if (res.success) {
      for (const path of relaunch) {
        ctx.log(t('Relance de {path}', { path }));
        await run('explorer.exe', [path]);
      }
    }
    job.relaunch = relaunch;
    return res;
  }

  runTask(type: JobType, providerId: string, runner: (log: (l: string) => void) => Promise<boolean>): InstallJob {
    const job = this.newJob(type, providerId, [], { simulated: undefined });
    this.enqueue({ job, runner: async (ctx) => ({ success: await runner(ctx.log) }) });
    return job;
  }

  runElevatedTask(type: JobType, providerId: string, items: UpdateItem[], ops: ElevatedOp[]): InstallJob {
    const job = this.newJob(type, providerId, items, { elevated: true });
    this.enqueue({ job, elevated: async () => ops });
    return job;
  }

  setupProvider(id: string): void {
    const p = getProvider(id);
    if (!p?.setup) return;
    this.runTask('setup', id, async (log) => {
      const ok = await p.setup!.run(log);
      await this.detect(p);
      return ok && this.runtime.get(id)!.available;
    });
  }

  runProviderAction(providerId: string, actionId: string): void {
    const p = getProvider(providerId);
    const a = p?.actions?.find((x) => x.id === actionId);
    if (!p || !a) return;
    if (a.elevatedOps) {
      this.runElevatedTask('setup', providerId, [], a.elevatedOps());
      return;
    }
    this.runTask('setup', providerId, async (log) => {
      const ok = await a.run(log);
      await this.detect(p);
      return ok;
    });
  }

  unhide(keys: string[]): void {
    const items = this.findItems(keys);
    if (items.length) this.runElevatedTask('unhide', items[0].providerId, items, [{ op: 'wu-unhide', ids: items.map((i) => i.id) }]);
  }

  driverRollback(jobId: string, key: string): void {
    const item = this.jobs.find((j) => j.id === jobId)?.items.find((i) => i.key === key);
    if (!item?.hardwareId) throw new Error(t('Identifiant matériel inconnu pour ce pilote.'));
    this.runElevatedTask('driver-rollback', item.providerId, [item], [{ op: 'driver-rollback', hardwareId: item.hardwareId }]);
  }

  forgetDevices(keys: string[]): void {
    const items = this.findItems(keys).filter((i) => i.deviceAbsent && i.hardwareId);
    if (!items.length) return;
    this.runElevatedTask(
      'forget-device',
      'windowsupdate',
      items,
      items.map((i) => ({ op: 'forget-device', hardwareId: i.hardwareId! })),
    );
  }

  forgetAllAbsent(): void {
    this.forgetDevices(providers.flatMap((p) => this.runtime.get(p.id)!.updates).filter((u) => u.deviceAbsent).map((u) => u.key));
  }

  rollback(jobId: string): InstallJob[] {
    const src = this.jobs.find((j) => j.id === jobId);
    if (!src?.previousVersions) return [];
    const p = getProvider(src.providerId);
    const items = src.items
      .filter((i) => src.previousVersions![i.key])
      .map((i) => ({ ...i, targetVersion: src.previousVersions![i.key], availableVersion: src.previousVersions![i.key], currentVersion: i.availableVersion }));
    if (!p || !items.length) return [];
    const job = this.newJob('rollback', p.id, items);
    if (p.install && !items.some((i) => i.requiresAdmin)) {
      this.enqueue({ job, runner: (ctx) => p.install!(items, ctx) });
    } else if (p.elevatedOps) {
      job.elevated = true;
      this.enqueue({ job, elevated: (ctx) => p.elevatedOps!(items, ctx) });
    }
    return [job];
  }

  cancelJob(id: string): void {
    this.queue.cancel(id);
  }

  moveJob(id: string, delta: -1 | 1): void {
    this.queue.move(id, delta);
  }

  private onJobDone(job: InstallJob, _q: QueuedJob): void {
    saveJson('history.json', this.jobs);
    if (job.items.some((i) => i.newInstall)) invalidateInstalled();
    this.emit('job-done', job);
    this.changed();
    if (job.type === 'forget-device' || job.type === 'unhide') void this.checkProvider('windowsupdate');
    else if (job.type !== 'download' && job.items.length && !job.simulated) void this.checkProvider(job.providerId);
    if (job.type === 'cleanup') this.invalidate();
  }

  clearHistory(): void {
    this.jobs.splice(0, this.jobs.length, ...this.jobs.filter((j) => j.status === 'running' || j.status === 'queued'));
    saveJson('history.json', this.jobs);
    this.changed();
  }

  async details(key: string): Promise<UpdateDetails> {
    const item = this.findItems([key])[0];
    if (!item) return {};
    if (this.detailsCache.has(key)) return this.detailsCache.get(key)!;
    const p = getProvider(item.providerId);
    const d: UpdateDetails = { publisher: item.publisher, homepage: item.homepage, releaseNotesUrl: item.releaseNotesUrl, publishedAt: item.publishedAt, sizeBytes: item.sizeBytes };
    try {
      const extra = (await p?.details?.(item)) ?? {};
      for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') (d as Record<string, unknown>)[k] = v;
    } catch (err) {
      d.extra = { [t('Erreur')]: String(err) };
    }
    const repo = githubRepo(d.releaseNotesUrl) ?? githubRepo(d.homepage) ?? githubRepo(item.homepage);
    if (repo && item.currentVersion) {
      d.releaseNotesBetween = await githubNotesBetween(repo, item.currentVersion, item.availableVersion).catch(() => undefined);
    }
    this.detailsCache.set(key, d);
    return d;
  }

  async listVersions(key: string): Promise<string[]> {
    const item = this.findItems([key])[0];
    const p = item && getProvider(item.providerId);
    return p?.listVersions ? p.listVersions(item) : [];
  }

  getTrace(providerId: string): string {
    return this.runtime.get(providerId)?.trace ?? '';
  }

  inventory(force = false): Promise<InventoryItem[]> {
    const key = JSON.stringify(this.settings.trackedPrograms);
    if (force || !this.invCache || this.invCache.key !== key || Date.now() - this.invCache.at > 15 * 60_000) {
      const data = readInventory(this.settings.trackedPrograms);
      this.invCache = { at: Date.now(), key, data };
      data.catch(() => (this.invCache = undefined));
    }
    return this.invCache.data;
  }

  hardware(force = false): Promise<HardwareInfo> {
    if (force || !this.hwCache || Date.now() - this.hwCache.at > 3600_000) {
      const data = readHardware(this.system);
      this.hwCache = { at: Date.now(), data };
      data.catch(() => (this.hwCache = undefined));
    }
    return this.hwCache.data;
  }

  security(force = false): Promise<SecurityReport> {
    if (force || !this.securityCache || Date.now() - this.securityCache.at > 30 * 60_000) {
      const data = (async (): Promise<SecurityReport> => {
        const [checks, eol] = FAKE
          ? [fakeSecurityChecks(), fakeEol()]
          : await Promise.all([securityChecks(this.system), this.settings.securityFeeds.eol ? eolReport().catch(() => []) : Promise.resolve([])]);
        const visible = this.visibleUpdates();
        return {
          checks,
          eol,
          securityUpdates: visible.filter((u) => u.security).length,
          exploited: visible.filter((u) => u.exploited).length,
          cves: new Set(visible.flatMap((u) => u.cves ?? [])).size,
          generatedAt: Date.now(),
        };
      })();
      this.securityCache = { at: Date.now(), data };
      data.catch(() => (this.securityCache = undefined));
    }
    return this.securityCache.data;
  }

  cleanupList(): Promise<CleanupItem[]> {
    return listCleanup();
  }

  runCleanup(id: string, requiresAdmin: boolean): void {
    if (requiresAdmin) {
      const ops = cleanupOps(id);
      if (ops.length) this.runElevatedTask('cleanup', 'cleanup', [], ops);
    } else {
      this.runTask('cleanup', 'cleanup', (log) => cleanUser(id, log));
    }
  }

  warmCaches(): void {
    if (FAKE) return;
    void this.hardware().catch(() => undefined);
    void this.inventory().catch(() => undefined);
  }

  private invalidate(): void {
    this.invCache = undefined;
    this.hwCache = undefined;
  }

  searchWinget(q: string) {
    return searchWinget(q);
  }

  trackProgram(arpName: string, wingetId: string | null): void {
    const tracked = { ...this.settings.trackedPrograms };
    if (wingetId) tracked[arpName] = wingetId;
    else delete tracked[arpName];
    this.updateSettings({ trackedPrograms: tracked });
    void this.checkProvider('winget');
  }

  monthlyStats(): MonthlyStat[] {
    const map = new Map<string, MonthlyStat>();
    for (const j of this.jobs) {
      if (j.status !== 'success' || j.type === 'download' || !j.finishedAt || j.simulated) continue;
      const d = new Date(j.finishedAt);
      const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const s = map.get(month) ?? { month, package: 0, driver: 0, firmware: 0, system: 0 };
      for (const i of j.items) s[i.kind]++;
      map.set(month, s);
    }
    return [...map.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-12);
  }

  historyCsv(ids?: string[]): string {
    const rows = [[t('Date'), t('Type'), t('Statut'), t('Source'), t('Élément'), t('Version avant'), t('Version après'), t('Redémarrage'), t('Erreur')].join(';')];
    for (const j of this.jobs) {
      if (ids && !ids.includes(j.id)) continue;
      const items = j.items.length ? j.items : [{ name: j.type, currentVersion: '', availableVersion: '' } as UpdateItem];
      for (const i of items) {
        rows.push(
          [
            new Date(j.finishedAt ?? j.queuedAt).toLocaleString(),
            j.type,
            j.simulated ? `${j.status} (simulation)` : j.status,
            getProvider(j.providerId)?.name ?? j.providerId,
            i.name,
            j.previousVersions?.[i.key] ?? i.currentVersion,
            i.targetVersion ?? i.availableVersion,
            j.rebootRequired ? 'oui' : '',
            j.errorHint ?? '',
          ]
            .map(csvEscape)
            .join(';'),
        );
      }
    }
    return '﻿' + rows.join('\r\n');
  }

  setHelper(enabled: boolean): void {
    this.runTask('setup', 'helper', async (log) => {
      const ok = enabled ? await installHelper(log) : await uninstallHelper(log);
      this.helper = await helperStatus();
      this.updateSettings({ useElevatedHelper: enabled && this.helper === 'ok' });
      return ok;
    });
  }

  setCheckTaskInstalled(v: boolean): void {
    this.checkTaskInstalled = v;
    this.changed();
  }

  scheduleReboot(delaySeconds: number): Promise<void> {
    return this.reboot.schedule(delaySeconds);
  }

  cancelReboot(): Promise<void> {
    return this.reboot.cancel();
  }

  dismissReboot(): void {
    this.reboot.dismiss();
  }

  setActiveProfile(id: string): void {
    if (!this.settings.profiles.some((p) => p.id === id)) return;
    this.updateSettings({ activeProfile: id });
  }
}
