'use strict';
// Pure helpers shared by the page and the tests (no DOM, no Node-only APIs).
(function (root) {
  // Average seconds for a miner with `hashrate` H/s to find a block at `difficulty`.
  function expectedBlockSeconds(difficulty, hashrate) {
    if (!(difficulty > 0) || !(hashrate > 0)) return null;
    return difficulty / hashrate;
  }
  // Chance of at least one block within `windowSec`, given an average of T seconds
  // per block (blocks arrive randomly, so this is 1 - e^(-t/T)).
  function chanceWithin(windowSec, T) {
    if (!(T > 0)) return null;
    return 1 - Math.exp(-windowSec / T);
  }
  function fmtDuration(sec) {
    if (sec === null || sec === undefined || !Number.isFinite(sec)) return '—';
    if (sec < 90) return `~${Math.max(1, Math.round(sec))} sec`;
    if (sec < 5400) return `~${Math.round(sec / 60)} min`;
    if (sec < 48 * 3600) return `~${(sec / 3600).toFixed(1)} hours`;
    if (sec < 90 * 86400) return `~${(sec / 86400).toFixed(1)} days`;
    return `~${Math.round(sec / 86400)} days`;
  }
  function fmtPercent(p) {
    if (p === null || p === undefined) return '—';
    if (p < 0.01) return '<1%';
    if (p > 0.99) return '>99%';
    return Math.round(p * 100) + '%';
  }
  const api = { expectedBlockSeconds, chanceWithin, fmtDuration, fmtPercent };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SafexStats = api;
})(typeof window !== 'undefined' ? window : globalThis);
