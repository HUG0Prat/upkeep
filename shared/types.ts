export type Lang = 'fr' | 'en' | 'de' | 'es';

export type UpdateKind = 'package' | 'driver' | 'firmware' | 'system';
export type Severity = 'critical' | 'important' | 'recommended' | 'optional';

export interface UpdateItem {
  key: string;
  providerId: string;
  kind: UpdateKind;
  id: string;
  name: string;
  currentVersion?: string;
  availableVersion?: string;
  currentDate?: string;
  availableDate?: string;
  publishedAt?: number;
  firstSeen?: number;
  quarantineUntil?: number;
  source?: string;
  category?: string;
  details?: string;
  publisher?: string;
  homepage?: string;
  releaseNotesUrl?: string;
  sizeBytes?: number;
  requiresReboot?: boolean;
  requiresAdmin?: boolean;
  deviceAbsent?: boolean;
  hardwareId?: string;
  hiddenByWindows?: boolean;
  preview?: boolean;
  severity?: Severity;
  security?: boolean;
  cves?: string[];
  alsoVia?: string[];
  iconName?: string;
  supportsVersions?: boolean;
  supportsDownload?: boolean;
  targetVersion?: string;
  exploited?: boolean;
  optional?: boolean;
  manualUrl?: string;
}

export interface UpdateDetails {
  description?: string;
  publisher?: string;
  license?: string;
  homepage?: string;
  releaseNotesUrl?: string;
  releaseNotes?: string;
  releaseNotesBetween?: string;
  publishedAt?: number;
  sizeBytes?: number;
  extra?: Record<string, string>;
}

export interface ProviderInfo {
  id: string;
  name: string;
  kind: UpdateKind;
  group: string;
  description: string;
  applicable: boolean;
  available: boolean;
  enabled: boolean;
  checking: boolean;
  lastCheck?: number;
  nextCheck?: number;
  error?: string;
  count: number;
  setupLabel?: string;
  hasTrace: boolean;
  durationMs?: number;
  actions?: { id: string; label: string }[];
  note?: string;
  experimental?: boolean;
  autoUpdate: boolean;
  intervalMinutes: number;
  timeoutMinutes: number;
}

export type JobStatus = 'queued' | 'running' | 'success' | 'partial' | 'failed' | 'cancelled' | 'interrupted';
export type JobType = 'install' | 'setup' | 'download' | 'rollback' | 'driver-rollback' | 'unhide' | 'import' | 'forget-device' | 'cleanup';

export interface InstallJob {
  id: string;
  type: JobType;
  providerId: string;
  items: UpdateItem[];
  status: JobStatus;
  queuedAt: number;
  startedAt?: number;
  finishedAt?: number;
  log: string[];
  rebootRequired?: boolean;
  progress?: number;
  errorHint?: string;
  auto?: boolean;
  attempt?: number;
  elevated?: boolean;
  previousVersions?: Record<string, string>;
  relaunch?: string[];
  simulated?: boolean;
  logLength?: number;
}

export interface PackageOptions {
  scope?: 'user' | 'machine';
  architecture?: 'x64' | 'x86' | 'arm64';
  customArgs?: string;
  closeProcess?: string;
  relaunch?: boolean;
}

export type RuleAction = 'ignore' | 'auto' | 'never-auto' | 'silent';
export type RuleField = 'any' | 'name' | 'id' | 'source' | 'publisher';

export interface Rule {
  id: string;
  pattern: string;
  field: RuleField;
  action: RuleAction;
  enabled: boolean;
}

export interface ProfileOverrides {
  providers?: Record<string, boolean>;
  notifications?: boolean;
  intervalMinutes?: number;
  autoUpdatesEnabled?: boolean;
  autoReboot?: boolean;
  respectFocus?: boolean;
  skipOnMetered?: boolean;
}

export interface Profile {
  id: string;
  name: string;
  overrides: ProfileOverrides;
}

export type SortKey = 'name' | 'source' | 'size' | 'date' | 'kind';

export interface Settings {
  intervalMinutes: number;
  checkOnStartup: boolean;
  notifications: boolean;
  minimizeToTray: boolean;
  launchAtStartup: boolean;
  startHidden: boolean;
  includeUnknownVersions: boolean;
  hideAbsentDevices: boolean;
  providers: Record<string, boolean>;
  ignored: Record<string, string>;

