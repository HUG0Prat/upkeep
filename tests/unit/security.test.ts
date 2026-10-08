import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { annotateExploited, cpeFor, eolStatus, matchCycle, newerWindowsCycle, parseTpm, windowsCycle } from '../../electron/lib/security';
import { createLinkToken, parseLink } from '../../electron/lib/links';
import { opsScript, OPS_LIBRARY } from '../../electron/lib/elevatedOps';
import { HELPER_PS1 } from '../../electron/lib/helper';
import { githubRepo } from '../../electron/lib/registries';
import { isIntelXe, parseIntelGraphicsVersion } from '../../electron/providers/gpu';
import type { UpdateItem } from '../../shared/types';

const now = Date.parse('2026-10-07T12:00:00Z');

describe('fins de support', () => {
  it('statut', () => {
    expect(eolStatus('2026-01-01', now)).toBe('eol');
    expect(eolStatus('2027-01-15', now)).toBe('soon');
    expect(eolStatus('2029-01-01', now)).toBe('ok');
    expect(eolStatus(false, now)).toBe('ok');
    expect(eolStatus(true, now)).toBe('eol');
  });
  it('cycle Windows', () => {
    expect(windowsCycle({ DisplayVersion: '26H2', EditionID: 'Professional', CurrentBuild: '26300', UBR: 1 })).toBe('11-26h2-w');
    expect(windowsCycle({ DisplayVersion: '22H2', EditionID: 'Enterprise', CurrentBuild: '19045', UBR: 1 })).toBe('10-22h2-e');
  });
  it('mise à jour de fonctionnalités', () => {
    const cycles = [
      { cycle: '11-26h2-w', releaseDate: '2026-09-29', eol: '2028-10-10', latest: '10.0.26300' },
      { cycle: '11-26h1-w', releaseDate: '2026-02-10', eol: '2028-03-14', latest: '10.0.28000' },
      { cycle: '11-25h2-w', releaseDate: '2025-09-30', eol: '2027-10-12', latest: '10.0.26200' },
      { cycle: '11-24h2-e-lts', releaseDate: '2024-10-01', eol: '2034-10-10', latest: '10.0.26100' },
    ];
    expect(newerWindowsCycle(cycles, '11-25h2-w')?.cycle).toBe('11-26h2-w');
    expect(newerWindowsCycle(cycles, '11-26h2-w')).toBeUndefined();
  });
  it('cycle d’un environnement', () => {
    const c = [{ cycle: '3.14', eol: '2030-10-31' }, { cycle: '3.11', eol: '2027-10-31' }, { cycle: '24', eol: '2028-04-30' }];
    expect(matchCycle(c, '3.11')?.cycle).toBe('3.11');
    expect(matchCycle(c, '24.19.0')?.cycle).toBe('24');
  });
});

describe('failles exploitées et CPE', () => {
  it('marque les mises à jour qui corrigent une CVE du catalogue KEV', () => {
    const items: UpdateItem[] = [
      { key: 'a', providerId: 'p', kind: 'system', id: 'a', name: 'KB1', cves: ['CVE-2026-1'] },
      { key: 'b', providerId: 'p', kind: 'system', id: 'b', name: 'KB2', cves: ['CVE-2026-2'] },
    ];
    expect(annotateExploited(items, [{ cveID: 'CVE-2026-1', vendorProject: 'x', product: 'y', dateAdded: '2026-10-01' }])).toBe(1);
    expect(items[0].exploited).toBe(true);
    expect(items[0].severity).toBe('critical');
    expect(items[1].exploited).toBeUndefined();
  });
  it('correspondance CPE', () => {
    expect(cpeFor('7-Zip 25.01 (x64)')).toBe('7-zip:7-zip');
    expect(cpeFor('VLC media player')).toBe('videolan:vlc_media_player');
    expect(cpeFor('Logiciel inconnu')).toBeUndefined();
  });
  it('TPM (sortie localisée et mal décodée)', () => {
    expect(parseTpm('-TPM pr\uFFFDsent\uFFFD: Vrai\n-Version du TPM\uFFFD: 2.0')).toEqual({ present: true, version: '2.0' });
    expect(parseTpm('-TPM Present: False')).toEqual({ present: false, version: undefined });
  });
});

