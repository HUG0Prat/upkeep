import {
  app,
  BrowserWindow,
  crashReporter,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  powerMonitor,
  screen,
  shell,
  systemPreferences,
  Tray,
} from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dataDir, downloadsDir, isPortable } from './lib/paths';
import { UpdateEngine } from './engine';
import { installCheckTask, isCheckTaskInstalled, removeCheckTask } from './lib/helper';
import { exportPackages, importPackages, type PackageBundle } from './lib/packages';
import { readArp } from './lib/inventory';
import { createDiagnosticZip, installConsoleLogging, logsDir } from './lib/logger';
import { disposePsPool } from './lib/psHost';
import { actionableToast, parseLink } from './notifications';
import { normalizeName } from '../shared/logic';
import { resolveLang, setLang, t } from '../shared/i18n';
import type { InstallOptions } from './engine';
import type { Settings, UpdateItem, WeeklySummary } from '../shared/types';

if (process.env.UPKEEP_GPU !== '1') app.disableHardwareAcceleration();

installConsoleLogging();
crashReporter.start({ uploadToServer: false });

if (isPortable() || process.env.UPKEEP_DATA) app.setPath('userData', dataDir());

const RES = join(app.getAppPath(), 'resources');
const APP_ID = app.isPackaged ? 'com.hug0prat.upkeep' : 'com.hug0prat.upkeep.dev';
const ICON = join(RES, 'icon.png');
app.setAppUserModelId(APP_ID);

const argv = process.argv;
const T0 = Date.now();
const perf = (label: string) => console.info(`[perf] ${label} : ${Date.now() - T0} ms`);
const CHECK_AND_EXIT = argv.includes('--check-and-exit');

let win: BrowserWindow | null = null;
let mini: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let windowShown = false;
const engine = new UpdateEngine();

if (process.defaultApp) app.setAsDefaultProtocolClient('upkeep', process.execPath, [app.getAppPath()]);
else app.setAsDefaultProtocolClient('upkeep');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, args) => {
    const link = args.find((a) => a.startsWith('upkeep://'));
    if (link) void handleLink(link);
    else if (args.includes('--check-and-exit')) void engine.checkAll();
    else showWindow();
  });
}

async function handleLink(url: string): Promise<void> {
  const p = parseLink(url);
  if (!p) return;
  if (p.kind === 'open') return showWindow(p.page);
  if (p.action === 'snooze') return engine.snooze(4);
  if (p.action === 'ignore') {
    for (const k of p.keys) engine.ignore(k, p.versions[k] ?? '*');
    return;
  }
  const items = engine.findItems(p.keys);
  const direct = items.filter((i) => i.kind !== 'firmware').map((i) => i.key);
  if (direct.length) engine.install(direct);
  showWindow(items.some((i) => i.kind === 'firmware') ? 'updates' : 'history');
}

function rendererUrl(hash = ''): { url?: string; file?: string; hash: string } {
  if (process.env.VITE_DEV_SERVER_URL) return { url: process.env.VITE_DEV_SERVER_URL + (hash ? `#${hash}` : ''), hash };
  return { file: join(__dirname, '../dist-renderer/index.html'), hash };
}


function bgColor(): string {
  return nativeTheme.shouldUseDarkColors ? '#0f1115' : '#f5f6f8';
}

function trustedUrl(url: string): boolean {
  if (process.env.VITE_DEV_SERVER_URL) return url.startsWith(process.env.VITE_DEV_SERVER_URL);
  return url.startsWith('file://') && decodeURIComponent(url).replace(/\\/g, '/').includes('/dist-renderer/index.html');
}

function hardenWebContents(wc: Electron.WebContents): void {
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (!trustedUrl(url)) e.preventDefault();
  });
  wc.on('will-redirect', (e, url) => {
    if (!trustedUrl(url)) e.preventDefault();
  });
  wc.on('will-attach-webview', (e) => e.preventDefault());
  wc.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
}

function createWindow(show: boolean): void {
  win = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 900,
    minHeight: 560,
    show: false,
    title: 'UpKeep',
    icon: ICON,
    backgroundColor: bgColor(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      disableBlinkFeatures: 'Auxclick',
    },
  });
  hardenWebContents(win.webContents);
  const r = rendererUrl();
  if (r.url) void win.loadURL(r.url);
  else void win.loadFile(r.file!);
  perf('création de la fenêtre');
  win.webContents.once('dom-ready', () => perf('DOM prêt'));
  win.webContents.once('did-finish-load', () => perf('chargement terminé'));
  win.once('ready-to-show', () => {
    windowShown = true;
    perf('fenêtre prête');
    if (show) win?.show();
  });
  win.on('close', (e) => {
    if (!quitting && engine.settings.minimizeToTray) {
      e.preventDefault();
      win?.hide();
    }
  });
  win.on('closed', () => (win = null));
}

