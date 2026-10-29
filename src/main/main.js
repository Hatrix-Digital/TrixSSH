'use strict';

const { app, BrowserWindow, ipcMain, safeStorage, dialog, Tray, Menu, nativeImage, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { Client } = require('ssh2');
const { StringDecoder } = require('node:string_decoder');
const https = require('node:https');
const http = require('node:http');
const { spawn } = require('node:child_process');

/* =========================================================
   Updates
   Source can be: env TRIX_UPDATE_MANIFEST, settings.updateUrl,
   or this constant (when you publish a release server — change it only here).
   latest.json format:
   { "version": "1.0.1", "url": "https://.../TrixSSH-Setup-1.0.1.exe", "notes": "short description" }
   (url may also be an absolute local path or file:/// — for testing)
======================================================== */
const UPDATE_MANIFEST_URL = 'https://raw.githubusercontent.com/Hatrix-Digital/TrixSSH/main/latest.json';
/* fallback source — the raw.github CDN can serve a stale latest.json for more than 5 min
   after a push, so the new version "doesn't exist"; jsdelivr is far fresher */
const UPDATE_MANIFEST_FALLBACK_URL = 'https://cdn.jsdelivr.net/gh/Hatrix-Digital/TrixSSH@main/latest.json';

let updateBusy = false;
let pendingManualCheck = false;
let updateLatest = null;      /* { version, url, macUrl, linuxUrl, notes } */
let updateFile = null;        /* downloaded file */
let updateLaterVersion = null; /* version for which the user chose "Later" */

const IS_WIN = process.platform === 'win32';

/* ---------- demo data for screenshots (TRIX_SHOTS=1) ----------
   Everything is fictional: documentation IPs (RFC 5737), fake hosts,
   fake files. No real data is read or displayed. */

const SHOTS_MODE = process.env.TRIX_SHOTS === '1';

const DEMO_HOSTS = [
  { id: 'demo1', label: 'web-prod', host: '203.0.113.10', port: 22, username: 'deploy', color: '#22c55e', authType: 'key', hasPassword: false, hasKey: true },
  { id: 'demo2', label: 'db-main', host: '198.51.100.42', port: 22, username: 'root', color: '#8b5cf6', authType: 'password', hasPassword: true, hasKey: false },
];

const DEMO_SNIPPETS = [
  { id: 'demo-s1', name: 'System info', cmd: 'uname -a && uptime' },
  { id: 'demo-s2', name: 'Disk usage', cmd: 'df -h' },
  { id: 'demo-s3', name: 'Top memory', cmd: 'ps aux --sort=-%mem | head -8' },
  { id: 'demo-s4', name: 'Services', cmd: 'systemctl list-units --type=service --state=running | head -12' },
  { id: 'demo-s5', name: 'Nginx errors', cmd: 'tail -60 /var/log/nginx/error.log' },
  { id: 'demo-s6', name: 'Restart service', cmd: 'systemctl restart my-app && sleep 1 && systemctl status my-app --no-pager' },
];

const demoDate = (m, d, h = 10, mi = 24) => Date.UTC(2026, m - 1, d, h, mi);
const DEMO_LOCAL_HOME = 'C:\\Users\\demo\\projects';
const DEMO_REMOTE_HOME = '/var/www/app';

const DEMO_LOCAL_ENTRIES = [
  { name: 'web-app', isDir: true, size: null, mtime: demoDate(10, 25, 8, 12) },
  { name: 'docs', isDir: true, size: null, mtime: demoDate(10, 23, 15, 40) },
  { name: 'scripts', isDir: true, size: null, mtime: demoDate(10, 20, 11, 5) },
  { name: 'backup-routine.ps1', isDir: false, size: 1481, mtime: demoDate(10, 24, 19, 30) },
  { name: 'deploy.sh', isDir: false, size: 2143, mtime: demoDate(10, 25, 9, 2) },
  { name: 'README.md', isDir: false, size: 742, mtime: demoDate(10, 22, 16, 48) },
  { name: 'notes.txt', isDir: false, size: 318, mtime: demoDate(10, 18, 8, 39) },
  { name: 'assets-2026-04-11.zip', isDir: false, size: 85367808, mtime: demoDate(10, 14, 13, 21) },
];

const DEMO_REMOTE_ENTRIES = [
  { name: 'releases', isDir: true, size: null, mtime: demoDate(10, 24, 6, 10) },
  { name: 'shared', isDir: true, size: null, mtime: demoDate(10, 19, 17, 26) },
  { name: 'logs', isDir: true, size: null, mtime: demoDate(10, 25, 7, 55) },
  { name: 'storage', isDir: true, size: null, mtime: demoDate(10, 21, 12, 2) },
  { name: 'app.js', isDir: false, size: 12874, mtime: demoDate(10, 24, 22, 12) },
  { name: 'nginx.conf', isDir: false, size: 4321, mtime: demoDate(10, 16, 14, 5) },
  { name: 'maintenance.html', isDir: false, size: 971, mtime: demoDate(10, 12, 9, 31) },
  { name: 'release-2026.04.11.tar.gz', isDir: false, size: 41825824, mtime: demoDate(10, 24, 22, 8) },
];

function demoLocalList(p) {
  if (p === 'ROOTS') return { path: 'ROOTS', entries: [{ name: 'C:', isDir: true, size: null, mtime: 0 }] };
  return { path: p || DEMO_LOCAL_HOME, entries: DEMO_LOCAL_ENTRIES };
}

function demoRemoteList(p) {
  return { path: p || DEMO_REMOTE_HOME, entries: DEMO_REMOTE_ENTRIES };
}


/* download URL appropriate for the current platform */
function platformUpdateUrl(u) {
  if (!u) return '';
  if (process.platform === 'darwin' && u.macUrl) return u.macUrl;
  if (process.platform === 'linux' && u.linuxUrl) return u.linuxUrl;
  return u.url || '';
}

let mainWindow = null;
let tray = null;
let quitting = false;

/** sessionId (terminal) -> { client, stream } */
const sessions = new Map();
const closedRequests = new Set();

/** hostId -> { client, timer, sftp, sftpP, prevCpu, busy, status, retryTimer } */
const monitors = new Map();

/* ---------- settings ---------- */

const SETTINGS_DEFAULTS = {
  theme: 'dark',
  streamerMode: false,
  dashInterval: 30,          // seconds
  minimizeToTray: false,
  closeToTray: false,
  askBeforeQuit: true,
  sidebarCollapsed: false,
};

/* ---------- stores ---------- */

function storeFile(name) {
  return path.join(app.getPath('userData'), name);
}

function readStore(name, fallback = []) {
  for (const file of [storeFile(name), storeFile(name) + '.bak']) {
    try {
      const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch { continue; }
  }
  return fallback;
}

function writeStore(name, list) {
  const file = storeFile(name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
  try {
    if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak');
  } catch { /* backup copy is not critical */ }
  fs.renameSync(tmp, file);
}

function readSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(storeFile('trixssh-settings.json'), 'utf8').replace(/^\uFEFF/, ''));
    return { ...SETTINGS_DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
  } catch {
    return { ...SETTINGS_DEFAULTS };
  }
}

function writeSettings(s) {
  const file = storeFile('trixssh-settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(s, null, 2), 'utf8');
}

/* ---------- secret (de)cryption ---------- */

function encryptSecret(value) {
  if (!value) return '';
  if (safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable()) {
    try {
      return 'enc:' + safeStorage.encryptString(value).toString('base64');
    } catch { /* plain fallback */ }
  }
  return 'plain:' + value;
}

function decryptSecret(value) {
  if (!value) return '';
  if (value.startsWith('enc:')) {
    try {
      return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'));
    } catch {
      return '';
    }
  }
  if (value.startsWith('plain:')) return value.slice(6);
  return '';
}

function publicView(h) {
  return {
    id: h.id,
    label: h.label,
    host: h.host,
    port: h.port,
    username: h.username,
    color: h.color,
    authType: h.authType,
    hasPassword: !!(h.password && h.password.length),
    hasKey: !!(h.privateKey && h.privateKey.length),
  };
}

function describeError(err) {
  const msg = String((err && err.message) || err || '');
  const code = err && err.code ? String(err.code) : '';
  if (code === 'ENOTFOUND' || msg.includes('ENOTFOUND')) return 'Host nije pronađen (ENOTFOUND). Provjeri ime/domenu.';
  if (code === 'ECONNREFUSED' || msg.includes('ECONNREFUSED')) return 'Veza odbijena (ECONNREFUSED). Radi li SSH servis i je li port ispravan?';
  if (code === 'ETIMEDOUT' || msg.includes('ETIMEDOUT')) return 'Vrijeme čekanja isteklo (ETIMEDOUT). Provjeri host, port, firewall/VPN.';
  if (code === 'EACCES' || code === 'EPERM') return 'Pristup odbijen (EACCES/EPERM).';
  if (code === 'ENOENT' || msg.includes('NoSuch file')) return 'Putanja ne postoji.';
  if (code === 'ECONNRESET' || msg.includes('ECONNRESET')) return 'Veza je resetirana.';
  if (code === 'EAUTHFAIL' || msg.includes('authentication') || msg.includes('Authentication')) {
    return 'Prijava nije uspjela — pogrešno korisničko ime ili lozinka/ključ (EAUTHFAIL).';
  }
  if (msg.includes('All configured authentication methods failed')) {
    return 'Nijedna metoda prijave nije uspjela — provjeri lozinku ili privatni ključ.';
  }
  return msg || 'Nepoznata greška';
}

function sendToRenderer(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

/* =========================================================
   MONITORS (per host): status, metrics, SFTP channel
======================================================== */

function buildClientConf(stored) {
  const conf = {
    host: stored.host,
    port: Number(stored.port) || 22,
    username: stored.username,
    readyTimeout: 15000,
    keepaliveInterval: 10000,
    keepaliveCountMax: 6,
    tryKeyboard: true,
  };
  if (stored.authType === 'key') {
    const key = decryptSecret(stored.privateKey);
    if (!key) throw new Error('Za ovaj server nema spremljenog privatnog ključa.');
    conf.privateKey = key;
    const pp = decryptSecret(stored.passphrase);
    if (pp) conf.passphrase = pp;
  } else {
    const pw = decryptSecret(stored.password);
    if (!pw) throw new Error('Za ovaj server nema spremljene lozinke.');
    conf.password = pw;
  }
  return conf;
}

function monitorStatus(hostId, status, err) {
  sendToRenderer('monitor:status', hostId, status, err ? describeError(err) : undefined);
}

function teardownMonitor(hostId) {
  const m = monitors.get(hostId);
  monitors.delete(hostId);
  if (m) {
    if (m.timer) clearInterval(m.timer);
    if (m.retryTimer) clearTimeout(m.retryTimer);
    if (m.client) {
      try { m.client.end(); } catch { /* ignore */ }
    }
  }
  monitorStatus(hostId, 'offline');
}

function ensureMonitor(hostId) {
  const stored = readStore('trixssh-hosts.json').find((h) => h.id === hostId);
  if (!stored) return;

  const existing = monitors.get(hostId);
  if (existing && existing.client) return; // already running

  if (existing) {
    // stale and dead — clean up
    if (existing.timer) clearInterval(existing.timer);
    if (existing.retryTimer) clearTimeout(existing.retryTimer);
    monitors.delete(hostId);
  }

  monitorStatus(hostId, 'connecting');
  const settings = readSettings();
  const m = {
    client: null,
    timer: null,
    sftp: null,
    sftpP: null,
    prevCpu: null,
    busy: false,
    retryTimer: null,
  };
  monitors.set(hostId, m);

  let settled = false;
  const client = new Client();
  m.client = client;

  client.on('keyboard-interactive', (_n, _i, _l, _p, finish) => {
    finish([decryptSecret(stored.password)]);
  });

  client.on('error', (err) => {
    const msg = String((err && err.message) || err || '');
    const authFail = msg.includes('authentication') || msg.includes('Authentication') || msg.includes('EAUTHFAIL');
    teardownMonitor(hostId);
    monitorStatus(hostId, 'offline', err);
    if (!authFail) scheduleRetry(hostId);
  });

  client.on('close', () => {
    if (monitors.get(hostId) === m) {
      teardownMonitor(hostId);
      scheduleRetry(hostId);
    }
  });

  client.on('ready', () => {
    if (monitors.get(hostId) !== m) {
      client.end();
      return;
    }
    settled = true;
    monitorStatus(hostId, 'online');
    m.timer = setInterval(() => metricTick(hostId), Math.max(5, settings.dashInterval) * 1000);
    metricTick(hostId);
  });

  try {
    client.connect(buildClientConf(stored));
  } catch (err) {
    teardownMonitor(hostId);
    monitorStatus(hostId, 'offline', err);
  }
}

function scheduleRetry(hostId) {
  const m = monitors.get(hostId);
  if (m || monitors.has(hostId)) return; // already exists/in flight
  const retryTimer = setTimeout(() => {
    const hostExists = readStore('trixssh-hosts.json').some((h) => h.id === hostId);
    if (hostExists && !monitors.has(hostId)) ensureMonitor(hostId);
  }, 45000);
  // keep the reference so retry isn't lost
  retryTimers.set(hostId, retryTimer);
}

const retryTimers = new Map();

function applyMetricInterval() {
  const settings = readSettings();
  const ms = Math.max(5, settings.dashInterval) * 1000;
  for (const [hostId, m] of monitors) {
    if (m.timer) {
      clearInterval(m.timer);
      m.timer = setInterval(() => metricTick(hostId), ms);
      metricTick(hostId);
    }
  }
}

/* ---------- metrics ---------- */

/* Sections with markers: no fragile line-by-line parsing */
const METRIC_CMD = [
  "echo '@@CPU'; head -1 /proc/stat 2>/dev/null",
  "echo '@@MEM'; grep -E '^(MemTotal|MemAvailable):' /proc/meminfo 2>/dev/null",
  "echo '@@LOAD'; head -1 /proc/loadavg 2>/dev/null",
  "echo '@@DISK'; df -kP / 2>/dev/null | tail -1",
  "echo '@@UP'; cat /proc/uptime 2>/dev/null",
  "echo '@@NET'; cat /proc/net/dev 2>/dev/null",
  "echo '@@OS'; grep -m1 PRETTY_NAME /etc/os-release 2>/dev/null",
  "echo '@@PS'; ps -eo pcpu,comm --sort=-pcpu 2>/dev/null | grep -v PCPU | head -5",
  "echo '@@HOST'; hostname 2>/dev/null",
  "echo '@@IP'; hostname -I 2>/dev/null || ip -o -4 addr show scope global 2>/dev/null",
].join('; ');

/* public IP — external command (slower), only requested until we've collected it */
const METRIC_PUB_CMD =
  "; echo '@@PUBIP'; (curl -s --max-time 4 https://api.ipify.org 2>/dev/null || wget -q -T 4 -O- https://api.ipify.org 2>/dev/null)";

function metricTick(hostId) {
  const m = monitors.get(hostId);
  if (!m || !m.client || m.busy) return;
  m.busy = true;

  /* request the public IP until it's collected (or 4 failed attempts) */
  const wantPub = !(m.pubIp || m.pubAbort);
  if (wantPub) m.pubAsked = true;

  m.client.exec(METRIC_CMD + (wantPub ? METRIC_PUB_CMD : ''), (err, stream) => {
    if (err || !stream) {
      m.busy = false;
      return;
    }
    let buf = '';
    let failed = false;
    stream.on('data', (d) => { buf += d.toString(); });
    stream.on('error', () => { failed = true; });
    stream.on('close', () => {
      m.busy = false;
      if (!monitors.has(hostId) || failed) return;
      const parsed = parseMetrics(buf, m);
      if (parsed) sendToRenderer('metrics:update', hostId, parsed);
    });
  });
}

function parseMetrics(raw, m) {
  /* split by @@MARKER sections */
  const sec = {};
  let cur = null;
  for (const rawLine of String(raw).split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('@@')) {
      cur = line.slice(2).split(/\s+/)[0];
      if (!(cur in sec)) sec[cur] = [];
      continue;
    }
    if (cur) sec[cur].push(line);
  }

  let cpu = null;
  let ramPct = null, ramTotalMB = null, ramUsedMB = null;
  let load = null;
  let diskPct = null, diskTotalGB = null, diskFreeGB = null;
  let uptimeS = null;
  let os = null;
  const procs = [];
  let unsupported = true;

  /* CPU */
  const cpuLine = (sec.CPU || []).find((l) => /^cpu\s/.test(l));
  if (cpuLine) {
    unsupported = false;
    const nums = cpuLine.split(/\s+/).slice(1).map((x) => Number(x) || 0);
    if (nums.length >= 5) {
      const idle = nums[3] + nums[4];
      const total = nums.reduce((a, b) => a + b, 0);
      if (m.prevCpu && total > m.prevCpu.total) {
        const dTotal = total - m.prevCpu.total;
        const dIdle = idle - m.prevCpu.idle;
        if (dTotal > 0) cpu = Math.max(0, Math.min(100, Math.round((1 - dIdle / dTotal) * 100)));
      }
      m.prevCpu = { total, idle };
    }
  }

  /* NET — sum of all network interfaces except lo / docker / veth *,
     computes delta_bytes / delta_t => B/s speed */
  let netRxC = null, netTxC = null;
  for (const l of sec.NET || []) {
    const ci = l.indexOf(':');
    if (ci < 0) continue;
    const iface = l.slice(0, ci).trim();
    if (!iface || iface === 'lo' || /^(docker|veth|br-|virbr|vboxnet|vmnet|tailscale|zt)/.test(iface)) continue;
    const nums = l.slice(ci + 1).trim().split(/\s+/);
    if (nums.length < 9) continue;
    netRxC = (netRxC || 0) + (parseInt(nums[0], 10) || 0);
    netTxC = (netTxC || 0) + (parseInt(nums[8], 10) || 0);
  }

  /* RAM */
  const memTotal = (sec.MEM || []).find((l) => l.startsWith('MemTotal:'));
  const memAvail = (sec.MEM || []).find((l) => l.startsWith('MemAvailable:'));
  if (memTotal && memAvail) {
    unsupported = false;
    const tot = parseInt(memTotal.split(/\s+/)[1], 10);
    const avail = parseInt(memAvail.split(/\s+/)[1], 10);
    if (tot > 0) {
      ramTotalMB = Math.round(tot / 1024);
      ramUsedMB = Math.max(0, Math.round((tot - avail) / 1024));
      ramPct = Math.round(((tot - avail) / tot) * 100);
    }
  }

  /* load */
  const loadLine = (sec.LOAD || [])[0];
  if (loadLine) {
    const f = parseFloat(loadLine.split(/\s+/)[0]);
    if (!Number.isNaN(f)) {
      unsupported = false;
      load = f;
    }
  }

  /* disk */
  const dfLine = (sec.DISK || []).find((l) => /^\/.*\s+\d+/.test(l)) || (sec.DISK || [])[0];
  if (dfLine) {
    const parts = dfLine.split(/\s+/);
    const totalK = parseInt(parts[1], 10);
    if (totalK > 0) {
      unsupported = false;
      diskPct = parseInt(parts[4], 10);
      diskTotalGB = +(totalK / 1048576).toFixed(1);
      diskFreeGB = +(parseInt(parts[3], 10) / 1048576).toFixed(1);
    }
  }

  /* uptime */
  const upLine = (sec.UP || [])[0];
  if (upLine) {
    const s = parseFloat(upLine.split(/\s+/)[0]);
    if (!Number.isNaN(s)) {
      unsupported = false;
      uptimeS = Math.floor(s);
    }
  }

  /* OS */
  const osLine = (sec.OS || []).find((l) => l.startsWith('PRETTY_NAME='));
  if (osLine) {
    os = osLine.replace(/^PRETTY_NAME=["']?|["']?$/g, '');
    unsupported = false;
  }

  /* hostname + local IP addresses */
  let hostname = null;
  const ips = [];
  const hn = (sec.HOST || [])[0];
  if (hn) {
    hostname = hn;
    unsupported = false;
  }
  if (sec.IP) {
    const lines = sec.IP;
    if (lines.some((l) => l.includes('inet'))) {
      /* ip -o -4 output: "2: eth0    inet 10.0.0.5/24 ..." */
      for (const l of lines) {
        const mm = l.match(/inet\s+(\d+\.\d+\.\d+\.\d+)/);
        if (mm) ips.push(mm[1]);
      }
    } else {
      /* hostname -I output: "10.0.0.5 192.168.1.5" */
      for (const l of lines) {
        for (const tok of l.split(/\s+/)) {
          if (/^\d+\.\d+\.\d+\.\d+$/.test(tok) && !/^127\./.test(tok)) ips.push(tok);
        }
      }
    }
    if (ips.length) unsupported = false;
  }

  /* public IP — was the request included in this round? */
  if (m.pubAsked) {
    m.pubAsked = false;
    const pub = String((sec.PUBIP || []).join('') || '').trim().split(/\s+/)[0] || '';
    if (/^\d+\.\d+\.\d+\.\d+$/.test(pub)) m.pubIp = pub;
    else if (++m.pubTries >= 4) m.pubAbort = true; /* no curl/wget — give up */
  }

  /* top processes — only from the @@PS section, only plausible-looking entries */
  const nameOk = /^[A-Za-z0-9_.+\-\[\]@:()]+$/;
  for (const l of sec.PS || []) {
    const mm = l.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
    if (!mm) continue;
    const cpuV = parseFloat(mm[1]);
    const name = mm[2];
    if (!Number.isFinite(cpuV)) continue;
    if (cpuV > 100) continue;              /* garbage (uptime / error case) */
    if (!name || name.length > 40) continue;
    if (!nameOk.test(name)) continue;
    procs.push({ cpu: Math.round(cpuV), name });
  }

  if (unsupported) return null;

  /* NET speed — needs the previous counter sample (m.prevNet) */
  let netRx = null, netTx = null;
  if (netRxC != null) {
    unsupported = false;
    const now = Date.now();
    if (m.prevNet && netRxC >= m.prevNet.rx && netTxC >= m.prevNet.tx) {
      const dt = (now - m.prevNet.t) / 1000;
      if (dt >= 0.5 && dt < 240) {
        netRx = Math.round((netRxC - m.prevNet.rx) / dt);
        netTx = Math.round((netTxC - m.prevNet.tx) / dt);
      }
    }
    m.prevNet = { rx: netRxC, tx: netTxC, t: now };
  }

  const clean = procs.filter((p) => p.name && !/proc\/|meminfo|loadavg|stat$/.test(p.name)).slice(0, 3);
  return { cpu, ramPct, ramTotalMB, ramUsedMB, load, diskPct, diskTotalGB, diskFreeGB, uptimeS, os, netRx, netTx, hostname, ips, pubIp: m.pubIp || null, procs: clean };
}

/* =========================================================
   SFTP (per host, over the monitor connection)
======================================================== */

function getMonSftp(hostId) {
  const m = monitors.get(hostId);
  if (!m || !m.client) return Promise.reject(new Error('Server nije povezan — spoji se na njega.'));

  if (m.sftpP) return m.sftpP;
  m.sftpP = new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        m.sftpP = null;
        reject(new Error('SFTP kanal se ne odaziva (timeout).'));
      }
    }, 15000);
    m.client.sftp((err, sftp) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (err) {
        m.sftpP = null;
        reject(new Error(describeError(err)));
      } else {
        m.sftp = sftp;
        resolve(sftp);
      }
    });
  });
  m.sftpP.catch(() => { /* prevent unhandled */ });
  return m.sftpP;
}

