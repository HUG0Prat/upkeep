import { EN } from './en';
import { DE } from './de';
import { ES } from './es';

import type { Lang } from './types';
export type { Lang };

let current: Lang = 'fr';

export function setLang(lang: Lang): void {
  current = lang;
}

export function getLang(): Lang {
  return current;
}

export function resolveLang(setting: 'auto' | Lang, locale: string): Lang {
  if (setting !== 'auto') return setting;
  const l = locale.slice(0, 2).toLowerCase();
  return l === 'fr' || l === 'de' || l === 'es' ? l : 'en';
}

export function t(fr: string, vars?: Record<string, string | number | undefined>): string {
  const dict = current === 'en' ? EN : current === 'de' ? DE : current === 'es' ? ES : null;
  const base = dict ? (dict[fr] ?? (current !== 'en' ? EN[fr] : undefined) ?? fr) : fr;
  return vars ? base.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? '')) : base;
}

export function intlLocale(): string {
  return { fr: 'fr-FR', en: 'en-GB', de: 'de-DE', es: 'es-ES' }[current];
}
