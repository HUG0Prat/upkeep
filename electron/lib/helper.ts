import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { powershell, powershellElevated, psQuote, run, tailFile, type ExecResult } from './exec';
import { OPS_LIBRARY, sha256Hex, type OpsJob } from './elevatedOps';

const ROOT = join(process.env.ProgramData ?? 'C:\\ProgramData', 'UpKeep');
const QUEUE = join(ROOT, 'queue');
const HELPER = join(ROOT, 'helper.ps1');
const TASK = '\\UpKeep\\ElevatedHelper';

export const HELPER_PS1 = String.raw`$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
${OPS_LIBRARY}
$q = '${QUEUE}'
Get-ChildItem -LiteralPath $q -Filter *.json | Sort-Object LastWriteTime | ForEach-Object {
  $id = $_.BaseName
  $log = Join-Path $q "$id.log"
  $code = 0
  try {
    if ($id -notmatch '^[0-9a-f-]{36}$') { throw 'Nom de fichier refusé' }
    $jobs = Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    & { Invoke-UkJobs @($jobs) } *>&1 | ForEach-Object { Add-Content -LiteralPath $log -Value ([string]$_) -Encoding UTF8 }
  } catch {
    Add-Content -LiteralPath $log -Value ("ERREUR: " + $_.Exception.Message) -Encoding UTF8
    $code = 1
  }
  Remove-Item -LiteralPath $_.FullName -Force
  Set-Content -LiteralPath (Join-Path $q "$id.done") -Value $code
}`;

const EXPECTED = sha256Hex('\ufeff' + HELPER_PS1.replace(/\r?\n/g, '\r\n'));

export type HelperStatus = 'absent' | 'ok' | 'outdated';

export async function helperStatus(): Promise<HelperStatus> {
  if (!existsSync(HELPER)) return 'absent';
  const r = await run('schtasks.exe', ['/Query', '/TN', TASK], { timeoutMs: 20_000 });
  if (r.code !== 0) return 'absent';
  try {
    return sha256Hex(readFileSync(HELPER, 'utf8')) === EXPECTED ? 'ok' : 'outdated';
  } catch {
    return 'outdated';
  }
}

export async function isHelperInstalled(): Promise<boolean> {
  return (await helperStatus()) === 'ok';
}

export async function installHelper(log: (l: string) => void): Promise<boolean> {
  const sid = (await powershell('[Security.Principal.WindowsIdentity]::GetCurrent().User.Value')).stdout.trim();
  if (!/^S-1-5-21-[\d-]+$/.test(sid)) throw new Error('SID utilisateur introuvable');
  const content = '\ufeff' + HELPER_PS1.replace(/\r?\n/g, '\r\n');
  const b64 = Buffer.from(content, 'utf8').toString('base64');
  const script = String.raw`
$root = ${psQuote(ROOT)}; $q = ${psQuote(QUEUE)}; $sid = ${psQuote(sid)}
New-Item -ItemType Directory -Force -Path $q | Out-Null
function New-Rule($who, $rights) {
  New-Object System.Security.AccessControl.FileSystemAccessRule((New-Object System.Security.Principal.SecurityIdentifier($who)), $rights, 'ContainerInherit,ObjectInherit', 'None', 'Allow')
}
$acl = New-Object System.Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true, $false)
$acl.AddAccessRule((New-Rule 'S-1-5-18' 'FullControl')); $acl.AddAccessRule((New-Rule 'S-1-5-32-544' 'FullControl')); $acl.AddAccessRule((New-Rule $sid 'ReadAndExecute'))
Set-Acl -LiteralPath $root -AclObject $acl
$acl2 = New-Object System.Security.AccessControl.DirectorySecurity
$acl2.SetAccessRuleProtection($true, $false)
$acl2.AddAccessRule((New-Rule 'S-1-5-18' 'FullControl')); $acl2.AddAccessRule((New-Rule 'S-1-5-32-544' 'FullControl')); $acl2.AddAccessRule((New-Rule $sid 'Modify'))
Set-Acl -LiteralPath $q -AclObject $acl2
[IO.File]::WriteAllBytes((Join-Path $root 'helper.ps1'), [Convert]::FromBase64String('${b64}'))

$svc = New-Object -ComObject Schedule.Service; $svc.Connect()
try { $folder = $svc.GetFolder('\UpKeep') } catch { $folder = $svc.GetFolder('\').CreateFolder('UpKeep') }
$def = $svc.NewTask(0)
$def.RegistrationInfo.Description = 'UpKeep : opérations administrateur sans fenêtre UAC (liste fermée)'
$def.Principal.RunLevel = 1
$def.Settings.MultipleInstances = 1
$def.Settings.ExecutionTimeLimit = 'PT6H'
$def.Settings.DisallowStartIfOnBatteries = $false
$def.Settings.StopIfGoingOnBatteries = $false
$a = $def.Actions.Create(0)
$a.Path = 'powershell.exe'
$a.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $root 'helper.ps1') + '"'
$task = $folder.RegisterTaskDefinition('ElevatedHelper', $def, 6, 'SYSTEM', $null, 5)
$task.SetSecurityDescriptor("D:(A;;FA;;;SY)(A;;FA;;;BA)(A;;GRGX;;;$sid)", 0)
"Assistant administrateur installé."`;
  const r = await powershellElevated(script, { onLine: log, timeoutMs: 5 * 60_000 });
  return r.code === 0 && (await isHelperInstalled());
}