function cbp(fn, ...args) {
  return new Promise((resolve, reject) => {
    fn(...args, (err, res) => (err ? reject(err) : resolve(res)));
  });
}

async function rmRemote(sftp, p, depth = 0) {
  if (depth > 20) throw new Error('Preduboka struktura foldera.');
  const st = await cbp(sftp.lstat.bind(sftp), p);
  const isDir = st && typeof st.isDirectory === 'function' ? st.isDirectory() : false;
  const isLink = !!(st && typeof st.isSymbolicLink === 'function' && st.isSymbolicLink());
  if (isDir && !isLink) {
    const list = await cbp(sftp.readdir.bind(sftp), p);
    for (const ent of list) {
      await rmRemote(sftp, (p === '/' ? '' : p.replace(/\/+$/, '')) + '/' + ent.filename, depth + 1);
    }
    await cbp(sftp.rmdir.bind(sftp), p);
  } else {
    await cbp(sftp.unlink.bind(sftp), p);
  }
}

function makeProgressReporter(op, name) {
  let last = 0;
  return (loaded, total) => {
    const now = Date.now();
    if (now - last > 120) {
      last = now;
      sendToRenderer('sftp:progress', { op, name, loaded, total });
    }
  };
}

function progressDone(op, name) {
  sendToRenderer('sftp:progress', { op, name, done: true });
}

