'use strict';
// Safex Cash and Safex Token both use 10 decimal places (COIN = SAFEX_TOKEN = 10^10 in safexcore).
// All maths is BigInt so nothing is ever rounded by floating point.
const DECIMALS = 10;
const UNIT = 10n ** BigInt(DECIMALS);

// "12.5" -> 125000000000n. Returns null for anything that is not a plain positive decimal.
function toAtomic(text) {
  const s = String(text == null ? '' : text).trim();
  const m = /^(?:(\d{1,15})(?:\.(\d{1,10}))?|\.(\d{1,10}))$/.exec(s);
  if (!m) return null;
  if (m[3] !== undefined) { m[1] = '0'; m[2] = m[3]; }
  const v = BigInt(m[1]) * UNIT + BigInt((m[2] || '').padEnd(DECIMALS, '0') || '0');
  return v > 0n ? v : null;
}
// 125000000000n (or number/string of digits) -> "12.5"; trims trailing zeros, always shows at least 2 decimals when fractional.
function fmt(atomic, { min = 0 } = {}) {
  let v; try { v = BigInt(atomic == null ? 0 : atomic); } catch (_) { return '0'; }
  const neg = v < 0n; if (neg) v = -v;
  const whole = (v / UNIT).toString(); let frac = (v % UNIT).toString().padStart(DECIMALS, '0').replace(/0+$/, '');
  while (frac.length < min) frac += '0';
  return (neg ? '-' : '') + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac ? '.' + frac : '');
}
// Light sanity check only: the wallet tool does the real validation and the Send screen shows the full address back.
function looksLikeAddress(a) { return /^Safex[1-9A-HJ-NP-Za-km-z]{85,120}$/.test(String(a || '').trim()); }

module.exports = { DECIMALS, UNIT, toAtomic, fmt, looksLikeAddress };
