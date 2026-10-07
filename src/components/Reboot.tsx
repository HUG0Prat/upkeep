import { useEffect, useState } from 'react';
import type { AppState } from '../../shared/types';
import { intlLocale, t } from '../../shared/i18n';
import { api, formatRelative } from '../api';
import { Icon } from './Icon';
import { Modal } from './ui';

type Choice = 'now' | 'in' | 'at' | 'never';

function nextOccurrence(hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d;
}

function formatTarget(d: Date): string {
  const tomorrow = d.getDate() !== new Date().getDate();
  const time = d.toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' });
  return tomorrow ? t('demain à {time}', { time }) : t('aujourd’hui à {time}', { time });
}

export function RebootDialog({ onClose }: { onClose: () => void }) {
  const [choice, setChoice] = useState<Choice>('in');
  const [amount, setAmount] = useState(30);
  const [unit, setUnit] = useState<'min' | 'h'>('min');
  const [time, setTime] = useState(() => {
    const d = new Date(Date.now() + 2 * 3600_000);
    return `${String(d.getHours()).padStart(2, '0')}:00`;
  });
  const [error, setError] = useState<string | null>(null);

  const delaySeconds = (): number => {
    if (choice === 'now') return 0;
    if (choice === 'in') return Math.max(1, amount) * (unit === 'h' ? 3600 : 60);
    return Math.round((nextOccurrence(time).getTime() - Date.now()) / 1000);
  };

  const confirmLabel = choice === 'now' ? t('Redémarrer maintenant') : choice === 'never' ? t('Ne pas redémarrer') : t('Planifier le redémarrage');

  const confirm = async () => {
    try {
      if (choice === 'never') await api.dismissReboot();
      else await api.scheduleReboot(delaySeconds());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Modal title={t('Redémarrage')} confirmLabel={confirmLabel} danger={choice === 'now'} onConfirm={() => void confirm()} onCancel={onClose}>
      <div className="radio-list" role="radiogroup">
        <label className={`radio ${choice === 'now' ? 'checked' : ''}`}>
          <input type="radio" checked={choice === 'now'} onChange={() => setChoice('now')} />
          <span>{t('Redémarrer maintenant')}</span>
        </label>
        <label className={`radio ${choice === 'in' ? 'checked' : ''}`}>
          <input type="radio" checked={choice === 'in'} onChange={() => setChoice('in')} />
          <span>{t('Redémarrer dans')}</span>
          <input type="number" min={1} value={amount} aria-label={t('Durée')} onFocus={() => setChoice('in')} onChange={(e) => setAmount(Number(e.target.value))} />
          <select value={unit} aria-label={t('Unité')} onFocus={() => setChoice('in')} onChange={(e) => setUnit(e.target.value as 'min' | 'h')}>
            <option value="min">{t('minutes')}</option>
            <option value="h">{t('heures')}</option>
          </select>
        </label>
        <label className={`radio ${choice === 'at' ? 'checked' : ''}`}>
          <input type="radio" checked={choice === 'at'} onChange={() => setChoice('at')} />
          <span>{t('Redémarrer à')}</span>
          <input type="time" value={time} aria-label={t('Heure')} onFocus={() => setChoice('at')} onChange={(e) => setTime(e.target.value)} />
          {choice === 'at' && time && <span className="muted small">{formatTarget(nextOccurrence(time))}</span>}
        </label>
        <label className={`radio ${choice === 'never' ? 'checked' : ''}`}>
          <input type="radio" checked={choice === 'never'} onChange={() => setChoice('never')} />
          <span>{t('Ne pas redémarrer')}</span>
          <span className="muted small">{t('je le ferai moi-même')}</span>
        </label>
      </div>
      {choice === 'now' && (
        <p className="warn-text">
          <Icon name="alert" size={16} /> {t('Enregistrez votre travail : Windows redémarre immédiatement.')}
        </p>
      )}
      {error && <p className="warn-text">{error}</p>}
    </Modal>
  );
}

export function RebootBanner({ state }: { state: AppState }) {
  const [open, setOpen] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    const tm = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(tm);
  }, []);

  if (!state.scheduledReboot && !state.pendingReboot) return null;

  return (
    <>
      <div className="reboot-banner" role="status">
        <Icon name="power" />
        {state.scheduledReboot ? (
          <div>
            {t('Redémarrage planifié {when}', { when: formatTarget(new Date(state.scheduledReboot)) })}{' '}
            <span className="muted">({formatRelative(state.scheduledReboot)})</span>
          </div>
        ) : (
          <div>{t('Un redémarrage est nécessaire pour finaliser certaines mises à jour.')}</div>
        )}
        {state.scheduledReboot ? (
          <>
            <button className="btn small" onClick={() => setOpen(true)}>
              {t('Modifier…')}
            </button>
            <button className="btn small ghost" onClick={() => void api.cancelReboot()}>
              {t('Annuler le redémarrage')}
            </button>
          </>
        ) : (
          <>
            <button className="btn small warn" onClick={() => setOpen(true)}>
              {t('Redémarrer…')}
            </button>
            <button className="btn small ghost icon" title={t('Ne pas redémarrer')} aria-label={t('Ne pas redémarrer')} onClick={() => void api.dismissReboot()}>
              <Icon name="x" size={16} />
            </button>
          </>
        )}
      </div>
      {open && <RebootDialog onClose={() => setOpen(false)} />}
    </>
  );
}
