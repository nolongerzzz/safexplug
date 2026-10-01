'use strict';
const assert = require('assert');
const { parseLine, LineSplitter, formatHs } = require('../src/core/parser');
const { classify } = require('../src/core/node-status');
const fs = require('fs');

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };
const one = (l) => parseLine(l)[0];

// Lines below are real xmrig 6.16.2 output captured on this build.
t('speed with n/a values', () => {
  const e = one('[2026-10-01 05:51:36.919]  miner    speed 10s/60s/15m n/a n/a n/a H/s max n/a H/s');
  assert.deepStrictEqual(e, { type: 'hashrate', h10: null, h60: null, h15m: null, max: null });
});
t('speed with real numbers', () => {
  const e = one('[2026-10-01 05:51:45.931]  miner    speed 10s/60s/15m 713.7 n/a n/a H/s max 715.7 H/s');
  assert.strictEqual(e.type, 'hashrate');
  assert.strictEqual(e.h10, 713.7);
  assert.strictEqual(e.h60, null);
  assert.strictEqual(e.max, 715.7);
});
t('speed in kH/s converts to H/s', () => {
  const e = one('miner    speed 10s/60s/15m 6.32 6.30 6.10 kH/s max 6.40 kH/s');
  assert.strictEqual(e.h10, 6320);
  assert.strictEqual(e.h15m, 6100);
});
t('ansi colour codes are stripped', () => {
  const e = one('\x1b[1;30m[x]\x1b[0m \x1b[1;36mminer\x1b[0m   speed 10s/60s/15m 100.0 n/a n/a H/s');
  assert.strictEqual(e.h10, 100);
});
t('msr failure flagged', () => {
  assert.deepStrictEqual(one('msr      FAILED TO APPLY MSR MOD, HASHRATE WILL BE LOW'), { type: 'msr', ok: false });
});
t('huge pages percent', () => {
  const e = parseLine('randomx  allocated 2336 MB (2080+256) huge pages 100% 1168/1168 +JIT (949 ms)');
  assert.deepStrictEqual(e, [{ type: 'hugepages', percent: 100 }]);
});
t('threads profile', () => {
  const e = one('cpu      use profile  rx  (2 threads) scratchpad 2048 KB');
  assert.deepStrictEqual(e, { type: 'threads', profile: 'rx', threads: 2 });
});
t('share accepted', () => {
  assert.deepStrictEqual(one('cpu      accepted (12/1) diff 120000 (81 ms)'), { type: 'shares', accepted: 12, rejected: 1 });
});
t('new job with height', () => {
  const e = one('net      new job from 127.0.0.1:17402 diff 9001 algo rx/sfx height 2097366');
  assert.deepStrictEqual(e, { type: 'job', from: '127.0.0.1:17402', algo: 'rx/sfx', height: 2097366 });
});
t('block found', () => {
  assert.strictEqual(one('net      BLOCK FOUND at height 2097400').type, 'block-found');
});
t('connection refused', () => {
  assert.strictEqual(one('[x]  net      127.0.0.1:1 connect error: "connection refused"').type, 'connection-error');
});
t('plain benchmark/blank lines produce nothing', () => {
  assert.deepStrictEqual(parseLine(''), []);
  assert.deepStrictEqual(parseLine(' * CUDA         disabled'), []);
});
t('LineSplitter handles split chunks and CRLF', () => {
  const out = []; const s = new LineSplitter((l) => out.push(l));
  s.push('abc\r\nde'); s.push('f\nghi'); s.flush();
  assert.deepStrictEqual(out, ['abc', 'def', 'ghi']);
});
t('every real captured line parses without throwing', () => {
  const f = process.env.REAL_LOG;
  if (!f || !fs.existsSync(f)) return;
  fs.readFileSync(f, 'utf8').split('\n').forEach((l) => parseLine(l));
});
t('formatHs', () => {
  assert.strictEqual(formatHs(6320), '6.32 kH/s');
  assert.strictEqual(formatHs(null), '—');
  assert.strictEqual(formatHs(713.74), '713.7 H/s');
});
t('node classify: synced at target-1 / target', () => {
  assert.strictEqual(classify({ height: 2097365, target_height: 2097364, outgoing_connections_count: 8 }).state, 'synced');
  assert.strictEqual(classify({ height: 2097364, target_height: 2097365, outgoing_connections_count: 8 }).state, 'synced');
});
t('node classify: syncing and target 0', () => {
  const s = classify({ height: 1000, target_height: 2000, outgoing_connections_count: 5 });
  assert.strictEqual(s.state, 'syncing'); assert.strictEqual(s.percent, 50);
  assert.strictEqual(classify({ height: 5, target_height: 0, outgoing_connections_count: 3 }).state, 'synced');
  assert.strictEqual(classify({ height: 0, target_height: 0, outgoing_connections_count: 3 }).state, 'syncing');
  // regression: a freshly restarted node reports target 0 and no peers; that is NOT synced
  assert.strictEqual(classify({ height: 2097300, target_height: 0 }).state, 'syncing');
  assert.strictEqual(classify({ height: 2097300, target_height: 0, synchronized: false, outgoing_connections_count: 4 }).state, 'syncing');
  assert.strictEqual(classify({ height: 10, difficulty: 120000000, target: 60, outgoing_connections_count: 1 }).netHashrate, 2000000);
  assert.strictEqual(classify({ height: 10, difficulty: 120000000, outgoing_connections_count: 1 }).netHashrate, null);
});
console.log(`\n${n} tests passed`);
