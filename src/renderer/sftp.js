'use strict';

/* TrixSSH — SFTP full-page browser (local ↔ server) */

(function () {
  const T = window.TRX;
  const TRI = window.trix;
  const S = (...a) => T.i18n.tr(...a);

  let inited = false;
  let hostId = null;
  let awaiting = null;
  const local = { path: null, sel: new Set(), entries: null, list: null, bar: null, driveSel: null };
  const remote = { path: null, sel: new Set(), entries: null, list: null, bar: null, hostSel: null, labelEl: null };
  let prog, progLabel, progFill, pb;
  let hostsCache = [];

  function el(tag, cls, txt) {
    const d = document.createElement(tag);
    if (cls) d.className = cls;
    if (txt != null) d.textContent = txt;
    return d;
  }

  function build() {
    const view = document.getElementById('viewSftp');
    view.innerHTML = '';

    const page = el('div', 'sftp-page');

    /* ---- LOCAL column ---- */
    const colL = el('div', 'sftp-col');
    const headL = el('div', 'sftp-head');
    const hl = el('b', null, S('LOCALNO'));
    const toolsL = el('div', 'tools');
    const mkMini = (parent, act, side, txt, title) => {
      const b = el('button', 'mini', txt);
      b.title = title;
      b.dataset.act = act + ':' + side;
      parent.appendChild(b);
    };
    local.driveSel = document.createElement('select');
    local.driveSel.className = 'sftp-drive';
    headL.append(hl, local.driveSel, toolsL);
    mkMini(toolsL, 'mkdir', 'local', '＋', S('Nova mapa'));
    mkMini(toolsL, 'rename', 'local', '✎', S('Preimenuj'));
    mkMini(toolsL, 'delete', 'local', '🗑', S('Obriši'));
    const barL = el('div', 'sftp-bar');
    const upL = el('button', 'mini', '⬆');
    upL.title = S('Nagore');
    upL.dataset.act = 'up:local';
    local.bar = document.createElement('input');
    local.bar.className = 'sftp-path';
    local.bar.spellcheck = false;
    const refL = el('button', 'mini', '⟳');
    refL.title = 'Osvježi';
    refL.dataset.act = 'refresh:local';
    barL.append(upL, local.bar, refL);
    local.list = el('div', 'sftp-list');
    colL.append(headL, barL, local.list);

    /* ---- middle column ---- */
    const mid = el('div', 'sftp-mid');
    const btnUp = el('button', 'mid', '');
    btnUp.innerHTML = '⬆<small>' + S('Pošalji') + '</small>';
    btnUp.dataset.act = 'transfer:up';
    btnUp.title = S('Pošalji označene lokalne datoteke na server');
    const btnDown = el('button', 'mid', '');
    btnDown.innerHTML = '⬇<small>' + S('Preuzmi') + '</small>';
    btnDown.dataset.act = 'transfer:down';
    btnDown.title = S('Preuzmi označene datoteke s servera');
    mid.append(btnUp, btnDown);

    /* ---- REMOTE column ---- */
    const colR = el('div', 'sftp-col');
    const headR = el('div', 'sftp-head');
    remote.hostSel = document.createElement('select');
    remote.hostSel.className = 'sftp-drive';
    const toolsR = el('div', 'tools');
    mkMini(toolsR, 'mkdir', 'remote', '＋', S('Nova mapa'));
    mkMini(toolsR, 'rename', 'remote', '✎', S('Preimenuj'));
    mkMini(toolsR, 'delete', 'remote', '🗑', S('Obriši'));
    mkMini(toolsR, 'refresh', 'remote', '⟳', S('Osvježi'));
    headR.append(remote.hostSel, toolsR);
    const barR = el('div', 'sftp-bar');
    const upR = el('button', 'mini', '⬆');
    upR.title = S('Nagore');
    upR.dataset.act = 'up:remote';
    remote.bar = document.createElement('input');
    remote.bar.className = 'sftp-path';
    remote.bar.spellcheck = false;
    const refR = el('button', 'mini', '⟳');
    refR.title = 'Osvježi';
    refR.dataset.act = 'refresh:remote';
    barR.append(upR, remote.bar, refR);
    remote.list = el('div', 'sftp-list');
    colR.append(headR, barR, remote.list);

    /* ---- progress ---- */
    prog = el('div', 'sftp-progress hidden');
    progLabel = el('span', 'prog-label');
    pb = el('div', 'prog-bar');
    progFill = el('div', 'prog-fill');
    pb.appendChild(progFill);
    prog.append(progLabel, pb);

    page.append(colL, mid, colR);
    view.appendChild(page);
    view.appendChild(prog);

    /* events */
    page.addEventListener('click', onAction);

    const listMenu = (side) => (e) => {
      if (e.target.closest && e.target.closest('.sftp-row')) return;
      e.preventDefault();
      const cur2 = side === 'local' ? local : remote;
      T.ctxMenu([
        { label: S('＋ Nova mapa'), action: () => doMkdir(side, cur2, () => refresh(side)) },
        { label: S('⟳ Osvježi'), action: () => refresh(side) },
        '-',
        { label: S('⬆ Na gore'), disabled: cur2.path == null, action: () => {
          const parent = side === 'local' ? T.parentLocal(cur2.path) : T.parentRemote(cur2.path);
          if (parent != null && parent !== cur2.path) { cur2.path = parent; cur2.sel.clear(); refresh(side); }
        } },
      ], e.clientX, e.clientY);
    };
    local.list.addEventListener('contextmenu', listMenu('local'));
    remote.list.addEventListener('contextmenu', listMenu('remote'));
    for (const bar of [local.bar, remote.bar]) {
      bar.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const side = bar === local.bar ? 'local' : 'remote';
        const cur = side === 'local' ? local : remote;
        const val = bar.value.trim();
        if (!val) return;
        if (side === 'remote') cur.path = val; else cur.path = val;
        cur.sel.clear();
        refresh(side);
      });
    }
    local.driveSel.addEventListener('change', () => {
      local.path = T.localJoin('ROOTS', local.driveSel.value);
      local.sel.clear();
      refresh('local');
    });
    remote.hostSel.addEventListener('change', onHostChange);
  }

  /* ---------- hosts and status ---------- */

  function populateHosts(selected) {
    hostsCache = window.TRX.getHostsCache ? window.TRX.getHostsCache() : [];
    remote.hostSel.innerHTML = '';
    if (!hostsCache.length) {
      const o = el('option', null, S('— nema servera —'));
      o.value = '';
      remote.hostSel.appendChild(o);
      return;
    }
    for (const h of hostsCache) {
      const o = el('option', null, h.label);
      o.value = h.id;
      remote.hostSel.appendChild(o);
    }
    if (selected && hostsCache.some((h) => h.id === selected)) remote.hostSel.value = selected;
    else if (hostId && hostsCache.some((h) => h.id === hostId)) remote.hostSel.value = hostId;
  }

  async function onHostChange() {
    const hid = remote.hostSel.value;
    hostId = hid;
    remote.path = null;
    remote.entries = null;
    remote.sel.clear();
    remote.list.innerHTML = '';
    if (!hid) {
      remote.list.appendChild(el('div', 'sftp-empty', S('Odaberi server.')));
      return;
    }
    remote.list.appendChild(el('div', 'sftp-empty', S('Spajam se na server…')));
    awaiting = hid;
    TRI.monitorEnsure(hid);
    await connectRemoteSoon(hid);
  }

  /* fetch the home dir right away and retry for ~12 s while the monitor is
     still connecting (don't rely only on status events — they can be missed) */
  async function connectRemoteSoon(hid) {
    let lastErr = '';
    for (let i = 0; i < 8; i++) {
      if (remote.hostSel.value !== hid) return; /* server changed — stop */
      const r = await TRI.remoteHome(hid);
      if (r && r.home) {
        if (remote.hostSel.value !== hid) return;
        remote.path = r.home;
        awaiting = null;
        refresh('remote');
        return;
      }
      lastErr = (r && r.error) || S('Ne mogu dohvatiti home.');
      /* "not connected / SFTP channel timeout" -> the monitor is still connecting; a real error -> stop */
      if (!/povezan|connected|odaziva|timeout/i.test(lastErr)) break;
      await new Promise((res) => setTimeout(res, i === 6 ? 3000 : 1400));
    }
    if (remote.hostSel.value !== hid) return;
    remote.list.innerHTML = '';
    remote.list.appendChild(el('div', 'sftp-empty err', lastErr));
  }

  async function initRemote() {
    if (!hostId) return;
    const r = await TRI.remoteHome(hostId);
    if (remote.hostSel.value !== hostId) return;
    if (r && r.home) {
      remote.path = r.home;
      awaiting = null;
      refresh('remote');
    } else {
      const err = (r && r.error) || S('Ne mogu dohvatiti home.');
      remote.path = '/';
      remote.list.innerHTML = '';
      remote.list.appendChild(el('div', 'sftp-empty err', err));
    }
  }

  /* ---------- actions ---------- */

  function onAction(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    e.stopPropagation();
    const [act, side] = b.dataset.act.split(':');
    const cur = side === 'local' ? local : remote;

    const fire = () => refresh(side);

    if (act === 'refresh') {
      if (side === 'remote' && !remote.path && hostId) { initRemote(); return; }
      fire();
    } else if (act === 'up') {
      const parent = side === 'local' ? T.parentLocal(cur.path) : T.parentRemote(cur.path);
      if (parent != null && parent !== cur.path) {
        cur.path = parent;
        cur.sel.clear();
        fire();
      }
    } else if (act === 'mkdir') {
      doMkdir(side, cur, fire);
    } else if (act === 'delete') {
      doDelete(side, cur, fire, b);
    } else if (act === 'rename') {
      doRename(side, cur, fire);
    } else if (act === 'transfer') {
      side === 'up' ? doUpload() : doDownload();
    }
  }

  function firstSel(cur) {
    if (!cur.entries || !cur.sel.size) return null;
    const name = [...cur.sel][0];
    return cur.entries.find((x) => x.name === name) || null;
  }

  function selItems(cur) {
    if (!cur.entries) return [];
    return cur.entries.filter((x) => cur.sel.has(x.name));
  }

  async function doMkdir(side, cur, fire) {
    if (cur.path == null) { T.toast(S('Prvo odaberi mapu.'), true); return; }
    const name = await T.ask(S('Naziv nove mape:'), 'nova-mapa');
    if (!name) return;
    const full = side === 'local' ? T.localJoin(cur.path, name) : T.remoteJoin(cur.path, name);
    const res = side === 'local' ? await TRI.mkLocalDir(full) : await TRI.remoteMkdir(hostId, full);
    if (res && res.error) T.toast(res.error, true);
    fire();
  }

  async function deleteItems(side, cur, names) {
    if (!names || !names.length) return;
    const isRemote = side === 'remote';
    for (const name of names) {
      const ent = cur.entries && cur.entries.find((x) => x.name === name);
      if (isRemote && ent && ent.isDir) {
        const ya = T.i18n.yes();
        const ans = await T.ask(S('Mapa "{0}" bit će obrisana sa SAVIM sadržajem.\nUpiši {1} za potvrdu:', name, ya), ya);
        if (ans !== ya) return;
      }
      const full = isRemote ? T.remoteJoin(cur.path, name) : T.localJoin(cur.path, name);
      const res = isRemote
        ? await TRI.remoteDelete(hostId, full, !!(ent && ent.isDir))
        : await TRI.delLocal(full, !!(ent && ent.isDir));
      if (res && res.error) { T.toast(S('Brisanje greška ({0}): {1}', name, res.error), true); continue; }
    }
    cur.sel.clear();
    T.toast(S('Obrisano.'));
    refresh(side);
  }

  function doDelete(side, cur, fire, btn) {
    const items = [...cur.sel];
    if (!items.length) { T.toast(S('Označi stavke pomoću kvačica.'), true); return; }
    T.armBtn(btn, 'del:' + side + ':' + items.join('|'), async () => {
      const snapshot = [...items];
      cur.sel.clear();
      await deleteItems(side, cur, snapshot);
      fire();
    });
  }

  async function doRename(side, cur, fire) {
    const sel = firstSel(cur);
    if (!sel) { T.toast(S('Označi točno jednu stavku.'), true); return; }
    const newName = await T.ask(S('Novo ime za "{0}":', sel.name), sel.name);
    if (!newName || newName === sel.name) return;
    const from = side === 'local' ? T.localJoin(cur.path, sel.name) : T.remoteJoin(cur.path, sel.name);
    const to = side === 'local' ? T.localJoin(cur.path, newName) : T.remoteJoin(cur.path, newName);
    const res = side === 'local' ? await TRI.renLocal(from, to) : await TRI.remoteRename(hostId, from, to);
    if (res && res.error) T.toast(res.error, true);
    cur.sel.clear();
    fire();
  }

  async function doUpload() {
    const items = selItems(local);
    if (!items.length) { T.toast(S('Označi datoteke ili mape kvačicama.'), true); return; }
    if (!hostId || remote.path == null) { T.toast(S('Server nije odabran/spojen.'), true); return; }
    for (const f of items) {
      const src = T.localJoin(local.path, f.name);
      const target = T.remoteJoin(remote.path, f.name);
      const res = f.isDir
        ? await TRI.uploadDir(hostId, src, target)
        : await TRI.upload(hostId, src, target);
      if (res && res.error) { T.toast(S('Upload greška ({0}): {1}', f.name, res.error), true); continue; }
      T.toast(f.isDir ? S('Poslana cijela mapa: {0}', f.name) : S('Poslano: {0}', f.name));
    }
    local.sel.clear();
    refresh('remote');
  }

  async function doDownload() {
    const items = selItems(remote);
    if (!items.length) { T.toast(S('Označi datoteke ili mape na serveru kvačicama.'), true); return; }
    if (!hostId) return;

    const hasDir = items.some((x) => x.isDir);

    let destDir;
    if (!hasDir && items.length === 1) {
      const sp = await TRI.pickSaveFile(items[0].name);
      if (!sp) return;
      destDir = { dir: null, single: sp };
    } else {
      const dir = await TRI.pickDir();
      if (!dir) return;
      destDir = { dir, single: null };
    }

    for (const f of items) {
      const target = T.remoteJoin(remote.path, f.name);
      const isSingleFile = !hasDir && items.length === 1 && !f.isDir;
      const savePath = isSingleFile ? destDir.single : (destDir.dir ? T.localJoin(destDir.dir, f.name) : null);
      if (!savePath) continue;
      const res = f.isDir
        ? await TRI.downloadDir(hostId, target, savePath)
        : await TRI.download(hostId, target, savePath);
      if (res && res.error) { T.toast(S('Download greška ({0}): {1}', f.name, res.error), true); continue; }
      T.toast(f.isDir ? S('Preuzeta cijela mapa: {0}', f.name) : S('Preuzeto: {0}', f.name));
    }
    remote.sel.clear();
  }

  /* ---------- lists ---------- */

  async function refresh(side) {
    const cur = side === 'local' ? local : remote;
    cur.list.innerHTML = '<div class="sftp-empty">…</div>';
    if (side === 'local') {
      const res = await TRI.listLocalDir(cur.path === 'ROOTS' ? 'ROOTS' : cur.path);
      if (res.error) {
        cur.list.innerHTML = '';
        cur.list.appendChild(el('div', 'sftp-empty err', res.error));
        return;
      }
      if (res.path === 'ROOTS') {
        populateDrives(res.entries);
        cur.path = 'ROOTS';
        cur.bar.value = S('Diskovi…');
        cur.entries = null;
        cur.list.innerHTML = '';
        for (const d of res.entries) cur.list.appendChild(rootRow(d.name));
        return;
      }
      cur.entries = res.entries;
      cur.bar.value = res.path;
      render(side);
    } else {
      if (!hostId) { cur.list.innerHTML = '<div class="sftp-empty">' + S('Odaberi server u zaglavlju.') + '</div>'; return; }
      const res = await TRI.remoteList(hostId, cur.path || '/');
      if (res.error) {
        cur.list.innerHTML = '';
        cur.list.appendChild(el('div', 'sftp-empty err', res.error));
        return;
      }
      cur.entries = res.entries;
      cur.bar.value = res.path;
      render(side);
    }
  }

  function rootRow(name) {
    const row = el('div', 'sftp-row');
    row.appendChild(el('span', 'f-ic', '💾'));
    row.appendChild(el('span', 'f-name', name));
    row.appendChild(el('span', 'f-size', S('disk')));
    row.appendChild(el('span', 'f-date', ''));
    row.addEventListener('dblclick', () => {
      local.path = T.localJoin('ROOTS', name);
      local.sel.clear();
      refresh('local');
    });
    return row;
  }

  function populateDrives(entries) {
    local.driveSel.innerHTML = '';
    for (const d of entries) {
      const o = el('option', null, T.baseName(d.name) || d.name);
      o.value = d.name;
      local.driveSel.appendChild(o);
    }
  }

  function render(side) {
    const cur = side === 'local' ? local : remote;
    cur.list.innerHTML = '';
    if (!cur.entries || !cur.entries.length) {
      cur.list.appendChild(el('div', 'sftp-empty', S('Prazno.')));
      return;
    }
    for (const ent of cur.entries) {
      const row = el('div', 'sftp-row');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'f-cb';
      cb.checked = cur.sel.has(ent.name);
      cb.addEventListener('change', () => {
        if (cb.checked) cur.sel.add(ent.name); else cur.sel.delete(ent.name);
      });
      row.appendChild(cb);
      row.appendChild(el('span', 'f-ic', ent.isDir ? '📁' : '📄'));
      row.appendChild(el('span', 'f-name', ent.name));
      row.appendChild(el('span', 'f-size', ent.isDir ? '*' : T.fmtSize(ent.size)));
      row.appendChild(el('span', 'f-date', T.fmtDate(ent.mtime)));
      row.title = ent.name;

      row.addEventListener('click', (e) => {
        if (e.target === cb) return;
        cb.checked = !cb.checked;
        if (cb.checked) cur.sel.add(ent.name); else cur.sel.delete(ent.name);
      });

      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!cur.sel.has(ent.name)) {
          cur.sel.clear();
          cur.sel.add(ent.name);
          const st = cur.list.scrollTop;
          render(side);
          cur.list.scrollTop = st;
        }
        const isRemote = side === 'remote';
        const menu = [];
        if (ent.isDir) {
          menu.push({ label: S('Otvori'), action: () => {
            cur.path = isRemote ? T.remoteJoin(cur.path, ent.name) : T.localJoin(cur.path, ent.name);
            cur.sel.clear();
            refresh(side);
          } });
        } else {
          menu.push(isRemote
            ? { label: S('Preuzmi…'), action: () => { cur.sel.clear(); cur.sel.add(ent.name); doDownload(); } }
            : { label: S('Pošalji na server'), action: () => { cur.sel.clear(); cur.sel.add(ent.name); doUpload(); } });
        }
        menu.push('-');
        menu.push({ label: S('Preimenuj'), action: () => doRename(side, cur, () => refresh(side)) });
        menu.push({ label: S('Obriši'), danger: true, action: () => deleteItems(side, cur, [ent.name]) });
        T.ctxMenu(menu, e.clientX, e.clientY);
      });
      row.addEventListener('dblclick', () => {
        if (!ent.isDir) return;
        const next = side === 'local' ? T.localJoin(cur.path, ent.name) : T.remoteJoin(cur.path, ent.name);
        cur.path = next;
        cur.sel.clear();
        refresh(side);
      });
      cur.list.appendChild(row);
    }
  }

  function populateDrivesIfEmpty(entries) {}

  /* ---------- progress ---------- */

  function handleProgress(p) {
    if (p.done) {
      prog.classList.add('hidden');
      return;
    }
    prog.classList.remove('hidden');
    progLabel.textContent = `${p.op === 'up' ? S('⬆ Slanje') : S('⬇ Preuzimanje')}: ${p.name} — ${T.fmtSize(p.loaded)} / ${T.fmtSize(p.total)}`;
    if (p.total > 0) {
      pb && pb.classList.remove('indet');
      progFill.style.width = Math.min(100, (p.loaded / p.total) * 100) + '%';
    } else {
      pb && pb.classList.add('indet');
      progFill.style.width = '40%';
    }
  }

  /* ---------- API ---------- */

  window.TRX.sftpPage = {
    ensure() {
      if (inited) return;
      inited = true;
      build();
      TRI.onSftpProgress(handleProgress);
      TRI.onMonitorStatus((sid, status, err) => {
        const sel = remote.hostSel && remote.hostSel.value;
        if (!sel || sid !== sel) return;
        if (status === 'online' && sid === awaiting) {
          awaiting = null;
          initRemote().catch(() => {});
        } else if (status === 'offline' && err && sid === awaiting) {
          awaiting = null;
          remote.list.innerHTML = '';
          const msg = el('div', 'sftp-empty err', S('Veza nije uspjela: {0}', err));
          const retry = el('button', 'mini', S('⟳ Pokušaj ponovo'));
          retry.addEventListener('click', () => onHostChange());
          remote.list.append(msg, retry);
        }
      });
    },
    unbind() {
      this.ensure();
      hostId = null;
      awaiting = null;
      remote.path = null;
      remote.entries = null;
      remote.sel.clear();
      remote.hostSel.selectedIndex = -1;
      remote.list.innerHTML = '';
      remote.list.appendChild(el('div', 'sftp-empty', S('Odaberi server u izborniku gore.')));
    },
    async show(hid) {
      this.ensure();
      populateHosts(hid);
      if (!local.path) {
        const home = await TRI.localHome();
        local.path = home || 'ROOTS';
        refresh('local');
      }
      if (hid && hid !== hostId) {
        remote.hostSel.value = hid;
        await onHostChange().catch(() => {});
      } else if (hid && window.TRX.isMonitorOnline(hid) && !remote.entries && remote.path) {
        refresh('remote');
      }
    },
    refreshes: { local, remote, refresh },
  };
})();
