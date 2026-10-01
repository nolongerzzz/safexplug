// Dev-only: restart-race, countdown, network hashrate and Rigs tab in the real app.
const { app, BrowserWindow } = require('electron');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
app.commandLine.appendSwitch('no-sandbox'); app.commandLine.appendSwitch('disable-gpu');
const ADDR = 'Safex5zwXKhha8jYzrTTraDVR2iam5naw9K23MsrnHW1XHuWvV4TksmcJaeSozLrRe1tMUq58tptbKkkZ7gtxy1jK47xxJ62rpS5L';
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'sxfeat-')); app.setPath('userData', ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({
  mode: 'solo', address: ADDR, node: '127.0.0.1:17402', autostart: true, startDelay: 6, requireSynced: true, publicFallback: false,
  rigs: [{ name: 'Garage rig', host: '127.0.0.1', port: 18101, token: 'aaa' }, { name: 'Office PC', host: '127.0.0.1', port: 18102, token: 'bbb' }, { name: 'Shed', host: '127.0.0.1', port: 18199, token: 'x' }] }));
// node: right after a restart (target 0, no peers) -> later really synced with peers
let phase = 'restarting';
http.createServer((q, r) => {
  if (q.method === 'POST') { r.setHeader('Content-Type', 'application/json'); return r.end(JSON.stringify({ error: { code: -5, message: 'n/a' } })); }
  const j = phase === 'restarting'
    ? { height: 2097300, target_height: 0, outgoing_connections_count: 0, incoming_connections_count: 0, difficulty: 120000000, target: 60 }
    : { height: 2097365, target_height: 2097364, outgoing_connections_count: 8, incoming_connections_count: 2, difficulty: 120000000, target: 60, synchronized: true };
  r.end(JSON.stringify(j));
}).listen(17402, '127.0.0.1');
const rig = (port, tok, hs, wallet) => http.createServer((q, r) => {
  if (q.headers.authorization !== 'Bearer ' + tok) { r.statusCode = 401; return r.end('{}'); }
  r.setHeader('Content-Type', 'application/json');
  if (q.url === '/2/summary') return r.end(JSON.stringify({ worker_id: 'x', uptime: 93784, version: '6.26.0', hashrate: { total: [hs, hs, hs] }, results: { shares_good: 12, shares_total: 13 }, connection: { pool: '127.0.0.1:17402' } }));
  if (q.url === '/2/backends') return r.end(JSON.stringify([{ type: 'cpu', enabled: true, threads: new Array(8).fill({}) }]));
  if (q.url === '/1/config') return r.end(JSON.stringify({ pools: [{ user: wallet }] }));
  r.statusCode = 404; r.end('{}');
}).listen(port, '127.0.0.1');
rig(18101, 'aaa', 3100, ADDR); rig(18102, 'bbb', 1900, 'SafexSomeoneElse');
require('../src/main.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const w = BrowserWindow.getAllWindows()[0]; const wc = w.webContents; const OUT = process.env.SHOT_DIR;
  const js = (c) => wc.executeJavaScript(c);
  const snap = async (n) => fs.writeFileSync(path.join(OUT, n), (await wc.capturePage()).toPNG());
  const status = () => js(`document.getElementById('statusText').textContent`);
  const chip = () => js(`document.getElementById('nodeText').textContent`);
  await wait(2500);
  console.log('t=2.5s  status:', await status(), '| node chip:', await chip());
  await wait(3000);
  console.log('t=5.5s  status:', await status(), '| node chip:', await chip());
  await wait(3500);
  console.log('t=9s    status:', await status(), '(countdown over; node still restarting, so it must keep waiting)');
  console.log('        xmrig started yet?', await js(`document.getElementById('log').textContent.includes('xmrig')`));
  phase = 'synced'; await wait(7000);
  console.log('synced, 1 reading -> status:', await status(), '| chip:', await chip());
  await wait(8000);
  console.log('synced, stable    -> status:', await status(), '| xmrig started?', await js(`document.getElementById('log').textContent.includes('xmrig')`));
  console.log('network chip:', await js(`(()=>{const c=document.getElementById('netChip');return c.hidden?'(hidden)':document.getElementById('netHs').textContent})()`), '(expect 2.00 MH/s)');
  await snap('f1-mine.png');
  await js(`document.getElementById('tabBtnRigs').click()`); await wait(7000);
  console.log('combined:', await js(`document.getElementById('cHs').textContent`), '| online:', await js(`document.getElementById('cOnline').textContent`), '| shares:', await js(`document.getElementById('cShares').textContent`));
  console.log('rows:', JSON.stringify(await js(`[...document.querySelectorAll('#rigBody tr')].map(tr=>[...tr.children].slice(0,3).map(td=>td.textContent).join(' | '))`)));
  await snap('f2-rigs.png');
  app.exit(0);
});
