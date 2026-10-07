import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { UpdateEngine as Engine } from '../../electron/engine';
import type { InstallJob } from '../../shared/types';

const dataDir = mkdtempSync(join(tmpdir(), 'upkeep-engine-'));
process.env.UPKEEP_FAKE = '1';
process.env.UPKEEP_DATA = dataDir;

let engine: Engine;

async function waitJob(id: string, ms = 15_000): Promise<InstallJob> {
  const end = Date.now() + ms;
  for (;;) {
    const j = engine.getState().jobs.find((x) => x.id === id);
    if (j && !['queued', 'running'].includes(j.status)) return j;
    if (Date.now() > end) throw new Error(`tâche ${id} toujours en cours`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeAll(async () => {
  const { UpdateEngine } = await import('../../electron/engine');
  engine = new UpdateEngine();
  await engine.init();
  await engine.checkAll();
}, 60_000);

afterAll(async () => {
  engine.dispose();
  const { disposePsPool } = await import('../../electron/lib/psHost');
  disposePsPool();
  rmSync(dataDir, { recursive: true, force: true });
});

describe('moteur', () => {
  it('filtre quarantaine et périphériques absents', () => {
    const names = engine.visibleUpdates().map((u) => u.name);
    expect(names).toContain('Mozilla Firefox');
    expect(names.some((n) => n.includes('VLC'))).toBe(false);
    expect(names.some((n) => n.includes('Razer'))).toBe(false);
    const st = engine.getState();
    expect(st.hiddenQuarantine).toBe(1);
    expect(st.hiddenAbsent).toBe(1);
  });

  it('applique le profil actif', () => {
    engine.setActiveProfile('game');
    expect(engine.eff.notifications).toBe(false);
    expect(engine.eff.intervalMinutes).toBe(720);
    engine.setActiveProfile('default');
    expect(engine.eff.notifications).toBe(true);
  });

  it('installe et revérifie la source', async () => {
    const [job] = engine.install(['fake-pkg:Git.Git']);
    const done = await waitJob(job.id);
    expect(done.status).toBe('success');
    expect(done.previousVersions?.['fake-pkg:Git.Git']).toBe('2.50.0');
    await new Promise((r) => setTimeout(r, 800));
    expect(engine.visibleUpdates().some((u) => u.id === 'Git.Git')).toBe(false);
  });

  it('mode simulation : rien n’est installé', async () => {
    engine.updateSettings({ simulateInstalls: true });
    const [job] = engine.install(['fake-pkg:Mozilla.Firefox']);
    const done = await waitJob(job.id);
    expect(done.simulated).toBe(true);
    expect(done.status).toBe('success');
    expect(engine.jobLog(job.id).join('\n')).toContain('simulation');
    expect(engine.visibleUpdates().some((u) => u.id === 'Mozilla.Firefox')).toBe(true);
    engine.updateSettings({ simulateInstalls: false });
  });

  it('annule une tâche en attente', async () => {
    engine.updateSettings({ maxParallelJobs: 1 });
    const [a] = engine.install(['fake-sys:kb1']);
    const [b] = engine.install(['fake-drv:intel-wifi']);
    engine.cancelJob(b.id);
    expect(engine.getState().jobs.find((j) => j.id === b.id)?.status).toBe('cancelled');
    await waitJob(a.id);
    engine.updateSettings({ maxParallelJobs: 2 });
  });

  it('regroupe les opérations administrateur dans un seul lot', async () => {
    const batches: { id: string; ops: { op: string }[] }[][] = [];
    engine.queue.elevatedRunner = async (jobs, opts) => {
      batches.push(jobs);
      for (const j of jobs) {
        opts.onLine(`@@JOB ${j.id} START`);
        opts.onLine(`ops : ${j.ops.map((o) => o.op).join(', ')}`);
        opts.onLine(`@@JOB ${j.id} END 0`);
      }
      return { code: 0, stdout: '', stderr: '' };
    };
    const j1 = engine.runElevatedTask('unhide', 'fake-drv', [], [{ op: 'wu-unhide', ids: ['00000000-0000-0000-0000-000000000000'] }]);
    const j2 = engine.runElevatedTask('cleanup', 'cleanup', [], [{ op: 'cleanup-wu-cache' }]);
    const [d1, d2] = await Promise.all([waitJob(j1.id), waitJob(j2.id)]);
    expect(d1.status).toBe('success');
    expect(d2.status).toBe('success');
    expect(batches.length).toBe(1);
    expect(batches[0].flatMap((j) => j.ops.map((o) => o.op))).not.toContain('restore-point');
  });

  it('relance une tâche annulée', async () => {
    const cancelled = engine.getState().jobs.find((j) => j.status === 'cancelled' && j.items.length);
    expect(cancelled).toBeDefined();
    const [retry] = engine.retryJob(cancelled!.id);
    expect((await waitJob(retry.id)).status).toBe('success');
  });

  it('résumé hebdomadaire', () => {
    const w = engine.weeklySummary();
    expect(w.installed.package).toBeGreaterThanOrEqual(1);
    expect(w.to - w.from).toBe(7 * 86_400_000);
  });
});
