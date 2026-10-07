import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const [bump = 'patch', ...flags] = process.argv.slice(2);
if (!['patch', 'minor', 'major'].includes(bump)) {
  console.error('Usage : node scripts/release.mjs patch|minor|major [--write] [--commit]');
  process.exit(1);
}
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const [ma, mi, pa] = pkg.version.split('.').map(Number);
const next = bump === 'major' ? `${ma + 1}.0.0` : bump === 'minor' ? `${ma}.${mi + 1}.0` : `${ma}.${mi}.${pa + 1}`;

let range = 'HEAD';
try {
  range = `${git('describe', '--tags', '--abbrev=0')}..HEAD`;
} catch {
}
const commits = git('log', range, '--pretty=format:%s').split('\n').filter(Boolean);

const groups = [
  ['Sécurité', /^(sécurité|securite|security)(\(.+\))?:\s*/i],
  ['Ajouts', /^(ajout|feat)(\(.+\))?:\s*/i],
  ['Corrections', /^(correctif|fix)(\(.+\))?:\s*/i],
  ['Performances', /^(perf)(\(.+\))?:\s*/i],
];
const sections = new Map(groups.map(([g]) => [g, []]));
sections.set('Divers', []);
for (const c of commits) {
  const g = groups.find(([, re]) => re.test(c));
  sections.get(g ? g[0] : 'Divers').push(g ? c.replace(g[1], '') : c);
}

const date = new Date().toLocaleDateString('fr-FR');
let entry = `${next} — ${date}\n`;
for (const [title, items] of sections) {
  if (!items.length) continue;
  entry += `\n${title}\n${items.map((i) => `- ${i}`).join('\n')}\n`;
}

console.log(entry);
if (!flags.includes('--write')) {
  console.log('(aperçu : ajoutez --write pour appliquer)');
  process.exit(0);
}
pkg.version = next;
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
const log = readFileSync('resources/CHANGELOG.md', 'utf8');
writeFileSync('resources/CHANGELOG.md', `${entry}\n${log}`);
console.log(`Version ${next} écrite dans package.json et resources/CHANGELOG.md.`);
if (flags.includes('--commit')) {
  git('add', 'package.json', 'resources/CHANGELOG.md');
  git('commit', '-m', `Version ${next}`);
  git('tag', `v${next}`);
  console.log(`Commit et étiquette v${next} créés (non poussés).`);
}
