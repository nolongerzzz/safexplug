'use strict';
const assert = require('assert');
const http = require('http');
const { Miner, buildArgs, validate } = require('../src/core/miner');
const { getInfo } = require('../src/core/node-status');
const { Settings, DEFAULTS } = require('../src/core/settings');
const fs = require('fs'), os = require('os'), path = require('path');

const ADDR = 'Safex5zwXKhha8jYzrTTraDVR2iam5naw9K23MsrnHW1XHuWvV4TksmcJaeSozLrRe1tMUq58tptbKkkZ7gtxy1jK47xxJ62rpS5L';
let n = 0; const ok = (m) => { n++; console.log('ok -', m); };

(async () => {
  // validation
  assert.strictEqual(validate({ mode: 'pool', address: ADDR, pool: 'pool.safex.org:3311' }), null); ok('valid pool settings accepted');
  assert.strictEqual(validate({ mode: 'solo', address: ADDR, node: '127.0.0.1:17402' }), null); ok('valid solo settings accepted');
  assert.ok(validate({ mode: 'pool', address: 'abc', pool: 'pool.safex.org:3311' })); ok('bad address rejected');
  assert.ok(validate({ mode: 'solo', address: ADDR, node: 'nonsense' })); ok('bad node rejected');
  assert.ok(validate({ mode: 'pool', address: ADDR + ' ; rm -rf /', pool: 'pool.safex.org:3311' })); ok('shell-ish address rejected');

  // args: solo must match the command line that is mining on the rig now
  const solo = buildArgs({ mode: 'solo', address: ADDR, node: '127.0.0.1:17402', cpu: 40, donate: 0 });
  for (const need of ['--daemon', '-o', '127.0.0.1:17402', 'rx/sfx', '--cpu-max-threads-hint', '40', '--donate-level', '0'])
    assert.ok(solo.includes(need), 'missing ' + need);
  assert.ok(!solo.includes('-k')); ok('solo args correct (daemon, no keepalive)');
  const pool = buildArgs({ mode: 'pool', address: ADDR, pool: 'pool.safex.org:3311', cpu: 50, name: '' });
  assert.ok(!pool.includes('--daemon') && pool.includes('-k') && pool.includes('pool.safex.org:3311')); ok('pool args correct');

  // settings persistence + type safety
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sx-'));
  const s = new Settings(dir);
  s.set({ cpu: 75, mode: 'solo', evil: 'x', donate: 'lots' });
  const s2 = new Settings(dir).get();
  assert.strictEqual(s2.cpu, 75); assert.strictEqual(s2.mode, 'solo');
  assert.strictEqual(s2.donate, DEFAULTS.donate); assert.ok(!('evil' in s2)); ok('settings persist, ignore unknown/mistyped keys');

  // node status against a fake daemon
  const srv = http.createServer((req, res) => { res.end(JSON.stringify({ height: 2097365, target_height: 2097364, outgoing_connections_count: 8, incoming_connections_count: 2 })); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const info = await getInfo('127.0.0.1:' + port);
  assert.strictEqual(info.state, 'synced'); assert.strictEqual(info.peers, 10); ok('node status: synced + peers from fake daemon');
  srv.close();
  assert.strictEqual((await getInfo('127.0.0.1:1')).state, 'offline'); ok('node status: offline when nothing listens');

  // real xmrig process: start in solo mode against a dead node, expect logs + connection-error, then stop
  const m = new Miner(); const logs = []; let sawErr = false, exited = false;
  m.on('log', (l) => logs.push(l)); m.on('stats', (st) => { if (st.connected === false) sawErr = sawErr || logs.some((l) => /connect error/.test(l)); });
  m.on('exit', () => { exited = true; });
  const r = m.start({ mode: 'solo', address: ADDR, node: '127.0.0.1:17999', cpu: 25, donate: 0 });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(m.start({ mode: 'solo', address: ADDR, node: '127.0.0.1:17999' }).ok, false); ok('second start refused while running');
  await new Promise((res) => setTimeout(res, 7000));
  assert.ok(logs.some((l) => /^\$ xmrig/.test(l)), 'command echo');
  assert.ok(!logs.some((l) => l.includes(ADDR)), 'full address must not be echoed to the log'); ok('address truncated in command echo');
  assert.ok(logs.some((l) => /connect error|connection refused/i.test(l)), 'expected a connection error line:\n' + logs.slice(-8).join('\n')); ok('real xmrig: connection error surfaced from dead node');
  m.stop();
  await new Promise((res) => setTimeout(res, 1500));
  assert.ok(exited && !m.running); ok('stop() terminates xmrig');
  console.log(`\n${n} checks passed`);
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });

// ---- blocks found in solo mode (counted from accepted results at network difficulty) ----
{
  const { Miner } = require('../src/core/miner');
  const { parseLine } = require('../src/core/parser');
  const feed = (m, lines) => lines.forEach((l) => parseLine(l).forEach((e) => m._apply(e)));
  const mk = (mode) => { const m = new Miner(); m.mode = mode; m.node = '127.0.0.1:17402'; m.nodeDiff = 0; m._emitStats = () => {}; return m; };
  const job = (d) => `[x] net      new job from 127.0.0.1:17402 diff ${d} algo rx/sfx height 2097400`;
  const acc = (a, d) => `[x] cpu      accepted (${a}/0) diff ${d} (61 ms)`;
  const solo = mk('solo');
  feed(solo, [job(27960000), acc(1, 27960000), job(28100000), acc(2, 28100000)]);
  assert.strictEqual(solo.stats.blocks, 2); assert.strictEqual(solo.stats.accepted, 2);
  // donation period: low-difficulty shares for someone else must not count as blocks
  feed(solo, ['[x] net      new job from donate.v2.xmrig.org:3333 diff 120000 algo rx/0 height 5', acc(3, 120000), acc(4, 120000)]);
  assert.strictEqual(solo.stats.blocks, 2); assert.strictEqual(solo.stats.accepted, 4);
  const pool = mk('pool'); feed(pool, [job(120000), acc(1, 120000), acc(2, 120000)]);
  assert.strictEqual(pool.stats.blocks, 0);
  console.log('ok - solo: accepted results at network difficulty count as blocks; donation and pool shares do not');
}
