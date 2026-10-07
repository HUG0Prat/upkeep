import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const repo = process.argv[2];
if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
  console.error('Usage : node scripts/set-repo.mjs <compte>/<dépôt>');
  process.exit(1);
}
const placeholder = ['OWNER', 'REPO'].join('/');
const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && !/\.(png|ico)$/.test(f) && f !== 'package-lock.json');
let count = 0;
for (const f of files) {
  const s = readFileSync(f, 'utf8');
  if (!s.includes(placeholder)) continue;
  writeFileSync(f, s.split(placeholder).join(repo));
  count++;
}
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
pkg.homepage = `https://github.com/${repo}#readme`;
pkg.repository = { type: 'git', url: `git+https://github.com/${repo}.git` };
pkg.bugs = { url: `https://github.com/${repo}/issues` };
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
console.log(`${count} fichiers mis à jour pour ${repo}.`);
