import { createInterface } from 'node:readline/promises';
import { providers, getProvider } from './providers';
import type { InstallContext } from './providers/types';
import { loadJson, saveJsonSync } from './lib/storage';
import { getSystemInfo, readUpdatePolicy } from './lib/system';
import { powershellElevated } from './lib/exec';
import { opsScript } from './lib/elevatedOps';
import { disposePsPool } from './lib/psHost';
import { effectiveSettings, filterUpdates, installOrder, mergeDuplicates, migrateSettings } from '../shared/logic';
import { resolveLang, setLang, t } from '../shared/i18n';
import type { Settings, UpdateItem } from '../shared/types';

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const json = has('--json');

function out(s: string): void {
  process.stdout.write(s + '\n');
}

function table(items: UpdateItem[]): void {
  if (!items.length) return out(t('Tout est à jour.'));
  const rows = items.map((i) => [i.key, i.name, i.currentVersion ?? '', i.availableVersion ?? '', i.security ? t('sécurité') : '']);
  const w = [0, 1, 2, 3, 4].map((c) => Math.min(48, Math.max(...rows.map((r) => r[c].length), 4)));
  for (const r of rows) out(r.map((v, c) => v.slice(0, w[c]).padEnd(w[c])).join('  '));
  out('');
  out(t('{n} mise(s) à jour', { n: items.length }));
}

async function main(): Promise<number> {
  if (has('--help') || !args.length) {
    out('UpKeep CLI\n\n  --check [--json]\n  --list [--json]\n  --install <source:id>...\n  --install-all [--yes]\n  --profile=<id>');
    return 0;
  }
  let settings = migrateSettings(loadJson<Partial<Settings>>('settings.json', {}));
  setLang(resolveLang(settings.language, Intl.DateTimeFormat().resolvedOptions().locale));
  const profile = args.find((a) => a.startsWith('--profile='))?.split('=')[1];
  if (profile) settings = { ...settings, activeProfile: profile };
  const eff = effectiveSettings(settings);
  const [system, policy] = await Promise.all([getSystemInfo(), readUpdatePolicy()]);
  const cache = loadJson<Record<string, { at: number; items: UpdateItem[] }>>('cache.json', {});

  const enabled = providers.filter((p) => eff.providers[p.id] ?? ((p.isApplicable?.(system) ?? true) && p.defaultEnabled !== false));

  if (has('--check')) {
    await Promise.all(
      enabled.map(async (p) => {
        if (!(await p.detect().catch(() => false))) return;
        try {
          const items = await p.check({ settings, system, policy, timeoutMs: 10 * 60_000, trace: () => undefined });
          cache[p.id] = { at: Date.now(), items };
          if (!json) process.stderr.write(`✔ ${p.name} (${items.length})\n`);
        } catch (err) {
          process.stderr.write(`✖ ${p.name} : ${err instanceof Error ? err.message : String(err)}\n`);
        }
      }),
    );
    saveJsonSync('cache.json', cache);
  }

  const raw = enabled.flatMap((p) => cache[p.id]?.items ?? []);
  const merged = mergeDuplicates(raw, providers.map((p) => p.id), (id) => getProvider(id)?.name ?? id);
  const { visible } = filterUpdates(merged, eff, { now: Date.now(), pendingRebootKeys: new Set() });

  if (has('--install') || has('--install-all')) {
    const keys = has('--install-all')
      ? visible.filter((u) => u.kind !== 'firmware').map((u) => u.key)
      : args.slice(args.indexOf('--install') + 1).filter((a) => !a.startsWith('--'));
    const items = visible.filter((u) => keys.includes(u.key)).sort(installOrder);
    if (!items.length) {
      out(t('Rien à installer.'));
      return 0;
    }
    table(items);
    if (!has('--yes')) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await rl.question(t('Installer ces mises à jour ? (o/N) '));
      rl.close();
      if (!/^[oy]/i.test(answer.trim())) return 0;
    }
    const ctrl = new AbortController();
    let ok = true;
    const byProvider = new Map<string, UpdateItem[]>();
    for (const i of items) byProvider.set(i.providerId, [...(byProvider.get(i.providerId) ?? []), i]);
    for (const [pid, list] of byProvider) {
      const p = getProvider(pid)!;
      const ctx: InstallContext = { settings, log: (l) => out(`  ${l}`), progress: () => undefined, signal: ctrl.signal };
      out(`▶ ${p.name}`);
      try {
        if (p.elevatedOps && (!p.install || list.some((i) => i.requiresAdmin))) {
          const ops = await p.elevatedOps(list, ctx);
          const res = await powershellElevated(opsScript([{ id: pid.replace(/[^\w-]/g, '-'), ops }]), { onLine: ctx.log });
          ok &&= res.code === 0 && !res.stdout.includes(' END 1');
        } else if (p.install) {
          ok &&= (await p.install(list, ctx)).success;
        }
      } catch (err) {
        out(`✖ ${err instanceof Error ? err.message : String(err)}`);
        ok = false;
      }
    }
    return ok ? 0 : 1;
  }

  if (json) out(JSON.stringify(visible, null, 2));
  else table(visible);
  return visible.length ? 10 : 0;
}

main()
  .then((code) => {
    disposePsPool();
    process.exit(code);
  })
  .catch((err) => {
    process.stderr.write(String(err instanceof Error ? err.stack : err) + '\n');
    process.exit(1);
  });
