'use strict';

/* TrixSSH — main renderer logic (v2.2, OmnySSH-style) */

const TRI = window.trix;
const { Terminal } = window;
const { FitAddon } = window.FitAddon;
const T = window.TRX;
const S = (...a) => T.i18n.tr(...a);

const PALETTE = ['#2bd576', '#3aa0ff', '#a78bfa', '#eebd5c', '#f6615c', '#22d3ee', '#ec4899', '#84cc16'];

const state = {
  view: 'dashboard',
  hosts: [],
  snippets: [],
  settings: null,
  monitors: new Map(), // hostId -> { status, metrics }
  sessions: new Map(), // sid -> terminal session
  activeSid: null,
  snipFilter: '',
  sftpHostId: null,    // server bound to the SFTP browser
  hist: new Map(),     // hostId -> { cpu, ram, rx, tx } samples for the sparklines (60s)
  srvOpen: true,       // metrics panel on the right side of the terminal
};

/* =========================================================
   El helpers
========================================================= */

function el(tag, cls, txt) {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (txt != null) d.textContent = txt;
  return d;
}

const els = {
  /* sidebar */
  sidebar: document.getElementById('sidebar'),
  btnCollapse: document.getElementById('btnCollapse'),
  nav: document.getElementById('nav'),
  connList: document.getElementById('connList'),
  btnTheme: document.getElementById('btnTheme'),
  btnSettings: document.getElementById('btnSettings'),

  /* views */
  viewTerminal: document.getElementById('viewTerminal'),
  viewDashboard: document.getElementById('viewDashboard'),
  viewSnippets: document.getElementById('viewSnippets'),
  viewSftp: document.getElementById('viewSftp'),
  viewSettings: document.getElementById('viewSettings'),

  tabbar: document.getElementById('tabbar'),
  workspace: document.getElementById('workspace'),
  welcome: document.getElementById('welcome'),
  btnWelcomeAdd: document.getElementById('btnWelcomeAdd'),
  dashGrid: document.getElementById('dashGrid'),
  dashEmpty: document.getElementById('dashEmpty'),
  btnDashRefresh: document.getElementById('btnDashRefresh'),
  btnDashAdd: document.getElementById('btnDashAdd'),
  snipGrid: document.getElementById('snipGrid'),
  snipEmpty: document.getElementById('snipEmpty'),
  snipFilter: document.getElementById('snipFilter'),
  btnNewSnip: document.getElementById('btnNewSnip'),
  btnNewSnip2: document.getElementById('btnNewSnip2'),
  btnSettings2: document.getElementById('btnSettings2'),
  settingsWrap: document.getElementById('settingsWrap'),

  sbStatus: document.getElementById('sbStatus'),
  sbCounts: document.getElementById('sbCounts'),

  /* modals */
  hostModal: document.getElementById('modalOverlay'),
  hostForm: document.getElementById('hostForm'),
  modalTitle: document.getElementById('modalTitle'),
  fLabel: document.getElementById('fLabel'),
  fHost: document.getElementById('fHost'),
  fPort: document.getElementById('fPort'),
  fUser: document.getElementById('fUser'),
  fAuth: document.getElementById('fAuth'),
  rowPassword: document.getElementById('rowPassword'),
  fPassword: document.getElementById('fPassword'),
  notePassword: document.getElementById('notePassword'),
  rowKey: document.getElementById('rowKey'),
  fKey: document.getElementById('fKey'),
  fPassphrase: document.getElementById('fPassphrase'),
  noteKey: document.getElementById('noteKey'),
  notePass: document.getElementById('notePass'),
  colorSwatches: document.getElementById('colorSwatches'),
  btnCancel: document.getElementById('btnCancel'),

  snipModal: document.getElementById('snippetOverlay'),
  snipForm: document.getElementById('snipForm'),
  snipTitle: document.getElementById('snipTitle'),
  snipName: document.getElementById('snipName'),
  snipCmd: document.getElementById('snipCmd'),
  snipCancel: document.getElementById('snipCancel'),

  bcastModal: document.getElementById('broadcastOverlay'),
  bcastList: document.getElementById('bcastList'),
  bcastCmd: document.getElementById('bcastCmd'),
  bcastSend: document.getElementById('bcastSend'),
  bcastCancel: document.getElementById('bcastCancel'),

  /* update */
  updateOverlay: document.getElementById('updateOverlay'),
  uTitle: document.getElementById('uTitle'),
  uInfo: document.getElementById('uInfo'),
  uProgressWrap: document.getElementById('uProgressWrap'),
  uProgLabel: document.getElementById('uProgLabel'),
  uProgFill: document.getElementById('uProgFill'),
  uClose: document.getElementById('uClose'),
  uDownload: document.getElementById('uDownload'),
  uInstall: document.getElementById('uInstall'),

  /* host picker */
  pickerOverlay: document.getElementById('pickerOverlay'),
  pickInput: document.getElementById('pickInput'),
  pickList: document.getElementById('pickList'),
};

let editingHost = null;
let editingSnip = null;
let selectedColor = PALETTE[0];
let btnDupTab = null;
let btnBcastTool = null;

/* =========================================================
   Settings + theme
========================================================= */

async function initSettings() {
  state.settings = (await TRI.settingsGet()) || null;
  applyTheme();
  setSidebarCollapsed(!!(state.settings && state.settings.sidebarCollapsed), false);
  state.srvOpen = !(state.settings && state.settings.srvPanelOpen === false);
  refreshSrvPanel();
}

function applyTheme() {
  const theme = state.settings && state.settings.theme;
  document.body.dataset.theme = theme === 'light' ? 'light' : 'dark';
  els.btnTheme.textContent = theme === 'light' ? '☀' : '☾';
}

function setSidebarCollapsed(collapsed, persist = true) {
  els.sidebar.classList.toggle('collapsed', collapsed);
  if (persist && state.settings) {
    TRI.settingsSet({ sidebarCollapsed: collapsed });
  }
}

async function updateSetting(key, value) {
  state.settings = await TRI.settingsSet({ [key]: value });
  applyTheme();
}

function mask(host) {
  return T.maskHost(host, state.settings);
}

/* =========================================================
   View navigation
========================================================= */

function setView(name) {
  state.view = name;
  for (const b of els.nav.querySelectorAll('.nav-item')) {
    b.classList.toggle('active', b.dataset.view === name);
  }
  for (const id of ['viewTerminal', 'viewDashboard', 'viewSnippets', 'viewSftp', 'viewSettings']) {
    document.getElementById(id).classList.toggle('hidden', id !== 'view' + name[0].toUpperCase() + name.slice(1));
  }
  if (name === 'sftp') {
    /* SFTP click -> the "Choose a server" picker always opens (like OmnySSH);
       if already bound, the page stays loaded behind the picker */
    if (state.sftpHostId) T.sftpPage.show(state.sftpHostId);
    showHostPicker();
    renderConnections();
  }
  if (name !== 'sftp') renderConnections();
  if (name === 'dashboard') renderDashboard();
  if (name === 'snippets') renderSnippets();
  if (name === 'terminal') refreshSrvPanel();
  statusTitle();
}

function statusTitle() {
  els.sbStatus.textContent = state.view === 'dashboard' ? 'Dashboard' : S('Ready');
}

/* =========================================================
   Data
========================================================= */

async function loadHosts() {
  state.hosts = (await TRI.listHosts()) || [];
  window.TRX.getHostsCache = () => state.hosts;
}

async function loadSnippets() {
  state.snippets = (await TRI.listSnippets()) || [];
}

/* =========================================================
   Monitors + status
========================================================= */

function monitorOf(hostId) {
  return state.monitors.get(hostId) || { status: 'offline', metrics: null };
}

function isMonitorOnline(hostId) {
  const m = state.monitors.get(hostId);
  return !!(m && m.status === 'online');
}
window.TRX.isMonitorOnline = isMonitorOnline;

async function ensureAllMonitors() {
  for (const h of state.hosts) TRI.monitorEnsure(h.id);
}

TRI.onMonitorStatus((hostId, status, err) => {
  const m = state.monitors.get(hostId) || { status: 'offline', metrics: null };
  m.status = status;
  if (err) m.lastError = err;
  state.monitors.set(hostId, m);
  const act = activeSession();
  if (act && act.host.id === hostId) refreshSrvPanel();
  renderDashboard();
  renderConnections();
  updateCounts();
  if (err && state.view === 'dashboard') T.toast(`${hostLabel(hostId)}: ${err}`, true);
});

