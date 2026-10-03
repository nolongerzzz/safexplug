// Dev-only: every tab must scroll on a small (7-inch) window.
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path'), os = require('os');
app.commandLine.appendSwitch('no-sandbox'); app.commandLine.appendSwitch('disable-gpu');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'sxsm-')));
require('../src/main.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const win = BrowserWindow.getAllWindows()[0]; const wc = win.webContents; const js = (c) => wc.executeJavaScript(c);
  win.setSize(800, 480); await wait(1200);
  for (const t of ['Mine', 'Node', 'Rigs', 'Pay', 'Wallet']) {
    await js(`document.getElementById('tabBtn${t}').click()`); await wait(700);
    const r = await js(`(()=>{const v=[...document.querySelectorAll('.view')].find(x=>!x.hidden); v.scrollTop=100000; return {sh:v.scrollHeight, ch:v.clientHeight, top:Math.round(v.scrollTop), tabsW:document.querySelector('.tabs').scrollWidth+'/'+document.querySelector('.tabs').clientWidth}})()`);
    console.log(t, JSON.stringify(r));
    if (t === 'Mine') { await js(`document.querySelector('.view:not([hidden])').scrollTop=100000`); await wait(200); fs.writeFileSync(path.join(process.env.SHOT_DIR, 'small-mine-bottom.png'), (await wc.capturePage()).toPNG()); }
  }
  app.exit(0);
});
