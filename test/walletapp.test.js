'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), os = require('os');
const W = require('../src/core/walletapp');
let n = 0; const t = (m, f) => { f(); n++; console.log('ok -', m); };
const mk = (name, pkgName = 'safex-wallet', withElectron = true) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-')); const d = path.join(home, name); fs.mkdirSync(path.join(d, 'node_modules', '.bin'), { recursive: true });
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: pkgName }));
  if (withElectron) fs.writeFileSync(path.join(d, 'node_modules', '.bin', 'electron'), '#!/bin/sh\n', { mode: 0o755 });
  return { home, d };
};
t('finds ~/safex-wallet', () => { const x = mk('safex-wallet'); assert.deepStrictEqual(W.find({ home: x.home, env: {}, platform: 'linux' }), { found: true, dir: x.d }); });
t('finds the HomeBase name too', () => { const x = mk('safex-homebase', 'safex-homebase'); assert.ok(W.find({ home: x.home, env: {}, platform: 'linux' }).found); });
t('a folder with the wrong program name is not taken', () => { const x = mk('safex-wallet', 'something-else'); assert.ok(!W.find({ home: x.home, env: {}, platform: 'linux' }).found); });
t('not installed (no electron) is not found', () => { const x = mk('safex-wallet', 'safex-wallet', false); assert.ok(!W.find({ home: x.home, env: {}, platform: 'linux' }).found); });
t('a chosen folder wins over the home folder', () => { const a = mk('safex-wallet'), b = mk('elsewhere'); assert.strictEqual(W.find({ chosen: b.d, home: a.home, env: {}, platform: 'linux' }).dir, b.d); });
t('other systems are told so', () => assert.strictEqual(W.find({ platform: 'darwin' }).reason, 'platform'));
t('launch starts electron in that folder with --explorer, detached', () => {
  const x = mk('safex-wallet'); let got; const r = W.launch(x.d, (cmd, args, opts) => { got = { cmd, args, opts }; return { unref() {}, on() {} }; });
  assert.ok(r.ok); assert.ok(got.cmd.endsWith('node_modules/.bin/electron')); assert.ok(got.args.includes('--explorer')); assert.strictEqual(got.opts.cwd, x.d); assert.strictEqual(got.opts.detached, true);
});
t('launch failure is reported, not thrown', () => { const r = W.launch('/nope', () => { throw Object.assign(new Error('x'), { code: 'ENOENT' }); }); assert.ok(!r.ok); assert.ok(/ENOENT/.test(r.error)); });
console.log(n + ' tests passed');
