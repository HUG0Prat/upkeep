import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AppState, DriverInfo, DriverSearchResult, PackageSearchResult, PackageSource, PackageSourceInfo } from '../../shared/types';
import { t } from '../../shared/i18n';
import { catalogHardwareId } from '../../shared/logic';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Highlight, Modal, Toast } from '../components/ui';

type Results = { results: PackageSearchResult[]; errors: Partial<Record<PackageSource, string>> };

// Conservé entre deux visites de la page.
let memo: { query: string; data: Results } | null = null;

const keyOf = (r: PackageSearchResult) => `${r.source}:${r.id}`;

type Mode = 'software' | 'drivers';
let lastMode: Mode = 'software';

export function PackageSearchView({ state, go }: { state: AppState; go: (page: string) => void }) {
  const [mode, setMode] = useState<Mode>(driverPreset ? 'drivers' : lastMode);
  const select = (m: Mode) => {
    lastMode = m;
    setMode(m);
  };
  return (
    <div className="view">
      <header className="view-header">
        <div>
          <h1>{mode === 'drivers' ? t('Rechercher des pilotes') : t('Rechercher des logiciels')}</h1>
          <p className="muted">
            {mode === 'drivers'
              ? t('Trouvez le pilote d’un périphérique dans le catalogue Microsoft Update et installez-le.')
              : t('Trouvez un logiciel dans les catalogues de vos gestionnaires de paquets et installez-le.')}
          </p>
        </div>
      </header>
      <div className="chips" role="tablist" aria-label={t('Type de recherche')}>
        {(
          [
            ['software', t('Logiciels')],
            ['drivers', t('Pilotes')],
          ] as [Mode, string][]
        ).map(([m, l]) => (
          <button key={m} role="tab" aria-selected={mode === m} className={`chip ${mode === m ? 'active' : ''}`} onClick={() => select(m)}>
            {l}
          </button>
        ))}
      </div>
      {mode === 'drivers' ? <DriverSearch go={go} /> : <SoftwareSearch state={state} go={go} />}
    </div>
  );
}

function SoftwareSearch({ state, go }: { state: AppState; go: (page: string) => void }) {
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
    <>
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
    </>
  );
}

let driverMemo: { query: string; results: DriverSearchResult[] } | null = null;
let driverPreset: string | null = null;

/** Ouvre la recherche de pilotes sur une requête (identifiant matériel choisi dans l'inventaire). */
export function presetDriverSearch(q: string): void {
  driverPreset = q;
}

