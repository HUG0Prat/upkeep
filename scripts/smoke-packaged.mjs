import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const dir = resolve(process.env.UPKEEP_RELEASE_DIR ?? 'dist', 'win-unpacked');
const exe = join(dir, 'UpKeep.exe');
if (!existsSync(exe)) {
  console.error(`Introuvable : ${exe} (lancez d'abord « npx electron-builder --win --dir »)`);
  process.exit(1);
}
const data = mkdtempSync(join(tmpdir(), 'upkeep-smoke-'));
let failed = false;
const check = (ok, label) => {
  console.log(`${ok ? '✔' : '✖'} ${label}`);
  if (!ok) failed = true;
};

const cli = spawnSync('cmd.exe', ['/c', join(dir, 'resources', 'upkeep-cli.cmd'), '--help'], {
  encoding: 'utf8',
  env: { ...process.env, UPKEEP_DATA: data },
});
check(cli.status === 0 && /--check/.test(cli.stdout), `CLI --help (code ${cli.status})`);
const list = spawnSync('cmd.exe', ['/c', join(dir, 'resources', 'upkeep-cli.cmd'), '--list', '--json'], {
  encoding: 'utf8',
  env: { ...process.env, UPKEEP_DATA: data },
});
check([0, 10].includes(list.status ?? -1) && list.stdout.trim().startsWith('['), `CLI --list --json (code ${list.status})`);

const app = spawn(exe, [], { env: { ...process.env, UPKEEP_FAKE: '1', UPKEEP_DATA: data }, stdio: 'ignore' });
try {
  let title = '';
  for (let i = 0; i < 60 && title !== 'UpKeep'; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', `(Get-Process -Id ${app.pid} -ErrorAction SilentlyContinue).MainWindowTitle`], { encoding: 'utf8' });
    title = r.stdout.trim();
  }
  check(title === 'UpKeep', `fenêtre principale affichée (titre « ${title} »)`);
  check(existsSync(join(data, 'logs', 'upkeep.log')) || existsSync(join(data, 'detect.json')) || existsSync(join(data, 'settings.json')), 'dossier de données initialisé');
  const fuses = spawnSync('npx', ['@electron/fuses', 'read', '--app', exe], { encoding: 'utf8', shell: true });
  check(/EnableNodeCliInspectArguments is Disabled/i.test(fuses.stdout), 'fusible --inspect désactivé');
  check(/EnableEmbeddedAsarIntegrityValidation is Enabled/i.test(fuses.stdout), 'intégrité de l’archive vérifiée');
} finally {
  spawnSync('taskkill', ['/PID', String(app.pid), '/T', '/F']);
  await new Promise((r) => setTimeout(r, 1000));
  rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
process.exit(failed ? 1 : 0);