  providerTimeouts: Record<string, number>;
  providerIntervals: Record<string, number>;
  cacheMinutes: number;
  retryOnFailure: boolean;
  showWindowsHidden: boolean;
  hidePreview: boolean;

  restorePoint: boolean;
  requireAcForFirmware: boolean;
  minBatteryForFirmware: number;
  suspendBitLocker: boolean;
  packageOptions: Record<string, PackageOptions>;
  maxParallelJobs: number;
  retryNetworkErrors: boolean;
  useElevatedHelper: boolean;

  autoUpdatesEnabled: boolean;
  autoUpdate: { providers: Record<string, boolean>; packages: Record<string, 'auto' | 'never'> };
  autoWindow: { enabled: boolean; start: string; end: string; days: number[] };
  skipOnMetered: boolean;
  skipOnBatteryBelow: number;
  respectFocus: boolean;
  quarantineDays: number;
  showQuarantined: boolean;
  pins: Record<string, string>;
  rules: Rule[];
  useScheduledTask: boolean;
  checkOnResume: boolean;
  profiles: Profile[];
  activeProfile: string;
  defaultProfile: string;
  autoReboot: boolean;
  rebootReminderHours: number;

  theme: 'system' | 'light' | 'dark';
  useSystemAccent: boolean;
  sort: { key: SortKey; dir: 'asc' | 'desc' };
  groupBy: 'none' | 'source' | 'kind';
  language: 'auto' | 'fr' | 'en' | 'de' | 'es';
  onboarded: boolean;
  taskbarBadge: boolean;

  simulateInstalls: boolean;
  respectPolicies: boolean;
  maxParallelChecks: number;
  hideOptionalDrivers: boolean;
  weeklySummary: boolean;
  securityFeeds: { eol: boolean; kev: boolean; nvd: boolean };
  snoozeUntil: number;
  compact: boolean;
  columns: { source: boolean; installed: boolean; available: boolean; size: boolean; date: boolean };

  nvidiaBranch: 'game' | 'studio';
  wslPrerelease: boolean;
  trackedPrograms: Record<string, string>;
}

export interface SystemInfo {
  manufacturer: string;
  model: string;
  biosVersion: string;
  biosDate?: string;
  os: string;
}

export interface Conditions {
  metered: boolean;
  onBattery: boolean;
  batteryLevel?: number;
  focusBusy: boolean;
  online: boolean;
}

export interface UpdatePolicy {
  wsusServer?: string;
  intune: boolean;
  driversExcluded: boolean;
}

export interface AppState {
  updates: UpdateItem[];
  providers: ProviderInfo[];
  jobs: InstallJob[];
  lastFullCheck?: number;
  nextCheck?: number;
  system?: SystemInfo;
  isAdmin: boolean;
  settings: Settings;
  effective: Settings;
  hiddenAbsent: number;
  hiddenQuarantine: number;
  hiddenPreview: number;
  hiddenByWindows: number;
  pendingReboot: boolean;
  scheduledReboot?: number;
  conditions: Conditions;
  policy: UpdatePolicy;
  helperInstalled: boolean;
  scheduledTaskInstalled: boolean;
  appVersion: string;
  portable: boolean;
  fake: boolean;
  lang: Lang;
  autoBlockers: string[];
}

export interface InventoryItem {
  name: string;
  version?: string;
  publisher?: string;
  installDate?: string;
  sizeBytes?: number;
  source: 'arp' | 'store';
  managedBy: string[];
  wingetId?: string;
  iconPath?: string;
}

export interface GpuInfo {
  name: string;
  vendor: 'nvidia' | 'amd' | 'intel' | 'other';
  driverVersion?: string;
  driverDate?: string;
}

export interface VendorTool {
  name: string;
  installed: boolean;
  wingetId?: string;
  url: string;
}

export interface DiskInfo {
  model: string;
  firmware?: string;
  mediaType?: string;
  bus?: string;
  sizeGB?: number;
  vendor?: string;
  tool?: VendorTool;
}

export interface PeripheralInfo {
  vendor: string;
  name: string;
  tool?: VendorTool;
}

