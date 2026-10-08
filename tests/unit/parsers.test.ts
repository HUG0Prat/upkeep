import { describe, expect, it } from 'vitest';
import { parseWingetShow, parseWingetTable, wingetDetails } from '../../electron/providers/winget';
import { parseCargoList, parseDotnetTools } from '../../electron/providers/devtools';
import { dockerHubRef, parseCodeExtensions } from '../../electron/providers/apps';
import { parseUpgradable, parseWslVersion } from '../../electron/providers/wsl';
import { asusBiosVersion, asusModelCode, parseDellReport, parseHpReport } from '../../electron/providers/oem';
import { nvidiaVersion } from '../../electron/providers/gpu';
import { cleanLines } from '../../electron/lib/exec';
import { parseWingetSearch } from '../../electron/lib/inventory';
import { cleanQuery, parseChocoSearch } from '../../electron/lib/packageSearch';

const WINGET_FR = [
  '   - \r   \\ \r',
  'Nom                  ID                           Version  Disponible Source',
  '----------------------------------------------------------------------------',
  'Epic Online Services EpicGames.EpicOnlineServices 2.0.42.0 4.3.1      winget',
  'Git                  Git.Git                      2.50.0   2.51.1     winget',
  '2 mises à niveau disponibles.',
  '1 package(s) a(ont) des numéros de version qui ne peuvent pas être déterminés.',
].join('\n');

const WINGET_EN = [
  'Name               Id                    Version   Available Source',
  '--------------------------------------------------------------------',
  'Microsoft Edge     Microsoft.Edge        140.0.1   141.0.2   winget',
  '1 upgrades available.',
].join('\n');

describe('winget', () => {
  it('tableau en français (colonnes par position)', () => {
    const rows = parseWingetTable(WINGET_FR);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: 'EpicGames.EpicOnlineServices', currentVersion: '2.0.42.0', availableVersion: '4.3.1', source: 'winget' });
  });
  it('tableau en anglais', () => {
    expect(parseWingetTable(WINGET_EN)).toEqual([
      { id: 'Microsoft.Edge', name: 'Microsoft Edge', currentVersion: '140.0.1', availableVersion: '141.0.2', source: 'winget' },
    ]);
  });
  it('winget show (champs localisés, description multi-ligne)', () => {
    const text = [
      'Trouvé Git [Git.Git]',
      'Version: 2.51.1',
      'Éditeur: The Git Development Community',
      'Page d’accueil: https://gitforwindows.org',
      'Licence: GPL-2.0',
      'Description:',
      '  Git est un système de contrôle de version.',
      '  Libre et open source.',
      'URL des notes de publication: https://github.com/git-for-windows/git/releases',
      'Date de publication: 2026-09-30',
    ].join('\n');
    const d = wingetDetails(parseWingetShow(text));
    expect(d.publisher).toBe('The Git Development Community');
    expect(d.homepage).toBe('https://gitforwindows.org');
    expect(d.license).toBe('GPL-2.0');
    expect(d.description).toContain('Libre et open source.');
    expect(d.releaseNotesUrl).toContain('github.com');
    expect(d.publishedAt).toBe(Date.parse('2026-09-30'));
  });
});

describe('outils de développement', () => {
  it('cargo install --list (ignore les crates locales)', () => {
    const list = parseCargoList('ripgrep v14.1.0:\n    rg.exe\nmytool v0.1.0 (C:\\dev\\mytool):\n    mytool.exe\ncargo-update v22.1.1:\n    cargo-install-update.exe\n');
    expect(list.filter((c) => !c.local).map((c) => c.name)).toEqual(['ripgrep', 'cargo-update']);
  });
  it('dotnet tool list -g', () => {
    const text = 'Id du package      Version      Commandes\n-------------------------------------------\ndotnet-ef          9.0.1        dotnet-ef\n';
    expect(parseDotnetTools(text)).toEqual([{ id: 'dotnet-ef', version: '9.0.1' }]);
  });
  it('extensions VS Code', () => {
    expect(parseCodeExtensions('ms-python.python@2026.8.0\nvadimcn.vscode-lldb@1.11.8\nbruit\n')).toEqual([
      { id: 'ms-python.python', version: '2026.8.0' },
      { id: 'vadimcn.vscode-lldb', version: '1.11.8' },
    ]);
  });
  it('références Docker Hub', () => {
    expect(dockerHubRef('nginx')).toEqual({ ns: 'library', name: 'nginx' });
    expect(dockerHubRef('grafana/grafana')).toEqual({ ns: 'grafana', name: 'grafana' });
    expect(dockerHubRef('ghcr.io/org/app')).toBeNull();
  });
});

