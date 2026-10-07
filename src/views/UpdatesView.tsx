import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { AppState, SecurityCheck, SortKey, UpdateItem, UpdateKind } from '../../shared/types';
import { t } from '../../shared/i18n';
import { api, copyText, formatDate, formatRelative, formatSize, KIND_LABEL } from '../api';
import { Icon, type IconName } from '../components/Icon';
import { ContextMenu, Highlight, KindDot, Modal, Toast, type MenuItem } from '../components/ui';
import { DetailPanel } from '../components/DetailPanel';

type Filter = 'all' | UpdateKind;
type InstallOpts = { downloadOnly?: boolean; versions?: Record<string, string> };

const FILTER_ICONS: Record<Filter, IconName> = { all: 'layers', package: 'box', system: 'windows', driver: 'chip', firmware: 'cpu' };

function useIcons(names: string[]): Record<string, string> {
  const [icons, setIcons] = useState<Record<string, string>>({});
  const asked = useRef(new Set<string>());
  useEffect(() => {
    const missing = names.filter((n) => !asked.current.has(n));
    if (!missing.length) return;
    missing.forEach((n) => asked.current.add(n));
    void api.icons(missing).then((r) => setIcons((prev) => ({ ...prev, ...r })));
  }, [names.join('|')]);
  return icons;
}