export async function uninstallHelper(log: (l: string) => void): Promise<boolean> {
  const r = await powershellElevated(
    `schtasks.exe /Delete /TN '${TASK}' /F; Remove-Item -LiteralPath ${psQuote(ROOT)} -Recurse -Force -ErrorAction SilentlyContinue; "Assistant administrateur supprimé."`,
    { onLine: log, timeoutMs: 5 * 60_000 },
  );
  return r.code === 0;
}

export async function runOpsViaHelper(jobs: OpsJob[], opts: { timeoutMs?: number; onLine?: (l: string) => void }): Promise<ExecResult> {
  if ((await helperStatus()) !== 'ok') throw new Error('Assistant administrateur absent ou modifié : réinstallez-le dans Paramètres › Installation.');
  const id = randomUUID();
  const file = join(QUEUE, `${id}.json`);
  const logPath = join(QUEUE, `${id}.log`);
  const donePath = join(QUEUE, `${id}.done`);
  await writeFile(file, JSON.stringify(jobs), 'utf8');
  const start = await run('schtasks.exe', ['/Run', '/TN', TASK], { timeoutMs: 30_000 });
  if (start.code !== 0) {
    await rm(file, { force: true });
    throw new Error(`Assistant administrateur indisponible : ${start.stderr.trim() || start.stdout.trim()}`);
  }
  const tail = tailFile(logPath, opts.onLine);
  const deadline = Date.now() + (opts.timeoutMs ?? 2 * 3600_000);
  let code = -1;
  while (Date.now() < deadline) {
    if (existsSync(donePath)) {
      code = Number((await readFile(donePath, 'utf8')).replace(/^\ufeff/, '').trim());
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  const output = await tail.stop();
  await Promise.all([logPath, donePath].map((p) => rm(p, { force: true })));
  return { code, stdout: output, stderr: code === -1 ? 'Délai dépassé' : '' };
}


const CHECK_TASK = 'UpKeep\\Check';

export async function isCheckTaskInstalled(): Promise<boolean> {
  return (await run('schtasks.exe', ['/Query', '/TN', CHECK_TASK], { timeoutMs: 20_000 })).code === 0;
}

export async function installCheckTask(exe: string, args: string[], intervalMinutes: number): Promise<boolean> {
  const tr = [`"${exe}"`, ...args.map((a) => `"${a}"`), '--check-and-exit'].join(' ');
  const mo = Math.max(15, Math.min(intervalMinutes, 1439));
  const r = await run('schtasks.exe', ['/Create', '/F', '/TN', CHECK_TASK, '/SC', 'MINUTE', '/MO', String(mo), '/TR', tr, '/RL', 'LIMITED'], {
    timeoutMs: 30_000,
  });
  return r.code === 0;
}

export async function removeCheckTask(): Promise<boolean> {
  return (await run('schtasks.exe', ['/Delete', '/F', '/TN', CHECK_TASK], { timeoutMs: 30_000 })).code === 0;
}
