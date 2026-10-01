// Dev-only: status tile during the start-delay countdown.
const { app, BrowserWindow } = require('electron');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
app.commandLine.appendSwitch('no-sandbox'); app.commandLine.appendSwitch('disable-gpu');
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'sxcd-')); app.setPath('userData', ud);
const ADDR = 'Safex5zwXKhha8jYzrTTraDVR2iam5naw9K23MsrnHW1XHuWvV4TksmcJaeSozLrRe1tMUq58tptbKkkZ7gtxy1jK47xxJ62rpS5L';
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ mode: 'solo', address: ADDR, autostart: true, startDelay: 10, publicFallback: false }));
http.createServer((q, r) => r.end(JSON.stringify({ height: 2097365, target_height: 2097364, outgoing_connections_count: 8, incoming_connections_count: 1 }))).listen(17402, '127.0.0.1');
require('../src/main.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const wc = BrowserWindow.getAllWindows()[0].webContents;
  const R = () => wc.executeJavaScript("(()=>{const r=document.getElementById('rail');return (r.hidden?'hidden':r.className)+' | '+document.getElementById('statusText').textContent+' | chip:'+document.getElementById('nodeChip').className})()"); for (let i = 0; i < 8; i++) { console.log(i, await R()); await wait(1500); }
  console.log('status:', await wc.executeJavaScript(`document.getElementById('statusText').textContent+' | tip: '+document.getElementById('statusText').title+' | button: '+document.getElementById('go').textContent`));
  fs.writeFileSync(path.join(process.env.SHOT_DIR, 'cd.png'), (await wc.capturePage()).toPNG());
  app.exit(0);
});
