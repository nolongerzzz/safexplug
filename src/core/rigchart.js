'use strict';
// Builds the Rigs-page hashrate chart: one line per machine plus the combined total.
// After a machine's first sample in the window, a bucket with no data means it was
// not hashing, so it counts as 0 (shows as a dip). Before its first sample: no line.
const RANGES = { '1h': [3600, 60], '6h': [21600, 300], '24h': [86400, 600], '7d': [604800, 3600] };
const MAX_SERIES = 8;

function build(range, entries, now = Math.floor(Date.now() / 1000)) {
  const [win, step] = RANGES[range] || RANGES['24h'];
  const n = Math.ceil(win / step), from = now - win;
  let series = entries.map((e) => {
    const raw = e.log.series(win, step, now); let seen = false;
    const points = raw.map((v) => { if (v != null) { seen = true; return v; } return seen ? 0 : null; });
    return { id: e.id, name: e.name, points, seen };
  }).filter((s) => s.seen);
  if (series.length > MAX_SERIES) {
    series.sort((a, b) => peak(b.points) - peak(a.points));
    const keep = series.slice(0, MAX_SERIES - 1), rest = series.slice(MAX_SERIES - 1);
    keep.push({ id: 'other', name: `Other (${rest.length})`, seen: true, points: sum(rest, n) });
    series = keep;
  }
  const total = series.length ? sum(series, n) : new Array(n).fill(null);
  return { range, from, to: now, step, series: series.map(({ id, name, points }) => ({ id, name, points })), total };
}
const peak = (p) => p.reduce((m, v) => (v > m ? v : m), 0);
function sum(list, n) {
  const out = new Array(n).fill(null);
  for (const s of list) s.points.forEach((v, i) => { if (v != null) out[i] = (out[i] || 0) + v; });
  return out;
}
module.exports = { build, RANGES, MAX_SERIES };
