// Dev-only: the progress rail must fade and collapse smoothly (no one-frame jump of the page below it).
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path'), os = require('os');
app.commandLine.appendSwitch('no-sandbox'); app.commandLine.appendSwitch('disable-gpu');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'sxrf-')));
require('../src/main.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const wc = BrowserWindow.getAllWindows()[0].webContents; const js = (c) => wc.executeJavaScript(c);
  await wait(2500);
  await js(`(()=>{const r=document.getElementById('rail'); r.className='rail s3'; window.__p=document.querySelector('#mineView .panel'); })()`);
  await wait(1200);
  const top0 = await js(`window.__p.getBoundingClientRect().top`);
  await js(`document.getElementById('rail').classList.add('off')`);
  const tops = []; for (let i = 0; i < 14; i++) { tops.push(Math.round((await js(`window.__p.getBoundingClientRect().top`)) * 10) / 10); await wait(100); }
  const maxStep = Math.max(...tops.map((t, i) => Math.abs(t - (i ? tops[i - 1] : top0))));
  console.log('start', top0, 'then', tops.join(' '), '| biggest step px:', maxStep);
  app.exit(0);
});
