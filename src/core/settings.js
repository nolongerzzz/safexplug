'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  mode: 'pool',            // 'pool' | 'solo'
  address: '',
  name: '',
  pool: 'pool.safex.org:3311',
  node: '127.0.0.1:17402',
  cpu: 50,
  donate: 1,               // xmrig's own default is 1%
  autostart: false,        // start mining when the app opens
  requireSynced: true,     // solo: wait for a synced node before mining
  shareNode: false,        // publish the node's RPC to other devices (home network)
  autostartNode: false,    // start the node container when the app opens
  startDelay: 10,          // seconds to wait before auto-starting the miner on open
  publicFallback: true,    // use the public node for network stats when no local node
  shareStats: false,       // expose this miner's stats (token protected) for other rigs
  apiPort: 18080,
  apiToken: '',
  walletRpc: '',           // host:port of a wallet-rpc on this machine (payments tally)
  walletSeen: -1,          // payments already acknowledged (clears the Payments tab bubble)
  walletScanFrom: 0,       // block the app-managed view-only wallet scans from (shown as the tally's start)
  miningSince: 0,          // unix seconds: payments are counted from here (set at first mining start)
  rigs: [],                // other miners to watch: [{name, host, port, token}]
};

function sanitizeRigs(list) {
  const out = [];
  for (const r of list.slice(0, 50)) {
    if (!r || typeof r !== 'object') continue;
    const host = String(r.host || '').trim();
    const port = Number(r.port);
    if (!/^[A-Za-z0-9.\-]{1,253}$/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) continue;
    out.push({ name: String(r.name || host).slice(0, 40), host, port, token: String(r.token || '').slice(0, 200) });
  }
  return out;
}

class Settings {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    this.data = { ...DEFAULTS };
    try { Object.assign(this.data, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch (_) {}
  }
  get() { return { ...this.data }; }
  set(patch) {
    const clean = {};
    for (const k of Object.keys(DEFAULTS)) {
      if (!(k in patch)) continue;
      if (k === 'rigs') { if (Array.isArray(patch.rigs)) clean.rigs = sanitizeRigs(patch.rigs); continue; }
      if (typeof patch[k] !== typeof DEFAULTS[k]) continue;
      if (k === 'walletRpc' && patch[k] && !/^(127\.0\.0\.1|localhost):\d{2,5}$/.test(patch[k].trim())) continue; // local wallet only
      if (k === 'startDelay' && !(patch[k] >= 0 && patch[k] <= 300)) continue;
      if (k === 'apiPort' && !(Number.isInteger(patch[k]) && patch[k] > 1023 && patch[k] < 65536)) continue;
      clean[k] = patch[k];
    }
    Object.assign(this.data, clean);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch (_) { /* best effort */ }
    return this.get();
  }
}

module.exports = { Settings, DEFAULTS, sanitizeRigs };
