import { useEffect, useState } from 'react';
import type { AppState } from '../shared/types';
import { setLang, t } from '../shared/i18n';
import { api, onLocalSettings, withPendingSettings } from './api';
import { UpdatesView } from './views/UpdatesView';
import { DashboardView } from './views/DashboardView';
import { SecurityView } from './views/SecurityView';
import { MaintenanceView } from './views/MaintenanceView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CommandPalette } from './components/CommandPalette';
import { InventoryView } from './views/InventoryView';
import { PackageSearchView } from './views/PackageSearchView';
import { HardwareView } from './views/HardwareView';
import { SourcesView } from './views/SourcesView';
import { HistoryView } from './views/HistoryView';
import { SettingsView } from './views/SettingsView';
import { AboutView } from './views/AboutView';
import { Onboarding } from './views/Onboarding';
import { MiniView } from './views/MiniView';
import { Icon, type IconName } from './components/Icon';
import { RebootBanner } from './components/Reboot';
import logo from '../resources/icon.png';

type Page = 'dashboard' | 'updates' | 'search' | 'security' | 'inventory' | 'hardware' | 'maintenance' | 'history' | 'sources' | 'settings' | 'about';
const PAGES: Page[] = ['dashboard', 'updates', 'search', 'security', 'inventory', 'hardware', 'maintenance', 'history', 'sources', 'settings', 'about'];

function badgeDataUrl(n: number): string {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ef4444';
  g.beginPath();
  g.arc(16, 16, 15, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#fff';
  g.font = `bold ${n > 99 ? 13 : n > 9 ? 17 : 20}px Segoe UI, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(n > 99 ? '99+' : String(n), 16, 17);
  return c.toDataURL('image/png');
}

function useAccent(enabled: boolean): void {
  useEffect(() => {
    const apply = () =>
      void api.accentColor().then((c) => {
        if (enabled && c) document.documentElement.style.setProperty('--accent', c);
        else document.documentElement.style.removeProperty('--accent');
      });
    apply();
    return api.onAccentChanged(apply);
  }, [enabled]);
}

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [page, setPage] = useState<Page>('dashboard');
  const [focus, setFocus] = useState<string | undefined>();
  const [palette, setPalette] = useState(false);
  const go = (p: string, f?: string) => {
    if (!PAGES.includes(p as Page)) return;
    setPage(p as Page);
    setFocus(f);
  };
  const isMini = window.location.hash === '#mini';

  useEffect(() => {
    void api.getState().then((st) => setState(withPendingSettings(st)));
    const offState = api.onState((st) => setState(withPendingSettings(st)));
    onLocalSettings((patch) => setState((prev) => (prev ? { ...prev, settings: { ...prev.settings, ...patch } } : prev)));
    const offNav = api.onNavigate((p) => PAGES.includes(p as Page) && setPage(p as Page));
    const palKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((x) => !x);
      }
    };
    window.addEventListener('keydown', palKey);
    const online = () => api.setOnline(true);
    const offline = () => api.setOnline(false);
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      offState();
      offNav();
      window.removeEventListener('keydown', palKey);
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, []);

  if (state) setLang(state.lang);
  const s = state?.settings;
  useAccent(!!s?.useSystemAccent);

  useEffect(() => {
    if (!s) return;
    if (s.theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', s.theme);
    document.documentElement.lang = state!.lang;
  }, [s?.theme, state?.lang]);

  const count = state?.updates.length ?? 0;
  useEffect(() => {
    if (isMini || !s) return;
    api.setBadge(s.taskbarBadge && count ? badgeDataUrl(count) : null, t('{n} mise(s) à jour', { n: count }));
  }, [count, s?.taskbarBadge, isMini]);

  if (!state || !s) return <div className="splash">{t('Chargement…')}</div>;
  if (isMini) return <MiniView state={state} />;

  const running = state.jobs.filter((j) => j.status === 'running' || j.status === 'queued').length;
  const exploited = state.updates.filter((u) => u.exploited).length;
  const nav: { id: Page; label: string; icon: IconName; badge?: number; danger?: boolean }[] = [
    { id: 'dashboard', label: t('Accueil'), icon: 'chart' },
    { id: 'updates', label: t('Mises à jour'), icon: 'download', badge: count },
    { id: 'search', label: t('Rechercher'), icon: 'search' },
    { id: 'security', label: t('Sécurité'), icon: 'shield', badge: exploited || undefined, danger: true },
    { id: 'inventory', label: t('Inventaire'), icon: 'list' },
    { id: 'hardware', label: t('Matériel'), icon: 'monitor' },
    { id: 'maintenance', label: t('Maintenance'), icon: 'trash' },
    { id: 'history', label: t('Activité'), icon: 'clock', badge: running || undefined },
    { id: 'sources', label: t('Sources'), icon: 'layers' },
    { id: 'settings', label: t('Paramètres'), icon: 'settings' },
    { id: 'about', label: t('À propos'), icon: 'info' },
  ];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <img src={logo} alt="" />
          <span>UpKeep</span>
          {state.fake && <span className="tag">{t('démo')}</span>}
        </div>
        <nav aria-label={t('Navigation')}>
          {nav.map((n) => (
            <button key={n.id} className={page === n.id ? 'active' : ''} aria-current={page === n.id ? 'page' : undefined} onClick={() => go(n.id)}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
              {n.badge ? <span className={`badge ${n.id === 'history' ? 'pulse' : ''} ${n.danger ? 'danger' : ''}`}>{n.badge}</span> : null}
            </button>
          ))}
        </nav>
        <label className="profile-switch">
          <Icon name="user" size={15} />
          <span className="sr-only">{t('Profil')}</span>
          <select value={s.activeProfile} aria-label={t('Profil actif')} onChange={(e) => void api.setProfile(e.target.value)}>
            {s.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {t('Profil : {name}', { name: p.name })}
              </option>
            ))}
          </select>
        </label>
        {state.system && (
          <div className="sysinfo">
            <div className="sys-model">
              {state.system.manufacturer} {state.system.model}
            </div>
            <div>
              BIOS {state.system.biosVersion}
              {state.system.biosDate ? ` · ${state.system.biosDate}` : ''}
            </div>
            <div className="muted">{state.system.os}</div>
          </div>
        )}
      </aside>
      <main className="content">
        <RebootBanner state={state} />
        <ErrorBoundary resetKey={page}>
          {page === 'dashboard' && <DashboardView state={state} go={go} />}
          {page === 'updates' && <UpdatesView state={state} focus={focus} onShowActivity={() => go('history')} />}
          {page === 'security' && <SecurityView state={state} go={go} />}
          {page === 'search' && <PackageSearchView state={state} go={go} />}
          {page === 'inventory' && <InventoryView state={state} />}
          {page === 'hardware' && <HardwareView state={state} />}
          {page === 'maintenance' && <MaintenanceView state={state} />}
          {page === 'history' && <HistoryView state={state} />}
          {page === 'sources' && <SourcesView state={state} />}
          {page === 'settings' && <SettingsView state={state} initialTab={focus} />}
          {page === 'about' && <AboutView state={state} />}
        </ErrorBoundary>
      </main>
      {!s.onboarded && <Onboarding state={state} />}
      {palette && <CommandPalette state={state} pages={nav.map((n) => ({ id: n.id, label: n.label, icon: n.icon }))} go={go} onClose={() => setPalette(false)} />}
    </div>
  );
}
