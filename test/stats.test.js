'use strict';
const assert = require('assert');
const S = require('../src/renderer/stats');
let n = 0; const t = (m, f) => { f(); n++; console.log('ok -', m); };
t('expected block time matches the numbers the user saw (diff 27.96M, 9.28 kH/s)', () => {
  const T = S.expectedBlockSeconds(27960000, 9280);
  assert.ok(Math.abs(T - 3013) < 1); assert.strictEqual(S.fmtDuration(T), '~50 min');
});
t('earlier reading: diff 26.87M at 7.33 kH/s is about an hour', () => {
  const T = S.expectedBlockSeconds(26867605, 7330); assert.ok(T > 3600 && T < 3750); assert.strictEqual(S.fmtDuration(T), '~61 min');
});
t('no hashrate or no difficulty -> null, shown as a dash', () => {
  assert.strictEqual(S.expectedBlockSeconds(0, 1000), null); assert.strictEqual(S.expectedBlockSeconds(1e7, 0), null);
  assert.strictEqual(S.expectedBlockSeconds(1e7, null), null); assert.strictEqual(S.fmtDuration(null), '—');
});
t('chance of a block within the next hour for a ~50 minute average is about 70%', () => {
  const p = S.chanceWithin(3600, 3013); assert.ok(Math.abs(p - 0.697) < 0.005); assert.strictEqual(S.fmtPercent(p), '70%');
});
t('one-day average gives the classic 63% in a day', () => { assert.strictEqual(S.fmtPercent(S.chanceWithin(86400, 86400)), '63%'); });
t('duration formatting across ranges', () => {
  assert.strictEqual(S.fmtDuration(45), '~45 sec'); assert.strictEqual(S.fmtDuration(600), '~10 min');
  assert.strictEqual(S.fmtDuration(3 * 3600), '~3.0 hours'); assert.strictEqual(S.fmtDuration(3 * 86400), '~3.0 days');
  assert.strictEqual(S.fmtDuration(200 * 86400), '~200 days');
});
t('percent edge cases', () => { assert.strictEqual(S.fmtPercent(0.001), '<1%'); assert.strictEqual(S.fmtPercent(0.999), '>99%'); assert.strictEqual(S.fmtPercent(null), '—'); });
console.log(`\n${n} tests passed`);
