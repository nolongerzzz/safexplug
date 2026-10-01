'use strict';
const { app, BrowserWindow, ipcMain, shell, Menu, clipboard, dialog } = require('electron');
const path = require('path');
const os = require('os');
const { Miner } = require('./core/miner');
const { Settings } = require('./core/settings');
const { getInfo } = require('./core/node-status');
const docker = require('./core/docker');
const rigs = require('./core/rigs');
const maint = require('./core/maintenance');
const tailscale = require('./core/tailscale');
const wallet = require('./core/wallet');
const wsetup = require('./core/walletsetup');
const explorer = require('./core/explorer');
const { HashLog } = require('./core/hashlog');
const crypto = require('crypto');

if (!app.requestSingleInstanceLock()) app.quit();

const miner = new Miner();
let settings;
let win = null;
let nodePoll = null;
let lastNode = { state: 'unknown' };
let waitingForSync = false;
let syncStreak = 0;       // consecutive polls the node has been synced
let autoTimer = null;     // countdown before auto-starting the miner
const SYNC_STREAK_NEEDED = 2;
const PUBLIC_NODE = 'rpc.safex.org:17402';
let lastPublic = { at: 0, info: null };
let rigRows = [];
let rigsBusy = false;
let tsCache = { at: 0, status: null };
let hashLog = null;
const rigLogs = new Map();      // per-rig hashrate history
const zeroSince = new Map();    // rig key -> when it first answered with no hashrate
let walletRpc = null;     // the wallet tool process we manage (view-only wallet)
let rpcTry = 0;
let wsBusy = false;
let lastPay = null;       // latest payments tally
let payAt = 0;
let lastNet = null;       // latest network reading, handed to the window when it loads
const sendNet = (n) => { lastNet = n; send('net:hashrate', n); };

// ---- node panel state ----
let dockerStatus = { installed: false, engine: 'missing', image: false, container: 'none' };
let nodeBusy = null;      // label while a long action (install/build/stop) runs
let logStream = null;

// Node output is kept in a buffer so the window gets everything the node has
// printed, even lines that arrived before it finished loading.
let logSeq = 0;
const nodeLogBuf = [];
let lastBeat = 0;
function nodeLog(text) {
  const entry = { n: ++logSeq, t: String(text) };
  nodeLogBuf.push(entry);
  if (nodeLogBuf.length > 400) nodeLogBuf.shift();
  send('node:log', entry);
}

