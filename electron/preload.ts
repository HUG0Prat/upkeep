import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AppState, CleanupItem, HardwareInfo, InventoryItem, MonthlyStat, SecurityReport, Settings, UpdateDetails, WeeklySummary } from '../shared/types';

type InstallOptions = { downloadOnly?: boolean; versions?: Record<string, string> };

const invoke = <T>(channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<T>;

function on<T>(channel: string, cb: (v: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, v: T) => cb(v);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const api = {
  getState: () => invoke<AppState>('state:get'),
  setSettings: (patch: Partial<Settings>) => invoke<Settings>('settings:set', patch),
  checkAll: () => invoke<void>('check:all'),
  checkProvider: (id: string) => invoke<void>('check:provider', id),
  install: (keys: string[], opts?: InstallOptions) => invoke<string[]>('install', keys, opts),
  ignore: (key: string, version: string) => invoke<void>('ignore', key, version),
  unignore: (key: string) => invoke<void>('unignore', key),
  unhide: (keys: string[]) => invoke<void>('unhide', keys),
  setupProvider: (id: string) => invoke<void>('provider:setup', id),
  providerAction: (id: string, action: string) => invoke<void>('provider:action', id, action),
  providerTrace: (id: string) => invoke<string>('provider:trace', id),
  details: (key: string) => invoke<UpdateDetails>('item:details', key),
  versions: (key: string) => invoke<string[]>('item:versions', key),
  cancelJob: (id: string) => invoke<void>('job:cancel', id),
  jobLog: (id: string) => invoke<string[]>('job:log', id),
  retryJob: (id: string) => invoke<string[]>('job:retry', id),
  forgetDevices: (keys: string[]) => invoke<void>('devices:forget', keys),
  forgetAllAbsent: () => invoke<void>('devices:forgetAll'),
  security: (force?: boolean) => invoke<SecurityReport>('security:get', force),
  cleanupList: () => invoke<CleanupItem[]>('cleanup:list'),
  runCleanup: (id: string, admin: boolean) => invoke<void>('cleanup:run', id, admin),
  weeklySummary: () => invoke<WeeklySummary>('weekly:get'),
  snooze: (hours: number) => invoke<void>('notifications:snooze', hours),
  openLogs: () => invoke<void>('logs:open'),
  createDiagnostics: () => invoke<string | null>('diagnostics:create'),
  moveJob: (id: string, delta: -1 | 1) => invoke<void>('job:move', id, delta),
  rollback: (id: string) => invoke<string[]>('job:rollback', id),
  driverRollback: (id: string, key: string) => invoke<void>('job:driverRollback', id, key),
  clearHistory: () => invoke<void>('history:clear'),
  exportHistoryCsv: (ids?: string[]) => invoke<string | null>('history:csv', ids),
  monthlyStats: () => invoke<MonthlyStat[]>('history:stats'),
  scheduleReboot: (delaySeconds: number) => invoke<void>('reboot:schedule', delaySeconds),
  cancelReboot: () => invoke<void>('reboot:cancel'),
  dismissReboot: () => invoke<void>('reboot:dismiss'),
  inventory: (force?: boolean) => invoke<InventoryItem[]>('inventory:get', force),
  searchWinget: (q: string) => invoke<{ name: string; id: string; version: string }[]>('inventory:search', q),
  trackProgram: (name: string, id: string | null) => invoke<void>('inventory:track', name, id),
  hardware: (force?: boolean) => invoke<HardwareInfo>('hardware:get', force),
  icons: (names: string[]) => invoke<Record<string, string>>('icons:get', names),
  setProfile: (id: string) => invoke<void>('profile:set', id),
  setHelper: (enabled: boolean) => invoke<void>('helper:set', enabled),
  exportSettings: () => invoke<string | null>('settings:export'),
  importSettings: () => invoke<boolean>('settings:import'),
  exportPackages: () => invoke<void>('packages:export'),
  importPackages: () => invoke<boolean>('packages:import'),
  openExternal: (url: string) => invoke<void>('app:openExternal', url),
  openDownloads: () => invoke<void>('app:openDownloads'),
  showMain: (page?: string) => invoke<void>('app:showMain', page),
  quit: () => invoke<void>('app:quit'),
  accentColor: () => invoke<string | null>('app:accent'),
  changelog: () => invoke<string>('app:changelog'),
  setBadge: (dataUrl: string | null, label: string) => ipcRenderer.send('badge:set', dataUrl, label),
  setOnline: (online: boolean) => ipcRenderer.send('net:online', online),
  onState: (cb: (state: AppState) => void) => on('state', cb),
  onNavigate: (cb: (page: string) => void) => on('navigate', cb),
  onAccentChanged: (cb: () => void) => on('accent-changed', cb),
};

export type UpKeepAPI = typeof api;

contextBridge.exposeInMainWorld('upkeep', api);
