'use strict';
/* After the electron-builder build, embeds the icon + version into win-unpacked/TrixSSH.exe
   (electron-builder does not do this itself because `signAndEditExecutable: false`
   works around the winCodeSign symlink problem on Windows without admin rights). */
const path = require('node:path');
const fs = require('node:fs');
const rcedit = require('rcedit').rcedit;

const ROOT = path.join(__dirname, '..');
const EXE = path.join(ROOT, 'dist', 'win-unpacked', 'TrixSSH.exe');
const ICON = path.join(ROOT, 'build', 'icon.ico');

(async () => {
  if (!fs.existsSync(EXE)) { console.log('[RCEDIT] missing', EXE); return; }
  await rcedit(EXE, {
    icon: ICON,
    'version-string': {
      FileDescription: 'TrixSSH',
      ProductName: 'TrixSSH',
      FileVersion: '1.0.0',
      ProductVersion: '1.0.0',
    },
  });
  console.log('[RCEDIT] OK → dist/win-unpacked/TrixSSH.exe');
})().catch((err) => {
  console.error('[RCEDIT-ERR]', err);
  process.exit(1);
});