function sortEntries(a, b) {
  return b.isDir - a.isDir || a.name.localeCompare(b.name, 'hr', { sensitivity: 'base' });
}

/* =========================================================
   SSH terminal sessions
======================================================== */

function notifyClosed(sid) {
  sendToRenderer('ssh:close', sid);
}

function teardownSession(sid) {
  const s = sessions.get(sid);
  sessions.delete(sid);
  if (s && s.client) {
    try { s.client.end(); } catch { /* ignore */ }
  }
}

async function openSession(sid, hostId) {
  const stored = readStore('trixssh-hosts.json').find((h) => h.id === hostId);
  if (!stored) {
    throw new Error('Server više nije spremljen u listi.');
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      closedRequests.delete(sid);
      reject(new Error(describeError(err)));
    };

    const client = new Client();

    let conf;
    try {
      conf = buildClientConf(stored);
    } catch (err) {
      fail(err);
      return;
    }
    conf.readyTimeout = 20000;

    let banner = '';

    client.on('banner', (d) => { banner += d.toString(); });

    client.on('keyboard-interactive', (_n, _i, _l, _p, finish) => {
      finish([decryptSecret(stored.password)]);
    });

    client.on('error', (err) => {
      fail(err);
      if (sessions.has(sid)) {
        teardownSession(sid);
        notifyClosed(sid);
      }
    });

    client.on('close', () => {
      if (sessions.has(sid)) {
        teardownSession(sid);
        notifyClosed(sid);
      }
    });

    client.on('ready', () => {
      if (closedRequests.has(sid)) {
        closedRequests.delete(sid);
        client.end();
        settled = true;
        reject(new Error('close-requested'));
        return;
      }
      client.shell({ term: 'xterm-256color' }, (err, stream) => {
        if (err) {
          client.end();
          fail(err);
          return;
        }
        const decoder = new StringDecoder('utf8');

        stream.on('data', (chunk) => {
          sendToRenderer('ssh:data', sid, decoder.write(chunk));
        });

        stream.on('close', () => {
          if (sessions.has(sid)) {
            teardownSession(sid);
            notifyClosed(sid);
          }
        });

        if (banner) stream.write(banner);

        sessions.set(sid, { client, stream });
        closedRequests.delete(sid);
        settled = true;
        resolve({ ok: true });
      });
    });

    client.connect(conf);
  });
}

/* =========================================================
   IPC
======================================================== */

/* hosts */
ipcMain.handle('hosts:list', () => SHOTS_MODE ? DEMO_HOSTS : readStore('trixssh-hosts.json').map(publicView));

ipcMain.handle('hosts:save', (_e, input) => {
  const list = readStore('trixssh-hosts.json');
  const id = input.id || crypto.randomUUID();
  const existing = list.find((h) => h.id === id);
  const secretsChanged = input.password || input.privateKey;

  const host = {
    id,
    label: String(input.label || input.host || '').trim() || String(input.host).trim(),
    host: String(input.host || '').trim(),
    port: Number.parseInt(input.port, 10) || 22,
    username: String(input.username || '').trim(),
    color: input.color || '#2bd576',
    authType: input.authType === 'key' ? 'key' : 'password',
  };

  if (host.authType === 'password') {
    if (input.password) host.password = encryptSecret(String(input.password));
    else if (existing) host.password = existing.password || '';
    else host.password = '';
    host.privateKey = existing ? existing.privateKey || '' : '';
    host.passphrase = existing ? existing.passphrase || '' : '';
  } else {
    if (input.privateKey && String(input.privateKey).includes('PRIVATE KEY')) {
      host.privateKey = encryptSecret(String(input.privateKey).replace(/\r\n/g, '\n'));
    } else if (existing) {
      host.privateKey = existing.privateKey || '';
    } else {
      host.privateKey = '';
    }
    if (input.passphrase) host.passphrase = encryptSecret(String(input.passphrase));
    else if (existing) host.passphrase = existing.passphrase || '';
    else host.passphrase = '';
    host.password = existing ? existing.password || '' : '';
  }

  const idx = list.findIndex((h) => h.id === id);
  if (idx >= 0) list[idx] = host;
  else list.push(host);
  writeStore('trixssh-hosts.json', list);

  // if secrets/changes affected an existing monitor — restart it
  if (monitors.has(id) && (secretsChanged || idx >= 0)) {
    teardownMonitor(id);
    ensureMonitor(id);
  }
  return publicView(host);
});

ipcMain.handle('hosts:delete', (_e, id) => {
  writeStore('trixssh-hosts.json', readStore('trixssh-hosts.json').filter((h) => h.id !== id));
  teardownMonitor(id);
  return true;
});

/* monitors */
ipcMain.handle('monitor:ensure', (_e, hostId) => {
  if (SHOTS_MODE) return true; /* demo shots: no real connections */
  ensureMonitor(hostId);
  return true;
});
ipcMain.handle('monitor:refresh', (_e, hostId) => {
  if (SHOTS_MODE) return true;
  teardownMonitor(hostId);
  setTimeout(() => ensureMonitor(hostId), 300);
  return true;
});

/* snippets */
ipcMain.handle('snippets:list', () => SHOTS_MODE ? DEMO_SNIPPETS : readStore('trixssh-snippets.json'));

ipcMain.handle('snippets:save', (_e, input) => {
  const list = readStore('trixssh-snippets.json');
  const id = input.id || crypto.randomUUID();
  const snip = {
    id,
    name: String(input.name || '').trim() || 'Naredba',
    cmd: String(input.cmd || ''),
  };
  const idx = list.findIndex((x) => x.id === id);
  if (idx >= 0) list[idx] = snip;
  else list.push(snip);
  writeStore('trixssh-snippets.json', list);
  return snip;
});

ipcMain.handle('snippets:delete', (_e, id) => {
  writeStore('trixssh-snippets.json', readStore('trixssh-snippets.json').filter((x) => x.id !== id));
  return true;
});

