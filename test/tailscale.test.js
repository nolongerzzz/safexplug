'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sxts-'));
process.env.TS_FIXTURE = path.join(dir, 'status.json');
process.env.SAFEX_TAILSCALE_BIN = path.join(__dirname, 'fake-tailscale.sh');
const T = require('../src/core/tailscale');
const NOW = Date.parse('2026-10-01T12:00:00Z');
let n = 0; const ok = (m) => { n++; console.log('ok -', m); };

const fixture = {
  Version: '1.80.0', BackendState: 'Running',
  Self: { HostName: 'ryzen', DNSName: 'ryzen.tail1234.ts.net.', TailscaleIPs: ['100.64.0.1', 'fd7a:115c:a1e0::1'], Online: true, OS: 'linux' },
  Peer: {
    'nodekey:aaa': { HostName: 'garage', DNSName: 'garage.tail1234.ts.net.', TailscaleIPs: ['100.64.0.2', 'fd7a::2'], Online: true, LastSeen: '0001-01-01T00:00:00Z', OS: 'linux' },
    'nodekey:bbb': { HostName: 'office-pc', DNSName: 'office-pc.tail1234.ts.net.', TailscaleIPs: ['100.64.0.3'], Online: false, LastSeen: '2026-10-01T09:30:00Z', OS: 'windows' },
    'nodekey:ccc': { HostName: 'phone', DNSName: 'phone.tail1234.ts.net.', TailscaleIPs: ['100.64.0.9'], Online: true, OS: 'iOS' },
  },
};
const put = (o) => fs.writeFileSync(process.env.TS_FIXTURE, JSON.stringify(o));

(async () => {
  put(fixture);
  const ts = await T.status();
  assert.ok(ts.installed && ts.running && ts.state === 'Running'); assert.deepStrictEqual(ts.self.ips, ['100.64.0.1']); assert.strictEqual(ts.peers.length, 3); ok('parses status: self, peers, IPv4 only');
  assert.strictEqual(ts.peers.find((p) => p.name === 'garage').lastSeen, null); assert.ok(ts.peers.find((p) => p.name === 'office-pc').lastSeen > 0); ok('year-1 LastSeen is treated as unknown, real timestamps are kept');

  assert.strictEqual(T.matchHost(ts, '100.64.0.2').name, 'garage'); assert.strictEqual(T.matchHost(ts, 'garage').name, 'garage');
  assert.strictEqual(T.matchHost(ts, 'GARAGE.tail1234.ts.net').name, 'garage'); assert.strictEqual(T.matchHost(ts, '192.168.1.5'), null); ok('rig matched by 100.x address, short name or full tailnet name');

  const d = (host, online) => T.describe(ts, { host, online }, NOW);
  assert.deepStrictEqual([d('100.64.0.2', true).level, d('100.64.0.2', true).text], ['ok', 'Tailscale online · 100.64.0.2']); ok('online machine + answering miner -> green line');
  let r = d('100.64.0.2', false); assert.strictEqual(r.level, 'warn'); assert.match(r.text, /online.*miner is not answering/); ok('machine up but miner silent -> tells you the miner/API is the problem');
  r = d('100.64.0.3', false); assert.strictEqual(r.level, 'bad'); assert.match(r.text, /offline on Tailscale · last seen 2.5 h ago/); ok('machine off -> "offline, last seen 2.5 h ago"');
  r = d('192.168.1.50', true); assert.deepStrictEqual([r.level, r.text], ['dim', 'Not on Tailscale (reached directly)']); ok('LAN address is labelled, not flagged as an error');
  r = d('100.64.0.77', false); assert.strictEqual(r.level, 'warn'); assert.match(r.text, /not found in your network/); ok('unknown 100.x address is flagged');
  assert.strictEqual(T.describeSelf(ts).text, 'Tailscale online · 100.64.0.1'); ok('this machine line');

  assert.ok(T.isTailscaleAddress('100.64.0.1') && T.isTailscaleAddress('100.127.255.1') && !T.isTailscaleAddress('100.128.0.1') && !T.isTailscaleAddress('192.168.1.1')); ok('100.64.0.0/10 range check');

  put({ BackendState: 'Stopped' }); let t2 = await T.status();
  assert.strictEqual(t2.running, false); assert.match(T.describe(t2, { host: '100.64.0.2', online: false }).text, /not running/); ok('Tailscale stopped -> explained');
  put({ BackendState: 'NeedsLogin' }); t2 = await T.status(); assert.match(T.describeSelf(t2).text, /log in/); ok('needs login -> explained');
  fs.writeFileSync(process.env.TS_FIXTURE, 'not json'); t2 = await T.status(); assert.strictEqual(t2.running, false); ok('garbage output does not crash');

  process.env.SAFEX_TAILSCALE_BIN = '/nonexistent/tailscale';
  t2 = await T.status(); assert.strictEqual(t2.installed, false);
  assert.match(T.describe(t2, { host: '100.64.0.2', online: false }).text, /not installed/); assert.strictEqual(T.describe(t2, { host: '192.168.1.5', online: true }), null); ok('Tailscale missing -> only mentioned for 100.x rigs');
  console.log(`\n${n} checks passed`);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
