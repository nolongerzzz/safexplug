'use strict';
const assert = require('assert');
const http = require('http');
const W = require('../src/core/wallet');
let n = 0; const t = async (m, f) => { await f(); n++; console.log('ok -', m); };
const T0 = 1_700_000_000;
const sample = [
  { type: 'block', txid: 'a', amount: 4e10 * 1, timestamp: T0 + 10, confirmations: 80 },
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
  await t('wallet not running -> offline', async () => assert.strictEqual((await W.summary(addr, 0)).state, 'offline'));
  await t('bad address -> error, no crash', async () => assert.strictEqual((await W.summary('nonsense', 0)).state, 'error'));
  console.log(n + ' tests passed');
})();
