'use strict';
// Ask a Safex daemon (safexd) how it is doing, over its JSON RPC.
const http = require('http');

function getInfo(hostport, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const [host, port] = String(hostport).split(':');
    const req = http.get(
      { host, port: Number(port) || 17402, path: '/get_info', timeout: timeoutMs },
      (res) => {
        let body = '';
        res.on('data', (d) => (body += d));
        res.on('end', () => {
          try {
            const j = JSON.parse(body);
            resolve(classify(j));
          } catch (e) {
            resolve({ state: 'error', error: 'bad response' });
          }
        });
      }
    );
    req.on('timeout', () => { req.destroy(); resolve({ state: 'offline' }); });
    req.on('error', () => resolve({ state: 'offline' }));
  });
}

// synced = we have a height and are within 1 block of the network target.
// target_height is 0 when the daemon believes it is already at the tip.
function classify(j) {
  const height = Number(j.height) || 0;
  const target = Number(j.target_height) || 0;
  const synced = height > 0 && (target === 0 || height >= target - 1);
  return {
    state: synced ? 'synced' : 'syncing',
    height,
    target: target || height,
    percent: target > height ? Math.min(100, (height / target) * 100) : 100,
    peers: Number(j.outgoing_connections_count || 0) + Number(j.incoming_connections_count || 0),
  };
}

module.exports = { getInfo, classify };
