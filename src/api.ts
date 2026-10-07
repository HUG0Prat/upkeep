import type { UpKeepAPI } from '../electron/preload';
import { intlLocale, t } from '../shared/i18n';
import type { AppState, Settings, UpdateKind } from '../shared/types';

declare global {
  interface Window {
    upkeep: UpKeepAPI;
  }
}

const pending: { id: number; patch: Partial<Settings> }[] = [];
let seq = 0;
let localListener: ((patch: Partial<Settings>) => void) | null = null;

export function onLocalSettings(cb: (patch: Partial<Settings>) => void): void {
  localListener = cb;
}

export function withPendingSettings(state: AppState): AppState {
  if (!pending.length) return state;
  return { ...state, settings: pending.reduce((acc, p) => ({ ...acc, ...p.patch }), state.settings) };
}

function setSettingsOptimistic(patch: Partial<Settings>): Promise<Settings> {
  const entry = { id: ++seq, patch };
  pending.push(entry);
  localListener?.(patch);
  return window.upkeep.setSettings(patch).finally(() => {
    const i = pending.findIndex((p) => p.id === entry.id);
    if (i >= 0) pending.splice(i, 1);
  });
}

export const api = { ...window.upkeep, setSettings: setSettingsOptimistic };

export function formatDate(ts?: number): string {
  if (!ts) return t('jamais');
  return new Date(ts).toLocaleString(intlLocale(), { dateStyle: 'short', timeStyle: 'short' });
}

export function formatDay(ts?: number): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString(intlLocale(), { dateStyle: 'medium' });
}

export function formatRelative(ts?: number): string {
  if (!ts) return '—';
  const diff = Math.round((ts - Date.now()) / 60_000);
  const rtf = new Intl.RelativeTimeFormat(intlLocale(), { numeric: 'auto' });
  if (Math.abs(diff) < 60) return rtf.format(diff, 'minute');
  if (Math.abs(diff) < 60 * 48) return rtf.format(Math.round(diff / 60), 'hour');
  return rtf.format(Math.round(diff / 1440), 'day');
}

export function formatSize(bytes?: number): string {
  if (!bytes) return '';
  const units = [t('o'), t('Ko'), t('Mo'), t('Go')];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

export const KIND_LABEL = (): Record<UpdateKind, string> => ({
  package: t('Paquets'),
  system: t('Windows'),
  driver: t('Pilotes'),
  firmware: t('Firmware & BIOS'),
});

export function blockerLabel(b: string): string {
  return t(b);
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
