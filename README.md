# Spider Donut Installer

A Windows desktop assistant for building a selected Spider Donut version and preparing the user's own DELTARUNE chapters for a PS3 USB drive. The installer has a Mac OS X 10.2 Aqua-style interface, with working window controls, menus, sheets, a log drawer, Dock magnification and a captured-texture Genie animation.

Installer source: [ext5demon/spider-donut-installer](https://github.com/ext5demon/spider-donut-installer). The game runner remains in [ext5demon/donut-spider](https://github.com/ext5demon/donut-spider); `config.json` intentionally points there to find and build game versions.

## Player workflow

1. Choose **Latest Beta**, **Dev Beta**, or **Older Versions**. Public versions come from the repository's published `vâ€¦` releases. Each source revision is resolved to an exact commit before downloading it.
2. For Dev Beta, import the encrypted `.spiderkey` file and enter the password supplied separately by the owner.
3. Choose the DELTARUNE folder containing `chapter1_windows`, `chapter2_windows`, and so on. Select the chapters to include.
4. Choose where to save the ZIP, then click **Build**.
5. The assistant prepares build dependencies, compiles the selected version's PKG, generates a separate PS3 `TEXTURES.BIN` per chapter, converts supported chapter videos, and creates a checked ZIP.
6. Extract the ZIP to the root of a FAT32 USB drive. Install the PKG through Package Manager on a HEN/CFW PS3.

```text
USB root/
  spider-donut-<version>.pkg
  DELTARUNE/
    chapter1_windows/
      data.win
      TEXTURES.BIN
      mus/...
    chapter2_windows/...
  README-FIRST.txt
  BUILD-INFO.json
```

The app never rewrites the original game folder. PC executables, saves, session logs, stale texture bundles, and developer keys are excluded. The ZIP is checked for CRC errors and accompanied by its SHA-256 checksum. Files larger than FAT32's limit are rejected.

## Windows build environment

Requires Windows 10/11 x64 with virtualization support, internet access, at least 8 GB free for the tools, and additional space for chapter staging plus the final archive. First-time setup uses [Windows Subsystem for Linux](https://learn.microsoft.com/en-us/windows/wsl/install). The app asks before starting the Windows component installation; this may prompt for administrator access and require a restart. It never restarts Windows automatically.

The app imports a separate Ubuntu 24.04 distribution named `SpiderDonutBuilder`, checking Canonical's root filesystem checksum first. It does not run build commands inside any of the user's existing WSL distributions. Inside its own environment it installs build dependencies and the pinned, SHA-256-verified PS3 SDK. Completed downloads are cached.

Native Linux with Python 3.12+ can run the worker for integration testing. On Linux it needs root or passwordless sudo for initial apt dependency setup. macOS and Windows ARM are not supported by this build.

Build logs are stored beneath Electron's user-data folder in `jobs/<job-id>/build.log`. Linux work files and tool caches are inside the managed distribution at `/root/.cache/spider-donut/`. Temporary compilation and chapter staging files are removed when the worker exits; reusable tools and downloads stay cached. Cancelling signals the worker, which terminates its own compiler process groups. A cancelled build can be retried with the same selections; an interrupted compilation is restarted in a fresh job folder.

## Local developer key files â€” owner instructions

Version 1.1 encrypts developer records with **AES-256-GCM**, deriving a separate key per file using **scrypt**. The complete encrypted record is also signed with **Ed25519**. The app contains only the public verification key from `config.json`; it contains no shared decryption password or private signing key. See [SECURITY.md](SECURITY.md) for the design, researched failure modes and limitations.

The issuer tool defaults to:

```text
%USERPROFILE%\.spider-donut-owner\issuer-private.pem
```

The official issuer is already initialized and its private key is kept outside this repository. On the owner's computer, it is stored as a Windows DPAPI encrypted container at the legacy `.pem` path above. Its signing identity is preserved. It can be unlocked only in the owner's Windows user context; copying that protected file is not a portable recovery backup. **Do not run `init` again or replace the public key unless deliberately rotating the issuer.**

On the owner's computer, open **Spider Donut Installer â†’ Developer Keysâ€¦**. Enter the developer's name and expiry date, then choose **Generate** to create a random file password. Use **Show password** to copy it, save the key file, and give the password to the developer separately. Use a different password per developer. The creation menu appears only when the matching issuer can be unlocked locally.

Choose **Export Owner Backupâ€¦** to create a password-encrypted `.spiderbackup` recovery file. Give that backup a separate password which you never share with developers. Keep the backup and password private and available before reinstalling Windows or moving to another account. The backup cannot be recovered without its password.

Alternatively, issue a key file using Node.js:

```powershell
node tools/keys.cjs issue --name "Developer Name" --expires 2027-01-31 --out "C:\Keys\developer.spiderkey"
```

The CLI prompts for a password without echoing it. Do not put passwords in command-line arguments or environment variables. Automation can explicitly use `--password-stdin`; never log the supplied input. Use `--ref <branch-or-commit>` to restrict a file to a development revision; the default is `main`. Expiry is checked against the local computer clock.

Command-line backup and recovery:

```powershell
node tools/keys.cjs backup --out "C:\Private\owner.spiderbackup"
node tools/keys.cjs restore --backup "C:\Private\owner.spiderbackup"
```

Restore on the new Windows account using the backup password. The matching public key must already be present in `config.json`. Restore refuses to overwrite an existing issuer file; move an old unusable container aside first, or use a new `--issuer` path. It writes Windows-protected storage, never a plaintext private-key export. `node tools/keys.cjs protect` explicitly migrates a matching legacy plaintext issuer in place after verifying a DPAPI round trip.

For a new, independent issuer only:

```powershell
node tools/keys.cjs init --issuer "C:\Private\issuer-private.pem"
node tools/keys.cjs issue --issuer "C:\Private\issuer-private.pem" --name "Developer Name" --expires 2027-01-31 --out "C:\Keys\developer.spiderkey"
```

Rebuild the installer after changing the public key. This version rejects old unencrypted `.spiderkey` files; reissue them in the encrypted format. Older distributed installers cannot be remotely revoked. Offline files and passwords can be shared and cannot be individually revoked without updating the verifier policy. This gate does not make public GitHub source private or prevent someone from modifying a local verifier.

## Build the desktop app

Install Node.js 22+ and pnpm, then run in this directory:

```powershell
git clone https://github.com/ext5demon/spider-donut-installer.git
cd spider-donut-installer
pnpm install --frozen-lockfile
node node_modules/electron/install.js
pnpm start
pnpm package
```

The portable Windows app is written to `release/Spider-Donut-Installer-1.1.0.exe`. It does not bundle the PS3 SDK, game data, the private issuer key, developer key files or encrypted owner backups. The generated executable is unsigned unless the publisher supplies a code-signing configuration.

## Validation

```powershell
pnpm test
python test/worker_test.py
# Requires Playwright and this project's local issuer; never runs a PS3 build:
node test/ui-smoke.cjs
```

The UI test uses temporary synthetic game headers for folder detection and a short-lived test license, deleted afterwards. It checks key import, chapter selection, menus, help, window movement/zoom, drawer, Genie restore and sheets. Worker tests check USB layout, exclusion rules, original-file preservation, package-header rejection, archive traversal rejection and ZIP integrity. First-time WSL feature installation requires validation on a Windows machine where enabling WSL and restarting are permitted.

UI reference: [Mac OS X Jaguar screenshots](https://guidebookgallery.org/screenshots/macosx102/). The renderer is isolated and sandboxed following [Electron's security guidance](https://www.electronjs.org/docs/latest/tutorial/security). No Apple UI artwork or proprietary Apple fonts are bundled; the wallpaper, controls and utility icons are code-drawn recreations.
