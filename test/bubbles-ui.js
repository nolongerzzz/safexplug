// Dev-only: tab bubbles, per-rig 1h/6h/24h columns and 24 h charts in the real app.
const { app, BrowserWindow } = require('electron');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
app.commandLine.appendSwitch('no-sandbox'); app.commandLine.appendSwitch('disable-gpu');
process.env.SAFEX_HUNG_MS = '3000';
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'sxbub-')); app.setPath('userData', ud);
const now = Math.floor(Date.now() / 1000);
const seed = (file, base) => { const s = []; for (let t = now - 86000; t < now - 60; t += 300) s.push([t, Math.round(base * (0.8 + 0.4 * Math.abs(Math.sin(t / 5000))))]); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(s)); };
const rigFile = (k) => path.join(ud, 'rig-logs', crypto.createHash('sha1').update(k).digest('hex').slice(0, 12) + '.json');
seed(path.join(ud, 'hashrate-log.json'), 9000); seed(rigFile('127.0.0.2:18101'), 12000);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ mode: 'solo', publicFallback: false, walletRpc: '127.0.0.1:18082', walletSeen: 1,
  rigs: [{ name: 'Garage rig', host: '127.0.0.2', port: 18101, token: 'a' }, { name: 'Hung rig', host: '127.0.0.3', port: 18101, token: 'a' }, { name: 'Dead rig', host: '127.0.0.4', port: 18199, token: 'a' }] }));
const rigApi = (hs) => (q, r) => { r.setHeader('Content-Type', 'application/json');
  if (q.url === '/2/summary') return r.end(JSON.stringify({ uptime: 5000, hashrate: { total: [hs, hs, hs] }, results: { shares_good: 3, shares_total: 3, hashes_total: 123456789 }, connection: {} }));
  if (q.url === '/2/backends') return r.end(JSON.stringify([{ type: 'cpu', enabled: true, threads: new Array(12).fill({}) }])); r.end('{}'); };
http.createServer(rigApi(12000)).listen(18101, '127.0.0.2'); http.createServer(rigApi(0)).listen(18101, '127.0.0.3');
const tx = [{ type: 'block', txid: 'a', amount: 4e10, timestamp: now - 7200, confirmations: 70 }, { type: 'block', txid: 'b', amount: 4e10, timestamp: now - 600, confirmations: 4 }];
http.createServer((q, r) => { let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => r.end(JSON.stringify({ result: { block: tx } }))); }).listen(18082, '127.0.0.1');
require('../src/main.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const wc = BrowserWindow.getAllWindows()[0].webContents; const OUT = process.env.SHOT_DIR; const js = (c) => wc.executeJavaScript(c);
  const vis = (id) => js(`!document.getElementById('${id}').hidden`);
  await wait(9000);
  console.log('Rigs bubble (hung+offline):', await vis('bubRigs'), '| title:', await js(`document.getElementById('bubRigs').title`));
  console.log('Payments bubble (2 payments, 1 seen):', await vis('bubPay'));
  await js(`document.getElementById('tabBtnRigs').click()`); await wait(1500);
  console.log('headers:', await js(`[...document.querySelectorAll('#rigTable thead th')].map(t=>t.textContent).join(' | ')`));
  (await js(`[...document.querySelectorAll('#rigBody tr')].map(tr=>[...tr.children].slice(0,6).map(td=>td.innerText.split('\\n')[0]).join(' | '))`)).forEach((r) => console.log('  row:', r));
  fs.writeFileSync(path.join(OUT, 'b-rigs.png'), (await wc.capturePage()).toPNG());
  await js(`document.getElementById('tabBtnPay').click()`); await wait(1500);
  console.log('Payments bubble after opening tab:', await vis('bubPay'));
  console.log('chart paths:', await js(`[document.getElementById('chHash'), document.getElementById('chPay')].map(s=>s.querySelectorAll('path').length)`));
  fs.writeFileSync(path.join(OUT, 'b-pay.png'), (await wc.capturePage()).toPNG());
  app.exit(0);
});
