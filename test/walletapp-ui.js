// Dev-only: the Wallet button starts Safex Wallet; when it is missing the Wallet view explains.
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
  const logOf = () => (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8') : '');
  ck('there is no Explorer tab any more, there is a Wallet button', !(await js(`!!document.getElementById('tabBtnExplorer')`)) && (await js(`document.getElementById('tabBtnWallet').textContent`)) === 'Wallet');
  await js(`document.getElementById('tabBtnWallet').click()`); await wait(1200);
  ck('clicking Wallet starts the wallet app in its folder', logOf().includes(fakeApp) && !/--explorer/.test(logOf()), logOf());
  ck('the miner stays on the tab it was on, and the button says it is opening', (await js(`!document.getElementById('mineView').hidden && document.getElementById('walletView').hidden`)) && /Opening/.test(await js(`document.getElementById('tabBtnWallet').textContent`)));
  await wait(2000); ck('button text returns to Wallet', (await js(`document.getElementById('tabBtnWallet').textContent`)) === 'Wallet');
  await js(`document.getElementById('tabBtnWallet').click()`); await wait(1000);
  ck('clicking again starts it again (a running wallet just comes forward)', (logOf().trim().split('\n').length) === 2);
  // not installed: the tab explains instead
  fs.rmSync(path.join(fakeApp, 'node_modules'), { recursive: true }); await wait(2000);
  await js(`document.getElementById('tabBtnWallet').click()`); await wait(800);
  ck('when the wallet is missing, the Wallet view says so', (await js(`!document.getElementById('walletView').hidden`)) && /not found/.test(await js(`document.getElementById('wlMsg').textContent`)), await js(`document.getElementById('wlMsg').textContent`));
  if (process.env.SHOT_DIR) fs.writeFileSync(path.join(process.env.SHOT_DIR, 'm-wallet-missing.png'), (await wc.capturePage()).toPNG());
  console.log(bad ? 'FAIL ' + bad : 'WALLETAPP ALL OK'); app.exit(bad ? 1 : 0);
});
