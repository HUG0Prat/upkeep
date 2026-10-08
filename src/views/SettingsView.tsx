import { useEffect, useState } from 'react';
import type { AppState, Profile, ProfileOverrides, Rule, RuleAction, RuleField, Settings } from '../../shared/types';
import { BUILTIN_PROFILES, DEFAULT_SETTINGS } from '../../shared/types';
import { t } from '../../shared/i18n';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Field, Modal, Switch } from '../components/ui';

const INTERVALS = [30, 60, 120, 240, 720, 1440, 10080];
const intervalLabel = (m: number) => (m < 60 ? t('{n} minutes', { n: m }) : m < 1440 ? t('{n} heure(s)', { n: m / 60 }) : m === 10080 ? t('1 semaine') : t('{n} jour(s)', { n: m / 1440 }));
const DAYS = () => [t('Dim'), t('Lun'), t('Mar'), t('Mer'), t('Jeu'), t('Ven'), t('Sam')];

type Tab = 'general' | 'auto' | 'rules' | 'profiles' | 'install' | 'appearance' | 'backup' | 'ignored';

export function SettingsView({ state, initialTab }: { state: AppState; initialTab?: string }) {
  const [tab, setTab] = useState<Tab>((initialTab as Tab) || 'general');
  useEffect(() => {
    if (initialTab) setTab(initialTab as Tab);
  }, [initialTab]);
  const tabs: { id: Tab; label: string }[] = [
    { id: 'general', label: t('Général') },
    { id: 'auto', label: t('Automatisation') },
    { id: 'rules', label: t('Règles') },
    { id: 'profiles', label: t('Profils') },
    { id: 'install', label: t('Installation') },
    { id: 'appearance', label: t('Apparence') },
    { id: 'backup', label: t('Sauvegarde') },
    { id: 'ignored', label: t('Ignorées & épinglées') },
  ];
  return (
    <div className="view">
      <header className="view-header">
        <div>
          <h1>{t('Paramètres')}</h1>
          <p className="muted">
            {state.isAdmin ? t('UpKeep tourne avec les droits administrateur.') : t('Les installations qui le nécessitent demanderont une élévation (UAC).')}
          </p>
        </div>
      </header>
      <div className="settings-layout">
        <nav className="subnav" role="tablist" aria-orientation="vertical">
          {tabs.map((x) => (
            <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'active' : ''} onClick={() => setTab(x.id)}>
              {x.label}
            </button>
          ))}
        </nav>
        <div className="settings-pane">
          {tab === 'general' && <General state={state} />}
          {tab === 'auto' && <Automation state={state} />}
          {tab === 'rules' && <Rules state={state} />}
          {tab === 'profiles' && <Profiles state={state} />}
          {tab === 'install' && <InstallSafety state={state} />}
          {tab === 'appearance' && <Appearance state={state} />}
          {tab === 'backup' && <Backup />}
          {tab === 'ignored' && <Ignored state={state} />}
        </div>
      </div>
    </div>
  );
}

const set = (patch: Partial<Settings>) => void api.setSettings(patch);

function Toggle({ s, k, label, hint }: { s: Settings; k: keyof Settings; label: string; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      <Switch checked={!!s[k]} onChange={(v) => set({ [k]: v } as Partial<Settings>)} label={label} />
    </Field>
  );
}

