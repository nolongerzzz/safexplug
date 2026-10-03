'use strict';
const assert = require('assert'), http = require('http');
const E = require('../src/core/explorer');
let n = 0; const t = async (m, f) => { await f(); n++; console.log('ok -', m); };
const hash = (i) => i.toString(16).padStart(64, '0');
const mkHeader = (h) => ({ height: h, hash: hash(h), prev_hash: hash(h - 1), timestamp: 1_790_000_000 + h * 120, difficulty: 28000000, reward: 400e10, block_size: 1500 + h % 7, num_txes: h % 3, nonce: 12345 + h, depth: 2097600 - h, major_version: 8, orphan_status: false });
const TXH = hash(777), POOLTX = hash(900);
const calls = [];
const srv = http.createServer((q, r) => {
  let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => {
    const body = JSON.parse(b); calls.push([q.url, body.method]);
    if (q.url === '/get_transaction_pool') return r.end(JSON.stringify({ status: 'OK', transactions: [{ id_hash: hash(901), blob_size: 1700, fee: 300000000, receive_time: 1790000050 }, { id_hash: POOLTX, blob_size: 1800, fee: 340000000, receive_time: 1790000100 }, { id_hash: 'junk', blob_size: 1 }] }));
    if (q.url === '/gettransactions' && body.txs_hashes[0] === POOLTX) return r.end(JSON.stringify({ status: 'OK', txs: [{ as_hex: 'cd'.repeat(800), in_pool: true, block_height: 0, as_json: JSON.stringify({ vin: [{ key: { key_offsets: [1, 2, 3, 4, 5, 6, 7] } }], vout: [{ amount: 0 }, { amount: 0 }], rct_signatures: { txnFee: 340000000 } }) }] }));
    if (q.url === '/gettransactions') {
      if (body.txs_hashes[0] !== TXH) return r.end(JSON.stringify({ missed_tx: body.txs_hashes, status: 'OK' }));
      return r.end(JSON.stringify({ status: 'OK', txs: [{ as_hex: 'ab'.repeat(900), block_height: 2097581, in_pool: false,
        as_json: JSON.stringify({ vin: [{ key: { amount: 0, key_offsets: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] } }, { key: { key_offsets: [1, 2] } }], vout: [{ amount: 0 }, { amount: 0, token_amount: 5 }, { amount: 0 }], rct_signatures: { txnFee: 340000000 } }) }] }));
    }
    const m = body.method, p = body.params || {};
    const ok = (result) => r.end(JSON.stringify({ jsonrpc: '2.0', id: '0', result: { status: 'OK', ...result } }));
    if (m === 'get_last_block_header') return ok({ block_header: mkHeader(2097600) });
    if (m === 'get_block_headers_range') { const hs = []; for (let h = p.start_height; h <= p.end_height; h++) hs.push(mkHeader(h)); return ok({ headers: hs }); }
    if (m === 'get_block') {
      const h = p.height !== undefined ? p.height : parseInt(p.hash, 16);
      if (p.hash && h < 1000000) return r.end(JSON.stringify({ jsonrpc: '2.0', id: '0', error: { code: -5, message: "Internal error: can't get block by hash. Hash = " + p.hash + '.' } }));   // real nodes: a transaction hash is not a block hash
      if (h > 2097600) return r.end(JSON.stringify({ jsonrpc: '2.0', id: '0', error: { code: -2, message: 'Requested block height is too big.' } }));
      return ok({ block_header: mkHeader(h), miner_tx_hash: hash(h + 5e6), tx_hashes: [TXH, hash(778)],
        json: JSON.stringify({ miner_tx: { vout: [{ amount: 300e10 }, { amount: 100.34e10 }, { amount: 0, token_amount: 1e10 }] }, tx_hashes: [TXH, hash(778)] }) });
    }
    r.end(JSON.stringify({ jsonrpc: '2.0', id: '0', error: { code: -32601, message: 'Method not found' } }));
  });
}).listen(0, '127.0.0.1');
(async () => {
  await new Promise((r) => srv.on('listening', r));
  const host = '127.0.0.1:' + srv.address().port;
  await t('latest blocks come back newest first with reward in SFX and the tip height', async () => {
    const r = await E.recent(host, 20);
    assert.ok(r.ok); assert.strictEqual(r.tip, 2097600); assert.strictEqual(r.blocks.length, 20);
    assert.strictEqual(r.blocks[0].height, 2097600); assert.strictEqual(r.blocks[19].height, 2097581);
    assert.strictEqual(r.blocks[0].reward, 400); assert.strictEqual(r.blocks[0].hash, hash(2097600));
  });
  await t('paging backwards continues below the oldest block shown', async () => {
    const r = await E.recent(host, 10, 2097581);
    assert.strictEqual(r.blocks[0].height, 2097580); assert.strictEqual(r.blocks.length, 10);
  });
  await t('block by height: header, transactions, coinbase outputs (cash and tokens)', async () => {
    const r = await E.block(host, '2097581');
    assert.ok(r.ok); assert.strictEqual(r.header.height, 2097581); assert.deepStrictEqual(r.txHashes, [TXH, hash(778)]);
    assert.ok(Math.abs(r.coinbase.cash - 400.34) < 1e-9); assert.strictEqual(r.coinbase.outputs, 3); assert.strictEqual(r.coinbase.tokens, 1);
  });
  await t('block by hash uses the hash parameter', async () => {
    const r = await E.block(host, hash(2097500).toUpperCase()); assert.ok(r.ok);
  });
  await t('bad input is refused without asking the node; unknown block gives a friendly message', async () => {
    const before = calls.length;
    assert.ok(!(await E.block(host, 'hello')).ok); assert.ok(!(await E.block(host, '12 34')).ok); assert.ok(!(await E.block(host, 'z'.repeat(64))).ok);
    assert.strictEqual(calls.length, before);
    assert.strictEqual((await E.block(host, '9999999')).error, 'No such block.');
  });
  await t('transaction facts: inputs, outputs, ring size, size, fee, height, token outputs', async () => {
    const r = await E.tx(host, TXH);
    assert.ok(r.ok); assert.strictEqual(r.inputs, 2); assert.strictEqual(r.outputs, 3); assert.strictEqual(r.ringSize, 11);
    assert.strictEqual(r.size, 900); assert.ok(Math.abs(r.fee - 0.034) < 1e-9); assert.strictEqual(r.height, 2097581); assert.strictEqual(r.tokenOutputs, 1);
  });
  await t('a mined transaction reports its block and how many confirmations it has', async () => {
    const r = await E.tx(host, TXH); assert.strictEqual(r.height, 2097581); assert.strictEqual(r.confirmations, 20); assert.strictEqual(r.inPool, false);
  });
  await t('a transaction still in the pool has no block and no confirmations', async () => {
    const r = await E.tx(host, POOLTX); assert.ok(r.ok); assert.strictEqual(r.inPool, true); assert.strictEqual(r.height, null); assert.strictEqual(r.confirmations, null); assert.strictEqual(r.ringSize, 7);
  });
  await t('pool list: newest first, junk ids dropped, fee in SFX', async () => {
    const r = await E.pool(host); assert.ok(r.ok); assert.deepStrictEqual(r.txs.map((x) => x.hash), [POOLTX, hash(901)]); assert.ok(Math.abs(r.txs[0].fee - 0.034) < 1e-9); assert.strictEqual(r.txs[0].size, 1800);
  });
  await t('missing transaction and junk hash are handled', async () => {
    assert.strictEqual((await E.tx(host, hash(1))).error, 'Transaction not found.'); assert.ok(!(await E.tx(host, 'nope')).ok);
  });
  srv.close();
  await t('node offline -> clean error, no crash', async () => { const r = await E.recent(host, 5); assert.ok(!r.ok); });
  console.log(n + ' tests passed');
})();
