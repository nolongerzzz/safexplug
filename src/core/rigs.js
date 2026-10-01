'use strict';
// Watch other miners through xmrig's built-in HTTP API (read-only, token protected).
// Works for any xmrig-based miner that has its API switched on, and for other
// copies of this app with "Share this miner's stats" enabled.
const http = require('http');

function get(rig, pathName, timeoutMs = 3500) {
  return new Promise((resolve) => {
    const headers = rig.token ? { Authorization: 'Bearer ' + rig.token } : {};
    const req = http.get({ host: rig.host, port: rig.port, path: pathName, headers, timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; if (body.length > 2e6) req.destroy(); });
      res.on('end', () => {
        if (res.statusCode === 401 || res.statusCode === 403) return resolve({ error: 'auth' });
        if (res.statusCode !== 200) return resolve({ error: 'http ' + res.statusCode });
        try { resolve({ json: JSON.parse(body) }); } catch (_) { resolve({ error: 'bad response' }); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ error: 'offline' }); });
    req.on('error', () => resolve({ error: 'offline' }));
  });
}

// Normalise an xmrig /2/summary document.
function parseSummary(j) {
  const total = (j.hashrate && j.hashrate.total) || [];
  const hr = [total[0], total[1], total[2]].map((v) => (typeof v === 'number' ? v : null));
  const good = Number(j.results && j.results.shares_good) || 0;
  const all = Number(j.results && j.results.shares_total) || 0;
  return {
    hashrate: hr[0] ?? hr[1] ?? hr[2],     // best available: 10s, then 60s, then 15m
    h60: hr[1], h15m: hr[2],
    accepted: good, rejected: Math.max(0, all - good),
    uptime: Number(j.uptime) || 0,
    worker: j.worker_id || '',
    version: j.version || '',
    cpu: (j.cpu && j.cpu.brand) || '',
    threads: null,   // filled in from /2/backends
    pool: (j.connection && j.connection.pool) || '',
    algo: j.algo || '',
  };
}

// The wallet a rig mines to, from its config (best effort; not always exposed).
function walletFrom(cfg) {
  const pools = (cfg && cfg.pools) || [];
  return (pools[0] && pools[0].user) || null;
}

// Thread count = the CPU backend's thread list in /2/backends.
function threadsFrom(backends) {
  if (!Array.isArray(backends)) return null;
  const cpu = backends.find((x) => x && x.type === 'cpu' && x.enabled !== false);
  return cpu && Array.isArray(cpu.threads) ? cpu.threads.length : null;
}

async function fetchRig(rig) {
  const s = await get(rig, '/2/summary');
  if (s.error) return { online: false, reason: s.error };
  const out = { online: true, ...parseSummary(s.json) };
  const [c, b] = await Promise.all([get(rig, '/1/config'), get(rig, '/2/backends')]);
  out.wallet = c.json ? walletFrom(c.json) : null;
  out.threads = threadsFrom(b.json);
  return out;
}

async function pollAll(rigs, myWallet) {
  const rows = await Promise.all(rigs.map(async (r) => {
    const st = await fetchRig(r);
    const wallet = st.wallet || null;
    return { name: r.name, host: r.host, port: r.port, ...st,
             otherWallet: !!(st.online && wallet && myWallet && wallet !== myWallet) };
  }));
  return rows;
}

// Combined figures for the wallet: this machine plus every online rig.
function combine(local, rows) {
  let hashrate = 0, accepted = 0, rejected = 0, online = 0;
  const add = (r) => { hashrate += r.hashrate || 0; accepted += r.accepted || 0; rejected += r.rejected || 0; online += 1; };
  if (local && local.running) add(local);
  for (const r of rows) if (r.online) add(r);
  return { hashrate, accepted, rejected, online, total: rows.length + 1 };
}

module.exports = { fetchRig, pollAll, combine, parseSummary, walletFrom };
