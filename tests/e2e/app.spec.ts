import { expect, test, type Page } from '@playwright/test';
import { close, launch, nameCell, row, type Launched } from './helpers';

let l: Launched;
let page: Page;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  l = await launch({ onboarded: true, language: 'fr' });
  page = l.page;
});
test.afterAll(() => close(l));

const nav = (name: RegExp) => page.locator('.sidebar nav button', { hasText: name }).click();

test('accueil : tableau de bord', async () => {
  await expect(page.locator('.view h1', { hasText: 'Accueil' })).toBeVisible();
  await expect(page.locator('.hero')).toContainText(/mise(s) à jour/);
  await expect(page.locator('.tile', { hasText: 'Paquets' })).toBeVisible();
});

test('recherche globale Ctrl+K', async () => {
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Recherche globale' });
  await expect(dialog).toBeVisible();
  await page.keyboard.type('mises à jour');
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(page.locator('.view h1', { hasText: 'Mises à jour' })).toBeVisible();
});

test('liste des mises à jour, filtres et masquages', async () => {
  await expect(nameCell(page, 'Mozilla Firefox')).toBeVisible();
  await expect(page.getByText(/version\(s\) en quarantaine/)).toBeVisible();
  await expect(nameCell(page, 'VLC')).toHaveCount(0);
  await page.getByRole('tab', { name: /Pilotes/ }).click();
  await expect(nameCell(page, 'Intel - net')).toBeVisible();
  await expect(nameCell(page, 'Razer')).toHaveCount(0);
  await page.getByRole('tab', { name: /Tout/ }).click();
});

