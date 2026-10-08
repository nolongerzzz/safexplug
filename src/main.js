'use strict';
const { app, BrowserWindow, ipcMain, dialog, screen, Menu, clipboard } = require('electron');
const path = require('path');
const crypto = require('crypto');
const tools = require('./core/tools');
const { Wallet, RpcError, feeOf } = require('./core/rpc');
const send = require('./core/send');
const nodeApi = require('./core/node');
const { fmt, toAtomic } = require('./core/amounts');
const pending = require('./core/pending');
const offersApi = require('./core/offers');
const stakingApi = require('./core/staking');
const cli = require('./core/cli');
const features = require('./core/features');
const mm = require('./core/market-math');
const backup = require('./core/backup');
const explorer = require('./core/explorer');
const swapApi = require('./core/swapapi');
const swapflow = require('./core/swapflow');
const { createRelay } = require('./core/relay');
const fsx = require('fs');

const TEST_PORT = Number(process.env.SAFEX_WALLET_TEST_PORT) || 0;   // tests point this at a fake wallet tool
const DEFAULT_NODE = '127.0.0.1:17402';
// The node you last signed in with is remembered on this computer (a Mac with no node of its own points at the rig).
const nodeFile = () => path.join(app.getPath('userData'), 'last-node.txt');
const NODE_OK = /^[A-Za-z0-9.\-]+:\d{2,5}$/;
const savedNode = () => { try { const t = fsx.readFileSync(nodeFile(), 'utf8').trim(); return NODE_OK.test(t) ? t : ''; } catch (_) { return ''; } };
const rememberNode = (n) => { if (TEST_PORT || !NODE_OK.test(String(n || ''))) return; try { fsx.writeFileSync(nodeFile(), String(n)); } catch (_) {} };
let sessionPw = null;   // kept in memory only while a wallet is open, so it can be reopened after a marketplace action; dropped on lock
let offerTip = 0;
let offerCache = [], win = null, rpc = null, wallet = null, session = null, prepared = null, addrCache = '', pend = null;
const dir = () => app.getPath('userData');
const log = (m) => { try { win && win.webContents.send('w:log', m); } catch (_) {} };

function createWindow() {
  // Never taller or wider than the usable screen, so a desktop panel at the bottom cannot hide the last buttons.
  const wa = screen.getPrimaryDisplay().workArea; const width = Math.min(1100, wa.width), height = Math.min(780, wa.height);
  win = new BrowserWindow({ width, height, x: wa.x + Math.floor((wa.width - width) / 2), y: wa.y + Math.floor((wa.height - height) / 2), minWidth: 480, minHeight: 360, backgroundColor: '#eefaf6', title: 'Safex SOLO-SYNC Wallet', icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  win.setMenuBarVisibility(false);
  // The window title always carries the version, from the very first moment (a relaunch after an update shows the new one at once).
  const TITLE = `Safex SOLO-SYNC Wallet ${curVer()}`; win.setTitle(TITLE); win.on('page-title-updated', (e) => { e.preventDefault(); win.setTitle(TITLE); });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // With the menu bar hidden, Linux disables Ctrl+C/V/X/A, so handle them directly (same fix as the miner app).
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) return;
    const act = { c: 'copy', v: 'paste', x: 'cut', a: 'selectAll', z: input.shift ? 'redo' : 'undo' }[input.key.toLowerCase()];
    if (!act) return; event.preventDefault(); win.webContents[act]();
  });
  // Right-click menu: Cut / Copy / Paste / Select all.
  win.webContents.on('context-menu', (_e, params) => {
    const f = params.editFlags, items = [];
    if (params.isEditable) items.push({ label: 'Cut', enabled: f.canCut, click: () => win.webContents.cut() });
    items.push({ label: 'Copy', enabled: f.canCopy, click: () => win.webContents.copy() });
    if (params.isEditable) items.push({ label: 'Paste', enabled: f.canPaste, click: () => win.webContents.paste() });
    items.push({ type: 'separator' }, { label: 'Select all', click: () => win.webContents.selectAll() });
    Menu.buildFromTemplate(items).popup({ window: win });
  });
}
let lastSess = null;   // the open wallet's file and node, kept while the wallet tool is paused for a price check, so read-only screens keep working
const sess = () => session || lastSess;
function stopRpc(keep) { if (rpc) { rpc.stop(); rpc = null; } wallet = null; session = null; prepared = null; addrCache = ''; pend = null; if (!keep) { offerCache = []; sessionPw = null; lastSess = null; } }

const updater = require('./core/updater');
let updating = false;
const appDir = path.join(__dirname, '..'), curVer = () => JSON.parse(fsx.readFileSync(path.join(appDir, 'package.json'), 'utf8')).version;
const findUpd = () => updater.findUpdate({ prefix: 'safex-wallet', current: curVer(), dirs: updater.downloadDirs(app.getPath('userData')) });
// "Locked" is the internal word for "the wallet tool is not connected right now". The person never sees that bare word: while a price
// check is open the tool is paused on purpose, and for a few seconds after one ends it is reconnecting.
const friendlyLocked = (r) => (r && r.ok === false && r.error === 'Locked' ? { ...r, error: action ? 'The wallet tool is paused for a price check or send. Cancel or finish it, then try again.' : 'The wallet is reconnecting for a moment. Try again in a few seconds.' } : r);
const handle = (ch, fn) => ipcMain.handle(ch, async (_e, a) => { try { return friendlyLocked(await fn(a || {})); } catch (e) { return { ok: false, error: String((e && e.message) || e) }; } });

handle('w:update-check', () => { if (app.isPackaged || updating) return { ok: true, update: null }; try { const f = findUpd(); return { ok: true, update: f ? { version: f.version, current: curVer() } : null }; } catch (_) { return { ok: true, update: null }; } });
handle('w:update-apply', async () => {
  if (app.isPackaged) return { ok: false, error: 'This copy is installed from a package, so it cannot update itself.' };
  if (updating) return { ok: false, error: 'Already updating.' };
  if (action) return { ok: false, error: 'Finish the current action first, then update.' };
  updating = true;
  try {
    const f = findUpd(); if (!f) { updating = false; return { ok: false, error: 'No newer update file found in Downloads.' }; }
    const r = await updater.apply({ file: f.file, version: f.version, appDir, backupDir: path.join(app.getPath('userData'), 'update-backup'), currentVersion: curVer() });
    setTimeout(() => { app.relaunch(); app.quit(); setTimeout(() => app.exit(0), 5000); }, 600);
    return { ok: true, version: r.version };
  } catch (e) { updating = false; return { ok: false, error: e.message }; }
});
handle('w:init', () => ({ ok: true, features, appVersion: curVer(), tools: TEST_PORT ? true : tools.status(dir()).tools, supported: TEST_PORT ? true : tools.status(dir()).supported, version: tools.VERSION, defaultNode: savedNode() || DEFAULT_NODE, wallets: tools.listWallets(dir()), walletsDir: tools.paths(dir()).wallets }));
handle('w:download-tools', () => tools.download(dir(), log));
handle('w:list-wallets', () => ({ ok: true, wallets: tools.listWallets(dir()), dir: tools.paths(dir()).wallets }));
handle('w:create-wallet', ({ node, mode }) => tools.runWalletTool(dir(), mode || 'new', { node: node || DEFAULT_NODE }));
handle('w:pick-file', async () => {
  if (process.env.SAFEX_WALLET_TEST_FILE) return { ok: true, file: process.env.SAFEX_WALLET_TEST_FILE, outside: process.env.SAFEX_WALLET_TEST_OUTSIDE === '1' };
  const r = await dialog.showOpenDialog(win, { title: 'Select your wallet .keys file', defaultPath: tools.paths(dir()).wallets, properties: ['openFile'], filters: [{ name: 'Safex wallet keys', extensions: ['keys'] }] });
  return r.canceled || !r.filePaths[0] ? { ok: false, cancelled: true } : { ok: true, file: r.filePaths[0], outside: path.resolve(path.dirname(r.filePaths[0])) !== path.resolve(tools.paths(dir()).wallets) };
});
handle('w:adopt-wallet', ({ file }) => backup.adoptWallet(String(file || ''), tools.paths(dir()).wallets));
handle('w:check-node', async ({ node }) => nodeApi.getInfo(node || DEFAULT_NODE));