TRI.onMetrics((hostId, metrics) => {
  const m = state.monitors.get(hostId) || { status: 'offline', metrics: null };
  m.metrics = metrics;
  state.monitors.set(hostId, m);
  /* sample history for the sparklines in the terminal panel */
  if (metrics) {
    const now = Date.now();
    const hist = state.hist.get(hostId) || { cpu: [], ram: [], rx: [], tx: [] };
    if (metrics.cpu != null) hist.cpu.push({ t: now, v: metrics.cpu });
    if (metrics.ramPct != null) hist.ram.push({ t: now, v: metrics.ramPct });
    if (metrics.netRx != null) hist.rx.push({ t: now, v: metrics.netRx });
    if (metrics.netTx != null) hist.tx.push({ t: now, v: metrics.netTx });
    for (const k of Object.keys(hist)) {
      while (hist[k].length && now - hist[k][0].t > 75000) hist[k].shift();
    }
    state.hist.set(hostId, hist);
  }
  const act = activeSession();
  if (act && act.host.id === hostId) refreshSrvPanel();
  renderDashboard();
  updateCounts();
  updateChips(hostId, metrics);
});

function hostLabel(hostId) {
  const h = state.hosts.find((x) => x.id === hostId);
  return h ? h.label : hostId;
}

function pctCls(v) {
  if (v == null) return '';
  if (v < 65) return 'ok';
  if (v < 85) return 'warn';
  return 'bad';
}

