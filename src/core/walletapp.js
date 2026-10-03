'use strict';
// Finds the Safex Wallet app on this computer and starts it tab.
// The wallet runs as its own program, so the miner only launches it; nothing is shared between them but the node.
const fs = require('fs'), path = require('path'), os = require('os');
const { spawn } = require('child_process');

const NAMES = ['safex-wallet', 'Safex-Wallet', 'safex-homebase', 'Safex-HomeBase'];

function valid(dir) {
  try {
    const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    if (!/safex-(wallet|homebase)/i.test(String(pj.name || ''))) return false;
    fs.accessSync(path.join(dir, 'node_modules', '.bin', 'electron'), fs.constants.X_OK);
    return true;
  } catch (_) { return false; }
}

// The full-speed launcher starts the miner as root through sudo. Then the home folder that counts is the person's own, and the
// wallet must be started as that person (not as root), so its files and logs stay theirs.
function realUser(env = process.env, passwd = '/etc/passwd', isRoot = typeof process.getuid === 'function' && process.getuid() === 0) {
  if (!isRoot || !env.SUDO_USER) return null;
  try {
    for (const line of fs.readFileSync(passwd, 'utf8').split('\n')) {
      const f = line.split(':'); if (f[0] === env.SUDO_USER) return { name: f[0], uid: Number(env.SUDO_UID || f[2]), gid: Number(env.SUDO_GID || f[3]), home: f[5] };
    }
  } catch (_) {}
  return null;
}

// A folder the person chose wins, then SAFEX_WALLET_APP_DIR (tests), then the usual places in the home folder.
function find({ chosen = '', home, env = process.env, platform = process.platform, user = realUser(env) } = {}) {
  home = home || (user && user.home) || os.homedir();
  if (platform !== 'linux') return { found: false, reason: 'platform' };
  const tries = [chosen, env.SAFEX_WALLET_APP_DIR, ...NAMES.map((n) => path.join(home, n))].filter(Boolean);
  for (const d of tries) if (valid(d)) return { found: true, dir: d };
  return { found: false, reason: 'missing' };
}

// Starts the wallet in its folder, the same way "npm start" does, detached so closing the miner does not close it.
// If the wallet is already running, the second start just brings that window forward; if not, it opens at its login.
function launch(dir, spawnFn = spawn, user = realUser()) {
  try {
    const opts = { cwd: dir, detached: true, stdio: 'ignore' };
    if (user) { opts.uid = user.uid; opts.gid = user.gid; opts.env = { ...process.env, HOME: user.home, USER: user.name, LOGNAME: user.name }; delete opts.env.SUDO_USER; delete opts.env.SUDO_UID; delete opts.env.SUDO_GID; }
    const child = spawnFn(path.join(dir, 'node_modules', '.bin', 'electron'), ['.', '--no-sandbox'], opts);
    child.on && child.on('error', () => {});
    child.unref && child.unref();
    return { ok: true };
  } catch (e) { return { ok: false, error: 'Could not start the wallet: ' + (e.code || e.message) }; }
}

module.exports = { find, launch, valid, realUser, NAMES };
