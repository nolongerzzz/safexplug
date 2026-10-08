'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), crypto = require('crypto');
const WS = require('../src/core/walletsetup');
let n = 0; const t = async (m, f) => { await f(); n++; console.log('ok -', m); };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sxws-'));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
(async () => {
  const files = { [WS.CLI]: Buffer.from('cli-binary-bytes'.repeat(1000)), [WS.RPC]: Buffer.from('rpc-binary-bytes'.repeat(1000)) };
  let corrupt = false;
  const srv = http.createServer((q, r) => {
    const name = q.url.split('/').pop();
    if (q.url === '/redir/' + WS.CLI) { r.statusCode = 302; r.setHeader('Location', '/' + WS.CLI); return r.end(); }
    if (name === 'SHA256SUMS') return r.end(Object.entries(files).map(([k, v]) => `${sha(v)}  ${k}`).join('\n') + `\n${'0'.repeat(64)}  safexd-linux-7.0.3\n`);
    if (files[name]) return r.end(corrupt && name === WS.RPC ? Buffer.from('tampered') : files[name]);
    r.statusCode = 404; r.end();
  }).listen(0, '127.0.0.1'); await new Promise((r) => srv.on('listening', r));
  process.env.SAFEX_RELEASE_BASE = `http://127.0.0.1:${srv.address().port}`;
  const isLinux = process.platform === 'linux';

  await t('checksum file is parsed by exact file name', () => {
    const s = `${'a'.repeat(64)}  safex-wallet-cli-linux-7.0.3\n${'b'.repeat(64)}  safex-wallet-cli-linux-7.0.3.exe\n`;
    assert.strictEqual(WS.wanted(s, 'safex-wallet-cli-linux-7.0.3'), 'a'.repeat(64)); assert.strictEqual(WS.wanted(s, 'nope'), null);
  });
  if (isLinux) {
    await t('download verifies checksums and installs executable files', async () => {
      const d = tmp(); const lines = []; const r = await WS.download(d, (l) => lines.push(l));
      assert.ok(r.ok, r.error); const s = WS.status(d); assert.ok(s.tools); assert.strictEqual(s.wallet, false);
      assert.ok(fs.statSync(WS.paths(d).cli).mode & 0o100); assert.ok(lines.some((l) => /checksum OK/.test(l)));
    });
    await t('a tampered download is rejected and deleted', async () => {
      corrupt = true; const d = tmp(); const r = await WS.download(d, () => {});
      assert.ok(!r.ok && /mismatch/i.test(r.error)); assert.ok(!fs.existsSync(WS.paths(d).rpc)); assert.ok(!fs.existsSync(WS.paths(d).rpc + '.part')); corrupt = false;
    });
  }
  srv.close();
  await t('mac install copies built tools from a source folder, after test-running them', async () => {
    const src = tmp(), d = tmp(), lines = [];
    for (const f of ['safex-wallet-cli', 'safex-wallet-rpc']) fs.writeFileSync(path.join(src, f), '#!/bin/sh\necho "Safex 7.0.3"\n', { mode: 0o755 });
    const r = WS.installMacTools(d, (l) => lines.push(l), [tmp(), src]); assert.ok(r.ok, r.error);
    assert.ok(WS.status(d).tools); assert.ok(fs.statSync(WS.paths(d).rpc).mode & 0o100); assert.ok(lines.some((l) => /Copied/.test(l)));
  });
  await t('mac install accepts tools whose --version exits non-zero but prints a version', async () => {
    const src = tmp(), d = tmp();
    for (const f of ['safex-wallet-cli', 'safex-wallet-rpc']) fs.writeFileSync(path.join(src, f), '#!/bin/sh\necho "Safex Oxygen 7.0.3"\nexit 1\n', { mode: 0o755 });
    assert.ok(WS.installMacTools(d, () => {}, [src]).ok);
  });
  await t('mac install refuses tools that do not start, and says what to do when none are found', async () => {
    const src = tmp(), d = tmp();
    for (const f of ['safex-wallet-cli', 'safex-wallet-rpc']) fs.writeFileSync(path.join(src, f), '#!/bin/sh\necho "dyld: Library not loaded: libboost" >&2\nexit 1\n', { mode: 0o755 });
    const r = WS.installMacTools(d, () => {}, [src]); assert.ok(!r.ok && /did not start/.test(r.error)); assert.ok(!WS.status(d).tools);
    const r2 = WS.installMacTools(d, () => {}, [tmp()]); assert.ok(!r2.ok && /No wallet tools found/.test(r2.error));
  });
  await t('mac terminal opens the runner through Terminal', () => {
    const f = WS.findTerminal(tmp(), true); if (!f) return;   // only where /usr/bin/open exists
    assert.deepStrictEqual(f.mk('/x/add-wallet.command'), ['-a', 'Terminal', '/x/add-wallet.command']);
  });
  await t('rpc args: local-only, no login, password from file, user node (NOT --restricted-rpc: it blocks get_transfers)', () => {
    const a = WS.rpcArgs('/d', '127.0.0.1:17402'); const j = a.join(' ');
    assert.ok(/--rpc-bind-ip 127\.0\.0\.1/.test(j) && /--disable-rpc-login/.test(j));
    assert.ok(/--daemon-address 127\.0\.0\.1:17402/.test(j) && /--password-file \/d\/view\.pw/.test(j) && /--rpc-bind-port 18082/.test(j));
    assert.ok(!a.includes('--restricted-rpc') && !a.includes('--password') && !/--rpc-bind-ip 0\.0\.0\.0/.test(j));
  });
  await t('runner script: view-only generation, password file, restore height, quoting', () => {
    const s = WS.runnerScript(WS.paths("/we ird/'dir"), '127.0.0.1:17402', 1234567);
    assert.ok(/--generate-from-view-key '\/we ird\/'\\''dir\/view'/.test(s)); assert.ok(/--restore-height 1234567/.test(s)); assert.ok(/--password-file/.test(s));
    assert.ok(!/--password /.test(s)); assert.ok(/never sees it/.test(s));
  });
  await t('terminal detection picks what is installed', () => {
    const d = tmp(); fs.writeFileSync(path.join(d, 'xterm'), '#!/bin/sh\n', { mode: 0o755 });
    assert.ok(/xterm$/.test(WS.findTerminal(d).bin)); assert.strictEqual(WS.findTerminal(tmp()), null);
  });
  if (isLinux) {
    await t('addWallet opens a terminal with the runner; writes a private password file; refuses if wallet exists', async () => {
      const d = tmp(), bin = tmp(); WS.paths(d);
      fs.mkdirSync(WS.paths(d).tools, { recursive: true }); fs.writeFileSync(WS.paths(d).cli, 'x', { mode: 0o755 }); fs.writeFileSync(WS.paths(d).rpc, 'x', { mode: 0o755 });
      fs.writeFileSync(path.join(bin, 'xterm'), `#!/bin/sh\necho "$@" > ${bin}/called\n`, { mode: 0o755 });
      const oldPath = process.env.PATH; process.env.PATH = bin;
      try {
        const r = WS.addWallet(d, { node: '127.0.0.1:17402', height: 100 }); assert.ok(r.ok, r.error);
        await new Promise((x) => setTimeout(x, 400)); assert.ok(/-e sh .*add-wallet\.sh/.test(fs.readFileSync(path.join(bin, 'called'), 'utf8')));
        assert.strictEqual(fs.statSync(WS.paths(d).pw).mode & 0o077, 0); assert.ok(!WS.addWallet(d, { node: 'bad node' }).ok);
        fs.writeFileSync(WS.paths(d).keys, 'k'); assert.ok(/already/.test(WS.addWallet(d, {}).error)); assert.ok(WS.status(d).wallet);
        WS.removeWallet(d); assert.ok(!WS.status(d).wallet);
      } finally { process.env.PATH = oldPath; }
    });
  }
  console.log(n + ' tests passed');
})();
