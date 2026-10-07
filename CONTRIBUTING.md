# Contributing to UpKeep

Thank you for your interest in UpKeep! This guide explains how to report problems, propose changes and get them merged.

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Table of contents

- [Ways to contribute](#ways-to-contribute)
- [Development setup](#development-setup)
- [Architecture](#architecture)
- [Coding guidelines](#coding-guidelines)
- [Translations](#translations)
- [Adding a source](#adding-a-source)
- [Administrator operations](#administrator-operations)
- [Testing](#testing)
- [Testing on real hardware](#testing-on-real-hardware)
- [Pull request process](#pull-request-process)
- [Licensing of contributions](#licensing-of-contributions)
- [Releasing](#releasing)

## Ways to contribute

| You want to… | Do this |
|---|---|
| Report a bug | open a [bug report](https://github.com/HUG0Prat/upkeep/issues/new?template=bug_report.yml) with the diagnostic bundle |
| Suggest a feature | open a [feature request](https://github.com/HUG0Prat/upkeep/issues/new?template=feature_request.yml) |
| Ask a question | start a [discussion](https://github.com/HUG0Prat/upkeep/discussions) |
| Report a vulnerability | follow [SECURITY.md](SECURITY.md) — **never** in a public issue |
| Help with hardware we lack | share [fixtures from your PC](#testing-on-real-hardware) |
| Improve a translation | edit `shared/en.ts`, `shared/de.ts` or `shared/es.ts` |
| Write code | pick an issue labeled `good first issue` or `help wanted`, comment on it, then open a pull request |

For anything larger than a small fix, please open an issue first so we can agree on the approach before you invest time.

## Development setup

Prerequisites: Windows 10 or 11, [Node.js](https://nodejs.org/) 24, npm and Git. UpKeep relies on Windows PowerShell 5.1, Windows Update and WMI, so development happens on Windows.

```bash
git clone https://github.com/HUG0Prat/upkeep.git
cd REPO
npm ci
```

| Command | Purpose |
|---|---|
| `npm run start:demo` | run the app with fictional sources — nothing is installed or changed on your PC |
| `npm run dev` | run the real app with hot reload |
| `npx tsc --noEmit` | type check |
| `npm test` | unit tests (Vitest) |
| `npm run test:e2e` | build, then end-to-end and accessibility tests (Playwright + Electron) |
| `npm run package` | build the x64 installer and portable executable into `dist/` |
| `npm run dist` | build every package (installer, portable, MSI, MSIX, ZIP, 7z) for x64 and ARM64 into `dist/`; `--targets=nsis,zip` and `--arch=x64` narrow it down |

> [!TIP]
> Use `npm run start:demo` or *Settings › Installation › Simulation mode* while working on the install pipeline: nothing is actually installed.

## Architecture

```
┌──────────── Renderer (src/, React, sandboxed) ────────────┐
│ App.tsx · views/* · components/*                           │
│ window.api (preload) ── invoke / on('state') ───────────┐  │
└─────────────────────────────────────────────────────────┼──┘
                                                          │ IPC (sender checked)
┌──────────── Main process (electron/) ───────────────────┴──┐
│ main.ts         windows, tray, notifications, IPC, hardening│
│ engine/         UpdateEngine · JobQueue · RebootManager     │
│ providers/*.ts  one source per file                          │
│ lib/            exec + psHost, http, elevatedOps, helper,   │
│                 security, maintenance, logger, storage       │
└──────────┬──────────────────────────────┬───────────────────┘
           │ persistent PowerShell hosts  │ one UAC prompt (verified script) or SYSTEM helper
           ▼                              ▼
   winget, Windows Update (COM), WMI   closed list of administrator operations
```

- **`shared/`** holds what both sides use: types, pure logic (versions, filters, rules, profiles, settings migrations) and translations. It has no Electron or Node dependency and is the easiest place to test.
- **A check**: `UpdateEngine` queries enabled sources (at most `maxParallelChecks` at a time), enriches results (OSV, NVD, CISA KEV, first-seen date), merges duplicates and applies rules, quarantine and filters in `shared/logic.ts`, then pushes a lightweight state to the interface.
- **An install**: `JobQueue` batches requests made at the same time, checks disk space, closes apps if asked, runs unprivileged installs directly and gathers the administrator operations of every job into **one** elevated script. `@@JOB id START/END code` markers split the output per job.
- **PowerShell**: simple scripts run in a pool of persistent hosts (`lib/psHost.ts`); scripts that need streaming, cancellation, a custom environment or `exit` get a dedicated process.
- **Settings** are applied optimistically in the interface, then reconciled with the main process. Stored settings are migrated on load, so new options never break old files.

## Coding guidelines

- **Match the surrounding code**: 2-space indentation, single quotes, semicolons, lines up to ~160 characters, small focused functions.
- **Comments are written in French**, like the rest of the codebase. Explain *why*, not *what*.
- **Pure logic goes in `shared/`**, system access in `electron/lib/`, one source per file in `electron/providers/`.
- **No new runtime dependency** without discussion: every dependency ships to users and must have a permissive license (see `node scripts/third-party-notices.mjs`).
- **IPC**: declare new channels with the `h(…)` helper in `main.ts` (it validates the sender) and expose a specific function in `preload.ts` — never the raw `ipcRenderer`.
- **Network**: only public services, never an identifier of the user or the machine. Add every new endpoint to [PRIVACY.md](PRIVACY.md).
- **Accessibility**: every control needs an accessible name; dialogs use the shared `Modal`; colors come from the theme tokens in `src/styles.css`. The axe test must stay at zero violations.

## Translations

The French text **is** the translation key:

```ts
t('Mise à jour de « {name} » lancée', { name: item.name });
```

Add the English translation to `shared/en.ts` (required) and, if you can, German and Spanish to `shared/de.ts` and `shared/es.ts` — missing German or Spanish keys fall back to English. Keep placeholders (`{name}`, `{n}`…) identical in every language.

## Adding a source

A source implements `Provider` (`electron/providers/types.ts`):

```ts
// electron/providers/example.ts
import { run } from '../lib/exec';
import { compareVersions } from '../../shared/versions';
import { makeKey, type Provider } from './types';

export const exampleProvider: Provider = {
  id: 'example',                 // stable: used in settings and update keys
  name: 'Example',
  kind: 'package',               // package | system | driver | firmware
  group: 'Développement',        // section shown in "Sources"
  description: 'Paquets installés avec « example install »',

  async detect() {
    return (await run('example', ['--version'])).code === 0;
  },

  async check(ctx) {
    const res = await run('example', ['outdated', '--json'], { timeoutMs: ctx.timeoutMs });
    ctx.trace('example outdated', res.stdout); // shown in the source's diagnostic log
    const list = JSON.parse(res.stdout) as { name: string; current: string; latest: string }[];
    return list
      .filter((p) => compareVersions(p.latest, p.current) > 0)
      .map((p) => ({
        key: makeKey('example', p.name),
        id: p.name,
        providerId: 'example',
        name: p.name,
        kind: 'package',
        currentVersion: p.current,
        availableVersion: p.latest,
      }));
  },

  async install(items, ctx) {
    for (const it of items) {
      const r = await run('example', ['upgrade', it.id], { signal: ctx.signal, onLine: ctx.log });
      if (r.code !== 0) return { success: false };
    }
    return { success: true };
  },
};
```

Then register it in `realProviders` (`electron/providers/index.ts`). Useful optional members: `isApplicable(system)`, `defaultEnabled`, `experimental`, `elevatedOps()`, `download()`, `listVersions()`, `details()`, `setup`, `actions`, `osvEcosystem`, `note()`.

Put output parsing in a pure `parseXxx()` function and test it in `tests/unit/parsers.test.ts`. If the interface needs to show the source in demo mode, add a fictional version to `electron/providers/fake.ts`.

## Administrator operations

**Never build a PowerShell script from remote data and run it elevated.** Sources return typed `ElevatedOp` values; the library that executes them lives in `electron/lib/elevatedOps.ts`. To add an operation:

1. add its type to the `ElevatedOp` union;
2. add its PowerShell implementation to `OPS_LIBRARY`, validating **every** parameter with `Assert-Match` and a strict regular expression;
3. add its branch to the `switch ($o.op)` in `Invoke-UkOp`;
4. add an injection test to `tests/unit/security.test.ts` (quotes, `$()`, new lines, `;`…).

Changing `OPS_LIBRARY` changes the administrator helper's hash: users will be asked to reinstall the helper. This is intended. Pull requests touching elevated code get an extra security review — see [SECURITY.md](SECURITY.md#security-model).

## Testing

| Suite | Location | What it covers |
|---|---|---|
| Unit | `tests/unit/logic.test.ts` | versions, wildcard rules, error codes, duplicate merging, filters, profiles, time windows, install order |
| Unit | `tests/unit/parsers.test.ts` | parsing of winget, pip, npm, cargo, WSL and vendor tool output |
| Unit | `tests/unit/fixtures.test.ts` | parsing of **real** output recorded on actual PCs (`tests/fixtures/`) |
| Unit | `tests/unit/engine.test.ts` | engine with fake sources: quarantine, profiles, batching of elevated operations, cancellation, simulation, retry |
| Unit | `tests/unit/security.test.ts` | security feeds, link tokens, injection rejection, helper syntax, tamper detection of the elevated loader |
| End-to-end | `tests/e2e/app.spec.ts`, `onboarding.spec.ts` | main user flows in demo mode |
| Accessibility | `tests/e2e/a11y.spec.ts` | axe-core (WCAG 2.1 AA) on every page and theme, keyboard navigation, focus trap, 200 % zoom |
| Packaged app | `scripts/smoke-packaged.mjs` | CLI, window, Electron fuses of the built executable |

End-to-end tests run with `UPKEEP_FAKE=1` and a temporary data folder: they never touch your system. README screenshots are regenerated with `UPKEEP_SCREENSHOTS=1 npx playwright test screenshots`.

## Testing on real hardware

Most valuable contribution if you own a Dell, HP or ASUS PC, or use Docker:

```bash
powershell -ExecutionPolicy Bypass -File scripts/capture-fixtures.ps1
```

The script records the raw output of the tools present on your PC into `tests/fixtures/<manufacturer-model>/`. **Review the files before submitting them**: they contain device and software names (no personal data is collected, but check anyway). Then open a pull request adding the folder, ideally with a test in `tests/unit/fixtures.test.ts`.

## Pull request process

1. Fork the repository and create a branch from `main` (`fix/winget-truncated-names`, `feat/scoop-buckets`…).
2. Keep the change focused; unrelated refactoring belongs in a separate pull request.
3. Make sure these pass locally:
   ```bash
   npx tsc --noEmit
   npm test
   npm run test:e2e
   ```
4. Update the documentation and translations affected by your change.
5. Open the pull request and fill in the template. CI runs on Windows for every pull request.
6. A maintainer reviews it. Please respond to comments; we squash-merge once approved.

### Commit messages

Short imperative summary, optionally prefixed so that release notes can be generated:

| Prefix | Use |
|---|---|
| `feat:` / `ajout:` | new feature |
| `fix:` / `correctif:` | bug fix |
| `security:` / `sécurité:` | security fix or hardening |
| `perf:` | performance |
| anything else | listed under "Other" |

## Licensing of contributions

UpKeep is dual-licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE) and a [commercial license](LICENSE-COMMERCIAL.md). For this to remain possible, the maintainer must be able to distribute every contribution under both.

By submitting a contribution (code, documentation, translation, fixtures…), you certify that:

1. you wrote it, or otherwise have the right to submit it;
2. you grant the maintainer of UpKeep a perpetual, worldwide, non-exclusive, royalty-free, irrevocable license to use, reproduce, modify, sublicense and distribute your contribution as part of UpKeep, under the PolyForm Noncommercial License, under commercial licenses, and under any future license of the project;
3. you understand that your contribution and this grant are public and recorded in the project's history.

You keep the copyright of your contribution. To confirm, add a `Signed-off-by: Your Name <your@email>` line to your commits (`git commit -s`). Pull requests without it cannot be merged.

## Releasing

Maintainers only:

```bash
node scripts/release.mjs minor
```

The command previews the next version and the release notes generated from commit messages; add `--write` to update `package.json` and the in-app changelog, and `--commit` to create the commit and the `vX.Y.Z` tag. Then regenerate third-party notices and update [CHANGELOG.md](CHANGELOG.md):

```bash
node scripts/third-party-notices.mjs
```
