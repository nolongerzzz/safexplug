// Dev-only: drive the real Node tab against the stand-in docker + a fake node RPC.
const { app, BrowserWindow } = require('electron');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
app.commandLine.appendSwitch('no-sandbox'); app.commandLine.appendSwitch('disable-gpu');
const SHIM = fs.mkdtempSync(path.join(os.tmpdir(), 'sxshim-'));
process.env.SHIM_DIR = SHIM;
process.env.SAFEX_DOCKER_BIN = path.join(__dirname, 'fake-docker.sh');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'sxnp-')));
const OUT = process.env.SHOT_DIR;
let height = 1500000;
http.createServer((q, r) => r.end(JSON.stringify({ height, target_height: 2097364, outgoing_connections_count: 8, incoming_connections_count: 2 }))).listen(17402, '127.0.0.1');
require('../src/main.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const set = (f, v) => v === null ? fs.rmSync(path.join(SHIM, f), { force: true }) : fs.writeFileSync(path.join(SHIM, f), v);
app.whenReady().then(async () => {
  await wait(2500);
  const w = BrowserWindow.getAllWindows()[0]; const wc = w.webContents;
  const js = (c) => wc.executeJavaScript(c);
  const snap = async (n) => fs.writeFileSync(path.join(OUT, n), (await wc.capturePage()).toPNG());
  const view = () => js(`({state:document.getElementById('nodeState').textContent, btn:document.getElementById('nodeBtn').hidden?'(none)':document.getElementById('nodeBtn').textContent, hint:document.getElementById('nodeHint').textContent})`);
  const show = async (label) => console.log(label.padEnd(22), JSON.stringify(await view()));
  await js(`document.getElementById('tabBtnNode').click()`); await wait(1500);

  // 1. no docker at all
  process.env.SAFEX_DOCKER_BIN = '/nonexistent/docker'; await wait(6000); await show('no docker:');
  // 2. engine down
  process.env.SAFEX_DOCKER_BIN = path.join(__dirname, 'fake-docker.sh'); set('engine', 'down'); await wait(6000); await show('engine down:');
  // 3. permission
  set('engine', 'noperm'); await wait(6000); await show('no permission:');
  // 4. fresh: engine ok, nothing built
  set('engine', 'ok'); await wait(6000); await show('fresh machine:');
  await snap('n1-fresh.png');
  // 5. click Start node -> build -> run
  await js(`document.getElementById('nodeBtn').click()`); await wait(8000); await show('after Start click:');
  console.log('log has build+start lines:', await js(`(()=>{const t=document.getElementById('nLog').textContent;return /Building the node image|building the node image/i.test(t)&&/Successfully tagged/.test(t)})()`));
  console.log('docker calls:', fs.readFileSync(path.join(SHIM, 'calls.log'), 'utf8').split('\n').filter((l) => /^(build|run)/.test(l)).map((l) => l.split(' ')[0]).join(' -> '));
  height = 1750000; await wait(6000); await show('running, syncing:');
  console.log('stats:', JSON.stringify(await js(`['nHeight','nTarget','nPeers','nPct'].map(i=>document.getElementById(i).textContent)`)));
  await snap('n2-running.png');
  // 6. synced
  height = 2097365; await wait(6000); await show('running, synced:');
  await snap('n3-synced.png');
  // 7. stop
  await js(`document.getElementById('nodeBtn').click()`); await wait(7000); await show('after Stop click:');
  app.exit(0);
});
