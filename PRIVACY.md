# Privacy policy

*Last updated: October 2026*

UpKeep runs entirely on your computer. **There is no account, no telemetry, no analytics and no UpKeep server.** The authors of UpKeep receive no data about you or your PC.

## Data stored on your PC

In `%APPDATA%\UpKeep\` (or `UpKeep-data\` next to the executable for the portable version):

| File | Content |
|---|---|
| `settings.json` | your settings, profiles, rules and ignored items |
| `history.json` | installation history and logs |
| `cache.json`, `detect.json`, `first-seen.json`, `notified.json` | results of the latest checks |
| `kev.json`, `nvd.json`, `eol-*.json` | cached copies of public security databases |
| `logs\` | application log (your user name and secrets such as tokens are redacted) |
| `downloads\` | installers downloaded by UpKeep (NVIDIA, Dell, HP, ASUS, "Download only") |

The optional administrator helper uses `C:\ProgramData\UpKeep\` (a temporary queue of operations).

To delete everything, uninstall UpKeep and remove these folders (see [SUPPORT.md](SUPPORT.md#resetting-upkeep)).

## Network connections

UpKeep only contacts **public** services, **without any identifier**, to learn the latest versions:

| Service | Purpose | What is sent |
|---|---|---|
| Windows Update (Microsoft) | drivers, firmware, Windows updates | the same as Windows Update itself |
| winget / Microsoft Store | packages | the same as the `winget` command |
| registry.npmjs.org, pypi.org, crates.io, api.nuget.org, PowerShell Gallery | latest versions of developer packages | package names |
| api.osv.dev | known vulnerabilities of developer packages | names and versions of the packages concerned |
| services.nvd.nist.gov | vulnerabilities of a few common desktop applications | vendor, product and version |
| cisa.gov (KEV catalog) | actively exploited vulnerabilities | nothing (catalog download) |
| endoflife.date | end-of-support dates | product name (Windows, Python…) |
| marketplace.visualstudio.com | VS Code extensions | identifiers of installed extensions |
| nvidia.com / geforce.com | graphics driver | GPU model |
| intel.com, asus.com, dl.dell.com, ftp.hp.com | vendor drivers and BIOS | PC model when relevant |
| Google, Microsoft Edge, Mozilla (release pages) | browsers | nothing |
| api.github.com | release notes, WSL versions | repository name |
| hub.docker.com | Docker images | image names |

None of these requests contains a personal or machine identifier. As with any Internet connection, these services see your IP address and are governed by their own privacy policies.

The security feeds (endoflife.date, CISA KEV, NVD) can be turned off individually in *Settings*, and every source can be disabled in *Sources*.

## Crash reports and diagnostics

Crash reports are stored **locally** (Electron `crashReporter` with uploading disabled). The *diagnostic report* (*Settings › Backup*) is a zip file with redacted logs, settings and history that only you decide to share — for example by attaching it to a GitHub issue, which makes it public.

## Children

UpKeep does not collect any data, including from children.

## Changes

Changes to this policy are recorded in the project history and mentioned in the [changelog](CHANGELOG.md).

## Questions

Ask in [GitHub Discussions](https://github.com/HUG0Prat/upkeep/discussions).
