'use strict';
// Controls the safexd node container through the docker CLI.
// It adopts an existing "safex-node" container (so a node that is already
// synced is never rebuilt or resynced) and only creates one if none exists.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { EventEmitter } = require('events');

const CONTAINER = 'safex-node';
const IMAGE = 'safex-node:latest';
const VOLUME = 'safex-node-data';
const STOP_SECONDS = 120; // let safexd flush its database cleanly
const CONTEXT_DIR = path.join(__dirname, '..', 'node-panel', 'docker');

// GUI apps get a minimal PATH (macOS especially), so look in the usual places.
function dockerBinary() {
  // Override for unusual installs (and for tests).
  const forced = process.env.SAFEX_DOCKER_BIN;
  if (forced) { try { if (fs.statSync(forced).isFile()) return forced; } catch (_) {} return null; }
  const cands = ['/usr/bin/docker', '/usr/local/bin/docker', '/opt/homebrew/bin/docker',
    '/Applications/Docker.app/Contents/Resources/bin/docker'];
  for (const c of cands) { try { if (fs.statSync(c).isFile()) return c; } catch (_) {} }
  for (const d of String(process.env.PATH || '').split(path.delimiter)) {
    const p = path.join(d, process.platform === 'win32' ? 'docker.exe' : 'docker');
    try { if (fs.statSync(p).isFile()) return p; } catch (_) {}
  }
  return null;
}

function childEnv() {
  const extra = ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin'].join(path.delimiter);
  return { ...process.env, PATH: `${extra}${path.delimiter}${process.env.PATH || ''}` };
}

function run(args, { timeout = 30000 } = {}) {
  const bin = dockerBinary();
  return new Promise((resolve) => {
    if (!bin) return resolve({ ok: false, code: -1, out: '', err: 'docker not found' });
    execFile(bin, args, { timeout, env: childEnv(), maxBuffer: 4 * 1024 * 1024 }, (e, out, err) => {
      resolve({ ok: !e, code: e ? (typeof e.code === 'number' ? e.code : -1) : 0,
                out: String(out || '').trim(), err: String(err || (e && e.message) || '').trim() });
    });
  });
}

// What can we do right now?
//   installed: is there a docker CLI at all
//   engine:    'ok' | 'down' | 'no-permission' | 'missing'
//   image:     is the safex-node image built
//   container: 'none' | 'running' | 'stopped' | 'restarting'
async function status() {
  const s = { installed: !!dockerBinary(), engine: 'missing', image: false, container: 'none' };
  if (!s.installed) return s;
  const info = await run(['info', '--format', '{{.ServerVersion}}'], { timeout: 15000 });
  if (!info.ok) {
    s.engine = /permission denied/i.test(info.err) ? 'no-permission' : 'down';
    return s;
  }
  s.engine = 'ok';
  const img = await run(['images', '-q', IMAGE]);
  s.image = img.ok && img.out.length > 0;
  const ps = await run(['ps', '-a', '--filter', `name=^/${CONTAINER}$`, '--format', '{{.State}}']);
  const st = (ps.out.split('\n')[0] || '').trim().toLowerCase();
  if (st === 'running') s.container = 'running';
  else if (st === 'restarting') s.container = 'restarting';
  else if (st) s.container = 'stopped';
  return s;
}

// The run arguments. RPC and ZMQ are published on localhost only; only the
// P2P port is reachable from outside, so nobody else can query your node.
// With share=true (the user's "let my other devices use this node" switch) the RPC
// port is also reachable from the home network. ZMQ always stays local.
function runArgs(share) {
  return ['run', '-d', '--name', CONTAINER, '--restart', 'unless-stopped',
    '--stop-timeout', String(STOP_SECONDS),
    '-p', '17401:17401', '-p', share ? '17402:17402' : '127.0.0.1:17402:17402', '-p', '127.0.0.1:17403:17403',
    '-v', `${VOLUME}:/data`, IMAGE, '--db-sync-mode', 'safe'].concat(share ? ['--restricted-rpc'] : []);
}

