import { useEffect, useState } from 'react';
import type { AppState } from '../../shared/types';
import { t } from '../../shared/i18n';
import { api } from '../api';
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
