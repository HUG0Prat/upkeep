import { useEffect, useRef, useState } from 'react';
import type { AppState, CheckStatus, HardwareInfo, PortsReport, PortState, VendorTool } from '../../shared/types';
import { t } from '../../shared/i18n';
import { api } from '../api';
import { Icon, type IconName } from '../components/Icon';
import { Modal } from '../components/ui';

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
  const [actionError, setActionError] = useState<string | null>(null);
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
      {actionError && <pre className="error-box">{actionError}</pre>}
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
                {hw.battery.cycles && (
                  <>
                    <dt>{t('Cycles')}</dt>
                    <dd>{hw.battery.cycles}</dd>
                  </>
                )}
              </dl>
            </section>
          )}
          <HealthCard hw={hw} state={state} onError={setActionError} />
          <PortsCard />
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

const STATUS_CLASS: Record<CheckStatus, string> = { ok: 'ok', warn: 'warn', bad: 'err', unknown: 'off' };
const STATUS_ICON: Record<CheckStatus, IconName> = { ok: 'check', warn: 'alert', bad: 'x', unknown: 'info' };
const DEVICE_ERRORS: Record<number, string> = {
  1: 'mal configuré',
  3: 'pilote endommagé ou mémoire insuffisante',
  10: 'ne peut pas démarrer',
  12: 'ressources insuffisantes',
  14: 'redémarrage nécessaire',
  18: 'pilotes à réinstaller',
  24: 'absent ou mal installé',
  28: 'pilote non installé',
  31: 'ne fonctionne pas correctement',
  37: 'échec d’initialisation du pilote',
  39: 'pilote endommagé ou manquant',
  43: 'arrêté : le périphérique a signalé un problème',
  48: 'pilote bloqué (incompatibilité connue)',
  52: 'signature du pilote invalide',
};