async function startNode(share) {
  const s = await status();
  if (s.engine !== 'ok') return { ok: false, error: 'Docker is not ready.' };
  if (s.container === 'running') return { ok: true, note: 'already running' };
  if (s.container === 'none') {
    if (!s.image) return { ok: false, error: 'The node image has not been built yet.' };
    const r = await run(runArgs(!!share), { timeout: 60000 });
    return r.ok ? { ok: true } : { ok: false, error: r.err || 'docker run failed' };
  }
  const r = await run(['start', CONTAINER]);
  return r.ok ? { ok: true } : { ok: false, error: r.err || 'docker start failed' };
}

// 'lan' = RPC reachable from other devices, 'local' = this computer only, null = no container.
async function rpcExposure() {
  const r = await run(['port', CONTAINER, '17402']);
  if (!r.ok || !r.out.trim()) return null;
  return r.out.split('\n').some((l) => /^(0\.0\.0\.0|\[::\]):/.test(l.trim())) ? 'lan' : 'local';
}

// true when the container was started with --restricted-rpc (admin calls blocked), false when not, null if unknown.
async function rpcRestricted() {
  const r = await run(['inspect', '--format', '{{json .Config.Cmd}}', CONTAINER]);
  if (!r.ok) return null;
  try { return JSON.parse(r.out.trim()).includes('--restricted-rpc'); } catch (_) { return null; }
}

// Port bindings are fixed when a container is created, so changing them means
// removing and re-creating the container. The chain lives in the volume and is not touched.
async function recreateNode(share) {
  const s = await status();
  if (s.engine !== 'ok') return { ok: false, error: 'Docker is not ready.' };
  if (s.container === 'running' || s.container === 'restarting') {
    const st = await stopNode(); if (!st.ok) return st;
  }
  if (s.container !== 'none') {
    const rm = await run(['rm', CONTAINER]); if (!rm.ok) return { ok: false, error: rm.err || 'docker rm failed' };
  }
  const r = await run(runArgs(!!share), { timeout: 60000 });
  return r.ok ? { ok: true } : { ok: false, error: r.err || 'docker run failed' };
}

async function stopNode() {
  const r = await run(['stop', '-t', String(STOP_SECONDS), CONTAINER], { timeout: (STOP_SECONDS + 30) * 1000 });
  return r.ok ? { ok: true } : { ok: false, error: r.err };
}

