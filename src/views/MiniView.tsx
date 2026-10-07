import type { AppState } from '../../shared/types';
import { t } from '../../shared/i18n';
import { api, formatRelative } from '../api';
import { Icon } from '../components/Icon';
import { KindDot } from '../components/ui';

export function MiniView({ state }: { state: AppState }) {
  const checking = state.providers.some((p) => p.checking);
  const running = state.jobs.filter((j) => j.status === 'running' || j.status === 'queued').length;
  const top = [...state.updates].sort((a, b) => Number(!!b.security) - Number(!!a.security)).slice(0, 8);
  return (
    <div className="mini">
      <header className="mini-head">
        <strong>UpKeep</strong>
        <span className="muted small">
          {checking ? t('Vérification…') : t('{n} mise(s) à jour', { n: state.updates.length })}
          {running ? ` · ${t('{n} en cours', { n: running })}` : ''}
        </span>
        <button className="btn small ghost icon" aria-label={t('Vérifier maintenant')} disabled={checking} onClick={() => void api.checkAll()}>
          <Icon name="refresh" size={15} className={checking ? 'spin' : ''} />
        </button>
      </header>
      <ul className="mini-list">
        {top.length === 0 && (
          <li className="muted">
            <Icon name="check" size={16} /> {t('Tout est à jour.')}
          </li>
        )}
        {top.map((u) => (
          <li key={u.key}>
            <KindDot kind={u.kind} />
            <span className="mini-name">{u.name}</span>
            {u.security && <span className="tag danger">{t('sécurité')}</span>}
            <span className="version new">{u.availableVersion}</span>
          </li>
        ))}
        {state.updates.length > top.length && <li className="muted small">{t('et {n} autre(s)…', { n: state.updates.length - top.length })}</li>}
      </ul>
      <div className="muted small mini-next">{t('Prochaine vérification {when}', { when: formatRelative(state.nextCheck) })}</div>
      <footer className="mini-foot">
        <button className="btn" onClick={() => void api.showMain('updates')}>
          {t('Ouvrir')}
        </button>
        <button
          className="btn primary"
          disabled={!state.updates.length}
          onClick={() => {
            void api.install(state.updates.filter((u) => u.kind !== 'firmware').map((u) => u.key)).catch(() => undefined);
          }}
          title={t('Les firmwares/BIOS ne sont pas inclus : installez-les depuis la fenêtre principale.')}
        >
          <Icon name="download" size={16} /> {t('Tout installer')}
        </button>
      </footer>
    </div>
  );
}