/* settings */
ipcMain.handle('settings:get', () => readSettings());
ipcMain.handle('settings:set', (_e, partial) => {
  const s = { ...readSettings(), ...(partial && typeof partial === 'object' ? partial : {}) };
  writeSettings(s);
  applyMetricInterval();
  return s;
});

/* ui state */
ipcMain.handle('ui:save', (_e, st) => {
  try {
    fs.writeFileSync(storeFile('trixssh-ui-state.json'), JSON.stringify({ openHostIds: (st && st.openHostIds) || [], savedAt: Date.now() }, null, 2), 'utf8');
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('ui:load', () => {
  try {
    return JSON.parse(fs.readFileSync(storeFile('trixssh-ui-state.json'), 'utf8'));
  } catch {
    return { openHostIds: [] };
  }
});

/* terminal sessions */
ipcMain.handle('session:open', (_e, sid, hostId) => openSession(sid, hostId));

ipcMain.on('session:input', (_e, sid, data) => {
  const s = sessions.get(sid);
  if (s && s.stream) {
    try { s.stream.write(data); } catch { /* dead */ }
  }
});

ipcMain.on('session:resize', (_e, sid, cols, rows) => {
  const s = sessions.get(sid);
  if (s && s.stream && typeof s.stream.setWindow === 'function') {
    try {
      const c = Math.max(2, Number(cols) || 80);
      const r = Math.max(2, Number(rows) || 24);
      s.stream.setWindow(r, c, r * 16, c * 8);
    } catch { /* ignore */ }
  }
});

ipcMain.handle('session:close', (_e, sid) => {
  if (sessions.has(sid)) teardownSession(sid);
  else closedRequests.add(sid);
  return true;
});

/* local FS */
function guardPath(p) {
  if (!p) return 'Prazna putanja.';
  if (p === '/' || /^[A-Za-z]:[\\/]?$/i.test(p.trim())) return 'Ova putanja je zaštićena.';
  return null;
}

ipcMain.handle('fs:home', () => SHOTS_MODE ? DEMO_LOCAL_HOME : app.getPath('home'));

ipcMain.handle('fs:list', (_e, p) => {
  if (SHOTS_MODE) return demoLocalList(p);
  try {
    let dir = p;
    if (dir === 'ROOTS') {
      if (process.platform === 'win32') {
        const roots = [];
        for (let i = 65; i <= 90; i++) {
          const d = String.fromCharCode(i) + ':\\';
          try {
            if (fs.existsSync(d)) roots.push({ name: String.fromCharCode(i) + ':', isDir: true, size: null, mtime: 0 });
          } catch { /* skip */ }
        }
        return { path: 'ROOTS', entries: roots };
      }
      dir = '/';
    }
    const dirents = fs.readdirSync(dir, { withFileTypes: true });
    const entries = [];
    for (const d of dirents) {
      try {
        const st = fs.statSync(path.join(dir, d.name));
        entries.push({ name: d.name, isDir: st.isDirectory(), size: st.isDirectory() ? null : st.size, mtime: st.mtimeMs });
      } catch {
        entries.push({ name: d.name, isDir: d.isDirectory(), size: null, mtime: 0 });
      }
    }
    entries.sort(sortEntries);
    return { path: dir, entries };
  } catch (err) {
    return { error: describeError(err) };
  }
});

ipcMain.handle('fs:mkdir', (_e, p) => {
  const bad = guardPath(p);
  if (bad) return { error: bad };
  try {
    fs.mkdirSync(p, { recursive: false });
    return { ok: true };
  } catch (err) {
    return { error: describeError(err) };
  }
});

ipcMain.handle('fs:delete', (_e, p, isDir) => {
  const bad = guardPath(p);
  if (bad) return { error: bad };
  try {
    fs.rmSync(p, { recursive: !!isDir, force: true });
    return { ok: true };
  } catch (err) {
    return { error: describeError(err) };
  }
});

ipcMain.handle('fs:rename', (_e, pFrom, pTo) => {
  try {
    fs.renameSync(pFrom, pTo);
    return { ok: true };
  } catch (err) {
    return { error: describeError(err) };
  }
});

/* dialogs */
ipcMain.handle('dialog:pickOpen', async () => {
  if (!mainWindow) return [];
  const r = await dialog.showOpenDialog(mainWindow, { title: 'Odaberi datoteke za slanje', properties: ['openFile', 'multiSelections'] });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('dialog:pickSave', async (_e, defaultName) => {
  if (!mainWindow) return null;
  const r = await dialog.showSaveDialog(mainWindow, { title: 'Spremi datoteku kao', defaultPath: defaultName || 'preuzeto.dat' });
  return r.canceled ? null : r.filePath;
});

ipcMain.handle('dialog:pickDir', async () => {
  if (!mainWindow) return null;
  const r = await dialog.showOpenDialog(mainWindow, { title: 'Odaberi mapu', properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('dialog:pickKey', async () => {
  if (!mainWindow) return null;
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Odaberi privatni ključ (OpenSSH format)',
    properties: ['openFile'],
    filters: [
      { name: 'Privatni ključ', extensions: ['id_rsa', 'id_ed25519', 'id_ecdsa', 'pem', 'key', 'ppk', 'txt'] },
      { name: 'Sve datoteke', extensions: ['*'] },
    ],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  try {
    return { name: path.basename(r.filePaths[0]), content: fs.readFileSync(r.filePaths[0], 'utf8') };
  } catch (err) {
    return { error: describeError(err) };
  }
});

/* =========================================================
   Backup / migration (password-encrypted, portable)
======================================================== */

function deriveBackupKey(password, salt) {
  return crypto.scryptSync(String(password), salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

function backupPayload() {
  const hosts = readStore('trixssh-hosts.json').map((h) => ({
    ...h,
    password: h.password ? decryptSecret(h.password) : '',
    privateKey: h.privateKey ? decryptSecret(h.privateKey) : '',
    passphrase: h.passphrase ? decryptSecret(h.passphrase) : '',
  }));
  return {
    app: 'TrixSSH',
    format: 'trixssh-backup',
    v: 1,
    createdAt: new Date().toISOString(),
    hosts,
    snippets: readStore('trixssh-snippets.json'),
    settings: readSettings(),
  };
}

ipcMain.handle('backup:export', async (_e, password) => {
  try {
    if (!mainWindow) return { error: 'Prozor nije aktivan.' };
    if (!password || String(password).length < 4) return { error: 'Lozinka mora imati barem 4 znaka.' };

    const r = await dialog.showSaveDialog(mainWindow, {
      title: 'Spremi šifrirani backup',
      defaultPath: `trixssh-backup-${new Date().toISOString().slice(0, 10)}.trixbak`,
      filters: [{ name: 'TrixSSH backup', extensions: ['trixbak'] }],
    });
    if (r.canceled || !r.filePath) return { canceled: true };

    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = deriveBackupKey(password, salt);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const pt = Buffer.from(JSON.stringify(backupPayload()), 'utf8');
    const enc = Buffer.concat([cipher.update(pt), cipher.final()]);
    const tag = cipher.getAuthTag();

    const file = {
      app: 'TrixSSH',
      format: 'trixssh-backup-enc',
      v: 1,
      createdAt: new Date().toISOString(),
      kdf: 'scrypt',
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      data: enc.toString('base64'),
    };
    fs.writeFileSync(r.filePath, JSON.stringify(file, null, 2), 'utf8');
    return { ok: true, path: r.filePath, hosts: backupPayloadHostsCount() };
  } catch (err) {
    return { error: describeError(err) };
  }
});

function backupPayloadHostsCount() {
  try {
    return readStore('trixssh-hosts.json').length;
  } catch {
    return 0;
  }
}

ipcMain.handle('backup:import', async (_e, password) => {
  try {
    if (!mainWindow) return { error: 'Prozor nije aktivan.' };
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Uvezi šifrirani backup',
      properties: ['openFile'],
      filters: [{ name: 'TrixSSH backup', extensions: ['trixbak'] }, { name: 'Sve datoteke', extensions: ['*'] }],
    });
    if (r.canceled || !r.filePaths[0]) return { canceled: true };

    const raw = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8').replace(/^\uFEFF/, ''));
    if (!raw || raw.format !== 'trixssh-backup-enc' || !raw.data) {
      return { error: 'Ova datoteka nije TrixSSH šifrirani backup.' };
    }

    const salt = Buffer.from(raw.salt, 'base64');
    const iv = Buffer.from(raw.iv, 'base64');
    const tag = Buffer.from(raw.tag, 'base64');
    const data = Buffer.from(raw.data, 'base64');
    let payload;
    try {
      const key = deriveBackupKey(password, salt);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      payload = JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
    } catch {
      return { error: 'Pogrešna lozinka ili oštećena datoteka backupa.' };
    }

    if (!payload || !Array.isArray(payload.hosts)) return { error: 'Backup ne sadrži servere.' };

    /* re-encrypt secrets with this machine (DPAPI) and merge by id */
    const curHosts = readStore('trixssh-hosts.json');
    let newHosts = 0;
    for (const h of payload.hosts) {
      const incoming = { ...h };
      if (incoming.password) incoming.password = encryptSecret(String(incoming.password));
      if (incoming.privateKey) incoming.privateKey = encryptSecret(String(incoming.privateKey).replace(/\r\n/g, '\n'));
      if (incoming.passphrase) incoming.passphrase = encryptSecret(String(incoming.passphrase));
      const i = curHosts.findIndex((x) => x.id === incoming.id);
      if (i >= 0) curHosts[i] = incoming;
      else { curHosts.push(incoming); newHosts++; }
    }
    writeStore('trixssh-hosts.json', curHosts);

    let newSnips = 0;
    if (Array.isArray(payload.snippets)) {
      const curSnips = readStore('trixssh-snippets.json');
      for (const s of payload.snippets) {
        const i = curSnips.findIndex((x) => x.id === s.id);
        if (i >= 0) curSnips[i] = s;
        else { curSnips.push(s); newSnips++; }
      }
      writeStore('trixssh-snippets.json', curSnips);
    }

    if (payload.settings && typeof payload.settings === 'object') {
      const curSettings = readSettings();
      writeSettings({ ...curSettings, ...payload.settings });
    }

    return {
      ok: true,
      hosts: payload.hosts.length,
      newHosts,
      snips: Array.isArray(payload.snippets) ? payload.snippets.length : 0,
      newSnips,
    };
  } catch (err) {
    return { error: describeError(err) };
  }
});

/* SFTP per host */
ipcMain.handle('sftp:list', async (_e, hostId, p) => {
  if (SHOTS_MODE) return demoRemoteList(p);
  try {
    const sftp = await getMonSftp(hostId);
    const list = await cbp(sftp.readdir.bind(sftp), p);
    const entries = list.map((ent) => ({
      name: ent.filename,
      isDir: !!(ent.attrs && typeof ent.attrs.isDirectory === 'function' && ent.attrs.isDirectory()),
      size: ent.attrs && typeof ent.attrs.isDirectory === 'function' && ent.attrs.isDirectory() ? null : (ent.attrs ? ent.attrs.size : null),
      mtime: ent.attrs && ent.attrs.mtime ? ent.attrs.mtime * 1000 : 0,
    }));
    entries.sort(sortEntries);
    return { path: p, entries };
  } catch (err) {
    return { error: describeError(err) };
  }
});

ipcMain.handle('sftp:home', async (_e, hostId) => {
  if (SHOTS_MODE) return { home: DEMO_REMOTE_HOME };
  try {
    const sftp = await getMonSftp(hostId);
    const home = await cbp(sftp.realpath.bind(sftp), '.');
    return { home };
  } catch (err) {
    return { error: describeError(err) };
  }
});

ipcMain.handle('sftp:mkdir', async (_e, hostId, p) => {
  try {
    const sftp = await getMonSftp(hostId);
    await cbp(sftp.mkdir.bind(sftp), p);
    return { ok: true };
  } catch (err) {
    return { error: describeError(err) };
  }
});

ipcMain.handle('sftp:delete', async (_e, hostId, p, isDir) => {
  try {
    const sftp = await getMonSftp(hostId);
    if (isDir) await rmRemote(sftp, p);
    else await cbp(sftp.unlink.bind(sftp), p);
    return { ok: true };
  } catch (err) {
    return { error: describeError(err) };
  }
});

ipcMain.handle('sftp:rename', async (_e, hostId, pFrom, pTo) => {
  try {
    const sftp = await getMonSftp(hostId);
    await cbp(sftp.rename.bind(sftp), pFrom, pTo);
    return { ok: true };
  } catch (err) {
    return { error: describeError(err) };
  }
});

ipcMain.handle('sftp:upload', async (_e, hostId, localPath, remotePath) => {
  try {
    const sftp = await getMonSftp(hostId);
    const name = path.basename(localPath);
    const report = makeProgressReporter('up', name);
    await cbp(sftp.fastPut.bind(sftp), localPath, remotePath, {
      step: (transferred, _chunk, total) => report(transferred, total),
    });
    progressDone('up', name);
    return { ok: true };
  } catch (err) {
    return { error: describeError(err) };
  }
});

ipcMain.handle('sftp:download', async (_e, hostId, remotePath, savePath) => {
  try {
    const sftp = await getMonSftp(hostId);
    let total = 0;
    try {
      const st = await cbp(sftp.stat.bind(sftp), remotePath);
      total = st ? st.size : 0;
    } catch { /* 0 */ }
    const name = remotePath.split('/').filter(Boolean).pop() || 'datoteka';
    const report = makeProgressReporter('down', name);
    await new Promise((resolve, reject) => {
      const rs = sftp.createReadStream(remotePath);
      const ws = fs.createWriteStream(savePath);
      let loaded = 0;
      rs.on('data', (chunk) => {
        loaded += chunk.length;
        report(loaded, total);
      });
      rs.on('error', reject);
      ws.on('error', reject);
      ws.on('finish', resolve);
      rs.pipe(ws);
    });
    progressDone('down', name);
    return { ok: true };
  } catch (err) {
    return { error: describeError(err) };
  }
});

/* ---------- recursive folder transfers ---------- */

function collectLocalFiles(dir, rel, out) {
  let dirents;
  try { dirents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const d of dirents) {
    const abs = path.join(dir, d.name);
    const rrel = rel ? rel + '/' + d.name : d.name;
    if (d.isDirectory()) collectLocalFiles(abs, rrel, out);
    else {
      let size = 0;
      try { size = fs.statSync(abs).size; } catch { /* 0 */ }
      out.push({ abs, rel: rrel, size });
    }
  }
}

function remoteParent(p) {
  const s = String(p).replace(/\/+$/, '');
  const i = s.lastIndexOf('/');
  return i <= 0 ? '/' : s.slice(0, i);
}

async function remoteMkdirp(sftp, p) {
  const parts = String(p).split('/').filter(Boolean);
  let cur = '';
  for (const part of parts) {
    cur = cur + '/' + part;
    try { await cbp(sftp.mkdir.bind(sftp), cur); } catch { /* already exists — continue */ }
  }
}

async function uploadDirTo(hostId, sftp, localDir, remoteDir) {
  const folderName = path.basename(localDir);
  const files = [];
  collectLocalFiles(localDir, '', files);
  await remoteMkdirp(sftp, remoteDir);
  if (!files.length) {
    progressDone('up', folderName);
    return;
  }
  const total = files.reduce((a, f) => a + (f.size || 0), 0);
  let loaded = 0;
  let last = 0;
  for (const f of files) {
    const target = String(remoteDir).replace(/\/+$/, '') + '/' + f.rel;
    await remoteMkdirp(sftp, remoteParent(target));
    await new Promise((resolve, reject) => {
      sftp.fastPut(f.abs, target, {
        step: (t) => {
          const now = Date.now();
          if (now - last > 120) {
            last = now;
            sendToRenderer('sftp:progress', { op: 'up', name: folderName + '/' + f.rel, loaded: loaded + t, total: total || 0 });
          }
        },
      }, (err) => (err ? reject(err) : resolve()));
    });
    loaded += f.size || 0;
  }
  progressDone('up', folderName);
}

async function downloadDirFrom(sftp, remoteDir, localDir) {
  const name = String(remoteDir).split('/').filter(Boolean).pop() || 'mapa';
  let grandTotal = 0;
  try {
    const ents = await cbp(sftp.readdir.bind(sftp), remoteDir);
    grandTotal = ents.reduce((a, e) => a + (e.attrs && !e.attrs.isDirectory ? 0 : (e.attrs.isDirectory() ? 0 : (e.attrs.size || 0))), 0);
  } catch { /* start at 0 = indeterminate */ }
  let loaded = 0;
  let last = 0;

  const walk = async (rdir, ldir, prefix) => {
    await fs.promises.mkdir(ldir, { recursive: true });
    const ents = await cbp(sftp.readdir.bind(sftp), rdir);
    for (const ent of ents) {
      const rchild = String(rdir).replace(/\/+$/, '') + '/' + ent.filename;
      const lchild = path.join(ldir, ent.filename);
      const relName = prefix + ent.filename;
      const isDir = !!(ent.attrs && typeof ent.attrs.isDirectory === 'function' && ent.attrs.isDirectory());
      if (isDir) {
        await walk(rchild, lchild, relName + '/');
      } else {
        const fsize = ent.attrs ? (ent.attrs.size || 0) : 0;
        await new Promise((resolve, reject) => {
          sftp.fastGet(rchild, lchild, {
            step: (t) => {
              const now = Date.now();
              if (now - last > 120) {
                last = now;
                sendToRenderer('sftp:progress', { op: 'down', name: name + '/' + relName, loaded: loaded + t, total: grandTotal || 0 });
              }
            },
          }, (err) => (err ? reject(err) : resolve()));
        });
        loaded += fsize;
      }
    }
  };
  await walk(remoteDir, localDir, '');
  progressDone('down', name);
}

ipcMain.handle('sftp:uploadDir', async (_e, hostId, localDir, remoteDir) => {
  try {
    const sftp = await getMonSftp(hostId);
    await uploadDirTo(hostId, sftp, localDir, remoteDir);
    return { ok: true };
  } catch (err) {
    return { error: describeError(err) };
  }
});

ipcMain.handle('sftp:downloadDir', async (_e, hostId, remoteDir, localDir) => {
  try {
    const sftp = await getMonSftp(hostId);
    await downloadDirFrom(sftp, remoteDir, localDir);
    return { ok: true };
  } catch (err) {
    return { error: describeError(err) };
  }
});

/* =========================================================
   Updates — HTTP helpers + check
======================================================== */

function httpDownload(u, destOrNull, onProgress) {
  return new Promise((resolve, reject) => {
    const go = (url, redirects) => {
      if (redirects > 5) { reject(new Error('Previše preusmjeravanja.')); return; }

      /* local path or file:/// */
      if (/^file:/i.test(url) || /^[A-Za-z]:[\\/]/.test(url)) {
        try {
          const p = decodeURIComponent(/^file:/i.test(url) ? url.replace(/^file:\/\/\//, '') : url);
          const st = fs.statSync(p);
          const total = st.size;
          const chunks = [];
          const rs = fs.createReadStream(p);
          let loaded = 0;
          rs.on('data', (c) => {
            loaded += c.length;
            if (destOrNull) { /* written to a file in the other branch */ }
            chunks.push(c);
            if (onProgress) onProgress(loaded, total);
          });
          rs.on('error', reject);
          rs.on('end', () => {
            try {
              const buf = Buffer.concat(chunks);
              if (destOrNull) {
                fs.mkdirSync(path.dirname(destOrNull), { recursive: true });
                fs.writeFileSync(destOrNull, buf);
                resolve({ path: destOrNull, total });
              } else {
                resolve({ buffer: buf, total });
              }
            } catch (e) { reject(e); }
          });
        } catch (err) { reject(err); }
        return;
      }

      const mod = url.startsWith('https://') ? https : url.startsWith('http://') ? http : null;
      if (!mod) { reject(new Error('Nepodržan URL: ' + url)); return; }
      try {
        /* watchdog until headers arrive: req.setTimeout doesn't work before the socket
           connects (e.g. DNS hangs) — this kills the request regardless of connection phase */
        const watchdog = setTimeout(
          () => req.destroy(new Error('Update server ne odgovara (isteklo vrijeme spajanja).')),
          20000,
        );
        const req = mod.get(url, { headers: { 'User-Agent': 'TrixSSH-Updater' } }, (res) => {
          clearTimeout(watchdog);
          const status = res.statusCode || 0;
          if ([301, 302, 307, 308].includes(status) && res.headers.location) {
            res.resume();
            go(new URL(res.headers.location, url).toString(), redirects + 1);
            return;
          }
          if (status !== 200) {
            res.resume();
            reject(new Error(`Server vratio status ${status}.`));
            return;
          }
          const total = parseInt(res.headers['content-length'], 10) || 0;
          /* watchdog for the response body — a stream that stalls (no data and no end)
             would otherwise wait forever; reset on every incoming chunk */
          let idle = null;
          const resetIdle = () => {
            if (idle) clearTimeout(idle);
            idle = setTimeout(
              () => req.destroy(new Error('Preuzimanje zapelo (istek neaktivnosti).')),
              45000,
            );
          };
          resetIdle();
          const chunks = destOrNull ? null : [];
          let loaded = 0;
          let ws = null;
          if (destOrNull) {
            fs.mkdirSync(path.dirname(destOrNull), { recursive: true });
            ws = fs.createWriteStream(destOrNull);
          }
          res.on('data', (c) => {
            resetIdle();
            loaded += c.length;
            if (chunks) chunks.push(c);
            if (onProgress) onProgress(loaded, total);
          });
          if (ws) res.pipe(ws);
          res.on('error', reject);
          res.on('end', () => {
            if (idle) clearTimeout(idle);
            if (ws) {
              ws.on('finish', () => resolve({ path: destOrNull, total }));
              ws.on('error', reject);
            } else {
              resolve({ buffer: Buffer.concat(chunks), total });
            }
          });
        });
        req.on('error', reject);
        req.setTimeout(20000, () => req.destroy(new Error('Isteklo vrijeme spajanja na update server.')));
      } catch (err) { reject(err); }
    };
    go(u, 0);
  });
}

function newestVersion(a, b) {
  const pa = String(a).split(/[.\-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split(/[.\-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 4; i++) {
    const va = pa[i] || 0, vb = pb[i] || 0;
    if (va !== vb) return va > vb;
  }
  return false;
}

function updateManifestUrl() {
  if (process.env.TRIX_UPDATE_MANIFEST) return process.env.TRIX_UPDATE_MANIFEST;
  const s = readSettings();
  if (s.updateUrl) return s.updateUrl;
  return UPDATE_MANIFEST_URL;
}

function checkForUpdates(manual = false) {
  let url = updateManifestUrl();
  if (!url) {
    if (manual) sendToRenderer('update:checkResult', { error: 'Update izvor nije postavljen (UPDATE_MANIFEST_URL).' });
    return;
  }
  /* cache-buster — raw.githubusercontent.com (CDN) serves the stale
     latest.json for several minutes after a push, so a new version "doesn't exist" even though it was published.
     ONLY for http(s) — local paths/file:// skip this loop (stat on ?t= is ENOENT) */
  const buster = (u) => (/^https?:\/\//i.test(u) ? u + (u.includes('?') ? '&' : '?') + 't=' + Date.now() : u);
  /* a manual check during an in-flight auto check must not be silent — it waits
     for the current check to end, then the result is ALWAYS reported (modal or toast) */
  if (updateBusy) { if (manual) pendingManualCheck = true; return; }
  updateBusy = true;
  if (manual) pendingManualCheck = true;
  /* the fallback source is tried while the primary (raw CDN cache) lags */
  const urls = url === UPDATE_MANIFEST_URL ? [buster(url), buster(UPDATE_MANIFEST_FALLBACK_URL)] : [buster(url)];

  /* at the end of each check (submit check) — notify the renderer only if a manual answer is pending */
  const finishCheck = (err) => {
    updateBusy = false;
    if (process.env.TRIX_TEST === 'upd') console.log('[upd-finish]', err ? (err.stack || err.message) : 'no error');
    if (!pendingManualCheck) return;
    pendingManualCheck = false;
    if (updateLatest && newestVersion(updateLatest.version, app.getVersion())) {
      sendToRenderer('update:available', {
        version: updateLatest.version,
        notes: updateLatest.notes,
        current: app.getVersion(),
      });
    } else if (err) {
      sendToRenderer('update:checkResult', { error: (describeError && describeError(err)) || String(err) });
    } else if (updateLatest) {
      sendToRenderer('update:checkResult', { current: app.getVersion() });
    } else {
      sendToRenderer('update:checkResult', { error: 'Update izvor nedostupan.' });
    }
  };

  let lastErr = null;
  const attempt = (i) => {
    if (i >= urls.length) { finishCheck(lastErr || new Error('Update izvor nedostupan.')); return; }
    if (process.env.TRIX_TEST === 'upd') console.log('[upd-fetch]', urls[i]);
    httpDownload(urls[i], null, null)
      .then(({ buffer }) => {
        const manifest = JSON.parse(buffer.toString('utf8').replace(/^\uFEFF/, ''));
        if (!manifest || !manifest.version) throw new Error('Krivi format latest.json.');
        updateLatest = { version: String(manifest.version), url: String(manifest.url || ''), macUrl: String(manifest.macUrl || ''), linuxUrl: String(manifest.linuxUrl || ''), notes: String(manifest.notes || '') };
        if (process.env.TRIX_TEST === 'upd') {
          console.log('[upd-debug]', JSON.stringify({ url: urls[i], seen: updateLatest.version, cur: app.getVersion(), newer: newestVersion(app.getVersion(), updateLatest.version) }));
        }
        if (!newestVersion(updateLatest.version, app.getVersion())) {
          finishCheck();
          return;
        }
        /* "Later" — skip silently only (auto); manual (or pending) always shows the modal */
        if (!manual && !pendingManualCheck && updateLaterVersion === updateLatest.version) {
          finishCheck();
          return;
        }
        pendingManualCheck = false;
        updateBusy = false;
        sendToRenderer('update:available', {
          version: updateLatest.version,
          notes: updateLatest.notes,
          current: app.getVersion(),
        });
      })
      .catch((err) => { lastErr = err; attempt(i + 1); });
  };
  attempt(0);
}

ipcMain.handle('app:info', () => ({ version: app.getVersion() }));

/* opening external links (about) */
const ALLOWED_URL = /^(https:\/\/|http:\/\/|mailto:)/i;
ipcMain.handle('app:openExternal', async (_e, url) => {
  const u = String(url || '');
  if (!ALLOWED_URL.test(u) || u.length > 800) return { error: 'Nevažeći URL.' };
  await shell.openExternal(u);
  return { ok: true };
});

ipcMain.handle('update:check', () => {
  checkForUpdates(true);
  return true;
});

ipcMain.handle('update:download', async () => {
  if (!updateLatest) return { error: 'Nije dostupna verzija za preuzimanje.' };

  /* macOS/Linux without an installer: open the download in the browser */
  if (!IS_WIN) {
    const url = platformUpdateUrl(updateLatest);
    if (!url) return { error: 'Nije dostupna verzija za preuzimanje.' };
    await shell.openExternal(url);
    return { ok: true, external: true };
  }

  if (!updateLatest.url) return { error: 'Nije dostupna verzija za preuzimanje.' };
  const dest = path.join(app.getPath('temp'), `TrixSSH-Setup-${updateLatest.version}.exe`);
  try {
    await httpDownload(updateLatest.url, dest, (loaded, total) => {
      sendToRenderer('update:progress', { loaded, total });
    });
    updateFile = dest;
    sendToRenderer('update:ready', { file: dest });
    return { ok: true };
  } catch (err) {
    return { error: describeError(err) };
  }
});

ipcMain.handle('update:install', () => {
  if (!IS_WIN) return { error: 'Instaler nije dostupan na ovoj platformi.' };
  if (!updateFile || !fs.existsSync(updateFile)) {
    sendToRenderer('update:checkResult', { error: 'Instaler nije preuzet.' });
    return { error: 'Instaler nije preuzet.' };
  }
  try {
    const child = spawn(updateFile, ['/S'], { detached: true, stdio: 'ignore' });
    child.unref();
    quitting = true;
    setTimeout(() => app.quit(), 600);
    return { ok: true };
  } catch (err) {
    return { error: describeError(err) };
  }
});

ipcMain.on('update:later', () => {
  if (updateLatest) updateLaterVersion = updateLatest.version;
});

/* =========================================================
   Tray & window
======================================================== */

/* tray labels per language (minimal set) */
const TRAY_LABELS = {
  hr: ['Otvori TrixSSH', 'Izađi'],
  en: ['Open TrixSSH', 'Exit'],
  de: ['TrixSSH öffnen', 'Beenden'],
  fr: ['Ouvrir TrixSSH', 'Quitter'],
  it: ['Apri TrixSSH', 'Esci'],
  bs: ['Otvori TrixSSH', 'Izađi'],
  sr: ['Otvori TrixSSH', 'Izađi'],
};

/* app icon (dev and packaged — asar); macOS/Linux prefer the PNG */
function appIcon() {
  try {
    const png = path.join(__dirname, 'assets', 'icon.png');
    const ico = path.join(__dirname, 'assets', 'icon.ico');
    const first = process.platform === 'win32' ? ico : png;
    const second = process.platform === 'win32' ? png : ico;
    if (fs.existsSync(first)) return nativeImage.createFromPath(first);
    if (fs.existsSync(second)) return nativeImage.createFromPath(second);
  } catch { /* */ }
  return undefined;
}

/* icon for the status bar (tray) — small compact logo version without the light frame;
   the large app icon at 16px looks like a murky pale blob, so the tray has its own */
function trayIcon() {
  try {
    const ico = path.join(__dirname, 'assets', 'tray.ico');
    const png = path.join(__dirname, 'assets', 'tray.png');
    if (process.platform === 'win32') {
      if (fs.existsSync(ico)) return nativeImage.createFromPath(ico);
      if (fs.existsSync(png)) return nativeImage.createFromPath(png);
      return appIcon();
    }
    if (fs.existsSync(png)) return nativeImage.createFromPath(png);
  } catch { /* */ }
  return undefined;
}

function ensureTray() {
  if (tray || !app.dock) {
    if (tray) return;
  }
  try {
    if (!tray) {
      tray = new Tray(trayIcon() || nativeImage.createEmpty());
      const tl = TRAY_LABELS[(readSettings().lang) || 'hr'] || TRAY_LABELS.hr;
      const menu = Menu.buildFromTemplate([
        { label: tl[0], click: () => { showWindow(); } },
        { type: 'separator' },
        { label: tl[1], click: () => { quitting = true; app.quit(); } },
      ]);
      tray.setToolTip('TrixSSH');
      tray.setContextMenu(menu);
      tray.on('click', () => showWindow());
    }
  } catch { /* tray is not critical */ }
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/* ---------- demo screenshots (set TRIX_SHOTS=1) — all data is FAKE ---------- */

function runDemoShots() {
  const wc = mainWindow.webContents;
  const outDir = path.join(app.getAppPath(), 'docs', 'screenshots');
  fs.mkdirSync(outDir, { recursive: true });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name) => {
    const img = await wc.capturePage();
    fs.writeFileSync(path.join(outDir, `${name}.png`), img.toPNG());
    console.log(`[SHOTS] ${name} ✓`);
  };
  const js = (code) => wc.executeJavaScript(code).catch((e) => console.log('[SHOTS] js err:', e));

  /* fake hosts — documentation TEST-NET addresses (RFC 5737); no real data */
  const FAKE_SETUP = `
    (() => {
      state.settings.streamerMode = false;
      state.hosts = [
        { id:'demo1', label:'web-prod', host:'203.0.113.10',  port:22, username:'deploy', color:'#22c55e', authType:'key' },
        { id:'demo2', label:'db-main',  host:'198.51.100.42', port:22, username:'root',   color:'#8b5cf6', authType:'password' },
      ];
      state.snippets = [
        { id:'s1', name:'System info',    cmd:'uname -a && uptime' },
        { id:'s2', name:'Disk usage',     cmd:'df -h' },
        { id:'s3', name:'Top memory',     cmd:'ps aux --sort=-%mem | head -8' },
        { id:'s4', name:'Services',       cmd:'systemctl list-units --type=service --state=running | head -12' },
        { id:'s5', name:'Nginx errors',      cmd:'tail -60 /var/log/nginx/error.log' },
        { id:'s6', name:'Restart service',   cmd:'systemctl restart my-app && sleep 1 && systemctl status my-app --no-pager' },
      ];
      /* fake monitors — no real connections */
      state.monitors.set('demo1', {
        status: 'online',
        metrics: {
          cpu: 23, ramPct: 41, ramUsedMB: 1618, ramTotalMB: 3950,
          diskPct: 37, diskTotalGB: 80, diskFreeGB: 50.4,
          uptimeS: 9*86400 + 5*3600, os: 'Ubuntu 24.04 LTS',
          procs: [ {name:'nginx', cpu:14}, {name:'mysqld', cpu:9.4}, {name:'redis-server', cpu:3.1} ],
        },
      });
      state.monitors.set('demo2', {
        status: 'online',
        metrics: {
          cpu: 47, ramPct: 62, ramUsedMB: 4850, ramTotalMB: 7800,
          diskPct: 19, diskTotalGB: 500, diskFreeGB: 405,
          uptimeS: 32*86400 + 11*3600, os: 'Debian 12',
          procs: [ {name:'postgres', cpu:26}, {name:'docker', cpu:12.7}, {name:'node', cpu:8.2} ],
        },
      });
      renderConnections(); renderDashboard(); renderSnippets(); updateCounts();
    })();
  `;

  /* fake SFTP content — generic names, nothing real */
  const FAKE_SFTP = `
    (() => {
      const rp = window.TRX.sftpPage;
      rp.ensure();
      const L = rp.refreshes.local, R = rp.refreshes.remote;
      const now = Date.now();
      const mk = (name, isDir, size, hrsOld) => ({ name, isDir, size, mtime: now - hrsOld * 3600e3 });
      const row = (e) => {
        const r = document.createElement('div');
        r.className = 'sftp-row';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'f-cb';
        r.appendChild(cb);
        r.appendChild(el('span', 'f-ic', e.isDir ? '\\ud83d\\uddc1' : '\\ud83d\\udcc4'));
        r.appendChild(el('span', 'f-name', e.name));
        r.appendChild(el('span', 'f-size', e.isDir ? '*' : T.fmtSize(e.size)));
        r.appendChild(el('span', 'f-date', T.fmtDate(e.mtime)));
        return r;
      };
      /* LOCAL — Windows local */
      L.entries = [
        mk('web-app',        true,  null,    3),
        mk('docs',           true,  null,   52),
        mk('scripts',        true,  null,  120),
        mk('deploy.sh',      false, 2143,    3),
        mk('backup-routine.ps1', false, 1481, 9),
        mk('README.md',      false,  742,   26),
        mk('notes.txt',      false,  318,  214),
        mk('assets-2026-04-11.zip', false, 85367808, 100),
      ];
      L.path = 'C:\\\\Users\\\\demo\\\\projects';
      L.bar.value = L.path;
      L.sel.clear();
      L.driveSel.innerHTML = '';
      const o = document.createElement('option');
      o.value = 'C:'; o.textContent = 'C:';
      L.driveSel.appendChild(o);
      L.driveSel.value = 'C:';
      L.list.innerHTML = '';
      for (const e of L.entries) L.list.appendChild(row(e));
      /* REMOTE — unix server */
      R.entries = [
        mk('releases',        true, null,   2),
        mk('shared',          true, null, 146),
        mk('logs',            true, null,   1),
        mk('storage',         true, null,  74),
        mk('app.js',          false, 12874, 5),
        mk('nginx.conf',      false, 4321, 146),
        mk('maintenance.html', false, 971, 220),
        mk('release-2026.04.11.tar.gz', false, 41825824, 5),
      ];
      R.path = '/var/www/app';
      R.bar.value = R.path;
      R.sel.clear();
      R.hostSel.innerHTML = '<option value="demo1">web-prod</option><option value="demo2">db-main</option>';
      R.hostSel.value = 'demo1';
      R.list.innerHTML = '';
      for (const e of R.entries) R.list.appendChild(row(e));
    })();
  `;

  (async () => {
    try {
      await sleep(1500);
      /* wait for the initial state (fake hosts from IPC) to load */
      for (let i = 0; i < 40; i++) {
        const n = await wc.executeJavaScript('state.hosts.length').catch(() => 0);
        if (n > 0) break;
        await sleep(150);
      }
      /* fake metrics + re-render (real hosts are never used) */
      await js(FAKE_SETUP);
      /* 1: dashboard */
      await js(`setView('dashboard'); renderDashboard();`);
      await sleep(1000);
      await shot('dashboard');
      /* 2: commands */
      await js(`setView('snippets')`);
      await sleep(800);
      await shot('snippets');
      /* 3: SFTP — server picker (from fake hosts) */
      await js(`setView('sftp')`);
      await sleep(900);
      await shot('sftp-picker');
      /* 4: SFTP with fake content — no real call at all */
      await js(`closeHostPicker()`);
      await js(FAKE_SFTP);
      await sleep(900);
      await shot('sftp');
      /* 5: settings — scroll to languages/updates */
      await js(`closeHostPicker(); setView('settings')`);
      await sleep(500);
      await js(`(() => { const sc = document.querySelector('#viewSettings .page-scroll'); if (sc) sc.scrollTop = 330; })()`);
      await sleep(500);
      await shot('settings');
      /* 6: "New server" modal */
      await js(`setView('dashboard'); openHostModal()`);
      await sleep(900);
      await shot('host-modal');
      await js(`els.hostModal.classList.add('hidden')`);
      console.log('[SHOTS] gotovo → ' + outDir);
      console.log('[SHOTS] (svi podaci su fake — bez pravih servera, datoteka ili metrike)');
    } catch (err) {
      console.log('[SHOTS] neuspjelo:', err && err.message);
    }
    app.quit();
  })();
}

function createWindow() {
  if (process.env.TRIX_TEST === '1') {
    try {
      const seedPath = storeFile('trixssh-hosts.json');
      if (!fs.existsSync(seedPath)) {
        const seed = [{
          id: 'test1', label: 'TEST-LOCAL', host: '127.0.0.1', port: 59999,
          username: 'root', color: '#2bd576', authType: 'password',
          password: 'plain:test', privateKey: '', passphrase: '',
        }];
        fs.mkdirSync(app.getPath('userData'), { recursive: true });
        fs.writeFileSync(seedPath, JSON.stringify(seed, null, 2), 'utf8');
      }
    } catch { /* test-only */ }
  }

  const settings = readSettings();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: settings.theme === 'light' ? '#f3f4f8' : '#0a0c14',
    title: 'TrixSSH',
    icon: appIcon(),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (process.env.TRIX_SHOTS === '1') runDemoShots();
  });

  mainWindow.on('minimize', () => {
    if (readSettings().minimizeToTray) {
      ensureTray();
      mainWindow.hide();
    }
  });

  mainWindow.on('close', (e) => {
    if (quitting) return;
    const s = readSettings();
    if (s.closeToTray) {
      e.preventDefault();
      ensureTray();
      mainWindow.hide();
      return;
    }
    if (s.askBeforeQuit && sessions.size > 0) {
      e.preventDefault();
      dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Izađi', 'Odustani'],
        defaultId: 0,
        cancelId: 1,
        message: `Otvoreno je ${sessions.size} SSH veza.`,
        detail: 'Zatvaranjem aplikacije prekidaju se terminal veze. Jesi li siguran?',
      }).then((r) => {
        if (r.response === 0) {
          quitting = true;
          app.quit();
        }
      });
      return;
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  /* diagnostics/probe */
  if (process.env.TRIX_TEST === '1') {
    mainWindow.webContents.on('console-message', (_e, _l, message, line, sourceId) => {
      const src = String(sourceId || '').split(/[\\/]/).pop();
      console.log('[renderer]', `${src}:${line}`, '-', String(message).slice(0, 300));
    });
    mainWindow.webContents.executeJavaScript(
      `(async () => {
        await new Promise(r => setTimeout(r, 1800));
        const info = {
          nav: document.querySelectorAll('.nav-item').length,
          views: document.querySelectorAll('.view').length,
          dashCards: document.querySelectorAll('.dash-card').length,
          statusbar: !!document.getElementById('sbCounts'),
        };
        // click the terminal nav
        const termNav = [...document.querySelectorAll('.nav-item')].find(n => n.dataset.view === 'terminal');
        if (termNav) termNav.click();
        await new Promise(r => setTimeout(r, 400));
        const cardSh = document.querySelector('.dash-card [data-act="sh"]');
        if (cardSh) cardSh.click();
        await new Promise(r => setTimeout(r, 2500));
        info.tabs = document.querySelectorAll('.tab').length;
        const tw = document.querySelector('#viewTerminal .term-wrap:not(.hidden)');
        info.xterm = !!(tw && tw.querySelector('.xterm'));
        info.settings = true;
        const setNav = [...document.querySelectorAll('.nav-item')].find(n => n.dataset.view === 'settings');
        if (setNav) setNav.click();
        await new Promise(r => setTimeout(r, 300));
        info.settingsRows = document.querySelectorAll('.set-card').length;
        return JSON.stringify(info);
      })()`,
      true
    ).then((v) => console.log('[PROBE]', v)).catch((err) => console.log('[PROBE-ERR]', String(err)));
  } else if (process.env.TRIX_TEST === 'sftp') {
    mainWindow.webContents.on('console-message', (_e, _l, message) => {
      if (String(message).startsWith('[STATUS]') || String(message).startsWith('[SF')) console.log('[renderer-out]', message);
    });
    mainWindow.webContents.executeJavaScript(
      `(async () => {
        await new Promise(r => setTimeout(r, 1500));
        const hs = await window.trix.listHosts();
        console.log('[SFhosts]', JSON.stringify(hs.map(h => h.label + ':' + h.authType)));
        if (hs.length) {
          const hid = hs[0].id;
          window.trix.onMonitorStatus((id, st, err) => console.log('[STATUS]', st, err || ''));
          await window.trix.monitorEnsure(hid);
          await new Promise(r => setTimeout(r, 12000));
          const home = await window.trix.remoteHome(hid);
          console.log('[SFhome]', JSON.stringify(home));
          const list = await window.trix.remoteList(hid, '/');
          console.log('[SFlist]', JSON.stringify({ err: list.error, n: (list.entries || []).length, first: (list.entries || [])[0] }));
        }
        await new Promise(r => setTimeout(r, 300));
        window.close();
      })()`,
      true
    ).then((v) => console.log('[SFTP-PROBE-END]', v)).catch((err) => console.log('[SFTP-PROBE-ERR]', String(err)));
  } else if (process.env.TRIX_TEST === 'sftp2') {
    const srcDir = path.join(app.getPath('home'), '.trixssh-selftest-src');
    const dstDir = path.join(app.getPath('home'), '.trixssh-selftest-dst');
    try { fs.rmSync(srcDir, { recursive: true, force: true }); } catch { /* */ }
    try { fs.rmSync(dstDir, { recursive: true, force: true }); } catch { /* */ }
    try {
      fs.mkdirSync(path.join(srcDir, 'sub'), { recursive: true });
      fs.writeFileSync(path.join(srcDir, 'file-a.txt'), 'ABC' + 'x'.repeat(2000));
      fs.writeFileSync(path.join(srcDir, 'sub', 'file-b.txt'), 'sub' + 'y'.repeat(5000));
    } catch (err) {
      console.log('[DIR-prep-err]', String(err));
    }

    mainWindow.webContents.on('console-message', (_e, _l, message) => {
      const m = String(message);
      if (m.startsWith('[DIR-') || m.startsWith('[STATUS]')) console.log('[renderer-out]', m);
    });
    mainWindow.webContents.executeJavaScript(
      `(async () => {
        await new Promise(r => setTimeout(r, 1500));
        const hs = await window.trix.listHosts();
        if (!hs.length) { console.log('[DIR-skip] nema hostova'); window.close(); return; }
        const hid = hs[0].id;
        await window.trix.monitorEnsure(hid);
        for (let i = 0; i < 40; i++) {
          await new Promise(r => setTimeout(r, 500));
        }
        const home = await window.trix.remoteHome(hid);
        if (!home.home) { console.log('[DIR-skip] home error: ' + home.error); window.close(); return; }
        const rdir = home.home.replace(/\\/+$/, '') + '/.trixssh-selftest';
        const b1 = ${JSON.stringify(srcDir)};
        const b2 = ${JSON.stringify(dstDir)};
        console.log('[DIR-upload-start]');
        const up = await window.trix.uploadDir(hid, b1, rdir);
        console.log('[DIR-upload]', JSON.stringify(up));
        const lst = await window.trix.remoteList(hid, rdir);
        console.log('[DIR-list]', JSON.stringify({ err: lst.error, names: (lst.entries || []).map(e => e.name + (e.isDir ? '/' : '')) }));
        const dl = await window.trix.downloadDir(hid, rdir, b2);
        console.log('[DIR-download]', JSON.stringify(dl));
        const back = await window.trix.listLocalDir(b2 + '/sub');
        console.log('[DIR-back]', JSON.stringify({ err: back.error, names: (back.entries || []).map(e => e.name) }));
        const delR = await window.trix.remoteDelete(hid, rdir, true);
        console.log('[DIR-cleanup]', JSON.stringify(delR));
        await new Promise(r => setTimeout(r, 300));
        window.close();
      })()`,
      true
    ).then((v) => console.log('[DIR-END]', v)).catch((err) => console.log('[DIR-ERR]', String(err)));
  } else if (process.env.TRIX_TEST === 'upd') {
    const manifestDir = path.join(app.getPath('temp'), 'trixssh-upd-test');
    try { fs.rmSync(manifestDir, { recursive: true, force: true }); } catch { /* */ }
    const manifestPath = path.join(manifestDir, 'latest.json');
    const dummy = path.join(manifestDir, 'TrixSSH-Setup-99.0.0.exe');
    fs.mkdirSync(manifestDir, { recursive: true });
    fs.writeFileSync(dummy, Buffer.alloc(1024 * 1024, 1));
    fs.writeFileSync(manifestPath, JSON.stringify({ version: '99.0.0', url: dummy, notes: 'Test update' }, null, 2));
    process.env.TRIX_UPDATE_MANIFEST = manifestPath;

    mainWindow.webContents.on('console-message', (_e, _l, message) => {
      const m = String(message);
      if (m.startsWith('[UPD')) console.log('[renderer-out]', m);
    });
    mainWindow.webContents.executeJavaScript(
      `(async () => {
        await new Promise(r => setTimeout(r, 1200));
        window.trix.onUpdateAvailable((info) => {
          console.log('[UPD-available]', JSON.stringify(info));
          window.trix.updateDownload().then((x) => console.log('[UPD-dl]', JSON.stringify(x)));
        });
        let n = 0;
        window.trix.onUpdateProgress((p) => { n++; if (n === 1 || n % 50 === 0) console.log('[UPD-progress]', n, p.loaded, p.total); });
        window.trix.onUpdateReady((p) => console.log('[UPD-ready]', JSON.stringify({ file: p.file && p.file.length > 0 })));
        window.trix.onUpdateCheckResult((r) => console.log('[UPD-check]', JSON.stringify(r)));
        await window.trix.updateCheck();
        await new Promise(r => setTimeout(r, 8000));
        window.close();
      })()`,
      true
    ).then((v) => console.log('[UPD-END]', v)).catch((err) => console.log('[UPD-ERR]', String(err)));
  } else if (process.env.TRIX_TEST === 'save') {
    mainWindow.webContents.executeJavaScript(
      `(async () => {
        await window.trix.saveHost({ label: 'PERSISTTEST', host: '127.0.0.1', port: 22, username: 'root', color: '#2bd576', authType: 'password', password: 'plain:test', privateKey: '', passphrase: '' });
        await window.trix.saveSnippet({ name: 'SNIP-TEST', cmd: 'echo hello' });
        await new Promise(r => setTimeout(r, 900));
        window.close();
      })()`,
      true
    );
  } else if (process.env.TRIX_TEST === 'check') {
    mainWindow.webContents.executeJavaScript(
      `(async () => {
        const hs = await window.trix.listHosts();
        const ss = await window.trix.listSnippets();
        console.log('CHECK ' + JSON.stringify({ hosts: hs.length, snips: ss.length, labels: hs.map(h => h.label) }));
        await new Promise(r => setTimeout(r, 400));
        window.close();
      })()`,
      true
    );
  }
}

app.whenReady().then(() => {
  if (process.env.TRIX_TEST === 'met') {
    try {
      const sample = [
        '@@CPU', 'cpu  10 20 30 400 50 0 0 0 0 0',
        '@@MEM', 'MemTotal:       16000000 kB', 'MemAvailable:    9000000 kB',
        '@@LOAD', '0.20 0.30 0.40 1/200 1234',
        '@@DISK', '/dev/sda1 50000000 20000000 30000000 40% /',
        '@@UP', '2351854.41 3108444.79',
        '@@OS', 'PRETTY_NAME="Rocky Linux 8.10 (Green Obsidian)"',
        '@@PS', '22.0 python3', '3.1 mariadbd', '300.0 ps', '0.5 sshd',
      ].join('\n');
      const r = parseMetrics(sample, {});
      console.log('[MET-TEST]', JSON.stringify(r));
    } catch (err) {
      console.log('[MET-TEST-ERR]', String(err));
    }
    app.exit(0);
    return;
  }
  if (process.env.TRIX_TEST === 'bak') {
    try {
      /* self-test: encrypt then decrypt in memory and compare */
      const payload = backupPayload();
      const psw = 'test1234';
      const salt = crypto.randomBytes(16);
      const iv = crypto.randomBytes(12);
      const key = deriveBackupKey(psw, salt);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const enc = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(payload), 'utf8')), cipher.final()]);
      const tag = cipher.getAuthTag();
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      const dec = JSON.parse(Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8'));
      const ok = JSON.stringify(dec) === JSON.stringify(payload);
      console.log('[BACKUP-TEST]', JSON.stringify({ ok, hosts: payload.hosts.length, label: (payload.hosts[0] || {}).label }));
      let wrongKey = 'x';
      try {
        const k2 = deriveBackupKey('kriva', salt);
        const d2 = crypto.createDecipheriv('aes-256-gcm', k2, iv);
        d2.setAuthTag(tag);
        d2.final();
      } catch {
        wrongKey = 'ok-rejected';
      }
      console.log('[BACKUP-WRONGKEY]', wrongKey);
      app.exit(0);
      return;
    } catch (err) {
      console.log('[BACKUP-TEST-ERR]', String(err));
      app.exit(0);
      return;
    }
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  /* update check: starts after 8 s, then every 6 h (not in demo shots mode) */
  if (!SHOTS_MODE) {
    setTimeout(() => checkForUpdates(false), 8000);
    setInterval(() => checkForUpdates(false), 6 * 60 * 60 * 1000);
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  quitting = true;
  for (const sid of [...sessions.keys()]) teardownSession(sid);
  for (const hostId of [...monitors.keys()]) teardownMonitor(hostId);
});
