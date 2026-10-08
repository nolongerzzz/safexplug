'use strict';
// Asks the node (safexd) how tall its chain is, to show a Synced chip next to the wallet's own height.
const http = require('http');
function getInfo(hostport, timeout = 4000) {
  return new Promise((resolve) => {
    const m = /^([A-Za-z0-9.\-]+):(\d{2,5})$/.exec(String(hostport)); if (!m) return resolve({ ok: false, error: 'Bad node address' });
    const body = JSON.stringify({ jsonrpc: '2.0', id: '0', method: 'get_info' });
    const req = http.request({ host: m[1], port: Number(m[2]), path: '/json_rpc', method: 'POST', timeout, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      let b = ''; res.on('data', (d) => (b += d));
      res.on('end', () => { try { const r = JSON.parse(b).result || {}; resolve({ ok: true, height: Number(r.height) || 0, target: Number(r.target_height) || 0, synced: r.synchronized !== false && (!r.target_height || r.height >= r.target_height) }); } catch (_) { resolve({ ok: false, error: 'Unreadable reply from the node' }); } });
    });
    req.on('timeout', () => req.destroy()); req.on('error', () => resolve({ ok: false, error: 'Node not reachable' })); req.end(body);
  });
}
module.exports = { getInfo };
