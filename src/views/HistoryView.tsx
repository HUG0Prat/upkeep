import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppState, InstallJob, JobStatus, MonthlyStat } from '../../shared/types';
import { t } from '../../shared/i18n';
import { api, copyText, formatDate } from '../api';
import { Icon } from '../components/Icon';
import { Modal } from '../components/ui';
import { MonthlyChart } from '../components/MonthlyChart';

const STATUS = (): Record<JobStatus, { label: string; cls: string }> => ({
  queued: { label: t('En attente'), cls: 'off' },
  running: { label: t('En cours'), cls: 'busy' },
  success: { label: t('Réussi'), cls: 'ok' },
  partial: { label: t('Partiel'), cls: 'warn' },
  failed: { label: t('Échec'), cls: 'err' },
  cancelled: { label: t('Annulé'), cls: 'off' },
  interrupted: { label: t('Interrompu'), cls: 'warn' },
});

const TYPE_LABEL = (): Record<InstallJob['type'], string> => ({
  install: t('Installation'),
  setup: t('Outil'),
  download: t('Téléchargement'),
  rollback: t('Version précise / retour arrière'),
  'driver-rollback': t('Restauration de pilote'),
  unhide: t('Réaffichage'),
  import: t('Export / import'),
  'forget-device': t('Oubli de périphérique'),
  cleanup: t('Nettoyage'),
});

function JobLog({ job }: { job: InstallJob }) {
  const ref = useRef<HTMLPreElement>(null);
  const [full, setFull] = useState<string[] | null>(null);
  useEffect(() => {
    if (job.logLength && job.status !== 'running') void api.jobLog(job.id).then(setFull);
  }, [job.id, job.logLength, job.status]);
  const lines = full ?? job.log;
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines.length]);
  return (
    <pre ref={ref} className="log" tabIndex={0} aria-label={t('Journal')}>
      {!full && job.logLength ? `… ${t('{n} ligne(s) précédente(s)', { n: job.logLength - job.log.length })}\n` : ''}
      {lines.join('\n') || t('(aucune sortie pour le moment)')}
    </pre>
  );
}

const PAGE_SIZE = 40;

type Period = 'all' | '7' | '30' | '90';

