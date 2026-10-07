import { readFileSync, writeFileSync } from 'node:fs';

const version = (process.argv[2] ?? JSON.parse(readFileSync('package.json', 'utf8')).version).replace(/^v/, '');
const out = process.argv[3];
const repo = `https://github.com/${process.env.GITHUB_REPOSITORY ?? 'HUG0Prat/upkeep'}/blob/main`;
const changelog = readFileSync('CHANGELOG.md', 'utf8').replace(/\r\n/g, '\n');
const start = changelog.indexOf(`## [${version}]`);
if (start < 0) {
  console.error(`Version ${version} absente de CHANGELOG.md`);
  process.exit(1);
}
const next = changelog.indexOf('\n## [', start + 1);
const links = changelog.indexOf('\n[Unreleased]:', start);
const end = Math.min(...[next, links].filter((i) => i > 0), changelog.length);
const section = changelog.slice(changelog.indexOf('\n', start) + 1, end).trim();
const notes = `${section}

## Downloads

| Package | x64 | ARM64 |
|---|---|---|
| Installer (recommended) | \`UpKeep-${version}-x64-setup.exe\` | \`UpKeep-${version}-arm64-setup.exe\` |
| Portable | \`UpKeep-${version}-x64-portable.exe\` | \`UpKeep-${version}-arm64-portable.exe\` |
| MSI (Intune, Group Policy) | \`UpKeep-${version}-x64.msi\` | \`UpKeep-${version}-arm64.msi\` |
| MSIX / AppX (sideloading) | \`UpKeep-${version}-x64.appx\` | \`UpKeep-${version}-arm64.appx\` |
| ZIP / 7z | \`UpKeep-${version}-x64.zip\` / \`.7z\` | \`UpKeep-${version}-arm64.zip\` / \`.7z\` |

Verify your download with \`SHA256SUMS.txt\` (\`Get-FileHash <file> -Algorithm SHA256\`).

> [!NOTE]
> The binaries are not code-signed yet: Windows SmartScreen may show a warning on first launch (*More info › Run anyway*).

UpKeep is free for noncommercial use under the [PolyForm Noncommercial License 1.0.0](${repo}/LICENSE). Commercial use requires a [commercial license](${repo}/LICENSE-COMMERCIAL.md).
`;
if (out) writeFileSync(out, notes);
else process.stdout.write(notes);
