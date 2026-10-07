import { randomUUID } from 'node:crypto';
import { statfs } from 'node:fs/promises';
import { powershellElevated, type ExecResult } from '../lib/exec';
import { opsScript, type ElevatedOp, type OpsJob } from '../lib/elevatedOps';
import { runOpsViaHelper } from '../lib/helper';
import { REBOOT_MARK, type InstallContext } from '../providers/types';
import { parseProgress } from '../../shared/logic';
import { explainError, isNetworkError } from '../../shared/errorCodes';
import { t } from '../../shared/i18n';
import type { InstallJob, Settings, UpdateItem } from '../../shared/types';

const MAX_LOG_LINES = 2000;

export type Runner = (ctx: InstallContext) => Promise<{ success: boolean; rebootRequired?: boolean }>;

export interface QueuedJob {
  job: InstallJob;
  runner?: Runner;
  elevated?: (ctx: InstallContext) => Promise<ElevatedOp[]>;
  downloadOnly?: boolean;
}

export type ElevatedRunner = (jobs: OpsJob[], opts: { onLine: (l: string) => void; timeoutMs: number }) => Promise<ExecResult>;

export interface QueueHost {
  settings(): Settings;
  jobs(): InstallJob[];
  useHelper(): boolean;
  changed(): void;
  jobDone(job: InstallJob, q: QueuedJob): void;
}

export async function freeSpace(drive = process.env.SystemDrive ?? 'C:'): Promise<number | undefined> {
  try {
    const s = await statfs(`${drive}\\`);
    return s.bavail * s.bsize;
  } catch {
    return undefined;
  }
}

export class JobQueue {
  private queue: QueuedJob[] = [];
  private running = new Map<string, { abort: AbortController; lane: string }>();
  elevatedRunner: ElevatedRunner = (jobs, opts) =>
    this.host.useHelper() ? runOpsViaHelper(jobs, opts) : powershellElevated(opsScript(jobs), opts);

  constructor(private host: QueueHost) {}

  get pending(): QueuedJob[] {
    return this.queue;
  }

  busyKeys(): Set<string> {
    return new Set([...this.queue.map((q) => q.job), ...this.host.jobs().filter((j) => j.status === 'running')].flatMap((j) => j.items.map((i) => i.key)));
  }

  private processScheduled = false;

  enqueue(q: QueuedJob): void {
    this.queue.push(q);
    this.host.changed();
    if (this.processScheduled) return;
    this.processScheduled = true;
    setTimeout(() => {
      this.processScheduled = false;
      void this.process();
    }, 0);
  }

  cancel(id: string): void {
    const qi = this.queue.findIndex((q) => q.job.id === id);
    if (qi >= 0) {
      const [q] = this.queue.splice(qi, 1);
      q.job.status = 'cancelled';
      q.job.finishedAt = Date.now();
      this.host.jobDone(q.job, q);
      return;
    }
    const r = this.running.get(id);
    if (r) {
      r.abort.abort();
      const job = this.host.jobs().find((j) => j.id === id);
      job?.log.push(job.elevated ? t('Interruption demandée : le processus administrateur peut terminer l’étape en cours.') : t('Interruption demandée…'));
      this.host.changed();
    }
  }