function showWindow(page?: string): void {
  if (!win) createWindow(true);
  if (win?.isMinimized()) win.restore();
  win?.show();
  win?.focus();
  mini?.hide();
  if (page) win?.webContents.send('navigate', page);
}

function toggleMini(): void {
  if (mini?.isVisible()) {
    mini.hide();
    return;
  }
  if (!mini) {
    mini = new BrowserWindow({
      width: 380,
      height: 500,
      show: false,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: bgColor(),
      webPreferences: {
        preload: join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        disableBlinkFeatures: 'Auxclick',
      },
    });
    hardenWebContents(mini.webContents);
    const r = rendererUrl('mini');
    if (r.url) void mini.loadURL(r.url);
    else void mini.loadFile(r.file!, { hash: 'mini' });
    mini.on('blur', () => mini?.hide());
    mini.on('closed', () => (mini = null));
  }
  const tb = tray!.getBounds();
  const wa = screen.getDisplayNearestPoint({ x: tb.x, y: tb.y }).workArea;
  const [w, h] = mini.getSize();
  const x = Math.min(Math.max(wa.x, Math.round(tb.x + tb.width / 2 - w / 2)), wa.x + wa.width - w);
  const y = tb.y > wa.y + wa.height / 2 ? wa.y + wa.height - h - 8 : wa.y + 8;
  mini.setPosition(x, y);
  mini.show();
  mini.focus();
}

function updateTray(): void {
  if (!tray) return;
  const state = engine.getState();
  const n = state.updates.length;
  const checking = state.providers.some((p) => p.checking);
  tray.setImage(nativeImage.createFromPath(join(RES, n ? 'tray-alert.png' : 'tray.png')));
  tray.setToolTip(checking ? t('UpKeep — vérification en cours…') : t('UpKeep — {n} mise(s) à jour disponible(s)', { n }));
  const profiles = engine.settings.profiles.map((p) => ({
    label: p.name,
    type: 'radio' as const,
    checked: engine.settings.activeProfile === p.id,
    click: () => engine.setActiveProfile(p.id),
  }));
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: t('{n} mise(s) à jour disponible(s)', { n }), enabled: false },
      { type: 'separator' },
      { label: t('Ouvrir UpKeep'), click: () => showWindow() },
      { label: t('Vérifier maintenant'), enabled: !checking, click: () => void engine.checkAll() },
      { label: t('Profil'), submenu: profiles },
      { type: 'separator' },
      {
        label: t('Quitter'),
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function notify(title: string, body: string, page?: string): void {
  if (!engine.eff.notifications || !Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: ICON });
  n.on('click', () => showWindow(page));
  n.show();
}

function describeWeekly(w: WeeklySummary): string {
  const n = Object.values(w.installed).reduce((a, b) => a + b, 0);
  return t('{n} mise(s) à jour installée(s), {f} échec(s), {p} en attente, {q} en quarantaine.', { n, f: w.failed, p: w.pending, q: w.quarantined });
}

function describe(items: UpdateItem[]): string {
  const count = (k: UpdateItem['kind']) => items.filter((i) => i.kind === k).length;
  const parts = [
    count('package') && t('{n} paquet(s)', { n: count('package') }),
    count('system') && t('{n} mise(s) à jour Windows', { n: count('system') }),
    count('driver') && t('{n} pilote(s)', { n: count('driver') }),
    count('firmware') && t('{n} firmware/BIOS', { n: count('firmware') }),
  ].filter(Boolean);
  return parts.join(', ');
}

function applyLoginItem(settings: Settings): void {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: settings.launchAtStartup, args: ['--hidden'] });
}

let lastTask: string | null = null;
async function applySystemSettings(s: Settings): Promise<void> {
  nativeTheme.themeSource = s.theme;
  const lang = resolveLang(s.language, app.getLocale());
  setLang(lang);
  engine.lang = lang;
  applyLoginItem(s);
  const taskKey = s.useScheduledTask ? `on:${s.intervalMinutes}` : 'off';
  if (taskKey !== lastTask) {
    lastTask = taskKey;
    const exe = process.execPath;
    const args = app.isPackaged ? [] : [app.getAppPath()];
    if (s.useScheduledTask) await installCheckTask(exe, args, s.intervalMinutes);
    else if (await isCheckTaskInstalled()) await removeCheckTask();
    engine.setCheckTaskInstalled(await isCheckTaskInstalled());
  }
  updateTray();
}


