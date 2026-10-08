'use strict';
// Minimal JSON-RPC client for safex-wallet-rpc (always 127.0.0.1). Amounts come back as numbers or strings of
// atomic units; we keep them as BigInt-safe strings.
const http = require('http');

class RpcError extends Error { constructor(msg, code) { super(msg); this.code = code; } }

function call(port, method, params = {}, { timeout = 30000, host = '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    // Amounts above 2^53 would lose digits as plain JS numbers, so BigInts go out as raw digits.
    const body = JSON.stringify({ jsonrpc: '2.0', id: '0', method, params }, (k, v) => (typeof v === 'bigint' ? `__BIG__${v}` : v)).replace(/"__BIG__(\d+)"/g, '$1');
    const req = http.request({ host, port, path: '/json_rpc', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout }, (res) => {
      let b = ''; res.on('data', (d) => (b += d));
      res.on('end', () => {
        // ...and big integers coming back are quoted first so JSON.parse cannot round them.
        let j; try { j = JSON.parse(b.replace(/([:\[,]\s*)(\d{16,})(?=\s*[,}\]])/g, '$1"$2"')); } catch (_) { return reject(new RpcError('Wallet tool sent an unreadable reply', -1)); }
        if (j.error) return reject(new RpcError(String(j.error.message || 'Wallet tool error'), j.error.code));
        resolve(j.result || {});
      });
    });
    req.on('timeout', () => { req.destroy(new RpcError('Wallet tool did not answer in time', -2)); });
    req.on('error', (e) => reject(e instanceof RpcError ? e : new RpcError(e.code === 'ECONNREFUSED' ? 'Wallet tool is not running' : String(e.message), -3)));
    req.end(body);
  });
}
const s = (x) => String(x == null ? 0 : x);

class Wallet {
  constructor(port) { this.port = port; }
  rpc(m, p, o) { return call(this.port, m, p, o); }
  async balance() {
    const r = await this.rpc('get_balance', { account_index: 0 });
    return { cash: s(r.balance), cashUnlocked: s(r.unlocked_balance), tokens: s(r.token_balance), tokensUnlocked: s(r.unlocked_token_balance),
      staked: s(r.staked_tokens), stakedUnlocked: s(r.unlocked_staked_tokens) };
  }
  async address() { const r = await this.rpc('get_address', { account_index: 0 }); return r.address; }
  async height() { return Number((await this.rpc('get_height')).height) || 0; }
  async refresh() { return this.rpc('refresh', {}, { timeout: 120000 }); }
  // Everything in one list, newest first. type: in | out | pending | pool | failed
  async history() {
    // asks the node about its mempool too, so it is capped: a slow node must not freeze the screen
    const r = await this.rpc('get_transfers', { in: true, out: true, pending: true, pool: true, failed: true }, { timeout: 8000 });
    const rows = [];
    for (const type of ['in', 'out', 'pending', 'pool', 'failed']) for (const x of r[type] || []) {
      rows.push({ type, txid: x.txid, height: x.height || 0, time: x.timestamp || 0, cash: s(x.amount), tokens: s(x.token_amount),
        isToken: !!x.token_transaction, destCash: (x.destinations || []).reduce((t, d) => t + BigInt(String(d && d.amount != null ? d.amount : 0).replace(/\D/g, '') || 0), 0n).toString(), fee: s(x.fee), address: x.address || '', confirmations: x.confirmations || 0 });
    }
    return rows.sort((a, b) => (b.time || 0) - (a.time || 0));
  }
}

// An incoming payment has no fee the receiver can know. The wallet tool reports a wrapped unsigned number for it
// (2^64 minus something), which would print as ~1.8 billion SFX. Only outgoing rows carry a real fee.
const HALF = 1n << 63n;
function feeOf(x) { if (!x || x.type === 'in') return null; try { const v = BigInt(x.fee == null ? 0 : x.fee); return v >= 0n && v < HALF ? v : null; } catch (_) { return null; } }

module.exports = { call, Wallet, RpcError, feeOf };
