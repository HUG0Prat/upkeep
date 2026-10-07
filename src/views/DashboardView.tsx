import { useEffect, useState } from 'react';
import type { AppState, SecurityReport, UpdateKind, WeeklySummary } from '../../shared/types';
import { t } from '../../shared/i18n';
import { api, formatDate, formatRelative, KIND_LABEL } from '../api';
import { Icon, type IconName } from '../components/Icon';
import { KindDot } from '../components/ui';

let securityMemo: SecurityReport | null = null;

export function DashboardView({ state, go }: { state: AppState; go: (page: string) => void }) {
  const [weekly, setWeekly] = useState<WeeklySummary | null>(null);
  const [security, setSecurity] = useState<SecurityReport | null>(securityMemo);
  useEffect(() => {
    void api.weeklySummary().then(setWeekly);
    if (!securityMemo)
      void api
        .security()
        .then((s) => {
          securityMemo = s;
          setSecurity(s);
        })
        .catch(() => undefined);
  }, [state.jobs.length]);

  const u = state.updates;
  const sec = u.filter((x) => x.security);
  const exploited = u.filter((x) => x.exploited);
  const checking = state.providers.some((p) => p.checking);
  const running = state.jobs.filter((j) => j.status === 'running' || j.status === 'queued').length;
  const failedSources = state.providers.filter((p) => p.enabled && p.available && p.error);
  const badChecks = security?.checks.filter((c) => c.status === 'bad' || c.status === 'warn') ?? [];
  const eolBad = security?.eol.filter((e) => e.status !== 'ok') ?? [];

  const status: { icon: IconName; cls: string; title: string; text: string } = exploited.length
    ? { icon: 'alert', cls: 'bad', title: t('Mise à jour urgente'), text: t('{n} mise(s) à jour corrigent une faille activement exploitée.', { n: exploited.length }) }
    : sec.length
      ? { icon: 'shield', cls: 'warn', title: t('Mises à jour de sécurité en attente'), text: t('{n} mise(s) à jour de sécurité à installer.', { n: sec.length }) }
      : u.length
        ? { icon: 'download', cls: 'info', title: t('Des mises à jour sont disponibles'), text: t('{n} mise(s) à jour, aucune urgente.', { n: u.length }) }
        : { icon: 'check', cls: 'ok', title: t('Tout est à jour'), text: t('Aucune mise à jour en attente.') };

  const byKind = (k: UpdateKind) => u.filter((x) => x.kind === k).length;

  return (
    <div className="view">
      <header className="view-header">
        <div>
          <h1>{t('Accueil')}</h1>
          <p className="muted">
            {checking
              ? t('Vérification en cours…')
              : t('Dernière vérification : {last} · prochaine {next}', { last: formatDate(state.lastFullCheck), next: formatRelative(state.nextCheck) })}
          </p>
        </div>
        <div className="header-actions">
          <button className="btn" disabled={checking} onClick={() => void api.checkAll()}>
            <Icon name="refresh" className={checking ? 'spin' : ''} /> {t('Vérifier maintenant')}
          </button>
        </div>
      </header>

      <section className={`hero ${status.cls}`} aria-live="polite">
        <Icon name={status.icon} size={32} />
        <div>
          <h2>{status.title}</h2>
          <p>{status.text}</p>
        </div>
        {u.length > 0 && (
          <button className="btn primary" onClick={() => go('updates')}>
            {t('Voir les mises à jour')}
          </button>
        )}
      </section>

      <div className="tiles">
        {(['package', 'system', 'driver', 'firmware'] as UpdateKind[]).map((k) => (
          <button key={k} className="tile" onClick={() => go('updates')}>
            <span className="tile-label">
              <KindDot kind={k} /> {KIND_LABEL()[k]}
            </span>
            <span className="tile-value">{byKind(k)}</span>
          </button>
        ))}
        <button className="tile" onClick={() => go('history')}>
          <span className="tile-label">
            <Icon name="clock" size={14} /> {t('En cours')}
          </span>
          <span className="tile-value">{running}</span>
        </button>
      </div>

      <div className="dash-grid">
        <section className="card">
          <div className="card-title">
            <Icon name="shield" size={16} /> {t('Sécurité du poste')}
          </div>
          {!security ? (
            <p className="muted small">{t('Analyse en cours…')}</p>
          ) : badChecks.length || eolBad.length ? (
            <ul className="alert-list">
              {badChecks.map((c) => (
                <li key={c.id} className={c.status}>
                  <Icon name="alert" size={14} /> {c.label} : {c.value}
                </li>
              ))}
              {eolBad.map((e) => (
                <li key={e.product} className={e.status === 'eol' ? 'bad' : 'warn'}>
                  <Icon name="clock" size={14} /> {e.status === 'eol' ? t('{p} n’est plus maintenu', { p: e.product }) : t('{p} : fin de support le {d}', { p: e.product, d: e.eol || '?' })}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">
              <Icon name="check" size={14} /> {t('Aucun problème détecté.')}
            </p>
          )}
          <button className="link" onClick={() => go('security')}>
            {t('Rapport complet')}
          </button>
        </section>

        <section className="card">
          <div className="card-title">
            <Icon name="chart" size={16} /> {t('Ces 7 derniers jours')}
          </div>
          {weekly ? (
            <dl className="detail-list">
              <dt>{t('Installées')}</dt>
              <dd>{Object.values(weekly.installed).reduce((a, b) => a + b, 0)}</dd>
              <dt>{t('Échecs')}</dt>
              <dd>{weekly.failed}</dd>
              <dt>{t('En quarantaine')}</dt>
              <dd>{weekly.quarantined}</dd>
              <dt>{t('Ignorées')}</dt>
              <dd>{weekly.ignored}</dd>
            </dl>
          ) : (
            <p className="muted small">…</p>
          )}
        </section>

        <section className="card">
          <div className="card-title">
            <Icon name="layers" size={16} /> {t('Sources')}
          </div>
          <p className="small">
            {t('{n} source(s) actives sur {total}.', {
              n: state.providers.filter((p) => p.enabled && p.available).length,
              total: state.providers.filter((p) => p.applicable || p.available).length,
            })}
          </p>
          {failedSources.length > 0 && (
            <ul className="alert-list">
              {failedSources.map((p) => (
                <li key={p.id} className="warn">
                  <Icon name="alert" size={14} /> {t(p.name)} : {t('erreur')}
                </li>
              ))}
            </ul>
          )}
          {state.pendingReboot && (
            <p className="warn-text small">
              <Icon name="power" size={14} /> {t('Redémarrage en attente')}
            </p>
          )}
          <button className="link" onClick={() => go('sources')}>
            {t('Gérer les sources')}
          </button>
        </section>
      </div>
    </div>
  );
}