const iconCache = new Map<string, string | null>();

async function iconsFor(names: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const missing = names.filter((n) => !iconCache.has(n));
  if (missing.length) {
    const arp = await readArp().catch(() => []);
    const byNorm = new Map(arp.filter((a) => a.iconPath).map((a) => [normalizeName(a.name), a.iconPath!]));
    for (const n of missing) {
      const norm = normalizeName(n);
      let path = byNorm.get(norm);
      if (!path) for (const [k, v] of byNorm) if (k.startsWith(norm) || norm.startsWith(k)) { path = v; break; }
      if (!path || !/\.(exe|ico|dll)$/i.test(path)) {
        iconCache.set(n, null);
        continue;
      }
      try {
        const img = await app.getFileIcon(path, { size: 'normal' });
        iconCache.set(n, img.isEmpty() ? null : img.toDataURL());
      } catch {
        iconCache.set(n, null);
      }
    }
  }
  for (const n of names) {
    const v = iconCache.get(n);
    if (v) out[n] = v;
  }
  return out;
}


async function saveDialog(defaultName: string, filters: Electron.FileFilter[], content: string): Promise<string | null> {
  const r = await dialog.showSaveDialog(win ?? undefined!, { defaultPath: join(app.getPath('documents'), defaultName), filters });
  if (r.canceled || !r.filePath) return null;
  await writeFile(r.filePath, content, 'utf8');
  return r.filePath;
}

async function openDialog(filters: Electron.FileFilter[]): Promise<string | null> {
  const r = await dialog.showOpenDialog(win ?? undefined!, { properties: ['openFile'], filters });
  if (r.canceled || !r.filePaths[0]) return null;
  return (await readFile(r.filePaths[0], 'utf8')).replace(/^﻿/, '');
}

