import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const pick = (name, all) => {
  const v = args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  return v ? v.split(',') : all;
};
const targets = pick('targets', ['nsis', 'portable', 'msi', 'appx', 'zip', '7z']);
const archs = pick('arch', ['x64', 'arm64']);
const out = resolve('dist');
const work = resolve(process.env.UPKEEP_BUILD_TMP ?? join(tmpdir(), 'upkeep-build'));
const keep = /\.(exe|msi|appx|zip|7z)$/i;

const run = (cmd, cmdArgs) => spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: true }).status === 0;

if (!args.includes('--skip-compile') && !run('npm', ['run', 'build'])) process.exit(1);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
rmSync(work, { recursive: true, force: true });

const results = [];
for (const arch of archs) {
  for (const target of targets) {
    const dir = join(work, `${target}-${arch}`);
    const started = Date.now();
    const ok = run('npx', ['electron-builder', '--win', target, `--${arch}`, '--publish', 'never', `-c.directories.output="${dir}"`]);
    const files = ok && existsSync(dir) ? readdirSync(dir).filter((f) => keep.test(f) && !f.endsWith('.blockmap')) : [];
    for (const f of files) cpSync(join(dir, f), join(out, f));
    const unpacked = join(dir, arch === 'x64' ? 'win-unpacked' : `win-${arch}-unpacked`);
    const unpackedOut = join(out, basename(unpacked));
    if (ok && existsSync(unpacked) && !existsSync(unpackedOut)) cpSync(unpacked, unpackedOut, { recursive: true });
    results.push({ target, arch, ok: ok && files.length > 0, files, seconds: Math.round((Date.now() - started) / 1000) });
  }
}

const sums = readdirSync(out)
  .filter((f) => statSync(join(out, f)).isFile())
  .map((f) => `${createHash('sha256').update(readFileSync(join(out, f))).digest('hex')}  ${f}`);
writeFileSync(join(out, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
rmSync(work, { recursive: true, force: true });

console.log('\nRésultat :');
for (const r of results) console.log(`${r.ok ? '✔' : '✖'} ${r.target.padEnd(9)} ${r.arch.padEnd(6)} ${String(r.seconds).padStart(4)} s  ${r.files.join(', ')}`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
