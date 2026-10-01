'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const on = (ch) => (cb) => {
  const h = (_e, p) => cb(p);
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.removeListener(ch, h);
};

contextBridge.exposeInMainWorld('safex', {
  init: () => ipcRenderer.invoke('app:init'),
  setSettings: (p) => ipcRenderer.invoke('settings:set', p),
  start: (p) => ipcRenderer.invoke('miner:start', p),
  stop: () => ipcRenderer.invoke('miner:stop'),
  nodeAction: (a) => ipcRenderer.invoke('node:action', a),
  nodeRefresh: () => ipcRenderer.invoke('node:refresh'),
  onNodePanel: on('node:panel'),
  onNodeLog: on('node:log'),
  maintOverview: () => ipcRenderer.invoke('maint:overview'),
  maintRun: (k) => ipcRenderer.invoke('maint:run', k),
  onMaintResult: on('maint:result'),
  onNet: on('net:hashrate'),
  walletGet: () => ipcRenderer.invoke('wallet:get'),
  walletRestartCount: () => ipcRenderer.invoke('wallet:restart-count'),
  wsStatus: () => ipcRenderer.invoke('wsetup:status'),
  wsDownload: () => ipcRenderer.invoke('wsetup:download'),
  wsAdd: (o) => ipcRenderer.invoke('wsetup:add', o),
  wsRemove: () => ipcRenderer.invoke('wsetup:remove'),
  onWsLog: on('wsetup:log'),
  onWallet: on('wallet:status'),
  onRigs: on('rigs:status'),
  copyText: (t) => ipcRenderer.invoke('clipboard:write', t),
  onLog: on('miner:log'),
  onStats: on('miner:stats'),
  onState: on('miner:state'),
  onWaiting: on('miner:waiting'),
  onNode: on('node:status'),
});
