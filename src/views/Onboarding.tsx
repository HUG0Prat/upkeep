import { useState } from 'react';
import type { AppState } from '../../shared/types';
import { t } from '../../shared/i18n';
import { api } from '../api';
import { Switch } from '../components/ui';
import logo from '../../resources/icon.png';

export function Onboarding({ state }: { state: AppState }) {
  const s = state.settings;
  const [step, setStep] = useState(0);
  const [providers, setProviders] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(state.providers.filter((p) => p.available || p.applicable).map((p) => [p.id, p.enabled])),
  );
  const [interval, setInterval_] = useState(s.intervalMinutes);
  const [startup, setStartup] = useState(s.launchAtStartup);
  const [profile, setProfile] = useState(s.defaultProfile);
  const [lang, setLang] = useState(s.language);

  const finish = () =>
    void api.setSettings({
      providers: { ...s.providers, ...providers },
      intervalMinutes: interval,
      launchAtStartup: startup,
      defaultProfile: profile,
      activeProfile: profile,
      language: lang,
      onboarded: true,
    });

  const steps = [
    <div key="0" className="onb-step">
      <img src={logo} alt="" width={80} height={80} />
      <h1>{t('Bienvenue dans UpKeep')}</h1>
      <p>{t('UpKeep surveille les mises à jour de vos logiciels, de Windows, de vos pilotes et de votre BIOS, et les installe quand vous le décidez.')}</p>
      <label className="col">
        {t('Langue')}
        <select value={lang} onChange={(e) => setLang(e.target.value as typeof lang)}>
          <option value="auto">{t('Langue de Windows')}</option>
          <option value="fr">Français</option>
          <option value="en">English</option>
          <option value="de">Deutsch</option>
          <option value="es">Español</option>
        </select>
      </label>
    </div>,
    <div key="1" className="onb-step">
      <h2>{t('Sources à surveiller')}</h2>
      <p className="muted">{t('Seules les sources détectées sur ce PC sont proposées. Vous pourrez changer d’avis dans « Sources ».')}</p>
      <div className="onb-list">
        {state.providers
          .filter((p) => p.available || p.applicable)
          .map((p) => (
            <label key={p.id} className="check-row">
              <Switch checked={!!providers[p.id]} onChange={(v) => setProviders({ ...providers, [p.id]: v })} label={p.name} />
              <span>
                {p.name} {!p.available && <span className="tag">{t('outil à installer')}</span>}
              </span>
            </label>
          ))}
      </div>
    </div>,
    <div key="2" className="onb-step">
      <h2>{t('Rythme et démarrage')}</h2>
      <label className="col">
        {t('Fréquence de vérification')}
        <select value={interval} onChange={(e) => setInterval_(Number(e.target.value))}>
          {[60, 240, 720, 1440].map((v) => (
            <option key={v} value={v}>
              {v < 1440 ? t('{n} heure(s)', { n: v / 60 }) : t('1 jour')}
            </option>
          ))}
        </select>
      </label>
      <label className="check-row">
        <Switch checked={startup} onChange={setStartup} label={t('Lancer avec Windows')} />
        {t('Lancer avec Windows (réduit dans la zone de notification)')}
      </label>
      <label className="col">
        {t('Profil au lancement')}
        <select value={profile} onChange={(e) => setProfile(e.target.value)}>
          {s.profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
    </div>,
  ];

  return (
    <div className="onboarding" role="dialog" aria-modal aria-label={t('Bienvenue dans UpKeep')}>
      <div className="onb-card">
        {steps[step]}
        <div className="onb-foot">
          <div className="dots" aria-hidden>
            {steps.map((_, i) => (
              <span key={i} className={i === step ? 'on' : ''} />
            ))}
          </div>
          <button className="btn ghost" onClick={() => void api.setSettings({ onboarded: true })}>
            {t('Passer')}
          </button>
          {step > 0 && (
            <button className="btn" onClick={() => setStep(step - 1)}>
              {t('Précédent')}
            </button>
          )}
          {step < steps.length - 1 ? (
            <button className="btn primary" onClick={() => setStep(step + 1)}>
              {t('Suivant')}
            </button>
          ) : (
            <button className="btn primary" onClick={finish}>
              {t('Commencer')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
