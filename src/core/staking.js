'use strict';
// Read-only staking status. Staking rewards are paid in SFX out of marketplace fees, per 1000-block interval. This asks
// the user's own node what each interval paid (/get_interest_map) so the screen can say plainly whether staking pays
// anything right now. It never stakes, unstakes or sends anything.
const http = require('http');
const INTERVAL = 1000;

function analyze(list, tip) {
  const cur = Math.floor(tip / INTERVAL);
  const rows = (Array.isArray(list) ? list : []).map((x) => ({ interval: Number(x.interval), v: BigInt(String(x.cash_per_token == null ? 0 : x.cash_per_token)) })).filter((x) => Number.isFinite(x.interval));
  const paid = rows.filter((x) => x.v > 0n).sort((a, b) => a.interval - b.interval);
  const recent = rows.filter((x) => x.interval > cur - 10 && x.interval <= cur);
  const last = paid.length ? paid[paid.length - 1] : null;
  return { current: cur, intervals: rows.length, recentPaying: recent.some((x) => x.v > 0n), recentChecked: recent.length, lastPaidInterval: last ? last.interval : null, lastPaidValue: last ? String(last.v) : null,
    lastPaidBlocksAgo: last ? Math.max(0, tip - (last.interval * INTERVAL + INTERVAL - 1)) : null, paidIntervals: paid.length };
}

function load(hostport, tip, timeout = 60000) {
  return new Promise((resolve) => {
    const m = /^([A-Za-z0-9.\-]+):(\d{2,5})$/.exec(String(hostport)); if (!m) return resolve({ ok: false, error: 'Bad node address' });
    if (!tip) return resolve({ ok: false, error: 'The node did not report its height.' });
    const body = JSON.stringify({ begin_interval: 0, end_interval: Math.floor(tip / INTERVAL) });
    const req = http.request({ host: m[1], port: Number(m[2]), path: '/get_interest_map', method: 'POST', timeout, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      const parts = []; res.on('data', (d) => parts.push(d));
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve({ ok: false, error: `The node answered ${res.statusCode}. It may not allow this query.` });
        try {
          let s = Buffer.concat(parts).toString('utf8').replace(/([:\[,]\s*)(\d{16,})(?=\s*[,}\]])/g, '$1"$2"');
          const j = JSON.parse(s); resolve({ ok: true, ...analyze(j.interest_per_interval, tip) });
        } catch (e) { resolve({ ok: false, error: 'Could not read the node\'s staking data.' }); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'The node took too long to answer.' }); });
    req.on('error', () => resolve({ ok: false, error: 'Node not reachable' })); req.end(body);
  });
}

// ---- amounts for the stake / unstake commands (tokens use 10 decimals like SFX) ----
const U = 10n ** 10n;
const MIN_STAKE = 25000n * U;   // from the safexcore source; the wallet tool enforces its own rule too
function parseAmount(t) {
  const m = /^(\d{1,12})(?:\.(\d{1,10}))?$/.exec(String(t == null ? '' : t).trim()); if (!m) return null;
  const v = BigInt(m[1]) * U + BigInt((m[2] || '').padEnd(10, '0') || '0'); return v > 0n ? v : null;
}
function plain(v) { const w = (v / U).toString(), f = (v % U).toString().padStart(10, '0').replace(/0+$/, ''); return f ? `${w}.${f}` : w; }
function checkStake(amount, unlockedTokens) {
  if (amount == null) return 'Enter how many SFT to stake, for example 25000.';
  if (amount < MIN_STAKE) return 'The minimum stake is 25,000 SFT.';
  if (amount % U !== 0n) return 'Tokens only move in whole units. Enter a whole number of SFT.';
  if (amount > unlockedTokens) return 'You only have ' + plain(unlockedTokens) + ' SFT unlocked and available to stake.';
  return null;
}
function checkUnstake(amount, staked, height) {
  if (amount == null) return 'Enter how many staked SFT to unstake.';
  if (amount > staked) return 'You only have ' + plain(staked) + ' SFT staked.';
  if (amount % U !== 0n) return 'Tokens only move in whole units. Enter a whole number of SFT.';
  if (height != null && height !== '' && !/^\d{1,9}$/.test(String(height).trim())) return 'The staked-at block must be a whole number, or left empty.';
  return null;
}
// Find the available-interest figure in whatever the wallet service returns (shape not verified): the first field
// with "interest" in its name holding plain digits.
function interestOf(r) {
  if (!r || typeof r !== 'object') return null;
  for (const k of Object.keys(r)) if (/interest/i.test(k) && /^\d+$/.test(String(r[k]))) return String(r[k]);
  return null;
}
module.exports = { analyze, load, INTERVAL, MIN_STAKE, parseAmount, plain, checkStake, checkUnstake, interestOf };
