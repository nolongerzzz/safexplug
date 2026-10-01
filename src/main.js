'use strict';
const { app, BrowserWindow, ipcMain, shell, Menu, clipboard } = require('electron');
const path = require('path');
const os = require('os');
const { Miner } = require('./core/miner');
const { Settings } = require('./core/settings');
const { getInfo } = require('./core/node-status');

if (!app.requestSingleInstanceLock()) app.quit();

const miner = new Miner();
let settings;
let win = null;
let nodePoll = null;
let lastNode = { state: 'unknown' };
let waitingForSync = false;

function send(ch, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(ch, payload);
}

function startMining(patch) {
  const s = patch ? settings.set(patch) : settings.get();
  if (s.mode === 'solo' && s.requireSynced && lastNode.state !== 'synced') {
    waitingForSync = true;
    send('miner:waiting', { waiting: true });
    return { ok: true, waiting: true };
  }
  waitingForSync = false;
  send('miner:waiting', { waiting: false });
  return miner.start(s);
}

function pollNode() {
  const s = settings.get();
  if (s.mode !== 'solo') { lastNode = { state: 'unknown' }; send('node:status', lastNode); return; }
  getInfo(s.node).then((info) => {
    lastNode = info;
    send('node:status', info);
    // A start request that was waiting on sync goes through as soon as we are synced.
    if (waitingForSync && info.state === 'synced') startMining();
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 880, height: 760, minWidth: 640, minHeight: 600,
    backgroundColor: '#0d1b2a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Never navigate the app window to a remote page; open links in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  // Clipboard: the window's menu bar is hidden, and on Linux that disables the
  // Ctrl+C/V/X/A shortcuts, so handle them directly.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return;
    const wc = win.webContents;
    const k = input.key.toLowerCase();
    const act = { c: 'copy', v: 'paste', x: 'cut', a: 'selectAll', z: input.shift ? 'redo' : 'undo' }[k];
    if (!act) return;
    event.preventDefault();
    wc[act]();
  });

  // Right-click menu (Cut / Copy / Paste / Select all).
  win.webContents.on('context-menu', (_e, params) => {
    const f = params.editFlags;
    const items = [];
    if (params.isEditable) {
      items.push({ label: 'Cut', enabled: f.canCut, click: () => win.webContents.cut() });
    }
    items.push({ label: 'Copy', enabled: f.canCopy, click: () => win.webContents.copy() });
    if (params.isEditable) {
      items.push({ label: 'Paste', enabled: f.canPaste, click: () => win.webContents.paste() });
    }
    items.push({ type: 'separator' }, { label: 'Select all', click: () => win.webContents.selectAll() });
    Menu.buildFromTemplate(items).popup({ window: win });
  });
}

app.whenReady().then(() => {
  settings = new Settings(app.getPath('userData'));

  miner.on('log', (l) => send('miner:log', l));
  miner.on('stats', (st) => send('miner:stats', st));
  miner.on('state', (st) => send('miner:state', st));
  miner.on('exit', (e) => { send('miner:state', { running: false, exit: e }); });

  ipcMain.handle('app:init', () => ({
    settings: settings.get(),
    running: miner.running,
    cpuModel: (os.cpus()[0] || {}).model || 'Unknown CPU',
    cores: os.cpus().length,
    platform: process.platform,
    version: app.getVersion(),
  }));
  ipcMain.handle('settings:set', (_e, patch) => { const s = settings.set(patch || {}); pollNode(); return s; });
  ipcMain.handle('clipboard:write', (_e, text) => { clipboard.writeText(String(text).slice(0, 2_000_000)); return true; });
  ipcMain.handle('miner:start', (_e, patch) => startMining(patch));
  ipcMain.handle('miner:stop', () => {
    waitingForSync = false; send('miner:waiting', { waiting: false }); miner.stop(); return { ok: true };
  });

  createWindow();
  nodePoll = setInterval(pollNode, 5000);
  pollNode();

  // Auto-start once the window is ready (after the UI has its initial state).
  win.webContents.once('did-finish-load', () => {
    const s = settings.get();
    if (s.autostart && s.address) setTimeout(() => startMining(), 800);
  });

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('before-quit', () => { clearInterval(nodePoll); miner.stop(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