function registerIpc(): void {
  const h = (channel: string, fn: (e: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown) =>
    ipcMain.handle(channel, (e, ...args) => {
      if (!trustedUrl(e.senderFrame?.url ?? '')) throw new Error('Appel IPC refusé : origine inconnue');
      return fn(e, ...args);
    });
  h('state:get', () => engine.getState());
  h('settings:set', (_e, patch: Partial<Settings>) => engine.updateSettings(patch));
  h('check:all', () => engine.checkAll());
  h('check:provider', (_e, id: string) => engine.checkProvider(id));
  h('install', async (_e, keys: string[], opts: InstallOptions = {}) => {
    const items = engine.visibleUpdates().filter((u) => keys.includes(u.key));
    if (!opts.downloadOnly) await engine.firmwareGuard(items);
    return engine.install(keys, opts).map((j) => j.id);
  });
  h('ignore', (_e, key: string, version: string) => engine.ignore(key, version));
  h('unignore', (_e, key: string) => engine.unignore(key));
  h('unhide', (_e, keys: string[]) => engine.unhide(keys));
  h('provider:setup', (_e, id: string) => engine.setupProvider(id));
  h('provider:action', (_e, id: string, action: string) => engine.runProviderAction(id, action));
  h('provider:trace', (_e, id: string) => engine.getTrace(id));
  h('item:details', (_e, key: string) => engine.details(key));
  h('item:versions', (_e, key: string) => engine.listVersions(key));
  h('job:cancel', (_e, id: string) => engine.cancelJob(id));
  h('job:log', (_e, id: string) => engine.jobLog(id));
  h('job:retry', (_e, id: string) => engine.retryJob(id).map((j) => j.id));
  h('devices:forget', (_e, keys: string[]) => engine.forgetDevices(keys));
  h('devices:forgetAll', () => engine.forgetAllAbsent());
  h('security:get', (_e, force?: boolean) => engine.security(force));
  h('cleanup:list', () => engine.cleanupList());
  h('cleanup:run', (_e, id: string, admin: boolean) => engine.runCleanup(id, admin));
  h('weekly:get', () => engine.weeklySummary());
  h('notifications:snooze', (_e, hours: number) => engine.snooze(hours));
  h('logs:open', () => shell.openPath(logsDir()));
  h('diagnostics:create', async () => {
    const r = await dialog.showSaveDialog(win ?? undefined!, {
      defaultPath: join(app.getPath('documents'), `upkeep-diagnostic-${new Date().toISOString().slice(0, 10)}.zip`),
      filters: [{ name: 'Zip', extensions: ['zip'] }],
    });
    if (r.canceled || !r.filePath) return null;
    const st = engine.getState();
    return createDiagnosticZip(r.filePath, app.getPath('crashDumps'), {
      version: app.getVersion(),
      electron: process.versions.electron,
      system: st.system,
      providers: st.providers.map((p) => ({ id: p.id, available: p.available, enabled: p.enabled, error: p.error })),
      policy: st.policy,
    });
  });
  h('job:move', (_e, id: string, delta: -1 | 1) => engine.moveJob(id, delta));
  h('job:rollback', (_e, id: string) => engine.rollback(id).map((j) => j.id));
  h('job:driverRollback', (_e, id: string, key: string) => engine.driverRollback(id, key));
  h('history:clear', () => engine.clearHistory());
  h('history:csv', async (_e, ids?: string[]) => saveDialog(`upkeep-historique-${new Date().toISOString().slice(0, 10)}.csv`, [{ name: 'CSV', extensions: ['csv'] }], engine.historyCsv(ids)));
  h('history:stats', () => engine.monthlyStats());
  h('reboot:schedule', (_e, delaySeconds: number) => engine.scheduleReboot(delaySeconds));
  h('reboot:cancel', () => engine.cancelReboot());
  h('reboot:dismiss', () => engine.dismissReboot());
  h('inventory:get', (_e, force?: boolean) => engine.inventory(force));
  h('inventory:search', (_e, q: string) => engine.searchWinget(q));
  h('inventory:track', (_e, name: string, id: string | null) => engine.trackProgram(name, id));
  h('hardware:get', (_e, force?: boolean) => engine.hardware(force));
  h('icons:get', (_e, names: string[]) => iconsFor(names));
  h('profile:set', (_e, id: string) => engine.setActiveProfile(id));
  h('helper:set', (_e, enabled: boolean) => engine.setHelper(enabled));
  h('settings:export', () =>
    saveDialog('upkeep-parametres.json', [{ name: 'JSON', extensions: ['json'] }], JSON.stringify({ format: 'upkeep-settings', version: 1, settings: engine.settings }, null, 2)),
  );
  h('settings:import', async () => {
    const text = await openDialog([{ name: 'JSON', extensions: ['json'] }]);
    if (!text) return false;
    const j = JSON.parse(text) as { format?: string; settings?: Partial<Settings> };
    if (j.format !== 'upkeep-settings' || !j.settings) throw new Error(t('Fichier de paramètres UpKeep invalide.'));
    engine.replaceSettings(j.settings);
    return true;
  });
  h('packages:export', async () => {
    let bundle: PackageBundle | null = null;
    engine.runTask('import', 'packages', async (log) => {
      bundle = await exportPackages(log);
      const path = await saveDialog(`upkeep-paquets-${process.env.COMPUTERNAME ?? 'pc'}.json`, [{ name: 'JSON', extensions: ['json'] }], JSON.stringify(bundle, null, 2));
      log(path ? t('Exporté vers {path}', { path }) : t('Export annulé.'));
      return !!path;
    });
  });
  h('packages:import', async () => {
    const text = await openDialog([{ name: 'JSON', extensions: ['json'] }]);
    if (!text) return false;
    const bundle = JSON.parse(text) as PackageBundle;
    const ctrl = new AbortController();
    engine.runTask('import', 'packages', (log) => importPackages(bundle, log, ctrl.signal));
    return true;
  });
  h('app:openExternal', (_e, url: string) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url);
  });
  h('app:openDownloads', () => shell.openPath(downloadsDir()));
  h('app:showMain', (_e, page?: string) => showWindow(page));
  h('app:quit', () => {
    quitting = true;
    app.quit();
  });
  h('app:accent', () => (process.platform === 'win32' ? `#${systemPreferences.getAccentColor().slice(0, 6)}` : null));
  h('app:changelog', async () => readFile(join(RES, 'CHANGELOG.md'), 'utf8').catch(() => ''));
  ipcMain.on('badge:set', (_e, dataUrl: string | null, label: string) => {
    if (!win) return;
    win.setOverlayIcon(dataUrl ? nativeImage.createFromDataURL(dataUrl) : null, label);
  });
  ipcMain.on('net:online', (_e, online: boolean) => engine.setOnline(online));
}

