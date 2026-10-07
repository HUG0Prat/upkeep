import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const version = pkg.version;
const repo = pkg.repository?.url?.match(/github\.com\/([^/]+\/[^/.]+)/)?.[1];
const from = resolve('dist');
const dest = resolve('release', `v${version}`);
const wanted = (f) => f.startsWith(`UpKeep-${version}-`) && /\.(exe|msi|appx|zip|7z)$/i.test(f);

const files = existsSync(from) ? readdirSync(from).filter(wanted) : [];
if (!files.length) {
  console.error(`Aucun paquet UpKeep ${version} dans dist/ : lancez d'abord « npm run dist ».`);
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const f of files) cpSync(join(from, f), join(dest, f));
writeFileSync(
  join(dest, 'SHA256SUMS.txt'),
  files.map((f) => `${createHash('sha256').update(readFileSync(join(dest, f))).digest('hex')}  ${f}`).join('\n') + '\n',
);

const env = { ...process.env, ...(repo ? { GITHUB_REPOSITORY: repo } : {}) };
spawnSync('node', ['scripts/release-notes.mjs', version, join(dest, 'RELEASE_NOTES.md')], { stdio: 'inherit', env });

if (repo) {
  spawnSync('node', ['scripts/winget-manifest.mjs', dest, `https://github.com/${repo}/releases/download/v${version}`], { stdio: 'inherit' });
  cpSync('packaging/winget', join(dest, 'winget', 'manifests', 'h', 'HUG0Prat', 'UpKeep', version), { recursive: true });
}

console.log(`\nRelease v${version} prête dans ${dest} :`);
for (const f of [...files, 'SHA256SUMS.txt', 'RELEASE_NOTES.md']) console.log(`  ${f}`);
if (!repo) console.log('\nDépôt GitHub non défini : lancez « node scripts/set-repo.mjs <compte>/<dépôt> » puis recommencez pour générer les manifestes winget.');
