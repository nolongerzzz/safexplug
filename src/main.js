'use strict';
const { app, BrowserWindow, ipcMain, shell, Menu, clipboard } = require('electron');
const path = require('path');
const os = require('os');
const { Miner } = require('./core/miner');
const { Settings } = require('./core/settings');
const { getInfo } = require('./core/node-status');
const docker = require('./core/docker');

if (!app.requestSingleInstanceLock()) app.quit();

const miner = new Miner();
let settings;
let win = null;
let nodePoll = null;
let lastNode = { state: 'unknown' };
let waitingForSync = false;

// ---- node panel state ----
let dockerStatus = { installed: false, engine: 'missing', image: false, container: 'none' };
let nodeBusy = null;      // label while a long action (install/build/stop) runs
let logStream = null;

function sendPanel() {
  send('node:panel', { docker: dockerStatus, busy: nodeBusy, plan: docker.installPlan() });
}
function manageLogs() {
  const want = dockerStatus.container === 'running' || dockerStatus.container === 'restarting';
  if (want && !logStream) {
    logStream = docker.followLogs();
    logStream.on('line', (l) => send('node:log', l));
    logStream.on('exit', () => { logStream = null; });
  } else if (!want && logStream) { logStream.stop(); logStream = null; }
}
async function pollDocker() {
  if (nodeBusy) { sendPanel(); return; }
  dockerStatus = await docker.status();
  manageLogs();
  sendPanel();
}
function runStreamed(label, stream) {
  nodeBusy = label; sendPanel();
  return new Promise((resolve) => {
    stream.on('line', (l) => send('node:log', l));
    stream.on('exit', (code) => { nodeBusy = null; resolve(code); });
  });
}
async function nodeAction(action) {
  if (nodeBusy) return { ok: false, error: 'Busy: ' + nodeBusy };
  const note = (t) => send('node:log', t);
  try {
    switch (action) {
      case 'install-docker': {
        const plan = docker.installPlan();
        if (plan.kind !== 'linux-apt') { shell.openExternal(plan.url); return { ok: true, opened: plan.url }; }
        note('Installing Docker. A password prompt will appear.');
        const code = await runStreamed('Installing Docker…', docker.installDockerLinux());
        note(code === 0 ? 'Docker is installed.' : 'Docker install did not finish (cancelled or failed).');
        break;
      }
      case 'start-engine': {
        note('Starting Docker. A password prompt may appear.');
        const code = await runStreamed('Starting Docker…', docker.startDockerEngineLinux());
        note(code === 0 ? 'Docker is ready.' : 'Could not start Docker (cancelled or failed).');
        break;
      }
      case 'start': {
        if (!dockerStatus.image) {
          note('First run: building the node image (a few minutes, downloads about 100 MB)…');
          const code = await runStreamed('Building node image…', docker.buildImage());
          if (code !== 0) { note('Build failed. See the lines above.'); break; }
        }
        nodeBusy = 'Starting node…'; sendPanel();
        const r = await docker.startNode();
        nodeBusy = null;
        if (!r.ok) note('Could not start node: ' + r.error);
        break;
      }
      case 'stop': {
        note('Stopping node. This can take up to two minutes while it saves the chain safely.');
        nodeBusy = 'Stopping node…'; sendPanel();
        const r = await docker.stopNode();
        nodeBusy = null;
        if (!r.ok) note('Could not stop node: ' + r.error);
        break;
      }
      default: return { ok: false, error: 'Unknown action' };
    }
  } finally {
    nodeBusy = null;
    await pollDocker();
  }
  return { ok: true };
}

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
  getInfo(s.mode === 'solo' ? s.node : '127.0.0.1:17402').then((info) => {
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
  ipcMain.handle('node:action', (_e, action) => nodeAction(String(action)));
  ipcMain.handle('node:refresh', async () => { await pollDocker(); return { docker: dockerStatus, busy: nodeBusy, plan: docker.installPlan() }; });
  ipcMain.handle('clipboard:write', (_e, text) => { clipboard.writeText(String(text).slice(0, 2_000_000)); return true; });
  ipcMain.handle('miner:start', (_e, patch) => startMining(patch));
  ipcMain.handle('miner:stop', () => {
    waitingForSync = false; send('miner:waiting', { waiting: false }); miner.stop(); return { ok: true };
  });

  createWindow();
  nodePoll = setInterval(() => { pollNode(); pollDocker(); }, 5000);
  pollNode();
  pollDocker().then(() => {
    if (settings.get().autostartNode && dockerStatus.engine === 'ok' && dockerStatus.container !== 'running') nodeAction('start');
  });

  // Auto-start once the window is ready (after the UI has its initial state).
  win.webContents.once('did-finish-load', () => {
    const s = settings.get();
    if (s.autostart && s.address) setTimeout(() => startMining(), 800);
  });

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('before-quit', () => { clearInterval(nodePoll); miner.stop(); if (logStream) logStream.stop(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