function HealthCard({ hw, state, onError }: { hw: HardwareInfo; state: AppState; onError: (m: string) => void }) {
  const [confirmScan, setConfirmScan] = useState(false);
  const checks = hw.health ?? [];
  const worst = checks.some((c) => c.status === 'bad') ? 'bad' : checks.some((c) => c.status === 'warn') ? 'warn' : 'ok';
  const err = (e: Error) => onError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  return (
    <section className="card wide">
      <div className="card-title">
        <Icon name="heart" size={16} /> {t('Santé des composants')}{' '}
        {hw.health && (
          <span className={`status ${STATUS_CLASS[worst]}`}>
            <Icon name={STATUS_ICON[worst]} size={12} /> {worst === 'ok' ? t('Correct') : worst === 'warn' ? t('À surveiller') : t('Problème')}
          </span>
        )}
      </div>
      {!hw.health ? (
        <p className="muted small">{t('État de santé indisponible sur ce PC.')}</p>
      ) : (
        <table className="table compact" aria-label={t('Santé des composants')}>
          <tbody>
            {checks.map((c) => (
              <tr key={c.id}>
                <td>{c.label}</td>
                <td className="nowrap">
                  <span className={`status ${STATUS_CLASS[c.status]}`}>
                    <Icon name={STATUS_ICON[c.status]} size={12} />
                  </span>
                </td>
                <td className="col-name">
                  {c.value}
                  {c.advice && <div className="muted small">{c.advice}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!!hw.problemDevices?.length && (
        <>
          <div className="muted small">{t('Périphériques en erreur')}</div>
          <ul className="pick-list">
            {hw.problemDevices.map((d, i) => (
              <li key={i}>
                <div>
                  {d.name} {d.className && <span className="muted small">({d.className})</span>}
                </div>
                <span className="tag danger">{DEVICE_ERRORS[d.code] ? t(DEVICE_ERRORS[d.code]) : t('erreur (code {n})', { n: d.code })}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="row wrap">
        <button className="btn small" onClick={() => setConfirmScan(true)}>
          <Icon name="folder" size={14} /> {t('Vérifier le disque système')}
        </button>
        <button className="btn small" onClick={() => void api.memoryTest().catch(err)}>
          <Icon name="chip" size={14} /> {t('Tester la mémoire')}
        </button>
        {hw.battery && (
          <button className="btn small" onClick={() => void api.batteryReport().catch(err)}>
            <Icon name="bolt" size={14} /> {t('Rapport de batterie')}
          </button>
        )}
      </div>
      <p className="muted small">
        {t('Les compteurs SMART (usure, température) et la sonde thermique ne sont lisibles que si Windows les expose ; certains exigent les droits administrateur.')}
        {!state.isAdmin && ` ${t('UpKeep fonctionne sans droits administrateur : certaines valeurs peuvent manquer.')}`}
      </p>
      {confirmScan && (
        <Modal
          title={t('Vérifier le disque système ?')}
          confirmLabel={t('Lancer l’analyse')}
          onCancel={() => setConfirmScan(false)}
          onConfirm={() => {
            setConfirmScan(false);
            void api.diskScan().catch(err);
          }}
        >
          <p>{t('Analyse en ligne du système de fichiers (chkdsk /scan) : le PC reste utilisable et ne redémarre pas. Le résultat s’affiche dans Activité.')}</p>
          <p className="muted">
            <Icon name="shield" size={16} /> {t('Nécessite les droits administrateur.')}
          </p>
        </Modal>
      )}
    </section>
  );
}

const PORT_STATE = (): Record<PortState, { label: string; cls: string }> => ({
  free: { label: t('Libre'), cls: 'off' },
  used: { label: t('Occupé'), cls: 'ok' },
  fault: { label: t('Défaillant'), cls: 'err' },
});

let portsMemo: PortsReport | null = null;

function PortsCard() {
  const [report, setReport] = useState<PortsReport | null>(portsMemo);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const load = () => {
    setError(null);
    api
      .ports()
      .then((r) => {
        portsMemo = r;
        setReport(r);
      })
      .catch((e: Error) => setError(e.message));
  };
  useEffect(() => {
    if (!portsMemo) load();
  }, []);
  const S = PORT_STATE();
  const ports = report?.ports ?? [];
  const usb = ports.filter((p) => p.kind === 'usb');
  const others = ports.filter((p) => p.kind !== 'usb');
  const counts = { free: usb.filter((p) => p.state === 'free').length, used: usb.filter((p) => p.state === 'used').length, fault: usb.filter((p) => p.state === 'fault').length };

  return (
    <section className="card wide">
      <div className="card-title">
        <Icon name="usb" size={16} /> {t('Ports')}
        {report && (
          <span className="muted small">
            {t('USB : {used} occupé(s), {free} libre(s)', { used: counts.used, free: counts.free })}
            {counts.fault > 0 && ` · ${t('{n} défaillant(s)', { n: counts.fault })}`}
          </span>
        )}
      </div>
      {error && <pre className="error-box">{error}</pre>}
      {!report && !error && <p className="muted small">{t('Lecture des ports…')}</p>}
      {report && (
        <table className="table compact" aria-label={t('Ports de l’ordinateur')}>
          <thead>
            <tr>
              <th>{t('Port')}</th>
              <th>{t('État')}</th>
              <th>{t('Périphérique')}</th>
              <th>{t('Détail')}</th>
            </tr>
          </thead>
          <tbody>
            {[...usb, ...others].map((p) => (
              <tr key={p.id}>
                <td className="nowrap">
                  {p.label}
                  {p.location && <div className="muted small">{p.location}</div>}
                </td>
                <td>
                  <span className={`status ${S[p.state].cls}`}>{S[p.state].label}</span>
                </td>
                <td>{p.device ?? '—'}</td>
                <td className="col-name muted small">{p.detail ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="row wrap">
        <button className="btn small" onClick={load} disabled={!report && !error}>
          <Icon name="refresh" size={14} /> {t('Actualiser')}
        </button>
        <button className="btn small" onClick={() => setTesting(true)} disabled={!report}>
          <Icon name="usb" size={14} /> {t('Tester les ports USB')}
        </button>
      </div>
      <p className="muted small">
        {report && report.internal > 0 && `${t('{n} port(s) USB internes (webcam, Bluetooth, lecteur d’empreintes…) non affichés.', { n: report.internal })} `}
        {t('Les sorties vidéo ne sont listées que lorsqu’un écran y est branché ; les prises audio ne sont pas détectables.')}
      </p>
      {testing && report && (
        <PortTest
          initial={report}
          onClose={(r) => {
            setTesting(false);
            if (r) {
              portsMemo = r;
              setReport(r);
            }
          }}
        />
      )}
    </section>
  );
}

type TestResult = 'untested' | 'ok' | 'fault';

/** Test guidé : l'utilisateur branche un périphérique qui fonctionne dans chaque port ; l'état des ports est relu toutes les 2 s. */
function PortTest({ initial, onClose }: { initial: PortsReport; onClose: (r: PortsReport | null) => void }) {
  const [report, setReport] = useState(initial);
  const [results, setResults] = useState<Record<string, { result: TestResult; detail?: string }>>(() =>
    Object.fromEntries(initial.ports.filter((p) => p.kind === 'usb').map((p) => [p.id, p.state === 'fault' ? { result: 'fault', detail: p.detail } : { result: p.state === 'used' ? 'ok' : 'untested' }])),
  );
  const prev = useRef(initial);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      api
        .ports()
        .then((r) => {
          if (!alive) return;
          const before = new Map(prev.current.ports.map((p) => [p.id, p.state]));
          setResults((res) => {
            const next = { ...res };
            for (const p of r.ports.filter((x) => x.kind === 'usb')) {
              if (p.state === 'fault') next[p.id] = { result: 'fault', detail: p.detail };
              else if (p.state === 'used' && (before.get(p.id) !== 'used' || next[p.id]?.result !== 'fault')) next[p.id] = { result: 'ok' };
              else next[p.id] ??= { result: 'untested' };
            }
            return next;
          });
          prev.current = r;
          setReport(r);
        })
        .catch(() => undefined)
        .finally(() => {
          if (alive) timer = setTimeout(tick, 2000);
        });
    };
    timer = setTimeout(tick, 2000);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);
  const usb = report.ports.filter((p) => p.kind === 'usb');
  const done = usb.filter((p) => results[p.id]?.result !== 'untested').length;
  const RES: Record<TestResult, { label: string; cls: string }> = {
    untested: { label: t('Non testé'), cls: 'off' },
    ok: { label: t('Fonctionne'), cls: 'ok' },
    fault: { label: t('Défaillant'), cls: 'err' },
  };
  return (
    <Modal title={t('Test des ports USB')} wide confirmLabel={t('Terminer')} onConfirm={() => onClose(report)} onCancel={() => onClose(report)}>
      <p>{t('Branchez successivement une clé USB ou une souris que vous savez fonctionnelle dans chaque port, en attendant quelques secondes. Un port qui reconnaît le périphérique fonctionne ; un port qui le refuse, coupe l’alimentation ou ne réagit jamais est probablement défaillant.')}</p>
      <p className="muted small">{t('{done} port(s) vérifié(s) sur {total} · actualisation toutes les 2 secondes', { done, total: usb.length })}</p>
      <table className="table compact" aria-label={t('Test des ports USB')}>
        <tbody>
          {usb.map((p) => {
            const r = results[p.id] ?? { result: 'untested' };
            return (
              <tr key={p.id}>
                <td className="nowrap">
                  {p.label}
                  {p.location && <div className="muted small">{p.location}</div>}
                </td>
                <td>
                  <span className={`status ${RES[r.result].cls}`}>{RES[r.result].label}</span>
                </td>
                <td>{p.state === 'used' ? p.device : <span className="muted">{t('rien de branché')}</span>}</td>
                <td className="col-name muted small">{r.detail ?? ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">{t('Un port qui ne réagit à aucun périphérique peut aussi être désactivé dans le BIOS, ou être un port de charge seule.')}</p>
    </Modal>
  );
}
