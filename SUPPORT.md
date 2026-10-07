# Getting help

| Need | Where |
|---|---|
| How do I…? / general questions | [GitHub Discussions › Q&A](https://github.com/HUG0Prat/upkeep/discussions/categories/q-a) |
| Something is broken | [Bug report](https://github.com/HUG0Prat/upkeep/issues/new?template=bug_report.yml) |
| An idea | [Feature request](https://github.com/HUG0Prat/upkeep/issues/new?template=feature_request.yml) |
| A security vulnerability | privately, see [SECURITY.md](SECURITY.md) |
| Commercial license | [LICENSE-COMMERCIAL.md](LICENSE-COMMERCIAL.md) |

Before asking, please check the answers below and search existing issues.

## Collecting diagnostics

- **Diagnostic bundle**: *Settings › Backup › Diagnostic report › Create…* (or <kbd>Ctrl</kbd>+<kbd>K</kbd> › *Create a diagnostic report*). It produces a local zip with logs, crash reports and redacted settings and history. Nothing is sent automatically — attach it to your issue yourself.
- **Source log**: *Sources* › the source's card › *Log* shows the raw output of its last check.
- **Application log**: `%APPDATA%\UpKeep\logs\upkeep.log` (*Settings › Backup › UpKeep logs › Open folder*). Lines starting with `[perf]` show startup and per-source durations.

## Frequently asked questions

### Drivers show up for a device I never had (Razer, Logitech…)

Windows remembers every device that was ever plugged in — a borrowed mouse, a friend's headset — and keeps offering its drivers. UpKeep hides them by default (see "driver(s) for absent devices" above the list). **Forget** the device (in *Maintenance* or from the row's menu) to remove those offers for good. If it is plugged in again, Windows simply detects it again.

### No Windows Update drivers are offered

A policy of your organization, or the `ExcludeWUDriversInQualityUpdate` setting, excludes drivers from Windows Update. UpKeep respects it by default and says so in the source's note. On a personal PC you can turn off *Settings › General › Respect organization policies*.

### Checking takes a long time

Windows Update searches take 45 seconds to 2 minutes — that is Windows itself. Other sources appear in the meantime. Lower *Simultaneous checks* to reduce CPU load, and disable the sources you do not need.

### A source shows an error

1. Open its **Log** in *Sources*.
2. Check that the tool works in a terminal (`winget upgrade`, `npm outdated -g`…).
3. Enable *Retry a failed source once* if your connection is unstable.
4. Sources relying on vendor websites (NVIDIA, ASUS, Intel) can break when the vendor changes its site: disable the source until a fix is released, and please report it.

### winget: names are truncated or packages are missing

Without the **Microsoft.WinGet.Client** PowerShell module, UpKeep has to read winget's text output, which truncates long names. Use the *Install the Microsoft.WinGet.Client module* button on the winget card (no administrator rights needed).

### An installation failed

- Known error codes (winget, Windows Update, MSI) are explained in *Activity*.
- **Retry** in *Activity* runs the same job again.
- If the installer needs an application to be closed, add its process name in the package options (*Process to close*).
- "Invalid digital signature or unexpected publisher": the download was blocked on purpose. Do not bypass this protection; try again later or install from the vendor's website.

### The UAC prompt does not appear / the job stays "running"

The UAC prompt may be hidden behind another window — look for a flashing icon in the taskbar. If you decline it, the job fails. **Stop** in *Activity* stops the queue; the administrator process may finish its current step.

### "Administrator helper missing or modified"

A new version of UpKeep updated the helper, or it was modified. Turn *Install without UAC prompts* off and on again in *Settings › Installation*.

### BitLocker asked for the recovery key after a BIOS update

BitLocker was not suspended (option disabled or failure). Enter the key — for a Microsoft account it is at <https://account.microsoft.com/devices/recoverykey> — and keep *Suspend BitLocker for one restart before a BIOS update* enabled.

### I don't want a particular version

Right-click › **Ignore this version** or **Always ignore**. To stay on a branch (e.g. Node.js 22), use *Stay on major version* in the detail panel. Everything is listed in *Settings › Ignored & pinned*.

### AMD drivers show no new version

AMD publishes no version API and its website blocks automated access, so UpKeep only shows the installed version. Use *Check for updates* in AMD Software.

### SSD firmware is not compared

SSD manufacturers do not publish usable version lists; UpKeep points you to their tool (Samsung Magician, Crucial Storage Executive, WD Dashboard…).

### The window is blank or shows "This page ran into an error"

Click **Reload interface**. If it happens again, create a diagnostic bundle and open a bug report.

### Windows SmartScreen warns when I start UpKeep

Release binaries are not code-signed yet. Check that you downloaded UpKeep from the official [releases page](https://github.com/HUG0Prat/upkeep/releases), then choose *More info › Run anyway*.

## Resetting UpKeep

1. Quit UpKeep (tray icon › *Quit*).
2. If you enabled the administrator helper, turn it off first — or delete the scheduled task `\UpKeep\ElevatedHelper` and the folder `C:\ProgramData\UpKeep\`.
3. Delete or rename `%APPDATA%\UpKeep\`.
