'use strict';
// Remembers when a block was found (solo mining only) so the Rigs chart can mark it.
// In solo mode every accepted result is a block, so a rise in a rig's count = block(s).
const fs = require('fs'), path = require('path');
const KEEP = 30 * 86400;
class BlockLog {
  constructor(file) {
    this.file = file; this.events = []; this.last = new Map();
    try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (Array.isArray(j)) this.events = j.filter((e) => e && e.t > 0 && typeof e.id === 'string'); } catch (_) {}
  }
  // count = that miner's blocks-this-run. Only a RISE since the last look counts; a restart (drop) resets.
  note(id, name, count, solo, now = Math.floor(Date.now() / 1000)) {
    const prev = this.last.get(id); this.last.set(id, count);
    if (!solo || prev === undefined || !(count > prev)) return 0;
    const n = Math.min(5, count - prev);
    for (let i = 0; i < n; i++) this.events.push({ t: now, id, name: String(name).slice(0, 40) });
    const cut = now - KEEP; while (this.events.length && this.events[0].t < cut) this.events.shift();
    this.save(); return n;
  }
  since(from) { return this.events.filter((e) => e.t >= from); }
  save() { try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.events)); } catch (_) {} }
}
module.exports = { BlockLog };