// Stream a long-running docker command's output as 'line' events.
class Streamer extends EventEmitter {
  constructor(args) {
    super();
    const bin = dockerBinary();
    this.buf = '';
    if (!bin) { setImmediate(() => { this.emit('line', 'docker not found'); this.emit('exit', -1); }); return; }
    this.proc = spawn(bin, args, { env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    const feed = (d) => {
      this.buf += d.toString();
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) { this.emit('line', this.buf.slice(0, i).replace(/\r$/, '')); this.buf = this.buf.slice(i + 1); }
    };
    this.proc.stdout.on('data', feed); this.proc.stderr.on('data', feed);
    this.proc.on('error', (e) => this.emit('line', 'ERROR: ' + e.message));
    this.proc.on('exit', (c) => { if (this.buf) this.emit('line', this.buf); this.emit('exit', c); });
  }
  stop() { try { this.proc && this.proc.kill('SIGTERM'); } catch (_) {} }
}

const buildImage = () => new Streamer(['build', '-t', IMAGE, CONTEXT_DIR]);
const followLogs = () => new Streamer(['logs', '-f', '--tail', '60', CONTAINER]);

// ---- installing Docker ------------------------------------------------------
// Linux (Debian/Ubuntu/Mint): one polkit password prompt, then the whole install.
// Other systems: we point people at the right download instead of guessing.
function installPlan() {
  if (process.platform === 'linux') {
    const apt = ['/usr/bin/apt-get'].some((p) => fs.existsSync(p));
    if (apt) return { kind: 'linux-apt' };
    return { kind: 'link', url: 'https://docs.docker.com/engine/install/' };
  }
  if (process.platform === 'darwin') return { kind: 'link', url: 'https://www.docker.com/products/docker-desktop/' };
  if (process.platform === 'win32') return { kind: 'link', url: 'https://www.docker.com/products/docker-desktop/' };
  return { kind: 'link', url: 'https://docs.docker.com/get-docker/' };
}

// $1 is the user to give access to. setfacl gives that user the socket right
// away; the docker group makes it permanent from the next login.
const LINUX_INSTALL_SCRIPT = [
  'set -e',
  'export DEBIAN_FRONTEND=noninteractive',
  'apt-get update',
  'apt-get install -y docker.io acl',
  'systemctl enable --now docker',
  'usermod -aG docker "$1"',
  'setfacl -m "u:$1:rw" /var/run/docker.sock || true',
  'echo "Docker installed."',
].join('\n');

const LINUX_START_SCRIPT = [
  'set -e',
  'systemctl start docker',
  'setfacl -m "u:$1:rw" /var/run/docker.sock || true',
  'echo "Docker started."',
].join('\n');

function pkexecScript(script) {
  const user = os.userInfo().username;
  if (!/^[a-z_][a-z0-9_-]*\$?$/i.test(user)) {
    const s = new EventEmitter();
    setImmediate(() => { s.emit('line', 'Unexpected user name; refusing to continue.'); s.emit('exit', 1); });
    s.stop = () => {};
    return s;
  }
  const s = new EventEmitter();
  const p = spawn('pkexec', ['/bin/sh', '-c', script, 'sh', user], { stdio: ['ignore', 'pipe', 'pipe'] });
  let buf = '';
  const feed = (d) => { buf += d.toString(); let i; while ((i = buf.indexOf('\n')) >= 0) { s.emit('line', buf.slice(0, i)); buf = buf.slice(i + 1); } };
  p.stdout.on('data', feed); p.stderr.on('data', feed);
  p.on('error', (e) => { s.emit('line', 'ERROR: ' + e.message + ' (is polkit/pkexec installed?)'); s.emit('exit', 1); });
  p.on('exit', (c) => { if (buf) s.emit('line', buf); s.emit('exit', c); });
  s.stop = () => { try { p.kill('SIGTERM'); } catch (_) {} };
  return s;
}

const installDockerLinux = () => pkexecScript(LINUX_INSTALL_SCRIPT);
const startDockerEngineLinux = () => pkexecScript(LINUX_START_SCRIPT);

// Mac: Docker Desktop is an ordinary app, so "start" means opening it. No password prompt from us.
function startDockerApp() {
  const s = new EventEmitter();
  s.stop = () => {};
  if (process.platform !== 'darwin') {
    setImmediate(() => { s.emit('line', 'Open the Docker app yourself, then come back.'); s.emit('exit', 1); });
    return s;
  }
  const p = spawn('/usr/bin/open', ['-a', 'Docker'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let buf = '';
  const feed = (d) => { buf += d.toString(); };
  p.stdout.on('data', feed); p.stderr.on('data', feed);
  p.on('error', (e) => { s.emit('line', 'ERROR: ' + e.message); s.emit('exit', 1); });
  p.on('exit', (c) => { if (buf.trim()) s.emit('line', buf.trim()); s.emit('exit', c); });
  return s;
}

module.exports = {
  rpcRestricted,
  run, Streamer, CONTAINER, IMAGE, VOLUME, STOP_SECONDS, dockerBinary, status, runArgs, startNode, stopNode, rpcExposure, recreateNode,
  buildImage, followLogs, installPlan, installDockerLinux, startDockerEngineLinux, startDockerApp,
  LINUX_INSTALL_SCRIPT, LINUX_START_SCRIPT,
};