export interface HardwareInfo {
  cpu: string;
  ramGB: number;
  board?: string;
  gpus: GpuInfo[];
  disks: DiskInfo[];
  peripherals: PeripheralInfo[];
  battery?: { charge: number; onAc: boolean; health?: number };
  supportUrl?: string;
}

export type CheckStatus = 'ok' | 'warn' | 'bad' | 'unknown';

export interface SecurityCheck {
  id: string;
  label: string;
  status: CheckStatus;
  value: string;
  advice?: string;
}

export interface EolItem {
  product: string;
  installed: string;
  cycle: string;
  eol: string | false;
  status: 'ok' | 'soon' | 'eol';
  latest?: string;
  link: string;
}

export interface SecurityReport {
  checks: SecurityCheck[];
  eol: EolItem[];
  securityUpdates: number;
  exploited: number;
  cves: number;
  generatedAt: number;
}

export interface CleanupItem {
  id: string;
  label: string;
  description: string;
  sizeBytes?: number;
  count?: number;
  requiresAdmin: boolean;
}

export interface WeeklySummary {
  from: number;
  to: number;
  installed: Record<UpdateKind, number>;
  failed: number;
  ignored: number;
  quarantined: number;
  pending: number;
}

export interface MonthlyStat {
  month: string;
  package: number;
  driver: number;
  firmware: number;
  system: number;
}

export const BUILTIN_PROFILES: Profile[] = [
  { id: 'default', name: 'Standard', overrides: {} },
  {
    id: 'work',
    name: 'Travail',
    overrides: { notifications: true, respectFocus: true, autoReboot: false },
  },
  {
    id: 'game',
    name: 'Jeu',
    overrides: { notifications: false, autoUpdatesEnabled: false, respectFocus: true, autoReboot: false, intervalMinutes: 720 },
  },
  {
    id: 'minimal',
    name: 'Minimal',
    overrides: { intervalMinutes: 1440, autoUpdatesEnabled: false, notifications: true },
  },
];

export const DEFAULT_SETTINGS: Settings = {
  intervalMinutes: 240,
  checkOnStartup: true,
  notifications: true,
  minimizeToTray: true,
  launchAtStartup: false,
  startHidden: false,
  includeUnknownVersions: false,
  hideAbsentDevices: true,
  providers: {},
  ignored: {},

  providerTimeouts: {},
  providerIntervals: {},
  cacheMinutes: 30,
  retryOnFailure: true,
  showWindowsHidden: false,
  hidePreview: false,

  restorePoint: true,
  requireAcForFirmware: true,
  minBatteryForFirmware: 50,
  suspendBitLocker: true,
  packageOptions: {},
  maxParallelJobs: 2,
  retryNetworkErrors: true,
  useElevatedHelper: false,

  autoUpdatesEnabled: false,
  autoUpdate: { providers: {}, packages: {} },
  autoWindow: { enabled: false, start: '02:00', end: '06:00', days: [0, 1, 2, 3, 4, 5, 6] },
  skipOnMetered: true,
  skipOnBatteryBelow: 30,
  respectFocus: true,
  quarantineDays: 3,
  showQuarantined: false,
  pins: {},
  rules: [],
  useScheduledTask: false,
  checkOnResume: true,
  profiles: BUILTIN_PROFILES,
  activeProfile: 'default',
  defaultProfile: 'default',
  autoReboot: false,
  rebootReminderHours: 4,

  theme: 'system',
  useSystemAccent: true,
  sort: { key: 'name', dir: 'asc' },
  groupBy: 'none',
  language: 'auto',
  onboarded: false,
  taskbarBadge: true,

  simulateInstalls: false,
  respectPolicies: true,
  maxParallelChecks: 4,
  hideOptionalDrivers: false,
  weeklySummary: true,
  securityFeeds: { eol: true, kev: true, nvd: true },
  snoozeUntil: 0,
  compact: false,
  columns: { source: true, installed: true, available: true, size: true, date: true },

  nvidiaBranch: 'game',
  wslPrerelease: false,
  trackedPrograms: {},
};

export const KIND_ORDER: Record<UpdateKind, number> = { package: 0, system: 1, driver: 2, firmware: 3 };
