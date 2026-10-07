import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [folder = 'dist', baseUrl] = process.argv.slice(2);
if (!baseUrl) {
  console.error('Usage : node scripts/winget-manifest.mjs <dossier des installeurs> <url de base, ex. https://github.com/HUG0Prat/upkeep/releases/download/v1.0.0>');
  process.exit(1);
}
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const installers = ['x64', 'arm64']
  .map((arch) => ({ arch, file: `UpKeep-${version}-${arch}-setup.exe` }))
  .filter(({ file }) => existsSync(join(folder, file)))
  .map(({ arch, file }) => ({
    arch,
    url: `${baseUrl.replace(/\/$/, '')}/${file}`,
    sha: createHash('sha256').update(readFileSync(join(folder, file))).digest('hex').toUpperCase(),
  }));
if (!installers.length) {
  console.error(`Aucun installeur UpKeep-${version}-<arch>-setup.exe dans ${folder}`);
  process.exit(1);
}

const dir = 'packaging/winget';
for (const f of readdirSync(dir)) {
  const p = join(dir, f);
  let s = readFileSync(p, 'utf8').replace(/\r\n/g, '\n').replace(/^PackageVersion: .*/m, `PackageVersion: ${version}`);
  if (f.endsWith('.installer.yaml')) {
    const list = installers.map((i) => `  - Architecture: ${i.arch}\n    InstallerUrl: ${i.url}\n    InstallerSha256: ${i.sha}`).join('\n');
    s = s.replace(/Installers:\n(?: {2}- [\s\S]*?)(?=\nManifestType:)/, `Installers:\n${list}`);
  }
  writeFileSync(p, s);
}
for (const i of installers) console.log(`${i.arch} : ${i.sha}`);
console.log(`Manifestes winget mis à jour pour la version ${version}.`);
