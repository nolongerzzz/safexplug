// Dev-only: verify "wait for synced node" gate with a fake daemon.
const { app, BrowserWindow } = require('electron');
const http = require('http'), fs = require('fs'), path = require('path');
app.commandLine.appendSwitch('no-sandbox'); app.commandLine.appendSwitch('disable-gpu');
app.setPath('userData', fs.mkdtempSync(path.join(require('os').tmpdir(), 'sxgate-')));
let synced = false;
http.createServer((q, r) => r.end(JSON.stringify(synced
  ? { height: 2097365, target_height: 2097364, outgoing_connections_count: 8, incoming_connections_count: 1 }
  : { height: 1500000, target_height: 2097364, outgoing_connections_count: 8, incoming_connections_count: 0 }))).listen(17402, '127.0.0.1');
require('../src/main.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  await wait(2500);
  const w = BrowserWindow.getAllWindows()[0];
  const js = (c) => w.webContents.executeJavaScript(c);
  const st = () => js(`document.getElementById('statusText').textContent`);
  await js(`(()=>{document.getElementById('modeSolo').click();const a=document.getElementById('address');a.value='Safex5zwXKhha8jYzrTTraDVR2iam5naw9K23MsrnHW1XHuWvV4TksmcJaeSozLrRe1tMUq58tptbKkkZ7gtxy1jK47xxJ62rpS5L';a.dispatchEvent(new Event('change'))})()`);
  await wait(6500);
  console.log('NODE CHIP (syncing):', await js(`document.getElementById('nodeText').textContent`));
  await js(`document.getElementById('go').click()`); await wait(1200);
  console.log('AFTER START, node syncing  ->', await st());
  console.log('xmrig running yet?', await js(`document.getElementById('log').textContent.includes('xmrig')`));
  synced = true; await wait(7500);
  console.log('NODE CHIP (synced):', await js(`document.getElementById('nodeText').textContent`));
  console.log('AFTER node synced          ->', await st());
  console.log('xmrig running now?', await js(`document.getElementById('log').textContent.includes('xmrig')`));
  await js(`document.getElementById('go').click()`); await wait(2000);
  console.log('AFTER STOP                 ->', await st());
  const fs2 = require('fs');
  fs2.writeFileSync(process.env.SHOT, (await w.webContents.capturePage()).toPNG());
  app.exit(0);
});