  move(id: string, delta: -1 | 1): void {
    const i = this.queue.findIndex((q) => q.job.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= this.queue.length) return;
    [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
    const order = new Map(this.queue.map((q, idx) => [q.job.id, idx]));
    this.host.jobs().sort((a, b) => (order.has(a.id) && order.has(b.id) ? order.get(a.id)! - order.get(b.id)! : 0));
    this.host.changed();
  }

  makeCtx(job: InstallJob, abort: AbortController, downloadOnly?: boolean): InstallContext {
    return {
      settings: this.host.settings(),
      signal: abort.signal,
      downloadOnly,
      log: (line: string) => {
        job.log.push(line);
        if (job.log.length > MAX_LOG_LINES) job.log.splice(0, job.log.length - MAX_LOG_LINES);
        const pct = parseProgress(line);
        if (pct !== undefined) job.progress = pct;
        this.host.changed();
      },
      progress: (pct: number) => {
        job.progress = pct;
        this.host.changed();
      },
    };
  }

  async process(): Promise<void> {
    const max = Math.max(1, this.host.settings().maxParallelJobs);
    while (this.queue.length && this.running.size < max) {
      const lanes = new Set([...this.running.values()].map((r) => r.lane));
      const idx = this.queue.findIndex((q) => !lanes.has(q.elevated ? 'admin' : q.job.providerId));
      if (idx < 0) return;
      const q = this.queue[idx];
      if (q.elevated) {
        const batch = this.queue.filter((x) => x.elevated);
        this.queue = this.queue.filter((x) => !x.elevated);
        void this.runElevatedBatch(batch);
      } else {
        this.queue.splice(idx, 1);
        void this.runJob(q);
      }
    }
  }

  private start(job: InstallJob, lane: string): AbortController {
    const abort = new AbortController();
    this.running.set(job.id, { abort, lane });
    job.status = 'running';
    job.startedAt = Date.now();
    this.host.changed();
    return abort;
  }

  private async checkSpace(items: UpdateItem[]): Promise<void> {
    const need = items.reduce((s, i) => s + (i.sizeBytes ?? 0), 0);
    if (!need) return;
    const free = await freeSpace();
    if (free !== undefined && free < need * 2 + 1024 ** 3) {
      throw new Error(t('Espace disque insuffisant : {free} Go libres, environ {need} Go nécessaires.', { free: (free / 1024 ** 3).toFixed(1), need: ((need * 2) / 1024 ** 3 + 1).toFixed(1) }));
    }
  }

  private async runJob(q: QueuedJob): Promise<void> {
    const { job } = q;
    const abort = this.start(job, job.providerId);
    const ctx = this.makeCtx(job, abort, q.downloadOnly);
    try {
      if (job.simulated) {
        ctx.log(t('[simulation] {type} via {provider} :', { type: job.type, provider: job.providerId }));
        for (const i of job.items) ctx.log(`  • ${i.name} ${i.currentVersion ?? ''} → ${i.targetVersion ?? i.availableVersion ?? ''}`);
        ctx.log(t('[simulation] aucune commande n’a été exécutée.'));
        job.status = 'success';
      } else {
        await this.checkSpace(job.items);
        const res = await q.runner!(ctx);
        job.rebootRequired = res.rebootRequired || (job.type === 'install' && job.items.some((i) => i.requiresReboot));
        job.status = abort.signal.aborted ? 'cancelled' : res.success ? 'success' : 'failed';
      }
    } catch (err) {
      ctx.log(`ERREUR : ${err instanceof Error ? err.message : String(err)}`);
      job.status = abort.signal.aborted ? 'cancelled' : 'failed';
    }
    this.finish(job, q);
  }

  private async runElevatedBatch(batch: QueuedJob[]): Promise<void> {
    const settings = this.host.settings();
    const ctrls = new Map(batch.map((q) => [q.job.id, this.start(q.job, 'admin')]));
    const ctxs = new Map(batch.map((q) => [q.job.id, this.makeCtx(q.job, ctrls.get(q.job.id)!, q.downloadOnly)]));
    const jobs: OpsJob[] = [];
    const ready: QueuedJob[] = [];
    for (const q of batch) {
      const ctx = ctxs.get(q.job.id)!;
      try {
        if (!q.downloadOnly) await this.checkSpace(q.job.items);
        let ops = await q.elevated!(ctx);
        if (q.job.simulated) ops = ops.map((o) => ({ op: 'simulate', text: JSON.stringify(o) }) as ElevatedOp);
        jobs.push({ id: q.job.id, ops });
        ready.push(q);
      } catch (err) {
        ctx.log(`ERREUR : ${err instanceof Error ? err.message : String(err)}`);
        q.job.status = 'failed';
        this.finish(q.job, q);
      }
    }
    if (!ready.length) return;

    const items = ready.filter((q) => !q.downloadOnly && ['install', 'rollback', 'driver-rollback'].includes(q.job.type)).flatMap((q) => q.job.items);
    const prelude: ElevatedOp[] = [];
    const simulated = ready.every((q) => q.job.simulated);
    if (settings.restorePoint && items.some((i) => i.kind !== 'package')) prelude.push({ op: 'restore-point' });
    if (items.some((i) => i.kind === 'firmware')) {
      prelude.push({ op: 'security-state' });
      if (settings.suspendBitLocker) prelude.push({ op: 'bitlocker-suspend' });
    }
    if (prelude.length) {
      const pre = simulated ? prelude.map((o) => ({ op: 'simulate', text: JSON.stringify(o) }) as ElevatedOp) : prelude;
      jobs.unshift({ id: 'prelude', ops: pre });
    }

    let current: string | null = null;
    const exitCodes = new Map<string, number>();
    const onLine = (line: string) => {
      const m = line.match(/^@@JOB (\S+) (START|END)(?: (-?\d+))?/);
      if (m) {
        if (m[2] === 'START') current = m[1];
        else {
          exitCodes.set(m[1], Number(m[3] ?? 0));
          current = null;
        }
        return;
      }
      const target = current && ctxs.get(current);
      if (target) target.log(line);
      else for (const q of ready) ctxs.get(q.job.id)!.log(line);
    };
    let res: ExecResult;
    try {
      res = await this.elevatedRunner(jobs, { onLine, timeoutMs: 6 * 3600_000 });
    } catch (err) {
      res = { code: -1, stdout: '', stderr: err instanceof Error ? err.message : String(err) };
    }
    for (const q of ready) {
      const log = q.job.log.join('\n');
      const code = exitCodes.get(q.job.id);
      if (code === undefined) {
        q.job.status = ctrls.get(q.job.id)!.signal.aborted ? 'cancelled' : 'failed';
        if (res.stderr) ctxs.get(q.job.id)!.log(res.stderr.trim());
      } else {
        q.job.status = code === 0 ? 'success' : 'failed';
      }
      q.job.rebootRequired =
        !q.job.simulated && !q.downloadOnly && (log.includes(REBOOT_MARK) || (q.job.status === 'success' && q.job.type === 'install' && q.job.items.some((i) => i.requiresReboot)));
      this.finish(q.job, q);
    }
  }

  private finish(job: InstallJob, q: QueuedJob): void {
    job.finishedAt = Date.now();
    if (job.status === 'success') job.progress = 100;
    this.running.delete(job.id);
    if (job.status === 'failed') job.errorHint = explainError(job.log);
    if (job.status === 'failed' && this.host.settings().retryNetworkErrors && (job.attempt ?? 1) < 2 && isNetworkError(job.log)) {
      job.log.push(t('Erreur réseau : nouvelle tentative dans 30 s.'));
      setTimeout(() => {
        const retry: QueuedJob = {
          ...q,
          job: { ...job, id: randomUUID(), status: 'queued', log: [], attempt: (job.attempt ?? 1) + 1, queuedAt: Date.now(), startedAt: undefined, finishedAt: undefined, errorHint: undefined },
        };
        this.host.jobs().unshift(retry.job);
        this.enqueue(retry);
      }, 30_000);
    }
    this.host.jobDone(job, q);
    void this.process();
  }
}
