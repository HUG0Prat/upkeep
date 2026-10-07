import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface Launched {
  app: ElectronApplication;
  page: Page;
  dataDir: string;
}

export async function launch(settings?: Record<string, unknown>): Promise<Launched> {
  const dataDir = mkdtempSync(join(tmpdir(), 'upkeep-e2e-'));
  if (settings) writeFileSync(join(dataDir, 'settings.json'), JSON.stringify(settings));
  const app = await electron.launch({
    args: ['.', `--lang=${process.env.UPKEEP_TEST_LANG ?? 'fr-FR'}`],
    env: { ...process.env, UPKEEP_FAKE: '1', UPKEEP_DATA: dataDir, VITE_DEV_SERVER_URL: '' },
  });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await page.waitForSelector('.app');
  return { app, page, dataDir };
}

export async function close(l?: Launched): Promise<void> {
  if (!l) return;
  await l.app.close().catch(() => undefined);
  try {
    rmSync(l.dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  } catch {
  }
}

export const nameCell = (page: Page, text: string | RegExp) => page.locator('td.col-name', { hasText: text });
export const row = (page: Page, text: string | RegExp) => page.locator('tbody tr', { has: page.locator('td.col-name', { hasText: text }) });
