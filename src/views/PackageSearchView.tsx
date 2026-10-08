import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppState, PackageSearchResult, PackageSource, PackageSourceInfo } from '../../shared/types';
import { t } from '../../shared/i18n';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Highlight, Toast } from '../components/ui';

type Results = { results: PackageSearchResult[]; errors: Partial<Record<PackageSource, string>> };

// Conservé entre deux visites de la page.
let memo: { query: string; data: Results } | null = null;

const keyOf = (r: PackageSearchResult) => `${r.source}:${r.id}`;

export function PackageSearchView({ state, go }: { state: AppState; go: (page: string) => void }) {
  const [sources, setSources] = useState<PackageSourceInfo[]>([]);
  const [query, setQuery] = useState(memo?.query ?? '');
  const [data, setData] = useState<Results | null>(memo?.data ?? null);
  const [searched, setSearched] = useState(memo?.query ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hideInstalled, setHideInstalled] = useState(false);
  const [queued, setQueued] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const closeToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    void api.packageSources().then(setSources);
  }, [state.providers.map((p) => `${p.id}:${p.available}:${p.enabled}`).join()]);

  const usable = sources.filter((s) => s.available);
  const selected = new Set<PackageSource>(state.settings.searchSources ?? usable.filter((s) => s.enabled).map((s) => s.id));
  const active = usable.filter((s) => selected.has(s.id)).map((s) => s.id);

  const toggle = (id: PackageSource) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    void api.setSettings({ searchSources: usable.map((s) => s.id).filter((s) => next.has(s)) });
  };

  const search = (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = query.trim();
    if (q.length < 2 || !active.length || busy) return;
    setBusy(true);
    setError(null);
    api
      .searchPackages(q, active)
      .then((d) => {
        memo = { query: q, data: d };
        setData(d);
        setSearched(q);
      })
      .catch((err: Error) => setError(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
      .finally(() => setBusy(false));
  };

  const install = (r: PackageSearchResult) => {
    setQueued((s) => new Set(s).add(keyOf(r)));
    api
      .installPackages([r])
      .then(() => setToast(t('Installation de {name} ajoutée à la file.', { name: r.name })))
      .catch((err: Error) => {
        setQueued((s) => {
          const n = new Set(s);
          n.delete(keyOf(r));
          return n;
        });
        setError(err.message);
      });
  };

  const order = usable.map((s) => s.id);
  const visible = useMemo(() => {
    const q = searched.toLowerCase();
    const exact = (r: PackageSearchResult) => (r.name.toLowerCase() === q || r.id.toLowerCase().endsWith(q) ? 0 : 1);
    return (data?.results ?? [])
      .filter((r) => !hideInstalled || !r.installed)
      .map((r, i) => ({ r, i }))
      .sort((a, b) => exact(a.r) - exact(b.r) || order.indexOf(a.r.source) - order.indexOf(b.r.source) || a.i - b.i)
      .map((x) => x.r);
  }, [data, hideInstalled, searched, order.join()]);

  const sourceName = (id: PackageSource) => sources.find((s) => s.id === id)?.name ?? id;
  const errors = Object.entries(data?.errors ?? {}) as [PackageSource, string][];

  return (
    <div className="view">
      <header className="view-header">
        <div>
          <h1>{t('Rechercher des logiciels')}</h1>
          <p className="muted">{t('Trouvez un logiciel dans les catalogues de vos gestionnaires de paquets et installez-le.')}</p>
        </div>
      </header>
      <form className="toolbar" onSubmit={search} role="search">
        <div className="filters">
          <label className="search">
            <Icon name="search" size={16} />
            <input
              autoFocus
              placeholder={t('Nom ou identifiant (ex. vlc, 7zip)')}
              aria-label={t('Logiciel à rechercher')}
              value={query}
              maxLength={100}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <button className="btn primary" type="submit" disabled={busy || query.trim().length < 2 || !active.length}>
            <Icon name={busy ? 'refresh' : 'search'} className={busy ? 'spin' : ''} /> {t('Rechercher')}
          </button>
        </div>
        <label className="row small">
          <input type="checkbox" checked={hideInstalled} onChange={(e) => setHideInstalled(e.target.checked)} />
          {t('Masquer les logiciels déjà installés')}
        </label>
      </form>
      <div className="chips" role="group" aria-label={t('Catalogues')}>
        {sources.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`chip ${s.available && selected.has(s.id) ? 'active' : ''}`}
            aria-pressed={s.available && selected.has(s.id)}
            disabled={!s.available}
            title={s.available ? undefined : t('{name} n’est pas installé sur ce PC.', { name: s.name })}
            onClick={() => toggle(s.id)}
          >
            {s.available && selected.has(s.id) && <Icon name="check" size={14} />}
            {s.name}
            {!s.available && <span className="chip-count">{t('absent')}</span>}
          </button>
        ))}
      </div>
      {sources.length > 0 && !usable.length && <p className="muted small hint">{t('Aucun gestionnaire de paquets n’est installé sur ce PC (WinGet, Scoop ou Chocolatey).')}</p>}
      {error && <pre className="error-box">{error}</pre>}
      {errors.map(([s, e]) => (
        <pre key={s} className="error-box">
          {t('{name} : {error}', { name: sourceName(s), error: e })}
        </pre>
      ))}
      {busy && !data ? (
        <div className="empty">
          <Icon name="refresh" size={32} className="spin" />
          <p>{t('Recherche dans les catalogues…')}</p>
        </div>
      ) : !data ? (
        <div className="empty">
          <Icon name="search" size={32} />
          <p>{t('Tapez le nom d’un logiciel puis Entrée.')}</p>
        </div>
      ) : !visible.length ? (
        <div className="empty">
          <p>{t('Aucun résultat pour « {q} ».', { q: searched })}</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table" aria-label={t('Résultats de la recherche')} aria-busy={busy}>
            <thead>
              <tr>
                <th className="col-name">{t('Nom')}</th>
                <th>{t('Version')}</th>
                <th>{t('Source')}</th>
                <th className="col-actions" />
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={keyOf(r)}>
                  <td className="col-name">
                    <div className="item-name">
                      <Highlight text={r.name} query={searched} />
                    </div>
                    <div className="item-sub">{r.id}</div>
                  </td>
                  <td className="version">{r.version ?? '—'}</td>
                  <td>
                    <span className="tag">{sourceName(r.source)}</span>
                  </td>
                  <td className="col-actions nowrap">
                    {r.installed ? (
                      <span className="tag ok">{t('installé')}</span>
                    ) : queued.has(keyOf(r)) ? (
                      <span className="tag warn">{t('en file')}</span>
                    ) : (
                      <button className="btn small" onClick={() => install(r)} title={r.source === 'choco' ? t('Chocolatey demande les droits administrateur.') : undefined}>
                        <Icon name="download" size={14} /> {r.source === 'choco' ? t('Installer (admin)') : t('Installer')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {toast && <Toast text={toast} action={t('Voir l’activité')} onAction={() => go('history')} onClose={closeToast} />}
    </div>
  );
}
