import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { close, launch } from './helpers';

const PAGES = ['Accueil', 'Mises à jour', 'Sécurité', 'Inventaire', 'Matériel', 'Maintenance', 'Activité', 'Sources', 'Paramètres', 'À propos'];

test('accessibilité de toutes les pages', async () => {
  test.setTimeout(240_000);
  const l = await launch({ onboarded: true, language: 'fr', theme: 'dark' });
  const page: Page = l.page;
  const report: Record<string, unknown[]> = {};
  const problems: string[] = [];

  const audit = async (name: string) => {
    const r = await new AxeBuilder({ page }).setLegacyMode().withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    report[name] = r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 5).map((n) => n.target.join(' ')) }));
    for (const v of r.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical')) {
      problems.push(`${name} — ${v.id} (${v.impact}) : ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
    }
  };
  const go = async (name: string) => {
    await page.locator('.sidebar nav button', { hasText: name }).first().click();
    await page.waitForTimeout(500);
  };

  try {
    for (const theme of ['dark', 'light'] as const) {
      if (theme === 'light') {
        await go('Paramètres');
        await page.getByRole('tab', { name: 'Apparence' }).click();
        await page.locator('.setting', { hasText: 'Thème' }).getByRole('combobox').selectOption('light');
      }
      for (const name of PAGES) {
        await go(name);
        await audit(`${name} (${theme})`);
      }
    }
    await go('Mises à jour');
    await page.locator('td.col-name').first().click();
    await audit('panneau de détail');
    await page.getByRole('tab', { name: /Firmware/ }).click();
    await page.locator('tbody tr').first().getByRole('button', { name: 'Mettre à jour' }).click();
    await audit('confirmation firmware');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+k');
    await audit('recherche globale');
  } finally {
    mkdirSync('test-results', { recursive: true });
    writeFileSync('test-results/axe-report.json', JSON.stringify(report, null, 2));
    await close(l);
  }
  expect(problems).toEqual([]);
});

test('navigation au clavier et zoom 200 %', async () => {
  test.setTimeout(120_000);
  const l = await launch({ onboarded: true, language: 'fr' });
  const page: Page = l.page;
  try {
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.closest('nav') !== null);
    expect(focused).toBe(true);
    await page.locator('.sidebar nav button', { hasText: 'Mises à jour' }).first().click();
    await page.getByRole('tab', { name: /Firmware/ }).click();
    const opener = page.locator('tbody tr').first().getByRole('button', { name: 'Mettre à jour' });
    await opener.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(await opener.evaluate((el) => el === document.activeElement)).toBe(true);
    const th = page.locator('th.sortable', { hasText: 'Nom' });
    const before = (await th.getAttribute('aria-sort')) ?? 'none';
    await th.focus();
    await page.keyboard.press('Enter');
    await expect(th).not.toHaveAttribute('aria-sort', before);
    await l.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2));
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  } finally {
    await close(l);
  }
});
