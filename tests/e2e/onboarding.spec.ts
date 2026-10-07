import { expect, test } from '@playwright/test';
import { close, launch, type Launched } from './helpers';

let l: Launched;
test.afterAll(() => close(l));

test('accueil au premier lancement', async () => {
  l = await launch();
  const { page } = l;
  await expect(page.getByRole('dialog', { name: 'Bienvenue dans UpKeep' })).toBeVisible();
  await page.getByRole('button', { name: 'Suivant' }).click();
  await expect(page.getByText('Sources à surveiller')).toBeVisible();
  await page.getByRole('button', { name: 'Suivant' }).click();
  await page.getByRole('button', { name: 'Commencer' }).click();
  await expect(page.getByRole('dialog', { name: 'Bienvenue dans UpKeep' })).toBeHidden();
});
