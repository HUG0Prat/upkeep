import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, cpSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { format } from 'node:util';
import { dataDir } from './paths';
import { powershell, psQuote } from './exec';

const MAX_BYTES = 1024 * 1024;
const KEEP = 3;

export function logsDir(): string {
  const d = join(dataDir(), 'logs');
  mkdirSync(d, { recursive: true });
  return d;
}

function rotate(file: string): void {
  try {
    if (!existsSync(file) || statSync(file).size < MAX_BYTES) return;
    for (let i = KEEP - 1; i >= 1; i--) {
      const from = i === 1 ? file : `${file}.${i - 1}`;
      if (existsSync(from)) renameSync(from, `${file}.${i}`);
    }
  } catch {
  }
}

type Level = 'debug' | 'info' | 'warn' | 'error';

export function redact(text: string): string {
  return text
    .replace(/(token|password|passwd|secret|api[_-]?key)(["'\s:=]+)[^\s"',;]+/gi, '$1$2***')
    .replace(/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi, '$1***:***@')
    .replace(new RegExp((process.env.USERNAME ?? '§§').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '<utilisateur>');
}

export function log(level: Level, ...args: unknown[]): void {
  const file = join(logsDir(), 'upkeep.log');
  rotate(file);
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${redact(format(...args))}\n`;
  try {
    appendFileSync(file, line, 'utf8');
  } catch {
  }
}

export function installConsoleLogging(): void {
  for (const level of ['info', 'warn', 'error'] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      log(level, ...args);
      orig(...args);
    };
  }
  const origLog = console.log.bind(console);
  console.log = (...args: unknown[]) => {
    log('info', ...args);
    origLog(...args);
  };
  process.on('uncaughtException', (err) => log('error', 'Exception non interceptée :', err));
  process.on('unhandledRejection', (err) => log('error', 'Promesse rejetée non gérée :', err));
}

export async function createDiagnosticZip(dest: string, crashDumpsDir: string, summary: Record<string, unknown>): Promise<string> {
  const tmp = join(dataDir(), 'diagnostic-tmp');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  cpSync(logsDir(), join(tmp, 'logs'), { recursive: true });
  if (existsSync(crashDumpsDir) && readdirSync(crashDumpsDir).length) cpSync(crashDumpsDir, join(tmp, 'crashes'), { recursive: true });
  for (const f of ['settings.json', 'history.json']) {
    const p = join(dataDir(), f);
    if (existsSync(p)) writeFileSync(join(tmp, f), redact(readFileSync(p, 'utf8')), 'utf8');
  }
  writeFileSync(join(tmp, 'resume.json'), redact(JSON.stringify(summary, null, 2)), 'utf8');
  const r = await powershell(`Compress-Archive -Path ${psQuote(join(tmp, '*'))} -DestinationPath ${psQuote(dest)} -Force`, { timeoutMs: 120_000 });
  rmSync(tmp, { recursive: true, force: true });
  if (r.code !== 0) throw new Error(r.stderr || 'Compression impossible');
  return dest;
}
