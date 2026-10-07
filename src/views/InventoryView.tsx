import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtual } from '../components/useVirtual';
import type { AppState, InventoryItem } from '../../shared/types';
import { t } from '../../shared/i18n';
import { api, formatSize } from '../api';
import { Icon } from '../components/Icon';
import { Highlight, Modal } from '../components/ui';

type Filter = 'all' | 'managed' | 'unmanaged' | 'store';

let memo: { key: string; items: InventoryItem[] } | null = null;

export function InventoryView({ state }: { state: AppState }) {
  const trackedKey = JSON.stringify(state.settings.trackedPrograms);
  const [items, setItems] = useState<InventoryItem[] | null>(memo?.key === trackedKey ? memo.items : null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [assoc, setAssoc] = useState<InventoryItem | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const load = (force = false) => {
    if (force) setItems(null);
    setError(null);
    api
      .inventory(force)
      .then((data) => {
        memo = { key: trackedKey, items: data };
        setItems(data);
      })
      .catch((e: Error) => setError(e.message));
  };
  useEffect(() => {
    if (memo?.key !== trackedKey) load();
  }, [trackedKey]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? [])
      .filter((i) =>
        filter === 'all' ? true : filter === 'managed' ? i.managedBy.length > 0 : filter === 'unmanaged' ? i.managedBy.length === 0 && i.source === 'arp' : i.source === 'store',
      )
      .filter((i) => !q || [i.name, i.publisher, i.wingetId].some((f) => f?.toLowerCase().includes(q)));
  }, [items, query, filter]);

  const win = useVirtual(scroller, visible.length, 49);

  const counts = useMemo(() => {
    const all = items ?? [];
    return {
      all: all.length,
      managed: all.filter((i) => i.managedBy.length).length,
      unmanaged: all.filter((i) => !i.managedBy.length && i.source === 'arp').length,
      store: all.filter((i) => i.source === 'store').length,
    };
  }, [items]);

  return (
    <div className="view">
      <header className="view-header">
        <div>
          <h1>{t('Inventaire')}</h1>
          <p className="muted">{t('Tous les logiciels installés, et le gestionnaire qui les suit.')}</p>
        </div>
        <div className="header-actions">
          <label className="search">
            <Icon name="search" size={16} />
            <input placeholder={t('Rechercher…')} aria-label={t('Rechercher')} value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <button className="btn" onClick={() => load(true)} disabled={items === null && !error}>
            <Icon name="refresh" className={items === null && !error ? 'spin' : ''} /> {t('Actualiser')}
          </button>
        </div>
      </header>
      <div className="chips" role="tablist">
        {(
          [
            ['all', t('Tout')],
            ['managed', t('Suivis')],
            ['unmanaged', t('Non suivis')],
            ['store', t('Microsoft Store')],
          ] as [Filter, string][]
        ).map(([f, l]) => (
          <button key={f} role="tab" aria-selected={filter === f} className={`chip ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
            {l} <span className="chip-count">{counts[f]}</span>
          </button>
        ))}
      </div>
      {filter === 'unmanaged' && (
        <p className="muted small hint">{t('Ces programmes ne sont suivis par aucun gestionnaire. Associez-les à un paquet winget pour qu’UpKeep surveille leurs mises à jour.')}</p>
      )}
      {error && <pre className="error-box">{error}</pre>}
      {items === null && !error ? (
        <div className="empty">
          <Icon name="refresh" size={32} className="spin" />
          <p>{t('Lecture des programmes installés…')}</p>
        </div>
      ) : (
        <div className="table-wrap" ref={scroller}>
          <table className="table fixed-rows" aria-label={t('Logiciels installés')} aria-rowcount={visible.length + 1}>
            <thead>
              <tr>
                <th className="col-name">{t('Nom')}</th>
                <th>{t('Version')}</th>
                <th>{t('Éditeur')}</th>
                <th>{t('Installé le')}</th>
                <th>{t('Taille')}</th>
                <th>{t('Suivi par')}</th>
                <th className="col-actions" />
              </tr>
            </thead>
            <tbody>
              {win.padTop > 0 && (
                <tr aria-hidden style={{ height: win.padTop }}>
                  <td colSpan={7} />
                </tr>
              )}
              {visible.slice(win.start, win.end).map((i, n) => (
                <tr key={`${i.source}:${i.name}:${i.version}`} aria-rowindex={win.start + n + 2}>
                  <td className="col-name">
                    <div className="item-name">
                      <Highlight text={i.name} query={query} />
                    </div>
                    {i.wingetId && <div className="item-sub">{i.wingetId}</div>}
                  </td>
                  <td className="version">{i.version ?? '—'}</td>
                  <td className="muted small">
                    <Highlight text={i.publisher ?? ''} query={query} />
                  </td>
                  <td className="muted small nowrap">{i.installDate ?? ''}</td>
                  <td className="muted small nowrap">{formatSize(i.sizeBytes)}</td>
                  <td>
                    {i.managedBy.length ? i.managedBy.map((m) => <span key={m} className="tag ok">{m}</span>) : <span className="tag">{t('aucun')}</span>}
                  </td>
                  <td className="col-actions">
                    {i.source === 'arp' && !i.managedBy.some((m) => m === 'winget') && (
                      <button className="btn small ghost" onClick={() => setAssoc(i)}>
                        {state.settings.trackedPrograms[i.name] ? t('Modifier') : t('Associer')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {win.padBottom > 0 && (
                <tr aria-hidden style={{ height: win.padBottom }}>
                  <td colSpan={7} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {assoc && <AssociateDialog item={assoc} current={state.settings.trackedPrograms[assoc.name]} onClose={() => setAssoc(null)} />}
    </div>
  );
}

function AssociateDialog({ item, current, onClose }: { item: InventoryItem; current?: string; onClose: () => void }) {
  const [q, setQ] = useState(item.name.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s[\d.]+$/, '').trim());
  const [results, setResults] = useState<{ name: string; id: string; version: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const search = () => {
    setBusy(true);
    api
      .searchWinget(q)
      .then(setResults)
      .finally(() => setBusy(false));
  };
  useEffect(search, []);
  return (
    <Modal title={t('Associer « {name} » à un paquet winget', { name: item.name })} wide onCancel={onClose}>
      <div className="row">
        <input type="text" value={q} aria-label={t('Recherche winget')} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
        <button className="btn small" onClick={search} disabled={busy}>
          <Icon name="search" size={14} /> {t('Rechercher')}
        </button>
        {current && (
          <button
            className="btn small ghost"
            onClick={() => {
              void api.trackProgram(item.name, null);
              onClose();
            }}
          >
            {t('Dissocier ({id})', { id: current })}
          </button>
        )}
      </div>
      {busy && <p className="muted">{t('Recherche…')}</p>}
      {results && !busy && (
        <ul className="pick-list">
          {results.length === 0 && <li className="muted">{t('Aucun paquet trouvé.')}</li>}
          {results.map((r) => (
            <li key={r.id}>
              <div>
                <strong>{r.name}</strong> <span className="muted small">{r.id}</span>
              </div>
              <span className="version">{r.version}</span>
              <button
                className="btn small primary"
                onClick={() => {
                  void api.trackProgram(item.name, r.id);
                  onClose();
                }}
              >
                {t('Choisir')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