let behindAtOpen = null;   // { walletHeight, nodeHeight } when the wallet opened far behind the chain
async function openSession({ file, node, password, keep }) {
  const port = TEST_PORT || tools.RPC_PORT;
  stopRpc(keep);
  if (!TEST_PORT) {
    if (!(await tools.clearPort(port))) return { ok: false, error: `Another wallet tool is still running on this computer (port ${port}) and will not stop. Close it, then try again. In a terminal: pgrep -af safex-wallet-rpc  shows it, and kill -9 <number>  stops it. Leave the miner's own wallet alone.` };
    rpc = new tools.WalletRpc(dir(), port);
    const s = rpc.start(path.dirname(file), node || DEFAULT_NODE); if (!s.ok) { rpc = null; return s; }
    if (!(await tools.waitUp(port))) { stopRpc(); return { ok: false, error: 'The wallet tool did not start. Another wallet tool may still be running on this computer, or the node address is wrong.' }; }
  }
  const w = new Wallet(port);
  try { await w.rpc('open_wallet', { filename: path.basename(file).replace(/\.keys$/, ''), password: String(password) }, { timeout: 60000 }); }
  catch (e) { stopRpc(); return { ok: false, error: 'Could not open the wallet. Check the password and that this is the right file.' }; }
  mixedProbe = null;
  wallet = w; session = lastSess = { node: node || DEFAULT_NODE, file: path.basename(file), full: file }; sessionPw = String(password); rememberNode(node || DEFAULT_NODE);
  if (!keep && !TEST_PORT) {
    // a wallet far behind the chain keeps its tool busy for a long time and cannot say where it is, so it is caught up
    // in the terminal tool first, with a progress readout. A tool that does not answer at all counts as behind.
    const [h, ni] = await Promise.all([w.rpc('get_height', {}, { timeout: 6000 }).then((r) => Number(r.height) || 0, () => null), nodeApi.getInfo(node || DEFAULT_NODE)]);
    if (ni && ni.ok && ni.height && (h == null || ni.height - h > 300)) { behindAtOpen = { walletHeight: h, nodeHeight: ni.height }; return { ok: true, name: session.file, catchUp: behindAtOpen }; }
  }
  w.refresh().catch(() => {});
  return { ok: true, name: session.file };
}
handle('w:unlock', async ({ file, node, password }) => {
  if (!file || !/\.keys$/.test(file)) return { ok: false, error: 'Choose your wallet .keys file first.' };
  if (!password) return { ok: false, error: 'Enter your wallet password.' };
  const prev = wallet && session ? { file: session.full, node: session.node, password: sessionPw } : null;
  const r = await openSession({ file, node, password });
  if (!r.ok && prev) { await openSession({ ...prev, keep: true }); } // a failed switch leaves the wallet that was open still open
  return r;
});
handle('w:lock', () => { stopRpc(); return { ok: true }; });

let mixedProbe = null;   // does the running wallet tool know transfer_mixed? asked once per opened wallet, with empty arguments (an unknown method says so; a known one complains about the arguments)
async function mixedOk() {
  if (mixedProbe !== null) return mixedProbe;
  if (TEST_PORT) return (mixedProbe = true);
  try { await wallet.rpc('transfer_mixed', {}); mixedProbe = true; } catch (e) { mixedProbe = !/method not found/i.test(String((e && e.message) || e)); }
  return mixedProbe;
}
handle('w:snapshot', async () => {
  if (!wallet) return { ok: false, error: 'Locked' };
  const [bal, height, hist, ni] = await Promise.all([wallet.balance(), wallet.height(), wallet.history().catch(() => []), nodeApi.getInfo(session.node)]);
  if (!addrCache) addrCache = await wallet.address();
  const nodeH = ni.ok ? ni.height : 0;
  const shown = pending.apply(pend, { cash: bal.cash, tokens: bal.tokens }); pend = shown.pending;
  const rows = hist.slice(0, 200).map((x) => {
    // A combined send carries SFX and SFT in one transaction. Received, the wallet reports both amounts. Sent, it only reports the tokens as "amount",
    // so the SFX part is read from the destinations it recorded. Plain token sends have no SFX destination, so they stay SFT only.
    const cash = x.isToken && x.type !== 'in' ? BigInt(x.destCash || 0) : BigInt(x.cash || 0), both = x.isToken && cash > 0n && BigInt(x.tokens || 0) > 0n;
    return { type: x.type, txid: x.txid, height: x.height, time: x.time, kind: both ? 'SFX + SFT' : x.isToken ? 'SFT' : 'SFX',
    amount: both ? `${fmt(cash)} SFX + ${fmt(x.tokens)} SFT` : fmt(x.isToken ? x.tokens : x.cash), fee: feeOf(x) == null ? '—' : fmt(feeOf(x)), conf: x.height && nodeH ? Math.max(0, nodeH - x.height + 1) : 0 }; });
  return { ok: true, name: session.file, address: addrCache, walletHeight: height, nodeHeight: nodeH, nodeOk: ni.ok, nodeSynced: ni.ok ? ni.synced : false,
    walletSynced: ni.ok ? height >= nodeH - 1 : false, mixedSend: await mixedOk(),
    cash: fmt(shown.cash.shown), cashUnlocked: fmt(bal.cashUnlocked), tokens: fmt(shown.tokens.shown), tokensUnlocked: fmt(bal.tokensUnlocked),
    cashEstimated: shown.cash.estimated, tokensEstimated: shown.tokens.estimated, sendPending: shown.cash.estimated || shown.tokens.estimated,
    staked: fmt(bal.staked), tokensTotal: fmt(BigInt(shown.tokens.shown) + BigInt(bal.staked || 0)), tokensLockedAmt: fmt(shown.tokens.shown > BigInt(bal.tokensUnlocked) ? shown.tokens.shown - BigInt(bal.tokensUnlocked) : 0n), cashLockedAmt: fmt(shown.cash.shown > BigInt(bal.cashUnlocked) ? shown.cash.shown - BigInt(bal.cashUnlocked) : 0n), cashLocked: shown.cash.shown - BigInt(bal.cashUnlocked) > 0n, tokensLocked: shown.tokens.shown - BigInt(bal.tokensUnlocked) > 0n, history: rows };
});

