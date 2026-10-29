'use strict';
/* Converts logo-trixssh.pdf → build/icon.ico + build/icon.png + src/main/assets/
   (render PDF → trim → transparent corners → multi-size ICO) */
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const pngToIcoModule = require('png-to-ico');
const pngToIco = pngToIcoModule.default || pngToIcoModule;

const ROOT = path.join(__dirname, '..');
const PDF = path.join(ROOT, 'logo-trixssh.pdf');
const MASTER = path.join(ROOT, 'assets', 'logo.png');   /* processed 1024px master */
const BUILD = path.join(ROOT, 'build');
const ASSETS = path.join(ROOT, 'src', 'main', 'assets');
const SIZES = [256, 128, 64, 48, 32, 16];
const TRAY_SIZES = [16, 20, 24, 32];

/* flood fill (from the edges) everything near-white to transparent, so the corners
   of the rounded square become transparent while the light gray frame stays */
function floodClearEdges(data, w, h) {
  const near = (i) => data[i] > 235 && data[i + 1] > 235 && data[i + 2] > 235;
  const seen = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) { stack.push(x, x + (h - 1) * w); }
  for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1); }
  while (stack.length) {
    const p = stack.pop();
    if (seen[p]) continue;
    seen[p] = 1;
    const i = p * 4;
    if (!near(i)) continue;
    data[i + 3] = 0;
    const x = p % w, y = (p / w) | 0;
    if (x > 0) stack.push(p - 1);
    if (x < w - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - w);
    if (y < h - 1) stack.push(p + w);
  }
}

(async () => {
  fs.mkdirSync(BUILD, { recursive: true });
  fs.mkdirSync(ASSETS, { recursive: true });

  /* 1. render the first PDF page at high resolution */
  let srcBuf;
  if (fs.existsSync(PDF)) {
    const { pdf } = require('pdf-to-img');
    const doc = await pdf(PDF, { scale: 4 });
    for await (const img of doc) { srcBuf = img; break; }
  } else {
    srcBuf = fs.readFileSync(MASTER);
  }

  /* 2. trim the white edges + scale to 1024 */
  let buf = await sharp(srcBuf).trim({ threshold: 20 }).resize(1024, 1024, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } }).png().toBuffer();

  /* 3. transparent corners (flood fill from the edges) */
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  floodClearEdges(data, info.width, info.height);
  buf = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();

  fs.writeFileSync(MASTER, buf);

  /* 4. build/icon.png (512) */
  await sharp(buf).resize(512, 512).png().toFile(path.join(BUILD, 'icon.png'));

  /* 5. multi-size ICO */
  const paths = [];
  for (const s of SIZES) {
    const p = path.join(BUILD, `icon-${s}.png`);
    await sharp(buf).resize(s, s).png().toFile(p);
    paths.push(p);
  }
  const ico = await pngToIco(paths);
  fs.writeFileSync(path.join(BUILD, 'icon.ico'), ico);
  for (const p of paths) { try { fs.unlinkSync(p); } catch { /* */ } }

  /* 6. copies next to the app (window + tray, asar) */
  fs.copyFileSync(path.join(BUILD, 'icon.ico'), path.join(ASSETS, 'icon.ico'));
  fs.copyFileSync(path.join(BUILD, 'icon.png'), path.join(ASSETS, 'icon.png'));

  /* 7. TRAY icon — a compact version of the logo.
     A large ICO at 16px becomes a pale blurry blob (the light frame washes out),
     so the tray gets its own small sizes: no light frame, sharp edges. */
  const meta = await sharp(buf).metadata();
  const inset = Math.max(1, Math.round(meta.width * 0.03));
  const tight = await sharp(buf)
    .extract({ left: inset, top: inset, width: meta.width - inset * 2, height: meta.height - inset * 2 })
    .png().toBuffer();
  const trayPaths = [];
  for (const s of TRAY_SIZES) {
    const p = path.join(BUILD, `tray-${s}.png`);
    await sharp(tight).resize(s, s, { kernel: 'lanczos3' }).sharpen({ sigma: 1 }).png().toFile(p);
    trayPaths.push(p);
  }
  fs.copyFileSync(trayPaths[trayPaths.length - 1], path.join(ASSETS, 'tray.png'));
  const trayIco = await pngToIco(trayPaths);
  fs.writeFileSync(path.join(ASSETS, 'tray.ico'), trayIco);
  for (const p of trayPaths) { try { fs.unlinkSync(p); } catch { /* */ } }

  console.log('[LOGO-ICON] OK → build/icon.ico + build/icon.png + src/main/assets + assets/logo.png + tray.ico/png');
  process.exit(0);
})().catch((err) => {
  console.error('[LOGO-ICON-ERR]', err);
  process.exit(1);
});
