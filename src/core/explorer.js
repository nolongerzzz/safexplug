'use strict';
// A light block explorer: reads blocks and transactions straight from a Safex
// node over its standard RPC. No database, no indexing, nothing stored.
const http = require('http');

// generic JSON-RPC over http POST /json_rpc
function rpc(hostport, method, params = {}, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const m = /^([A-Za-z0-9.\-]+):(\d{1,5})$/.exec(String(hostport || '').trim());
    if (!m) return resolve({ ok: false, error: 'bad address' });
    const body = JSON.stringify({ jsonrpc: '2.0', id: '0', method, params });
    const req = http.request({ host: m[1], port: Number(m[2]), path: '/json_rpc', method: 'POST', timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      let out = ''; res.on('data', (d) => { out += d; if (out.length > 20e6) req.destroy(); });
      res.on('end', () => { try { const j = JSON.parse(out); if (j.error) return resolve({ ok: false, error: String(j.error.message || 'node error') }); resolve({ ok: true, result: j.result || {} }); } catch (_) { resolve({ ok: false, error: 'bad response' }); } });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'offline' }); });
    req.on('error', () => resolve({ ok: false, error: 'offline' }));
    req.end(body);
  });
}

const ATOMIC = 1e10;
const HEX64 = /^[0-9a-f]{64}$/i;

const header = (h) => !h ? null : ({
  height: Number(h.height), hash: String(h.hash || ''), prev: String(h.prev_hash || ''), time: Number(h.timestamp) || 0,
  difficulty: Number(h.difficulty) || 0, reward: (Number(h.reward) || 0) / ATOMIC, size: Number(h.block_size) || 0,
  txs: Number(h.num_txes) || 0, nonce: h.nonce !== undefined ? Number(h.nonce) : null, depth: h.depth !== undefined ? Number(h.depth) : null,
  version: h.major_version !== undefined ? Number(h.major_version) : null, orphan: !!h.orphan_status,
});

async function tipHeight(host) {
  const r = await rpc(host, 'get_last_block_header');
  if (!r.ok || !r.result.block_header) return { ok: false, error: r.error || 'no header' };
  return { ok: true, height: Number(r.result.block_header.height) };
}

// Newest blocks first. `before` pages backwards from a height.
async function recent(host, count = 20, before = null) {
  const tip = await tipHeight(host); if (!tip.ok) return { ok: false, error: tip.error };
  const end = before != null ? Math.min(tip.height, Number(before) - 1) : tip.height;
  const start = Math.max(0, end - Math.max(1, Math.min(60, count)) + 1);
  const r = await rpc(host, 'get_block_headers_range', { start_height: start, end_height: end });
  if (!r.ok) return { ok: false, error: r.error };
  const blocks = (r.result.headers || []).map(header).filter(Boolean).sort((a, b) => b.height - a.height);
  return { ok: true, tip: tip.height, blocks };
}

// Pull the transaction hash list and the coinbase outputs out of get_block's `json`.
function parseBlockJson(js) {
  let j; try { j = typeof js === 'string' ? JSON.parse(js) : js; } catch (_) { return {}; }
  if (!j) return {};
  const outs = (j.miner_tx && j.miner_tx.vout) || [];
  const cash = outs.reduce((a, o) => a + (Number(o.amount) || 0), 0) / ATOMIC;
  const tokens = outs.reduce((a, o) => a + (Number(o.token_amount) || 0), 0) / ATOMIC;
  return { txHashes: Array.isArray(j.tx_hashes) ? j.tx_hashes : null, minerOutputs: outs.length, minerCash: cash, minerTokens: tokens };
}