// The prepared transaction (with its metadata) stays here in the main process; the screen only gets what it needs to
// show, plus an id. Confirming relays exactly what was prepared.
handle('w:prepare', async ({ kind, address, amount, ringSize, max, tokenAmount }) => {
  if (!wallet) return { ok: false, error: 'Locked' };
  if (tokenAmount != null && String(tokenAmount).trim() !== '' && !max) {   // "also send SFT": one transaction carrying both
    if (kind !== 'cash') return { ok: false, error: 'Choose SFX first, then add the SFT amount.' };
    const m = await send.prepareMixed(wallet, { address, amount, tokenAmount, ringSize }); if (!m.ok) return m;
    prepared = { ...m, id: crypto.randomBytes(8).toString('hex') };
    return { ok: true, id: prepared.id, kind, mixed: true, address: m.address, amount: fmt(m.amount), tokenAmount: fmt(m.tokenAmount), fee: fmt(m.fee, { min: 0 }), unit: 'SFX' };
  }
  const r = await send.prepare(wallet, { kind, address, amount, ringSize, max: !!max }); if (!r.ok) return r;
  prepared = { ...r, id: crypto.randomBytes(8).toString('hex') };
  return { ok: true, id: prepared.id, kind, address: r.address, amount: fmt(r.amount), fee: fmt(r.fee, { min: 0 }), unit: kind === 'cash' ? 'SFX' : 'SFT' };
});
handle('w:prepare-split', async ({ kind, parts, ringSize, amount }) => {
  if (!wallet) return { ok: false, error: 'Locked' };
  const r = await send.prepareSplit(wallet, { kind, parts, ringSize, amount }); if (!r.ok) return r;
  prepared = { ...r, id: crypto.randomBytes(8).toString('hex') };
  return { ok: true, id: prepared.id, split: true, kind, parts: r.parts, piece: fmt(r.piece), address: r.address, amount: fmt(r.amount), fee: fmt(r.fee, { min: 0 }), unit: kind === 'cash' ? 'SFX' : 'SFT' };
});
handle('w:prepare-sweep', async () => {
  if (!wallet) return { ok: false, error: 'Locked' };
  const r = await send.prepareSweep(wallet); if (!r.ok) return r;
  prepared = { ...r, id: crypto.randomBytes(8).toString('hex') };
  return { ok: true, id: prepared.id, sweep: true, kind: 'cash', cashTxs: r.cashTxs, address: r.address, amount: fmt(r.amount), fee: fmt(r.fee, { min: 0 }), unit: 'SFX' };
});
// Saved addresses ("frequent flyers"): a plain list of label + address on this computer, shared by every wallet in this app.
const addrFile = () => path.join(dir(), 'addresses.json');
// v2: kept per wallet, so one wallet's saved names never show up in another. (The first version shared one list; that file is ignored.)
const readAll = () => { try { const j = JSON.parse(require('fs').readFileSync(addrFile(), 'utf8')); return j && j.v === 2 && j.wallets && typeof j.wallets === 'object' ? j.wallets : {}; } catch (_) { return {}; } };
const readAddrs = () => { const w = walletNameOf(); const v = w ? readAll()[w] : null; return Array.isArray(v) ? v.filter((x) => x && typeof x.label === 'string' && typeof x.address === 'string') : []; };
const writeAddrs = (a) => { const w = walletNameOf(); if (!w) return; const all = readAll(); all[w] = a; require('fs').mkdirSync(dir(), { recursive: true }); require('fs').writeFileSync(addrFile(), JSON.stringify({ v: 2, wallets: all })); };
handle('w:addr-list', () => ({ ok: true, list: readAddrs() }));
handle('w:addr-save', ({ label, address }) => {
  if (!wallet) return { ok: false, error: 'Locked' };
  const l = String(label || '').trim().slice(0, 40), a = String(address || '').trim();
  if (!l) return { ok: false, error: 'Give this address a name.' };
  if (!require('./core/amounts').looksLikeAddress(a)) return { ok: false, error: 'That does not look like a Safex address.' };
  const list = readAddrs().filter((x) => x.address !== a && x.label.toLowerCase() !== l.toLowerCase());
  if (list.length >= 200) return { ok: false, error: 'The saved list is full (200). Remove one first.' };
  list.push({ label: l, address: a }); list.sort((x, y) => x.label.localeCompare(y.label)); writeAddrs(list); return { ok: true, list };
});
handle('w:addr-remove', ({ address }) => { if (!wallet) return { ok: false, error: 'Locked' }; const list = readAddrs().filter((x) => x.address !== String(address || '')); writeAddrs(list); return { ok: true, list }; });
handle('w:confirm', async ({ id }) => {
  if (!wallet || !prepared || prepared.id !== id) return { ok: false, error: 'That send is no longer pending. Review it again.' };
  const p = prepared; prepared = null; const r = await send.confirm(wallet, p);
  if (r.ok && p.before) pend = pending.start(p.before, { kind: p.kind, amount: p.split || p.sweep ? '0' : p.amount, fee: p.fee, tokenAmount: p.mixed ? p.tokenAmount : 0 });
  return r;
});
// Marketplace listings: read-only, straight from the user's own node. The full records stay here; the screen gets lean rows.
handle('w:offers', async () => {
  const se = sess(); if (!se) return { ok: false, error: 'Locked' };   // the list is read from the node, so it works even while the wallet tool is paused for a price check
  const ni = await nodeApi.getInfo(se.node); const tip = ni.ok ? ni.height : 0;
  const r = await offersApi.load(se.node, tip); if (!r.ok) return r;
  offerCache = r.offers; offerTip = tip; const unit = (v) => fmt(v);
  return { ok: true, tip, rows: r.rows.map((x) => ({ ...x, priceFmt: unit(x.price), minFmt: unit(x.minSfx), qtyFmt: x.qty, ready: mm.listingState(x.height, tip) })) };
});
handle('w:offer', ({ i }) => {
  const o = offerCache[Number(i)]; if (!o) return { ok: false, error: 'Listing not loaded. Refresh the list.' };
  const row = offersApi.row(o, Number(i), 0);
  return { ok: true, title: row.title, seller: row.seller, active: row.active, pegged: row.pegged, height: row.height, price: fmt(row.price), minSfx: fmt(row.minSfx), qty: row.qty, priceAtomic: row.price, canBuy: row.active && !row.pegged, ready: mm.listingState(row.height, offerTip), offerId: offersApi.idText(o.offer_id), ...offersApi.detail(o) };
});
handle('w:staking', async () => {
  if (!wallet || !session) return { ok: false, error: 'Locked' };
  const [bal, ni] = await Promise.all([wallet.balance(), nodeApi.getInfo(session.node)]);
  const r = await stakingApi.load(session.node, ni.ok ? ni.height : 0);
  // Interest your own stake has earned so far, if the wallet service reports it (its reply shape is not verified).
  let interest = null, interestNote = null;
  try { const ir = await wallet.rpc('get_available_interest', {}); const v = stakingApi.interestOf(ir); if (v != null) interest = fmt(v); else interestNote = JSON.stringify(ir).slice(0, 300); }
  catch (e) { interestNote = String((e && e.message) || e).slice(0, 200); }
  const tip = ni.ok ? ni.height : 0;
  return { ok: true, staked: fmt(bal.staked), stakedUnlocked: fmt(bal.stakedUnlocked), tokens: fmt(bal.tokens), tokensTotal: fmt(BigInt(bal.tokens) + BigInt(bal.staked || 0)), tokensLockedAmt: fmt(BigInt(bal.tokens) > BigInt(bal.tokensUnlocked) ? BigInt(bal.tokens) - BigInt(bal.tokensUnlocked) : 0n), tokensUnlocked: fmt(bal.tokensUnlocked), network: r,
    tip, nextInterval: tip ? (Math.floor(tip / stakingApi.INTERVAL) + 1) * stakingApi.INTERVAL : null, interest, interestNote };
});
// Stake / unstake: the wallet's background service cannot do these, so the terminal tool runs one command, asks for the fee,
// and nothing is sent until the person confirms (same two-step as Market buying; confirm is w:act-confirm).
handle('w:stake-quote', async ({ kind, amount, height, password }) => {
  if (!wallet || !session) return { ok: false, error: 'Locked' };
  const a = stakingApi.parseAmount(amount); const bal = await wallet.balance();
  const e = kind === 'unstake' ? stakingApi.checkUnstake(a, BigInt(bal.staked), height) : stakingApi.checkStake(a, BigInt(bal.tokensUnlocked));
  if (e) return { ok: false, error: e };
  const addr = await wallet.address();
  const h = kind === 'unstake' && String(height || '').trim() ? ' ' + String(height).trim() : '';
  const cmd = kind === 'unstake' ? `unstake_token ${addr} ${stakingApi.plain(a)}${h}` : `stake_token ${addr} ${stakingApi.plain(a)}`;
  const r = await startAction(password, async (c) => {
    if (noNode(c)) return { ok: false, error: noNode(c) };
    const qt = await cli.quote(c, cmd);
    return qt.ok ? { ok: true, fee: qt.fee, pre: qt.pre || '' } : { ok: false, error: friendlyAct(qt.error) };
  });
  if (!r.ok) return r;
  return { ok: true, op: kind === 'unstake' ? 'unstake' : 'stake', amount: fmt(a), height: String(height || '').trim() || null, txFee: trimFee(r.fee), pre: r.pre || '' };
});

