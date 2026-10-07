import { app } from 'electron';

export const SELF_UPDATE_ENABLED = false;

export async function initSelfUpdate(onEvent: (msg: string) => void): Promise<void> {
  if (!SELF_UPDATE_ENABLED || !app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) return;
  const { autoUpdater } = await import('electron-updater');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', (i) => onEvent(`Nouvelle version d’UpKeep : ${i.version}`));
  autoUpdater.on('update-downloaded', (i) => onEvent(`UpKeep ${i.version} sera installé à la fermeture.`));
  autoUpdater.on('error', (e) => console.error('[auto-update]', e));
  await autoUpdater.checkForUpdates();
}
