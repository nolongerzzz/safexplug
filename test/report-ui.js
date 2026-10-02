// Dev-only: Rigs tab with rigs reporting in (collector mode), then reporter mode finding a collector.
const { app, BrowserWindow } = require('electron');
process.env.SAFEX_REPORT_PORT = '28090'; process.env.SAFEX_DISCOVER_PORT = '28091'; process.env.SAFEX_DISCOVER_HOST = '127.0.0.1'; process.env.SAFEX_HUNG_MS = '3000';
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http'), dgram = require('dgram');
app.commandLine.appendSwitch('no-sandbox'); app.commandLine.appendSwitch('disable-gpu');
const MODE = process.env.MODE || 'collect';
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'sxrp-')); app.setPath('userData', ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ mode: 'solo', publicFallback: false, collect: MODE === 'collect', name: 'Test rig' }));
if (MODE === 'collect') fs.writeFileSync(path.join(ud, 'reported-rigs.json'), JSON.stringify([{ id: 'old-rig-12345678', name: 'Cabin Ryzen', hashrate: 9000, mining: true, connected: true, accepted: 5, seen: Date.now() - 600000 }]));
require('../src/main.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (o) => new Promise((res) => { const d = JSON.stringify(o); const q = http.request({ host: '127.0.0.1', port: 28090, path: '/report', method: 'POST' }, (r) => { r.resume(); res(r.statusCode); }); q.on('error', () => res(0)); q.end(d); });
app.whenReady().then(async () => {
  const wc = BrowserWindow.getAllWindows()[0].webContents; const OUT = process.env.SHOT_DIR; const js = (c) => wc.executeJavaScript(c);
  await wait(2500); await js(`document.getElementById('tabBtnRigs').click()`);
  if (MODE === 'collect') {
    await send({ id: 'mac-rig-abcdef01', name: 'MacZ', hashrate: 4200, threads: 4, mining: true, connected: true, accepted: 12, uptime: 3700 });
    await send({ id: 'ryzen2-abcdef02', name: 'Next Ryzen', mining: false });
    await wait(7000);
    console.log('rows:', JSON.stringify(await js(`[...document.querySelectorAll('#rigBody tr')].map(tr=>[...tr.children].slice(0,3).map(td=>td.innerText.split('\\n')[0]).join(' | '))`)));
    console.log('bubble:', await js(`!document.getElementById('bubRigs').hidden`), '| online tile:', await js(`document.getElementById('cOnline').textContent`), '| combined:', await js(`document.getElementById('cHs').textContent`));
    fs.writeFileSync(path.join(OUT, 'r-collect.png'), (await wc.capturePage()).toPNG());
    await js(`[...document.querySelectorAll('#rigBody tr')].find(t=>t.innerText.includes('Cabin')).querySelector('button').click()`); await wait(7000);
    console.log('after Remove:', await js(`document.querySelectorAll('#rigBody tr').length`), 'rows');
  } else {
    let got = null; const srv = http.createServer((q, r) => { let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => { got = JSON.parse(b); r.statusCode = 204; r.end(); }); }).listen(28090, '127.0.0.1');
    const u = dgram.createSocket('udp4'); setInterval(() => u.send(Buffer.from('SAFEX-COLLECTOR 28090'), 28091, '127.0.0.1'), 1000);
    await wait(9000);
    console.log('main box:', await js(`document.getElementById('mainBox').textContent`));
    console.log('report received:', JSON.stringify(got && { name: got.name, mining: got.mining, id: !!got.id }));
    fs.writeFileSync(path.join(OUT, 'r-report.png'), (await wc.capturePage()).toPNG());
  }
  app.exit(0);
});
