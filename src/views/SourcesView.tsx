import { useState } from 'react';
import type { AppState, ProviderInfo } from '../../shared/types';
import { t } from '../../shared/i18n';
import { api, copyText, formatDate, formatRelative, KIND_LABEL } from '../api';
import { Icon } from '../components/Icon';
import { Modal, Switch } from '../components/ui';

const GROUP_ORDER = ['Paquets', 'Applications', 'Windows', 'Pilotes & firmware', 'Développement'];

function status(p: ProviderInfo): { label: string; cls: string } {
  if (!p.applicable && !p.available) return { label: t('Non applicable à ce PC'), cls: 'off' };
  if (!p.available) return { label: t('Outil non installé'), cls: 'warn' };
  if (p.checking) return { label: t('Vérification…'), cls: 'busy' };
  if (p.error) return { label: t('Erreur'), cls: 'err' };
  if (!p.enabled) return { label: t('Désactivée'), cls: 'off' };
  return { label: t('Prête'), cls: 'ok' };
}

const INTERVALS = [0, 30, 60, 240, 720, 1440, 10080];

export function SourcesView({ state }: { state: AppState }) {
  const s = state.settings;
  const [trace, setTrace] = useState<{ name: string; text: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const setProvider = (p: ProviderInfo, v: boolean) => void api.setSettings({ providers: { ...s.providers, [p.id]: v } });
  const setAuto = (p: ProviderInfo, v: boolean) =>
    void api.setSettings({ autoUpdate: { ...s.autoUpdate, providers: { ...s.autoUpdate.providers, [p.id]: v } } });
  const setInterval_ = (p: ProviderInfo, v: number) => void api.setSettings({ providerIntervals: { ...s.providerIntervals, [p.id]: v } });
  const setTimeout_ = (p: ProviderInfo, v: number) => void api.setSettings({ providerTimeouts: { ...s.providerTimeouts, [p.id]: v } });
  const intervalLabel = (m: number) =>
    m === 0 ? t('Fréquence globale') : m < 60 ? t('{n} min', { n: m }) : m < 1440 ? t('{n} h', { n: m / 60 }) : m === 10080 ? t('1 semaine') : t('{n} j', { n: m / 1440 });

  const groups = GROUP_ORDER.map((g) => ({
    g,
    items: state.providers
      .filter((p) => p.group === g)
      .sort((a, b) => Number(b.applicable) - Number(a.applicable) || Number(b.available) - Number(a.available)),
  })).filter((x) => x.items.length);

  const policyNotes = [
    state.policy.wsusServer && t('Ce PC est configuré pour un serveur WSUS ({srv}) ; UpKeep interroge tout de même Windows Update directement.', { srv: state.policy.wsusServer }),
    state.policy.intune && t('Ce PC est géré par une organisation (Intune / MDM) : certaines mises à jour peuvent être bloquées par stratégie.'),
    state.policy.driversExcluded && t('Une stratégie exclut les pilotes des mises à jour de qualité Windows Update.'),
  ].filter(Boolean) as string[];

  return (
    <div className="view">
      <header className="view-header">
        <div>
          <h1>{t('Sources')}</h1>
          <p className="muted">{t('Gestionnaires de paquets, Windows Update, pilotes graphiques et outils constructeur.')}</p>
        </div>
      </header>

      {policyNotes.map((n) => (
        <div key={n} className="callout small">
          <Icon name="info" size={16} />
          <div>{n}</div>
        </div>
      ))}

      {groups.map(({ g, items }) => (
        <section key={g}>
          <h2 className="section-title">{t(g)}</h2>
          <div className="cards">
            {items.map((p) => {
              const st = status(p);
              const dim = !p.applicable && !p.available;
              return (
                <div key={p.id} className={`card ${dim ? 'dim' : ''}`}>
                  <div className="card-head">
                    <div>
                      <div className="card-title">
                        {t(p.name)} {p.experimental && <span className="tag">{t('expérimental')}</span>}
                      </div>
                      <div className="muted small">
                        {KIND_LABEL()[p.kind]} · {t(p.description)}
                      </div>
                    </div>
                    <Switch checked={p.enabled} onChange={(v) => setProvider(p, v)} label={p.enabled ? t('Désactiver') : t('Activer')} />
                  </div>
                  <div className="card-body">
                    <span className={`status ${st.cls}`}>{st.label}</span>
                    {p.available && p.enabled && (
                      <span className="muted small">
                        {t('{n} mise(s) à jour', { n: p.count })} · {t('vérifié {when}', { when: formatDate(p.lastCheck) })}
                        {p.nextCheck ? ` · ${t('prochaine {when}', { when: formatRelative(p.nextCheck) })}` : ''}
                        {p.durationMs !== undefined ? ` · ${t('{s} s', { s: (p.durationMs / 1000).toFixed(1) })}` : ''}
                      </span>
                    )}
                  </div>
                  {p.note && <div className="muted small note">{t(p.note)}</div>}
                  {p.error && <pre className="error-box">{p.error}</pre>}
                  {expanded === p.id && p.available && (
                    <div className="card-settings">
                      <label>
                        {t('Fréquence')}
                        <select value={p.intervalMinutes} onChange={(e) => setInterval_(p, Number(e.target.value))}>
                          {INTERVALS.map((m) => (
                            <option key={m} value={m}>
                              {intervalLabel(m)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        {t('Délai max (min)')}
                        <input type="number" min={1} max={120} value={p.timeoutMinutes} onChange={(e) => setTimeout_(p, Number(e.target.value))} />
                      </label>
                      <label className="check-row">
                        <Switch checked={p.autoUpdate} onChange={(v) => setAuto(p, v)} label={t('Mises à jour automatiques')} />
                        {t('Mises à jour automatiques')}
                      </label>
                    </div>
                  )}
                  <div className="card-actions">
                    {p.available ? (
                      <>
                        <button className="btn small" disabled={p.checking || !p.enabled} onClick={() => void api.checkProvider(p.id)}>
                          <Icon name="refresh" size={15} className={p.checking ? 'spin' : ''} /> {t('Vérifier')}
                        </button>
                        <button className="btn small ghost" aria-expanded={expanded === p.id} onClick={() => setExpanded(expanded === p.id ? null : p.id)}>
                          <Icon name="settings" size={15} /> {t('Réglages')}
                        </button>
                        {p.hasTrace && (
                          <button className="btn small ghost" onClick={() => void api.providerTrace(p.id).then((text) => setTrace({ name: p.name, text }))}>
                            <Icon name="terminal" size={15} /> {t('Journal')}
                          </button>
                        )}
                      </>
                    ) : (
                      p.setupLabel &&
                      p.applicable && (
                        <button className="btn small primary" onClick={() => void api.setupProvider(p.id)}>
                          <Icon name="download" size={15} /> {t(p.setupLabel)}
                        </button>
                      )
                    )}
                    {p.actions?.map((a) => (
                      <button key={a.id} className="btn small ghost" onClick={() => void api.providerAction(p.id, a.id)}>
                        <Icon name="bolt" size={15} /> {t(a.label)}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {trace && (
        <Modal title={t('Journal de diagnostic — {name}', { name: trace.name })} wide onCancel={() => setTrace(null)}>
          <pre className="log tall">{trace.text || t('(vide)')}</pre>
          <button className="btn small" onClick={() => void copyText(trace.text)}>
            <Icon name="copy" size={14} /> {t('Copier')}
          </button>
        </Modal>
      )}
    </div>
  );
}
