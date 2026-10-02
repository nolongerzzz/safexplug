'use strict';
// Rigs report to the main computer, the same direction pool workers report to a pool.
//   Collector (main computer): listens for small JSON reports, announces itself on the LAN.
//   Reporter  (every other rig): finds the collector (or uses a typed address) and sends its stats.
// Reports are display-only numbers. Nothing a report says can start, stop or change anything.
const http = require('http');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');

const REPORT_PORT = Number(process.env.SAFEX_REPORT_PORT) || 18090;
const DISCOVER_PORT = Number(process.env.SAFEX_DISCOVER_PORT) || 18091;
const MAGIC = 'SAFEX-COLLECTOR';
const MAX_RIGS = 50;
const ONLINE_MS = 20000;

const num = (v, max = 1e12) => (typeof v === 'number' && isFinite(v) && v >= 0 && v <= max ? v : 0);
const str = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').slice(0, n);

// Turn untrusted JSON into a clean record, or null.
function clean(j) {
  if (!j || typeof j !== 'object') return null;
  const id = str(j.id, 64);
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return null;
  return { id, name: str(j.name, 40) || 'Rig', hashrate: num(j.hashrate, 1e9), threads: Math.round(num(j.threads, 4096)),
    accepted: Math.round(num(j.accepted)), rejected: Math.round(num(j.rejected)), uptime: Math.round(num(j.uptime, 1e9)),
    mining: j.mining === true, connected: j.connected === true, wallet: str(j.wallet, 120), version: str(j.version, 20) };
}

class Collector {
  constructor(dir, getSelf) { this.getSelf = getSelf || null; this.file = path.join(dir, 'reported-rigs.json'); this.rigs = new Map(); this.server = null; this.sock = null; this.timer = null;
    try { for (const r of JSON.parse(fs.readFileSync(this.file, 'utf8'))) if (clean(r)) this.rigs.set(r.id, { ...clean(r), seen: Number(r.seen) || 0, ip: str(r.ip, 45) }); } catch (_) {} }
  save() { try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify([...this.rigs.values()])); } catch (_) {} }
  accept(j, ip) {
    const r = clean(j); if (!r) return false;
    if (!this.rigs.has(r.id) && this.rigs.size >= MAX_RIGS) return false;
    this.rigs.set(r.id, { ...r, seen: Date.now(), ip: str(ip, 45) }); this.save(); return true;
  }
  forget(id) { const had = this.rigs.delete(String(id)); if (had) this.save(); return had; }
  list(now = Date.now()) { return [...this.rigs.values()].map((r) => ({ ...r, online: now - r.seen < ONLINE_MS })); }
  start() {
    if (this.server) return;
    this.server = http.createServer((q, res) => {
      if (q.method !== 'POST' || q.url !== '/report') { res.statusCode = 404; return res.end(); }
      let b = ''; q.on('data', (d) => { b += d; if (b.length > 4096) { res.statusCode = 413; res.end(); q.destroy(); } });
      q.on('end', () => { let ok = false; try { ok = this.accept(JSON.parse(b), (q.socket.remoteAddress || '').replace(/^::ffff:/, '')); } catch (_) {} if (!ok) { res.statusCode = 400; return res.end(); }
        // Answer with the whole list so a reporting computer can show the same dashboard.
        const id0 = (() => { try { return clean(JSON.parse(b)).id; } catch (_) { return ''; } })();
        let list = this.list().filter((r) => r.id !== id0).map((r) => ({ ...r, ip: undefined }));
        try { const me = this.getSelf && clean(this.getSelf()); if (me && me.id !== id0) list.unshift({ ...me, online: true, main: true }); } catch (_) {}
        res.statusCode = 200; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ rigs: list.slice(0, MAX_RIGS) })); });
    });
    this.server.on('error', () => {}); this.server.listen(REPORT_PORT, '0.0.0.0');
    this.sock = dgram.createSocket('udp4'); this.sock.on('error', () => {});
    this.sock.bind(0, () => { try { this.sock.setBroadcast(true); } catch (_) {} });
    const announce = () => { try { this.sock.send(Buffer.from(`${MAGIC} ${REPORT_PORT}`), DISCOVER_PORT, process.env.SAFEX_DISCOVER_HOST || '255.255.255.255', () => {}); } catch (_) {} };
    announce(); this.timer = setInterval(announce, 5000);
  }
  stop() { clearInterval(this.timer); this.timer = null; try { this.server && this.server.close(); } catch (_) {} try { this.sock && this.sock.close(); } catch (_) {} this.server = null; this.sock = null; }
}

class Reporter {
  // getTarget() -> "host:port" typed by the user or ''; getPayload() -> report object
  constructor(getTarget, getPayload) { this.getTarget = getTarget; this.getPayload = getPayload; this.found = null; this.sock = null; this.timer = null; this.last = { ok: false, at: 0 }; this.peers = []; }
  target() {
    const t = String(this.getTarget() || '').trim(); const m = /^([A-Za-z0-9.\-]+):(\d{1,5})$/.exec(t);
    if (m) return { host: m[1], port: Number(m[2]), how: 'typed' };
    return this.found && Date.now() - this.found.at < 30000 ? { ...this.found, how: 'found' } : null;
  }
  start() {
    if (this.timer) return;
    try {
      this.sock = dgram.createSocket({ type: 'udp4', reuseAddr: true }); this.sock.on('error', () => {});
      this.sock.on('message', (msg, rinfo) => { const m = new RegExp(`^${MAGIC} (\\d{1,5})$`).exec(String(msg)); if (m) this.found = { host: rinfo.address, port: Number(m[1]), at: Date.now() }; });
      this.sock.bind(DISCOVER_PORT);
    } catch (_) {}
    this.timer = setInterval(() => this.send(), 5000); this.send();
  }
  stop() { clearInterval(this.timer); this.timer = null; try { this.sock && this.sock.close(); } catch (_) {} this.sock = null; }
  send() {
    const t = this.target(); if (!t) { this.peers = []; this.last = { ok: false, at: Date.now(), why: 'no collector found' }; return Promise.resolve(false); }
    const body = JSON.stringify(this.getPayload());
    return new Promise((resolve) => {
      const req = http.request({ host: t.host, port: t.port, path: '/report', method: 'POST', timeout: 3000, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => { let rb = ''; res.on('data', (d) => { if (rb.length < 65536) rb += d; }); res.on('end', () => { try { const j = JSON.parse(rb); this.peers = (Array.isArray(j.rigs) ? j.rigs : []).map((r) => ({ ...clean(r), online: !!r.online, main: !!r.main })).filter((r) => r.id); } catch (_) {} });
        this.last = { ok: res.statusCode === 204 || res.statusCode === 200, at: Date.now(), to: `${t.host}:${t.port}`, how: t.how }; resolve(this.last.ok); });
      req.on('timeout', () => req.destroy()); req.on('error', () => { this.peers = []; this.last = { ok: false, at: Date.now(), why: 'collector not answering' }; resolve(false); });
      req.end(body);
    });
  }
}

module.exports = { Collector, Reporter, clean, REPORT_PORT, DISCOVER_PORT, ONLINE_MS };
