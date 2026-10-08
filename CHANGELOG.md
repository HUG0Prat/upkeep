# Changelog

All notable changes to UpKeep are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.1] - 2026-10-08

### Fixed

- Lenovo (LSUClient): update versions were sent to the interface as objects, which left the window blank (React error #31). Versions are now read as text, and unreadable versions (`0.0.0.0`) are shown as unknown. Cached results affected by the bug are discarded on startup.

### Changed

- A rendering error anywhere in the interface, including the compact tray window, now shows an error message with *Retry* and *Reload interface* instead of a blank window.

## [1.0.0] - 2026-10-07

First public release.

### Sources

- **Packages**: WinGet (through the Microsoft.WinGet.Client module when available), Scoop, Chocolatey.
- **Applications**: Microsoft Store, Chrome, Edge, Firefox, Visual Studio Code extensions, Docker images.
- **Windows**: Windows Update (cumulative, Defender, .NET, Office…), Windows feature updates, WSL.
- **Drivers and firmware**: Windows Update drivers and firmware (UEFI/BIOS), NVIDIA Game Ready and Studio, Intel graphics and Intel DSA, AMD (information), Lenovo (LSUClient), Dell (Dell Command | Update), HP (HP Image Assistant), ASUS BIOS.
- **Development**: npm, pnpm, Yarn, Bun, pip, pipx, cargo, .NET tools, PowerShell Gallery, packages inside WSL distributions.
- Programs not tracked by any package manager can be linked to a winget package.

### Detection

- Reliable version comparison, pre-releases hidden by default, duplicates across sources merged.
- Drivers of absent devices detected, hidden and removable ("Forget"); optional Windows Update drivers distinguished.
- Per-source schedule, cache, retry and diagnostic log; checks on startup, on wake and when the network returns.
- Organization policies respected (WSUS, driver exclusion, Intune).

### Security

- Security page: end of support (endoflife.date), actively exploited vulnerabilities (CISA KEV), vulnerabilities of developer packages (OSV) and common desktop apps (NVD), and PC status (Defender, firewall, BitLocker, Secure Boot, TPM, UAC, SmartScreen).
- Administrator work restricted to a closed list of typed operations, batched into a single UAC prompt; the elevated script is verified in memory right before it runs.
- Optional administrator helper for prompt-free automatic installs, with hash verification before every use.
- Downloaded installers verified (SHA-256, Authenticode signature, expected publisher).
- Locked-down interface (sandbox, CSP, no navigation, sender-checked IPC) and hardened Electron fuses.

### Installation

- Restore point before drivers and Windows updates; battery, AC power, Secure Boot, TPM and BitLocker checks before firmware, with BitLocker suspended for one restart.
- Simulation mode, specific version, rollback, driver rollback, download only.
- Cancel, stop, reorder and parallel installs; closing and relaunching running apps; disk space check; network retry; resume of interrupted jobs.
- Flexible restart: now, at a given time, after a delay, after active hours, or not at all.

### Automation

- Automatic updates per source or package within a time window, never on metered connections, on low battery, in full screen, in games or in Focus mode.
- Quarantine of new releases, major version pinning, wildcard rules, profiles selectable at startup.
- Background checks through a Windows scheduled task; actionable notifications and a weekly summary.

### Interface

- Dashboard, global search (<kbd>Ctrl</kbd>+<kbd>K</kbd>), keyboard shortcuts, context menus, compact view and configurable columns.
- Inventory of installed software, hardware sheet, history with CSV export and monthly chart, maintenance page (superseded drivers, caches).
- Release notes since the installed version, undo "ignore", tray icon, mini window and taskbar badge.
- English, French, German and Spanish; light and dark themes; WCAG 2.1 AA checked automatically.
- Package list and settings export/import, portable version, command-line interface (`upkeep-cli`).

### Packages

- Guided multilingual installer (per-user or all users, folder, desktop shortcut), portable executable, MSI, MSIX/AppX, ZIP and 7z, for x64 and ARM64, with SHA-256 checksums.

[Unreleased]: https://github.com/HUG0Prat/upkeep/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/HUG0Prat/upkeep/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/HUG0Prat/upkeep/releases/tag/v1.0.0
