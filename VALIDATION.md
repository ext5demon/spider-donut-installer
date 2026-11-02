# Installer validation — 2026-11-01

Validated locally before distribution:

- Windows x64 portable app packages and launches. The packaged renderer has no Node.js `require` access.
- Actual GitHub release catalog loads. Latest Beta, Older Versions and key-gated Dev Beta navigate to the appropriate screens.
- Owner GUI issues an encrypted, signed key file; unlocking requires its separate password. A wrong password leaves Dev Beta locked. Encrypted owner backup export and recovery also pass.
- Chapter detection, checkboxes, back navigation and output review work. Missing WSL produces the setup sheet; declining it starts no installation.
- Menus, submenu selection, Help, log drawer, window focus, drag, zoom, minimize/restore using the captured-content Genie animation, and attached sheets were checked in the running app and screenshots.
- Renderer-contract fixtures check indeterminate/determinate progress and completion screens. These fixtures exist only in the test harness. Production uses the actual worker process.
- Eleven Node tests pass, covering core behavior, encrypted licenses, DPAPI migration, backup recovery and release privacy. The ten core/cryptography tests also pass under Electron's own Node/crypto runtime. Three filesystem/archive worker tests pass on Windows; all four worker tests, including Linux subprocess-group cancellation, passed in the original Linux integration. Cleanup preserves original files and sibling jobs and rejects an escaping job identity.

Version 1.1 adds encryption and key-storage protection. The existing owner signing identity was preserved during migration from plaintext to DPAPI storage. New keys require the encrypted v2 format; old plaintext keys are rejected. See SECURITY.md for the researched design and known limits. Packaging runs a privacy audit before producing the executable.

## Real build worker integration

The worker completed two real v0.3 builds from public commit `842ff61714b4b34153a98da2e9427a9deabb602f`, using local Chapter 3 test files. One used the existing project SDK; the second installed the exact pinned SDK used by this app:

```text
ps3dev nightly-2026-10-12, linux-X64
SHA-256 76b1b3bc9ac260a4ece86da520225da7f2f4e334174e37b850093ff925eeb900
```

Both runs compiled and packaged a valid PS3 PKG, built the pinned preprocessor with Java 21, generated a 119,513,075-byte PS3 texture bundle, converted both Chapter 3 intro videos to BSV and Ogg, and produced a 38-file USB ZIP with a successful CRC check and SHA-256 sidecar. The original chapter data remained unchanged. The integration ZIPs contain owned game files and are not distributed with the installer.

## Remaining platform check

The Linux worker was exercised in the existing Debian build VM. This Windows QA host does not have WSL enabled. The first-use Windows feature installation, reboot and Ubuntu import sequence therefore still needs an end-to-end check on a Windows machine where those system changes are permitted. The app's detection and setup prompt were tested without enabling features or restarting the host. PS3 gameplay itself is outside this installer validation.
