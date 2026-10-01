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

// A node only counts as synced when ALL of these hold:
//  - it has a height,
//  - it is connected to at least one peer,
//  - it does not report synchronized:false, and
//  - it is within 1 block of the network height.
// target_height is 0 both when the node is at the tip AND right after a
// restart before it has met any peers, so "target 0" alone must never be
// trusted: that is what let mining start on a stale chain before.
function classify(j) {
  const height = Number(j.height) || 0;
  const target = Number(j.target_height) || 0;
  const peers = Number(j.outgoing_connections_count || 0) + Number(j.incoming_connections_count || 0);
  const flagged = j.synchronized === false;
  const atTip = target === 0 || height >= target - 1;
  const synced = height > 0 && peers > 0 && !flagged && atTip;

  // Network hashrate = difficulty / block time. Only reported when the node
  // gives us both numbers, so we never show a guess.
  const difficulty = Number(j.difficulty) || 0;
  const blockTime = Number(j.target) || 0;
  const netHashrate = difficulty > 0 && blockTime > 0 ? difficulty / blockTime : null;

  return {
    state: synced ? 'synced' : 'syncing',
    height,
    target: target || height,
    percent: target > height ? Math.min(100, (height / target) * 100) : (synced ? 100 : 0),
    peers,
    difficulty: difficulty || null,
    netHashrate,
  };
}

module.exports = { getInfo, classify };
