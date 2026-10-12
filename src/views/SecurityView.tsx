import { useEffect, useState } from 'react';
import type { AppState, BiosFeature, BiosGuide, CheckStatus, SecurityReport } from '../../shared/types';
import { t } from '../../shared/i18n';
import { api, copyText, formatDate } from '../api';
import { Icon, type IconName } from '../components/Icon';
import { Modal } from '../components/ui';

let memo: SecurityReport | null = null;

const STATUS_ICON: Record<CheckStatus, IconName> = { ok: 'check', warn: 'alert', bad: 'x', unknown: 'info' };
const STATUS_LABEL = (): Record<CheckStatus, string> => ({ ok: t('Correct'), warn: t('À surveiller'), bad: t('Problème'), unknown: t('Inconnu') });

export function SecurityView({ state, go }: { state: AppState; go: (page: string) => void }) {
  const [report, setReport] = useState<SecurityReport | null>(memo);
  const [error, setError] = useState<string | null>(null);
  const [bios, setBios] = useState<BiosFeature | null>(null);
  const load = (force = false) => {
    if (force) setReport(null);
    setError(null);
    api
      .security(force)
      .then((r) => {
        memo = r;
        setReport(r);
      })
      .catch((e: Error) => setError(e.message));
  };
  useEffect(() => {
    if (!memo) load();
  }, []);

  const sec = state.updates.filter((u) => u.security);
  const exploited = state.updates.filter((u) => u.exploited);
  const L = STATUS_LABEL();

  return (
    <div className="view">
      <header className="view-header">
        <div>
          <h1>{t('Sécurité')}</h1>
          <p className="muted">{report ? t('Analyse du {date}', { date: formatDate(report.generatedAt) }) : t('Analyse en cours…')}</p>
        </div>
        <div className="header-actions">
          <button className="btn" onClick={() => load(true)} disabled={!report && !error}>
            <Icon name="refresh" /> {t('Actualiser')}
          </button>
        </div>
      </header>
      {error && <pre className="error-box">{error}</pre>}

      <div className="tiles">
        <button className={`tile ${exploited.length ? 'bad' : ''}`} onClick={() => go('updates')}>
          <span className="tile-label">{t('Failles activement exploitées')}</span>
          <span className="tile-value">{exploited.length}</span>
        </button>
        <button className={`tile ${sec.length ? 'warn' : ''}`} onClick={() => go('updates')}>
          <span className="tile-label">{t('Mises à jour de sécurité')}</span>
          <span className="tile-value">{sec.length}</span>
        </button>
        <div className="tile">
          <span className="tile-label">{t('CVE corrigées en attente')}</span>
          <span className="tile-value">{new Set(state.updates.flatMap((u) => u.cves ?? [])).size}</span>
        </div>
      </div>

      <section>
        <h2 className="section-title">{t('État du poste')}</h2>
        {!report ? (
          <p className="muted">{t('Lecture de l’état de sécurité…')}</p>
        ) : (
          <table className="table compact" aria-label={t('État du poste')}>
            <thead>
              <tr>
                <th>{t('Contrôle')}</th>
                <th>{t('État')}</th>
                <th>{t('Détail')}</th>
              </tr>
            </thead>
            <tbody>
              {report.checks.map((c) => (
                <tr key={c.id}>
                  <td>{c.label}</td>
                  <td>
                    <span className={`status ${c.status === 'ok' ? 'ok' : c.status === 'unknown' ? 'off' : c.status === 'bad' ? 'err' : 'warn'}`}>
                      <Icon name={STATUS_ICON[c.status]} size={12} /> {L[c.status]}
                    </span>
                  </td>
                  <td className="col-name">
                    {c.value}
                    {c.advice && <div className="muted small">{c.advice}</div>}
                    {c.bios && c.status !== 'ok' && (
                      <button className="btn small ghost" onClick={() => setBios(c.bios!)}>
                        <Icon name="info" size={14} /> {t('Aide pour l’activer dans le BIOS')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="section-title">{t('Fins de support')}</h2>
        <p className="muted small">{t('Source : endoflife.date. Un logiciel en fin de support ne reçoit plus de correctifs de sécurité.')}</p>
        {report && !report.eol.length && <p className="muted">{t('Aucun produit suivi détecté.')}</p>}
        {report && report.eol.length > 0 && (
          <table className="table compact" aria-label={t('Fins de support')}>
            <thead>
              <tr>
                <th>{t('Produit')}</th>
                <th>{t('Installée')}</th>
                <th>{t('Fin de support')}</th>
                <th>{t('Dernière version du cycle')}</th>
              </tr>
            </thead>
            <tbody>
              {report.eol.map((e) => (
                <tr key={e.product + e.installed}>
                  <td>
                    <button className="link" onClick={() => void api.openExternal(e.link)}>
                      {e.product}
                    </button>
                  </td>
                  <td className="version">{e.installed}</td>
                  <td>
                    <span className={`status ${e.status === 'ok' ? 'ok' : e.status === 'soon' ? 'warn' : 'err'}`}>
                      {e.status === 'eol' ? t('terminé') : e.status === 'soon' ? t('bientôt') : t('maintenu')}
                    </span>{' '}
                    {e.eol || t('non annoncée')}
                  </td>
                  <td className="version">{e.latest ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {bios && <BiosHelp feature={bios} onClose={() => setBios(null)} />}

      {sec.length > 0 && (
        <section>
          <h2 className="section-title">{t('Mises à jour de sécurité en attente')}</h2>
          <ul className="pick-list">
            {sec.map((u) => (
              <li key={u.key}>
                <div>
                  <strong>{u.name}</strong> {u.exploited && <span className="tag danger">{t('exploitée')}</span>}
                  <div className="muted small cves">{(u.cves ?? []).slice(0, 8).join(', ')}</div>
                </div>
                <span className="version new">{u.availableVersion}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

const FEATURE_TITLE = (): Record<BiosFeature, string> => ({
  secureboot: t('Activer Secure Boot'),
  tpm: t('Activer le TPM'),
  virtualization: t('Activer la virtualisation matérielle'),
});

/** Procédure adaptée au BIOS détecté ; le redémarrage vers le BIOS n'est proposé qu'une fois la procédure lue. */
function BiosHelp({ feature, onClose }: { feature: BiosFeature; onClose: () => void }) {
  const [guide, setGuide] = useState<BiosGuide | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [read, setRead] = useState(false);
  const [suspend, setSuspend] = useState(true);
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState(false);
  useEffect(() => {
    api
      .biosGuide(feature)
      .then(setGuide)
      .catch((e: Error) => setError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')));
  }, [feature]);
  const title = FEATURE_TITLE()[feature];
  const text = guide
    ? [
        title,
        `${guide.machine} — BIOS ${guide.bios}`,
        `${t('Accès au BIOS')} : ${guide.entry}`,
        ...guide.steps.map((s, i) => `${i + 1}. ${s}`),
        ...guide.warnings.map((w) => `! ${w}`),
      ].join('\n')
    : '';
  const reboot = () => {
    if (!guide) return;
    setSent(true);
    const p = guide.canRebootToFirmware ? api.rebootToBios(guide.bitlockerOn && suspend) : api.scheduleReboot(60);
    p.catch((e: Error) => {
      setSent(false);
      setError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    });
  };
  return (
    <Modal title={title} wide cancelLabel={t('Fermer')} onCancel={onClose}>
      {error && <pre className="error-box">{error}</pre>}
      {!guide && !error && <p className="muted">{t('Lecture du BIOS…')}</p>}
      {guide && (
        <>
          <dl className="detail-list">
            <dt>{t('Ordinateur')}</dt>
            <dd>{guide.machine}</dd>
            <dt>BIOS</dt>
            <dd>
              <code>{guide.bios || '—'}</code> · {guide.firmwareType === 'UEFI' ? 'UEFI' : guide.firmwareType === 'Legacy' ? t('BIOS hérité (Legacy)') : t('mode inconnu')}
            </dd>
            <dt>{t('Accès au BIOS')}</dt>
            <dd>{guide.entry}</dd>
          </dl>
          <ol className="steps">
            {guide.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
          {guide.warnings.map((w, i) => (
            <p key={i} className="muted small">
              <Icon name="alert" size={14} /> {w}
            </p>
          ))}
          <div className="row wrap">
            <button
              className="btn small"
              onClick={() =>
                void copyText(text).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                })
              }
            >
              <Icon name="copy" size={14} /> {copied ? t('Copié') : t('Copier la procédure')}
            </button>
            <button className="btn small ghost" onClick={() => void api.openExternal(guide.docsUrl)}>
              <Icon name="external" size={14} /> {t('Documentation du constructeur')}
            </button>
          </div>
          <p className="muted small">{t('UpKeep sera fermé pendant le redémarrage : notez ou photographiez ces étapes avant de continuer.')}</p>
          <label className="row">
            <input type="checkbox" checked={read} onChange={(e) => setRead(e.target.checked)} />
            {t('J’ai lu la procédure et enregistré mon travail en cours')}
          </label>
          {guide.bitlockerOn && guide.canRebootToFirmware && (
            <label className="row">
              <input type="checkbox" checked={suspend} onChange={(e) => setSuspend(e.target.checked)} />
              {t('Suspendre BitLocker pour ce redémarrage (recommandé)')}
            </label>
          )}
          <div className="row end">
            <button className="btn primary" disabled={!read || sent} onClick={reboot}>
              <Icon name="power" size={14} />{' '}
              {sent ? t('Redémarrage demandé…') : guide.canRebootToFirmware ? t('Redémarrer vers le BIOS') : t('Redémarrer dans 1 minute')}
            </button>
          </div>
          {sent && guide.canRebootToFirmware && <p className="muted small">{t('Acceptez la demande d’autorisation administrateur : le PC redémarre 15 secondes plus tard.')}</p>}
        </>
      )}
    </Modal>
  );
}