function fmtUptime(s) {
  if (s == null) return '…';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${S('up')} ${d}d${h ? ' ' + h + 'h' : ''}`;
  if (h > 0) return `${S('up')} ${h}h ${m}m`;
  return `${S('up')} ${m}m`;
}

function fmtRate(bps) {
  if (bps == null || !Number.isFinite(bps)) return '—';
  if (bps >= 10485760) return Math.round(bps / 1048576) + ' MB/s';
  if (bps >= 1048576) return (bps / 1048576).toFixed(1) + ' MB/s';
  if (bps >= 1024) return Math.round(bps / 1024) + ' KB/s';
  return Math.round(bps) + ' B/s';
}

function updateChips(hostId, m) {
  const item = els.connList.querySelector(`.conn-row[data-host-id="${hostId}"]`);
  void item;
}

/* =========================================================
   Dashboard
========================================================= */

function renderDashboard() {
  els.dashGrid.innerHTML = '';
  const show = state.hosts.length > 0;
  els.dashEmpty.classList.toggle('hidden', show);
  els.dashGrid.classList.toggle('hidden', !show);

  for (const h of state.hosts) {
    els.dashGrid.appendChild(dashCard(h));
  }
  updateCounts();
}

function dashCard(h) {
  const mon = monitorOf(h.id);
  const card = el('div', 'dash-card');

  /* head */
  const head = el('div', 'dc-head');
  const dot = el('span', `dc-dot ${mon.status}`);
  head.appendChild(dot);

  const idCol = el('div', 'dc-id');
  const nameRow = el('div', 'dc-name');
  nameRow.appendChild(el('b', null, h.label));
  nameRow.appendChild(el('span', `dc-badge ${h.authType}`, h.authType === 'key' ? '⚿ key' : '✶ psw'));
  idCol.appendChild(nameRow);
  idCol.appendChild(el('div', 'dc-addr', `${h.username}@${mask(h.host)}:${h.port}`));
  head.appendChild(idCol);
  card.appendChild(head);

  /* actions */
  const actions = el('div', 'dc-actions');
  const mkAct = (act, txt, title) => {
    const b = el('button', 'dc-btn', txt);
    b.title = title;
    b.dataset.act = act;
    b.dataset.host = h.id;
    actions.appendChild(b);
  };
  mkAct('sh', '⌘ sh', S('Otvori terminal'));
  mkAct('files', '▤ files', S('Otvori SFTP'));
  mkAct('edit', '✎', S('Uredi'));
  const del = el('button', 'dc-btn danger', '🗑');
  del.title = S('Obriši (dvaput)');
  del.dataset.act = 'del';
  del.dataset.host = h.id;
  del.dataset.btn = '1';
  actions.appendChild(del);
  card.appendChild(actions);

  /* metrics */
  const met = mon.metrics;
  const metrics = el('div', 'dc-metrics');
  for (const [label, val, sub] of [
    ['CPU', met && met.cpu != null ? met.cpu : null, null],
    ['RAM', met && met.ramPct != null ? met.ramPct : null, met && met.ramTotalMB ? `${met.ramUsedMB}/${met.ramTotalMB} MB` : null],
    ['DISK', met && met.diskPct != null ? met.diskPct : null, met && met.diskTotalGB ? S('{0} GB slobodno', met.diskFreeGB) : null],
  ]) {
    const row = el('div', 'dc-mrow');
    row.appendChild(el('span', 'dc-mlabel', label));
    const bar = el('div', 'dc-bar');
    const fill = el('div', 'dc-fill ' + pctCls(val));
    fill.style.width = (val == null ? 0 : Math.min(100, val)) + '%';
    bar.appendChild(fill);
    row.appendChild(bar);
    const valWrap = el('span', 'dc-mval');
    valWrap.textContent = val == null ? (mon.status === 'online' ? '…' : '—') : val + '%';
    if (sub) valWrap.title = sub;
    row.appendChild(valWrap);
    metrics.appendChild(row);
  }
  card.appendChild(metrics);

  /* uptime + os */
  const subRow = el('div', 'dc-sub');
  subRow.textContent = mon.status === 'online' && met
    ? `${fmtUptime(met.uptimeS)}${met.os ? ' · ' + met.os : ''}`
    : (mon.status === 'connecting' ? S('spajam se…') : (mon.lastError || S('offline — klikni ⟳')));
  card.appendChild(subRow);

  /* top processes */
  if (met && met.procs && met.procs.length) {
    const procList = el('div', 'dc-procs');
    for (const p of met.procs.slice(0, 3)) {
      const pr = el('div', 'dc-prow');
      pr.appendChild(el('span', null, p.name));
      pr.appendChild(el('span', 'dc-pval', p.cpu.toFixed(0) + '%'));
      procList.appendChild(pr);
    }
    card.appendChild(procList);
  }

  /* os chip */
  if (met && met.os) {
    const chipRow = el('div', 'dc-chiprow');
    chipRow.appendChild(el('span', 'dc-oschip', met.os.split(' ')[0]));
    card.appendChild(chipRow);
  }

  /* right-click on the card */
  card.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    T.ctxMenu([
      { label: S('⌨ Otvori terminal'), action: () => connectToHost(h) },
      { label: S('▤ Otvori SFTP'), action: () => {
        TRI.monitorEnsure(h.id);
        T.sftpPage.show(h.id);
        setView('sftp');
      } },
      { label: S('✎ Uredi'), action: () => openHostModal(h) },
      '-',
      { label: S('🗑 Obriši'), danger: true, action: async () => {
        const uid = 'ctxdel:' + h.id;
        await TRI.deleteHost(h.id);
        state.hosts = state.hosts.filter((x) => x.id !== h.id);
        renderDashboard();
        T.toast(S('Server "{0}" obrisan.', h.label));
      } },
    ], e.clientX, e.clientY);
  });

  return card;
}

async function onDashAction(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  const hostId = b.dataset.host;
  const h = state.hosts.find((x) => x.id === hostId);
  if (!h) return;

  if (act === 'sh') {
    connectToHost(h);
  } else if (act === 'files') {
    bindSftpHost(h);
    setView('sftp');
  } else if (act === 'edit') {
    openHostModal(h);
  } else if (act === 'del') {
    T.armBtn(b, 'del:' + hostId, async () => {
      await TRI.deleteHost(h.id);
      state.hosts = state.hosts.filter((x) => x.id !== hostId);
      renderDashboard();
      T.toast(S('Server "{0}" obrisan.', h.label));
      refreshDashCounts();
    });
  } else if (act === 'retry') {
    TRI.monitorRefresh(h.id);
  }
}

async function refreshDashCounts() {
  await loadHosts();
  renderDashboard();
  ensureAllMonitors();
}

els.btnDashRefresh.addEventListener('click', async () => {
  for (const h of state.hosts) TRI.monitorRefresh(h.id);
  T.toast(S('Osvježavam monitori…'));
});

els.btnDashAdd.addEventListener('click', () => openHostModal());

/* =========================================================
   Snippets page
========================================================= */

function renderSnippets() {
  els.snipGrid.innerHTML = '';
  const f = state.snipFilter.toLowerCase();
  const list = state.snippets.filter((s) => !f || s.name.toLowerCase().includes(f) || s.cmd.toLowerCase().includes(f));
  const show = list.length > 0;
  els.snipEmpty.classList.toggle('hidden', show);
  els.snipGrid.classList.toggle('hidden', !show);

  for (const sn of list) {
    const card = el('div', 'snip-card');
    const top = el('div', 'sc-head');
    top.appendChild(el('b', null, sn.name));
    const acts = el('div', 'sc-actions');
    const edit = el('button', 'icon-btn', '✎');
    edit.title = S('Uredi');
    edit.addEventListener('click', () => openSnipModal(sn));
    const del = el('button', 'icon-btn danger', '🗑');
    del.title = S('Obriši (dvaput)');
    del.addEventListener('click', () => {
      T.armBtn(del, 'snip:' + sn.id, async () => {
        await TRI.deleteSnippet(sn.id);
        await loadSnippets();
        renderSnippets();
        T.toast(S('Naredba obrisana.'));
      });
    });
    acts.append(edit, del);
    top.appendChild(acts);
    card.appendChild(top);
    card.appendChild(el('div', 'sc-cmd', sn.cmd));
    const run = el('button', 'btn-run', S('▶ Pokreni'));
    run.title = S('Izvrši u aktivnom terminal tabu');
    run.addEventListener('click', () => runSnippet(sn));
    card.appendChild(run);
    els.snipGrid.appendChild(card);
  }
}

function runSnippet(sn) {
  const s = activeSession();
  if (!s || s.status !== 'on') {
    T.toast(S('Otvori terminal tab pa pokreni naredbu.'), true);
    return;
  }
  TRI.input(s.sid, sn.cmd + '\r');
  T.toast(S('Izvršeno na "{0}": {1}', s.host.label, sn.name));
}

els.snipFilter.addEventListener('input', () => { state.snipFilter = els.snipFilter.value; renderSnippets(); });
els.btnNewSnip.addEventListener('click', () => openSnipModal());
els.btnNewSnip2.addEventListener('click', () => openSnipModal());

function openSnipModal(sn = null) {
  editingSnip = sn;
  els.snipTitle.textContent = sn ? S('Uredi naredbu') : S('Nova naredba');
  els.snipName.value = sn ? sn.name : '';
  els.snipCmd.value = sn ? sn.cmd : '';
  els.snipModal.classList.remove('hidden');
  els.snipName.focus();
}

async function saveSnipFromForm(e) {
  e.preventDefault();
  const name = els.snipName.value.trim();
  const cmd = els.snipCmd.value.trim();
  if (!cmd) { T.toast(S('Unesi komandu.'), true); return; }
  await TRI.saveSnippet({ id: editingSnip ? editingSnip.id : undefined, name: name || S('Naredba'), cmd });
  await loadSnippets();
  renderSnippets();
  els.snipModal.classList.add('hidden');
  editingSnip = null;
  T.toast(S('Naredba spremljena.'));
}

/* =========================================================
   Settings page
========================================================= */

function renderSettings() {
  if (!state.settings) return;
  const s = state.settings;
  els.settingsWrap.innerHTML = '';

  const card = (title, rows) => {
    const set = el('div', 'set-card');
    set.appendChild(el('h3', 'set-title', title));
    const list = typeof rows === 'function' ? rows(set) : rows;
    for (const row of list) set.appendChild(row);
    return set;
  };

  const toggleRow = (desc, val, onToggle) => {
    const wrap = el('div', 'set-row');
    const info = el('div', 'set-info');
    info.appendChild(el('b', null, desc.title));
    if (desc.desc) info.appendChild(el('div', 'set-desc', desc.desc));
    const tg = el('button', 'toggle' + (val ? ' on' : ''));
    tg.type = 'button';
    tg.setAttribute('aria-label', desc.title);
    tg.addEventListener('click', async () => {
      await onToggle(!val);
    });
    wrap.append(info, tg);
    return wrap;
  };

  const segRow = (desc, val, options, onPick) => {
    const wrap = el('div', 'set-row');
    const info = el('div', 'set-info');
    info.appendChild(el('b', null, desc.title));
    if (desc.desc) info.appendChild(el('div', 'set-desc', desc.desc));
    const seg = el('div', 'segment');
    for (const o of options) {
      const ob = el('button', 'seg-opt' + (val === o.value ? ' sel' : ''), o.label);
      ob.dataset.val = String(o.value);
      ob.addEventListener('click', async () => {
        await onPick(o.value);
      });
      seg.appendChild(ob);
    }
    wrap.append(info, seg);
    return wrap;
  };

  /* Appearance */
  els.settingsWrap.appendChild(card(S('Appearance'), (cardEl) => [
    (() => {
      const row = el('div', 'set-row');
      const info = el('div', 'set-info');
      info.appendChild(el('b', null, S('Tema')));
      info.appendChild(el('div', 'set-desc', S('Tamna ili svijetla (terminal ostaje tamni).')));
      const seg = el('div', 'segment');
      for (const o of [{ label: '☀ Light', value: 'light' }, { label: '☾ Dark', value: 'dark' }]) {
        const ob = el('button', 'seg-opt' + (s.theme === o.value ? ' sel' : ''), o.label);
        ob.addEventListener('click', async () => {
          state.settings = await TRI.settingsSet({ theme: o.value });
          applyTheme();
          renderSettings();
        });
        seg.appendChild(ob);
      }
      row.append(info, seg);
      return row;
    })(),
  ]));

  /* Privacy */
  els.settingsWrap.appendChild(card(S('Privacy'), () => [
    toggleRow(
      { title: 'Streamer mode', desc: S('Maskiraj adrese servera s lažnim IP-ovima tijekom snimanja.') },
      s.streamerMode,
      async (v) => {
        state.settings = await TRI.settingsSet({ streamerMode: v });
        renderSettings();
        renderDashboard();
        renderConnections();
        if (state.view === 'sftp') T.sftpPage.show();
      }
    ),
  ]));

  /* Dashboard */
  els.settingsWrap.appendChild(card('Dashboard', () => [
    (() => {
      const row = el('div', 'set-row');
      const info = el('div', 'set-info');
      info.appendChild(el('b', null, S('Auto-refresh interval')));
      info.appendChild(el('div', 'set-desc', S('Koliko često osvježavati metrike.')));
      const seg = el('div', 'segment');
      for (const o of [
        { label: '10s', value: 10 },
        { label: '30s', value: 30 },
        { label: '1m', value: 60 },
        { label: '2m', value: 120 },
        { label: '5m', value: 300 },
      ]) {
        const ob = el('button', 'seg-opt' + (s.dashInterval === o.value ? ' sel' : ''), o.label);
        ob.addEventListener('click', async () => {
          state.settings = await TRI.settingsSet({ dashInterval: o.value });
          renderSettings();
        });
        seg.appendChild(ob);
      }
      row.append(info, seg);
      return row;
    })(),
  ]));

  /* Window */
  els.settingsWrap.appendChild(card(S('Window'), () => [
    toggleRow(
      { title: S('Minimize to tray'), desc: S('Minimiziraj u tray — ikona u trayu vraća prozor.') },
      s.minimizeToTray,
      async (v) => {
        state.settings = await TRI.settingsSet({ minimizeToTray: v });
        renderSettings();
        if (v) TRI.settingsSet({ minimizeToTray: true });
      }
    ),
    toggleRow(
      { title: S('Close to tray'), desc: S('X gumb ne gasi aplikaciju — ostaje u trayu, veze ostaju.') },
      s.closeToTray,
      async (v) => {
        state.settings = await TRI.settingsSet({ closeToTray: v });
        renderSettings();
      }
    ),
    toggleRow(
      { title: S('Ask before quitting'), desc: S('Pitaj ako su terminal veze još otvorene.') },
      s.askBeforeQuit,
      async (v) => {
        state.settings = await TRI.settingsSet({ askBeforeQuit: v });
        renderSettings();
      }
    ),
  ]));

  /* Backup & migration */
  els.settingsWrap.appendChild(card(S('Sigurnosna kopija i migracija'), () => [
    (() => {
      const row = el('div', 'set-row');
      const info = el('div', 'set-info');
      info.appendChild(el('b', null, S('Spremi backup (šifrirano)')));
      info.appendChild(el('div', 'set-desc',
        S('Serveri, ključi, naredbe i postavke u jednu AES-256-GCM datoteku šifriranu tvojom lozinkom. Prenosivo na druge računale.')));
      const btn = el('button', 'mini', S('💾 Spremi backup…'));
      btn.type = 'button';
      btn.addEventListener('click', exportBackup);
      row.append(info, btn);
      return row;
    })(),
    (() => {
      const row = el('div', 'set-row');
      const info = el('div', 'set-info');
      info.appendChild(el('b', null, S('Uvezi backup')));
      info.appendChild(el('div', 'set-desc',
        S('Učitaj backup datoteku s drugog računala. Unosi se lozinkom kojom je backup šifriran; spojiti će se tuđi i novi serveri.')));
      const btn = el('button', 'mini', S('📂 Uvezi…'));
      btn.type = 'button';
      btn.addEventListener('click', importBackup);
      row.append(info, btn);
      return row;
    })(),
  ]));

  /* Updates */
  els.settingsWrap.appendChild(card(S('Ažuriranja'), () => [
    (() => {
      const row = el('div', 'set-row');
      const info = el('div', 'set-info');
      info.appendChild(el('b', null, S('Automatska provjera')));
      info.appendChild(el('div', 'set-desc',
        S('Pri pokretanju i svakih 6 sati provjerava se dostupnost nove verzije. Preuzimanje i instalacija su ručno, klikom.')));
      els.btnCheckUpd = el('button', 'mini', S('Provjeri ažuriranje'));
      els.btnCheckUpd.type = 'button';
      els.btnCheckUpd.addEventListener('click', async () => {
        els.btnCheckUpd.disabled = true;
        els.btnCheckUpd.textContent = S('Provjeravam…');
        await TRI.updateCheck();
      });
      row.append(info, els.btnCheckUpd);
      return row;
    })(),
  ]));

  /* Language */
  els.settingsWrap.appendChild(card(S('Jezik'), [
    (() => {
      const row = el('div', 'set-row');
      const info = el('div', 'set-info');
      info.appendChild(el('b', null, S('Jezik')));
      info.appendChild(el('div', 'set-desc', S('Jezik sučelja. Primjenjuje se odmah.')));
      const sel = el('select', 'sftp-drive');
      for (const [code, name] of Object.entries(T.i18n.LANGS)) {
        const o = el('option', null, name);
        o.value = code;
        sel.appendChild(o);
      }
      sel.value = T.i18n.lang;
      sel.addEventListener('change', async () => {
        await TRI.settingsSet({ lang: sel.value });
        setTimeout(() => location.reload(), 250);
      });
      row.append(info, sel);
      return row;
    })(),
  ]));

  /* About */
  const about = el('div', 'set-card about-card');

  /* brand red */
  const brand = el('div', 'about-brand');
  const bName = el('b', 'about-name', 'TrixSSH');
  bName.addEventListener('click', () => TRI.openExternal('https://www.trixssh.de'));
  brand.append(bName, el('span', 'set-ver', appVer));
  about.appendChild(brand);
  about.appendChild(el('div', 'about-tag', S('Brz desktop SSH klijent — tabovi, SFTP, live metrike, snippeti i broadcast.')));

  const aboutRow = (label, text, url) => {
    const row = el('div', 'set-row');
    const info = el('div', 'set-info');
    info.appendChild(el('b', null, label));
    row.appendChild(info);
    const link = el('button', 'about-link', text);
    link.type = 'button';
    link.addEventListener('click', () => {
      TRI.openExternal(url).then((r) => {
        if (r && r.error) T.toast(r.error, true);
      }).catch(() => {});
    });
    row.appendChild(link);
    return row;
  };

  about.appendChild(aboutRow(S('Autor'), 'Hatrix', 'https://www.hatrix.de'));
  about.appendChild(aboutRow(S('Web'), 'www.hatrix.de', 'https://www.hatrix.de'));
  about.appendChild(aboutRow(S('TrixSSH'), 'www.trixssh.de', 'https://www.trixssh.de'));
  about.appendChild(aboutRow(S('Email'), 'info@hatrix.de', 'mailto:info@hatrix.de'));
  about.appendChild(aboutRow('GitHub', 'github.com/Hatrix-Digital/TrixSSH', 'https://github.com/Hatrix-Digital/TrixSSH'));
  about.appendChild(aboutRow(S('Licenca'), 'MIT', 'https://github.com/Hatrix-Digital/TrixSSH/blob/main/LICENSE'));
  about.appendChild(aboutRow(S('Tehnologije'), 'Electron · ssh2 · xterm.js', 'https://github.com/Hatrix-Digital/TrixSSH'));
  els.settingsWrap.appendChild(about);
}

els.btnSettings.addEventListener('click', () => { setView('settings'); });
els.btnSettings2.addEventListener('click', () => { setView('settings'); });

/* ---------- backup export/import ---------- */

async function exportBackup() {
  const psw = await T.ask(S('Lozinka za šifriranje backupa (min. 4 znaka):'), '', true);
  if (!psw) return;
  if (String(psw).length < 4) { T.toast(S('Lozinka mora imati barem 4 znaka.'), true); return; }
  T.toast(S('Stvaram šifrirani backup…'));
  const res = await TRI.backupExport(psw);
  if (!res || res.error) { T.toast((res && res.error) || S('Export nije uspio.'), true); return; }
  if (res.canceled) return;
  T.toast(S('Backup spremljen ({0} servera):\n{1}', res.hosts, res.path));
}

async function importBackup() {
  const psw = await T.ask(S('Lozinka backup datoteke:'), '', true);
  if (!psw) return;
  T.toast(S('Uvozim backup…'));
  const res = await TRI.backupImport(psw);
  if (!res || res.error) { T.toast((res && res.error) || S('Import nije uspio.'), true); return; }
  if (res.canceled) return;

  /* reload everything after import */
  state.hosts = (await TRI.listHosts()) || [];
  window.TRX.getHostsCache = () => state.hosts;
  await loadSnippets();
  state.settings = await TRI.settingsGet();
  applyTheme();
  renderSettings();
  renderDashboard();
  renderConnections();
  ensureAllMonitors();
  T.toast(S('Backup uvezen ✓\nServera ukupno: {0} (novih: {1}) · Naredbi: {2}', res.hosts, res.newHosts, res.snips));
}
els.btnTheme.addEventListener('click', async () => {
  const next = state.settings.theme === 'dark' ? 'light' : 'dark';
  state.settings = await TRI.settingsSet({ theme: next });
  applyTheme();
  if (state.view === 'settings') renderSettings();
});

/* =========================================================
   Host picker (for SFTP)
========================================================= */

let pickState = { open: false, items: [], sel: 0, filter: '' };

function showHostPicker() {
  if (!state.hosts.length) {
    T.toast(S('Nema spremljenih servera — prvo dodaj jedan.'), true);
    openHostModal();
    return;
  }
  pickState = { open: true, items: [...state.hosts], sel: 0, filter: '' };
  els.pickInput.value = '';
  renderPickList();
  els.pickerOverlay.classList.remove('hidden');
  setTimeout(() => els.pickInput.focus(), 0);
}

function closeHostPicker() {
  pickState.open = false;
  els.pickerOverlay.classList.add('hidden');
}

function renderPickList() {
  const f = pickState.filter.toLowerCase();
  const list = pickState.items.filter((h) =>
    !f || h.label.toLowerCase().includes(f) || `${h.username}@${h.host}`.toLowerCase().includes(f));
  els.pickList.innerHTML = '';
  pickState.view = list;

  if (!list.length) {
    els.pickList.appendChild(el('div', 'pick-empty', S('Nema rezultata za "{0}".', pickState.filter)));
    return;
  }
  if (pickState.sel >= list.length) pickState.sel = list.length - 1;

  list.forEach((h, i) => {
    const row = el('div', 'pick-row' + (i === pickState.sel ? ' sel' : ''));
    row.appendChild(el('span', `dc-dot ${monitorOf(h.id).status}`));
    row.appendChild(el('span', 'pick-name', h.label));
    row.appendChild(el('span', 'pick-addr', `${h.username}@${mask(h.host)}`));
    row.title = `${h.label} — ${h.username}@${h.host}:${h.port}`;
    row.addEventListener('click', () => pickSftpHost(h));
    row.addEventListener('mousemove', () => {
      if (pickState.sel !== i) {
        pickState.sel = i;
        for (const [idx, r] of [...els.pickList.children].entries()) r.classList.toggle('sel', idx === i);
      }
    });
    els.pickList.appendChild(row);
  });
}

function pickSftpHost(h) {
  state.sftpHostId = h.id;
  TRI.monitorEnsure(h.id);
  closeHostPicker();
  T.sftpPage.show(h.id);
  renderConnections();
  T.toast(`SFTP: ${h.label}`);
}

els.pickInput.addEventListener('input', () => {
  pickState.filter = els.pickInput.value.trim();
  pickState.sel = 0;
  renderPickList();
});

els.pickInput.addEventListener('keydown', (e) => {
  if (!pickState.open) return;
  const list = pickState.view || [];
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    pickState.sel = Math.min(list.length - 1, pickState.sel + 1);
    renderPickList();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    pickState.sel = Math.max(0, pickState.sel - 1);
    renderPickList();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (list[pickState.sel]) pickSftpHost(list[pickState.sel]);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeHostPicker();
  }
});

els.pickerOverlay.addEventListener('mousedown', (e) => {
  if (e.target === els.pickerOverlay) closeHostPicker();
});

/* bind the SFTP browser to a host (dashboard "files", tab ▤, picker) */
function bindSftpHost(h) {
  state.sftpHostId = h.id;
  TRI.monitorEnsure(h.id);
  T.sftpPage.show(h.id);
  renderConnections();
}

function unbindSftp() {
  state.sftpHostId = null;
  if (T.sftpPage && T.sftpPage.unbind) T.sftpPage.unbind();
  renderConnections();
}

/* =========================================================
   Sidebar navigation + connections
========================================================= */

function renderConnections() {
  els.connList.innerHTML = '';

  /* terminal sessions */
  const list = [...state.sessions.values()];
  for (const s of list.slice(0, list.length)) {
    const row = el('div', 'conn-row');
    row.dataset.sid = s.sid;
    const dot = el('span', `conn-dot ${s.status}`);
    const ic = el('span', 'conn-ic', '⌨');
    const lbl = el('span', 'conn-label', s.host.label);
    const x = el('button', 'conn-x', '×');
    x.title = S('Zatvori vezu');
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      closeSession(s.sid);
    });
    row.append(dot, ic, lbl, x);
    row.classList.toggle('active', state.view === 'terminal' && state.activeSid === s.sid);
    row.title = `SSH — ${s.host.username}@${s.host.host}`;
    row.addEventListener('click', () => {
      setView('terminal');
      showSession(s.sid);
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      T.ctxMenu([
        { label: S('Otvori tab'), action: () => { setView('terminal'); showSession(s.sid); } },
        '-',
        { label: S('Zatvori vezu'), danger: true, action: () => closeSession(s.sid) },
      ], e.clientX, e.clientY);
    });
    els.connList.appendChild(row);
  }

  /* SFTP connection (if bound) */
  if (state.sftpHostId) {
    const h = state.hosts.find((x) => x.id === state.sftpHostId);
    if (h) {
      const row = el('div', 'conn-row');
      row.classList.toggle('active', state.view === 'sftp');
      const dot = el('span', `conn-dot ${monitorOf(h.id).status}`);
      const ic = el('span', 'conn-ic', '▤');
      const lbl = el('span', 'conn-label', h.label);
      const x = el('button', 'conn-x', '×');
      x.title = S('Odvoji SFTP preglednik');
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        unbindSftp();
      });
      row.append(dot, ic, lbl, x);
      row.title = `SFTP — ${h.username}@${h.host}`;
      row.addEventListener('click', () => {
        setView('sftp');
        bindSftpHost(h);
      });
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        T.ctxMenu([
          { label: S('Otvori SFTP'), action: () => { setView('sftp'); bindSftpHost(h); } },
          '-',
          { label: S('Odvoji preglednik'), danger: true, action: () => unbindSftp() },
        ], e.clientX, e.clientY);
      });
      els.connList.appendChild(row);
    }
  }

  if (!list.length && !state.sftpHostId) {
    els.connList.appendChild(el('div', 'conn-empty', S('Nema aktivnih veza')));
  }
}

for (const b of els.nav.querySelectorAll('.nav-item')) {
  b.addEventListener('click', () => setView(b.dataset.view));
}

const btnAddHostIcon = document.getElementById('btnAddHostIcon');
if (btnAddHostIcon) btnAddHostIcon.addEventListener('click', () => openHostModal());

els.btnCollapse.addEventListener('click', () => {
  setSidebarCollapsed(!els.sidebar.classList.contains('collapsed'));
});

/* =========================================================
   Server metrics panel (right side of the terminal)
========================================================= */

const srvPanel = {
  root: null,
  dot: null,
  head: null,
  info: { ih: null, ip: null },
  bars: { cpu: null, ram: null, disk: null },
  vals: { cpu: null, ram: null, disk: null },
  nets: { rx: null, tx: null },
  graphs: {},
  foot: null,
  btn: null,
};

function buildSrvPanel() {
  const root = el('aside', 'srv-panel hidden');
  root.id = 'srvPanel';

  const head = el('div', 'sp-head');
  srvPanel.dot = el('span', 'dc-dot');
  head.append(srvPanel.dot, el('span', 'sp-title', S('Metrike servera')));
  root.appendChild(head);

  /* HOST / IP info — compact box */
  const info = el('div', 'sp-info');
  srvPanel.info.ih = el('div', 'sp-hostname', '—');
  srvPanel.info.ip = el('div', 'sp-ips', '—');
  info.append(srvPanel.info.ih, srvPanel.info.ip);
  root.appendChild(info);

  const met = el('div', 'sp-metrics');
  for (const key of ['cpu', 'ram', 'disk']) {
    const row = el('div', 'sp-mrow');
    const top = el('div', 'sp-mtop');
    top.append(el('span', 'sp-mlabel', key.toUpperCase()));
    top.appendChild(srvPanel.vals[key] = el('span', 'sp-mval', '—'));
    const bar = el('div', 'sp-bar');
    bar.appendChild(srvPanel.bars[key] = el('div', 'sp-fill'));
    row.append(top, bar);
    met.appendChild(row);
  }
  root.appendChild(met);

  /* NET speeds — ↓ and ↑ in one row */
  const netRow = el('div', 'sp-net-single');
  for (const [key, arrow, pairCls] of [['rx', '↓', 'sp-net-rx'], ['tx', '↑', 'sp-net-tx']]) {
    const pair = el('span', 'sp-netpair ' + pairCls);
    pair.append(el('span', 'sp-mlabel', arrow), srvPanel.nets[key] = el('span', 'sp-mval', '—'));
    netRow.appendChild(pair);
  }
  root.appendChild(netRow);

  /* graphs */
  for (const [key, label] of [['cpu', 'CPU (60s)'], ['ram', 'RAM (60s)'], ['net', 'NET (60s)']]) {
    root.appendChild(el('div', 'sp-glabel', label));
    const canvas = document.createElement('canvas');
    canvas.className = 'sp-canvas';
    root.appendChild(canvas);
    srvPanel.graphs[key] = canvas;
  }

  srvPanel.foot = el('div', 'sp-foot', '');
  root.appendChild(srvPanel.foot);
  srvPanel.head = head;

  els.workspace.appendChild(root);
  srvPanel.root = root;
}

function refreshSrvPanel() {
  if (!srvPanel.root) return;
  const s = activeSession();
  const open = !!(s && state.view === 'terminal' && state.srvOpen);
  els.workspace.classList.toggle('srv-open', open);
  srvPanel.root.classList.toggle('hidden', !open);
  if (srvPanel.btn) srvPanel.btn.classList.toggle('active', open);
  if (!open) return;

  const host = s.host;
  srvPanel.root.title = `${host.label} — ${host.username}@${mask(host.host)}:${host.port}`;
  const mon = monitorOf(host.id);
  srvPanel.dot.className = `dc-dot ${mon.status}`;
  srvPanel.head.classList.toggle('sp-warn', mon.status !== 'online');

  const met = mon.metrics;

  /* HOST / IP info */
  srvPanel.info.ih.textContent = met && met.hostname ? met.hostname : `${host.username}@${host.host}`;
  srvPanel.info.ih.title = `${host.username}@${host.host}:${host.port}`;
  const ipList = met ? [met.pubIp].concat(met.ips || []).filter(Boolean) : [];
  srvPanel.info.ip.textContent = ipList.length ? ipList.join(' · ') : '—';
  srvPanel.info.ip.title = ipList.length ? ipList.join('\n') : '—';

  const vals = met ? {
    cpu: met.cpu != null ? met.cpu : null,
    ram: met.ramPct != null ? met.ramPct : null,
    disk: met.diskPct != null ? met.diskPct : null,
  } : { cpu: null, ram: null, disk: null };
  for (const key of ['cpu', 'ram', 'disk']) {
    const v = vals[key];
    const cls = pctCls(v);
    srvPanel.bars[key].className = 'sp-fill ' + cls;
    srvPanel.bars[key].style.width = (v == null ? 0 : Math.min(100, v)) + '%';
    srvPanel.vals[key].className = 'sp-mval ' + (cls || '');
    srvPanel.vals[key].textContent =
      v == null ? (mon.status === 'online' ? '…' : '—') : Math.round(v) + '%';
  }
  srvPanel.bars.ram.title = met && met.ramTotalMB ? `${met.ramUsedMB}/${met.ramTotalMB} MB` : '';
  srvPanel.bars.disk.title = met && met.diskTotalGB ? S('{0} GB slobodno', met.diskFreeGB) : '';

  /* NET speeds */
  const pend = mon.status === 'online' ? '…' : '—';
  srvPanel.nets.rx.textContent = met && met.netRx != null ? fmtRate(met.netRx) : pend;
  srvPanel.nets.tx.textContent = met && met.netTx != null ? fmtRate(met.netTx) : pend;
  srvPanel.nets.rx.title = met && met.netRx != null ? S('{0} B/s', met.netRx) : '';

  srvPanel.foot.textContent = mon.status === 'online' && met && met.uptimeS != null
    ? `${fmtUptime(met.uptimeS)}${met.os ? ' · ' + met.os : ''}`
    : (mon.status === 'connecting' ? S('spajam se…') : (mon.lastError || S('offline — klikni ⟳')));
  for (const k of ['cpu', 'ram', 'net']) drawSrvGraph(host.id, k);
}

function drawSrvGraph(hostId, key) {
  const c = srvPanel.graphs && srvPanel.graphs[key];
  if (!c) return;
  const w = Math.max(60, Math.round(c.clientWidth));
  const h = Math.max(24, Math.round(c.clientHeight));
  const dpr = window.devicePixelRatio || 1;
  if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const hist = state.hist.get(hostId) || {};
  const cs = getComputedStyle(document.body);
  const acc = (cs.getPropertyValue('--acc') || '#8b7cff').trim();
  const acc2 = (cs.getPropertyValue('--acc2') || '#38e0ff').trim();

  const series = key === 'net'
    ? [{ pts: hist.rx || [], color: acc2 }, { pts: hist.tx || [], color: acc }]
    : [{ pts: hist[key] || [], color: acc }];

  /* auto scale only for NET (B/s) — CPU and RAM go 0–100% */
  let maxV = 100;
  if (key === 'net') {
    maxV = 65536;
    for (const sr of series) {
      for (const p of sr.pts) {
        if (p.v > maxV) maxV = p.v;
      }
    }
    maxV *= 1.15;
  }

  const all = series[0].pts.concat(series[1] ? series[1].pts : []);
  if (all.length < 2) return;
  const now = Date.now();
  let t0 = all[0].t;
  for (const p of all) {
    if (p.t < t0) t0 = p.t;
  }
  const span = Math.max(60000, now - t0);
  const toXY = (p) => [
    (w - 3) - ((now - p.t) / span) * (w - 7),
    (h - 3) - ((p.v || 0) / maxV) * (h - 7),
  ];

  /* clean modern look: soft fill underneath + a thin clean line, no glow */
  const fillA = (sr) => {
    if (sr.pts.length < 2) return;
    const pts = sr.pts.map(toXY);
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i][0], pts[i][1]);
    }
    ctx.lineTo(pts[pts.length - 1][0], h - 2);
    ctx.lineTo(pts[0][0], h - 2);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, hexA(sr.color, 0.20));
    g.addColorStop(1, hexA(sr.color, 0.02));
    ctx.fillStyle = g;
    ctx.fill();
  };
  fillA(series[0]);

  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const sr of series) {
    if (sr.pts.length < 2) continue;
    ctx.strokeStyle = sr.color;
    ctx.beginPath();
    const pts = sr.pts.map(toXY);
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i][0], pts[i][1]);
    }
    ctx.stroke();
  }
}

function hexA(hex, a) {
  const m = String(hex || '').replace('#', '');
  const f = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  if (f.length < 6) return `rgba(139,124,255,${a})`;
  const r = parseInt(f.slice(0, 2), 16);
  const g = parseInt(f.slice(2, 4), 16);
  const b = parseInt(f.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

/* =========================================================
   Terminal sessions
========================================================= */

function makeTerminal() {
  const term = new Terminal({
    fontFamily: '"Cascadia Mono", Consolas, "DejaVu Sans Mono", monospace',
    fontSize: 13.5,
    lineHeight: 1.05,
    cursorBlink: true,
    scrollback: 20000,
    convertEol: false,
    theme: {
      background: '#0a0c14',
      foreground: '#e6e9f2',
      cursor: '#f7f7f7',
      selectionBackground: 'rgba(139, 124, 255, .35)',
      black: '#151823', red: '#f6615c', green: '#35d07f', yellow: '#eec25f',
      blue: '#5ea2ff', magenta: '#c58fff', cyan: '#4dd3dd', white: '#e5e9f5',
      brightBlack: '#5b6178', brightRed: '#ff7d78', brightGreen: '#59e99b',
      brightYellow: '#f7d07e', brightBlue: '#84b6ff', brightMagenta: '#d8aeff',
      brightCyan: '#77e2ea', brightWhite: '#ffffff',
    },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);

  /* copy-paste: Ctrl+C copies the selection (no SIGINT), otherwise it sends ^C; Ctrl+V pastes */
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl || e.altKey) return true;
    const key = e.key ? String(e.key).toLowerCase() : '';
    if (key === 'c' && term.hasSelection()) {
      navigator.clipboard.writeText(term.getSelection()).catch(() => {});
      return false;
    }
    if (key === 'v') {
      navigator.clipboard.readText()
        .then((t) => { if (t && t.length) term.paste(t); })
        .catch(() => {});
      return false;
    }
    return true;
  });

  return { term, fit };
}

function createSession(host, sid) {
  const { term, fit } = makeTerminal();

  const container = el('div', 'term-wrap hidden');
  const termArea = el('div', 'term-area');
  container.appendChild(termArea);
  els.workspace.appendChild(container);

  const s = {
    host: { ...host },
    sid,
    term,
    fit,
    container,
    termArea,
    ro: null,
    status: 'connecting',
    tabEl: null,
    termOpened: false,
  };

  const ro = new ResizeObserver(() => fitSession(s));
  ro.observe(container);
  s.ro = ro;

  /* right-click in the terminal: copy / paste / reconnect */
  container.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    T.ctxMenu([
      { label: S('Kopiraj'), disabled: !term.hasSelection(), action: () => {
        navigator.clipboard.writeText(term.getSelection()).catch(() => {});
      } },
      { label: S('Zalijepi'), action: () => {
        navigator.clipboard.readText().then((t) => { if (t) term.paste(t); }).catch(() => {});
      } },
      '-',
      { label: S('⟳ Ponovna veza'), action: () => {
        if (s.status === 'on') TRI.closeSession(s.sid);
        s.status = 'connecting';
        setTabStatus(s, 'connecting');
        TRI.connect(s.sid, s.host.id)
          .then(() => { s.status = 'on'; setTabStatus(s, 'on'); })
          .catch(() => { s.status = 'err'; setTabStatus(s, 'err'); });
      } },
      { label: S('Zatvori tab'), danger: true, action: () => closeSession(sid) },
    ], e.clientX, e.clientY);
  });

  /* tab */
  const tab = el('button', 'tab');
  tab.type = 'button';
  const dot = el('span', 'tab-dot connecting');
  const lbl = el('span', 'tab-label', host.label);
  const x = el('span', 'tab-close', '✕');
  x.title = S('Zatvori (Ctrl+W)');
  tab.append(dot, lbl, x);
  tab.title = `${host.username}@${host.host}:${host.port}`;
  lbl.title = tab.title;
  tab.addEventListener('click', () => showSession(sid));
  x.addEventListener('click', (e) => { e.stopPropagation(); closeSession(sid); });
  tab.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    T.ctxMenu([
      { label: S('Dupliraj vezu'), action: () => connectToHost(s.host) },
      '-',
      { label: S('Zatvori tab'), danger: true, action: () => closeSession(sid) },
    ], e.clientX, e.clientY);
  });
  s.tabEl = tab;
  els.tabbar.insertBefore(tab, btnDupTab);

  term.onData((d) => { if (s.status === 'on') TRI.input(sid, d); });
  term.onResize(({ cols, rows }) => TRI.resize(sid, cols, rows));

  state.sessions.set(sid, s);
  renderConnections();
  persistUi();
  return s;
}

function connectToHost(host, reuseSid = null) {
  setView('terminal');
  const sid = reuseSid || (crypto.randomUUID ? crypto.randomUUID() : 's-' + Date.now() + '-' + Math.random().toString(36).slice(2));
  let s = reuseSid ? state.sessions.get(sid) : null;
  if (!s) s = createSession(host, sid);

  s.host = { ...host };
  s.status = 'connecting';
  setTabStatus(s, 'connecting');
  showSession(sid);

  TRI.connect(sid, host.id)
    .then(() => {
      s.status = 'on';
      setTabStatus(s, 'on');
      s.term.focus();
    })
    .catch((err) => {
      if (!state.sessions.has(sid)) return;
      const msg = String((err && err.message) || err);
      if (msg === 'close-requested') return;
      s.status = 'err';
      setTabStatus(s, 'err');
      s.term.write(`\r\n\x1b[38;2;246;97;92m● TrixSSH: ${msg}\x1b[0m\r\n`);
      s.term.write(`\x1b[90m  ${S('(Ctrl+R ponovno spaja)')}\x1b[0m\r\n`);
    });
  renderConnections();
}

function reconnectActive() {
  const s = activeSession();
  if (!s) return;
  if (s.status === 'on') TRI.closeSession(s.sid);
  s.status = 'connecting';
  setTabStatus(s, 'connecting');
  TRI.connect(s.sid, s.host.id)
    .then(() => { s.status = 'on'; setTabStatus(s, 'on'); s.term.focus(); })
    .catch((err) => {
      const msg = String((err && err.message) || err);
      if (msg === 'close-requested') return;
      s.status = 'err';
      setTabStatus(s, 'err');
      s.term.write(`\r\n\x1b[38;2;246;97;92m● TrixSSH: ${msg}\x1b[0m\r\n`);
    });
}

function showSession(sid) {
  const prev = state.sessions.get(state.activeSid);
  if (prev) {
    prev.container.classList.add('hidden');
    prev.tabEl.classList.remove('active');
  }
  const s = state.sessions.get(sid);
  if (!s) return;
  state.activeSid = sid;
  s.container.classList.remove('hidden');
  s.tabEl.classList.add('active');
  els.welcome.classList.add('hidden');
  if (!s.termOpened) {
    s.term.open(s.termArea);
    s.termOpened = true;
  }
  fitSession(s, true);
  refreshSrvPanel();
  setTimeout(() => { if (s.status === 'on') s.term.focus(); }, 0);
  document.title = `TrixSSH — ${s.host.label}`;
}

function closeSession(sid) {
  const s = state.sessions.get(sid);
  if (!s) return;
  TRI.closeSession(sid);
  try { s.ro.disconnect(); s.term.dispose(); } catch { /*  */ }
  s.container.remove();
  const idx = [...state.sessions.keys()].indexOf(sid);
  state.sessions.delete(sid);
  s.tabEl.remove();
  if (state.activeSid === sid) {
    state.activeSid = null;
    const next = [...state.sessions.values()][Math.max(0, idx - 1)];
    if (next) showSession(next.sid);
    else {
      els.welcome.classList.remove('hidden');
      document.title = 'TrixSSH';
    }
  }
  renderConnections();
  refreshSrvPanel();
  persistUi();
}

function fitSession(s, force) {
  if (!s || !s.termOpened || s.container.classList.contains('hidden')) return;
  try {
    if (s.container.offsetWidth > 40) {
      s.fit.fit();
      if (force) TRI.resize(s.sid, s.term.cols, s.term.rows);
    }
  } catch { /* */ }
}

const DOT_CLASS = { connecting: 'connecting', on: 'on', err: 'err', closed: 'closed' };
function setTabStatus(s, status) {
  s.tabEl.querySelector('.tab-dot').className = `tab-dot ${DOT_CLASS[status] || 'closed'}`;
}

function activeSession() {
  return state.sessions.get(state.activeSid) || null;
}

function duplicateActive() {
  const s = activeSession();
  if (s) connectToHost(s.host);
  else T.toast(S('Nema otvorenih veza.'), true);
}

function makeDupButton() {
  const b = el('button');
  b.id = 'btnDupTab';
  b.type = 'button';
  b.textContent = '+';
  b.title = S('Nova veza na isti server (Ctrl+T)');
  b.addEventListener('click', duplicateActive);
  els.tabbar.appendChild(b);
  btnDupTab = b;

  const tools = el('div', 'tab-tools');
  const sftpBtn = el('button', 'tool-btn', '▤');
  sftpBtn.title = S('SFTP preglednik');
  sftpBtn.addEventListener('click', () => {
    const s = activeSession();
    if (!s) { T.toast(S('Nema veza — spoji se na server.'), true); return; }
    bindSftpHost(s.host);
    setView('sftp');
  });
  btnBcastTool = el('button', 'tool-btn', '⇉');
  btnBcastTool.title = 'Broadcast (Ctrl+B)';
  btnBcastTool.addEventListener('click', openBroadcast);
  srvPanel.btn = el('button', 'tool-btn', '▦');
  srvPanel.btn.title = S('Metrike servera');
  srvPanel.btn.addEventListener('click', () => {
    state.srvOpen = !state.srvOpen;
    if (state.settings) TRI.settingsSet({ srvPanelOpen: state.srvOpen });
    refreshSrvPanel();
  });
  tools.append(sftpBtn, btnBcastTool, srvPanel.btn);
  els.tabbar.appendChild(tools);
}

/* =========================================================
   Broadcast
========================================================= */

function openBroadcast() {
  const opens = [...state.sessions.values()];
  if (!opens.length) {
    T.toast(S('Nema otvorenih veza.'), true);
    return;
  }
  els.bcastList.innerHTML = '';
  for (const s of opens) {
    const lab = el('label', 'bcast-row');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = s.status === 'on';
    cb.dataset.sid = s.sid;
    const txt = el('span', 'bcast-txt', `${s.host.label} — ${s.host.username}@${mask(s.host.host)}`);
    lab.append(cb, txt);
    els.bcastList.appendChild(lab);
  }
  els.bcastCmd.value = '';
  els.bcastModal.classList.remove('hidden');
  els.bcastCmd.focus();
}

function sendBroadcast() {
  const cmd = els.bcastCmd.value.trim();
  if (!cmd) { T.toast(S('Unesi komandu.'), true); return; }
  const targets = [];
  for (const cb of els.bcastList.querySelectorAll('input[type="checkbox"]')) {
    if (!cb.checked) continue;
    const s = state.sessions.get(cb.dataset.sid);
    if (s && s.status === 'on') targets.push(s.sid);
  }
  if (!targets.length) { T.toast(S('Nijedna označena veza nije aktivna.'), true); return; }
  for (const sid of targets) TRI.input(sid, cmd + '\r');
  els.bcastModal.classList.add('hidden');
  T.toast(S(targets.length === 1 ? 'Poslano na {0} vezu.' : 'Poslano na {0} veza.', targets.length));
}

/* =========================================================
   SSH events
========================================================= */

TRI.onData((sid, data) => {
  const s = state.sessions.get(sid);
  if (s && s.termOpened) {
    try { s.term.write(data); } catch { /* */ }
  }
});

TRI.onClose((sid) => {
  const s = state.sessions.get(sid);
  if (!s) return;
  if (s.status === 'on' || s.status === 'connecting') {
    s.status = 'closed';
    setTabStatus(s, 'closed');
    s.term.write(`\r\n\x1b[90m● TrixSSH: ${S('veza zatvorena. (Ctrl+R za ponovno spajanje)')}\x1b[0m\r\n`);
  }
  renderConnections();
});

/* =========================================================
   Modal — host
========================================================= */

const btnPickKey = document.getElementById('btnPickKey');
btnPickKey.addEventListener('click', async () => {
  const res = await TRI.pickKeyFile();
  if (!res) return;
  if (res.error) { T.toast(res.error, true); return; }
  const content = String(res.content || '').trim();
  if (!content) { T.toast(S('Datoteka je prazna.'), true); return; }
  els.fKey.value = content;
  if (content.includes('BEGIN RSA PRIVATE KEY') || content.includes('BEGIN EC PRIVATE KEY')) {
    T.toast(S('Ključ učitan: {0} (stariji PEM format, ssh2 ga podržava).', res.name));
  } else if (content.includes('PRIVATE KEY')) {
    T.toast(S('Ključ učitan: {0}', res.name));
  } else if (/^PuTTY-User-Key-File|^PuTTY-User-Key-Data/.test(content)) {
    els.fKey.value = '';
    T.toast(S('Ovo je PuTTY .ppk format — Treba ti OpenSSH ključ (puttygen: Conversions → Export OpenSSH key).'), true);
  } else {
    T.toast(S('Sadržaj učitan ({0}), ali ne liči na OpenSSH ključ — provjeri datoteku.', res.name), true);
  }
});

function buildSwatches() {
  els.colorSwatches.innerHTML = '';
  for (const c of PALETTE) {
    const b = el('button', 'swatch' + (c === selectedColor ? ' sel' : ''));
    b.type = 'button';
    b.style.background = c;
    b.addEventListener('click', () => {
      selectedColor = c;
      for (const x of els.colorSwatches.children) x.classList.toggle('sel', x === b);
    });
    els.colorSwatches.appendChild(b);
  }
}

function openHostModal(host = null) {
  editingHost = host ?? null;
  selectedColor = host?.color || PALETTE[0];
  buildSwatches();

  els.modalTitle.textContent = host ? S('Uredi server') : S('Novi server');
  els.fLabel.value = host?.label ?? '';
  els.fHost.value = host?.host ?? '';
  els.fPort.value = host ? String(host.port ?? 22) : '22';
  els.fUser.value = host?.username ?? '';

  els.fAuth.value = host?.authType === 'key' ? 'key' : 'password';
  els.fPassword.value = '';
  els.fKey.value = '';
  els.fPassphrase.value = '';

  const editMode = Boolean(host);
  els.notePassword.classList.toggle('hidden', !editMode || !host.hasPassword);
  els.noteKey.classList.toggle('hidden', !editMode || !host.hasKey);
  els.notePass.classList.toggle('hidden', !editMode || !host.hasKey);

  toggleAuthRows();
  els.hostModal.classList.remove('hidden');
  (editMode ? els.fLabel : els.fHost).focus();
}

function toggleAuthRows() {
  const isKey = els.fAuth.value === 'key';
  els.rowPassword.classList.toggle('hidden', isKey);
  els.rowKey.classList.toggle('hidden', !isKey);
  els.fPassword.disabled = isKey;
  els.fKey.disabled = !isKey;
  els.fPassphrase.disabled = !isKey;
}

function closeHostModal() {
  els.hostModal.classList.add('hidden');
  editingHost = null;
}

async function saveHostFromForm(e) {
  e.preventDefault();
  const wasEdit = !!editingHost;
  const payload = {
    id: editingHost ? editingHost.id : undefined,
    label: els.fLabel.value.trim() || els.fHost.value.trim(),
    host: els.fHost.value.trim(),
    port: els.fPort.value.trim() || '22',
    username: els.fUser.value.trim() || 'root',
    color: selectedColor,
    authType: els.fAuth.value,
    password: els.rowPassword.classList.contains('hidden') ? '' : els.fPassword.value,
    privateKey: els.rowPassword.classList.contains('hidden') ? els.fKey.value : '',
    passphrase: els.rowPassword.classList.contains('hidden') ? els.fPassphrase.value : '',
  };

  if (!payload.host) { T.toast(S('Unesi host ili IP adresu.'), true); els.fHost.focus(); return; }

  const saved = await TRI.saveHost(payload);
  const i = state.hosts.findIndex((h) => h.id === saved.id);
  if (i >= 0) state.hosts[i] = saved; else state.hosts.push(saved);
  closeHostModal();
  editingHost = null;
  renderDashboard();
  TRI.monitorEnsure(saved.id);
  for (const s of state.sessions.values()) {
    if (s.host.id === saved.id) {
      s.host = { ...saved };
      s.tabEl.querySelector('.tab-label').textContent = saved.label;
    }
  }
  T.toast(wasEdit ? S('Server je ažuriran.') : S('Server je spremljen.'));
}

/* =========================================================
   Tab persistence
========================================================= */

function persistUi() {
  const ids = [];
  for (const s of state.sessions.values()) {
    if (s.host && s.host.id && !ids.includes(s.host.id)) ids.push(s.host.id);
  }
  TRI.saveUiState({ openHostIds: ids });
}

async function restoreUi() {
  try {
    const ui = await TRI.loadUiState();
    if (!ui || !Array.isArray(ui.openHostIds) || !ui.openHostIds.length) return;
    const toOpen = ui.openHostIds.map((id) => state.hosts.find((h) => h.id === id)).filter(Boolean);
    if (!toOpen.length) return;
    toOpen.forEach((h, i) => setTimeout(() => connectToHost(h), 800 + i * 200));
  } catch { /* */ }
}

window.addEventListener('beforeunload', persistUi);

/* =========================================================
   Statusbar
========================================================= */

function updateCounts() {
  const online = state.hosts.filter((h) => monitorOf(h.id).status === 'online').length;
  const offline = state.hosts.length - online;
  const alert = state.hosts.filter((h) => {
    const m = monitorOf(h.id);
    const v = m.metrics;
    return v && (
      (v.cpu != null && v.cpu >= 90) ||
      (v.ramPct != null && v.ramPct >= 90) ||
      (v.diskPct != null && v.diskPct >= 90)
    );
  }).length;
  els.sbCounts.innerHTML =
    `<span><b>${state.hosts.length}</b> hostova</span>`;
  void alert; void online; void offline;
  const parts = [];
  parts.push(`<span class="cnt">${S('{0} hosts', state.hosts.length)}</span>`);
  parts.push(`<span class="cnt ok">● ${online} online</span>`);
  parts.push(`<span class="cnt ${alert ? 'warn' : ''}">${alert} alert</span>`);
  parts.push(`<span class="cnt ${offline ? 'dim' : ''}">${offline} offline</span>`);
  els.sbCounts.innerHTML = parts.join('<span class="cnt-sep"></span>');
}

/* =========================================================
   Updates
========================================================= */

let appVer = '1.0.0';
let upState = { info: null, ready: false, busy: false };

TRI.onUpdateAvailable((info) => showUpdateModal(info));

TRI.onUpdateProgress((p) => {
  els.uProgressWrap.classList.remove('hidden');
  els.uProgLabel.textContent = S('Preuzimanje — {0} / {1}', T.fmtSize(p.loaded), p.total > 0 ? T.fmtSize(p.total) : '∞');
  if (p.total > 0) els.uProgFill.style.width = Math.min(100, (p.loaded / p.total) * 100) + '%';
});

TRI.onUpdateReady(() => {
  upState.ready = true;
  upState.busy = false;
  els.uProgLabel.textContent = S('Preuzimanje završeno ✓');
  els.uProgFill.style.width = '100%';
  setTimeout(() => els.uProgressWrap.classList.add('hidden'), 700);
  els.uInstall.classList.remove('hidden');
  els.uDownload.classList.add('hidden');
});

TRI.onUpdateCheckResult((r) => {
  if (!r) return;
  if (r.error) { T.toast(r.error, true); return; }
  if (r.current) T.toast(S('Imaš najnoviju verziju ({0}). ✓', r.current));
  if (els.btnCheckUpd) {
    els.btnCheckUpd.disabled = false;
    els.btnCheckUpd.textContent = S('Provjeri ažuriranje');
  }
});

function showUpdateModal(info) {
  upState.info = info;
  upState.ready = false;
  /* a manual check may find a new version — free up the button in settings */
  if (els.btnCheckUpd) {
    els.btnCheckUpd.disabled = false;
    els.btnCheckUpd.textContent = S('Provjeri ažuriranje');
  }
  els.uTitle.textContent = S('Nova verzija {0} dostupna', info.version);
  els.uInfo.textContent = (info.notes ? info.notes + '\n\n' : '') + S('Trenutna verzija: {0} → Nova: {1}', info.current, info.version);
  els.uProgressWrap.classList.add('hidden');
  els.uInstall.classList.add('hidden');
  els.uDownload.classList.remove('hidden');
  els.uDownload.disabled = false;
  els.uClose.textContent = S('Kasnije');
  els.updateOverlay.classList.remove('hidden');
}

els.uDownload.addEventListener('click', async () => {
  if (upState.busy || !TRIparamReady()) return;
  upState.busy = true;
  els.uDownload.disabled = true;
  els.uProgressWrap.classList.remove('hidden');
  els.uProgLabel.textContent = S('Preuzimanje — …');
  const res = await TRI.updateDownload();
  upState.busy = false;
  if (res && res.ok && res.external) {
    /* macOS/Linux — the download goes through the browser */
    els.uProgressWrap.classList.add('hidden');
    T.toast(S('Preuzimanje otvoreno u pregledniku.'));
    setTimeout(() => els.updateOverlay.classList.add('hidden'), 500);
    return;
  }
  if (res && res.error) {
    T.toast(S('Preuzimanje neuspjelo: {0}', res.error), true);
    els.uProgressWrap.classList.add('hidden');
    els.uDownload.disabled = !upState.ready;
  }
});

function TRIparamReady() { return !!upState.info; }

els.uInstall.addEventListener('click', async () => {
  els.uInstall.disabled = true;
  T.toast(S('Pokrećem instalaciju — aplikacija će se zatvoriti…'));
  const res = await TRI.updateInstall();
  if (res && res.error) {
    els.uInstall.disabled = false;
    T.toast(res.error, true);
  }
});

els.uClose.addEventListener('click', () => {
  els.updateOverlay.classList.add('hidden');
  TRI.updateLater();
});

/* =========================================================
   Keyboard shortcuts
========================================================= */

document.addEventListener('keydown', (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  if (!ctrl) {
    if (e.key === 'Escape') {
      if (pickState && pickState.open) { closeHostPicker(); e.preventDefault(); return; }
      for (const ov of [els.hostModal, els.snipModal, els.bcastModal, els.updateOverlay]) {
        if (ov && !ov.classList.contains('hidden')) {
          ov.classList.add('hidden');
          e.preventDefault();
          return;
        }
      }
    }
    return;
  }
  if (e.altKey) return;

  switch (e.key.toLowerCase()) {
    case 't': e.preventDefault(); duplicateActive(); break;
    case 'w': e.preventDefault(); if (state.activeSid) closeSession(state.activeSid); break;
    case 'r': e.preventDefault(); if (state.activeSid) reconnectActive(); break;
    case 'b': e.preventDefault(); openBroadcast(); break;
    case 'e': e.preventDefault(); openSnipModal(); break;
    case 'n': e.preventDefault(); openHostModal(); break;
    case ',': e.preventDefault(); setView('settings'); break;
    case '1': e.preventDefault(); setView('dashboard'); break;
    case '2': e.preventDefault(); setView('snippets'); break;
    case '3': e.preventDefault(); setView('sftp'); break;
    case '4': e.preventDefault(); setView('terminal'); break;
    case 'tab': {
      e.preventDefault();
      const ids = [...state.sessions.keys()];
      if (ids.length < 2) return;
      const nextIdx = (ids.indexOf(state.activeSid) + 1) % ids.length;
      setView('terminal');
      showSession(ids[nextIdx]);
      break;
    }
  }
});

/* modal events */
els.fAuth.addEventListener('change', toggleAuthRows);
els.btnCancel.addEventListener('click', closeHostModal);
els.hostModal.addEventListener('mousedown', (e) => { if (e.target === els.hostModal) closeHostModal(); });
els.hostForm.addEventListener('submit', saveHostFromForm);
els.snipCancel.addEventListener('click', () => { els.snipModal.classList.add('hidden'); editingSnip = null; });
els.snipModal.addEventListener('mousedown', (e) => { if (e.target === els.snipModal) { els.snipModal.classList.add('hidden'); editingSnip = null; } });
els.snipForm.addEventListener('submit', saveSnipFromForm);
els.bcastCancel.addEventListener('click', () => els.bcastModal.classList.add('hidden'));
els.bcastSend.addEventListener('click', sendBroadcast);
els.bcastModal.addEventListener('mousedown', (e) => { if (e.target === els.bcastModal) els.bcastModal.classList.add('hidden'); });
els.bcastCmd.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); sendBroadcast(); }
});

els.btnWelcomeAdd.addEventListener('click', () => openHostModal());
els.viewDashboard.addEventListener('click', onDashAction);

/* =========================================================
   Init
========================================================= */

init();
async function init() {
  makeDupButton();
  buildSrvPanel();
  await initSettings();
  T.i18n.init(state.settings && state.settings.lang);
  await loadHosts();
  await loadSnippets();
  appVer = ((await TRI.appVersion()) || {}).version || appVer;
  renderConnections();
  renderDashboard();
  renderSettings();
  ensureAllMonitors();
  setView('dashboard');
  await restoreUi();
}
