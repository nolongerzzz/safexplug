'use strict';
// Runs xmrig and turns its output into events. Used by the Electron main
// process today, and importable by the future node panel as-is.
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { parseLine, LineSplitter } = require('./parser');

const RES = path.join(__dirname, '..', 'resources');

function xmrigPath() {
  const p = os.platform();
  if (p === 'linux') return path.join(RES, 'linux', 'xmrig');
  if (p === 'win32') return path.join(RES, 'windows', 'xmrig.exe');
  if (p === 'darwin') {
    return path.join(RES, /arm/.test(os.arch()) ? 'mac_m1' : 'mac', 'xmrig');
  }
  throw new Error('Unsupported platform: ' + p);
}

// settings: { mode:'pool'|'solo', address, pool, node, cpu(1-100), name, donate }
function buildArgs(s) {
  const name = (s.name || '').trim() || 'Safex Community Miner';
  const args = [
    '--coin', 'sfx',
    '-a', 'rx/sfx',
    '-u', s.address,
    '--cpu-max-threads-hint', String(s.cpu || 100),
    '--donate-level', String(Number.isInteger(s.donate) ? s.donate : 1),
    '--print-time', '5',
    '--no-color',
  ];
  // Optional read-only stats API so other rigs / this app can see this miner.
  if (s.shareStats && s.apiToken) {
    args.push('--http-host', '0.0.0.0', '--http-port', String(s.apiPort || 18080), '--http-access-token', s.apiToken);
  }
  if (s.mode === 'solo') {
    args.push('--daemon', '-o', s.node || '127.0.0.1:17402');
  } else {
    args.push('-o', s.pool, '-p', name, '--api-worker-id', name, '-k');
  }
  return args;
}

function validate(s) {
  if (!s.address || !/^Safex[0-9A-Za-z]{90,100}$/.test(s.address.trim())) {
    return 'Enter a valid Safex public address (starts with "Safex").';
  }
  if (s.mode === 'solo' && !/^[\w.\-]+:\d{2,5}$/.test(s.node || '')) {
    return 'Node address should look like 127.0.0.1:17402';
  }
  if (s.mode !== 'solo' && !/^[\w.\-]+:\d{2,5}$/.test(s.pool || '')) {
    return 'Pool address should look like pool.safex.org:3311';
  }
  return null;
}

class Miner extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.stats = this._fresh();
  }

  _fresh() {
    return { hashrate: null, accepted: 0, rejected: 0, blocks: 0, threads: null,
             hugepages: null, msr: null, connected: false, height: null };
  }

  get running() { return !!this.proc; }

  start(settings) {
    if (this.proc) return { ok: false, error: 'Miner already running' };
    const bad = validate(settings);
    if (bad) return { ok: false, error: bad };

    const bin = xmrigPath();
    try { fs.chmodSync(bin, 0o755); } catch (_) { /* read-only install is fine */ }
    if (!fs.existsSync(bin)) return { ok: false, error: 'Miner engine not found: ' + bin };

    this.stats = this._fresh();
    this._emitStats();
    const args = buildArgs({ ...settings, address: settings.address.trim() });
    const shown = args.map((a, i) => (a.startsWith('Safex') ? a.slice(0, 10) + '…' : (args[i - 1] === '--http-access-token' ? '••••' : a)));
    this.emit('log', '$ xmrig ' + shown.join(' '));

    let proc;
    try { proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
    this.proc = proc;

    const handle = (line) => {
      this.emit('log', line);
      for (const ev of parseLine(line)) this._apply(ev);
    };
    const out = new LineSplitter(handle);
    const err = new LineSplitter(handle);
    proc.stdout.on('data', (d) => out.push(d));
    proc.stderr.on('data', (d) => err.push(d));
    proc.on('error', (e) => { this.emit('log', 'ERROR: ' + e.message); });
    proc.on('exit', (code, sig) => {
      out.flush(); err.flush();
      this.proc = null;
      this.stats.hashrate = null;
      this.stats.connected = false;
      this._emitStats();
      this.emit('exit', { code, signal: sig });
    });
    this.emit('state', { running: true });
    return { ok: true };
  }

  stop() {
    if (!this.proc) return;
    const p = this.proc;
    p.kill('SIGTERM');
    setTimeout(() => { try { p.kill('SIGKILL'); } catch (_) {} }, 5000).unref();
  }

  _apply(ev) {
    const s = this.stats;
    switch (ev.type) {
      case 'hashrate': s.hashrate = ev.h10 ?? ev.h60 ?? ev.h15m ?? s.hashrate; s.hrMax = ev.max; break;
      case 'shares': s.accepted = ev.accepted; s.rejected = ev.rejected; break;
      case 'block-found': s.blocks += 1; break;
      case 'threads': s.threads = ev.threads; break;
      case 'hugepages': s.hugepages = ev.percent; break;
      case 'msr': s.msr = ev.ok; break;
      case 'job': s.connected = true; if (ev.height) s.height = ev.height; break;
      case 'connected': s.connected = true; break;
      case 'connection-error': s.connected = false; break;
    }
    this._emitStats();
  }

  _emitStats() { this.emit('stats', { ...this.stats }); }
}

module.exports = { Miner, buildArgs, validate, xmrigPath };
