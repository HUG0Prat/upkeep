import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppState } from '../../shared/types';
import { t } from '../../shared/i18n';
import { api } from '../api';
import { Icon, type IconName } from './Icon';
import { Highlight } from './ui';

export interface PaletteEntry {
  id: string;
  label: string;
  hint?: string;
  icon: IconName;
  run: () => void;
}

export function CommandPalette({ state, pages, go, onClose }: { state: AppState; pages: { id: string; label: string; icon: IconName }[]; go: (page: string, focus?: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const entries = useMemo<PaletteEntry[]>(() => {
    const list: PaletteEntry[] = [
      ...pages.map((p) => ({ id: `page:${p.id}`, label: p.label, hint: t('Page'), icon: p.icon, run: () => go(p.id) })),
      { id: 'act:check', label: t('Vérifier maintenant'), hint: t('Action'), icon: 'refresh' as const, run: () => void api.checkAll() },
      { id: 'act:installall', label: t('Tout mettre à jour'), hint: t('Action'), icon: 'download' as const, run: () => go('updates') },
      { id: 'act:snooze', label: t('Suspendre les notifications 4 h'), hint: t('Action'), icon: 'clock' as const, run: () => void api.snooze(4) },
      { id: 'act:security', label: t('Rapport de sécurité'), hint: t('Action'), icon: 'shield' as const, run: () => go('security') },
      { id: 'act:diag', label: t('Créer un rapport de diagnostic'), hint: t('Action'), icon: 'folder' as const, run: () => void api.createDiagnostics() },
      ...state.settings.profiles.map((p) => ({
        id: `profile:${p.id}`,
        label: t('Profil : {name}', { name: p.name }),
        hint: t('Profil'),
        icon: 'user' as const,
        run: () => void api.setProfile(p.id),
      })),
      ...state.updates.map((u) => ({
        id: `upd:${u.key}`,
        label: u.name,
        hint: `${u.currentVersion ?? ''} → ${u.availableVersion ?? ''}`,
        icon: 'download' as const,
        run: () => go('updates', u.key),
      })),
      ...state.providers
        .filter((p) => p.available || p.applicable)
        .map((p) => ({ id: `src:${p.id}`, label: t(p.name), hint: t('Source'), icon: 'layers' as const, run: () => go('sources') })),
      ...[
        ['general', t('Général')],
        ['auto', t('Automatisation')],
        ['rules', t('Règles')],
        ['profiles', t('Profils')],
        ['install', t('Installation')],
        ['appearance', t('Apparence')],
        ['backup', t('Sauvegarde')],
      ].map(([id, label]) => ({ id: `set:${id}`, label: `${t('Paramètres')} › ${label}`, hint: t('Réglage'), icon: 'settings' as const, run: () => go('settings', id) })),
    ];
    return list;
  }, [state.updates, state.providers, state.settings.profiles, pages]);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (s ? entries.filter((e) => `${e.label} ${e.hint ?? ''}`.toLowerCase().includes(s)) : entries).slice(0, 40);
  }, [entries, q]);

  useEffect(() => setSel(0), [q]);

  const choose = (e?: PaletteEntry) => {
    if (!e) return;
    onClose();
    e.run();
  };

  return (
    <div className="modal-backdrop palette-backdrop" onClick={onClose}>
      <div className="palette" role="dialog" aria-modal aria-label={t('Recherche globale')} onClick={(e) => e.stopPropagation()}>
        <label className="palette-input">
          <Icon name="search" />
          <input
            ref={input}
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            value={q}
            placeholder={t('Rechercher une page, une mise à jour, un réglage…')}
            aria-label={t('Recherche globale')}
            aria-controls="palette-list"
            aria-activedescendant={results[sel] ? `pal-${sel}` : undefined}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSel((x) => Math.min(results.length - 1, x + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSel((x) => Math.max(0, x - 1));
              } else if (e.key === 'Enter') choose(results[sel]);
              else if (e.key === 'Escape') onClose();
            }}
          />
          <kbd>Échap</kbd>
        </label>
        <ul id="palette-list" role="listbox" aria-label={t('Résultats')} tabIndex={-1} className="palette-list">
          {results.map((e, i) => (
            <li key={e.id} id={`pal-${i}`} role="option" aria-selected={i === sel} className={i === sel ? 'sel' : ''} onMouseEnter={() => setSel(i)} onClick={() => choose(e)}>
              <Icon name={e.icon} size={16} />
              <span className="palette-label">
                <Highlight text={e.label} query={q} />
              </span>
              {e.hint && <span className="muted small">{e.hint}</span>}
            </li>
          ))}
          {!results.length && <li className="muted">{t('Aucun résultat.')}</li>}
        </ul>
      </div>
    </div>
  );
}
