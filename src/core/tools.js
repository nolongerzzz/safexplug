'use strict';
// Official Safex wallet tools (safexcore release): download + SHA256 verify, open the wallet tool's own terminal
// window for creating a wallet (so the seed is only ever shown there), and run safex-wallet-rpc on 127.0.0.1.
const fs = require('fs'), path = require('path'), https = require('https'), http = require('http'), crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { EventEmitter } = require('events');
const { call } = require('./rpc');
const net = require('net');

const VERSION = '7.0.3';
const RPC_PORT = 18083;   // the miner's own view-only wallet uses 18082, so both can run together
const base = () => process.env.SAFEX_RELEASE_BASE || `https://github.com/safex/safexcore/releases/download/${VERSION}`;
const MAC = process.platform === 'darwin';
const WIN = process.platform === 'win32';
const PLAT = MAC ? 'mac' : WIN ? 'windows' : 'linux';
const EXE = WIN ? '.exe' : '';
const CLI = `safex-wallet-cli-${PLAT}-${VERSION}${EXE}`, RPC = `safex-wallet-rpc-${PLAT}-${VERSION}${EXE}`;
const paths = (dir) => ({ dir, tools: path.join(dir, 'tools'), cli: path.join(dir, 'tools', CLI), rpc: path.join(dir, 'tools', RPC), wallets: path.join(dir, 'wallets'), runner: path.join(dir, MAC ? 'create-wallet.command' : WIN ? 'create-wallet.cmd' : 'create-wallet.sh'), log: path.join(dir, 'wallet-rpc.log') });
const isFile = (f) => { try { return fs.statSync(f).isFile(); } catch (_) { return false; } };
const status = (dir) => { const p = paths(dir); return { supported: process.platform === 'linux' || MAC || WIN, tools: isFile(p.cli) && isFile(p.rpc), version: VERSION }; };