describe('liens des notifications', () => {
  it('jeton à usage unique', () => {
    const token = createLinkToken([{ key: 'winget:Git.Git', availableVersion: '2.51' }]);
    const url = `upkeep://action/install?token=${token}`;
    expect(parseLink(url)).toMatchObject({ kind: 'action', action: 'install', keys: ['winget:Git.Git'] });
    expect(parseLink(url)).toBeNull();
  });
  it('refuse les liens forgés', () => {
    expect(parseLink('upkeep://action/install?token=deadbeef')).toBeNull();
    expect(parseLink('upkeep://action/format-c?token=x')).toBeNull();
    expect(parseLink('https://exemple.org')).toBeNull();
    expect(parseLink('upkeep://open/x%20y')).toEqual({ kind: 'open', page: 'updates' });
  });
});

describe('divers', () => {
  it('dépôt GitHub', () => {
    expect(githubRepo('https://github.com/git-for-windows/git/releases')).toBe('git-for-windows/git');
    expect(githubRepo('https://exemple.org')).toBeUndefined();
  });
  it('pilote graphique Intel', () => {
    expect(isIntelXe('Intel(R) UHD Graphics')).toBe(true);
    expect(isIntelXe('Intel(R) HD Graphics 520')).toBe(false);
    expect(parseIntelGraphicsVersion('<p>32.0.101.6733</p><span>32.0.101.9034</span>')).toBe('32.0.101.9034');
  });
});

describe.runIf(process.platform === 'win32')('opérations administrateur', () => {
  const dir = mkdtempSync(join(tmpdir(), 'upkeep-ops-'));
  const runPs = (script: string) => {
    const f = join(dir, `s${Math.random().toString(36).slice(2)}.ps1`);
    writeFileSync(f, '\ufeff' + script, 'utf8');
    return spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', f], { encoding: 'utf8' });
  };
  it('syntaxe de la bibliothèque et de l’assistant', () => {
    for (const script of [OPS_LIBRARY, HELPER_PS1]) {
      const f = join(dir, 'parse.ps1');
      writeFileSync(f, '\ufeff' + script, 'utf8');
      const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', `$e=$null; [void][Management.Automation.Language.Parser]::ParseFile('${f}',[ref]$null,[ref]$e); $e.Count`], {
        encoding: 'utf8',
      });
      expect(r.stdout.trim()).toBe('0');
    }
  }, 60_000);
  it('refuse les paramètres hors format', () => {
    const r = runPs(
      opsScript([
        { id: 'a', ops: [{ op: 'wu-unhide', ids: ['pas-un-guid'] }] },
        { id: 'b', ops: [{ op: 'choco-upgrade', id: 'x; Remove-Item C:\\' }] },
        { id: 'c', ops: [{ op: 'driver-delete', inf: '..\\..\\windows.inf' }] },
        { id: 'd', ops: [{ op: 'simulate', text: 'ok' }] },
      ]),
    );
    expect(r.stdout).toMatch(/@@JOB a END 1/);
    expect(r.stdout).toMatch(/@@JOB b END 1/);
    expect(r.stdout).toMatch(/@@JOB c END 1/);
    expect(r.stdout).toMatch(/@@JOB d END 0/);
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);
});

describe.runIf(process.platform === 'win32')('chargeur élevé vérifié (mode UAC)', () => {
  it('exécute le script intact et refuse un script modifié', async () => {
    const { verifiedLoader, wrapElevatedScript } = await import('../../electron/lib/exec');
    const { readFileSync } = await import('node:fs');
    const dir = mkdtempSync(join(tmpdir(), 'upkeep-loader-'));
    const script = join(dir, 'job.ps1');
    const log = join(dir, 'out.log');
    const body = wrapElevatedScript('"bonjour depuis le script"; $global:JobExitCode = 5', log);
    writeFileSync(script, '\ufeff' + body, 'utf8');
    const loader = verifiedLoader(script, body);
    const ok = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', loader], { encoding: 'utf8' });
    expect(ok.status).toBe(5);
    expect(readFileSync(log, 'utf8')).toContain('bonjour depuis le script');
    writeFileSync(script, '\ufeff' + body.replace('bonjour', 'piratage'), 'utf8');
    const bad = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', loader], { encoding: 'utf8' });
    expect(bad.status).toBe(97);
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);
});
