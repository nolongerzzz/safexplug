'use strict';
const assert = require('assert');
const http = require('http');
const W = require('../src/core/wallet');
let n = 0; const t = async (m, f) => { await f(); n++; console.log('ok -', m); };
const T0 = 1_700_000_000;
const sample = [
  { type: 'block', txid: 'a', amount: 4e10 * 1, timestamp: T0 + 10, confirmations: 80, height: 2097379 },
  { type: 'block', txid: 'b', amount: 4e10, timestamp: T0 + 20, confirmations: 3 },
  { type: 'in', txid: 'c', amount: 25e9, timestamp: T0 + 30, confirmations: 12 },
  { type: 'block', txid: 'old', amount: 9e10, timestamp: T0 - 500, confirmations: 999 },
  { type: 'out', txid: 'o', amount: 1e10, timestamp: T0 + 40 },
  { type: 'in', txid: 'c', amount: 25e9, timestamp: T0 + 30 },
];
(async () => {
  await t('tally counts only payments since mining began, ignores outgoing and duplicates', () => {
    const r = W.tally(sample, T0);
    assert.strictEqual(r.count, 3); assert.strictEqual(r.mined, 2);
    assert.ok(Math.abs(r.sfx - 10.5) < 1e-9); assert.ok(Math.abs(r.minedSfx - 8) < 1e-9);
    assert.strictEqual(r.latest, T0 + 30); assert.strictEqual(r.recent[0].txid, 'c');
  });
  await t('each entry carries its block height', () => { const r = W.tally(sample, T0); assert.strictEqual(r.recent.find((x) => x.txid === 'a').height, 2097379); });
  await t('last 24 hours window sums only recent payments', () => {
    const now = T0 + 86400 + 15;   // 'a' (T0+10) just fell out of the window, 'b' (T0+20) and 'c' (T0+30) are inside
    const r = W.tally(sample, 0, now);
    assert.strictEqual(r.last24.count, 2); assert.ok(Math.abs(r.last24.sfx - (4 + 2.5)) < 1e-9);
    assert.strictEqual(W.tally(sample, 0, T0 + 5 * 86400).last24.count, 0);
  });
  await t('confirmations come from the node height when the wallet reports 0', () => {
    const r = W.withConfirmations([{ height: 2097581, confirmations: 0 }, { height: 2097520, confirmations: 99 }, { confirmations: 0 }], 2097600);
    assert.strictEqual(r[0].confirmations, 20); assert.strictEqual(r[1].confirmations, 99); assert.strictEqual(r[2].confirmations, 0);
    assert.strictEqual(W.withConfirmations([{ height: 5, confirmations: 3 }], 0)[0].confirmations, 3);
  });
  await t('since 0 counts everything incoming', () => assert.strictEqual(W.tally(sample, 0).count, 4));
  await t('empty / junk input is safe', () => { assert.strictEqual(W.tally(null).count, 0); assert.strictEqual(W.tally([null, 5, {}]).count, 0); });
  let calls = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
      const q = JSON.parse(b); calls.push(q);
      if (req.url !== '/json_rpc') { res.statusCode = 404; return res.end(); }
      res.end(JSON.stringify({ jsonrpc: '2.0', id: '0', result: { in: sample.filter((x) => x.type === 'in'), block: sample.filter((x) => x.type === 'block') } }));
    });
  }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  const addr = '127.0.0.1:' + srv.address().port;
  await t('summary talks JSON-RPC to the wallet and tallies', async () => {
    const s = await W.summary(addr, T0);
    assert.strictEqual(s.state, 'ok'); assert.strictEqual(s.count, 3);
    assert.strictEqual(calls[0].method, 'get_transfers'); assert.strictEqual(calls[0].params.in, true); assert.strictEqual(calls[0].params.out, false);
  });
  srv.close();
  await t('pointing at the node (no such method) is recognised as the wrong address', async () => {
    const node = http.createServer((q, r) => { q.resume(); r.end(JSON.stringify({ jsonrpc: '2.0', id: '0', error: { code: -32601, message: 'Method not found' } })); }).listen(0, '127.0.0.1');
    await new Promise((x) => node.on('listening', x));
    assert.strictEqual((await W.summary('127.0.0.1:' + node.address().port, 0)).state, 'notwallet'); node.close();
  });
  await t('wallet not running -> offline', async () => assert.strictEqual((await W.summary(addr, 0)).state, 'offline'));
  await t('bad address -> error, no crash', async () => assert.strictEqual((await W.summary('nonsense', 0)).state, 'error'));
  console.log(n + ' tests passed');
})();
