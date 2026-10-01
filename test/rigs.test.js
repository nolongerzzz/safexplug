'use strict';
const assert = require('assert');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const { fetchRig, pollAll, combine, parseSummary } = require('../src/core/rigs');
const { buildArgs } = require('../src/core/miner');
const XMRIG = path.join(__dirname, '..', 'src', 'resources', 'linux', 'xmrig');
let n = 0; const ok = (m) => { n++; console.log('ok -', m); };
const ADDR = 'Safex5zwXKhha8jYzrTTraDVR2iam5naw9K23MsrnHW1XHuWvV4TksmcJaeSozLrRe1tMUq58tptbKkkZ7gtxy1jK47xxJ62rpS5L';

// a fake rig that behaves like xmrig's API (token enforced)
function fakeRig(port, token, hashrate, wallet) {
  return new Promise((res) => {
    const srv = http.createServer((q, r) => {
      if (q.headers.authorization !== 'Bearer ' + token) { r.statusCode = 401; return r.end('{}'); }
      r.setHeader('Content-Type', 'application/json');
      if (q.url === '/2/summary') return r.end(JSON.stringify({ worker_id: 'fake', uptime: 7200, version: '6.26.0', algo: 'rx/sfx',
        hashrate: { total: [hashrate, hashrate - 10, null] }, results: { shares_good: 8, shares_total: 10 },
        connection: { pool: '127.0.0.1:17402' }, cpu: { brand: 'Fake CPU' } }));
      if (q.url === '/2/backends') return r.end(JSON.stringify([{ type: 'cpu', enabled: true, threads: [{}, {}, {}, {}] }]));
      if (q.url === '/1/config') return r.end(JSON.stringify({ pools: [{ user: wallet }] }));
      r.statusCode = 404; r.end('{}');
    }).listen(port, '127.0.0.1', () => res(srv));
  });
}

(async () => {
  // args
  const a = buildArgs({ mode: 'solo', address: ADDR, node: '127.0.0.1:17402', cpu: 50, donate: 0, shareStats: true, apiToken: 'tok123', apiPort: 18081 });
  const i = a.indexOf('--http-access-token');
  assert.ok(i > 0 && a[i + 1] === 'tok123' && a.includes('--http-port') && a[a.indexOf('--http-port') + 1] === '18081'); ok('share-stats adds a token-protected API');
  assert.ok(!buildArgs({ mode: 'solo', address: ADDR, node: '127.0.0.1:17402', shareStats: true, apiToken: '' }).includes('--http-port')); ok('no token -> API never exposed');
  assert.ok(!buildArgs({ mode: 'solo', address: ADDR, node: '127.0.0.1:17402' }).includes('--http-port')); ok('API off by default');

  // fake rigs
  const s1 = await fakeRig(18101, 'aaa', 3000, ADDR);
  const s2 = await fakeRig(18102, 'bbb', 1500, 'SafexSomeoneElse');
  let r = await fetchRig({ host: '127.0.0.1', port: 18101, token: 'aaa' });
  assert.ok(r.online && r.hashrate === 3000 && r.accepted === 8 && r.rejected === 2 && r.threads === 4 && r.uptime === 7200 && r.wallet === ADDR); ok('fake rig: hashrate, shares, threads, uptime, wallet parsed');
  r = await fetchRig({ host: '127.0.0.1', port: 18101, token: 'WRONG' });
  assert.deepStrictEqual([r.online, r.reason], [false, 'auth']); ok('wrong token reported as such');
  r = await fetchRig({ host: '127.0.0.1', port: 18199, token: 'x' });
  assert.deepStrictEqual([r.online, r.reason], [false, 'offline']); ok('unreachable rig reported offline');

  const rows = await pollAll([
    { name: 'A', host: '127.0.0.1', port: 18101, token: 'aaa' },
    { name: 'B', host: '127.0.0.1', port: 18102, token: 'bbb' },
    { name: 'C', host: '127.0.0.1', port: 18199, token: '' }], ADDR);
  assert.deepStrictEqual(rows.map((x) => [x.name, x.online, x.otherWallet]), [['A', true, false], ['B', true, true], ['C', false, false]]); ok('other-wallet rig is flagged; offline rig does not break the poll');
  const c = combine({ running: true, hashrate: 6000, accepted: 5, rejected: 0 }, rows);
  assert.strictEqual(c.hashrate, 6000 + 3000 + 1500); assert.strictEqual(c.online, 3); ok('combine sums this machine + online rigs');
  s1.close(); s2.close();

  // The real thing: xmrig 6.26 with its API on, read by our code.
  const x = spawn(XMRIG, ['--bench=1M', '--no-color', '--print-time=60', '--donate-level=0', '--http-host', '127.0.0.1', '--http-port', '18090', '--http-access-token', 'realtok'], { stdio: 'ignore' });
  let real = null;
  for (let t = 0; t < 40 && !(real && real.online && real.hashrate); t++) { await new Promise((q) => setTimeout(q, 1000)); real = await fetchRig({ host: '127.0.0.1', port: 18090, token: 'realtok' }); }
  x.kill('SIGINT');
  assert.ok(real && real.online && real.hashrate > 0, 'real xmrig API: ' + JSON.stringify(real));
  assert.ok(real.version.startsWith('6.') && real.threads >= 1); ok(`REAL xmrig ${real.version}: read ${Math.round(real.hashrate)} H/s, ${real.threads} threads over its API`);
  const denied = await fetchRig({ host: '127.0.0.1', port: 18090, token: 'nope' });
  console.log(`\n${n} checks passed`);
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
