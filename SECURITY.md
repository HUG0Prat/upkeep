# Security policy

UpKeep installs software and drivers, often with administrator rights. We take its security very seriously and appreciate responsible disclosure.

## Supported versions

| Version | Supported |
|---|---|
| 1.x (latest release) | ✅ |
| older releases | ❌ — please update first |

## Reporting a vulnerability

**Do not open a public issue, discussion or pull request for a vulnerability.**

Report it privately through GitHub: go to the repository's **Security** tab and click **[Report a vulnerability](https://github.com/HUG0Prat/upkeep/security/advisories/new)**.

Please include:

- the affected version and Windows version;
- a description of the issue and its impact (for example: privilege escalation, code execution, installation of an unverified binary);
- steps to reproduce or a proof of concept;
- any suggested fix.

### What to expect

| Step | Target |
|---|---|
| Acknowledgement | within 3 business days |
| Initial assessment | within 10 business days |
| Fix for critical and high severity issues | as fast as possible, usually within 30 days |
| Public advisory | once a fixed release is available, crediting you unless you prefer otherwise |

We will keep you informed throughout. Please give us a reasonable time to release a fix before any public disclosure.

## Scope

In scope:

- privilege escalation through UpKeep (UAC path, administrator helper, its queue or files);
- execution of code or of an unverified installer;
- bypass of signature, hash or publisher checks;
- injection into elevated operations;
- escape from the renderer sandbox, IPC abuse, abuse of `upkeep://` links;
- disclosure of personal data in logs, diagnostic bundles or network requests.

Out of scope:

- vulnerabilities in third-party software that UpKeep merely reports or updates (report them to their vendor);
- attacks that require an already compromised administrator account;
- the documented trade-off of the optional administrator helper (see below);
- missing code signing of current release binaries (a known, tracked limitation).

## Security model

### Trust boundaries

| Component | Trust |
|---|---|
| Main process | trusted |
| Renderer (interface) | limited: sandboxed, context isolation, no Node API, can only call named functions |
| Data from registries and vendor sites (versions, names, URLs, notes) | **untrusted** |
| Downloaded installers | **untrusted** until verified |
| Other programs in the user session | untrusted |
| Elevated process / SYSTEM helper | trusted, but only executes known operations |

### Principles

1. **No remote text is ever executed.** Remote data is only used as parameters of typed operations, validated with strict regular expressions before use.
2. **Elevation never receives a free-form script.** Sources produce operations from a closed list (`electron/lib/elevatedOps.ts`): install a Windows update by GUID, a known winget package, a verified installer with fixed arguments, remove a superseded driver…
3. **What runs elevated is verified at execution time.** The UAC loader reads the script into memory and checks its SHA-256 before running it (no time-of-check/time-of-use gap). The administrator helper's hash is checked before each use.
4. **Third-party binaries are verified.** HTTPS download, published SHA-256 when the vendor provides one, valid Authenticode signature and expected publisher. For the helper, installers are first copied to a folder that the user cannot write to.
5. **The interface is only an interface.** Navigation, redirects, new windows, `<webview>` and permission requests are denied; a strict Content Security Policy applies; every IPC call checks the sender frame.
6. **Nothing leaves the PC without user action.** No telemetry; crash reports are stored locally (`uploadToServer: false`); logs and diagnostic bundles are redacted.
7. **Hardened binary.** Electron fuses disable `NODE_OPTIONS` and the inspector and enforce ASAR integrity and loading from ASAR only. `runAsNode` remains enabled because the CLI depends on it; it grants no privilege beyond the user session.

### Elevation paths

**UAC (default)** — all administrator operations of a batch are combined into one script, written to a temporary file and started with `-Verb RunAs` through a loader passed as `-EncodedCommand`. The loader refuses to run the script if its hash differs (exit code 97).

**Administrator helper (optional, off by default)** — a scheduled task running as SYSTEM, installed once with UAC. It only accepts JSON files of operations from the same closed list, from a queue folder writable only by the user who installed it and administrators.

> [!IMPORTANT]
> Accepted trade-off: malware already running in the user's session could request the same operations without a UAC prompt (for example, install a Windows update or a known winget package). It cannot run arbitrary code as SYSTEM. This is why the helper is disabled by default and the interface explains it before activation.

### Notification links

Buttons in Windows notifications open `upkeep://` links carrying a random 128-bit token, single-use and valid for 24 hours, created by the application for that notification. Links without a valid token are ignored.

## Hardening checklist for contributors

- New elevated operation → strict validation of every parameter, injection test, security review.
- New network endpoint → HTTPS only, no user identifier, listed in [PRIVACY.md](PRIVACY.md).
- New IPC channel → registered through the sender-checking helper, exposed as a specific preload function.
- New binary download → hash and/or Authenticode signature with expected publisher.