// ---- Marketplace actions: buy, create seller account, create listing -------------------------------------------------
// The wallet tool's background service has no marketplace commands, so these run the official terminal tool for one
// action at a time (fresh each time, so it always reads the newest offers). The live view is paused meanwhile and the
// wallet is reopened afterwards. The password is held in memory only until the action ends.
let action = null;
const cliPath = () => process.env.SAFEX_WALLET_TEST_CLI || tools.paths(dir()).cli;
async function endAction(resume = true) {
  const a = action; action = null; if (!a) return;
  clearTimeout(a.timer);
  try { await a.c.close(); } catch (_) {}
  if (resume) await openSession({ file: a.full, node: a.node, password: sessionPw || a.password, keep: true });
}
// Refresh and wait for it, but do not wait forever on the last block: if it is within a few blocks of the tip and has not moved
// for 30 seconds, or has not moved at all for three minutes, carry on (the chain checks everything again when the transaction is sent).
async function refreshSmart(c) {
  let done = false; const p = cli.run(c, 'refresh', 2 * 3600 * 1000).then((r) => { done = true; return r; });
  let last = null, lastMove = Date.now();
  while (!done) {
    await Promise.race([p, new Promise((r) => setTimeout(r, 1000))]);
    if (done) break;
    const g = c.progress(); if (g && (!last || g.cur !== last.cur)) { last = g; lastMove = Date.now(); }
    const idle = Date.now() - lastMove;
    if (last && last.total - last.cur <= 3 && idle > 30000) return;
    if (idle > 180000) return;
  }
}
async function startAction(password, steps, { refresh = true } = {}) {
  if (!wallet || !session) return { ok: false, error: 'Locked' };
  if (!password) return { ok: false, error: 'Enter your wallet password to continue.' };
  const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  if (!sessionPw || !same(password, sessionPw)) return { ok: false, error: 'Wrong password.' };   // checked first, so nothing is paused for a typo
  if (action) await endAction(true);
  const full = session.full, node = session.node;
  // A wallet that was just live and is within a few blocks of the chain has nothing to catch up on. Asking the tool to refresh
  // anyway can sit on the very last block for a long time, so it is skipped then (it is only needed after a long gap).
  let near = false;
  try { const [h, ni] = await Promise.all([wallet.height(), nodeApi.getInfo(node)]); near = !!(ni && ni.ok && ni.height && Number(h) >= ni.height - 3); } catch (_) {}
  const walletDir = path.dirname(full), walletFile = path.basename(full).replace(/\.keys$/, '');
  if (rpc) await rpc.stopAndWait();   // wait until it has saved and exited, so the terminal tool can open the same file
  stopRpc(true);   // the loaded listings stay
  // While the tool opens and catches up with the chain, the screen can show where it is (block x of y), like the catch-up screen does.
  busy = { phase: 'Catching the wallet up with the chain before asking for the price…', since: Date.now(), c: null };
  const o = await cli.open(cliPath(), { walletFile, walletDir, node, password, onStart: (c) => { if (busy) busy.c = c; } });
  if (!o.ok) { busy = null; await openSession({ file: full, node, password: sessionPw, keep: true }); return { ok: false, error: o.error }; }
  action = { c: o.c, password, full, node };
  if (busy) busy.c = o.c;
  if (refresh && !near && !o.c.noDaemon) await refreshSmart(o.c);   // catch up with the chain first, so balances and locks are current
  busy = { phase: 'Asking the wallet tool for the exact price…', since: Date.now(), c: null };
  let r; try { r = await steps(o.c, action); } finally { busy = null; }
  if (!r.ok) { await endAction(true); return r; }
  action.timer = setTimeout(() => { endAction(true).catch(() => {}); }, 5 * 60 * 1000);   // nothing left hanging if the person walks away
  return r;
}
const trimFee = (f) => (f == null ? null : String(f).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''));
const noNode = (c) => (c.noDaemon ? 'Could not reach your node. Check that it is running.' : null);