async function block(host, query) {
  const q = String(query == null ? '' : query).trim();
  let params;
  if (/^\d{1,9}$/.test(q)) params = { height: Number(q) };
  else if (HEX64.test(q)) params = { hash: q.toLowerCase() };
  else return { ok: false, error: 'Enter a block number or a 64-character block hash.' };
  const r = await rpc(host, 'get_block', params);
  if (!r.ok) return { ok: false, error: /too big|invalid|not found|wrong|can'?t get block/i.test(r.error) ? 'No such block.' : r.error };
  const res = r.result; const h = header(res.block_header); if (!h) return { ok: false, error: 'No such block.' };
  const p = parseBlockJson(res.json);
  return { ok: true, header: h, minerTx: res.miner_tx_hash || '', txHashes: p.txHashes || res.tx_hashes || [], coinbase: { outputs: p.minerOutputs ?? null, cash: p.minerCash ?? null, tokens: p.minerTokens ?? null } };
}

function post(host, pathName, body, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const m = /^([A-Za-z0-9.\-]+):(\d{1,5})$/.exec(String(host || '').trim()); if (!m) return resolve({ ok: false, error: 'bad address' });
    const data = JSON.stringify(body);
    const req = http.request({ host: m[1], port: Number(m[2]), path: pathName, method: 'POST', timeout: timeoutMs,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      let out = ''; res.on('data', (d) => { out += d; if (out.length > 10e6) req.destroy(); });
      res.on('end', () => { try { resolve({ ok: true, json: JSON.parse(out) }); } catch (_) { resolve({ ok: false, error: 'bad response' }); } });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'offline' }); });
    req.on('error', () => resolve({ ok: false, error: 'offline' }));
    req.end(data);
  });
}

// Basic facts about one transaction (sizes and counts; no amounts are guessed at).
async function tx(host, hash) {
  const h = String(hash || '').trim().toLowerCase();
  if (!HEX64.test(h)) return { ok: false, error: 'Not a transaction hash.' };
  const r = await post(host, '/gettransactions', { txs_hashes: [h], decode_as_json: true });
  if (!r.ok) return { ok: false, error: r.error };
  const t = (r.json.txs && r.json.txs[0]) || null;
  const raw = t ? t.as_json : (r.json.txs_as_json && r.json.txs_as_json[0]);
  if (!raw) return { ok: false, error: 'Transaction not found.' };
  let j; try { j = JSON.parse(raw); } catch (_) { return { ok: false, error: 'Could not read the transaction.' }; }
  const vin = Array.isArray(j.vin) ? j.vin : [], vout = Array.isArray(j.vout) ? j.vout : [];
  const first = vin[0] && vin[0].key;
  const hex = (t && t.as_hex) || (r.json.txs_as_hex && r.json.txs_as_hex[0]) || '';
  const height = t && t.block_height != null && !t.in_pool ? Number(t.block_height) : null;
  let confirmations = null;
  if (height != null) { const tip = await tipHeight(host); if (tip.ok) confirmations = Math.max(0, tip.height - height + 1); }
  const fee = j.rct_signatures && j.rct_signatures.txnFee !== undefined ? Number(j.rct_signatures.txnFee) / ATOMIC : null;
  return { ok: true, hash: h, inputs: vin.length, outputs: vout.length, ringSize: first && Array.isArray(first.key_offsets) ? first.key_offsets.length : null,
    size: hex ? hex.length / 2 : null, fee, height, confirmations, inPool: !!(t && t.in_pool),
    tokenOutputs: vout.filter((o) => Number(o.token_amount) > 0).length };
}

// Transactions the node has accepted but no block has included yet (newest first).
async function pool(host) {
  const r = await post(host, '/get_transaction_pool', {});
  if (!r.ok) return { ok: false, error: r.error };
  const list = Array.isArray(r.json.transactions) ? r.json.transactions : [];
  const txs = list.filter((x) => x && HEX64.test(String(x.id_hash || ''))).map((x) => ({ hash: String(x.id_hash).toLowerCase(), size: Number(x.blob_size) || 0,
    fee: (Number(x.fee) || 0) / ATOMIC, time: Number(x.receive_time) || 0 })).sort((a, b) => b.time - a.time).slice(0, 50);
  return { ok: true, txs };
}

module.exports = { recent, block, tx, pool, parseBlockJson, header, tipHeight };
