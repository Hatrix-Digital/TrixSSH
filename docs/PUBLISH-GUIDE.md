# Publishing TrixSSH on GitHub — step by step

## 1. Repository settings (github.com)

**About (gear icon, top right):**
- Description:
  Fast desktop SSH client for Windows, macOS and Linux — tabs, SFTP, live metrics, snippets, broadcast and auto-updates. Inspired by OmnySSH.
- Topics:
  ssh, ssh-client, sftp, terminal, xterm, electron, windows, macos, linux, desktop-app,
  server-manager, devops, sysadmin, open-source

## 2. Push the code (PowerShell, in the project folder)

```powershell
git remote add origin https://github.com/Hatrix-Digital/TrixSSH.git
git push -u origin main
```

## 3. Publish v1.0.0 (automatic build via GitHub Actions)

```powershell
git tag v1.0.0
git push origin v1.0.0
```

→ The `release.yml` workflow builds **Windows (installer + portable ZIP), macOS (DMG + ZIP) and
Linux (AppImage + deb)** and creates a single **draft release** with all artifacts.
Check the Actions tab (~10–15 min; macos/linux extra), open Releases and press **Publish**.

## 4. Auto-update manifest (`latest.json`)

The release URL patterns:

```
https://github.com/Hatrix-Digital/TrixSSH/releases/download/v1.0.0/TrixSSH-Setup-1.0.0.exe
https://github.com/Hatrix-Digital/TrixSSH/releases/download/v1.0.0/TrixSSH-1.0.0.dmg
https://github.com/Hatrix-Digital/TrixSSH/releases/download/v1.0.0/TrixSSH-1.0.0-x86_64.AppImage
https://github.com/Hatrix-Digital/TrixSSH/releases/download/v1.0.0/TrixSSH-1.0.0-amd64.deb
```

`latest.json` in the repo root already points to 1.0.0. For every future release update
`version`, `url` (Windows installer), `macUrl`, `linuxUrl` and `notes`, then push to `main`.
Windows installations download and install with one click; macOS/Linux open the download
in the user's default browser.

## 5. Point the app at the update source

Set the constant at the top of `src/main/main.js`:

```js
const UPDATE_MANIFEST_URL = 'https://raw.githubusercontent.com/Hatrix-Digital/TrixSSH/main/latest.json';
```

(Alternative: enable GitHub Pages — Settings → Pages → branch `main`, root — and use
`https://Hatrix-Digital.github.io/TrixSSH/latest.json`.)

Then rebuild (`npm run build`) so distributable installs check your source for updates.

## 6. Checklist for every future release

- [ ] Bump `package.json` version (e.g. 1.0.1)
- [ ] Write `docs/RELEASE-1.0.1.md` release notes
- [ ] Commit + tag `v1.0.1` + push the tag
- [ ] Wait for Actions → Publish the draft release
- [ ] Update `latest.json` (version / url / macUrl / linuxUrl / notes) and push to main
- [ ] Verify an old installation receives the "New version available" modal on next check