function sendPanel() {
  send('node:panel', { docker: dockerStatus, busy: nodeBusy, plan: docker.installPlan() });
}
function manageLogs() {
  const want = dockerStatus.container === 'running' || dockerStatus.container === 'restarting';
  if (want && !logStream) {
    logStream = docker.followLogs();
    logStream.on('line', (l) => nodeLog(l));
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
    stream.on('line', (l) => nodeLog(l));
    stream.on('exit', (code) => { nodeBusy = null; resolve(code); });
  });
}
async function nodeAction(action) {
  if (nodeBusy) return { ok: false, error: 'Busy: ' + nodeBusy };
  const note = (t) => nodeLog(t);
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
      case 'rebuild': {
        note('Rebuilding the node image (needs internet, about 100 MB). Your chain data is not touched.');
        const code = await runStreamed('Rebuilding node image…', docker.buildImage());
        note(code === 0 ? 'Node image rebuilt.' : 'Rebuild failed. See the lines above.');
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

function cancelAutostart() {
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null; send('miner:waiting', { waiting: false }); }
}

// Wait a few seconds after the app opens, so the node has time to settle.
function beginAutostart() {
  let n = Math.round(settings.get().startDelay);
  if (n <= 0) { startMining(); return; }
  const tick = () => send('miner:waiting', { waiting: true, text: 'Starting…', seconds: n });
  tick();
  autoTimer = setInterval(() => {
    n -= 1;
    if (n <= 0) { clearInterval(autoTimer); autoTimer = null; send('miner:waiting', { waiting: false }); startMining(); }
    else tick();
  }, 1000);
}

function startMining(patch) {
  cancelAutostart();
  const s = patch ? settings.set(patch) : settings.get();
  if (s.mode === 'solo' && s.requireSynced && (lastNode.state !== 'synced' || syncStreak < SYNC_STREAK_NEEDED)) {
    waitingForSync = true;
    send('miner:waiting', { waiting: true });
    return { ok: true, waiting: true };
  }
  waitingForSync = false;
  send('miner:waiting', { waiting: false });
  const r = miner.start(s);
  // The payments tally counts from the first time mining actually starts.
  if (r && r.ok !== false && !settings.get().miningSince) { settings.set({ miningSince: Math.floor(Date.now() / 1000) }); payAt = 0; pollWallet(); }
  return r;
}

function pollNode() {
  const s = settings.get();
  return getInfo(s.mode === 'solo' ? s.node : '127.0.0.1:17402').then((info) => {
    lastNode = info;
    syncStreak = info.state === 'synced' ? syncStreak + 1 : 0;
    send('node:status', info);
    // A quiet, synced node prints almost nothing, so add a status line every 30 s.
    if (dockerStatus.container === 'running' && info.height && Date.now() - lastBeat > 30000) {
      lastBeat = Date.now();
      nodeLog(`[status] block ${info.height.toLocaleString()} · ${info.peers} peers · ${info.state === 'synced' ? 'synced' : info.state === 'syncing' && !info.peers ? 'connecting to peers' : 'syncing ' + info.percent.toFixed(1) + '%'}`);
    }
    // A start request that was waiting on sync goes through once the node has
    // been synced for a couple of checks in a row (not just one lucky reading).
    if (waitingForSync && info.state === 'synced' && syncStreak >= SYNC_STREAK_NEEDED) startMining();
  });
}

// Network hashrate = difficulty / block time, from our node if it gives it,
// otherwise (optionally) from the public node, asked at most every 30 s.
async function pollNetwork() {
  const s = settings.get();
  let info = lastNode; let source = 'local';
  if (!(info && info.netHashrate)) {
    if (!s.publicFallback) { sendNet({ hs: null }); return; }
    if (Date.now() - lastPublic.at > 30000) lastPublic = { at: Date.now(), info: await getInfo(PUBLIC_NODE) };
    info = lastPublic.info; source = 'public';
  }
  sendNet({ hs: (info && info.netHashrate) || null, difficulty: (info && info.difficulty) || null, height: (info && info.height) || null, source });
}

const rigKey = (r) => `${r.host}:${r.port}`;
function rigLog(key) {
  if (!rigLogs.has(key)) rigLogs.set(key, new HashLog(path.join(app.getPath('userData'), 'rig-logs', crypto.createHash('sha1').update(key).digest('hex').slice(0, 12) + '.json')));
  return rigLogs.get(key);
}
const HUNG_AFTER_MS = Number(process.env.SAFEX_HUNG_MS) || 120000;   // answering but not hashing for 2 minutes = hung
const windows = (log) => ({ h1: log.summary(3600).avg, h6: log.summary(6 * 3600).avg, h24: log.summary(86400).avg });
async function pollRigs() {
  if (rigsBusy) return;
  rigsBusy = true;
  try {
    const s = settings.get();
    // Tailscale status is cheap but not free: refresh at most every 15 s.
    if (Date.now() - tsCache.at > 15000) tsCache = { at: Date.now(), status: await tailscale.status() };
    const rows = s.rigs.length ? await rigs.pollAll(s.rigs, s.address) : [];
    const now = Date.now();
    rigRows = rows.map((r) => {
      const key = rigKey(r); const log = rigLog(key); let hung = false;
      if (r.online && r.hashrate > 0) { log.add(r.hashrate); zeroSince.delete(key); }
      else if (r.online) { if (!zeroSince.has(key)) zeroSince.set(key, now); hung = now - zeroSince.get(key) > HUNG_AFTER_MS; }
      else zeroSince.delete(key);
      return { ...r, hung, avg: windows(log), ts: tailscale.describe(tsCache.status, r) };
    });
    send('rigs:status', { rows: rigRows, self: tailscale.describeSelf(tsCache.status), selfAvg: windows(hashLog) });
  } finally { rigsBusy = false; }
}

const walletDir = () => path.join(app.getPath('userData'), 'wallet');
const walletNode = () => { const s = settings.get(); return s.mode === 'solo' ? s.node : '127.0.0.1:17402'; };
// Keep the wallet tool running whenever a wallet has been set up. It exits if
// its node is down, so retry at most every 30 s and only when the node answers.
function ensureWalletRpc() {
  if (!walletRpc || walletRpc.running) return;
  const st = wsetup.status(walletDir());
  if (!st.supported || !st.tools || !st.wallet) return;
  if (lastNode.state === 'offline' || lastNode.state === 'unknown' || Date.now() - rpcTry < 30000) return;
  rpcTry = Date.now();
  const r = walletRpc.start(walletNode());
  if (r.ok && !settings.get().walletRpc) { settings.set({ walletRpc: `127.0.0.1:${wsetup.RPC_PORT}` }); payAt = 0; }
}
async function pollWallet() {
  ensureWalletRpc();
  // With the app-managed wallet, the address is always the wallet tool's own port
  // (never the node's), whatever was typed into the box before.
  if (walletRpc && wsetup.status(walletDir()).wallet && settings.get().walletRpc !== `127.0.0.1:${wsetup.RPC_PORT}`) {
    settings.set({ walletRpc: `127.0.0.1:${wsetup.RPC_PORT}` }); payAt = 0;
  }
  const s = settings.get();
  if (!s.walletRpc) { lastPay = { state: 'off' }; send('wallet:status', lastPay); return; }
  if (Date.now() - payAt < 30000) return;
  payAt = Date.now();
  // With the app-managed view-only wallet, count EVERYTHING it has found: it only
  // scans from the block chosen at setup, so that is already the start of the tally
  // and nothing can be hidden by a date filter.
  const managed = wsetup.status(walletDir()).wallet;
  const since = managed ? 0 : (s.miningSince || 0);
  lastPay = await wallet.summary(s.walletRpc.trim(), since);
  if (lastPay.state === 'ok') lastPay.recent = wallet.withConfirmations(lastPay.recent, lastNode.height);
  lastPay.miningSince = since; lastPay.managed = managed; lastPay.scanFrom = s.walletScanFrom || 0;
  send('wallet:status', lastPay);
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

  const lanAddress = () => {
    const all = [].concat(...Object.values(os.networkInterfaces())).filter((i) => i.family === 'IPv4' && !i.internal).map((i) => i.address);
    return all.find((a) => a.startsWith('100.')) || all[0] || null;   // Tailscale first
  };
  ipcMain.handle('app:init', () => ({
    net: lastNet,
    lanAddress: lanAddress(),
    settings: settings.get(),
    running: miner.running,
    cpuModel: (os.cpus()[0] || {}).model || 'Unknown CPU',
    cores: os.cpus().length,
    platform: process.platform,
    version: app.getVersion(),
  }));
  ipcMain.handle('settings:set', (_e, patch) => {
    patch = patch || {};
    // Switching on stats sharing creates the access token the first time.
    if (patch.shareStats && !settings.get().apiToken && !patch.apiToken) patch.apiToken = crypto.randomBytes(16).toString('hex');
    const s = settings.set(patch); pollNode(); if ('rigs' in patch) pollRigs();
    if ('walletRpc' in patch || 'miningSince' in patch) { payAt = 0; pollWallet(); }
    return s;
  });
  hashLog = new HashLog(path.join(app.getPath('userData'), 'hashrate-log.json'));
  ipcMain.handle('stats:day', () => hashLog.summary());
  ipcMain.handle('stats:windows', () => windows(hashLog));
  // 24 h charts: combined hashrate (this machine + every rig, 10 min buckets) and payments (hourly).
  ipcMain.handle('chart:day', () => {
    const logs = [hashLog, ...settings.get().rigs.map((r) => rigLog(rigKey(r)))];
    const all = logs.map((l) => l.series(86400, 600));
    const hash = all[0].map((_, i) => { let tot = 0, any = false; for (const a of all) if (a[i] != null) { tot += a[i]; any = true; } return any ? tot : null; });
    const nowS = Math.floor(Date.now() / 1000); const pay = new Array(24).fill(0);
    const list = (lastPay && lastPay.state === 'ok' && lastPay.last24 && lastPay.last24.list) || [];
    for (const x of list) { const i = Math.min(23, Math.max(0, Math.floor((x.time - (nowS - 86400)) / 3600))); pay[i] += x.sfx; }
    return { hash, pay, paysKnown: !!(lastPay && lastPay.state === 'ok') };
  });
  setInterval(() => { if (miner.running && miner.stats) hashLog.add(miner.stats.hashrate); }, 60000);
  walletRpc = new wsetup.WalletRpc(walletDir());
  const wsStatus = () => ({ ...wsetup.status(walletDir()), running: walletRpc.running, busy: wsBusy, terminal: !!wsetup.findTerminal(), nodeHeight: lastNode.height || 0 });
  ipcMain.handle('wsetup:status', () => wsStatus());
  ipcMain.handle('wsetup:download', async () => {
    if (wsBusy) return { ok: false, error: 'Busy' };
    wsBusy = true;
    try { return await wsetup.download(walletDir(), (l) => send('wsetup:log', l)); } finally { wsBusy = false; }
  });
  ipcMain.handle('wsetup:add', (_e, o) => {
    const height = Math.max(0, Math.floor(Number(o && o.height) || 0));
    const r = wsetup.addWallet(walletDir(), { node: walletNode(), height });
    if (r.ok) settings.set({ walletScanFrom: height });
    return r;
  });
  ipcMain.handle('wsetup:remove', async () => {
    const c = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Cancel', 'Detach wallet'], defaultId: 0, cancelId: 0,
      title: 'Detach wallet', message: 'Detach the view-only wallet from this app?', detail: 'This deletes only the view-only copy kept by this app. Your real wallet, seed and keys are not touched. To attach again you will paste your address and view key once more.' });
    if (c.response !== 1) return { ok: false, cancelled: true };
    walletRpc.stop(); await new Promise((r) => setTimeout(r, 500)); wsetup.removeWallet(walletDir());
    settings.set({ walletRpc: '' }); payAt = 0; pollWallet(); return { ok: true };
  });
  // light explorer: own node first, public node as fallback
  async function exploreCall(fn) {
    const st = settings.get();
    const local = st.mode === 'solo' && st.node ? st.node : '127.0.0.1:17402';
    const down = (x) => !x || (!x.ok && /^(offline|bad address|bad response)$/.test(x.error || ''));
    const r = await fn(local);
    if (r && r.ok) return { ...r, source: 'local' };
    if (!down(r)) return r;
    if (st.publicFallback !== false && local !== PUBLIC_NODE) {
      const r2 = await fn(PUBLIC_NODE);
      if (r2 && r2.ok) return { ...r2, source: 'public' };
      if (!down(r2)) return r2;
    }
    return { ok: false, error: 'Could not reach a node. Start your node on the Node tab.' };
  }
  const mineHeights = () => (lastPay && lastPay.recent ? lastPay.recent.map((x) => x.height).filter(Boolean) : []);
  ipcMain.handle('explorer:recent', async (_e, count, before) => { const r = await exploreCall((h) => explorer.recent(h, Number(count) || 20, before == null ? null : Number(before))); return { ...r, mine: mineHeights() }; });
  ipcMain.handle('explorer:block', async (_e, q) => { const r = await exploreCall((h) => explorer.block(h, String(q || ''))); return { ...r, mine: mineHeights() }; });
  ipcMain.handle('explorer:tx', (_e, hash) => exploreCall((h) => explorer.tx(h, String(hash || ''))));
  ipcMain.handle('wallet:get', () => lastPay || { state: 'off' });
  ipcMain.handle('node:action', (_e, action) => nodeAction(String(action)));
  ipcMain.handle('node:refresh', async () => { await pollDocker(); return { docker: dockerStatus, busy: nodeBusy, plan: docker.installPlan(), log: nodeLogBuf.slice() }; });
  ipcMain.handle('maint:overview', () => maint.overview());
  ipcMain.handle('maint:run', async (_e, kind) => {
    if (!['health', 'backup', 'restore'].includes(kind)) return { ok: false, error: 'Unknown action' };
    if (nodeBusy) return { ok: false, error: 'Busy: ' + nodeBusy };
    if (kind === 'restore') {
      const c = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Cancel', 'Replace chain with backup'], defaultId: 0, cancelId: 0,
        title: 'Restore chain backup', message: 'Replace your current chain data with the newest complete backup?',
        detail: 'Your current chain data will be overwritten. Your backup stays untouched. The node must be stopped (it is).' });
      if (c.response !== 1) return { ok: false, cancelled: true };
    }
    const labels = { health: 'Checking chain health…', backup: 'Backing up chain…', restore: 'Restoring chain…' };
    nodeBusy = labels[kind]; sendPanel();
    nodeLog(`— ${labels[kind].replace('…', '')} —`);
    let r;
    try { r = await maint[kind](nodeLog); }
    catch (e) { r = { ok: false, error: String(e.message || e) }; }
    finally { nodeBusy = null; }
    if (!r.ok && r.error) nodeLog('Stopped: ' + r.error);
    await pollDocker();
    const out = { kind, ...r };
    send('maint:result', out);
    return out;
  });
  ipcMain.handle('clipboard:write', (_e, text) => { clipboard.writeText(String(text).slice(0, 2_000_000)); return true; });
  ipcMain.handle('miner:start', (_e, patch) => startMining(patch));
  ipcMain.handle('miner:stop', () => {
    cancelAutostart(); waitingForSync = false; send('miner:waiting', { waiting: false }); miner.stop(); return { ok: true };
  });

  createWindow();
  nodePoll = setInterval(() => { pollNode().then(pollNetwork); pollDocker(); pollRigs(); pollWallet(); }, 5000);
  pollNode().then(pollNetwork);
  pollRigs();
  pollDocker().then(() => {
    if (settings.get().autostartNode && dockerStatus.engine === 'ok' && dockerStatus.container !== 'running') nodeAction('start');
  });

  // Auto-start once the window is ready (after the UI has its initial state).
  win.webContents.once('did-finish-load', () => {
    const s = settings.get();
    if (s.autostart && s.address) beginAutostart();
  });

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('before-quit', () => { if (hashLog) hashLog.save(); if (walletRpc) walletRpc.stop(); clearInterval(nodePoll); cancelAutostart(); miner.stop(); if (logStream) logStream.stop(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
