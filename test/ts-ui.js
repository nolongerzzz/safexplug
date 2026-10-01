// Dev-only: expected-block tiles + per-rig Tailscale lines in the real app.
const { app, BrowserWindow } = require('electron');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
app.commandLine.appendSwitch('no-sandbox'); app.commandLine.appendSwitch('disable-gpu');
const ADDR = 'Safex5zwXKhha8jYzrTTraDVR2iam5naw9K23MsrnHW1XHuWvV4TksmcJaeSozLrRe1tMUq58tptbKkkZ7gtxy1jK47xxJ62rpS5L';
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'sxts-')); app.setPath('userData', ud);
const fixture = path.join(ud, 'ts.json');
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
fs.writeFileSync(fixture, JSON.stringify({ BackendState: 'Running',
  Self: { HostName: 'ryzen', DNSName: 'ryzen.t.ts.net.', TailscaleIPs: ['100.64.0.1'], Online: true },
  Peer: { a: { HostName: 'garage', DNSName: 'garage.t.ts.net.', TailscaleIPs: ['127.0.0.2'], Online: true, LastSeen: '0001-01-01T00:00:00Z' },
          b: { HostName: 'office-pc', DNSName: 'office-pc.t.ts.net.', TailscaleIPs: ['127.0.0.3'], Online: false, LastSeen: ago(150) },
          c: { HostName: 'shed', DNSName: 'shed.t.ts.net.', TailscaleIPs: ['127.0.0.4'], Online: true, LastSeen: '0001-01-01T00:00:00Z' } } }));
process.env.TS_FIXTURE = fixture; process.env.SAFEX_TAILSCALE_BIN = path.join(__dirname, 'fake-tailscale.sh');
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ mode: 'solo', address: ADDR, node: '127.0.0.1:17402', publicFallback: false,
  rigs: [{ name: 'Garage rig', host: '127.0.0.2', port: 18101, token: 'aaa' }, { name: 'Office PC', host: '127.0.0.3', port: 18101, token: 'x' },
         { name: 'Shed', host: '127.0.0.4', port: 18199, token: 'x' }, { name: 'Basement NAS', host: '127.0.0.9', port: 18199, token: 'x' }] }));
http.createServer((q, r) => r.end(JSON.stringify({ height: 2097365, target_height: 2097364, outgoing_connections_count: 8, incoming_connections_count: 2, difficulty: 27960000, target: 120 }))).listen(17402, '127.0.0.1');
http.createServer((q, r) => {
  if (q.headers.authorization !== 'Bearer aaa') { r.statusCode = 401; return r.end('{}'); } r.setHeader('Content-Type', 'application/json');
  if (q.url === '/2/summary') return r.end(JSON.stringify({ uptime: 5000, version: '6.26.0', hashrate: { total: [9280, 9200, null] }, results: { shares_good: 30, shares_total: 31 }, connection: {} }));
  if (q.url === '/2/backends') return r.end(JSON.stringify([{ type: 'cpu', enabled: true, threads: new Array(18).fill({}) }]));
  if (q.url === '/1/config') return r.end(JSON.stringify({ pools: [{ user: ADDR }] })); r.statusCode = 404; r.end('{}');
}).listen(18101, '127.0.0.2');
require('../src/main.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const w = BrowserWindow.getAllWindows()[0]; const wc = w.webContents; const OUT = process.env.SHOT_DIR;
  const js = (c) => wc.executeJavaScript(c); const snap = async (n) => fs.writeFileSync(path.join(OUT, n), (await wc.capturePage()).toPNG());
  await wait(3500);
  const tile = () => js(`(()=>{const t=document.getElementById('expTile');return t.hidden?'(hidden)':document.getElementById('expTime').textContent+' | '+document.getElementById('expSub').textContent})()`);
  console.log('Mine tab, solo, not mining:', await tile());
  await snap('t1-mine.png');
  await js(`document.getElementById('modePool').click()`); await wait(500);
  console.log('Mine tab, pool mode      :', await tile());
  await js(`document.getElementById('modeSolo').click()`); await wait(500);
  await js(`document.getElementById('tabBtnRigs').click()`); await wait(7000);
  console.log('Rigs combined expected   :', await js(`document.getElementById('cExp').textContent+' | '+document.getElementById('cExpSub').textContent`), '(combined', await js(`document.getElementById('cHs').textContent`)+')');
  const rows = await js(`[...document.querySelectorAll('#rigBody tr')].map(tr=>[...tr.children].slice(0,2).map(td=>td.innerText.replace(/\\n/g,' // ')).join(' => '))`);
  rows.forEach((r) => console.log('  row:', r));
  await snap('t2-rigs.png');
  app.exit(0);
});
