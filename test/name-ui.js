// Dev-only: the rig name box must be visible and editable in BOTH modes, even while mining.
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path'), os = require('os');
app.commandLine.appendSwitch('no-sandbox'); app.commandLine.appendSwitch('disable-gpu');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'sxnm-')));
require('../src/main.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const win = BrowserWindow.getAllWindows()[0]; const wc = win.webContents; const js = (c) => wc.executeJavaScript(c);
  win.setSize(900, 700); await wait(1200);
  const vis = `(()=>{const e=document.getElementById('name'); const r=e.getBoundingClientRect(); return {w:Math.round(r.width), h:Math.round(r.height), disabled:e.disabled}})()`;
  for (const m of ['modePool', 'modeSolo']) {
    await js(`document.getElementById('${m}').click()`); await wait(400);
    console.log(m, JSON.stringify(await js(vis)));
    await js(`document.getElementById('tabBtnRigs').click()`); await wait(900);
    console.log(m, 'rigs:', JSON.stringify(await js(`({tile:document.getElementById('cSharesK').textContent, th:document.getElementById('thShares').textContent})`)));
    await js(`document.getElementById('tabBtnMine').click()`); await wait(300);
    console.log(m, 'shares tile hidden:', await js(`document.getElementById('tileShares').hidden`));
  }
  await js(`(()=>{const e=document.getElementById('name'); e.value='Test Rig'; e.dispatchEvent(new Event('change'))})()`); await wait(500);
  console.log('saved name:', await js(`window.safex.setSettings({}).then(s=>s.name)`));
  fs.writeFileSync(path.join(process.env.SHOT_DIR, 'name-solo.png'), (await wc.capturePage()).toPNG());
  app.exit(0);
});
