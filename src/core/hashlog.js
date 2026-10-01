'use strict';
// Remembers this rig's hashrate (one sample a minute while mining) so the app can
// show a 24-hour average, even across restarts. Samples only exist while mining,
// so the average is "while mining" and the coverage says how long that was.
const fs = require('fs');
const path = require('path');
const KEEP = 8 * 86400;      // seconds of history kept
const STEP = 60;             // one sample a minute

class HashLog {
  constructor(file) {
    this.file = file; this.samples = []; this.dirty = 0;
    try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (Array.isArray(j)) this.samples = j.filter((x) => Array.isArray(x) && x[0] > 0 && x[1] >= 0); } catch (_) {}
  }
  add(hs, now = Math.floor(Date.now() / 1000)) {
    if (!(hs > 0)) return;
    const last = this.samples[this.samples.length - 1];
    if (last && now - last[0] < STEP - 5) return;
    this.samples.push([now, Math.round(hs)]);
    const cut = now - KEEP; while (this.samples.length && this.samples[0][0] < cut) this.samples.shift();
    if (++this.dirty >= 5) this.save();
  }
  save() {
    this.dirty = 0;
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.samples)); } catch (_) {}
  }
  // Average hashrate per bucket across the window (null where nothing was recorded).
  series(windowSec = 86400, bucketSec = 600, now = Math.floor(Date.now() / 1000)) {
    const n = Math.ceil(windowSec / bucketSec), from = now - windowSec;
    const sum = new Array(n).fill(0), cnt = new Array(n).fill(0);
    for (const [t, hs] of this.samples) { if (t < from || t > now) continue; const i = Math.min(n - 1, Math.floor((t - from) / bucketSec)); sum[i] += hs; cnt[i]++; }
    return sum.map((v, i) => (cnt[i] ? v / cnt[i] : null));
  }
  // Average hashrate over the window, and how many minutes of it were mining.
  summary(windowSec = 86400, now = Math.floor(Date.now() / 1000)) {
    const from = now - windowSec; const w = this.samples.filter((x) => x[0] >= from);
    if (!w.length) return { avg: null, minutes: 0, windowMinutes: Math.round(windowSec / 60) };
    return { avg: w.reduce((a, x) => a + x[1], 0) / w.length, minutes: w.length * STEP / 60, windowMinutes: Math.round(windowSec / 60) };
  }
}
module.exports = { HashLog, STEP };
