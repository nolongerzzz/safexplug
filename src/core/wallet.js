'use strict';
// Rolling tally of payments received, read from a wallet-rpc running on THIS
// machine (safex-wallet-rpc). The app never sees seeds or keys: the wallet
// holds them, we only ask it for its list of incoming transfers.
const http = require('http');

const ATOMIC = 1e10; // 1 SFX = 10^10 atomic units

function rpc(hostport, method, params = {}, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const m = /^([A-Za-z0-9.\-]+):(\d{1,5})$/.exec(String(hostport || '').trim());
    if (!m) return resolve({ ok: false, error: 'bad address' });
    const body = JSON.stringify({ jsonrpc: '2.0', id: '0', method, params });
    const req = http.request({ host: m[1], port: Number(m[2]), path: '/json_rpc', method: 'POST', timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      let out = '';
      res.on('data', (d) => { out += d; if (out.length > 20e6) req.destroy(); });
      res.on('end', () => {
        if (res.statusCode === 401) return resolve({ ok: false, error: 'login-required' });
        try {
          const j = JSON.parse(out);
          if (j.error) return resolve({ ok: false, error: String(j.error.message || 'wallet error') });
          resolve({ ok: true, result: j.result || {} });
        } catch (_) { resolve({ ok: false, error: 'bad response' }); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'offline' }); });
    req.on('error', () => resolve({ ok: false, error: 'offline' }));
    req.end(body);
  });
}

// Pure: sum incoming transfers that arrived at/after `since` (unix seconds).
// Mined block rewards show up with type "block", other deposits with "in".
function tally(transfers, since = 0, now = Math.floor(Date.now() / 1000)) {
  const t = { last24: { count: 0, atomic: 0, sfx: 0, list: [] }, count: 0, atomic: 0, mined: 0, minedAtomic: 0, tokenAtomic: 0, latest: null, recent: [] };
  const seen = new Set();
  for (const x of transfers || []) {
    if (!x || (x.type !== 'in' && x.type !== 'block')) continue;
    if (!(Number(x.timestamp) >= since)) continue;
    const key = x.txid || `${x.timestamp}:${x.amount}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const amt = Number(x.amount) || 0;
    t.count++; t.atomic += amt; t.tokenAtomic += Number(x.token_amount) || 0;
    if (x.type === 'block') { t.mined++; t.minedAtomic += amt; }
    if (Number(x.timestamp) >= now - 86400) { t.last24.count++; t.last24.atomic += amt; t.last24.list.push({ time: Number(x.timestamp), sfx: amt / ATOMIC }); }
    t.recent.push({ time: Number(x.timestamp), sfx: amt / ATOMIC, type: x.type, confirmations: Number(x.confirmations) || 0, txid: x.txid || '', height: Number(x.height) || null });
  }
  t.recent.sort((a, b) => b.time - a.time);
  t.latest = t.recent.length ? t.recent[0].time : null;
  t.recent = t.recent.slice(0, 20);
  t.last24.sfx = t.last24.atomic / ATOMIC;
  t.sfx = t.atomic / ATOMIC; t.minedSfx = t.minedAtomic / ATOMIC; t.tokens = t.tokenAtomic / ATOMIC;
  return t;
}

async function summary(hostport, since) {
  const r = await rpc(hostport, 'get_transfers', { in: true, pending: false, pool: false, out: false, failed: false });
  if (!r.ok) return { state: r.error === 'offline' ? 'offline' : r.error === 'login-required' ? 'login' : /method not found/i.test(r.error) ? 'notwallet' : 'error', error: r.error };
  const list = [].concat(r.result.in || [], r.result.block || []);
  return { state: 'ok', since, ...tally(list, since) };
}

module.exports = { rpc, tally, summary, ATOMIC };