export function UpdatesView({ state, onShowActivity, focus }: { state: AppState; onShowActivity: () => void; focus?: string }) {
  const s = state.settings;
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<{ items: UpdateItem[]; opts?: InstallOpts } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ key: string; name: string } | null>(null);
  const [colsMenu, setColsMenu] = useState(false);
  const colsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!colsMenu) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.cols-menu, [aria-label="' + t('Colonnes et affichage') + '"]')) setColsMenu(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setColsMenu(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [colsMenu]);
  const [secState, setSecState] = useState<SecurityCheck[] | null>(null);
  useEffect(() => {
    if (focus) setDetail(focus);
  }, [focus]);
  const [detail, setDetail] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; item: UpdateItem } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const providerName = (id: string) => state.providers.find((p) => p.id === id)?.name ?? id;
  const checking = state.providers.filter((p) => p.checking);
  const busyKeys = useMemo(
    () => new Set(state.jobs.filter((j) => j.status === 'running' || j.status === 'queued').flatMap((j) => j.items.map((i) => i.key))),
    [state.jobs],
  );
  const runningJob = (key: string) => state.jobs.find((j) => j.status === 'running' && j.items.some((i) => i.key === key));

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const { key, dir } = s.sort;
    const sign = dir === 'asc' ? 1 : -1;
    const cmp = (a: UpdateItem, b: UpdateItem): number => {
      if (!!a.security !== !!b.security) return a.security ? -1 : 1;
      const by: Record<SortKey, () => number> = {
        name: () => a.name.localeCompare(b.name),
        source: () => (a.source ?? '').localeCompare(b.source ?? '') || a.name.localeCompare(b.name),
        size: () => (a.sizeBytes ?? 0) - (b.sizeBytes ?? 0),
        date: () => (a.publishedAt ?? a.firstSeen ?? 0) - (b.publishedAt ?? b.firstSeen ?? 0),
        kind: () => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
      };
      return sign * by[key]();
    };
    return state.updates
      .filter((u) => filter === 'all' || u.kind === filter)
      .filter((u) => !q || [u.name, u.id, u.source, u.publisher, u.category, u.details].some((f) => f?.toLowerCase().includes(q)))
      .sort(cmp);
  }, [state.updates, filter, query, s.sort]);

  const groups = useMemo(() => {
    if (s.groupBy === 'none') return [{ label: '', items: visible }];
    const map = new Map<string, UpdateItem[]>();
    for (const u of visible) {
      const k = s.groupBy === 'kind' ? KIND_LABEL()[u.kind] : (u.source ?? providerName(u.providerId));
      map.set(k, [...(map.get(k) ?? []), u]);
    }
    return [...map.entries()].map(([label, items]) => ({ label, items }));
  }, [visible, s.groupBy]);

  const icons = useIcons(useMemo(() => visible.filter((u) => u.iconName).map((u) => u.iconName!), [visible]));

  const count = (k: Filter) => (k === 'all' ? state.updates.length : state.updates.filter((u) => u.kind === k).length);
  const selectedItems = visible.filter((u) => selected.has(u.key));
  const allSelected = visible.length > 0 && selectedItems.length === visible.length;
  const detailItem = state.updates.find((u) => u.key === detail);

  const toggle = (key: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const doInstall = async (items: UpdateItem[], opts?: InstallOpts) => {
    setPending(null);
    try {
      await api.install(items.map((i) => i.key), opts);
      setSelected(new Set());
      setToast(
        opts?.downloadOnly
          ? t('Téléchargement lancé')
          : items.length === 1
            ? t('Mise à jour de « {name} » lancée', { name: items[0].name })
            : t('{n} mises à jour lancées', { n: items.length }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err));
    }
  };

  const requestInstall = useCallback(
    (items: UpdateItem[], opts?: InstallOpts) => {
      if (!items.length) return;
      const sensitive = items.some((i) => i.kind === 'firmware' || i.requiresAdmin || i.requiresReboot || s.packageOptions[i.key]?.closeProcess);
      if (items.some((i) => i.kind === 'firmware')) void api.security().then((r) => setSecState(r.checks)).catch(() => setSecState([]));
      if (sensitive || opts?.versions) setPending({ items, opts });
      else void doInstall(items, opts);
    },
    [s.packageOptions],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = (e.target as HTMLElement).closest('input, select, textarea');
      if (e.ctrlKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        if (!checking.length) void api.checkAll();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (!inField && e.ctrlKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSelected(new Set(visible.map((u) => u.key)));
      } else if (!inField && e.key === 'Enter' && selectedItems.length && !pending) {
        e.preventDefault();
        requestInstall(selectedItems);
      } else if (e.key === 'Escape') {
        if (detail) setDetail(null);
        else if (query) setQuery('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, selectedItems, checking.length, detail, query, pending, requestInstall]);

  const ignore = (u: UpdateItem, version: string) => {
    void api.ignore(u.key, version);
    setUndo({ key: u.key, name: u.name });
  };

  const menuItems = (u: UpdateItem): MenuItem[] => [
    { label: t('Mettre à jour'), icon: 'download', onClick: () => requestInstall([u]), disabled: busyKeys.has(u.key) },
    ...(u.supportsDownload ? [{ label: t('Télécharger seulement'), icon: 'folder' as const, onClick: () => requestInstall([u], { downloadOnly: true }) }] : []),
    { label: t('Détails'), icon: 'info', onClick: () => setDetail(u.key) },
    { label: t('Ignorer cette version'), icon: 'eyeOff', onClick: () => ignore(u, u.availableVersion ?? '*') },
    { label: t('Toujours ignorer'), icon: 'eyeOff', onClick: () => ignore(u, '*') },
    ...(u.deviceAbsent ? [{ label: t('Oublier ce périphérique'), icon: 'trash' as const, onClick: () => void api.forgetDevices([u.key]) }] : []),
    ...(u.hiddenByWindows ? [{ label: t('Réafficher dans Windows Update'), icon: 'eye' as const, onClick: () => void api.unhide([u.key]) }] : []),
    { label: t('Copier l’identifiant'), icon: 'copy', onClick: () => void copyText(u.id) },
    ...(u.homepage ? [{ label: t('Ouvrir le site'), icon: 'external' as const, onClick: () => void api.openExternal(u.homepage!) }] : []),
  ];

  const sortBy = (key: SortKey) =>
    void api.setSettings({ sort: { key, dir: s.sort.key === key && s.sort.dir === 'asc' ? 'desc' : 'asc' } });
  const sortIndicator = (key: SortKey) => (s.sort.key === key ? (s.sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
  const ariaSort = (key: SortKey) => (s.sort.key === key ? (s.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
  const sortProps = (key: SortKey) => ({
    'aria-sort': ariaSort(key),
    tabIndex: 0,
    onClick: () => sortBy(key),
    onKeyDown: (e: ReactKeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        sortBy(key);
      }
    },
  } as const);

  const hiddenNotes = [
    state.hiddenAbsent && { n: state.hiddenAbsent, text: t('pilote(s) de périphériques absents'), show: () => void api.setSettings({ hideAbsentDevices: false }), extra: { label: t('les oublier'), run: () => void api.forgetAllAbsent() } },
    state.hiddenQuarantine && { n: state.hiddenQuarantine, text: t('version(s) en quarantaine ({d} j)', { d: state.effective.quarantineDays }), show: () => void api.setSettings({ showQuarantined: true }) },
    state.hiddenPreview && { n: state.hiddenPreview, text: t('préversion(s)'), show: () => void api.setSettings({ hidePreview: false }) },
    state.hiddenByWindows && { n: state.hiddenByWindows, text: t('masquée(s) dans Windows Update'), show: () => void api.setSettings({ showWindowsHidden: true }) },
  ].filter(Boolean) as { n: number; text: string; show: () => void; extra?: { label: string; run: () => void } }[];

  const cols = s.columns;
  const colCount = 3 + Object.values(cols).filter(Boolean).length;
  const toggleCol = (k: keyof typeof cols) => void api.setSettings({ columns: { ...cols, [k]: !cols[k] } });

  return (
    <div className={`view with-detail ${detailItem ? 'open' : ''}`}>
      <div className="view-main">
        <header className="view-header">
          <div>
            <h1>{t('Mises à jour')}</h1>
            <p className="muted">
              {checking.length
                ? t('Vérification en cours : {list}…', { list: checking.map((p) => p.name).join(', ') })
                : t('Dernière vérification : {last} · prochaine {next}', { last: formatDate(state.lastFullCheck), next: formatRelative(state.nextCheck) })}
            </p>
          </div>
          <div className="header-actions">
            <label className="search">
              <Icon name="search" size={16} />
              <input
                ref={searchRef}
                placeholder={t('Rechercher… (Ctrl+F)')}
                aria-label={t('Rechercher')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <button className="btn" disabled={checking.length > 0} onClick={() => void api.checkAll()} title="Ctrl+R">
              <Icon name="refresh" className={checking.length ? 'spin' : ''} />
              {t('Vérifier maintenant')}
            </button>
          </div>
        </header>

        <div className="toolbar">
          <div className="chips" role="tablist">
            {(['all', 'package', 'system', 'driver', 'firmware'] as Filter[]).map((f) => (
              <button key={f} role="tab" aria-selected={filter === f} className={`chip ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
                <Icon name={FILTER_ICONS[f]} size={15} />
                {f === 'all' ? t('Tout') : KIND_LABEL()[f]}
                <span className="chip-count">{count(f)}</span>
              </button>
            ))}
          </div>
          <label className="inline-select">
            {t('Grouper')}
            <select value={s.groupBy} onChange={(e) => void api.setSettings({ groupBy: e.target.value as AppState['settings']['groupBy'] })}>
              <option value="none">{t('Aucun')}</option>
              <option value="source">{t('Par source')}</option>
              <option value="kind">{t('Par type')}</option>
            </select>
          </label>
        </div>

        {hiddenNotes.length > 0 && (
          <p className="muted small hint">
            {t('Masquées :')}{' '}
            {hiddenNotes.map((h, i) => (
              <span key={i}>
                {i > 0 && ' · '}
                {h.n} {h.text}{' '}
                <button className="link" onClick={h.show}>
                  {t('afficher')}
                </button>
                {h.extra && (
                  <>
                    {' '}·{' '}
                    <button className="link" onClick={h.extra.run}>
                      {h.extra.label}
                    </button>
                  </>
                )}
              </span>
            ))}
          </p>
        )}

        {filter === 'firmware' && state.system && (
          <div className="callout">
            <Icon name="cpu" />
            <div>
              <strong>
                {state.system.manufacturer} {state.system.model}
              </strong>{' '}
              — {t('BIOS installé :')} <code>{state.system.biosVersion}</code>
              {state.system.biosDate && ` (${state.system.biosDate})`}
              <div className="muted small">{t('Sources : Windows Update (classe Firmware) et l’outil constructeur s’il est configuré dans « Sources ».')}</div>
            </div>
          </div>
        )}

        {visible.length === 0 ? (
          <div className="empty">
            <Icon name="check" size={40} />
            <p>{checking.length ? t('Recherche en cours…') : query ? t('Aucun résultat.') : t('Tout est à jour.')}</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className={`table ${s.compact ? 'compact-rows' : ''}`} aria-label={t('Mises à jour disponibles')}>
              <thead>
                <tr>
                  <th className="col-check">
                    <input
                      type="checkbox"
                      aria-label={t('Tout sélectionner')}
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(visible.map((u) => u.key)))}
                    />
                  </th>
                  <th className="col-name sortable" {...sortProps('name')}>
                    {t('Nom')}
                    {sortIndicator('name')}
                  </th>
                  {cols.source && (
                    <th className="sortable" {...sortProps('source')}>
                      {t('Source')}
                      {sortIndicator('source')}
                    </th>
                  )}
                  {cols.installed && <th>{t('Installée')}</th>}
                  {cols.available && <th>{t('Disponible')}</th>}
                  {cols.size && (
                    <th className="sortable" {...sortProps('size')}>
                      {t('Taille')}
                      {sortIndicator('size')}
                    </th>
                  )}
                  {cols.date && (
                    <th className="sortable" {...sortProps('date')}>
                      {t('Date')}
                      {sortIndicator('date')}
                    </th>
                  )}
                  <th className="col-actions">
                    <div className="menu-anchor">
                      <button className="btn small ghost icon" aria-label={t('Colonnes et affichage')} aria-expanded={colsMenu} onClick={() => setColsMenu(!colsMenu)}>
                        <Icon name="table" size={15} />
                      </button>
                      {colsMenu && (
                        <div className="menu cols-menu" role="menu" ref={colsRef}>
                          {(
                            [
                              ['source', t('Source')],
                              ['installed', t('Installée')],
                              ['available', t('Disponible')],
                              ['size', t('Taille')],
                              ['date', t('Date')],
                            ] as [keyof typeof cols, string][]
                          ).map(([k, label]) => (
                            <label key={k} className="check-row menu-check">
                              <input type="checkbox" checked={cols[k]} onChange={() => toggleCol(k)} /> {label}
                            </label>
                          ))}
                          <label className="check-row menu-check">
                            <input type="checkbox" checked={s.compact} onChange={() => void api.setSettings({ compact: !s.compact })} /> {t('Vue compacte')}
                          </label>
                        </div>
                      )}
                    </div>
                  </th>
                </tr>
              </thead>
              {groups.map((g) => (
                <tbody key={g.label || 'all'}>
                  {g.label && (
                    <tr className="group-row">
                      <td colSpan={colCount}>
                        {g.label} <span className="muted">({g.items.length})</span>
                      </td>
                    </tr>
                  )}
                  {g.items.map((u) => {
                    const busy = busyKeys.has(u.key);
                    const job = runningJob(u.key);
                    return (
                      <tr
                        key={u.key}
                        tabIndex={0}
                        className={`${selected.has(u.key) ? 'selected' : ''} ${detail === u.key ? 'focused' : ''}`}
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest('button, input')) return;
                          setDetail(u.key);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === ' ' && e.target === e.currentTarget) {
                            e.preventDefault();
                            toggle(u.key);
                          }
                        }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setMenu({ x: e.clientX, y: e.clientY, item: u });
                        }}
                      >
                        <td className="col-check">
                          <input type="checkbox" aria-label={t('Sélectionner {name}', { name: u.name })} checked={selected.has(u.key)} onChange={() => toggle(u.key)} />
                        </td>
                        <td className="col-name">
                          <div className="item-name">
                            {u.iconName && icons[u.iconName] ? <img className="app-icon" src={icons[u.iconName]} alt="" /> : <KindDot kind={u.kind} />}
                            <span>
                              <Highlight text={u.name} query={query} />
                            </span>
                            {u.security && <span className="tag danger">{t('sécurité')}</span>}
                            {u.severity === 'critical' && !u.security && <span className="tag danger">{t('critique')}</span>}
                            {u.preview && <span className="tag">{t('préversion')}</span>}
                            {u.quarantineUntil && <span className="tag">{t('quarantaine')}</span>}
                            {u.requiresReboot && <span className="tag warn">{t('redémarrage')}</span>}
                            {u.requiresAdmin && <span className="tag">{t('admin')}</span>}
                            {u.deviceAbsent && <span className="tag">{t('absent')}</span>}
                            {u.hiddenByWindows && <span className="tag">{t('masquée')}</span>}
                            {u.exploited && <span className="tag danger">{t('exploitée')}</span>}
                            {u.optional && <span className="tag">{t('facultatif')}</span>}
                            {u.manualUrl && <span className="tag">{t('manuelle')}</span>}
                          </div>
                          <div className="item-sub">
                            <Highlight
                              text={[
                                u.id !== u.name && !/^[0-9a-f-]{36}$/i.test(u.id) ? u.id : null,
                                u.category,
                                u.details,
                                u.alsoVia?.length ? t('aussi via {list}', { list: u.alsoVia.join(', ') }) : null,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                              query={query}
                            />
                          </div>
                          {job && (
                            <div className="row-progress" aria-label={t('Progression')}>
                              <span style={{ width: `${job.progress ?? 5}%` }} className={job.progress === undefined ? 'indeterminate' : ''} />
                            </div>
                          )}
                        </td>
                        {cols.source && (
                          <td className="muted nowrap" title={providerName(u.providerId)}>
                            <Highlight text={u.source ?? providerName(u.providerId)} query={query} />
                          </td>
                        )}
                        {cols.installed && <td className="version">{u.currentVersion || '—'}</td>}
                        {cols.available && <td className="version new">{u.availableVersion || '—'}</td>}
                        {cols.size && <td className="muted nowrap small">{formatSize(u.sizeBytes)}</td>}
                        {cols.date && <td className="muted nowrap small">{u.publishedAt ? new Date(u.publishedAt).toLocaleDateString() : ''}</td>}
                        <td className="col-actions">
                          <button className="btn small primary" disabled={busy} onClick={() => requestInstall([u])}>
                            {busy ? t('En cours…') : t('Mettre à jour')}
                          </button>
                          <button
                            className="btn small ghost icon"
                            aria-label={t('Plus d’actions')}
                            onClick={(e) => {
                              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                              setMenu({ x: r.right - 200, y: r.bottom + 4, item: u });
                            }}
                          >
                            <Icon name="more" size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>
          </div>
        )}

        <footer className="actionbar">
          <span className="muted">
            {selectedItems.length ? t('{n} sélectionné(s)', { n: selectedItems.length }) : t('{n} mise(s) à jour', { n: visible.length })}
            {state.effective.autoUpdatesEnabled && state.autoBlockers.length > 0 && (
              <span className="small"> · {t('Automatiques en pause : {why}', { why: state.autoBlockers.map((b) => t(b)).join(', ') })}</span>
            )}
          </span>
          <div className="header-actions">
            <button className="btn" disabled={!visible.length} onClick={() => requestInstall(visible)}>
              {t('Tout mettre à jour')}
            </button>
            <button className="btn primary" disabled={!selectedItems.length} onClick={() => requestInstall(selectedItems)} title={t('Entrée')}>
              <Icon name="download" /> {t('Mettre à jour la sélection')}
            </button>
          </div>
        </footer>
      </div>

      {detailItem && <DetailPanel item={detailItem} state={state} onClose={() => setDetail(null)} onInstall={requestInstall} />}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.item)} onClose={() => setMenu(null)} />}

      {toast && <Toast text={toast} action={t('Voir l’activité')} onAction={onShowActivity} onClose={() => setToast(null)} />}
      {undo && !toast && (
        <Toast
          text={t('« {name} » ignorée', { name: undo.name })}
          action={t('Annuler')}
          onAction={() => {
            void api.unignore(undo.key);
            setUndo(null);
          }}
          onClose={() => setUndo(null)}
        />
      )}

      {error && (
        <Modal title={t('Installation impossible')} onCancel={() => setError(null)}>
          <p className="warn-text">
            <Icon name="alert" size={16} /> {error}
          </p>
        </Modal>
      )}

      {pending && (
        <Modal
          title={pending.opts?.downloadOnly ? t('Confirmer le téléchargement') : t('Confirmer l’installation')}
          confirmLabel={pending.opts?.downloadOnly ? t('Télécharger') : t('Installer {n} élément(s)', { n: pending.items.length })}
          danger={pending.items.some((i) => i.kind === 'firmware')}
          onConfirm={() => void doInstall(pending.items, pending.opts)}
          onCancel={() => setPending(null)}
        >
          <ul className="modal-list">
            {pending.items.map((i) => (
              <li key={i.key}>
                {i.name} <span className="muted">→ {pending.opts?.versions?.[i.key] ?? i.availableVersion ?? '?'}</span>
              </li>
            ))}
          </ul>
          {pending.items.some((i) => i.requiresAdmin) && (
            <p>
              <Icon name="shield" size={16} />{' '}
              {state.settings.useElevatedHelper && state.helperInstalled
                ? t('Installation via l’assistant administrateur (sans fenêtre UAC).')
                : t('Windows demandera une seule élévation (UAC) pour tout le lot.')}
            </p>
          )}
          {pending.items.some((i) => i.kind !== 'package') && state.settings.restorePoint && !pending.opts?.downloadOnly && (
            <p className="muted">
              <Icon name="undo" size={16} /> {t('Un point de restauration système sera créé avant l’installation.')}
            </p>
          )}
          {pending.items.some((i) => i.kind === 'firmware') && !pending.opts?.downloadOnly && (
            <p className="warn-text">
              <Icon name="alert" size={16} />{' '}
              {t('Mise à jour de firmware/BIOS : branchez le chargeur secteur, fermez vos applications et n’interrompez pas le redémarrage.')}{' '}
              {state.settings.suspendBitLocker ? t('BitLocker sera suspendu pour un redémarrage.') : t('Vérifiez que vous avez votre clé de récupération BitLocker.')}
              {state.conditions.batteryLevel !== undefined && ` ${t('Batterie : {n} %', { n: state.conditions.batteryLevel })}${state.conditions.onBattery ? ` (${t('sur batterie')})` : ''}.`}
            </p>
          )}
          {pending.items.some((i) => i.kind === 'firmware') && !pending.opts?.downloadOnly && (
            <ul className="mini-checks" aria-label={t('État avant la mise à jour')}>
              {(secState ?? []).filter((c) => ['secureboot', 'tpm', 'bitlocker'].includes(c.id)).map((c) => (
                <li key={c.id}>
                  <span className={`status ${c.status === 'ok' ? 'ok' : c.status === 'unknown' ? 'off' : 'warn'}`}>{c.label}</span> {c.value}
                </li>
              ))}
              {!secState && <li className="muted small">{t('Lecture de Secure Boot, TPM et BitLocker…')}</li>}
            </ul>
          )}
          {state.settings.simulateInstalls && (
            <p className="muted">
              <Icon name="info" size={16} /> {t('Mode simulation : rien ne sera installé.')}
            </p>
          )}
          {pending.items.map((i) => state.settings.packageOptions[i.key]?.closeProcess).filter(Boolean).length > 0 && (
            <p className="muted">
              <Icon name="x" size={16} />{' '}
              {t('Ces applications seront fermées avant la mise à jour : {list}', {
                list: pending.items.map((i) => state.settings.packageOptions[i.key]?.closeProcess).filter(Boolean).join(', '),
              })}
            </p>
          )}
          {pending.items.some((i) => i.requiresReboot) && !pending.opts?.downloadOnly && <p className="muted">{t('Un redémarrage sera nécessaire ensuite.')}</p>}
        </Modal>
      )}
    </div>
  );
}
