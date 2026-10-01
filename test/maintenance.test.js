'use strict';
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sxmaint-'));
process.env.SHIM_DIR = dir;
process.env.SAFEX_DOCKER_BIN = path.join(__dirname, 'fake-docker.sh');
const M = require('../src/core/maintenance');
const set = (f, v) => v === null ? fs.rmSync(path.join(dir, f), { force: true }) : fs.writeFileSync(path.join(dir, f), v);
const calls = () => fs.existsSync(path.join(dir, 'calls.log')) ? fs.readFileSync(path.join(dir, 'calls.log'), 'utf8').trim().split('\n') : [];
const vols = () => (fs.existsSync(path.join(dir, 'volumes')) ? fs.readFileSync(path.join(dir, 'volumes'), 'utf8').trim().split('\n').filter(Boolean) : []);
let n = 0; const ok = (m) => { n++; console.log('ok -', m); };
const noop = () => {};

(async () => {
  set('engine', 'ok'); set('image', 'x'); set('volumes', 'safex-node-data\n');
  // node running -> everything refuses
  set('container', 'running');
  for (const f of ['health', 'backup', 'restore']) { const r = await M[f](noop); assert.ok(!r.ok && /Stop the node first/.test(r.error), f); }
  ok('health / backup / restore all refuse while the node is running');
  set('container', 'exited');

  // the data volume is read from the container, not assumed
  set('mountname', 'my-odd-volume-name'); set('volumes', 'my-odd-volume-name\n');
  assert.strictEqual((await M.dataSource()).ref, 'my-odd-volume-name'); ok("uses the container's real data volume name, not a guess");
  let r = await M.health(noop);
  assert.ok(r.ok && r.status === 'OK' && r.blocks === 2097365 && r.errors === 0); ok('health check: parses SUMMARY (OK, 2,097,365 blocks)');
  const hc = calls().find((c) => c.includes('--entrypoint python3'));
  assert.ok(hc.includes('-v my-odd-volume-name:/data:ro') && hc.includes('--entrypoint python3') && hc.endsWith('/data/lmdb')); ok('health check mounts the real volume READ-ONLY');

  set('summary', 'SUMMARY status=DAMAGED blocks=2097365 readable=1098136 missing=0 errors=78 first_bad=1097930');
  r = await M.health(noop); assert.ok(r.ok && r.status === 'DAMAGED' && r.errors === 78 && r.firstBad === '1097930'); ok('health check: reports damage and first bad height'); set('summary', null);

  set('noscript', 'x'); r = await M.health(noop);
  assert.ok(!r.ok && r.imageOld && /Rebuild image/.test(r.error)); ok('old image without the tool -> clear "rebuild image" message'); set('noscript', null);

  // missing volume must not be auto-created by a check
  set('volumes', ''); const before = calls().length;
  r = await M.health(noop); assert.ok(!r.ok && /No chain data/.test(r.error));
  assert.ok(!calls().slice(before).some((c) => c.includes('--entrypoint python3')) && !vols().includes('my-odd-volume-name')); ok('missing data volume: refuses and does not create an empty one');
  set('volumes', 'my-odd-volume-name\n');

  // backup
  r = await M.backup(noop);
  assert.ok(r.ok && /^safex-node-backup-\d{8}-\d{6}(-\d+)?$/.test(r.name) && vols().includes(r.name)); ok('backup creates a timestamped backup volume');
  const bk = calls().find((c) => c.includes('touch /to/.INCOMPLETE'));
  assert.ok(bk.includes('-v my-odd-volume-name:/from:ro') && bk.includes(`-v ${r.name}:/to`)); ok('backup reads the live data read-only, writes only the new volume');

  set('lowspace', 'x'); const v0 = vols().length; r = await M.backup(noop);
  assert.ok(!r.ok && /Not enough free space/.test(r.error) && vols().length === v0); ok('backup refuses when disk space is short, creates nothing'); set('lowspace', null);
  set('nodata', 'x'); r = await M.backup(noop); assert.ok(!r.ok && /no chain data/i.test(r.error)); ok('backup refuses when there is no chain data'); set('nodata', null);
  const first = vols().filter((x) => x.startsWith('safex-node-backup'));
  r = await M.backup(noop); assert.ok(r.ok && !first.includes(r.name) && vols().includes(first[0])); ok('two backups in the same second get different names, nothing overwritten');
  set('failbackup', 'x'); const v1 = vols().length; r = await M.backup(noop);
  assert.ok(!r.ok && /did not complete/.test(r.error) && vols().length === v1 && first.every((x) => vols().includes(x))); ok('failed backup: partial volume removed, live data untouched'); set('failbackup', null);

  // restore picks the newest VALID backup
  set('volumes', 'my-odd-volume-name\nsafex-node-backup-20260929-100000\nsafex-node-backup-20260930-100000\nsafex-node-backup-20261001-100000\n');
  set('invalid', 'safex-node-backup-20261001-100000\n');
  r = await M.restore(noop); assert.ok(r.ok && r.from === 'safex-node-backup-20260930-100000'); ok('restore skips an incomplete backup and uses the newest complete one');
  const rs = calls().filter((c) => c.includes('find /to -mindepth 1 -delete')).pop();
  assert.ok(rs.includes('-v safex-node-backup-20260930-100000:/from:ro') && rs.includes('-v my-odd-volume-name:/to')); ok('restore writes into the real data volume');
  set('volumes', 'my-odd-volume-name\n'); set('invalid', null);
  r = await M.restore(noop); assert.ok(!r.ok && /backup first/i.test(r.error)); ok('restore refuses when no backup exists');

  const ov = await M.overview(); assert.deepStrictEqual([ov.data, ov.backups], [true, 0]); ok('overview reports data present and 0 backups');
  console.log(`\n${n} checks passed`);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
