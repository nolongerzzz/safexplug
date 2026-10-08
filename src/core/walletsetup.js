'use strict';
// One-click helper for the official Safex wallet tools (safexcore release).
// The app downloads and checksum-verifies them, opens the wallet tool's own
// terminal prompt for the one-time view-key entry (the app never sees the key),
// and runs safex-wallet-rpc on 127.0.0.1 for the Payments tab.
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { EventEmitter } = require('events');

const VERSION = '7.0.3';
const RPC_PORT = 18082;
const base = () => process.env.SAFEX_RELEASE_BASE || `https://github.com/safex/safexcore/releases/download/${VERSION}`;
const MAC = process.platform === 'darwin';
const PLAT = MAC ? 'mac' : 'linux';
const CLI = `safex-wallet-cli-${PLAT}-${VERSION}`;
const RPC = `safex-wallet-rpc-${PLAT}-${VERSION}`;

function paths(dir) {
  return { dir, tools: path.join(dir, 'tools'), cli: path.join(dir, 'tools', CLI), rpc: path.join(dir, 'tools', RPC),
    wallet: path.join(dir, 'view'), keys: path.join(dir, 'view.keys'), pw: path.join(dir, 'view.pw'), runner: path.join(dir, MAC ? 'add-wallet.command' : 'add-wallet.sh'),
    log: path.join(dir, 'wallet-rpc.log') };
}

function status(dir) {
  const p = paths(dir);
  const has = (f) => { try { return fs.statSync(f).isFile(); } catch (_) { return false; } };
  return { supported: process.platform === 'linux' || MAC, mac: MAC, tools: has(p.cli) && has(p.rpc), wallet: has(p.keys), version: VERSION };
}

