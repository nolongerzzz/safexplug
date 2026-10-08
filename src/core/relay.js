'use strict';
// Swap relay: a tiny store-and-forward board where two wallets leave each other the short text a swap needs, so nobody
// has to copy and paste. It holds no keys and no funds, and it cannot change a swap: both wallets check everything
// themselves before they sign. Anyone can run one (the wallet runs one for you by default; or: node tools/relay/relay.js).
const http = require('http');
const crypto = require('crypto');

const MAX_BODY = 400000, MAX_SWAPS = 300;
const HEAD = { offer: 'SAFEXSWAP1 PREPARE', reply: 'SAFEXSWAP1 PARTIAL' };
const DIG = /^\d{1,20}$/;
const lineOf = (t, k) => { for (const l of String(t).replace(/\r/g, '').split('\n')) if (l.startsWith(k + ' ')) return l.slice(k.length + 1).trim(); return null; };
const first = (t) => String(t).replace(/\r/g, '').split('\n')[0].trim();
const tok = () => crypto.randomBytes(16).toString('hex');

function createRelay({ openTtlMs = 3600e3, doneTtlMs = 600e3, now = () => Date.now() } = {}) {
  const swaps = new Map();
  const pub = (s) => ({ id: s.id, kind: s.kind, tokens: s.tokens, price: s.price, state: s.state, offer: s.offer || '', reply: s.reply || '', fee: s.fee || '', txid: s.txid || '',
    age: now() - s.created, repliedAgo: s.repliedAt ? now() - s.repliedAt : null });
  const gc = () => {
    const t = now();
    for (const [id, s] of swaps) {
      const dead = ['sent', 'cancelled'].includes(s.state) ? t - s.updated > doneTtlMs : t - s.updated > openTtlMs;
      if (dead) swaps.delete(id);
    }
    while (swaps.size > MAX_SWAPS) swaps.delete(swaps.keys().next().value);
  };
  const touch = (s, state) => { s.state = state; s.updated = now(); };
  const textOk = (t, kind, s) => {
    if (typeof t !== 'string' || t.length > 300000 || first(t) !== HEAD[kind]) return false;
    return lineOf(t, 'qty') === s.tokens && lineOf(t, 'price') === s.price;
  };

  function route(method, url, body) {
    gc();
    const u = new URL(url, 'http://x'); const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] === 'ping') return [200, { ok: true, relay: 'safex-swap-relay/1' }];
    if (parts[0] !== 'swaps') return [404, { error: 'not found' }];
    if (parts.length === 1 && method === 'GET') {
      const all = [...swaps.values()].map(pub).sort((a, b) => b.age - a.age).reverse();
      return [200, { asks: all.filter((s) => s.kind === 'ask' && s.state === 'offered'), bids: all.filter((s) => s.kind === 'bid' && s.state === 'bid') }];
    }
    if (parts.length === 1 && method === 'POST') {
      const { kind, tokens, price, offer } = body || {};
      if (!['ask', 'bid'].includes(kind) || !DIG.test(String(tokens)) || !DIG.test(String(price))) return [400, { error: 'bad swap' }];
      if (BigInt(tokens) <= 0n || BigInt(price) <= 0n) return [400, { error: 'bad amounts' }];
      const s = { id: crypto.randomBytes(5).toString('hex'), kind, tokens: String(tokens), price: String(price), state: kind === 'ask' ? 'offered' : 'bid', created: now(), updated: now(), keys: {} };
      if (kind === 'ask') { if (!textOk(offer, 'offer', s)) return [400, { error: 'offer does not match' }]; s.offer = offer; s.keys.seller = tok(); } else s.keys.buyer = tok();
      swaps.set(s.id, s); return [200, { id: s.id, key: kind === 'ask' ? s.keys.seller : s.keys.buyer }];
    }
    const s = swaps.get(parts[1]); if (!s) return [404, { error: 'That swap is gone (it expired or was cancelled).' }];
    if (parts.length === 2 && method === 'GET') return [200, pub(s)];
    const act = parts[2]; if (method !== 'POST') return [405, { error: 'method' }];
    const b = body || {};
    if (act === 'offer') {   // a seller answers a buyer's request
      if (s.kind !== 'bid' || s.state !== 'bid') return [409, { error: 'Someone else already answered this request.' }];
      if (!textOk(b.offer, 'offer', s)) return [400, { error: 'offer does not match' }];
      s.offer = b.offer; s.keys.seller = tok(); touch(s, 'offered'); return [200, { key: s.keys.seller }];
    }
    if (act === 'reply') {   // the buyer's half-signed side
      if (s.state !== 'offered') return [409, { error: 'Someone else already took this offer.' }];
      if (s.kind === 'bid' && b.key !== s.keys.buyer) return [403, { error: 'not yours' }];
      if (!textOk(b.reply, 'reply', s)) return [400, { error: 'reply does not match' }];
      if (b.fee != null && !DIG.test(String(b.fee))) return [400, { error: 'bad fee' }];
      s.reply = b.reply; s.fee = b.fee == null ? '' : String(b.fee); s.repliedAt = now();
      if (s.kind === 'ask') s.keys.buyer = tok();
      touch(s, 'replied'); return [200, { key: s.keys.buyer }];
    }
    if (act === 'sent') {
      if (s.state !== 'replied' || b.key !== s.keys.seller) return [403, { error: 'not allowed' }];
      if (!/^[0-9a-f]{64}$/.test(String(b.txid))) return [400, { error: 'bad txid' }];
      s.txid = b.txid; touch(s, 'sent'); return [200, { ok: true }];
    }
    if (act === 'cancel') {
      const isSeller = !!b.key && b.key === s.keys.seller, isBuyer = !!b.key && b.key === s.keys.buyer;
      if (!isSeller && !isBuyer) return [403, { error: 'not allowed' }];
      if (['sent', 'cancelled'].includes(s.state)) return [409, { error: 'already finished' }];
      if (s.state === 'replied' && !isSeller) return [403, { error: 'The buyer side cannot be withdrawn once sent.' }];
      touch(s, 'cancelled'); return [200, { ok: true }];
    }
    return [404, { error: 'not found' }];
  }

  const server = http.createServer((req, res) => {
    let b = '', over = false;
    req.on('data', (d) => { b += d; if (b.length > MAX_BODY) { over = true; req.destroy(); } });
    req.on('end', () => {
      if (over) return;
      let body = null; if (b) { try { body = JSON.parse(b); } catch (_) { res.writeHead(400); return res.end('{"error":"bad json"}'); } }
      let out; try { out = route(req.method, req.url, body); } catch (e) { out = [500, { error: 'relay error' }]; }
      res.writeHead(out[0], { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out[1]));
    });
  });
  return {
    server, swaps, route,
    listen: (port, host) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => { server.removeListener('error', reject); resolve(server.address().port); }); }),
    close: () => new Promise((r) => { try { server.close(() => r()); server.closeAllConnections && server.closeAllConnections(); } catch (_) { r(); } }),
  };
}
module.exports = { createRelay };
