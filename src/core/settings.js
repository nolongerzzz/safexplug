'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  mode: 'pool',            // 'pool' | 'solo'
  address: '',
  name: '',
  pool: 'pool.safex.org:3311',
  node: '127.0.0.1:17402',
  cpu: 50,
  donate: 1,               // xmrig's own default is 1%
  autostart: false,        // start mining when the app opens
  requireSynced: true,     // solo: wait for a synced node before mining
};

class Settings {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    this.data = { ...DEFAULTS };
    try { Object.assign(this.data, JSON.parse(fs.readFileSync(this.file, 'utf8'))); } catch (_) {}
  }
  get() { return { ...this.data }; }
  set(patch) {
    const clean = {};
    for (const k of Object.keys(DEFAULTS)) {
      if (k in patch && typeof patch[k] === typeof DEFAULTS[k]) clean[k] = patch[k];
    }
    Object.assign(this.data, clean);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch (_) { /* best effort */ }
    return this.get();
  }
}

module.exports = { Settings, DEFAULTS };