function DriverSearch({ go }: { go: (page: string) => void }) {
  const [query, setQuery] = useState(driverMemo?.query ?? '');
  const [results, setResults] = useState<DriverSearchResult[] | null>(driverMemo?.results ?? null);
  const [searched, setSearched] = useState(driverMemo?.query ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<DriverInfo[]>([]);
  const [queued, setQueued] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<DriverSearchResult | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const closeToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    void api
      .drivers()
      .then(setDevices)
      .catch(() => undefined);
  }, []);

  const run = (q: string) => {
    const s = q.trim();
    if (s.length < 2 || busy) return;
    setBusy(true);
    setError(null);
    api
      .searchDrivers(s)
      .then((r) => {
        driverMemo = { query: s, results: r };
        setResults(r);
        setSearched(s);
      })
      .catch((err: Error) => setError(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
      .finally(() => setBusy(false));
  };

  useEffect(() => {
    if (!driverPreset) return;
    const q = catalogHardwareId(driverPreset);
    driverPreset = null;
    setQuery(q);
    run(q);
  }, []);

  const install = (r: DriverSearchResult) => {
    setQueued((s) => new Set(s).add(r.id));
    api
      .installDriver(r)
      .then(() => setToast(t('Installation de {name} ajoutée à la file.', { name: r.title })))
      .catch((err: Error) => {
        setQueued((s) => {
          const n = new Set(s);
          n.delete(r.id);
          return n;
        });
        setError(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      });
  };

  const withProblems = devices.filter((d) => d.problem && d.hardwareId);
  const pickable = [...withProblems, ...devices.filter((d) => !d.problem && d.hardwareId && !/^microsoft/i.test(d.provider ?? ''))];

  return (
    <>
      <form
        className="toolbar"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          run(query);
        }}
      >
        <div className="filters">
          <label className="search">
            <Icon name="search" size={16} />
            <input
              autoFocus
              placeholder={t('Modèle ou identifiant matériel (ex. PCI\\VEN_8086&DEV_51F0)')}
              aria-label={t('Pilote à rechercher')}
              value={query}
              maxLength={120}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <button className="btn primary" type="submit" disabled={busy || query.trim().length < 2}>
            <Icon name={busy ? 'refresh' : 'search'} className={busy ? 'spin' : ''} /> {t('Rechercher')}
          </button>
        </div>
        {pickable.length > 0 && (
          <select
            aria-label={t('Périphérique de ce PC')}
            value=""
            onChange={(e) => {
              const q = catalogHardwareId(e.target.value);
              setQuery(q);
              run(q);
            }}
          >
            <option value="">{t('Choisir un périphérique de ce PC…')}</option>
            {withProblems.length > 0 && (
              <optgroup label={t('En erreur')}>
                {withProblems.map((d, i) => (
                  <option key={`p${i}`} value={d.hardwareId}>
                    {d.device}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label={t('Pilotes tiers')}>
              {pickable.slice(withProblems.length).map((d, i) => (
                <option key={`d${i}`} value={d.hardwareId}>
                  {d.device} ({d.className})
                </option>
              ))}
            </optgroup>
          </select>
        )}
      </form>
      <p className="muted small hint">
        {t('Source : catalogue Microsoft Update. Chaque pilote est vérifié avant installation (empreinte SHA-256 publiée par Microsoft et signature numérique Microsoft) ; un point de restauration est créé si l’option est activée.')}
      </p>
      {error && <pre className="error-box">{error}</pre>}
      {busy && !results ? (
        <div className="empty">
          <Icon name="refresh" size={32} className="spin" />
          <p>{t('Recherche dans le catalogue Microsoft Update…')}</p>
        </div>
      ) : !results ? (
        <div className="empty">
          <Icon name="chip" size={32} />
          <p>{t('Cherchez un pilote par modèle, ou choisissez un périphérique de ce PC.')}</p>
        </div>
      ) : !results.length ? (
        <div className="empty">
          <p>{t('Aucun pilote pour « {q} ».', { q: searched })}</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table" aria-label={t('Pilotes trouvés')} aria-busy={busy}>
            <thead>
              <tr>
                <th className="col-name">{t('Pilote')}</th>
                <th>{t('Version')}</th>
                <th>{t('Date')}</th>
                <th>{t('Taille')}</th>
                <th className="col-actions" />
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.id}>
                  <td className="col-name">
                    <div className="item-name">{r.title}</div>
                    <div className="item-sub">{[r.classification, r.products].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td className="version">{r.version || '—'}</td>
                  <td className="muted small nowrap">{r.date}</td>
                  <td className="muted small nowrap">{r.size}</td>
                  <td className="col-actions nowrap">
                    {queued.has(r.id) ? (
                      <span className="tag warn">{t('en file')}</span>
                    ) : (
                      <button className="btn small" onClick={() => setConfirm(r)}>
                        <Icon name="download" size={14} /> {t('Installer (admin)')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {confirm && (
        <Modal
          title={t('Installer ce pilote ?')}
          confirmLabel={t('Installer')}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            install(confirm);
            setConfirm(null);
          }}
        >
          <p>
            <strong>{confirm.title}</strong>
          </p>
          <p className="muted small">{confirm.products}</p>
          <p>{t('Windows n’installe un pilote que s’il correspond à un périphérique présent et qu’il est plus récent que celui en place. Vérifiez que ce pilote vise bien votre version de Windows.')}</p>
        </Modal>
      )}
      {toast && <Toast text={toast} action={t('Voir l’activité')} onAction={() => go('history')} onClose={closeToast} />}
    </>
  );
}