handle('w:buy-quote', async ({ i, qty, password }) => {
  const o = offerCache[Number(i)]; if (!o) return { ok: false, error: 'Listing not loaded. Refresh the list.' };
  const row = offersApi.row(o, Number(i), 0), id = offersApi.idText(o.offer_id);
  if (!row.active) return { ok: false, error: 'This listing is not active.' };
  const rs = mm.listingState(row.height, offerTip);
  if (!rs.ready) return { ok: false, error: `This listing is still confirming. It can be bought in ${rs.remaining} more block${rs.remaining === 1 ? '' : 's'} (about ${rs.minutes} minutes).` };
  if (row.pegged) return { ok: false, error: 'Pegged listings are not supported for buying here yet.' };
  const q = mm.checkQuantity(qty); if (q) return { ok: false, error: q };
  if (BigInt(qty) > BigInt(row.qty)) return { ok: false, error: `Only ${row.qty} available.` };
  const m = mm.breakdown(row.price, qty);
  const r = await startAction(password, async (c) => {
    if (noNode(c)) return { ok: false, error: noNode(c) };
    const qt = await cli.quote(c, `safex_purchase ${id} ${BigInt(qty)}`);
    return qt.ok ? { ok: true, fee: qt.fee, pre: qt.pre || '' } : { ok: false, error: friendlyAct(qt.error) };
  });
  if (!r.ok) return r;
  return { ok: true, op: 'buy', title: row.title, qty: String(qty), price: fmt(row.price), total: fmt(m.total), seller: fmt(m.seller), networkShare: fmt(m.fee), txFee: trimFee(r.fee), pre: r.pre || '' };
});
// ---- My listings: see this seller account's listings, close or reopen one ----
const sellersFile = () => path.join(dir(), 'sellers.json');
// Saved per wallet: only names the wallet tool reported.
const readSellers = () => { try { const j = JSON.parse(require('fs').readFileSync(sellersFile(), 'utf8')); return j && j.v === 2 && j.wallets && typeof j.wallets === 'object' ? j.wallets : {}; } catch (_) { return {}; } };
const knownSellers = (w) => { const v = readSellers()[w]; return Array.isArray(v) ? v : v ? [v] : []; };
// Only names the wallet tool itself reported are kept, and a lookup replaces the list, so a typed name can never be saved
// under the wrong wallet and a stale one heals the next time that wallet is looked up.
const saveSellers = (w, names) => { try { const j = readSellers(); j[w] = [...new Set(names.filter(Boolean))]; require('fs').writeFileSync(sellersFile(), JSON.stringify({ v: 2, wallets: j })); } catch (_) {} };
// Finds the seller accounts this wallet holds (and, if asked, their keys) with the terminal tool, then reopens the wallet.
// The keys go back to the screen only and are never stored or logged.
handle('w:seller-accounts', async ({ password, keys }) => {
  if (!wallet || !session) return { ok: false, error: 'Locked' };
  const wn = walletNameOf(); let raw0 = '';
  const hasFile = (() => { try { return require('fs').existsSync(path.join(walletDirOf(), wn + '.safex_account_keys')); } catch (_) { return false; } })();
  const r = await startAction(password, async (c) => {
    const a = await cli.accounts(c); if (!a.ok) return { ok: false, error: a.error };
    const list = []; raw0 = a.accounts.length ? '' : a.raw;
    for (const x of a.accounts) {
      const e = { ...x }; 
      if (keys) { const k = await cli.accountKeys(c, password, x.username); if (k.ok) { e.publicKey = k.publicKey; e.secretKey = k.secretKey; } else e.keysError = k.error; }
      list.push(e);
    }
    return { ok: true, accounts: list };
  }, { refresh: false });   // the account list is read from the wallet's seller file, so no chain catch-up is needed
  if (!r.ok) return r;
  await endAction(true);
  saveSellers(wn, r.accounts.map((x) => x.username));
  return { ok: true, accounts: r.accounts, hasFile, raw: raw0 };
});
handle('w:seller-import', async ({ username, secretKey, password }) => {
  if (!wallet || !session) return { ok: false, error: 'Locked' };
  const eU = mm.checkUsername(username); if (eU) return { ok: false, error: eU };
  const k = String(secretKey || '').trim().toLowerCase(); if (!/^[0-9a-f]{64}$/.test(k)) return { ok: false, error: 'The secret key is 64 characters, 0-9 and a-f only.' };
  const wn = walletNameOf(), u = String(username).trim();
  const r = await startAction(password, async (c) => {
    const x = await cli.accountRecover(c, password, u, k); if (!x.ok) return x;
    const a = await cli.accounts(c); const found = a.ok && a.accounts.some((y) => y.username === u);
    return found ? { ok: true } : { ok: false, error: 'The wallet tool said it recovered the account, but it is not in the list. Press Look it up again.' };
  });
  if (!r.ok) return r;
  await endAction(true); saveSellers(wn, [...knownSellers(wn), u]); return { ok: true, username: u };
});
handle('w:seller-listings', async ({ username }) => {
  const se = sess(); if (!se) return { ok: false, error: 'Locked' };
  const wn = walletNameOf(), want = String(username == null ? '' : username).trim();
  const known = knownSellers(wn), u = want || known[0] || ''; if (!u) return { ok: true, username: '', rows: [], accounts: [] };
  const eU = mm.checkUsername(u); if (eU) return { ok: false, error: eU };
  const ni = await nodeApi.getInfo(se.node); const tip = ni.ok ? ni.height : 0;
  const r = await offersApi.load(se.node, tip); if (!r.ok) return r;
  offerCache = r.offers; offerTip = tip;
  const unit = (v) => fmt(v), rows = require('./core/sellerlist').mine(r.offers, u).map((x) => ({ ...x, priceFmt: unit(x.price) }));
  return { ok: true, username: u, rows, accounts: knownSellers(wn) };
});
handle('w:seller-toggle', async ({ i, active, username, password }) => {
  const o = offerCache[Number(i)]; if (!o) return { ok: false, error: 'Listing not loaded. Press Show my listings again.' };
  const eU = mm.checkUsername(username); if (eU) return { ok: false, error: eU };
  if (offersApi.text(o.seller).trim() !== String(username).trim()) return { ok: false, error: 'That listing does not belong to this seller account.' };
  const c = require('./core/sellerlist').editCommand(o, String(username).trim(), !!active); if (!c.ok) return c;
  const r = await startAction(password, async (cl) => {
    if (noNode(cl)) return { ok: false, error: noNode(cl) };
    const qt = await cli.quote(cl, c.command);
    return qt.ok ? { ok: true, fee: qt.fee, pre: qt.pre || '' } : { ok: false, error: friendlyAct(qt.error) };
  });
  const row = require('./core/offers').row(o, Number(i), 0);
  return r.ok ? { ok: true, op: 'offer-edit', username, name: row.title, active: !!active, qty: row.qty, price: fmt(row.price), txFee: trimFee(r.fee), pre: r.pre || '' } : r;
});
// Change a listing's price (entered as what the seller wants to receive per unit, like when creating) and/or quantity. Its open/closed state stays as it is.
handle('w:seller-edit', async ({ i, net, qty, username, password }) => {
  const o = offerCache[Number(i)]; if (!o) return { ok: false, error: 'Listing not loaded. Press Show my listings again.' };
  const eU = mm.checkUsername(username); if (eU) return { ok: false, error: eU };
  if (offersApi.text(o.seller).trim() !== String(username).trim()) return { ok: false, error: 'That listing does not belong to this seller account.' };
  const change = {}; let f = null;
  if (String(net == null ? '' : net).trim()) { f = mm.fromNet(net); if (!f) return { ok: false, error: 'Enter how much SFX you want to receive for each unit, for example 1 or 0.5.' }; if (f.error) return { ok: false, error: f.error }; change.price = f.price; }
  if (String(qty == null ? '' : qty).trim()) { const eQ = mm.checkQuantity(qty); if (eQ) return { ok: false, error: eQ }; change.qty = Number(String(qty).trim()); }
  if (change.price == null && change.qty == null) return { ok: false, error: 'Enter a new price, a new quantity, or both.' };
  const c = require('./core/sellerlist').editCommand(o, String(username).trim(), !!o.active, change); if (!c.ok) return c;
  const r = await startAction(password, async (cl) => {
    if (noNode(cl)) return { ok: false, error: noNode(cl) };
    const qt = await cli.quote(cl, c.command);
    return qt.ok ? { ok: true, fee: qt.fee, pre: qt.pre || '' } : { ok: false, error: friendlyAct(qt.error) };
  });
  const row = require('./core/offers').row(o, Number(i), 0);
  const newPrice = change.price != null ? f.price : BigInt(row.price == null ? 0 : row.price), mmb = require('./core/market-math');
  return r.ok ? { ok: true, op: 'offer-change', username, name: row.title, oldQty: String(row.qty), newQty: String(change.qty != null ? change.qty : row.qty), oldPrice: fmt(row.price), newPrice: fmt(newPrice), newRecv: fmt(mmb.breakdown(newPrice, 1n).seller), txFee: trimFee(r.fee), pre: r.pre || '' } : r;
});
handle('w:seller-quote', async ({ kind, username, data, name, net, qty, desc, password }) => {
  const eU = mm.checkUsername(username); if (eU) return { ok: false, error: eU };
  if (kind === 'account') {
    const eD = mm.checkOfferDesc(data); if (eD) return { ok: false, error: eD.replace('description', 'account data').replace('Add a short description.', 'Add short account data.') };
    const r = await startAction(password, async (c, a) => {
      if (noNode(c)) return { ok: false, error: noNode(c) };
      const n = await cli.accountNew(c, password, username, data);
      if (!n.ok && !/already exists/i.test(n.error || '')) return { ok: false, error: friendlyAct(n.error) };
      const qt = await cli.quote(c, `safex_account create ${username}`);
      return qt.ok ? { ok: true, fee: qt.fee, pre: qt.pre || '' } : { ok: false, error: friendlyAct(qt.error) };
    });
    return r.ok ? { ok: true, op: 'account', username, data, txFee: trimFee(r.fee), pre: r.pre || '', lockNote: 'Creating a seller account locks 1,000 SFT (the tool does not state the lock length; earlier code suggests about 22,000 blocks). Your total balance does not change, but those tokens cannot be spent while locked.' } : r;
  }
  const eN = mm.checkOfferName(name), eDs = mm.checkOfferDesc(desc), eQ = mm.checkQuantity(qty);
  if (eN || eDs || eQ) return { ok: false, error: eN || eDs || eQ };
  const f = mm.fromNet(net); if (!f) return { ok: false, error: 'Enter how much SFX you want to receive for each unit, for example 1 or 0.5.' };
  if (f.error) return { ok: false, error: f.error };
  const r = await startAction(password, async (c) => {
    if (noNode(c)) return { ok: false, error: noNode(c) };
    const qt = await cli.quote(c, `safex_offer create ${username} ${name} ${mm.plain(f.price)} ${Number(qty)} ${desc}`);
    return qt.ok ? { ok: true, fee: qt.fee, pre: qt.pre || '' } : { ok: false, error: friendlyAct(qt.error) };
  });
  return r.ok ? { ok: true, op: 'offer', username, name, qty: String(qty), net: fmt(f.net), listPrice: fmt(f.price), received: fmt(f.received), txFee: trimFee(r.fee), pre: r.pre || '' } : r;
});
handle('w:act-confirm', async ({ yes }) => {
  if (!action) return { ok: false, error: 'Nothing is waiting. Start again.' };
  const a = action; clearTimeout(a.timer);
  const r = await cli.answer(a.c, !!yes);
  if (r.ok && r.more) { a.timer = setTimeout(() => { endAction(true).catch(() => {}); }, 5 * 60 * 1000); return { ok: true, more: true, txFee: trimFee(r.fee), pre: r.pre || '' }; }   // a second question: nothing sent, keep the tool open
  await endAction(true);
  return r.ok ? { ok: true, sent: !!r.sent, txid: r.txid || null } : { ok: false, error: friendlyAct(r.error) };
});
function friendlyAct(e) {
  const t = String(e || '');
  if (/no offer with given id/i.test(t)) return 'The wallet tool cannot find that listing on your node. Press Refresh in Market and try again.';
  if (/not enough money/i.test(t)) return 'Not enough unlocked SFX for this. Wait for locked coins to unlock, or use a smaller amount.';
  if (/not enough tokens/i.test(t)) return 'Not enough unlocked SFT for this.';
  if (/account.*not.*exist|unknown safex account/i.test(t)) return 'That seller account does not exist in this wallet yet. Create it first.';
  return t || 'The wallet tool reported a problem.';
}


