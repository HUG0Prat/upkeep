import type { Provider } from './types';
import { msstoreProvider, wingetProvider } from './winget';
import { chocoProvider, scoopProvider } from './scoop';
import { bunProvider, npmProvider, pnpmProvider, yarnProvider } from './npm';
import { pipProvider, pipxProvider } from './pip';
import { cargoProvider, dotnetToolsProvider, psGalleryProvider } from './devtools';
import { browsersProvider, dockerProvider, vscodeProvider } from './apps';
import { wslCoreProvider, wslPackagesProvider } from './wsl';
import { windowsSoftwareProvider, windowsUpdateProvider } from './windowsUpdate';
import { amdProvider, intelProvider, nvidiaProvider } from './gpu';
import { asusProvider, dellProvider, hpProvider, lenovoProvider } from './oem';
import { windowsFeatureProvider } from './feature';
import { fakeProviders } from './fake';

const realProviders: Provider[] = [
  wingetProvider,
  msstoreProvider,
  scoopProvider,
  chocoProvider,
  browsersProvider,
  windowsSoftwareProvider,
  windowsFeatureProvider,
  wslCoreProvider,
  windowsUpdateProvider,
  nvidiaProvider,
  amdProvider,
  intelProvider,
  lenovoProvider,
  dellProvider,
  hpProvider,
  asusProvider,
  npmProvider,
  pnpmProvider,
  yarnProvider,
  bunProvider,
  pipProvider,
  pipxProvider,
  cargoProvider,
  dotnetToolsProvider,
  psGalleryProvider,
  vscodeProvider,
  dockerProvider,
  wslPackagesProvider,
];

export const FAKE = process.env.UPKEEP_FAKE === '1';

export const providers: Provider[] = FAKE ? fakeProviders : realProviders;

export function getProvider(id: string): Provider | undefined {
  return providers.find((p) => p.id === id);
}