export function HistoryView({ state }: { state: AppState }) {
  const [open, setOpen] = useState<string | null>(state.jobs[0]?.id ?? null);
  const [status, setStatus] = useState<'all' | JobStatus>('all');
  const [provider, setProvider] = useState('all');
  const [period, setPeriod] = useState<Period>('all');
  const [stats, setStats] = useState<MonthlyStat[]>([]);
  const [confirm, setConfirm] = useState<{ title: string; text: string; run: () => void } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const providerName = (id: string) => state.providers.find((p) => p.id === id)?.name ?? (id === 'helper' ? t('Assistant administrateur') : id === 'packages' ? t('Liste des paquets') : id);
  const S = STATUS();

  const doneCount = state.jobs.filter((j) => j.status === 'success').length;
  useEffect(() => {
    void api.monthlyStats().then(setStats);
  }, [doneCount]);

  const jobs = useMemo(() => {
    const since = period === 'all' ? 0 : Date.now() - Number(period) * 86_400_000;
    return state.jobs.filter(
      (j) =>
        (status === 'all' || j.status === status) &&
        (provider === 'all' || j.providerId === provider) &&
        (j.finishedAt ?? j.startedAt ?? j.queuedAt) >= since,
    );
  }, [state.jobs, status, provider, period]);

  const providersInHistory = [...new Set(state.jobs.map((j) => j.providerId))];
  const queued = state.jobs.filter((j) => j.status === 'queued');

  return (
    <div className="view">
      <header className="view-header">
        <div>
          <h1>{t('Activité')}</h1>
          <p className="muted">{t('Installations en cours, file d’attente et historique.')}</p>
        </div>
        <div className="header-actions">
          <button className="btn" disabled={!jobs.length} onClick={() => void api.exportHistoryCsv(jobs.map((j) => j.id))}>
            <Icon name="table" size={16} /> {t('Exporter en CSV')}
          </button>
          <button className="btn ghost" disabled={!state.jobs.length} onClick={() => void api.clearHistory()}>
            <Icon name="trash" size={16} /> {t('Vider l’historique')}
          </button>
        </div>
      </header>

      <MonthlyChart data={stats} />

      <div className="filters" role="group" aria-label={t('Filtres')}>
        <select value={status} onChange={(e) => setStatus(e.target.value as 'all' | JobStatus)} aria-label={t('Statut')}>
          <option value="all">{t('Tous les statuts')}</option>
          {(Object.keys(S) as JobStatus[]).map((k) => (
            <option key={k} value={k}>
              {S[k].label}
            </option>
          ))}
        </select>
        <select value={provider} onChange={(e) => setProvider(e.target.value)} aria-label={t('Source')}>
          <option value="all">{t('Toutes les sources')}</option>
          {providersInHistory.map((p) => (
            <option key={p} value={p}>
              {providerName(p)}
            </option>
          ))}
        </select>
        <select value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label={t('Période')}>
          <option value="all">{t('Toute la période')}</option>
          <option value="7">{t('7 derniers jours')}</option>
          <option value="30">{t('30 derniers jours')}</option>
          <option value="90">{t('90 derniers jours')}</option>
        </select>
        <span className="muted small">{t('{n} entrée(s)', { n: jobs.length })}</span>
      </div>

      {jobs.length === 0 ? (
        <div className="empty">
          <Icon name="clock" size={40} />
          <p>{t('Aucune activité.')}</p>
        </div>
      ) : (
        <div className="jobs">
          {jobs.slice(0, limit).map((j) => {
            const s = S[j.status];
            const title = j.items.length ? (j.items.length === 1 ? j.items[0].name : t('{n} mises à jour', { n: j.items.length })) : TYPE_LABEL()[j.type];
            const qi = queued.findIndex((q) => q.id === j.id);
            const canRollback =
              j.status === 'success' && j.type === 'install' && !!j.previousVersions && Object.keys(j.previousVersions).length > 0 && j.items.some((i) => i.supportsVersions);
            const driverItems = j.status === 'success' && j.type === 'install' ? j.items.filter((i) => i.kind === 'driver' && i.hardwareId) : [];
            return (
              <div key={j.id} className="job">
                <div className="job-head">
                  <button className="job-toggle" aria-expanded={open === j.id} onClick={() => setOpen(open === j.id ? null : j.id)}>
                    <span className={`status ${s.cls}`}>{s.label}</span>
                    <span className="job-title">{title}</span>
                    <span className="muted small">
                      {providerName(j.providerId)}
                      {j.type !== 'install' ? ` · ${TYPE_LABEL()[j.type]}` : ''}
                      {j.auto ? ` · ${t('automatique')}` : ''}
                      {(j.attempt ?? 1) > 1 ? ` · ${t('tentative {n}', { n: j.attempt })}` : ''}
                      {j.elevated ? ' · admin' : ''}
                    </span>
                    <span className="muted small job-date">{formatDate(j.finishedAt ?? j.startedAt ?? j.queuedAt)}</span>
                    {j.rebootRequired && j.status === 'success' && <span className="tag warn">{t('redémarrage')}</span>}
                    {j.simulated && <span className="tag">{t('simulation')}</span>}
                  </button>
                  <div className="job-actions">
                    {j.status === 'queued' && (
                      <>
                        <button className="btn small ghost icon" disabled={qi <= 0} aria-label={t('Monter')} onClick={() => void api.moveJob(j.id, -1)}>
                          <Icon name="up" size={15} />
                        </button>
                        <button className="btn small ghost icon" disabled={qi < 0 || qi >= queued.length - 1} aria-label={t('Descendre')} onClick={() => void api.moveJob(j.id, 1)}>
                          <Icon name="down" size={15} />
                        </button>
                      </>
                    )}
                    {(j.status === 'queued' || j.status === 'running') && (
                      <button className="btn small ghost" onClick={() => void api.cancelJob(j.id)}>
                        <Icon name="stop" size={14} /> {j.status === 'queued' ? t('Annuler') : t('Interrompre')}
                      </button>
                    )}
                    {['failed', 'cancelled', 'interrupted'].includes(j.status) && j.items.length > 0 && (
                      <button className="btn small ghost" onClick={() => void api.retryJob(j.id)}>
                        <Icon name="refresh" size={14} /> {t('Réessayer')}
                      </button>
                    )}
                    {canRollback && (
                      <button
                        className="btn small ghost"
                        onClick={() =>
                          setConfirm({
                            title: t('Revenir à la version précédente ?'),
                            text: j.items.map((i) => `${i.name} : ${i.availableVersion} → ${j.previousVersions?.[i.key] ?? '?'}`).join('\n'),
                            run: () => void api.rollback(j.id),
                          })
                        }
                      >
                        <Icon name="undo" size={14} /> {t('Version précédente')}
                      </button>
                    )}
                    {driverItems.map((i) => (
                      <button
                        key={i.key}
                        className="btn small ghost"
                        onClick={() =>
                          setConfirm({
                            title: t('Restaurer le pilote précédent ?'),
                            text: t('Le pilote installé pour « {name} » sera retiré du magasin de pilotes ; Windows reviendra à la version précédente. Un redémarrage peut être nécessaire.', { name: i.name }),
                            run: () => void api.driverRollback(j.id, i.key),
                          })
                        }
                      >
                        <Icon name="undo" size={14} /> {t('Restaurer le pilote')}
                      </button>
                    ))}
                  </div>
                </div>
                {j.status === 'running' && (
                  <div className="row-progress big" aria-label={t('Progression')}>
                    <span style={{ width: `${j.progress ?? 5}%` }} className={j.progress === undefined ? 'indeterminate' : ''} />
                  </div>
                )}
                {open === j.id && (
                  <div className="job-body">
                    {j.errorHint && (
                      <div className="callout danger small">
                        <Icon name="info" size={16} />
                        <div>{j.errorHint}</div>
                      </div>
                    )}
                    {j.items.length > 1 && (
                      <ul className="job-items">
                        {j.items.map((i) => (
                          <li key={i.key}>
                            {i.name} <span className="muted">→ {i.targetVersion ?? i.availableVersion}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <JobLog job={j} />
                    <div className="row end">
                      {j.type === 'download' && (
                        <button className="btn small ghost" onClick={() => void api.openDownloads()}>
                          <Icon name="folder" size={14} /> {t('Ouvrir le dossier des téléchargements')}
                        </button>
                      )}
                      <button
                        className="btn small ghost"
                        onClick={() => {
                          void api
                            .jobLog(j.id)
                            .then((l) => copyText(l.join('\n')))
                            .then(() => setCopied(j.id));
                          setTimeout(() => setCopied(null), 2000);
                        }}
                      >
                        <Icon name="copy" size={14} /> {copied === j.id ? t('Copié !') : t('Copier le journal')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {jobs.length > limit && (
            <button className="btn" onClick={() => setLimit(limit + PAGE_SIZE)}>
              {t('Afficher {n} de plus', { n: Math.min(PAGE_SIZE, jobs.length - limit) })}
            </button>
          )}
        </div>
      )}

      {confirm && (
        <Modal
          title={confirm.title}
          confirmLabel={t('Confirmer')}
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            confirm.run();
            setConfirm(null);
          }}
        >
          <p className="pre">{confirm.text}</p>
        </Modal>
      )}
    </div>
  );
}