function General({ state }: { state: AppState }) {
  const s = state.settings;
  return (
    <section className="settings">
      <Field label={t('Fréquence de vérification')} hint={t('Toutes les sources activées, sauf réglage propre à une source.')}>
        <select value={s.intervalMinutes} onChange={(e) => set({ intervalMinutes: Number(e.target.value) })}>
          {INTERVALS.map((v) => (
            <option key={v} value={v}>
              {intervalLabel(v)}
            </option>
          ))}
        </select>
      </Field>
      <Toggle s={s} k="checkOnStartup" label={t('Vérifier au démarrage de l’application')} />
      <Field label={t('Cache des résultats')} hint={t('Au démarrage, une source vérifiée plus récemment que ce délai n’est pas réinterrogée.')}>
        <select value={s.cacheMinutes} onChange={(e) => set({ cacheMinutes: Number(e.target.value) })}>
          {[0, 15, 30, 60, 240].map((v) => (
            <option key={v} value={v}>
              {v === 0 ? t('Désactivé') : t('{n} minutes', { n: v })}
            </option>
          ))}
        </select>
      </Field>
      <Toggle s={s} k="retryOnFailure" label={t('Réessayer une fois une source en échec')} />
      <Field label={t('Vérifications simultanées')} hint={t('Nombre de sources interrogées en même temps (moins = moins de charge processeur).')}>
        <select value={s.maxParallelChecks} onChange={(e) => set({ maxParallelChecks: Number(e.target.value) })}>
          {[1, 2, 4, 6, 8].map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </Field>
      <Toggle
        s={s}
        k="respectPolicies"
        label={t('Respecter les stratégies de l’organisation')}
        hint={t('Si un administrateur exclut les pilotes de Windows Update ou impose un serveur WSUS, UpKeep suit ces règles.')}
      />
      <Toggle s={s} k="weeklySummary" label={t('Résumé hebdomadaire')} hint={t('Notification chaque lundi : installées, échecs, en attente.')} />
      <Toggle s={s} k="checkOnResume" label={t('Vérifier au réveil de veille et au retour du réseau')} />
      <Toggle s={s} k="notifications" label={t('Notifications Windows')} hint={t('Nouvelles mises à jour, fin des installations, rappels de redémarrage.')} />
      <Toggle s={s} k="minimizeToTray" label={t('Rester dans la zone de notification à la fermeture')} hint={t('Nécessaire pour la vérification périodique en arrière-plan.')} />
      <Toggle s={s} k="launchAtStartup" label={t('Lancer avec Windows')} hint={t('Démarre réduit dans la zone de notification (version installée uniquement).')} />
      <Toggle s={s} k="startHidden" label={t('Démarrer masqué')} />
      <Toggle
        s={s}
        k="selfUpdate"
        label={t('Mettre à jour UpKeep automatiquement')}
        hint={t('Recherche les nouvelles versions publiées sur GitHub. La version installée les télécharge et les installe à sa fermeture ; les versions portable, MSI et ZIP signalent seulement la nouvelle version.')}
      />
      <Field
        label={t('Vérifier même quand UpKeep est fermé')}
        hint={t('Crée une tâche planifiée Windows (sans droits administrateur) qui lance une vérification à la fréquence choisie.')}
      >
        <span className="row">
          {state.scheduledTaskInstalled && <span className="tag ok">{t('active')}</span>}
          <Switch checked={s.useScheduledTask} onChange={(v) => set({ useScheduledTask: v })} label={t('Tâche planifiée')} />
        </span>
      </Field>
      <Toggle s={s} k="hideAbsentDevices" label={t('Masquer les pilotes de périphériques absents')} hint={t('Windows mémorise tout périphérique déjà branché et continue de proposer ses pilotes.')} />
      <Toggle s={s} k="hidePreview" label={t('Masquer les préversions (bêta, RC…)')} />
      <Toggle s={s} k="hideOptionalDrivers" label={t('Masquer les pilotes facultatifs de Windows Update')} />
      <Field label={t('Sources d’alertes de sécurité')} hint={t('Fins de support (endoflife.date), failles exploitées (CISA KEV), vulnérabilités des logiciels de bureau (NVD).')}>
        <span className="row">
          {(
            [
              ['eol', 'EOL'],
              ['kev', 'KEV'],
              ['nvd', 'NVD'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="check-row">
              <input type="checkbox" checked={s.securityFeeds[k]} onChange={(e) => set({ securityFeeds: { ...s.securityFeeds, [k]: e.target.checked } })} /> {label}
            </label>
          ))}
        </span>
      </Field>
      <Toggle s={s} k="showWindowsHidden" label={t('Afficher les mises à jour masquées dans Windows Update')} />
      <Toggle s={s} k="includeUnknownVersions" label={t('WinGet : inclure les paquets à version inconnue')} />
      <Field label={t('Branche des pilotes NVIDIA')}>
        <select value={s.nvidiaBranch} onChange={(e) => set({ nvidiaBranch: e.target.value as Settings['nvidiaBranch'] })}>
          <option value="game">Game Ready</option>
          <option value="studio">Studio</option>
        </select>
      </Field>
      <Toggle s={s} k="wslPrerelease" label={t('WSL : proposer les préversions')} />
    </section>
  );
}

function Automation({ state }: { state: AppState }) {
  const s = state.settings;
  const w = s.autoWindow;
  const setW = (patch: Partial<Settings['autoWindow']>) => set({ autoWindow: { ...w, ...patch } });
  return (
    <>
      <section className="settings">
        <Field
          label={t('Mises à jour automatiques')}
          hint={t('Installe sans intervention les mises à jour des sources et paquets marqués « automatique » (Sources › Réglages, ou panneau de détail).')}
        >
          <Switch checked={s.autoUpdatesEnabled} onChange={(v) => set({ autoUpdatesEnabled: v })} label={t('Mises à jour automatiques')} />
        </Field>
        {state.autoBlockers.length > 0 && s.autoUpdatesEnabled && (
          <div className="setting muted small">{t('En pause actuellement : {why}', { why: state.autoBlockers.map((b) => t(b)).join(', ') })}</div>
        )}
        <Field label={t('Plage horaire')} hint={t('Les installations automatiques n’ont lieu que pendant cette plage.')}>
          <span className="row">
            <Switch checked={w.enabled} onChange={(v) => setW({ enabled: v })} label={t('Plage horaire')} />
            <input type="time" value={w.start} disabled={!w.enabled} aria-label={t('Début')} onChange={(e) => setW({ start: e.target.value })} />
            –
            <input type="time" value={w.end} disabled={!w.enabled} aria-label={t('Fin')} onChange={(e) => setW({ end: e.target.value })} />
          </span>
        </Field>
        <Field label={t('Jours')}>
          <span className="days">
            {DAYS().map((d, i) => (
              <label key={i} className={`day ${w.days.includes(i) ? 'on' : ''}`}>
                <input
                  type="checkbox"
                  disabled={!w.enabled}
                  checked={w.days.includes(i)}
                  onChange={(e) => setW({ days: e.target.checked ? [...w.days, i].sort() : w.days.filter((x) => x !== i) })}
                />
                {d}
              </label>
            ))}
          </span>
        </Field>
        <Toggle s={s} k="skipOnMetered" label={t('Pas d’installation automatique en connexion limitée')} hint={t('Forfait mobile, partage de connexion…')} />
        <Field label={t('Pas d’installation automatique sur batterie sous')}>
          <select value={s.skipOnBatteryBelow} onChange={(e) => set({ skipOnBatteryBelow: Number(e.target.value) })}>
            {[0, 20, 30, 50, 80, 101].map((v) => (
              <option key={v} value={v}>
                {v === 0 ? t('Jamais bloquer') : v === 101 ? t('Toujours bloquer sur batterie') : `${v} %`}
              </option>
            ))}
          </select>
        </Field>
        <Toggle s={s} k="respectFocus" label={t('Ne pas déranger en plein écran, en jeu ou en mode Focus')} hint={t('Reporte notifications et installations automatiques.')} />
        <Field
          label={t('Quarantaine des nouvelles versions')}
          hint={t('Une version n’est proposée qu’après ce délai depuis sa publication (ou sa première détection). Les mises à jour de sécurité ne sont jamais retenues.')}
        >
          <span className="row">
            <input type="number" min={0} max={60} value={s.quarantineDays} aria-label={t('Jours')} onChange={(e) => set({ quarantineDays: Math.max(0, Number(e.target.value)) })} />
            {t('jours')}
            {s.quarantineDays !== DEFAULT_SETTINGS.quarantineDays && (
              <button className="link" onClick={() => set({ quarantineDays: DEFAULT_SETTINGS.quarantineDays })}>
                {t('par défaut ({n})', { n: DEFAULT_SETTINGS.quarantineDays })}
              </button>
            )}
          </span>
        </Field>
        <Toggle s={s} k="showQuarantined" label={t('Afficher quand même les versions en quarantaine')} />
      </section>
      <h2 className="section-title">{t('Redémarrage')}</h2>
      <section className="settings">
        <Toggle s={s} k="autoReboot" label={t('Redémarrer automatiquement après mes heures d’activité')} hint={t('Utilise les heures d’activité définies dans Windows Update.')} />
        <Field label={t('Rappel de redémarrage')}>
          <select value={s.rebootReminderHours} onChange={(e) => set({ rebootReminderHours: Number(e.target.value) })}>
            {[0, 1, 2, 4, 8, 24].map((h) => (
              <option key={h} value={h}>
                {h === 0 ? t('Jamais') : t('Toutes les {n} h', { n: h })}
              </option>
            ))}
          </select>
        </Field>
      </section>
    </>
  );
}

const ACTIONS = (): Record<RuleAction, string> => ({
  ignore: t('Toujours ignorer'),
  auto: t('Mettre à jour automatiquement'),
  'never-auto': t('Jamais automatiquement'),
  silent: t('Ne pas notifier'),
});
const FIELDS = (): Record<RuleField, string> => ({ any: t('Tout'), name: t('Nom'), id: t('Identifiant'), source: t('Source'), publisher: t('Éditeur') });

function Rules({ state }: { state: AppState }) {
  const rules = state.settings.rules;
  const save = (r: Rule[]) => set({ rules: r });
  const update = (id: string, patch: Partial<Rule>) => save(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  return (
    <>
      <p className="muted small">{t('Jokers : * = n’importe quelle suite, ? = un caractère. Exemples : *.Preview, Microsoft.*, *chrome*.')}</p>
      <section className="settings">
        {rules.length === 0 && <div className="setting muted">{t('Aucune règle.')}</div>}
        {rules.map((r) => (
          <div key={r.id} className="setting rule">
            <Switch checked={r.enabled} onChange={(v) => update(r.id, { enabled: v })} label={t('Activer')} />
            <select value={r.field} aria-label={t('Champ')} onChange={(e) => update(r.id, { field: e.target.value as RuleField })}>
              {Object.entries(FIELDS()).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <input type="text" value={r.pattern} placeholder="*.Preview" aria-label={t('Motif')} onChange={(e) => update(r.id, { pattern: e.target.value })} />
            <select value={r.action} aria-label={t('Action')} onChange={(e) => update(r.id, { action: e.target.value as RuleAction })}>
              {Object.entries(ACTIONS()).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <button className="btn small ghost icon" aria-label={t('Supprimer')} onClick={() => save(rules.filter((x) => x.id !== r.id))}>
              <Icon name="trash" size={15} />
            </button>
          </div>
        ))}
      </section>
      <button className="btn" onClick={() => save([...rules, { id: crypto.randomUUID(), pattern: '', field: 'any', action: 'ignore', enabled: true }])}>
        <Icon name="plus" size={16} /> {t('Ajouter une règle')}
      </button>
    </>
  );
}

type TriState = 'inherit' | 'on' | 'off';
const tri = (v: boolean | undefined): TriState => (v === undefined ? 'inherit' : v ? 'on' : 'off');
const fromTri = (v: TriState): boolean | undefined => (v === 'inherit' ? undefined : v === 'on');

function TriSelect({ value, onChange, label }: { value: boolean | undefined; onChange: (v: boolean | undefined) => void; label: string }) {
  return (
    <select value={tri(value)} aria-label={label} onChange={(e) => onChange(fromTri(e.target.value as TriState))}>
      <option value="inherit">{t('Comme les paramètres')}</option>
      <option value="on">{t('Activé')}</option>
      <option value="off">{t('Désactivé')}</option>
    </select>
  );
}

function Profiles({ state }: { state: AppState }) {
  const s = state.settings;
  const [editing, setEditing] = useState<string>(s.activeProfile);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const found = s.profiles.find((p) => p.id === editing);
  useEffect(() => {
    if (found && pendingId === editing) setPendingId(null);
    if (!found && pendingId !== editing) setEditing(s.profiles[0].id);
  }, [found, pendingId, editing, s.profiles]);
  const profile = found ?? s.profiles[0];
  const saveProfiles = (profiles: Profile[]) => set({ profiles });
  const update = (patch: Partial<Profile>) => saveProfiles(s.profiles.map((p) => (p.id === profile.id ? { ...p, ...patch } : p)));
  const setO = (patch: Partial<ProfileOverrides>) => {
    const o = { ...profile.overrides, ...patch };
    for (const k of Object.keys(o) as (keyof ProfileOverrides)[]) if (o[k] === undefined) delete o[k];
    update({ overrides: o });
  };
  const add = (from?: Profile) => {
    const p: Profile = { id: crypto.randomUUID(), name: from ? `${from.name} (${t('copie')})` : t('Nouveau profil'), overrides: from ? structuredClone(from.overrides) : {} };
    saveProfiles([...s.profiles, p]);
    setPendingId(p.id);
    setEditing(p.id);
  };
  const remove = () => {
    const rest = s.profiles.filter((p) => p.id !== profile.id);
    set({
      profiles: rest,
      activeProfile: s.activeProfile === profile.id ? rest[0].id : s.activeProfile,
      defaultProfile: s.defaultProfile === profile.id ? rest[0].id : s.defaultProfile,
    });
    setEditing(rest[0].id);
    setConfirmDelete(false);
  };
  const providerOverrides = profile.overrides.providers ?? {};
  const setProviderO = (id: string, v: boolean | undefined) => {
    const p = { ...providerOverrides };
    if (v === undefined) delete p[id];
    else p[id] = v;
    setO({ providers: Object.keys(p).length ? p : undefined });
  };

  return (
    <>
      <section className="settings">
        <Field label={t('Profil actif')} hint={t('Applique ses réglages par-dessus les paramètres. Aussi accessible depuis la zone de notification.')}>
          <select value={s.activeProfile} onChange={(e) => void api.setProfile(e.target.value)}>
            {s.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('Profil au lancement')} hint={t('Profil activé à chaque démarrage d’UpKeep (ou via l’argument --profile=<id>).')}>
          <select value={s.defaultProfile} onChange={(e) => set({ defaultProfile: e.target.value })}>
            {s.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      </section>

      <h2 className="section-title">{t('Modifier un profil')}</h2>
      <div className="row wrap">
        {s.profiles.map((p) => (
          <button key={p.id} className={`chip ${editing === p.id ? 'active' : ''}`} onClick={() => setEditing(p.id)}>
            {p.name}
            {s.activeProfile === p.id && <span className="chip-count">{t('actif')}</span>}
          </button>
        ))}
        <button className="btn small" onClick={() => add()}>
          <Icon name="plus" size={14} /> {t('Nouveau')}
        </button>
      </div>
      {!found ? (
        <p className="muted">{t('Chargement…')}</p>
      ) : (
      <section className="settings">
        <Field label={t('Nom')}>
          <input type="text" value={profile.name} onChange={(e) => update({ name: e.target.value })} />
        </Field>
        <Field label={t('Notifications')}>
          <TriSelect value={profile.overrides.notifications} onChange={(v) => setO({ notifications: v })} label={t('Notifications')} />
        </Field>
        <Field label={t('Mises à jour automatiques')}>
          <TriSelect value={profile.overrides.autoUpdatesEnabled} onChange={(v) => setO({ autoUpdatesEnabled: v })} label={t('Mises à jour automatiques')} />
        </Field>
        <Field label={t('Ne pas déranger en plein écran')}>
          <TriSelect value={profile.overrides.respectFocus} onChange={(v) => setO({ respectFocus: v })} label={t('Ne pas déranger')} />
        </Field>
        <Field label={t('Bloquer en connexion limitée')}>
          <TriSelect value={profile.overrides.skipOnMetered} onChange={(v) => setO({ skipOnMetered: v })} label={t('Connexion limitée')} />
        </Field>
        <Field label={t('Redémarrage automatique')}>
          <TriSelect value={profile.overrides.autoReboot} onChange={(v) => setO({ autoReboot: v })} label={t('Redémarrage automatique')} />
        </Field>
        <Field label={t('Fréquence de vérification')}>
          <select value={profile.overrides.intervalMinutes ?? 0} onChange={(e) => setO({ intervalMinutes: Number(e.target.value) || undefined })}>
            <option value={0}>{t('Comme les paramètres')}</option>
            {INTERVALS.map((v) => (
              <option key={v} value={v}>
                {intervalLabel(v)}
              </option>
            ))}
          </select>
        </Field>
      </section>
      )}
      <details className="settings-details">
        <summary>{t('Sources activées dans ce profil')}</summary>
        <section className="settings">
          {state.providers
            .filter((p) => p.available || p.applicable)
            .map((p) => (
              <Field key={p.id} label={p.name}>
                <TriSelect value={providerOverrides[p.id]} onChange={(v) => setProviderO(p.id, v)} label={p.name} />
              </Field>
            ))}
        </section>
      </details>
      <div className="row">
        <button className="btn small" onClick={() => add(profile)}>
          <Icon name="copy" size={14} /> {t('Dupliquer')}
        </button>
        {BUILTIN_PROFILES.some((b) => b.id === profile.id) && (
          <button className="btn small ghost" onClick={() => update({ overrides: BUILTIN_PROFILES.find((b) => b.id === profile.id)!.overrides })}>
            <Icon name="undo" size={14} /> {t('Réglages d’origine')}
          </button>
        )}
        <button className="btn small ghost" disabled={s.profiles.length <= 1} onClick={() => setConfirmDelete(true)}>
          <Icon name="trash" size={14} /> {t('Supprimer')}
        </button>
      </div>
      {confirmDelete && (
        <Modal title={t('Supprimer le profil « {name} » ?', { name: profile.name })} confirmLabel={t('Supprimer')} danger onConfirm={remove} onCancel={() => setConfirmDelete(false)}>
          <p>{t('Les paramètres de base ne sont pas modifiés.')}</p>
        </Modal>
      )}
    </>
  );
}

function InstallSafety({ state }: { state: AppState }) {
  const s = state.settings;
  const [helperInfo, setHelperInfo] = useState(false);
  return (
    <>
      <section className="settings">
        <Toggle
          s={s}
          k="simulateInstalls"
          label={t('Mode simulation')}
          hint={t('Déroule tout le processus (file, élévation, journal) sans rien installer : idéal pour vérifier ce qui se passerait.')}
        />
        <Toggle s={s} k="restorePoint" label={t('Point de restauration avant pilotes, firmware et mises à jour Windows')} />
        <Toggle s={s} k="requireAcForFirmware" label={t('Exiger le secteur pour un firmware/BIOS')} />
        <Field label={t('Batterie minimale pour un firmware/BIOS')}>
          <select value={s.minBatteryForFirmware} onChange={(e) => set({ minBatteryForFirmware: Number(e.target.value) })}>
            {[0, 30, 50, 70, 90].map((v) => (
              <option key={v} value={v}>
                {v} %
              </option>
            ))}
          </select>
        </Field>
        <Toggle s={s} k="suspendBitLocker" label={t('Suspendre BitLocker pour un redémarrage avant un BIOS')} hint={t('Évite de devoir saisir la clé de récupération après la mise à jour du firmware.')} />
        <Field label={t('Installations en parallèle')} hint={t('Sources différentes uniquement ; les installations administrateur sont regroupées.')}>
          <select value={s.maxParallelJobs} onChange={(e) => set({ maxParallelJobs: Number(e.target.value) })}>
            {[1, 2, 3, 4].map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Toggle s={s} k="retryNetworkErrors" label={t('Réessayer automatiquement après une erreur réseau')} />
      </section>
      <h2 className="section-title">{t('Assistant administrateur')}</h2>
      <section className="settings">
        <Field
          label={t('Installer sans fenêtre UAC')}
          hint={t('Une tâche planifiée système exécute les installations administrateur d’UpKeep. Nécessaire pour les mises à jour automatiques qui demandent l’administrateur.')}
        >
          <span className="row">
            {state.helperInstalled && <span className="tag ok">{t('installé')}</span>}
            <Switch checked={s.useElevatedHelper && state.helperInstalled} onChange={(v) => (v ? setHelperInfo(true) : void api.setHelper(false))} label={t('Assistant administrateur')} />
          </span>
        </Field>
      </section>
      {helperInfo && (
        <Modal
          title={t('Activer l’assistant administrateur ?')}
          confirmLabel={t('Installer (une fenêtre UAC)')}
          danger
          onCancel={() => setHelperInfo(false)}
          onConfirm={() => {
            setHelperInfo(false);
            void api.setHelper(true);
          }}
        >
          <p>{t('Une tâche planifiée « UpKeep\\ElevatedHelper » sera créée. Elle tourne avec les droits SYSTÈME et exécute les scripts déposés par UpKeep dans C:\\ProgramData\\UpKeep\\queue.')}</p>
          <p className="warn-text">
            <Icon name="alert" size={16} />
            {t('Seul votre compte (et les administrateurs) peut y déposer des scripts. Cela revient à approuver d’avance les élévations de votre compte : un programme malveillant lancé sous votre session pourrait aussi s’en servir. Désactivez l’option pour supprimer la tâche.')}
          </p>
        </Modal>
      )}
    </>
  );
}

function Appearance({ state }: { state: AppState }) {
  const s = state.settings;
  return (
    <section className="settings">
      <Field label={t('Thème')}>
        <select value={s.theme} onChange={(e) => set({ theme: e.target.value as Settings['theme'] })}>
          <option value="system">{t('Système')}</option>
          <option value="light">{t('Clair')}</option>
          <option value="dark">{t('Sombre')}</option>
        </select>
      </Field>
      <Toggle s={s} k="useSystemAccent" label={t('Utiliser la couleur d’accent de Windows')} />
      <Field label={t('Langue')}>
        <select value={s.language} onChange={(e) => set({ language: e.target.value as Settings['language'] })}>
          <option value="auto">{t('Langue de Windows')}</option>
          <option value="fr">Français</option>
          <option value="en">English</option>
          <option value="de">Deutsch</option>
          <option value="es">Español</option>
        </select>
      </Field>
      <Toggle s={s} k="compact" label={t('Vue compacte des listes')} />
      <Toggle s={s} k="taskbarBadge" label={t('Pastille du nombre de mises à jour sur l’icône de la barre des tâches')} />
      <Field label={t('Revoir l’accueil')}>
        <button className="btn small" onClick={() => set({ onboarded: false })}>
          {t('Relancer')}
        </button>
      </Field>
    </section>
  );
}

function Backup() {
  const [msg, setMsg] = useState<string | null>(null);
  const wrap = (p: Promise<unknown>, ok: string) =>
    p.then((r) => r && setMsg(ok)).catch((err: Error) => setMsg(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')));
  return (
    <>
      <section className="settings">
        <Field label={t('Paramètres d’UpKeep')} hint={t('Profils, règles, éléments ignorés, options par paquet…')}>
          <span className="row">
            <button className="btn small" onClick={() => void wrap(api.exportSettings(), t('Paramètres exportés.'))}>
              {t('Exporter')}
            </button>
            <button className="btn small" onClick={() => void wrap(api.importSettings(), t('Paramètres importés.'))}>
              {t('Importer')}
            </button>
          </span>
        </Field>
        <Field
          label={t('Liste des logiciels et paquets')}
          hint={t('winget, Scoop, npm, pip, pipx, cargo, outils .NET et extensions VS Code. L’import réinstalle ce qui manque (suivi dans « Activité »).')}
        >
          <span className="row">
            <button className="btn small" onClick={() => void wrap(api.exportPackages().then(() => true), t('Export lancé (voir Activité).'))}>
              {t('Exporter')}
            </button>
            <button className="btn small" onClick={() => void wrap(api.importPackages(), t('Import lancé (voir Activité).'))}>
              {t('Importer')}
            </button>
          </span>
        </Field>
      </section>
      <h2 className="section-title">{t('Diagnostic')}</h2>
      <section className="settings">
        <Field label={t('Journaux d’UpKeep')} hint={t('Fichiers texte mis à jour en continu (1 Mo maximum, 3 fichiers conservés).')}>
          <button className="btn small" onClick={() => void api.openLogs()}>
            {t('Ouvrir le dossier')}
          </button>
        </Field>
        <Field label={t('Rapport de diagnostic')} hint={t('Zip local (journaux, rapports de plantage, paramètres) à joindre à un signalement. Rien n’est envoyé automatiquement.')}>
          <button className="btn small" onClick={() => void wrap(api.createDiagnostics(), t('Rapport créé.'))}>
            {t('Créer…')}
          </button>
        </Field>
      </section>
      {msg && <p className="muted">{msg}</p>}
    </>
  );
}

function Ignored({ state }: { state: AppState }) {
  const s = state.settings;
  const ignored = Object.entries(s.ignored);
  const pins = Object.entries(s.pins);
  const label = (key: string) => key.split(':').slice(1).join(':');
  return (
    <>
      <h2 className="section-title">{t('Mises à jour ignorées')}</h2>
      {ignored.length === 0 ? (
        <p className="muted">{t('Aucune.')}</p>
      ) : (
        <section className="settings">
          {ignored.map(([key, version]) => (
            <Field key={key} label={label(key)} hint={`${key.split(':')[0]} · ${version === '*' ? t('toujours ignorée') : t('version {v} ignorée', { v: version })}`}>
              <button className="btn small" onClick={() => void api.unignore(key)}>
                {t('Ne plus ignorer')}
              </button>
            </Field>
          ))}
        </section>
      )}
      <h2 className="section-title">{t('Versions épinglées')}</h2>
      {pins.length === 0 ? (
        <p className="muted">{t('Aucune.')}</p>
      ) : (
        <section className="settings">
          {pins.map(([key, major]) => (
            <Field key={key} label={label(key)} hint={t('reste sur la version {v}.x', { v: major })}>
              <button
                className="btn small"
                onClick={() => {
                  const p = { ...s.pins };
                  delete p[key];
                  set({ pins: p });
                }}
              >
                {t('Désépingler')}
              </button>
            </Field>
          ))}
        </section>
      )}
    </>
  );
}
