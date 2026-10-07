import { test } from '@playwright/test';
import { close, launch } from './helpers';

test.skip(process.env.UPKEEP_SCREENSHOTS !== '1', 'captures à la demande');

const OUT = '.github/assets';
const SHOTS: { file: string; nav: string; theme: 'dark' | 'light' }[] = [
  { file: 'dashboard-dark.png', nav: 'Home', theme: 'dark' },
  { file: 'updates-dark.png', nav: 'Updates', theme: 'dark' },
  { file: 'updates-light.png', nav: 'Updates', theme: 'light' },
  { file: 'security-light.png', nav: 'Security', theme: 'light' },
];

for (const shot of SHOTS) {
  test(shot.file, async () => {
    const l = await launch({ onboarded: true, language: 'en', theme: shot.theme });
    try {
      await l.app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0];
        w.setContentSize(1280, 800);
        w.center();
      });
      await l.page.locator('.sidebar nav button', { hasText: shot.nav }).first().click();
      await l.page.waitForTimeout(4000);
      await l.page.screenshot({ path: `${OUT}/${shot.file}` });
    } finally {
      await close(l);
    }
  });
}
