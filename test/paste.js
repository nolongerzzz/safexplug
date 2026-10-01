// Dev-only: prove paste / copy work in the real app window.
const { app, BrowserWindow, clipboard } = require('electron');
const fs = require('fs'), path = require('path');
app.commandLine.appendSwitch('no-sandbox'); app.commandLine.appendSwitch('disable-gpu');
app.setPath('userData', fs.mkdtempSync(path.join(require('os').tmpdir(), 'sxpaste-')));
require('../src/main.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ADDR = 'Safex5zwXKhha8jYzrTTraDVR2iam5naw9K23MsrnHW1XHuWvV4TksmcJaeSozLrRe1tMUq58tptbKkkZ7gtxy1jK47xxJ62rpS5L';
app.whenReady().then(async () => {
  await wait(2500);
  const w = BrowserWindow.getAllWindows()[0]; const wc = w.webContents;
  const js = (c) => wc.executeJavaScript(c);
  const key = (k, mod) => { wc.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: [mod] }); wc.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: [mod] }); };
  // 1. paste into address with Ctrl+V
  clipboard.writeText(ADDR);
  await js(`document.getElementById('address').focus()`);
  key('V', 'control'); await wait(400);
  console.log('PASTE via Ctrl+V ->', (await js(`document.getElementById('address').value`)) === ADDR ? 'OK (full address in field)' : 'FAILED');
  // 2. select all + copy from the address field
  clipboard.writeText('sentinel');
  key('A', 'control'); await wait(150); key('C', 'control'); await wait(300);
  console.log('COPY via Ctrl+A,Ctrl+C ->', clipboard.readText() === ADDR ? 'OK' : 'FAILED (' + clipboard.readText() + ')');
  // 3. Copy button copies the log
  await js(`document.getElementById('log').innerHTML='<div title="line one">x</div><div title="line two">y</div>'`);
  clipboard.writeText('sentinel');
  await js(`document.getElementById('copyLog').click()`); await wait(400);
  console.log('COPY button ->', clipboard.readText() === 'line one\nline two' ? 'OK' : 'FAILED (' + JSON.stringify(clipboard.readText()) + ')');
  app.exit(0);
});