describe('WSL', () => {
  it('apt list --upgradable', () => {
    const r = parseUpgradable('apt', 'Listing...\ncurl/jammy-updates 7.81.0-1ubuntu1.16 amd64 [upgradable from: 7.81.0-1ubuntu1.15]\n');
    expect(r).toEqual([{ name: 'curl', latest: '7.81.0-1ubuntu1.16', current: '7.81.0-1ubuntu1.15' }]);
  });
  it('pacman -Qu', () => {
    expect(parseUpgradable('pacman', 'linux 6.9.1 -> 6.9.2\n')).toEqual([{ name: 'linux', current: '6.9.1', latest: '6.9.2' }]);
  });
  it('version de WSL localisée', () => {
    expect(parseWslVersion('Version WSL : 2.7.13.0\nVersion du noyau : 6.6.87.2-1')).toBe('2.7.13.0');
  });
});

describe('constructeurs', () => {
  it('rapport Dell', () => {
    const xml =
      '<updates><update><name>Dell BIOS</name><version>1.23.0</version><date>2026-09-01</date><urgency>Urgent</urgency><type>BIOS</type><category>BIOS</category><release>ABC12</release><bytes>12345</bytes></update></updates>';
    const [u] = parseDellReport(xml, '1.20.0');
    expect(u).toMatchObject({ id: 'ABC12', kind: 'firmware', currentVersion: '1.20.0', availableVersion: '1.23.0', severity: 'critical', security: true });
  });
  it('rapport HP Image Assistant', () => {
    const json = JSON.stringify({
      HPIA: { Recommendations: [{ TargetComponent: 'BIOS', TargetVersion: '01.10', ReferenceVersion: '01.12', Type: 'BIOS', RecommendationValue: 'Critical', SoftPaq: { Id: 'sp1', Name: 'HP BIOS', Size: 10 } }] },
    });
    expect(parseHpReport(json)[0]).toMatchObject({ id: 'sp1', kind: 'firmware', currentVersion: '01.10', availableVersion: '01.12', severity: 'critical' });
  });
  it('ASUS', () => {
    expect(asusModelCode('ROG Zephyrus G14 GA402RJ_GA402RJ')).toBe('GA402RJ');
    expect(asusBiosVersion('GA402RJ.319')).toBe('319');
  });
  it('NVIDIA : version Windows -> version pilote', () => {
    expect(nvidiaVersion('32.0.15.9144')).toBe('591.44');
    expect(nvidiaVersion('31.0.15.5222')).toBe('552.22');
  });
});

describe('sortie console', () => {
  it('retire les spinners', () => {
    expect(cleanLines('a\r   - \rb\nc')).toEqual(['b', 'c']);
  });
});

describe('recherche de paquets', () => {
  it('winget search avec colonne Correspondance et résultats tronqués', () => {
    const out = [
      'Nom                                ID                        Version       Correspondance',
      '-----------------------------------------------------------------------------------------',
      '7-Zip                              7zip.7zip                 26.04         Moniker: 7zip',
      'NanaZip                            M2Team.NanaZip            7.0.1843.0    Tag: 7zip',
      'Nom très long                      Contoso.Identifiant.Tron… 1.0           Tag: 7zip',
      '<entrées supplémentaires tronquées en raison de la limite de résultats>',
    ].join('\n');
    expect(parseWingetSearch(out)).toEqual([
      { name: '7-Zip', id: '7zip.7zip', version: '26.04' },
      { name: 'NanaZip', id: 'M2Team.NanaZip', version: '7.0.1843.0' },
    ]);
  });
  it('winget search msstore', () => {
    const out = ['Nom                          ID           Version', '-------------------------------------------------', 'Spotify - Music and Podcasts 9NCBCSZSJRSB Unknown'].join('\n');
    expect(parseWingetSearch(out)).toEqual([{ name: 'Spotify - Music and Podcasts', id: '9NCBCSZSJRSB', version: 'Unknown' }]);
  });
  it('choco search -r', () => {
    expect(parseChocoSearch('vlc|3.0.21\r\nvlc.install|3.0.21\r\n2 packages found.\r\n')).toEqual([
      { id: 'vlc', version: '3.0.21' },
      { id: 'vlc.install', version: '3.0.21' },
    ]);
  });
  it('requête : accepte les noms usuels, refuse le reste', () => {
    expect(cleanQuery('  notepad++  ')).toBe('notepad++');
    expect(cleanQuery('Visual Studio Code')).toBe('Visual Studio Code');
    expect(cleanQuery('éditeur')).toBe('éditeur');
    for (const bad of ['a', 'vlc; Remove-Item C:\\','$(calc)', "x' -or '1", 'a'.repeat(101)]) expect(() => cleanQuery(bad)).toThrow();
  });
});
