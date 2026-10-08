import { useEffect, useState } from 'react';
import type { AppState } from '../../shared/types';
import { t } from '../../shared/i18n';
import { api, formatDate } from '../api';
import logo from '../../resources/icon.png';

export function AboutView({ state }: { state: AppState }) {
  const [changelog, setChangelog] = useState('');
  useEffect(() => {
    void api.changelog().then(setChangelog);
  }, []);
  return (
    <div className="view">
      <div className="about">
        <img src={logo} alt="" width={72} height={72} />
        <div>
          <h1>UpKeep</h1>
          <p className="muted">
            {t('Version {v}', { v: state.appVersion })}
            {state.portable ? ` · ${t('portable')}` : ''}
            {state.fake ? ` · ${t('mode démo')}` : ''}
          </p>
          <SelfUpdate state={state} />
          <p>{t('Vérification périodique des mises à jour : paquets, Windows, pilotes, firmware et BIOS.')}</p>
          <p className="muted small">
            {t('Raccourcis : Ctrl+R vérifier · Ctrl+F rechercher · Ctrl+A tout sélectionner · Entrée installer la sélection · Échap fermer')}
          </p>
          <p className="muted small">{t('Ligne de commande : upkeep-cli --check [--json] · --list · --install-all · --profile=<id>')}</p>
          <p className="muted small">{t('Licence : PolyForm Noncommercial 1.0.0. Toute utilisation commerciale nécessite une licence commerciale.')}</p>
          <p className="muted small">
            {t('Les noms et marques cités (Microsoft, Windows, NVIDIA, Intel, AMD, Lenovo, Dell, HP, ASUS…) appartiennent à leurs propriétaires. UpKeep n’est affilié à aucun d’eux.')}
          </p>
          <p className="muted small" lang="en">This product uses the NVD API but is not endorsed or certified by the NVD.</p>
          <div className="row">
            <button className="btn small" onClick={() => void api.openDownloads()}>
              {t('Dossier des téléchargements')}
            </button>
          </div>
        </div>
      </div>
      <h2 className="section-title">{t('Journal des modifications')}</h2>
      <pre className="log tall changelog" tabIndex={0} aria-label={t('Journal des modifications')}>{changelog || t('(indisponible)')}</pre>
    </div>
  );
}

function SelfUpdate({ state }: { state: AppState }) {
  const u = state.selfUpdate;
  if (u.mode === 'off') return null;
  const last = t('Dernière vérification : {date}', { date: formatDate(u.lastCheck) });
  const text = {
    idle: last,
    checking: t('Recherche d’une nouvelle version…'),
    uptodate: `${t('UpKeep est à jour.')} ${last}`,
    available: t('La version {v} est disponible.', { v: u.version ?? '' }),
    downloading: t('Téléchargement de la version {v}… {p} %', { v: u.version ?? '', p: u.percent ?? 0 }),
    ready: t('La version {v} est téléchargée : elle sera installée à la fermeture d’UpKeep.', { v: u.version ?? '' }),
    error: t('Échec de la recherche de mise à jour : {error}', { error: u.error ?? '' }),
  }[u.status];
  return (
    <div className="self-update">
      <p className={u.status === 'error' ? 'small err-text' : 'small'} aria-live="polite">
        {text}
      </p>
      {u.status === 'downloading' && (
        <div className="row-progress" role="progressbar" aria-valuenow={u.percent ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label={t('Progression')}>
          <span style={{ width: `${u.percent ?? 0}%` }} />
        </div>
      )}
      <div className="row">
        {u.status === 'ready' && (
          <button className="btn primary small" onClick={() => void api.installSelfUpdate()}>
            {t('Redémarrer et installer')}
          </button>
        )}
        {u.status === 'available' && u.mode === 'installer' && (
          <button className="btn primary small" onClick={() => void api.downloadSelfUpdate()}>
            {t('Télécharger et installer')}
          </button>
        )}
        {u.status === 'available' && u.mode === 'manual' && u.url && (
          <button className="btn primary small" onClick={() => void api.openExternal(u.url!)}>
            {t('Ouvrir la page de téléchargement')}
          </button>
        )}
        {u.mode === 'installer' && u.url && (u.status === 'available' || u.status === 'ready') && (
          <button className="btn ghost small" onClick={() => void api.openExternal(u.url!)}>
            {t('Notes de version')}
          </button>
        )}
        {(u.status === 'idle' || u.status === 'uptodate' || u.status === 'error' || u.status === 'checking') && (
          <button className="btn small" disabled={u.status === 'checking'} onClick={() => void api.checkSelfUpdate()}>
            {t('Rechercher une mise à jour d’UpKeep')}
          </button>
        )}
      </div>
    </div>
  );
}
