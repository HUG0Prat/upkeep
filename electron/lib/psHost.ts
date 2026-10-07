import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

const HOST_SCRIPT = String.raw`
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$OutputEncoding = [Text.Encoding]::UTF8
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $sp = $line.IndexOf(' ')
  $id = $line.Substring(0, $sp)
  $code = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line.Substring($sp + 1)))
  $exit = 0
  try {
    $ErrorActionPreference = 'Stop'
    $out = & ([scriptblock]::Create($code)) 2>&1 | ForEach-Object { if ($_ -is [System.Management.Automation.ErrorRecord]) { "@@ERR " + $_.ToString() } else { $_ } } | Out-String -Width 8192
    [Console]::Out.Write($out)
  } catch {
    [Console]::Out.WriteLine("@@ERR " + $_.Exception.Message)
    $exit = 1
  }
  [Console]::Out.WriteLine("@@END $id $exit")
  [Console]::Out.Flush()
}`;

export interface HostResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface Job {
  id: number;
  script: string;
  timeoutMs: number;
  resolve: (r: HostResult) => void;
}

class Host {
  proc: ChildProcessWithoutNullStreams;
  busy: Job | null = null;
  private buf = '';
  private timer?: NodeJS.Timeout;
  dead = false;

  constructor(private onFree: () => void) {
    this.proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(HOST_SCRIPT, 'utf16le').toString('base64')],
      { windowsHide: true },
    );
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (d: string) => this.onData(d));
    this.proc.stderr.on('data', () => undefined);
    this.proc.on('exit', () => {
      this.dead = true;
      if (this.busy) this.finish({ code: -1, stdout: this.buf, stderr: 'Hôte PowerShell arrêté' });
    });
  }

  run(job: Job): void {
    this.busy = job;
    this.buf = '';
    this.timer = setTimeout(() => {
      this.finish({ code: -1, stdout: this.buf, stderr: `[timeout après ${Math.round(job.timeoutMs / 1000)} s]` });
      this.kill();
    }, job.timeoutMs);
    this.proc.stdin.write(`${job.id} ${Buffer.from(job.script, 'utf8').toString('base64')}\n`);
  }

  private onData(d: string): void {
    if (!this.busy) return;
    this.buf += d;
    const m = this.buf.match(new RegExp(`@@END ${this.busy.id} (-?\\d+)\\r?\\n?$`));
    if (!m) return;
    const body = this.buf.slice(0, m.index);
    const errs: string[] = [];
    const out = body
      .split(/\r?\n/)
      .filter((l) => {
        if (l.startsWith('@@ERR ')) {
          errs.push(l.slice(6));
          return false;
        }
        return true;
      })
      .join('\n');
    this.finish({ code: Number(m[1]), stdout: out, stderr: errs.join('\n') });
  }

  private finish(r: HostResult): void {
    if (this.timer) clearTimeout(this.timer);
    const job = this.busy;
    this.busy = null;
    job?.resolve(r);
    this.onFree();
  }

  kill(): void {
    this.dead = true;
    this.proc.kill();
  }
}

export class PsPool {
  private hosts: Host[] = [];
  private queue: Job[] = [];
  private seq = 0;
  disposed = false;

  constructor(private size = 3) {}

  run(script: string, timeoutMs = 120_000): Promise<HostResult> {
    if (this.disposed) return Promise.resolve({ code: -1, stdout: '', stderr: 'Pool arrêté' });
    return new Promise((resolve) => {
      this.queue.push({ id: ++this.seq, script, timeoutMs, resolve });
      this.pump();
    });
  }

  private pump(): void {
    this.hosts = this.hosts.filter((h) => !h.dead);
    while (this.queue.length) {
      let h = this.hosts.find((x) => !x.busy);
      if (!h && this.hosts.length < this.size) {
        h = new Host(() => this.pump());
        this.hosts.push(h);
      }
      if (!h) return;
      h.run(this.queue.shift()!);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const h of this.hosts) h.kill();
    this.hosts = [];
    for (const j of this.queue.splice(0)) j.resolve({ code: -1, stdout: '', stderr: 'Pool arrêté' });
  }
}

let pool: PsPool | null = null;

export function psPool(): PsPool {
  pool ??= new PsPool(Number(process.env.UPKEEP_PS_HOSTS) || 3);
  return pool;
}

export function disposePsPool(): void {
  pool?.dispose();
  pool = null;
}
