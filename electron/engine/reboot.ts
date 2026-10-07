import { uptime } from 'node:os';
import { run } from '../lib/exec';
import { activeHours } from '../lib/system';
import { loadJson, saveJson } from '../lib/storage';
import type { InstallJob, Settings } from '../../shared/types';

export class RebootManager {
  scheduled?: number;
  private dismissedAt = loadJson<number>('reboot-dismissed.json', 0);
  private lastReminder = 0;

  constructor(
    private fake: boolean,
    private onChange: () => void,
  ) {}

  isPending(jobs: InstallJob[]): boolean {
    const boot = Date.now() - uptime() * 1000;
    return jobs.some(
      (j) => j.status === 'success' && !j.simulated && j.rebootRequired && (j.finishedAt ?? 0) > boot && (j.finishedAt ?? 0) > this.dismissedAt,
    );
  }

  async schedule(delaySeconds: number): Promise<void> {
    const delay = Math.max(0, Math.min(Math.round(delaySeconds), 315_360_000));
    if (!this.fake) {
      await run('shutdown.exe', ['/a']);
      const res = await run('shutdown.exe', ['/r', '/t', String(delay), '/c', 'Redémarrage planifié par UpKeep pour finaliser des mises à jour.']);
      if (res.code !== 0) throw new Error(res.stderr.trim() || `shutdown.exe code ${res.code}`);
    }
    this.scheduled = Date.now() + delay * 1000;
    this.onChange();
  }

  async cancel(): Promise<void> {
    if (!this.fake) await run('shutdown.exe', ['/a']);
    this.scheduled = undefined;
    this.onChange();
  }

  dismiss(): void {
    this.dismissedAt = Date.now();
    saveJson('reboot-dismissed.json', this.dismissedAt);
    this.onChange();
  }

  async housekeeping(jobs: InstallJob[], eff: Settings, emit: (event: 'reboot-reminder' | 'reboot-scheduled', at?: number) => void): Promise<void> {
    if (!this.isPending(jobs) || this.scheduled) return;
    if (eff.autoReboot) {
      const { end } = await activeHours();
      const target = new Date();
      target.setHours(end, 0, 0, 0);
      if (target.getTime() <= Date.now()) target.setDate(target.getDate() + 1);
      await this.schedule((target.getTime() - Date.now()) / 1000).catch(() => undefined);
      emit('reboot-scheduled', this.scheduled);
      return;
    }
    const h = eff.rebootReminderHours;
    if (h > 0 && Date.now() - this.lastReminder >= h * 3600_000) {
      this.lastReminder = Date.now();
      if (this.lastReminder - this.dismissedAt > 60_000) emit('reboot-reminder');
    }
  }
}