app.whenReady().then(async () => {
  perf('Electron prêt');
  Menu.setApplicationMenu(null);
  engine.appVersion = app.getVersion();
  engine.portable = isPortable();

  const profileArg = argv.find((a) => a.startsWith('--profile='))?.split('=')[1];
  engine.setActiveProfile(profileArg ?? engine.settings.defaultProfile);
  const lang = resolveLang(engine.settings.language, app.getLocale());
  setLang(lang);
  engine.lang = lang;
  registerIpc();
  const systemSettings = applySystemSettings(engine.settings);

  if (CHECK_AND_EXIT) {
    await systemSettings;
    engine.on('new-updates', (items: UpdateItem[]) => notify(t('Nouvelles mises à jour disponibles'), describe(items)));
    await engine.init();
    await engine.checkAll();
    setTimeout(() => app.quit(), 8_000);
    return;
  }

  const hidden = argv.includes('--hidden') || engine.settings.startHidden;
  createWindow(!hidden);

  tray = new Tray(nativeImage.createFromPath(join(RES, 'tray.png')));
  tray.on('click', toggleMini);
  tray.on('double-click', () => showWindow());
  updateTray();

  engine.on('state', (state) => {
    win?.webContents.send('state', state);
    mini?.webContents.send('state', state);
    updateTray();
  });
  engine.on('settings', (s: Settings) => void applySystemSettings(s));
  engine.on('new-updates', (items: UpdateItem[]) => {
    if (!engine.eff.notifications || !Notification.isSupported()) return;
    const sec = items.filter((i) => i.security);
    const exploited = items.filter((i) => i.exploited);
    const title = exploited.length
      ? t('Faille activement exploitée : mise à jour urgente')
      : sec.length
        ? t('Mises à jour de sécurité disponibles')
        : t('Nouvelles mises à jour disponibles');
    actionableToast({ title, body: describe(items), icon: ICON, items, onClick: () => showWindow('updates') });
  });
  engine.on('weekly-summary', (w: WeeklySummary) => notify(t('Résumé de la semaine'), describeWeekly(w), 'dashboard'));
  engine.on('job-done', (job) => {
    if (job.type === 'setup' && !job.items.length && job.status === 'success') return;
    const ok = job.status === 'success';
    const what = job.items.length ? t('{n} élément(s)', { n: job.items.length }) : t('Tâche');
    if (job.status === 'cancelled') return;
    notify(ok ? t('Mise à jour terminée') : t('Échec de la mise à jour'), `${what}${job.rebootRequired ? t(' — redémarrage requis') : ''}`, 'history');
  });
  engine.on('reboot-reminder', () => notify(t('Redémarrage en attente'), t('Des mises à jour attendent un redémarrage pour être finalisées.')));
  engine.on('reboot-scheduled', (at: number) =>
    notify(t('Redémarrage planifié'), t('Redémarrage automatique prévu à {time}, après vos heures d’activité.', { time: new Date(at).toLocaleTimeString() })),
  );

  powerMonitor.on('resume', () => {
    if (engine.settings.checkOnResume) setTimeout(() => void engine.checkStale(30), 15_000);
  });
  powerMonitor.on('on-battery', () => engine.setPower(true));
  powerMonitor.on('on-ac', () => engine.setPower(false));
  systemPreferences.on('accent-color-changed', () => win?.webContents.send('accent-changed'));
  nativeTheme.on('updated', () => win?.setBackgroundColor(bgColor()));

  await new Promise<void>((resolve) => {
    if (!win || windowShown) return resolve();
    win.once('ready-to-show', () => setTimeout(resolve, 50));
    setTimeout(resolve, 5_000);
  });
  await engine.init();
  perf('moteur initialisé');
  if (engine.settings.checkOnStartup)
    void engine.startupCheck().then(async () => {
      perf('première vérification terminée');
      const m = await process.getProcessMemoryInfo();
      const total = app.getAppMetrics().reduce((s, x) => s + x.memory.workingSetSize, 0);
      console.info(`[perf] mémoire : principal ${Math.round(m.private / 1024)} Mo, tous processus ${Math.round(total / 1024)} Mo, état ${Math.round(JSON.stringify(engine.getState()).length / 1024)} Ko`);
      console.info(`[perf] processus : ${app.getAppMetrics().map((x) => `${x.type}=${Math.round(x.memory.workingSetSize / 1024)} Mo`).join(', ')}`);
    });
  const link = argv.find((a) => a.startsWith('upkeep://'));
  if (link) void handleLink(link);
});

app.on('before-quit', () => {
  quitting = true;
  engine.dispose();
  disposePsPool();
});
app.on('window-all-closed', () => {
  if (!engine.settings.minimizeToTray) app.quit();
});
