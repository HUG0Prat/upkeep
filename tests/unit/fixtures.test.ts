import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseWingetShow, parseWingetTable, wingetDetails } from '../../electron/providers/winget';
import { parseCargoList, parseDotnetTools } from '../../electron/providers/devtools';
import { parseCodeExtensions } from '../../electron/providers/apps';
import { parseWslVersion } from '../../electron/providers/wsl';
import { mapWuDriver, mapWuSoftware } from '../../electron/providers/windowsUpdate';
import { parsePnputilDrivers, supersededDrivers } from '../../electron/lib/maintenance';
import { parseTpm } from '../../electron/lib/security';

const root = join(__dirname, '..', 'fixtures');
const machines = existsSync(root) ? readdirSync(root) : [];
const read = (m: string, f: string) => {
  const p = join(root, m, f);
  return existsSync(p) ? readFileSync(p, 'utf8').replace(/^﻿/, '') : undefined;
};

describe.each(machines)('sorties réelles : %s', (m) => {
  it('winget upgrade', () => {
    const text = read(m, 'winget-upgrade.txt');
    if (!text) return;
    const rows = parseWingetTable(text);
    for (const r of rows) {
      expect(r.id).toMatch(/^[\w.+-]+$/);
      expect(r.availableVersion).toBeTruthy();
    }
    const dataLines = text.split('\n').filter((l) => /\swinget\s*$/.test(l));
    expect(rows.length).toBe(dataLines.length);
  });

  it('winget show', () => {
    const text = read(m, 'winget-show.txt');
    if (!text) return;
    const d = wingetDetails(parseWingetShow(text));
    expect(d.homepage ?? d.publisher).toBeTruthy();
  });

  it('pnputil /enum-drivers', () => {
    const text = read(m, 'pnputil-enum-drivers.txt');
    if (!text) return;
    const list = parsePnputilDrivers(text);
    const published = (text.match(/oem\d+\.inf/gi) ?? []).length;
    expect(list.length).toBe(published);
    for (const d of list) expect(d.version).toMatch(/^\d+(\.\d+)+$/);
    expect(supersededDrivers(list).length).toBeLessThan(list.length);
  });

  it('tpmtool', () => {
    const text = read(m, 'tpmtool.txt');
    if (!text) return;
    const tpm = parseTpm(text);
    expect(tpm.present).toBeDefined();
  });

  it('cargo, dotnet, VS Code, WSL', () => {
    const cargo = read(m, 'cargo-install-list.txt');
    if (cargo) expect(parseCargoList(cargo).length).toBe((cargo.match(/^\S+ v[\d.]+/gm) ?? []).length);
    const dotnet = read(m, 'dotnet-tool-list.txt');
    if (dotnet) expect(() => parseDotnetTools(dotnet)).not.toThrow();
    const code = read(m, 'code-extensions.txt');
    if (code) expect(parseCodeExtensions(code).length).toBe(code.split('\n').filter((l) => l.includes('@')).length);
    const wsl = read(m, 'wsl-version.txt');
    if (wsl) expect(parseWslVersion(wsl)).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('Windows Update', () => {
    const text = read(m, 'windows-update.json');
    if (!text) return;
    const raw = [JSON.parse(text)].flat().filter(Boolean);
    for (const r of raw) {
      const item = r.Driver ? mapWuDriver(r) : mapWuSoftware(r);
      expect(item.key).toContain(r.Id);
      expect(item.requiresAdmin).toBe(true);
      if (r.Driver) expect(['driver', 'firmware']).toContain(item.kind);
      else expect(item.kind).toBe('system');
    }
  });
});
