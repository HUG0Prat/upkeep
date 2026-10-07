import type { Settings, SystemInfo, UpdateDetails, UpdateItem, UpdateKind, UpdatePolicy } from '../../shared/types';
import type { ElevatedOp } from '../lib/elevatedOps';

export interface CheckContext {
  settings: Settings;
  system: SystemInfo;
  policy?: UpdatePolicy;
  timeoutMs: number;
  trace: (label: string, text: string) => void;
}

export interface InstallContext {
  settings: Settings;
  log: (line: string) => void;
  progress: (pct: number) => void;
  signal: AbortSignal;
  downloadOnly?: boolean;
}

export interface InstallResult {
  success: boolean;
  rebootRequired?: boolean;
}

export interface ProviderAction {
  id: string;
  label: string;
  run(log: (line: string) => void): Promise<boolean>;
  elevatedOps?: () => ElevatedOp[];
}

export interface Provider {
  id: string;
  name: string;
  kind: UpdateKind;
  group: 'Paquets' | 'Développement' | 'Windows' | 'Pilotes & firmware' | 'Applications';
  description: string;
  experimental?: boolean;
  defaultEnabled?: boolean;
  isApplicable?(system: SystemInfo): boolean;
  detect(): Promise<boolean>;
  note?(): string | undefined;
  check(ctx: CheckContext): Promise<UpdateItem[]>;
  install?(items: UpdateItem[], ctx: InstallContext): Promise<InstallResult>;
  elevatedOps?(items: UpdateItem[], ctx: InstallContext): Promise<ElevatedOp[]>;
  download?(items: UpdateItem[], ctx: InstallContext): Promise<InstallResult>;
  listVersions?(item: UpdateItem): Promise<string[]>;
  details?(item: UpdateItem): Promise<UpdateDetails>;
  setup?: { label: string; run(log: (line: string) => void): Promise<boolean> };
  actions?: ProviderAction[];
  osvEcosystem?: string;
}

export function makeKey(providerId: string, id: string): string {
  return `${providerId}:${id}`;
}

export const REBOOT_MARK = 'REDÉMARRAGE REQUIS';