test('recherche avec surlignage', async () => {
  await page.getByRole('textbox', { name: 'Rechercher' }).fill('git');
  await expect(page.locator('mark', { hasText: /git/i }).first()).toBeVisible();
  await expect(nameCell(page, 'Firefox')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Rechercher' }).fill('');
});

test('panneau de détail et versions', async () => {
  await nameCell(page, /^Git/).click();
  const detail = page.getByRole('complementary', { name: 'Détails' });
  await expect(detail).toBeVisible();
  await expect(detail.getByText('Description de Git')).toBeVisible();
  await detail.getByRole('button', { name: 'Charger les versions' }).click();
  await expect(detail.getByRole('combobox', { name: 'Version' })).toBeVisible();
  await detail.getByRole('button', { name: 'Fermer' }).click();
  await expect(detail).toBeHidden();
});

test('installation sans quitter la page', async () => {
  await row(page, /^Git/).getByRole('button', { name: 'Mettre à jour' }).click();
  await expect(page.locator('.toast')).toContainText('lancée');
  await expect(page.getByRole('heading', { name: 'Mises à jour' })).toBeVisible();
  await expect(nameCell(page, /^Git/)).toHaveCount(0, { timeout: 15_000 });
});

test('activité : historique et journal', async () => {
  await nav(/Activité/);
  await expect(page.locator('.status.ok').first()).toBeVisible();
  await expect(page.locator('.log').first()).toContainText('Installation de Git');
  await expect(page.getByRole('button', { name: 'Exporter en CSV' })).toBeEnabled();
});

test('menu contextuel : ignorer puis annuler', async () => {
  await nav(/Mises à jour/);
  await nameCell(page, 'Mozilla Firefox').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Ignorer cette version' }).click();
  await expect(nameCell(page, 'Mozilla Firefox')).toHaveCount(0);
  await page.locator('.toast').getByRole('button', { name: 'Annuler' }).click();
  await expect(nameCell(page, 'Mozilla Firefox')).toBeVisible();
  await nameCell(page, 'Mozilla Firefox').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Ignorer cette version' }).click();
  await expect(nameCell(page, 'Mozilla Firefox')).toHaveCount(0);
});

test('colonnes et vue compacte', async () => {
  await page.getByRole('button', { name: 'Colonnes et affichage' }).click();
  await page.locator('.cols-menu label', { hasText: 'Taille' }).locator('input').uncheck();
  await expect(page.locator('thead th.sortable', { hasText: 'Taille' })).toHaveCount(0);
  await page.locator('.cols-menu label', { hasText: 'Vue compacte' }).locator('input').check();
  await expect(page.locator('table.compact-rows')).toBeVisible();
  await page.locator('.cols-menu label', { hasText: 'Taille' }).locator('input').check();
  await page.keyboard.press('Escape');
});

test('mode simulation : rien n’est installé', async () => {
  await nav(/Paramètres/);
  await page.getByRole('tab', { name: 'Installation' }).click();
  await page.locator('.setting', { hasText: 'Mode simulation' }).getByRole('switch').check();
  await nav(/Mises à jour/);
  await page.getByRole('tab', { name: /Windows/ }).click();
  await row(page, 'KB5099999').getByRole('button', { name: 'Mettre à jour' }).click();
  await expect(page.getByRole('dialog')).toContainText('Mode simulation');
  await page.getByRole('dialog').getByRole('button', { name: /Installer/ }).click();
  await nav(/Activité/);
  await expect(page.locator('.job', { hasText: 'KB5099999' }).locator('.tag', { hasText: 'simulation' })).toBeVisible({ timeout: 15_000 });
  await nav(/Paramètres/);
  await page.getByRole('tab', { name: 'Installation' }).click();
  await page.locator('.setting', { hasText: 'Mode simulation' }).getByRole('switch').uncheck();
  await nav(/Mises à jour/);
  await page.getByRole('tab', { name: /Tout/ }).click();
});

test('firmware : confirmation avec avertissements', async () => {
  await page.getByRole('tab', { name: /Firmware/ }).click();
  await row(page, 'BIOS Update').getByRole('button', { name: 'Mettre à jour' }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirmer l’installation' });
  await expect(dialog).toContainText('point de restauration');
  await expect(dialog).toContainText('BitLocker');
  await dialog.getByRole('button', { name: 'Annuler' }).click();
  await page.getByRole('tab', { name: /Tout/ }).click();
});

test('profils : création et profil au lancement', async () => {
  await nav(/Paramètres/);
  await page.getByRole('tab', { name: 'Profils' }).click();
  await page.getByRole('button', { name: 'Nouveau', exact: true }).click();
  await expect(page.locator('.chip.active', { hasText: 'Nouveau profil' })).toBeVisible();
  const nameInput = page.locator('.setting', { hasText: 'Nom' }).getByRole('textbox');
  await nameInput.fill('Nuit');
  await page.getByRole('combobox', { name: 'Notifications' }).selectOption('off');
  const launchSel = page.locator('.setting', { hasText: 'Profil au lancement' }).getByRole('combobox');
  await launchSel.selectOption({ label: 'Nuit' });
  await expect(launchSel.locator('option:checked')).toHaveText('Nuit');
  await expect(page.locator('.chip', { hasText: 'Nuit' })).toBeVisible();
});

test('quarantaine : valeur par défaut modifiable', async () => {
  await page.getByRole('tab', { name: 'Automatisation' }).click();
  const days = page.getByRole('spinbutton', { name: 'Jours' });
  await expect(days).toHaveValue('3');
  await days.fill('0');
  await nav(/Mises à jour/);
  await expect(nameCell(page, 'VLC')).toBeVisible();
});

test('onglets Matériel et Inventaire non rechargés à chaque visite', async () => {
  await nav(/Inventaire/);
  await expect(page.getByRole('table', { name: 'Logiciels installés' })).toBeVisible({ timeout: 60_000 });
  await nav(/Mises à jour/);
  await nav(/Inventaire/);
  await expect(page.getByText('Lecture des programmes installés…')).toHaveCount(0, { timeout: 500 });
});

test('recherche et installation de logiciels', async () => {
  await nav(/Rechercher/);
  await expect(page.locator('.view h1', { hasText: 'Rechercher des logiciels' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Microsoft Store' })).toBeDisabled();
  const input = page.getByRole('textbox', { name: 'Logiciel à rechercher' });
  const submit = page.locator('form[role=search] button[type=submit]');
  const results = page.getByRole('table', { name: 'Résultats de la recherche' });

  await input.fill('vlc');
  await input.press('Enter');
  await expect(results.getByText('VideoLAN.VLC')).toBeVisible();
  await expect(results.getByText('extras/vlc')).toBeVisible();

  await page.getByRole('button', { name: 'Scoop' }).click();
  await submit.click();
  await expect(results.getByText('VideoLAN.VLC')).toBeVisible();
  await expect(results.getByText('extras/vlc')).toHaveCount(0);
  await page.getByRole('button', { name: 'Scoop' }).click();

  await input.fill('7zip');
  await submit.click();
  await expect(results.locator('tr', { hasText: '7zip.7zip' }).getByText('installé')).toBeVisible();

  await input.fill('vlc');
  await submit.click();
  await results.locator('tr', { hasText: 'VideoLAN.VLC' }).getByRole('button', { name: 'Installer' }).click();
  await expect(page.locator('.toast')).toContainText('ajoutée à la file');
  await page.locator('.toast').getByRole('button', { name: 'Voir l’activité' }).click();
  await expect(page.locator('.log').first()).toContainText('Installation de VLC media player', { timeout: 15_000 });
});

test('traduction anglaise', async () => {
  await nav(/Paramètres/);
  await page.getByRole('tab', { name: 'Apparence' }).click();
  await page.locator('.setting', { hasText: 'Langue' }).getByRole('combobox').selectOption('en');
  await expect(page.locator('.view h1', { hasText: 'Settings' })).toBeVisible();
  await page.locator('.setting', { hasText: 'Language' }).getByRole('combobox').selectOption('fr');
  await expect(page.locator('.view h1', { hasText: 'Paramètres' })).toBeVisible();
});
