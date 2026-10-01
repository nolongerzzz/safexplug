'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { HashLog } = require('../src/core/hashlog');
let n = 0; const t = (m, f) => { f(); n++; console.log('ok -', m); };
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sxhl-')), 'h.json');
const T = 1_800_000_000;
t('24 h average and mining coverage', () => {
  const h = new HashLog(file);
  for (let i = 0; i < 120; i++) h.add(9000, T + i * 60);            // 2 h at 9 kH/s
  for (let i = 0; i < 60; i++) h.add(6000, T + 3 * 3600 + i * 60);  // 1 h at 6 kH/s (a stop in between)
  const s = h.summary(86400, T + 4 * 3600);
  assert.ok(Math.abs(s.avg - (120 * 9000 + 60 * 6000) / 180) < 1); assert.strictEqual(s.minutes, 180);
});
t('old samples fall out of the window; empty gives null', () => {
  const h = new HashLog(file); assert.strictEqual(h.summary(86400, T + 3 * 86400).avg, null);
  assert.strictEqual(new HashLog(path.join(os.tmpdir(), 'nope-' + Date.now() + '.json')).summary().avg, null);
});
t('samples are throttled to one a minute, zero hashrate ignored, survives a restart', () => {
  const f2 = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sxhl-')), 'h.json'); const h = new HashLog(f2);
  h.add(100, T); h.add(100, T + 10); h.add(0, T + 70); h.add(null, T + 80); h.add(200, T + 70); assert.strictEqual(h.samples.length, 2);
  h.save(); assert.strictEqual(new HashLog(f2).samples.length, 2);
});
t('history older than 8 days is dropped', () => {
  const h = new HashLog(path.join(os.tmpdir(), 'x-' + Date.now())); h.add(1, T); h.add(1, T + 9 * 86400); assert.strictEqual(h.samples.length, 1);
});
t('series buckets the window and leaves gaps as null', () => {
  const h = new HashLog(path.join(os.tmpdir(), 'ser-' + Date.now()));
  h.add(1000, T + 10); h.add(3000, T + 70); h.add(500, T + 3600 + 10);
  const ser = h.series(7200, 3600, T + 7200);   // two 1-hour buckets
  assert.strictEqual(ser.length, 2); assert.strictEqual(ser[0], 2000); assert.strictEqual(ser[1], 500);
  assert.strictEqual(h.series(7200, 3600, T + 7200 * 3)[0], null);
});
console.log(n + ' tests passed');
