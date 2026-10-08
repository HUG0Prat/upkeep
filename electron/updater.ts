import { app } from 'electron';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AppUpdater } from 'electron-updater';
import type { SelfUpdateState } from '../shared/types';
import { compareVersions } from '../shared/versions';
import { fetchJson } from './lib/http';

const REPO = 'HUG0Prat/upkeep';
const RELEASES = `https://github.com/${REPO}/releases`;
const FIRST_CHECK_MS = 60_000;
const INTERVAL_MS = 6 * 3600_000;

/** Seule la version installée (NSIS) sait se remplacer ; portable, MSI, ZIP et AppX renvoient vers la page de la release. */
export function selfUpdateMode(opts: { fake: boolean; portable: boolean }): SelfUpdateState['mode'] {
  if (!app.isPackaged || opts.fake) return 'off';
  if (opts.portable || process.windowsStore) return 'manual';
  const nsis = existsSync(join(dirname(process.execPath), `Uninstall ${app.getName()}.exe`)) && existsSync(join(process.resourcesPath, 'app-update.yml'));
  return nsis ? 'installer' : 'manual';
}

interface Hooks {
  /** Réglage « Mettre à jour UpKeep automatiquement ». */
  enabled: () => boolean;
  onState: (state: SelfUpdateState) => void;
  /** Nouvelle version trouvée (ready = déjà téléchargée, prête à installer). */
  onFound: (version: string, ready: boolean) => void;
}

/**
 * Mise à jour d'UpKeep depuis les releases GitHub publiées (les brouillons ne sont pas visibles).
 * Version NSIS : electron-updater télécharge l'installeur (empreinte SHA-512 de latest.yml) et l'installe
 * à la fermeture ou sur demande. Autres formats : simple comparaison avec la dernière release.
 */
export class SelfUpdater {
  private state: SelfUpdateState;
  private updater?: AppUpdater;
  private readonly notified = new Set<string>();

  constructor(
    mode: SelfUpdateState['mode'],
    private readonly hooks: Hooks,
  ) {
    this.state = { mode, status: 'idle' };
    hooks.onState(this.state);
  }

  start(): void {
    if (this.state.mode === 'off') return;
    setTimeout(() => void this.check(false), FIRST_CHECK_MS);
    setInterval(() => void this.check(false), INTERVAL_MS);
  }

  async check(manual: boolean): Promise<void> {
    if (this.state.mode === 'off' || ['checking', 'downloading', 'ready'].includes(this.state.status)) return;
    if (!manual && !this.hooks.enabled()) return;
    this.set({ status: 'checking', error: undefined });
    try {
      if (this.state.mode === 'installer') await this.checkInstaller();
      else await this.checkRelease();
    } catch (e) {
      console.error('[auto-update]', e);
      this.set({ status: 'error', error: (e as Error).message, lastCheck: Date.now() });
    }
  }

  /** Télécharge la version trouvée (mode installer). */
  async download(): Promise<void> {
    if (this.state.mode !== 'installer' || this.state.status !== 'available' || !this.updater) return;
    this.set({ status: 'downloading', percent: 0 });
    try {
      await this.updater.downloadUpdate();
      this.set({ status: 'ready', percent: undefined });
      this.found(this.state.version!, true);
    } catch (e) {
      console.error('[auto-update]', e);
      this.set({ status: 'error', percent: undefined, error: (e as Error).message });
    }
  }

  get ready(): boolean {
    return this.state.status === 'ready';
  }

  /** Ferme UpKeep, installe la mise à jour en silencieux et relance l'application. */
  install(): void {
    if (this.state.status === 'ready') this.updater?.quitAndInstall(true, true);
  }

  private async checkInstaller(): Promise<void> {
    const u = await this.load();
    const r = await u.checkForUpdates();
    const version = r?.isUpdateAvailable ? r.updateInfo.version : undefined;
    if (!version) return this.set({ status: 'uptodate', version: undefined, lastCheck: Date.now() });
    this.set({ status: 'available', version, url: `${RELEASES}/tag/v${version}`, lastCheck: Date.now() });
    if (this.hooks.enabled()) await this.download();
    else this.found(version, false);
  }

  private async checkRelease(): Promise<void> {
    const r = await fetchJson<{ tag_name: string; html_url: string }>(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    const version = r.tag_name.replace(/^v/i, '');
    if (!(compareVersions(version, app.getVersion()) > 0)) return this.set({ status: 'uptodate', version: undefined, lastCheck: Date.now() });
    this.set({ status: 'available', version, url: r.html_url, lastCheck: Date.now() });
    this.found(version, false);
  }

  private async load(): Promise<AppUpdater> {
    if (this.updater) return this.updater;
    const { autoUpdater } = await import('electron-updater');
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowPrerelease = false;
    autoUpdater.on('download-progress', (p) => this.set({ percent: Math.round(p.percent) }));
    this.updater = autoUpdater;
    return autoUpdater;
  }

  private found(version: string, ready: boolean): void {
    const key = `${version}:${ready}`;
    if (this.notified.has(key)) return;
    this.notified.add(key);
    this.hooks.onFound(version, ready);
  }

  private set(patch: Partial<SelfUpdateState>): void {
    this.state = { ...this.state, ...patch };
    this.hooks.onState(this.state);
  }
}
