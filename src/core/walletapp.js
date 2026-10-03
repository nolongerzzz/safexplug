'use strict';
// Finds the Safex Wallet app on this computer and starts it on its Explorer tab.
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

// A folder the person chose wins, then SAFEX_WALLET_APP_DIR (tests), then the usual places in the home folder.
function find({ chosen = '', home = os.homedir(), env = process.env, platform = process.platform } = {}) {
  if (platform !== 'linux') return { found: false, reason: 'platform' };
  const tries = [chosen, env.SAFEX_WALLET_APP_DIR, ...NAMES.map((n) => path.join(home, n))].filter(Boolean);
  for (const d of tries) if (valid(d)) return { found: true, dir: d };
  return { found: false, reason: 'missing' };
}

// Starts the wallet in its folder, the same way "npm start" does, detached so closing the miner does not close it.
// If the wallet is already running, the second start just brings it forward and opens its Explorer.
function launch(dir, spawnFn = spawn) {
  try {
    const child = spawnFn(path.join(dir, 'node_modules', '.bin', 'electron'), ['.', '--no-sandbox', '--explorer'], { cwd: dir, detached: true, stdio: 'ignore' });
    child.on && child.on('error', () => {});
    child.unref && child.unref();
    return { ok: true };
  } catch (e) { return { ok: false, error: 'Could not start the wallet: ' + (e.code || e.message) }; }
}

module.exports = { find, launch, valid, NAMES };
