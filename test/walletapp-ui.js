// Dev-only: with Safex Wallet installed, the Explorer tab launches it (with --explorer) and shows a launch panel instead of the built-in explorer.
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path'), os = require('os');
app.commandLine.appendSwitch('no-sandbox'); app.commandLine.appendSwitch('disable-gpu');
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'sxwa-')); app.setPath('userData', ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ mode: 'solo', node: '127.0.0.1:17402', publicFallback: false, autostart: false }));
const fakeApp = fs.mkdtempSync(path.join(os.tmpdir(), 'fakewallet-')); const LOG = path.join(fakeApp, 'launch.log');
fs.mkdirSync(path.join(fakeApp, 'node_modules', '.bin'), { recursive: true }); fs.writeFileSync(path.join(fakeApp, 'package.json'), '{"name":"safex-wallet"}');
fs.writeFileSync(path.join(fakeApp, 'node_modules', '.bin', 'electron'), `#!/bin/sh\necho "$PWD $@" >> ${LOG}\n`, { mode: 0o755 });
process.env.SAFEX_WALLET_APP_DIR = fakeApp;
require('../src/main.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
process.on('uncaughtException', (e) => { console.log('UNCAUGHT', e); app.exit(1); });
app.whenReady().then(async () => {
  const wc = BrowserWindow.getAllWindows()[0].webContents; const js = (c) => wc.executeJavaScript(c); await wait(1500);
  let bad = 0; const ck = (n, ok, x) => { console.log(ok ? 'ok  ' : 'FAIL', n, x || ''); if (!ok) bad++; };
  await js(`document.getElementById('tabBtnExplorer').click()`); await wait(1200);
  const log = fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : '';
  ck('clicking Explorer starts the wallet app in its folder with --explorer', log.includes(fakeApp) && /--explorer/.test(log), log);
  ck('launch panel is shown, built-in explorer hidden', (await js(`!document.getElementById('exLaunch').hidden && document.getElementById('exBuiltin').hidden`)));
  if (process.env.SHOT_DIR) fs.writeFileSync(path.join(process.env.SHOT_DIR, 'm-explorer-launch.png'), (await wc.capturePage()).toPNG());
  await js(`document.getElementById('exLaunchBtn').click()`); await wait(800);
  ck('the button opens it again', (fs.readFileSync(LOG, 'utf8').match(/--explorer/g) || []).length === 2);
  console.log(bad ? 'FAIL ' + bad : 'WALLETAPP ALL OK'); app.exit(bad ? 1 : 0);
});
