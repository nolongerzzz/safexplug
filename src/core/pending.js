'use strict';
// After a send, the wallet tool counts the coins it just spent as gone but the leftover (the "change", which comes
// back to you) is locked for 10 confirmations, so its total can dip, even to zero, for about 20 minutes. This keeps a
// plain-arithmetic estimate of what the wallet will own once the change returns:  total before - amount sent - fee.
// It is only ever an estimate shown next to the tool's real numbers, and it clears itself as soon as the tool catches up.
const HOUR = 3600 * 1000;
const big = (x) => { try { return BigInt(x == null ? 0 : x); } catch (_) { return 0n; } };

function start(before, { kind, amount, fee, tokenAmount }, now = Date.now()) {
  const cash = big(before.cash) - (kind === 'cash' ? big(amount) : 0n) - big(fee);
  const tokens = big(before.tokens) - (kind === 'token' ? big(amount) : 0n) - big(tokenAmount);   // tokenAmount: the SFT part of a combined send
  return { cash: cash < 0n ? 0n : cash, tokens: tokens < 0n ? 0n : tokens, at: now };
}
// tool = { cash, tokens } as reported by the wallet tool. Returns what to show and the pending state to keep (null = done).
// The tool may still report the OLD totals for a moment right after a send, so the estimate is only dropped after it has
// first dipped below the estimate and then recovered; if it never dips, it is dropped after a short grace period.
const GRACE = 3 * 60 * 1000;
function apply(p, tool, now = Date.now()) {
  const plain = { cash: { shown: big(tool.cash), estimated: false }, tokens: { shown: big(tool.tokens), estimated: false }, pending: null };
  if (!p) return plain;
  const cEst = big(tool.cash) < p.cash, tEst = big(tool.tokens) < p.tokens;
  const dipped = !!p.dipped || cEst || tEst, age = now - p.at;
  if (age >= HOUR || (!dipped && age >= GRACE) || (dipped && !cEst && !tEst)) return plain;
  return { cash: cEst ? { shown: p.cash, estimated: true } : { shown: big(tool.cash), estimated: false },
    tokens: tEst ? { shown: p.tokens, estimated: true } : { shown: big(tool.tokens), estimated: false }, pending: { ...p, dipped } };
}
module.exports = { start, apply, HOUR, GRACE };
