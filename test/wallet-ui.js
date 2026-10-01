// Dev-only: Payments tab in the real app, against a fake local wallet-rpc.
const { app, BrowserWindow } = require('electron');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
app.commandLine.appendSwitch('no-sandbox'); app.commandLine.appendSwitch('disable-gpu');
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'sxw-')); app.setPath('userData', ud);
const now = Math.floor(Date.now() / 1000);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ mode: 'solo', publicFallback: false, miningSince: now - 86400 }));
const tx = [{ type: 'block', txid: 'a', amount: 4e10, timestamp: now - 7200, confirmations: 70 }, { type: 'block', txid: 'b', amount: 4e10, timestamp: now - 600, confirmations: 4 },
  { type: 'in', txid: 'c', amount: 12e9, timestamp: now - 3000, confirmations: 20 }, { type: 'block', txid: 'z', amount: 4e10, timestamp: now - 9e5, confirmations: 900 }];
http.createServer((q, r) => { let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => r.end(JSON.stringify({ result: { in: tx.filter((x) => x.type === 'in'), block: tx.filter((x) => x.type === 'block') } }))); }).listen(18082, '127.0.0.1');
require('../src/main.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const wc = BrowserWindow.getAllWindows()[0].webContents; const OUT = process.env.SHOT_DIR;
  const js = (c) => wc.executeJavaScript(c);
  const g = (id) => js(`document.getElementById('${id}').textContent`);
  await wait(2500);
  await js(`document.getElementById('tabBtnPay').click()`); await wait(300);
  console.log('before connect:', await js(`document.getElementById('pState').textContent`));
  await js(`document.getElementById('pAddr').value='127.0.0.1:18082';document.getElementById('pSave').click()`); await wait(1500);
  console.log('total:', await g('pTotal'), '|', await g('pSince'), '| count:', await g('pCount'), '|', await g('pMined'), '| state:', await g('pState'));
  console.log('rows:', JSON.stringify(await js(`[...document.querySelectorAll('#pBody tr')].map(tr=>tr.innerText.replace(/\\t/g,' | '))`)));
  fs.writeFileSync(path.join(OUT, 'pay.png'), (await wc.capturePage()).toPNG());
  await js(`document.getElementById('pAddr').value='10.0.0.5:18082';document.getElementById('pSave').click()`); await wait(300);
  console.log('remote refused:', await g('pState'));
  console.log('reset button present:', await js(`!!document.getElementById('pReset')`));
  app.exit(0);
});
