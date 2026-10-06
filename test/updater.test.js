'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
const U = require('../src/core/updater');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'upd-'));
assert.ok(U.cmp('3.3.12', '3.3.11') > 0 && U.cmp('3.3.9', '3.3.10') < 0 && U.cmp('3.4.0', '3.3.99') > 0 && U.cmp('1.0.0', '1.0.0') === 0);
assert.strictEqual(U.homeFromUserData('/home/user/.config/Safex Community Miner'), '/home/user');
assert.strictEqual(U.homeFromUserData('/Users/zb/Library/Application Support/x'), '/Users/zb');
assert.strictEqual(U.homeFromUserData('C:\\Users\\zb\\AppData\\Roaming\\x'), 'C:\\Users\\zb');
assert.ok(!U.safeEntry('src\\..\\..\\evil') && U.safeEntry('src\\a.js'));
for (const ok of ['package.json', 'src/main.js', './src/core/a.js', 'README.md', 'test/x.js']) assert.ok(U.safeEntry(ok), ok);
for (const no of ['/etc/passwd', '../x', 'src/../../x', 'node_modules/a', '.ssh/id', 'package.json.bak', 'srcx/a']) assert.ok(!U.safeEntry(no), no);
// find: newest newer package only, ignores other names
const dl = tmp(); const big = Buffer.alloc(2000, 1);
for (const n of ['safex-miner-3.3.10-update.tar.xz', 'safex-miner-3.3.12-update.tar.xz', 'safex-miner-3.3.11-update.tar.xz', 'safex-wallet-9.9.9-update.tar.xz', 'safex-miner-3.3.13-update.tar.xz.part', 'safex-miner-3.3.11-update (1).tar.xz']) fs.writeFileSync(path.join(dl, n), big);
assert.strictEqual(U.findUpdate({ prefix: 'safex-miner', current: '3.3.10', dirs: [dl, '/nonexistent'] }).version, '3.3.12');
assert.strictEqual(U.findUpdate({ prefix: 'safex-miner', current: '3.3.12', dirs: [dl] }), null);
(async () => {
  // apply: real tarball into a fake app folder
  const app = tmp(), src = tmp();
  fs.mkdirSync(path.join(app, 'src')); fs.writeFileSync(path.join(app, 'package.json'), '{"version":"1.0.0"}'); fs.writeFileSync(path.join(app, 'src/a.js'), 'old'); fs.mkdirSync(path.join(app, 'node_modules')); fs.writeFileSync(path.join(app, 'node_modules/keep'), 'k');
  fs.mkdirSync(path.join(src, 'src')); fs.writeFileSync(path.join(src, 'package.json'), '{"version":"1.1.0"}'); fs.writeFileSync(path.join(src, 'src/a.js'), 'new');
  const good = path.join(tmp(), 'safex-x-1.1.0-update.tar.xz'); execFileSync('tar', ['-cJf', good, '-C', src, 'package.json', 'src']);
  const r = await U.apply({ file: good, version: '1.1.0', appDir: app, backupDir: path.join(tmp(), 'bk'), currentVersion: '1.0.0' });
  assert.strictEqual(r.version, '1.1.0'); assert.strictEqual(fs.readFileSync(path.join(app, 'src/a.js'), 'utf8'), 'new'); assert.strictEqual(fs.readFileSync(path.join(app, 'node_modules/keep'), 'utf8'), 'k', 'untouched');
  // backup holds the old files
  const bkd = tmp(); await U.apply({ file: good, version: '1.1.0', appDir: app, backupDir: bkd, currentVersion: '1.1.0' });
  assert.ok(fs.readdirSync(bkd)[0].startsWith('before-1.1.0-from-')); 
  // hostile package is refused and changes nothing
  const evil = tmp(); fs.mkdirSync(path.join(evil, 'etc')); fs.writeFileSync(path.join(evil, 'etc/x'), 'x'); fs.writeFileSync(path.join(evil, 'package.json'), '{"version":"9.0.0"}');
  const bad = path.join(tmp(), 'safex-x-9.0.0-update.tar.xz'); execFileSync('tar', ['-cJf', bad, '-C', evil, 'package.json', 'etc']);
  await assert.rejects(U.apply({ file: bad, version: '9.0.0', appDir: app, backupDir: tmp(), currentVersion: '1.1.0' }), /unexpected entry/);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8')).version, '1.1.0');
  // version mismatch is reported
  await assert.rejects(U.apply({ file: good, version: '2.0.0', appDir: app, backupDir: tmp(), currentVersion: '1.1.0' }), /reports 1\.1\.0/);
  console.log('updater tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