// ---- Swap: SFT <-> SFX, both wallets co-sign one transaction, talking through a relay so people only click. -------------
// The wallet tool does the cryptography; swapflow decides the steps. Nothing leaves a wallet without a click, and the
// seller's private state stays in the app's own folder. The app runs a small relay for you (127.0.0.1:18090) unless one is
// already running there; to trade with another computer, share your relay or type that computer's relay address.
const RELAY_PORT = 18090, relayCfgFile = () => path.join(dir(), 'swap-relay.json');
const relayCfg = () => { try { const j = JSON.parse(fsx.readFileSync(relayCfgFile(), 'utf8')); return { url: typeof j.url === 'string' && /^https?:\/\//.test(j.url) ? j.url : '', share: !!j.share }; } catch (_) { return { url: '', share: false }; } };
let relayHost = null, relayBound = '', relayPort = RELAY_PORT, relayStarting = null;
const relayUrl = () => relayCfg().url || `http://127.0.0.1:${relayPort}`;
const isOurRelay = async (port) => { const r = await swapflow.relayCall(`http://127.0.0.1:${port}`, 'GET', '/ping'); return !!(r.ok && r.relay === 'safex-swap-relay/1'); };
// Starts the app's own relay on the first free port from 18090. If a relay is already answering on a port (another window,
// or one started by hand) that one is used; if some other program holds the port, the next port is tried.
function startRelay() {
  if (!features.swap) return Promise.resolve();
  if (TEST_PORT && !process.env.SAFEX_WALLET_TEST_RELAY) return Promise.resolve();
  relayStarting = (async () => {
    const host = relayCfg().share ? '0.0.0.0' : '127.0.0.1';
    if (relayHost && relayBound === host) return;
    const keep = relayHost ? relayPort : null;
    if (relayHost) { await relayHost.close(); relayHost = null; }
    const ports = keep ? [keep, ...Array.from({ length: 10 }, (_, i) => RELAY_PORT + i).filter((p) => p !== keep)] : Array.from({ length: 10 }, (_, i) => RELAY_PORT + i);
    for (const p of ports) {
      const r = createRelay();
      try { await r.listen(p, host); relayHost = r; relayBound = host; relayPort = p; return; }
      catch (_) { if (await isOurRelay(p)) { relayPort = p; return; } }
    }
  })().catch(() => {});
  return relayStarting;
}
const swapCtx = () => ({ wallet, st: swapApi.store(dir(), walletNameOf()), mine: swapflow.mineStore(dir(), walletNameOf()), relay: relayUrl() });
const swapGuard = (fn) => async (a) => { if (!features.swap) return { ok: false, unsupported: true, error: 'Swaps are switched off in this version.' }; if (!wallet || !session) return { ok: false, error: 'Locked' }; if (relayStarting) await relayStarting; if (!(await swapApi.supported(wallet))) return { ok: false, unsupported: true, error: 'This wallet tool cannot swap yet.' }; return fn(swapCtx(), a || {}); };
// Re-copy (Mac: the tools built on this computer) or re-download the wallet tools, e.g. after rebuilding them. The open wallet is closed first
// (the program cannot be replaced while it runs); the person unlocks again afterwards.
handle('w:refresh-tools', async () => {
  if (action) await endAction(false);
  stopRpc(); busy = null;
  const lines = []; const r = await tools.download(dir(), (m) => lines.push(String(m)));
  return r && r.ok ? { ok: true, log: lines.join('\n') } : { ok: false, error: (r && r.error) || 'Could not update the wallet tools.' };
});
handle('w:help', async () => {
  const help = require('./core/help'), p = tools.paths(dir());
  const topics = help.TOPICS;
  return { ok: true, topics, cli: await help.cliHelp(p.cli), swapRpc: await help.cliHelp((tools.swapTool() || {}).bin) };
});
handle('w:sw-config', async ({ url, share }) => {
  if (!features.swap) return { ok: false, error: 'Swaps are switched off in this version.' };
  if (url !== undefined || share !== undefined) {
    const cur = relayCfg(), u = url === undefined ? cur.url : String(url || '').trim();
    if (u && !/^https?:\/\/[A-Za-z0-9.\-]+(:\d{2,5})?\/?$/.test(u)) return { ok: false, error: 'The relay address should look like http://192.168.1.20:18090' };
    fsx.mkdirSync(dir(), { recursive: true }); fsx.writeFileSync(relayCfgFile(), JSON.stringify({ url: u.replace(/\/$/, ''), share: share === undefined ? cur.share : !!share })); await startRelay();
  }
  const c = relayCfg(); return { ok: true, url: c.url, share: c.share, effective: relayUrl(), hosting: !!relayHost };
});
handle('w:sw-status', async () => {
  if (!features.swap) return { ok: true, supported: false, swaps: [], off: true };
  if (!wallet || !session) return { ok: false, error: 'Locked' }; if (relayStarting) await relayStarting;
  if (!(await swapApi.supported(wallet))) return { ok: true, supported: false, swaps: [], platform: process.platform, bundled: process.platform === 'linux' };
  const r = await swapflow.status(swapCtx()); return { ...r, supported: true };
});
handle('w:sw-book', swapGuard((c) => swapflow.book(c)));
handle('w:sw-post', swapGuard((c, a) => swapflow.post(c, a)));
handle('w:sw-take', swapGuard((c, a) => swapflow.take(c, String(a.id || ''))));
handle('w:sw-answer', swapGuard((c, a) => swapflow.answer(c, String(a.id || ''))));
handle('w:sw-clear', swapGuard((c) => swapflow.clearWaiting(c)));
handle('w:sw-act', swapGuard((c, a) => swapflow.act(c, String(a.id || ''), String(a.what || ''))));



// ---- Wallet tab: backup, seed view, rescan ----------------------------------------------------------------------------
const walletDirOf = () => (session && session.full ? path.dirname(session.full) : null);
const walletNameOf = () => (sess() && sess().file ? sess().file.replace(/\.keys$/, '') : null);
const samePw = (a) => { if (!sessionPw || !a) return false; const x = Buffer.from(String(a)), y = Buffer.from(sessionPw); return x.length === y.length && crypto.timingSafeEqual(x, y); };
let busy = null;   // { phase, since } while a long job runs, so the screen can show it
handle('w:busy', () => {
  if (!busy) return { ok: true, busy: null };
  const out = { phase: busy.phase, seconds: Math.round((Date.now() - busy.since) / 1000) };
  const pr = busy.c && busy.c.progress();   // block the terminal tool has reached, out of the node's height
  if (pr) {
    const t = Date.now(); if (!busy.first || pr.cur < busy.first.cur) busy.first = { cur: pr.cur, t };
    out.progress = { cur: pr.cur, total: pr.total, pct: pr.pct, eta: cli.etaSeconds(busy.first, { cur: pr.cur, t }, pr.total) };
  }
  return { ok: true, busy: out };
});

// Copy the wallet's files somewhere the person picks. The wallet is closed while copying and reopened after.
handle('w:backup', async () => {
  if (!wallet || !session) return { ok: false, error: 'Locked' };
  let dest = process.env.SAFEX_WALLET_TEST_BACKUP_DIR || null;
  if (!dest) {
    const r = await dialog.showOpenDialog(win, { title: 'Choose where to save the backup', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, cancelled: true };
    dest = r.filePaths[0];
  }
  const dir0 = walletDirOf(), name = walletNameOf(), full = session.full, node = session.node;
  busy = { phase: 'Saving your wallet files…', since: Date.now() };
  try {
    if (rpc) await rpc.stopAndWait();
    stopRpc(true);
    const c = backup.copyWallet(dir0, name, dest);
    await openSession({ file: full, node, password: sessionPw, keep: true });
    if (!c.ok) return c;
    return { ok: true, dir: c.dir, files: c.files.map((f) => ({ name: f.name, size: f.size })), hasAccountKeys: c.hasAccountKeys };
  } finally { busy = null; }
});

// Show the 25 seed words after the password is entered again. They are never stored or logged.
handle('w:seed', async ({ password }) => {
  if (!wallet || !session) return { ok: false, error: 'Locked' };
  if (!samePw(password)) return { ok: false, error: 'Wrong password.' };
  const r = await wallet.rpc('query_key', { key_type: 'mnemonic' });
  return { ok: true, words: String(r.key || '') };
});

// Keys & seeds: address, private spend key, private view key and the 25 seed words, after the password is entered again.
// None of it is stored or logged. The renderer clears it all when the dialog closes.
handle('w:keys', async ({ password }) => {
  if (!wallet || !session) return { ok: false, error: 'Locked' };
  if (!samePw(password)) return { ok: false, error: 'Wrong password.' };
  const q = async (t) => { try { const r = await wallet.rpc('query_key', { key_type: t }); return String(r.key || ''); } catch (_) { return ''; } };
  const [words, view, spend] = [await q('mnemonic'), await q('view_key'), await q('spend_key')];
  if (!addrCache) addrCache = await wallet.address();
  let hasSeller = false; try { hasSeller = require('fs').existsSync(path.join(walletDirOf(), walletNameOf() + '.safex_account_keys')); } catch (_) {}
  return { ok: true, address: addrCache, words, view, spend, hasSeller };
});
// Copying a secret: the clipboard is wiped after 30 seconds if it still holds that secret.
let wipeT = null;
handle('w:copy-secret', ({ text }) => {
  const t = String(text || '').slice(0, 500); clipboard.writeText(t); clearTimeout(wipeT);
  wipeT = setTimeout(() => { try { if (clipboard.readText() === t) clipboard.clear(); } catch (_) {} }, 30000);
  return { ok: true };
});

// Rescan through the official terminal tool: with no block it starts from scratch, with a block it starts there.
// A safety copy of the wallet files is made first.
handle('w:rescan', async ({ from, password }) => {
  if (!wallet || !session) return { ok: false, error: 'Locked' };
  if (!samePw(password)) return { ok: false, error: 'Wrong password.' };
  const f = String(from == null ? '' : from).trim();
  if (f !== '' && !/^\d{1,9}$/.test(f)) return { ok: false, error: 'Block must be a whole number, or leave it empty to rescan everything.' };
  if (action) await endAction(true);
  const dir0 = walletDirOf(), name = walletNameOf(), full = session.full, node = session.node, tip = (await nodeApi.getInfo(node)).height || 0;
  if (f !== '' && tip && Number(f) > tip) return { ok: false, error: `The chain is only at block ${tip}.` };
  busy = { phase: 'Making a safety copy…', since: Date.now() };
  try {
    if (rpc) await rpc.stopAndWait();
    stopRpc(true);
    const autoRoot = path.join(app.getPath('userData'), 'backups');
    try { fsx.mkdirSync(autoRoot, { recursive: true }); } catch (_) {}
    const c = backup.copyWallet(dir0, name, autoRoot);
    if (!c.ok) { await openSession({ file: full, node, password: sessionPw, keep: true }); return { ok: false, error: 'Rescan not started, the safety copy failed: ' + c.error }; }
    backup.prune(autoRoot, name, 3);
    busy = { phase: f === '' ? 'Rescanning the whole chain. This can take several minutes…' : `Rescanning from block ${f}…`, since: Date.now() };
    const o = await cli.open(cliPath(), { walletFile: name, walletDir: dir0, node, password: sessionPw });
    if (!o.ok) { await openSession({ file: full, node, password: sessionPw, keep: true }); return { ok: false, error: o.error }; }
    busy.c = o.c;
    let r; try { r = await cli.rescan(o.c, f); } finally { try { await o.c.close(); } catch (_) {} }
    busy = { phase: 'Reopening your wallet…', since: Date.now() };
    const re = await openSession({ file: full, node, password: sessionPw, keep: true });
    if (!r.ok) return { ok: false, error: friendlyAct(/failed to connect to daemon/i.test(r.error) ? 'Could not reach your node. Check that it is running.' : r.error) };
    if (!re.ok) return re;
    return { ok: true, from: f === '' ? 0 : Number(f), safetyCopy: c.dir };
  } finally { busy = null; }
});


// Catch up with the chain through the official terminal tool, which reports how far it has got. The wallet tool the app
// normally uses cannot answer while it scans, so a wallet that is far behind is brought up to date here first.
handle('w:catch-up', async () => {
  if (!wallet || !session) return { ok: false, error: 'Locked' };
  if (action) await endAction(true);
  const full = session.full, node = session.node, name = walletNameOf(), dir0 = walletDirOf();
  const gap = behindAtOpen ? behindAtOpen.nodeHeight - (behindAtOpen.walletHeight || 0) : 0; behindAtOpen = null;
  // a wallet this computer has never scanned has to read most of the chain once; say so, so nobody wonders if it is stuck
  busy = { phase: gap > 100000 ? 'First time this wallet is opened on this computer, so it has to scan the chain once. This can take an hour or more. Please leave the app open and sit tight.' : 'Catching up with the chain…', since: Date.now() };
  try {
    if (rpc) await rpc.stopAndWait();
    stopRpc(true);
    const o = await cli.open(cliPath(), { walletFile: name, walletDir: dir0, node, password: sessionPw });
    if (!o.ok) { await openSession({ file: full, node, password: sessionPw, keep: true }); return { ok: false, error: o.error }; }
    busy.c = o.c;
    let r = { ok: true }; try { if (!o.c.noDaemon) r = await cli.run(o.c, 'refresh', 6 * 60 * 60 * 1000); } finally { try { await o.c.close(); } catch (_) {} }   // closing saves the wallet
    busy = { phase: 'Reopening your wallet…', since: Date.now() };
    const re = await openSession({ file: full, node, password: sessionPw, keep: true });
    if (!re.ok) return re;
    if (o.c.noDaemon) return { ok: false, error: 'Could not reach your node. Check that it is running.' };
    return r.ok ? { ok: true } : { ok: false, error: friendlyAct(r.error || 'The wallet tool stopped answering while it caught up.') };
  } finally { busy = null; }
});

// Light explorer: reads blocks and transactions from the node this wallet is using (never a public node, so lookups stay private).
const exNode = () => (session && session.node) || DEFAULT_NODE;
const exCall = async (fn) => { const r = await fn(exNode()); return r && !r.ok && /^(offline|bad address|bad response)$/.test(r.error || '') ? { ok: false, error: 'Could not reach your node. Start it, then try again.' } : r; };
handle('ex:recent', ({ count, before }) => exCall((h) => explorer.recent(h, Number(count) || 20, before == null ? null : Number(before))));
handle('ex:block', ({ q }) => exCall((h) => explorer.block(h, String(q || ''))));
handle('ex:tx', ({ hash }) => exCall((h) => explorer.tx(h, String(hash || ''))));
handle('ex:pool', () => exCall((h) => explorer.pool(h)));
// A second launch with --explorer (the miner's Explorer tab does this) brings this window forward and opens the Explorer.
handle('w:flags', () => ({ ok: true, explorer: process.argv.includes('--explorer') }));
if (!TEST_PORT && !app.requestSingleInstanceLock()) app.quit();
// Bring the window to the very front. A plain focus() is ignored on a Mac while another app (the miner) is in front, and some
// Linux desktops refuse it too, so the window is also raised above the others for a moment.
function bringToFront() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  if (process.platform === 'darwin' && app.focus) app.focus({ steal: true });
  win.setAlwaysOnTop(true); win.focus(); if (win.moveTop) win.moveTop();
  setTimeout(() => { try { win.setAlwaysOnTop(false); } catch (_) {} }, 500);
}
app.on('second-instance', (_e, argv) => { if (win) { bringToFront(); if (argv.includes('--explorer')) win.webContents.send('w:open-explorer'); } });

handle('w:refresh', async () => { if (!wallet) return { ok: false, error: 'Locked' }; await wallet.refresh(); return { ok: true }; });
handle('w:copy', ({ text }) => { clipboard.writeText(String(text || '').slice(0, 500)); return { ok: true }; });
handle('w:cancel', () => { prepared = null; return { ok: true }; });

app.whenReady().then(() => { startRelay().catch(() => {}); createWindow(); });
app.on('window-all-closed', () => { stopRpc(); app.quit(); });
app.on('before-quit', () => { if (relayHost) relayHost.close(); if (action) { try { action.c.kill(); } catch (_) {} } stopRpc(); });