function get(url, onRes, onErr, hops = 0) {
  if (hops > 6) return onErr(new Error('too many redirects'));
  (url.startsWith('https:') ? https : http).get(url, { headers: { 'User-Agent': 'safex-wallet' } }, (res) => {
    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) { res.resume(); return get(new URL(res.headers.location, url).toString(), onRes, onErr, hops + 1); }
    if (res.statusCode !== 200) { res.resume(); return onErr(new Error(`download failed (${res.statusCode})`)); }
    onRes(res);
  }).on('error', onErr);
}
const fetchText = (u) => new Promise((ok, no) => get(u, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => ok(b)); }, no));
const fetchFile = (u, dest, prog) => new Promise((ok, no) => get(u, (res) => {
  const total = Number(res.headers['content-length']) || 0; let got = 0, last = -1; const h = crypto.createHash('sha256'); const out = fs.createWriteStream(dest, { mode: 0o755 });
  res.on('data', (d) => { h.update(d); got += d.length; if (total) { const pc = Math.floor(got / total * 10) * 10; if (pc !== last) { last = pc; prog(pc); } } });
  res.pipe(out); out.on('finish', () => ok(h.digest('hex'))); out.on('error', no); res.on('error', no);
}, no));
const wanted = (sums, name) => { const m = new RegExp(`^([0-9a-f]{64})\\s+\\*?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').exec(sums); return m ? m[1] : null; };

// On a Mac there is no official download: the tools are built on this computer (safexcore 7.0.3), and this copies them in.
const MAC_BUILD_DIRS = (home = require('os').homedir()) => [process.env.SAFEX_MAC_TOOLS, path.join(home, 'safexcore-build', 'build', 'b171', 'bin'), path.join(home, 'safexcore-build', 'build', 'release', 'bin'), path.join(home, 'safexcore-build', 'build', 'bin')].filter(Boolean);
function installMacTools(dir, log, dirs = MAC_BUILD_DIRS()) {
  const p = paths(dir); fs.mkdirSync(p.tools, { recursive: true });
  for (const d of dirs) {
    const a = path.join(d, 'safex-wallet-cli'), b = path.join(d, 'safex-wallet-rpc');
    if (isFile(a) && isFile(b)) {
      fs.copyFileSync(a, p.cli); fs.copyFileSync(b, p.rpc); fs.chmodSync(p.cli, 0o755); fs.chmodSync(p.rpc, 0o755);
      log(`Copied the wallet tools you built on this Mac (from ${d}).`); return { ok: true };
    }
  }
  return { ok: false, error: 'No wallet tools found on this Mac. They are built from safexcore 7.0.3 into ~/safexcore-build/build/b171/bin (files safex-wallet-cli and safex-wallet-rpc). Build them first, then try again.' };
}
async function download(dir, log) {
  if (MAC) return installMacTools(dir, log);
  if (process.platform !== 'linux' && !WIN) return { ok: false, error: 'The wallet tools are Linux, Mac and Windows only.' };
  const p = paths(dir); fs.mkdirSync(p.tools, { recursive: true });
  try {
    log('Fetching the release checksums…'); const sums = await fetchText(`${base()}/SHA256SUMS`);
    for (const name of [CLI, RPC]) {
      const want = wanted(sums, name); if (!want) throw new Error(`No checksum listed for ${name}`);
      const tmp = path.join(p.tools, name + '.part'); log(`Downloading ${name}…`);
      const got = await fetchFile(`${base()}/${name}`, tmp, (pc) => log(`  ${pc}%`));
      if (got !== want) { fs.rmSync(tmp, { force: true }); throw new Error(`Checksum mismatch for ${name}; the file was deleted.`); }
      fs.chmodSync(tmp, 0o755); fs.renameSync(tmp, path.join(p.tools, name)); log(`${name}: checksum OK`);
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

const TERMINALS = [['x-terminal-emulator', (s) => ['-e', 'sh', s]], ['gnome-terminal', (s) => ['--', 'sh', s]], ['xfce4-terminal', (s) => ['-x', 'sh', s]], ['konsole', (s) => ['-e', 'sh', s]], ['mate-terminal', (s) => ['-x', 'sh', s]], ['xterm', (s) => ['-e', 'sh', s]]];
function findTerminal(pathEnv = process.env.PATH, mac = MAC, win = WIN) {
  // Windows: open a new console window running the .cmd and keep it open (cmd /k) so the person can read and type in it.
  if (win) return { bin: process.env.ComSpec || 'cmd.exe', mk: (s) => ['/c', 'start', '"SOLO-SYNC Wallet tool"', 'cmd', '/k', `"${s}"`], windows: true };
  if (mac && isFile('/usr/bin/open')) return { bin: '/usr/bin/open', mk: (s) => ['-a', 'Terminal', s] };   // Terminal runs a .command file
  for (const [bin, mk] of TERMINALS) for (const d of String(pathEnv || '').split(path.delimiter)) { const f = path.join(d, bin); if (isFile(f)) return { bin: f, mk }; }
  return null;
}
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
function createScript(p, node) {
  return `#!/bin/sh
cd ${q(p.wallets)} || exit 1
echo "Create a new Safex wallet (this window is the official wallet tool)."
echo "1) Type a file name for the wallet and press Enter."
echo "2) Choose a password you will remember. 3) Pick a language."
echo "4) WRITE DOWN the seed words it shows, on paper. Anyone with them can take your coins."
echo "Safex Wallet never sees the seed or the password you type here."
echo
${q(p.cli)} --daemon-address ${q(node)}
echo
echo "When you see your address, type  exit  and press Enter, then go back to Safex Wallet and choose Open Existing Wallet."
echo "Press Enter to close."
read _x
`;
}
// Restore modes. Each one runs in the wallet tool's own terminal window: seed words / keys are typed THERE, never into
// Safex Wallet. Flags verified against safex-wallet-cli 7.0.3 --help.
const MODES = {
  new: { title: 'Create a new Safex wallet', intro: ['Type a file name for the wallet, choose a password, pick a language.', 'WRITE DOWN the seed words it shows, on paper. Anyone with them can take your coins.'], flags: null, height: false },
  seed: { title: 'Recover a wallet from its seed phrase', intro: ['Step 1: a short file name. Step 2: the wallet tool asks for a password and then your 25 seed words (if it asks for a start block, Enter scans everything).'], flags: '--generate-new-wallet "$NAME" --restore-deterministic-wallet', height: true },
  spend: { title: 'Recover a wallet from its spend key', intro: ['Step 1: a short file name. Step 2: the wallet tool asks for a password, then your address and spend key (if it asks for a start block, Enter scans everything).'], flags: '--generate-from-spend-key "$NAME"', height: true },
};
// Windows version of the same guided window (a .cmd file). Same rules: seed words and keys are typed in the wallet tool's own window only.
const cq = (s) => `"${String(s).replace(/"/g, '')}"`;
const ce = (l) => 'echo ' + String(l).replace(/[\^&|<>()%!"]/g, (c) => (c === '%' ? '%%' : '^' + c));
function winWalletScript(p, node, mode) {
  const m = MODES[mode];
  const head = ['@echo off', `cd /d ${cq(p.wallets)} || exit /b 1`, ce(m.title + ' (this window is the official wallet tool).'), ...m.intro.map(ce), 'echo Safex Wallet never sees anything you type here.', 'echo.'];
  const tail = ['echo.', 'echo When you see your address, type  exit  and press Enter, then go back to Safex Wallet and choose Open Existing Wallet.', 'pause'];
  if (!m.flags) return [...head, `${cq(p.cli)} --daemon-address ${cq(node)}`, ...tail, ''].join('\r\n');
  const stop = (msg) => `(${ce(msg)} & pause & exit /b 1)`;
  return [...head,
    'echo Step 1 of 2: a FILE NAME for the new wallet file. One short word such as  recovered1  (letters, numbers, - and _ only, no spaces).',
    'echo Do NOT type or paste your seed words here. They are asked for in step 2, by the wallet tool itself.',
    'set /p NAME=File name: ',
    `if "%NAME%"=="" ${stop('Nothing was typed. Nothing was changed.')}`,
    `echo %NAME%| findstr /R /C:"^[A-Za-z0-9_-][A-Za-z0-9_-]*$" >nul || ${stop('That name is not allowed. Use only letters, numbers, - and _ , no spaces. Nothing was changed.')}`,
    `if exist "%NAME%.keys" ${stop('A wallet with that name already exists here. Nothing was changed.')}`,
    `${cq(p.cli)} ${m.flags.replace(/"\$NAME"/g, '"%NAME%"')} --daemon-address ${cq(node)}`,
    ...tail, ''].join('\r\n');
}
function walletScript(p, node, mode, win = WIN) {
  if (win) return winWalletScript(p, node, mode);
  const m = MODES[mode]; const lines = m.intro.map((l) => `echo ${q(l)}`).join('\n');
  const common = `cd ${q(p.wallets)} || exit 1
echo ${q(m.title + ' (this window is the official wallet tool).')}
${lines}
echo "Safex Wallet never sees anything you type here."
echo`;
  if (!m.flags) return `#!/bin/sh
${common}
${q(p.cli)} --daemon-address ${q(node)}
echo
echo "When you see your address, type  exit  and press Enter, then go back to Safex Wallet and choose Open Existing Wallet."
echo "Press Enter to close."
read _x
`;
  return `#!/bin/sh
${common}
echo "Step 1 of 2: a FILE NAME for the new wallet file. One short word such as  recovered1  (letters, numbers, - and _ only, no spaces)."
echo "Do NOT type or paste your seed words here. They are asked for in step 2, by the wallet tool itself."
printf "File name: "; read NAME
case "$NAME" in
  '') echo "Nothing was typed. Nothing was changed."; echo "Press Enter to close."; read _x; exit 1;;
  *\\ *) echo "That has spaces, so it is not a file name. Nothing was saved or changed. Close this window, start again, and type one short word."; echo "Press Enter to close."; read _x; exit 1;;
  *[!A-Za-z0-9_-]*) echo "That name is not allowed. Use only letters, numbers, - and _ . Nothing was changed."; echo "Press Enter to close."; read _x; exit 1;;
esac
[ -e "$NAME.keys" ] && { echo "A wallet called $NAME already exists here. Nothing was changed."; echo "Press Enter to close."; read _x; exit 1; }
${q(p.cli)} ${m.flags} --daemon-address ${q(node)}
echo
echo "When you see your address, type  exit  and press Enter, then go back to Safex Wallet and choose Open Existing Wallet."
echo "Press Enter to close."
read _x
`;
}
function createScript(p, node, win) { return walletScript(p, node, 'new', win); }
function runWalletTool(dir, mode, { node = '127.0.0.1:17402' } = {}) {
  const p = paths(dir);
  if (!MODES[mode]) return { ok: false, error: 'Unknown option.' };
  if (!status(dir).tools) return { ok: false, error: 'Download the wallet tools first: use the "Download wallet tools" button at the top of this screen.' };
  if (!/^[A-Za-z0-9.\-]+:\d{2,5}$/.test(node)) return { ok: false, error: 'Bad node address.' };
  const term = findTerminal(); if (!term) return { ok: false, error: 'No terminal program found (tried x-terminal-emulator, gnome-terminal, xfce4-terminal, konsole, xterm).' };
  fs.mkdirSync(p.wallets, { recursive: true }); fs.writeFileSync(p.runner, walletScript(p, node, mode), { mode: 0o700 });
  spawn(term.bin, term.mk(p.runner), { detached: true, stdio: 'ignore', windowsHide: false, windowsVerbatimArguments: !!term.windows }).unref();
  return { ok: true };
}
const createWallet = (dir, o) => runWalletTool(dir, 'new', o);
const listWallets = (dir) => { try { return fs.readdirSync(paths(dir).wallets).filter((f) => f.endsWith('.keys')).sort(); } catch (_) { return []; } };

// safex-wallet-rpc runs in wallet-dir mode with NO password on its command line: the password is sent only through open_wallet.
function rpcArgs(dir, walletDir, node, port = RPC_PORT) {
  return ['--wallet-dir', walletDir, '--daemon-address', node, '--rpc-bind-ip', '127.0.0.1', '--rpc-bind-port', String(port), '--disable-rpc-login', '--log-file', paths(dir).log];
}

// A wallet tool that also knows the swap steps ships inside the app (tools/swap, Linux only). It is used when it can start
// on this computer; otherwise the official tool is used and the Swap tab explains that it is unavailable.
const swapDir = () => path.join(__dirname, '..', '..', 'tools', 'swap');
let swapChecked = null;
function swapTool() {
  if (process.platform !== 'linux') return null;
  if (swapChecked !== null) return swapChecked || null;
  const bin = path.join(swapDir(), 'safex-wallet-rpc'), lib = path.join(swapDir(), 'lib');
  swapChecked = false;
  if (isFile(bin)) {
    const env = { ...process.env, LD_LIBRARY_PATH: lib + (process.env.LD_LIBRARY_PATH ? ':' + process.env.LD_LIBRARY_PATH : '') };
    try { const r = spawnSync(bin, ['--version'], { env, timeout: 8000 }); const out = String(r.stdout || '') + String(r.stderr || ''); if (!r.error && !r.signal && /Safex/.test(out) && !/error while loading|cannot execute|GLIBC/i.test(out)) swapChecked = { bin, env }; } catch (_) {}
  }
  return swapChecked || null;
}
class WalletRpc extends EventEmitter {
  constructor(dir, port = RPC_PORT) { super(); this.dir = dir; this.port = port; this.proc = null; }
  get running() { return !!this.proc; }
  start(walletDir, node) {
    if (this.proc) return { ok: true };
    if (!status(this.dir).tools) return { ok: false, error: 'Wallet tools are not downloaded yet.' };
    const sw = swapTool();
    this.proc = spawn(sw ? sw.bin : paths(this.dir).rpc, rpcArgs(this.dir, walletDir, node, this.port), { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true, ...(sw ? { env: sw.env } : {}) });
    this.proc.on('exit', (c) => { this.proc = null; this.emit('exit', c); }); this.proc.on('error', () => { this.proc = null; this.emit('exit', -1); });
    return { ok: true };
  }
  stop() { try { this.proc && this.proc.kill('SIGTERM'); } catch (_) {} this.proc = null; }
  // wait until the tool has really exited (it saves the wallet on the way out), so its file is free for another program
  stopAndWait(ms = 15000) {
    return new Promise((resolve) => {
      const p = this.proc; if (!p) return resolve();
      const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch (_) {} }, ms);
      p.once('exit', () => { clearTimeout(t); resolve(); });
      try { p.kill('SIGTERM'); } catch (_) { clearTimeout(t); resolve(); }
    });
  }
}
// The tool answers JSON-RPC as soon as it is listening, even with no wallet open.
async function waitUp(port, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { await call(port, 'get_height', {}, { timeout: 2000 }); return true; } catch (e) { if (e.code !== -3 && e.code !== -2) return true; } await new Promise((r) => setTimeout(r, 400)); }
  return false;
}

// Is something already listening on this port? A leftover wallet tool from an earlier run would block a new one.
function portBusy(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.setTimeout(1500, () => { s.destroy(); resolve(true); });
    s.once('connect', () => { s.destroy(); resolve(true); }); s.once('error', () => resolve(false));
  });
}
// Free the port: ask a leftover wallet tool to stop. Returns false when it will not go (hung), so the app can say so plainly.
async function clearPort(port, tries = 10) {
  if (!(await portBusy(port))) return true;
  try { await call(port, 'stop_wallet', {}, { timeout: 3000 }); } catch (_) {}
  for (let i = 0; i < tries; i++) { await new Promise((r) => setTimeout(r, 500)); if (!(await portBusy(port))) return true; }
  return false;
}

module.exports = { swapTool, installMacTools, MAC_BUILD_DIRS, portBusy, clearPort, VERSION, RPC_PORT, paths, status, download, findTerminal, createScript, createWallet, runWalletTool, walletScript, winWalletScript, MODES, listWallets, rpcArgs, WalletRpc, waitUp, wanted };
