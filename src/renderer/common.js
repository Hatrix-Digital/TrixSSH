'use strict';

/* TrixSSH — shared renderer helpers (loaded before sftp.js/app.js) */

window.TRX = window.TRX || {};

/* ---------- toast ---------- */
let toastTimer = null;
window.TRX.toast = function (msg, isErr = false) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.classList.toggle('err', !!isErr);
  t.textContent = msg;
  /* restart the animation if the toast is already showing */
  t.style.animation = 'none';
  void t.offsetWidth;
  t.style.animation = '';
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3400);
};
const toast = (...a) => window.TRX.toast(...a);

/* ---------- formatting ---------- */
window.TRX.fmtSize = function (n) {
  if (n == null || n === '') return '—';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
};

window.TRX.fmtDate = function (ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/* ---------- paths ---------- */
window.TRX.remoteJoin = function (p, n) {
  return (p === '/' ? '' : String(p).replace(/\/+$/, '')) + '/' + String(n).replace(/[\\/]+$/, '');
};

window.TRX.localJoin = function (p, n) {
  p = String(p);
  n = String(n).replace(/[:\\/]+$/, '');
  if (p === 'ROOTS') return n.toUpperCase() + ':\\';
  if (/^[A-Za-z]:/.test(p)) {
    return /[\\/]$/.test(p) ? p + n : p + '\\' + n;
  }
  return /[\\/]$/.test(p) ? p + n : p + '/' + n;
};

window.TRX.baseName = function (p) {
  return String(p).split(/[\\/]/).filter(Boolean).pop() || String(p);
};

window.TRX.parentLocal = function (p) {
  if (p === 'ROOTS') return null;
  if (/^[A-Za-z]:[\\/]?$/.test(p)) return 'ROOTS';
  const stripped = String(p).replace(/[\\/]+$/, '');
  if (stripped === '/' || stripped === '') return 'ROOTS';
  const m = stripped.match(/^(.+)[\\/]([^\\/]+)$/);
  if (!m) return 'ROOTS';
  let parent = m[1];
  if (/^[A-Za-z]:$/.test(parent)) parent += '\\';
  return parent;
};

window.TRX.parentRemote = function (p) {
  if (p === '/') return '/';
  const stripped = String(p).replace(/\/+$/, '');
  return stripped.replace(/\/[^/]*$/, '') || '/';
};

/* ---------- two-step delete confirmation ---------- */
const armState = new Map();

window.TRX.armBtn = function (btn, key, onFire, label = '!!') {
  const st = armState.get(key);
  if (st && st.btn === btn) {
    clearTimeout(st.timer);
    armState.delete(key);
    btn.classList.remove('confirm');
    btn.textContent = btn.dataset.orig || btn.textContent;
    onFire();
    return;
  }
  armState.forEach((v, k) => {
    if (v.btn === btn) {
      clearTimeout(v.timer);
      v.btn.classList.remove('confirm');
      v.btn.textContent = v.btn.dataset.orig || v.btn.textContent;
      armState.delete(k);
    }
  });
  if (btn.dataset.orig === undefined) btn.dataset.orig = btn.textContent;
  const timer = setTimeout(() => {
    btn.classList.remove('confirm');
    btn.textContent = btn.dataset.orig || btn.textContent;
    armState.delete(key);
  }, 2600);
  armState.set(key, { btn, timer });
  btn.classList.add('confirm');
  btn.textContent = label;
};

/* ---------- generic prompt modal ---------- */
let askResolve = null;
let askWired = false;

function renOverlay() {
  return document.getElementById('renameOverlay');
}

function askOk() {
  if (!askResolve) return;
  const val = document.getElementById('renInput').value.trim();
  const r = askResolve;
  askResolve = null;
  renOverlay().classList.add('hidden');
  r(val || null);
}

function askCancel() {
  if (!askResolve) return;
  const r = askResolve;
  askResolve = null;
  renOverlay().classList.add('hidden');
  r(null);
}

function wireAsk() {
  if (askWired) return;
  askWired = true;
  document.getElementById('renOk').addEventListener('click', askOk);
  document.getElementById('renCancel').addEventListener('click', askCancel);
  const inp = document.getElementById('renInput');
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); askOk(); }
    else if (e.key === 'Escape') { e.preventDefault(); askCancel(); }
  });
}

window.TRX.ask = function (title, defaultValue = '', isPassword = false) {
  wireAsk();
  const ov = renOverlay();
  const inp = document.getElementById('renInput');
  document.getElementById('renTitle').textContent = title;
  inp.type = isPassword ? 'password' : 'text';
  inp.value = defaultValue;
  ov.classList.remove('hidden');
  setTimeout(() => { inp.focus(); inp.select(); }, 0);
  return new Promise((resolve) => { askResolve = resolve; });
};

/* ---------- context menu (right click) ---------- */

window.TRX.ctxMenu = function (items, x, y) {
  document.querySelectorAll('.ctx-overlay').forEach((n) => n.remove());

  const overlay = document.createElement('div');
  overlay.className = 'ctx-overlay';

  const menu = document.createElement('div');
  menu.className = 'ctx-menu';

  const close = () => overlay.remove();

  for (const it of items) {
    if (it === '-' || it === 'sep') {
      menu.appendChild(Object.assign(document.createElement('div'), { className: 'ctx-sep' }));
      continue;
    }
    const b = document.createElement('button');
    b.className = 'ctx-item' + (it.danger ? ' danger' : '') + (it.disabled ? ' disabled' : '');
    b.textContent = (it.key ? it.label + '\t' + it.key : it.label);
    b.disabled = !!it.disabled;
    b.addEventListener('click', () => {
      close();
      if (!it.disabled && it.action) it.action();
    });
    menu.appendChild(b);
  }

  overlay.appendChild(menu);
  document.body.appendChild(overlay);

  const rect = menu.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  menu.style.left = Math.min(x, vw - rect.width - 8) + 'px';
  menu.style.top = Math.min(y, vh - rect.height - 8) + 'px';

  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay || !menu.contains(e.target)) close(); });
  overlay.addEventListener('contextmenu', (e) => { e.preventDefault(); close(); });
  const esc = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc, true); } };
  document.addEventListener('keydown', esc, true);
};

/* ---------- streamer mode mask ---------- */
window.TRX.hashStr = function (s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

window.TRX.maskHost = function (host, settings) {
  if (!settings || !settings.streamerMode) return String(host);
  const h = window.TRX.hashStr(String(host));
  return `10.${h % 240}.${(h >> 8) % 240}.${(h >> 16) % 240}`;
};
