'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('trix', {
  /* hosts */
  listHosts: () => ipcRenderer.invoke('hosts:list'),
  saveHost: (host) => ipcRenderer.invoke('hosts:save', host),
  deleteHost: (id) => ipcRenderer.invoke('hosts:delete', id),

  /* monitors (live metrics + status) */
  monitorEnsure: (hostId) => ipcRenderer.invoke('monitor:ensure', hostId),
  monitorRefresh: (hostId) => ipcRenderer.invoke('monitor:refresh', hostId),

  /* snippets */
  listSnippets: () => ipcRenderer.invoke('snippets:list'),
  saveSnippet: (s) => ipcRenderer.invoke('snippets:save', s),
  deleteSnippet: (id) => ipcRenderer.invoke('snippets:delete', id),

  /* settings */
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSet: (partial) => ipcRenderer.invoke('settings:set', partial),

  /* tab state */
  saveUiState: (s) => ipcRenderer.invoke('ui:save', s),
  loadUiState: () => ipcRenderer.invoke('ui:load'),

  /* sessions */
  connect: (sid, hostId) => ipcRenderer.invoke('session:open', sid, hostId),
  input: (sid, data) => ipcRenderer.send('session:input', sid, data),
  resize: (sid, cols, rows) => ipcRenderer.send('session:resize', sid, cols, rows),
  closeSession: (sid) => ipcRenderer.invoke('session:close', sid),

  /* local FS */
  localHome: () => ipcRenderer.invoke('fs:home'),
  listLocalDir: (p) => ipcRenderer.invoke('fs:list', p),
  mkLocalDir: (p) => ipcRenderer.invoke('fs:mkdir', p),
  delLocal: (p, isDir) => ipcRenderer.invoke('fs:delete', p, isDir),
  renLocal: (a, b) => ipcRenderer.invoke('fs:rename', a, b),

  /* dialogs */
  pickOpenFiles: () => ipcRenderer.invoke('dialog:pickOpen'),
  pickSaveFile: (defaultName) => ipcRenderer.invoke('dialog:pickSave', defaultName),
  pickDir: () => ipcRenderer.invoke('dialog:pickDir'),
  pickKeyFile: () => ipcRenderer.invoke('dialog:pickKey'),

  /* backup / migration */
  backupExport: (password) => ipcRenderer.invoke('backup:export', password),
  backupImport: (password) => ipcRenderer.invoke('backup:import', password),

  /* version + updates */
  appVersion: () => ipcRenderer.invoke('app:info'),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateDownload: () => ipcRenderer.invoke('update:download'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  updateLater: () => ipcRenderer.send('update:later'),
  onUpdateAvailable: (cb) => {
    const f = (_e, info) => cb(info);
    ipcRenderer.on('update:available', f);
    return () => ipcRenderer.removeListener('update:available', f);
  },
  onUpdateProgress: (cb) => {
    const f = (_e, p) => cb(p);
    ipcRenderer.on('update:progress', f);
    return () => ipcRenderer.removeListener('update:progress', f);
  },
  onUpdateReady: (cb) => {
    const f = (_e, p) => cb(p);
    ipcRenderer.on('update:ready', f);
    return () => ipcRenderer.removeListener('update:ready', f);
  },
  onUpdateCheckResult: (cb) => {
    const f = (_e, r) => cb(r);
    ipcRenderer.on('update:checkResult', f);
    return () => ipcRenderer.removeListener('update:checkResult', f);
  },

  /* SFTP per host */
  remoteList: (hostId, p) => ipcRenderer.invoke('sftp:list', hostId, p),
  remoteHome: (hostId) => ipcRenderer.invoke('sftp:home', hostId),
  remoteMkdir: (hostId, p) => ipcRenderer.invoke('sftp:mkdir', hostId, p),
  remoteDelete: (hostId, p, isDir) => ipcRenderer.invoke('sftp:delete', hostId, p, isDir),
  remoteRename: (hostId, a, b) => ipcRenderer.invoke('sftp:rename', hostId, a, b),
  upload: (hostId, localPath, remotePath) => ipcRenderer.invoke('sftp:upload', hostId, localPath, remotePath),
  uploadDir: (hostId, localDir, remoteDir) => ipcRenderer.invoke('sftp:uploadDir', hostId, localDir, remoteDir),
  download: (hostId, remotePath, savePath) => ipcRenderer.invoke('sftp:download', hostId, remotePath, savePath),
  downloadDir: (hostId, remoteDir, localDir) => ipcRenderer.invoke('sftp:downloadDir', hostId, remoteDir, localDir),

  /* events */
  onData: (cb) => {
    const f = (_e, sid, data) => cb(sid, data);
    ipcRenderer.on('ssh:data', f);
    return () => ipcRenderer.removeListener('ssh:data', f);
  },
  onClose: (cb) => {
    const f = (_e, sid) => cb(sid);
    ipcRenderer.on('ssh:close', f);
    return () => ipcRenderer.removeListener('ssh:close', f);
  },
  onMonitorStatus: (cb) => {
    const f = (_e, hostId, status, err) => cb(hostId, status, err);
    ipcRenderer.on('monitor:status', f);
    return () => ipcRenderer.removeListener('monitor:status', f);
  },
  onMetrics: (cb) => {
    const f = (_e, hostId, m) => cb(hostId, m);
    ipcRenderer.on('metrics:update', f);
    return () => ipcRenderer.removeListener('metrics:update', f);
  },
  onSftpProgress: (cb) => {
    const f = (_e, info) => cb(info);
    ipcRenderer.on('sftp:progress', f);
    return () => ipcRenderer.removeListener('sftp:progress', f);
  },
});
