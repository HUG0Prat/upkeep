import { useEffect, useState } from 'react';
import type { AppState, CleanupItem } from '../../shared/types';
import { t } from '../../shared/i18n';
import { api, formatSize } from '../api';
import { Icon } from '../components/Icon';
import { Modal } from '../components/ui';

let memo: CleanupItem[] | null = null;

export function MaintenanceView({ state }: { state: AppState }) {
  const [items, setItems] = useState<CleanupItem[] | null>(memo);
  const [confirm, setConfirm] = useState<CleanupItem | null>(null);
  const [forgetAll, setForgetAll] = useState(false);
  const load = (force = false) => {
    if (force) setItems(null);
    void api.cleanupList().then((r) => {
      memo = r;
      setItems(r);
    });
  };
  useEffect(() => {
    if (!memo) load();
  }, []);
  const cleanupJobs = state.jobs.filter((j) => j.type === 'cleanup' && j.status === 'success').length;
  useEffect(() => {
    if (cleanupJobs) load(true);
  }, [cleanupJobs]);

  const absent = state.hiddenAbsent;
  const total = (items ?? []).reduce((s, i) => s + (i.sizeBytes ?? 0), 0);

  return (
    <div className="view">
      <header className="view-header">
        <div>
          <h1>{t('Maintenance')}</h1>
          <p className="muted">{items ? t('Espace récupérable : {size}', { size: formatSize(total) || '0' }) : t('Calcul de l’espace récupérable…')}</p>
        </div>
        <div className="header-actions">
          <button className="btn" onClick={() => load(true)} disabled={!items}>
            <Icon name="refresh" /> {t('Actualiser')}
          </button>
        </div>
      </header>

      <section className="settings">
        {(items ?? []).map((i) => (
          <div key={i.id} className="setting">
            <div>
              <div>
                {i.label} {i.requiresAdmin && <span className="tag">admin</span>}
              </div>
              <div className="muted small">{i.description}</div>
            </div>
            <div className="row">
              <span className="muted small nowrap">{i.count !== undefined ? t('{n} élément(s)', { n: i.count }) : formatSize(i.sizeBytes) || t('vide')}</span>
              <button className="btn small" disabled={!(i.sizeBytes || i.count)} onClick={() => setConfirm(i)}>
                <Icon name="trash" size={14} /> {t('Nettoyer')}
              </button>
            </div>
          </div>
        ))}
        {!items && <div className="setting muted">{t('Analyse en cours…')}</div>}
        <div className="setting">
          <div>
            <div>{t('Périphériques absents mémorisés')}</div>
            <div className="muted small">{t('Windows continue de proposer les pilotes des périphériques branchés un jour puis retirés. Les oublier supprime ces propositions.')}</div>
          </div>
          <div className="row">
            <span className="muted small">{t('{n} pilote(s) proposés', { n: absent })}</span>
            <button className="btn small" disabled={!absent} onClick={() => setForgetAll(true)}>
              {t('Oublier tous')}
            </button>
          </div>
        </div>
      </section>

      {confirm && (
        <Modal
          title={t('Nettoyer « {name} » ?', { name: confirm.label })}
          confirmLabel={t('Nettoyer')}
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            void api.runCleanup(confirm.id, confirm.requiresAdmin);
            setConfirm(null);
          }}
        >
          <p>{confirm.description}</p>
          {confirm.requiresAdmin && (
            <p className="muted">
              <Icon name="shield" size={16} /> {t('Nécessite les droits administrateur.')}
            </p>
          )}
        </Modal>
      )}
      {forgetAll && (
        <Modal
          title={t('Oublier les périphériques absents ?')}
          confirmLabel={t('Oublier')}
          danger
          onCancel={() => setForgetAll(false)}
          onConfirm={() => {
            void api.forgetAllAbsent();
            setForgetAll(false);
          }}
        >
          <p>{t('Windows supprimera ces périphériques de sa mémoire. S’ils sont rebranchés, ils seront simplement redétectés.')}</p>
        </Modal>
      )}
    </div>
  );
}
