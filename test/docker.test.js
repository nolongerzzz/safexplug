'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sxdock-'));
process.env.SHIM_DIR = dir;
process.env.SAFEX_DOCKER_BIN = path.join(__dirname, 'fake-docker.sh');
const D = require('../src/core/docker');
const set = (f, v) => v === null ? fs.rmSync(path.join(dir, f), { force: true }) : fs.writeFileSync(path.join(dir, f), v);
const calls = () => fs.existsSync(path.join(dir, 'calls.log')) ? fs.readFileSync(path.join(dir, 'calls.log'), 'utf8').trim().split('\n') : [];
let n = 0; const ok = (m) => { n++; console.log('ok -', m); };

(async () => {
  set('engine', 'down');
  let s = await D.status(); assert.strictEqual(s.engine, 'down'); assert.ok(s.installed); ok('engine down detected');
  set('engine', 'noperm');
  s = await D.status(); assert.strictEqual(s.engine, 'no-permission'); ok('permission problem detected (needs group/ACL)');
  set('engine', 'ok');
  s = await D.status(); assert.deepStrictEqual([s.engine, s.image, s.container], ['ok', false, 'none']); ok('fresh machine: engine ok, no image, no container');

  let r = await D.startNode(); assert.strictEqual(r.ok, false); assert.match(r.error, /image/i); ok('start refused until the image is built');

  const b = D.buildImage(); const lines = [];
  b.on('line', (l) => lines.push(l));
  await new Promise((res) => b.on('exit', res));
  assert.ok(lines.some((l) => /Successfully tagged/.test(l))); assert.ok(calls().some((c) => /^build -t safex-node:latest .*node-panel\/docker$/.test(c))); ok('image build streams output, uses bundled Dockerfile');

  s = await D.status(); assert.strictEqual(s.image, true); ok('image seen after build');
  r = await D.startNode(); assert.ok(r.ok);
  const run = calls().find((c) => c.startsWith('run '));
  for (const need of ['-d', '--name safex-node', '--restart unless-stopped', '--stop-timeout 120', '-p 17401:17401',
    '-p 127.0.0.1:17402:17402', '-p 127.0.0.1:17403:17403', '-v safex-node-data:/data', 'safex-node:latest --db-sync-mode safe'])
    assert.ok(run.includes(need), 'run args missing: ' + need + '\n' + run);
  assert.ok(!/ -p 17402:17402| -p 17403:17403/.test(run)); ok('first start: RPC/ZMQ on localhost only, P2P public, safe sync, 120s stop timeout');

  s = await D.status(); assert.strictEqual(s.container, 'running');
  r = await D.startNode(); assert.ok(r.ok && r.note === 'already running'); ok('start is a no-op when already running');
  r = await D.stopNode(); assert.ok(r.ok); assert.ok(calls().some((c) => c === 'stop -t 120 safex-node')); ok('stop uses the long grace period');
  s = await D.status(); assert.strictEqual(s.container, 'stopped');
  const before = calls().filter((c) => c.startsWith('run ')).length;
  r = await D.startNode(); assert.ok(r.ok);
  assert.strictEqual(calls().filter((c) => c.startsWith('run ')).length, before); assert.ok(calls().some((c) => c === 'start safex-node')); ok('existing container is restarted, never recreated');

  const lg = D.followLogs(); const ll = []; lg.on('line', (l) => ll.push(l)); await new Promise((res) => lg.on('exit', res));
  assert.strictEqual(ll.length, 2); ok('log follower streams lines');

  // Install script sanity (no root here, so we only check what we would run)
  assert.ok(/apt-get install -y docker\.io acl/.test(D.LINUX_INSTALL_SCRIPT));
  assert.ok(/usermod -aG docker "\$1"/.test(D.LINUX_INSTALL_SCRIPT) && /setfacl -m "u:\$1:rw"/.test(D.LINUX_INSTALL_SCRIPT));
  assert.ok(!/\$USER|\$\(|`/.test(D.LINUX_INSTALL_SCRIPT)); ok('install script takes the user as an argument, no shell interpolation');
  assert.ok(['linux-apt', 'link'].includes(D.installPlan().kind)); ok('install plan resolves for this OS');

  delete process.env.SAFEX_DOCKER_BIN; process.env.SAFEX_DOCKER_BIN = '/nonexistent/docker';
  s = await D.status(); assert.deepStrictEqual([s.installed, s.engine], [false, 'missing']); ok('no docker CLI -> installed:false, engine:missing');
  console.log(`\n${n} checks passed`);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
