import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { psPool } from './psHost';

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  timeoutMs?: number;
  onLine?: (line: string) => void;
  shell?: boolean;
  signal?: AbortSignal;
  env?: Record<string, string>;
  cwd?: string;
  utf16?: boolean;
}

export function cleanLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => {
      const parts = l.split('\r').filter((p) => p.trim() !== '');
      return parts.length ? parts[parts.length - 1] : '';
    })
    .map((l) => l.replace(/\s+$/, ''));
}

function killTree(pid?: number): void {
  if (!pid) return;
  spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
}

export function run(cmd: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve) => {
    if (opts.signal?.aborted) return resolve({ code: -2, stdout: '', stderr: 'Annulé' });
    const child = spawn(cmd, args, {
      windowsHide: true,
      shell: opts.shell ?? false,
      cwd: opts.cwd,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', NO_COLOR: '1', ...(opts.env ?? {}) },
    });
    let stdout = '';
    let stderr = '';
    let pending = '';
    let aborted = false;
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          stderr += `\n[timeout après ${Math.round(opts.timeoutMs! / 1000)} s]`;
          killTree(child.pid);
        }, opts.timeoutMs)
      : undefined;
    const onAbort = () => {
      aborted = true;
      killTree(child.pid);
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    const feed = (chunk: string) => {
      if (!opts.onLine) return;
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const l of cleanLines(lines.join('\n'))) if (l.trim()) opts.onLine(l);
    };

    const enc = opts.utf16 ? 'utf16le' : 'utf8';
    child.stdout.setEncoding(enc);
    child.stderr.setEncoding(enc);
    child.stdout.on('data', (d: string) => {
      stdout += d;
      feed(d);
    });
    child.stderr.on('data', (d: string) => {
      stderr += d;
      feed(d);
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(err) });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      if (pending.trim() && opts.onLine) opts.onLine(pending.trim());
      resolve({ code: aborted ? -2 : (code ?? -1), stdout: stdout.replace(/\0/g, ''), stderr: aborted ? stderr + '\nAnnulé' : stderr });
    });
  });
}

export const PS_PREAMBLE =
  "$ProgressPreference='SilentlyContinue';$ErrorActionPreference='Stop';" +
  '[Console]::OutputEncoding=[Text.Encoding]::UTF8;$OutputEncoding=[Text.Encoding]::UTF8;';

function encode(script: string): string {
  return Buffer.from(PS_PREAMBLE + script, 'utf16le').toString('base64');
}

function poolable(script: string, opts: ExecOptions): boolean {
  return !opts.onLine && !opts.signal && !opts.utf16 && !opts.env && !opts.cwd && !/exit/i.test(script) && process.env.UPKEEP_NO_PS_POOL !== '1';
}

export function powershell(script: string, opts: ExecOptions = {}): Promise<ExecResult> {
  if (poolable(script, opts)) return psPool().run(PS_PREAMBLE + script, opts.timeoutMs ?? 120_000);
  return run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encode(script)],
    opts,
  );
}

export async function powershellJson<T>(script: string, opts: ExecOptions = {}): Promise<T> {
  const res = await powershell(script, opts);
  if (res.code !== 0) throw new Error((res.stderr || res.stdout).trim() || `PowerShell code ${res.code}`);
  const text = res.stdout.trim();
  if (!text) return [] as unknown as T;
  return JSON.parse(text) as T;
}

export function wrapElevatedScript(script: string, logPath: string): string {
  return (
    PS_PREAMBLE +
    `\n$log = ${psQuote(logPath)}\n$global:JobExitCode = 0\n` +
    'function Out-Log { process { Add-Content -LiteralPath $log -Value ([string]$_) -Encoding UTF8 } }\n' +
    `try {\n& {\n${script}\n} *>&1 | Out-Log\n$code = $global:JobExitCode }\n` +
    'catch { ("ERREUR: " + $_.Exception.Message) | Out-Log; $code = 1 }\nexit $code\n'
  );
}

export interface ElevatedOptions {
  timeoutMs?: number;
  onLine?: (line: string) => void;
}

export function tailFile(path: string, onLine?: (l: string) => void): { stop: () => Promise<string> } {
  let seen = 0;
  const read = async () => {
    try {
      const lines = cleanLines((await readFile(path, 'utf8')).replace(/^﻿/, ''));
      if (onLine) for (const l of lines.slice(seen)) if (l.trim()) onLine(l);
      seen = lines.length;
      return lines.join('\n');
    } catch {
      return '';
    }
  };
  const timer = setInterval(() => void read(), 1000);
  return {
    stop: async () => {
      clearInterval(timer);
      return read();
    },
  };
}

export function verifiedLoader(scriptPath: string, body: string): string {
  const sha = createHash('sha256').update(body, 'utf8').digest('hex').toUpperCase();
  const loader =
    `$c = [IO.File]::ReadAllText(${psQuote(scriptPath)}, [Text.Encoding]::UTF8).TrimStart([char]0xFEFF); ` +
    `$h = -join ([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($c)) | ForEach-Object { $_.ToString('X2') }); ` +
    `if ($h -ne '${sha}') { exit 97 }; & ([scriptblock]::Create($c))`;
  return Buffer.from(loader, 'utf16le').toString('base64');
}

export async function powershellElevated(script: string, opts: ElevatedOptions = {}): Promise<ExecResult> {
  const dir = await mkdtemp(join(tmpdir(), 'upkeep-'));
  const scriptPath = join(dir, 'job.ps1');
  const logPath = join(dir, 'out.log');
  const body = wrapElevatedScript(script, logPath);
  await writeFile(scriptPath, '﻿' + body, 'utf8');

  const encodedLoader = verifiedLoader(scriptPath, body);
  const launcher =
    `$p = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru ` +
    `-ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${encodedLoader}'; exit $p.ExitCode`;

  const tail = tailFile(logPath, opts.onLine);
  const res = await powershell(launcher, { timeoutMs: opts.timeoutMs });
  let output = await tail.stop();
  if (!output) {
    output = /annul|cancel/i.test(res.stderr) ? 'Élévation refusée par l’utilisateur.' : res.stderr;
    opts.onLine?.(output);
  }
  await rm(dir, { recursive: true, force: true });
  return { code: res.code, stdout: output, stderr: res.stderr };
}

export async function commandExists(cmd: string): Promise<boolean> {
  const res = await run('where.exe', [cmd]);
  return res.code === 0 && res.stdout.trim().length > 0;
}

export function psQuote(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

export function safeId(id: string): string {
  if (!/^[\w.@/+:-]+$/.test(id)) throw new Error(`Identifiant refusé : ${id}`);
  return id;
}
