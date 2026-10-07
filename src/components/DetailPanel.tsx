import { useEffect, useState } from 'react';
import type { AppState, PackageOptions, UpdateDetails, UpdateItem } from '../../shared/types';
import { majorOf } from '../../shared/versions';
import { t } from '../../shared/i18n';
import { api, formatDay, formatSize, KIND_LABEL } from '../api';
import { Icon } from './Icon';
import { KindDot, Switch } from './ui';

interface Props {
  item: UpdateItem;
  state: AppState;
  onClose: () => void;
  onInstall: (items: UpdateItem[], opts?: { downloadOnly?: boolean; versions?: Record<string, string> }) => void;
}

export function DetailPanel({ item, state, onClose, onInstall }: Props) {
  const [details, setDetails] = useState<UpdateDetails | null>(null);
  const [versions, setVersions] = useState<string[] | null>(null);
  const [version, setVersion] = useState('');
  const s = state.settings;
  const opts = s.packageOptions[item.key] ?? {};
  const auto = s.autoUpdate.packages[item.key];

  useEffect(() => {
    setDetails(null);
    setVersions(null);
    setVersion('');
    void api.details(item.key).then(setDetails);
  }, [item.key]);

  const setOpts = (patch: Partial<PackageOptions>) =>
    void api.setSettings({ packageOptions: { ...s.packageOptions, [item.key]: { ...opts, ...patch } } });

  const setAuto = (v: 'auto' | 'never' | '') => {
    const packages = { ...s.autoUpdate.packages };
    if (v) packages[item.key] = v;
    else delete packages[item.key];
    void api.setSettings({ autoUpdate: { ...s.autoUpdate, packages } });
  };

  const pin = s.pins[item.key];
  const currentMajor = majorOf(item.currentVersion);
  const togglePin = () => {
    const pins = { ...s.pins };
    if (pin) delete pins[item.key];
    else if (currentMajor) pins[item.key] = currentMajor;
    void api.setSettings({ pins });
  };

  const d = details ?? {};
  const link = (url?: string, label?: string) =>
    url ? (
      <button className="link" onClick={() => void api.openExternal(url)}>
        {label ?? url} <Icon name="external" size={12} />
      </button>
    ) : null;
  const isWinget = item.providerId === 'winget';

  return (
    <aside className="detail" aria-label={t('Détails')}>
      <header className="detail-head">
        <div>
          <div className="detail-title">
            <KindDot kind={item.kind} /> {item.name}
          </div>
          <div className="muted small">
            {KIND_LABEL()[item.kind]} · {item.source ?? item.providerId}
            {item.alsoVia?.length ? ` · ${t('aussi via {list}', { list: item.alsoVia.join(', ') })}` : ''}
          </div>
        </div>
        <button className="btn ghost icon" aria-label={t('Fermer')} onClick={onClose}>
          <Icon name="x" />
        </button>
      </header>

      <div className="detail-versions">
        <div>
          <div className="muted small">{t('Installée')}</div>
          <div className="version">{item.currentVersion || '—'}</div>
          {item.currentDate && <div className="muted small">{item.currentDate}</div>}
        </div>
        <Icon name="down" className="rot" />
        <div>
          <div className="muted small">{t('Disponible')}</div>
          <div className="version new">{item.availableVersion || '—'}</div>
          {item.availableDate && <div className="muted small">{item.availableDate}</div>}
        </div>
      </div>

      {item.security && (
        <div className="callout danger small">
          <Icon name="shield" size={16} />
          <div>
            {t('Mise à jour de sécurité')}
            {item.cves?.length ? <div className="muted small cves">{item.cves.slice(0, 12).join(', ')}</div> : null}
          </div>
        </div>
      )}
      {item.quarantineUntil && (
        <div className="callout small">
          <Icon name="clock" size={16} />
          <div>{t('En quarantaine jusqu’au {date} (version récente).', { date: formatDay(item.quarantineUntil) })}</div>
        </div>
      )}

      <dl className="detail-list">
        {d.description && (
          <>
            <dt>{t('Description')}</dt>
            <dd className="pre">{d.description}</dd>
          </>
        )}
        {(d.publisher ?? item.publisher) && (
          <>
            <dt>{t('Éditeur')}</dt>
            <dd>{d.publisher ?? item.publisher}</dd>
          </>
        )}
        {d.license && (
          <>
            <dt>{t('Licence')}</dt>
            <dd>{d.license}</dd>
          </>
        )}
        {(d.publishedAt ?? item.publishedAt) && (
          <>
            <dt>{t('Publiée le')}</dt>
            <dd>{formatDay(d.publishedAt ?? item.publishedAt)}</dd>
          </>
        )}
        {(d.sizeBytes ?? item.sizeBytes) ? (
          <>
            <dt>{t('Taille')}</dt>
            <dd>{formatSize(d.sizeBytes ?? item.sizeBytes)}</dd>
          </>
        ) : null}
        {(d.homepage ?? item.homepage) && (
          <>
            <dt>{t('Site')}</dt>
            <dd>{link(d.homepage ?? item.homepage)}</dd>
          </>
        )}
        {(d.releaseNotesUrl ?? item.releaseNotesUrl) && (
          <>
            <dt>{t('Notes de version')}</dt>
            <dd>{link(d.releaseNotesUrl ?? item.releaseNotesUrl, t('Ouvrir'))}</dd>
          </>
        )}
        {item.details && (
          <>
            <dt>{t('Infos')}</dt>
            <dd>{item.details}</dd>
          </>
        )}
        {Object.entries(d.extra ?? {}).map(([k, v]) => (
          <span key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </span>
        ))}
        {!details && <dd className="muted">{t('Chargement des détails…')}</dd>}
      </dl>
      {d.releaseNotesBetween ? (
        <details className="notes" open>
          <summary>{t('Nouveautés depuis votre version ({v})', { v: item.currentVersion ?? '?' })}</summary>
          <pre>{d.releaseNotesBetween}</pre>
        </details>
      ) : (
        d.releaseNotes && (
          <details className="notes">
            <summary>{t('Notes de version')}</summary>
            <pre>{d.releaseNotes}</pre>
          </details>
        )
      )}

      {item.supportsVersions && (
        <section className="detail-section">
          <h3>{t('Installer une version précise')}</h3>
          {versions === null ? (
            <button className="btn small" onClick={() => void api.versions(item.key).then(setVersions)}>
              {t('Charger les versions')}
            </button>
          ) : (
            <div className="row">
              <select value={version} onChange={(e) => setVersion(e.target.value)} aria-label={t('Version')}>
                <option value="">{t('Choisir…')}</option>
                {versions.map((v) => (
                  <option key={v} value={v}>
                    {v}
                    {v === item.currentVersion ? ` (${t('installée')})` : ''}
                  </option>
                ))}
              </select>
              <button className="btn small" disabled={!version} onClick={() => onInstall([item], { versions: { [item.key]: version } })}>
                {t('Installer cette version')}
              </button>
            </div>
          )}
        </section>
      )}

      <section className="detail-section">
        <h3>{t('Automatisation')}</h3>
        <div className="row">
          <select value={auto ?? ''} onChange={(e) => setAuto(e.target.value as 'auto' | 'never' | '')} aria-label={t('Mise à jour automatique')}>
            <option value="">{t('Selon la source')}</option>
            <option value="auto">{t('Toujours automatique')}</option>
            <option value="never">{t('Jamais automatique')}</option>
          </select>
        </div>
        {currentMajor && item.kind === 'package' && (
          <label className="check-row">
            <input type="checkbox" checked={!!pin} onChange={togglePin} />
            {t('Rester sur la version majeure {major}', { major: pin ?? currentMajor })}
          </label>
        )}
      </section>

      {isWinget && (
        <section className="detail-section">
          <h3>{t('Options winget')}</h3>
          <div className="grid2">
            <label>
              {t('Portée')}
              <select value={opts.scope ?? ''} onChange={(e) => setOpts({ scope: (e.target.value || undefined) as PackageOptions['scope'] })}>
                <option value="">{t('Par défaut')}</option>
                <option value="user">{t('Utilisateur')}</option>
                <option value="machine">{t('Machine')}</option>
              </select>
            </label>
            <label>
              {t('Architecture')}
              <select value={opts.architecture ?? ''} onChange={(e) => setOpts({ architecture: (e.target.value || undefined) as PackageOptions['architecture'] })}>
                <option value="">{t('Par défaut')}</option>
                <option value="x64">x64</option>
                <option value="x86">x86</option>
                <option value="arm64">arm64</option>
              </select>
            </label>
          </div>
          <label className="col">
            {t('Arguments supplémentaires pour l’installeur')}
            <input type="text" value={opts.customArgs ?? ''} placeholder="/NORESTART" onChange={(e) => setOpts({ customArgs: e.target.value })} />
          </label>
        </section>
      )}
      {item.kind === 'package' && (
        <section className="detail-section">
          <h3>{t('Application à fermer')}</h3>
          <div className="row">
            <input
              type="text"
              value={opts.closeProcess ?? ''}
              placeholder={t('nom du processus, ex. firefox')}
              aria-label={t('Processus à fermer')}
              onChange={(e) => setOpts({ closeProcess: e.target.value || undefined })}
            />
          </div>
          <label className="check-row">
            <Switch checked={!!opts.relaunch} onChange={(v) => setOpts({ relaunch: v })} label={t('Relancer après la mise à jour')} />
            {t('Relancer après la mise à jour')}
          </label>
        </section>
      )}

      {item.deviceAbsent && (
        <section className="detail-section">
          <h3>{t('Périphérique absent')}</h3>
          <p className="muted small">{t('Ce pilote vise un périphérique déjà branché un jour mais absent aujourd’hui.')}</p>
          <button className="btn small" onClick={() => void api.forgetDevices([item.key])}>
            <Icon name="trash" size={14} /> {t('Oublier ce périphérique')}
          </button>
        </section>
      )}
      <footer className="detail-foot">
        {item.supportsDownload && (
          <button className="btn" onClick={() => onInstall([item], { downloadOnly: true })}>
            <Icon name="folder" size={16} /> {t('Télécharger seulement')}
          </button>
        )}
        <button className="btn primary" onClick={() => onInstall([item])}>
          <Icon name="download" size={16} /> {t('Mettre à jour')}
        </button>
      </footer>
    </aside>
  );
}
