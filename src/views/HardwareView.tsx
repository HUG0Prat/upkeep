import { useEffect, useState } from 'react';
import type { AppState, HardwareInfo, VendorTool } from '../../shared/types';
import { t } from '../../shared/i18n';
import { api } from '../api';
import { Icon } from '../components/Icon';

function Tool({ tool }: { tool?: VendorTool }) {
  if (!tool) return null;
  return (
    <span className="row">
      {tool.installed ? <span className="tag ok">{t('{name} installé', { name: tool.name })}</span> : <span className="tag">{tool.name}</span>}
      <button className="btn small ghost" onClick={() => void api.openExternal(tool.url)}>
        <Icon name="external" size={13} /> {tool.installed ? t('Site') : t('Télécharger')}
      </button>
    </span>
  );
}

let memo: HardwareInfo | null = null;

export function HardwareView({ state }: { state: AppState }) {
  const [hw, setHw] = useState<HardwareInfo | null>(memo);
  const [error, setError] = useState<string | null>(null);
  const load = (force = false) => {
    if (force) setHw(null);
    setError(null);
    api
      .hardware(force)
      .then((data) => {
        memo = data;
        setHw(data);
      })
      .catch((e: Error) => setError(e.message));
  };
  useEffect(() => {
    if (!memo) load();
  }, []);
  const sys = state.system;

  return (
    <div className="view">
      <header className="view-header">
        <div>
          <h1>{t('Matériel')}</h1>
          <p className="muted">{t('Composants, firmwares et outils constructeur.')}</p>
        </div>
        <div className="header-actions">
          {hw?.supportUrl && (
            <button className="btn" onClick={() => void api.openExternal(hw.supportUrl!)}>
              <Icon name="external" size={16} /> {t('Support {brand}', { brand: sys?.manufacturer ?? '' })}
            </button>
          )}
          <button className="btn" onClick={() => load(true)} disabled={!hw && !error}>
            <Icon name="refresh" /> {t('Actualiser')}
          </button>
        </div>
      </header>
      {error && <pre className="error-box">{error}</pre>}
      {!hw && !error && (
        <div className="empty">
          <Icon name="refresh" size={32} className="spin" />
          <p>{t('Lecture du matériel…')}</p>
        </div>
      )}
      {hw && sys && (
        <div className="hw-grid">
          <section className="card">
            <div className="card-title">
              <Icon name="monitor" size={16} /> {t('Système')}
            </div>
            <dl className="detail-list">
              <dt>{t('Modèle')}</dt>
              <dd>
                {sys.manufacturer} {sys.model}
              </dd>
              <dt>{t('Carte mère')}</dt>
              <dd>{hw.board}</dd>
              <dt>BIOS</dt>
              <dd>
                <code>{sys.biosVersion}</code> {sys.biosDate && <span className="muted">({sys.biosDate})</span>}
              </dd>
              <dt>{t('Processeur')}</dt>
              <dd>{hw.cpu}</dd>
              <dt>{t('Mémoire')}</dt>
              <dd>{hw.ramGB} Go</dd>
              <dt>{t('Système')}</dt>
              <dd>{sys.os}</dd>
            </dl>
          </section>
          <section className="card">
            <div className="card-title">
              <Icon name="chip" size={16} /> {t('Cartes graphiques')}
            </div>
            {hw.gpus.map((g) => (
              <dl key={g.name} className="detail-list">
                <dt>{g.name}</dt>
                <dd>
                  <code>{g.driverVersion}</code> <span className="muted">{g.driverDate}</span>
                </dd>
              </dl>
            ))}
          </section>
          {hw.battery && (
            <section className="card">
              <div className="card-title">
                <Icon name="bolt" size={16} /> {t('Batterie')}
              </div>
              <dl className="detail-list">
                <dt>{t('Charge')}</dt>
                <dd>
                  {hw.battery.charge} % · {hw.battery.onAc ? t('sur secteur') : t('sur batterie')}
                </dd>
                {hw.battery.health && (
                  <>
                    <dt>{t('Santé')}</dt>
                    <dd>{t('{n} % de la capacité d’origine', { n: hw.battery.health })}</dd>
                  </>
                )}
              </dl>
            </section>
          )}
          <section className="card wide">
            <div className="card-title">
              <Icon name="folder" size={16} /> {t('Disques et firmware')}
            </div>
            <table className="table compact">
              <thead>
                <tr>
                  <th>{t('Modèle')}</th>
                  <th>{t('Firmware')}</th>
                  <th>{t('Type')}</th>
                  <th>{t('Taille')}</th>
                  <th>{t('Outil de mise à jour')}</th>
                </tr>
              </thead>
              <tbody>
                {hw.disks.map((d) => (
                  <tr key={d.model}>
                    <td>{d.model}</td>
                    <td className="version">{d.firmware ?? '—'}</td>
                    <td className="muted small">
                      {d.mediaType} {d.bus}
                    </td>
                    <td className="muted small">{d.sizeGB} Go</td>
                    <td>
                      {d.tool ? (
                        <Tool tool={d.tool} />
                      ) : d.vendor === 'OEM' ? (
                        <span className="muted small">{t('SSD d’origine : firmware fourni par le constructeur du PC (voir Sources).')}</span>
                      ) : (
                        <span className="muted small">{t('Aucun outil connu')}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="card wide">
            <div className="card-title">
              <Icon name="cpu" size={16} /> {t('Périphériques avec firmware')}
            </div>
            {hw.peripherals.length === 0 ? (
              <p className="muted small">{t('Aucun périphérique Logitech, Razer, SteelSeries ou Corsair connecté.')}</p>
            ) : (
              <ul className="pick-list">
                {hw.peripherals.map((p) => (
                  <li key={p.vendor + p.tool?.name}>
                    <div>{p.name}</div>
                    <Tool tool={p.tool} />
                  </li>
                ))}
              </ul>
            )}
            <p className="muted small">{t('Le firmware de ces périphériques se met à jour depuis le logiciel du fabricant.')}</p>
          </section>
        </div>
      )}
    </div>
  );
}