// GET with redirects; calls onRes(res) for the final 200 response.
function get(url, onRes, onErr, hops = 0) {
  if (hops > 6) return onErr(new Error('too many redirects'));
  const mod = url.startsWith('https:') ? https : http;
  mod.get(url, { headers: { 'User-Agent': 'safex-community-miner' } }, (res) => {
    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
      res.resume(); return get(new URL(res.headers.location, url).toString(), onRes, onErr, hops + 1);
    }
    if (res.statusCode !== 200) { res.resume(); return onErr(new Error(`download failed (${res.statusCode})`)); }
    onRes(res);
  }).on('error', onErr);
}
const fetchText = (url) => new Promise((resolve, reject) => get(url, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => resolve(b)); }, reject));
function fetchFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => get(url, (res) => {
    const total = Number(res.headers['content-length']) || 0; let got = 0, last = -1;
    const h = crypto.createHash('sha256'); const out = fs.createWriteStream(dest, { mode: 0o755 });
    res.on('data', (d) => { h.update(d); got += d.length; if (total) { const pc = Math.floor(got / total * 10) * 10; if (pc !== last) { last = pc; onProgress(pc); } } });
    res.pipe(out);
    out.on('finish', () => resolve(h.digest('hex')));
    out.on('error', reject); res.on('error', reject);
  }, reject));
}
const wanted = (sums, name) => { const m = new RegExp(`^([0-9a-f]{64})\\s+\\*?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm').exec(sums); return m ? m[1] : null; };

// On a Mac there is no official download: the tools are built on this computer (safexcore 7.0.3). This copies them in from the
// SOLO-SYNC Wallet's tools folder or the build folder, and test-runs each one so a copy that cannot start here is caught.
const MAC_SOURCES = (home = require('os').homedir()) => [process.env.SAFEX_MAC_TOOLS,
  path.join(home, 'Library', 'Application Support', 'safex-wallet', 'tools'),
  path.join(home, 'safexcore-build', 'build', 'b171', 'bin'), path.join(home, 'safexcore-build', 'build', 'release', 'bin'), path.join(home, 'safexcore-build', 'build', 'bin')].filter(Boolean);
const isFile = (f) => { try { return fs.statSync(f).isFile(); } catch (_) { return false; } };
const starts = (f) => { try { const r = spawnSync(f, ['--version'], { timeout: 20000, encoding: 'utf8' }); return r.status === 0 && /\d/.test(String(r.stdout) + String(r.stderr)); } catch (_) { return false; } };
function installMacTools(dir, log, sources = MAC_SOURCES()) {
  const p = paths(dir); fs.mkdirSync(p.tools, { recursive: true });
  let bad = null;
  for (const d of sources) {
    const pairs = [[path.join(d, CLI), path.join(d, RPC)], [path.join(d, 'safex-wallet-cli'), path.join(d, 'safex-wallet-rpc')]];
    for (const [a, b] of pairs) {
      if (!isFile(a) || !isFile(b)) continue;
      if (!starts(a) || !starts(b)) { bad = d; continue; }
      fs.copyFileSync(a, p.cli); fs.copyFileSync(b, p.rpc); fs.chmodSync(p.cli, 0o755); fs.chmodSync(p.rpc, 0o755);
      log(`Copied the wallet tools you built on this Mac (from ${d}).`); return { ok: true };
    }
  }
  if (bad) return { ok: false, error: `Found wallet tools in ${bad} but they did not start on this Mac. Rebuild them from safexcore 7.0.3 and try again.` };
  return { ok: false, error: 'No wallet tools found on this Mac. Install them in SOLO-SYNC Wallet first, or build safexcore 7.0.3 into ~/safexcore-build/build/b171/bin (files safex-wallet-cli and safex-wallet-rpc), then try again.' };
}
async function download(dir, log) {
  if (MAC) return installMacTools(dir, log);
  if (process.platform !== 'linux') return { ok: false, error: 'The one-click wallet tools are Linux and Mac only for now.' };
  const p = paths(dir); fs.mkdirSync(p.tools, { recursive: true });
  try {
    log('Fetching the release checksums…');
    const sums = await fetchText(`${base()}/SHA256SUMS`);
    for (const name of [CLI, RPC]) {
      const want = wanted(sums, name);
      if (!want) throw new Error(`No checksum listed for ${name}`);
      const tmp = path.join(p.tools, name + '.part');
      log(`Downloading ${name}…`);
      const got = await fetchFile(`${base()}/${name}`, tmp, (pc) => log(`  ${pc}%`));
      if (got !== want) { fs.rmSync(tmp, { force: true }); throw new Error(`Checksum mismatch for ${name}; the file was deleted.`); }
      fs.chmodSync(tmp, 0o755); fs.renameSync(tmp, path.join(p.tools, name));
      log(`${name}: checksum OK`);
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

// ---- adding the view-only wallet (keys typed into the wallet tool's own window) ----
const TERMINALS = [
  ['x-terminal-emulator', (s) => ['-e', 'sh', s]], ['gnome-terminal', (s) => ['--', 'sh', s]], ['xfce4-terminal', (s) => ['-x', 'sh', s]],
  ['konsole', (s) => ['-e', 'sh', s]], ['mate-terminal', (s) => ['-x', 'sh', s]], ['xterm', (s) => ['-e', 'sh', s]],
];
function findTerminal(pathEnv = process.env.PATH, mac = MAC) {
  if (mac && isFile('/usr/bin/open')) return { bin: '/usr/bin/open', mk: (s) => ['-a', 'Terminal', s] };   // Terminal runs a .command file
  for (const [bin, mk] of TERMINALS) {
    for (const d of String(pathEnv || '').split(path.delimiter)) { const f = path.join(d, bin); try { if (fs.statSync(f).isFile()) return { bin: f, mk }; } catch (_) {} }
  }
  return null;
}
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
function runnerScript(p, node, height) {
  return `#!/bin/sh
echo "Safex view-only wallet setup"
echo "Paste your public address when asked, press Enter, then paste your private VIEW key and press Enter."
echo "(Typed here, inside the official wallet tool. The Community Miner never sees it.)"
echo
${q(p.cli)} --generate-from-view-key ${q(p.wallet)} --password-file ${q(p.pw)} --restore-height ${Number(height) || 0} --daemon-address ${q(node)}
echo
echo "When you see 'Generated new wallet', type  exit  and press Enter, or just close this window."
echo "Press Enter to close."
read _x
`;
}
function addWallet(dir, { node = '127.0.0.1:17402', height = 0 } = {}) {
  const p = paths(dir);
  if (!status(dir).tools) return { ok: false, error: 'Download the wallet tools first.' };
  if (!/^[A-Za-z0-9.\-]+:\d{2,5}$/.test(node)) return { ok: false, error: 'Bad node address.' };
  if (fs.existsSync(p.keys)) return { ok: false, error: 'A view-only wallet is already set up. Remove it first to start over.' };
  const term = findTerminal(); if (!term) return { ok: false, error: 'No terminal program found (tried x-terminal-emulator, gnome-terminal, xfce4-terminal, konsole, xterm).' };
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(p.pw)) fs.writeFileSync(p.pw, crypto.randomBytes(24).toString('hex') + '\n', { mode: 0o600 });
  fs.writeFileSync(p.runner, runnerScript(p, node, height), { mode: 0o700 });
  const child = spawn(term.bin, term.mk(p.runner), { detached: true, stdio: 'ignore' }); child.unref();
  return { ok: true };
}

// ---- running safex-wallet-rpc ----
function rpcArgs(dir, node, port = RPC_PORT) {
  const p = paths(dir);
  return ['--wallet-file', p.wallet, '--password-file', p.pw, '--daemon-address', node, '--rpc-bind-ip', '127.0.0.1',
    '--rpc-bind-port', String(port), '--disable-rpc-login', '--log-file', p.log];
}
class WalletRpc extends EventEmitter {
  constructor(dir) { super(); this.dir = dir; this.proc = null; }
  get running() { return !!this.proc; }
  start(node) {
    const s = status(this.dir);
    if (this.proc) return { ok: true, note: 'already running' };
    if (!s.tools || !s.wallet) return { ok: false, error: 'Wallet is not set up yet.' };
    this.proc = spawn(paths(this.dir).rpc, rpcArgs(this.dir, node), { stdio: ['ignore', 'ignore', 'ignore'] });
    this.proc.on('exit', (code) => { this.proc = null; this.emit('exit', code); });
    this.proc.on('error', () => { this.proc = null; this.emit('exit', -1); });
    return { ok: true };
  }
  stop() { try { this.proc && this.proc.kill('SIGTERM'); } catch (_) {} this.proc = null; }
}
function removeWallet(dir) {
  const p = paths(dir); for (const f of [p.wallet, p.keys, p.keys + '.bak', p.wallet + '.address.txt', p.pw, p.runner]) fs.rmSync(f, { force: true });
  return { ok: true };
}

module.exports = { installMacTools, VERSION, RPC_PORT, CLI, RPC, paths, status, download, findTerminal, runnerScript, addWallet, rpcArgs, WalletRpc, removeWallet, wanted };
