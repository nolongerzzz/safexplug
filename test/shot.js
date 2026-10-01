// Dev-only: launch the real app, drive it through IPC, save screenshots.
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
const OUT = process.env.SHOT_DIR;
app.setPath('userData', fs.mkdtempSync(path.join(require('os').tmpdir(), 'sxui-')));
require('../src/main.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  await wait(2500);
  const w = BrowserWindow.getAllWindows()[0];
  const shot = async (n) => fs.writeFileSync(path.join(OUT, n), (await w.webContents.capturePage()).toPNG());
  const js = (c) => w.webContents.executeJavaScript(c);
  await shot('1-initial.png');
  await js(`document.getElementById('modeSolo').click()`); await wait(6500);
  await shot('2-solo-no-node.png');
  await js(`(()=>{const a=document.getElementById('address');a.value='Safex5zwXKhha8jYzrTTraDVR2iam5naw9K23MsrnHW1XHuWvV4TksmcJaeSozLrRe1tMUq58tptbKkkZ7gtxy1jK47xxJ62rpS5L';a.dispatchEvent(new Event('change'));document.getElementById('requireSynced').checked=false;document.getElementById('requireSynced').dispatchEvent(new Event('change'));document.getElementById('go').click()})()`);
  await wait(9000);
  await shot('3-running-dead-node.png');
  console.log('STATE', await js(`document.getElementById('statusText').textContent + ' | ' + document.getElementById('go').textContent`));
  await js(`document.getElementById('go').click()`); await wait(2500);
  console.log('AFTER STOP', await js(`document.getElementById('statusText').textContent`));
  app.exit(0);
});
