# TrixSSH v1.0.0 — first public release 🎉

The first official release of TrixSSH, a fast desktop SSH client for Windows inspired by OmnySSH.

## ⬇ Downloads

- **`TrixSSH-Setup-1.0.0.exe`** — Windows installer, recommended (NSIS)
- **`TrixSSH-v1.0.0-win64-portable.zip`** — Windows portable (extract and run `TrixSSH.exe`)
- **`TrixSSH-1.0.0.dmg`** — macOS installer (drag TrixSSH to Applications)
- **`TrixSSH-1.0.0-mac.zip`** — macOS portable
- **`TrixSSH-1.0.0-x86_64.AppImage`** — Linux AppImage (chmod +x, run)
- **`TrixSSH-1.0.0-amd64.deb`** — Debian/Ubuntu package

> Windows SmartScreen may warn because the app is not code-signed — *More info → Run anyway*.
> On macOS, right-click the app → *Open* the first time (unsigned app).
> On Linux with AppImage, you may need `libfuse2`.

## ✨ What's inside

**Terminal**
- Multiple simultaneous connections in tabs (xterm.js, 256 colors, 20 000-line scrollback)
- Snippets — saved commands, one click away
- Broadcast — send the same command to several servers at once
- Copy/paste combos (Ctrl+C / Ctrl+V, Ctrl+Shift+C / Ctrl+Shift+V)

**Dashboard**
- Server cards: CPU / RAM / DISK, uptime, OS, top processes — live refresh
- Card actions: open terminal / SFTP, edit, delete
- Monitors auto-retry on transient errors

**SFTP**
- Dual-pane browser (local ↔ server) with progress bar
- Recursive transfer of **entire folders** in both directions
- New folder, delete (recursive), rename
- "Choose a server…" picker with search and status dots

**Security**
- Passwords and passphrases encrypted with DPAPI — everything stays local (`%APPDATA%\TrixSSH`)
- No telemetry, no cloud
- Backup & migration: `.trixbak` files (AES-256-GCM + scrypt, password protected)
- Key from disk or paste (OpenSSH), warns about PuTTY `.ppk`

**System**
- **7 interface languages**: English, Deutsch, Français, Italiano, Hrvatski, Bosanski, Srpski (Settings → Language)
- Auto-updates (checked at startup and every 6 h, download + one-click install)
- Dark / light theme, minimize and close to tray
- Context menus on SFTP rows, tabs, terminal and dashboard cards
- Custom dark icon with prompt and brush-X logo

## 📌 Notes

- Supported OS: **Windows 10/11 (x64)**
- Metrics (CPU/RAM/DISK) work on **Linux servers** (reads `/proc/*` and `df -kP`)
- Settings live in `%APPDATA%\TrixSSH` and survive upgrades

**Full Changelog**: initial release
