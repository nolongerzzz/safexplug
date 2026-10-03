// Dev-only: on the Mine tab the core (strip + settings + Start) stays put while the miner output scrolls.
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path'), os = require('os');
app.commandLine.appendSwitch('no-sandbox'); app.commandLine.appendSwitch('disable-gpu');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'sxpin-')));
require('../src/main.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const win = BrowserWindow.getAllWindows()[0]; const wc = win.webContents; const js = (c) => wc.executeJavaScript(c);
  let bad = 0; const ck = (n, ok, x) => { console.log(ok ? 'ok  ' : 'FAIL', n, x || ''); if (!ok) bad++; };
  for (const [w, h] of [[900, 800], [900, 720], [800, 560]]) {
    win.setSize(w, h); await wait(900);
    await js(`document.getElementById('modeSolo').click()`); await wait(300);
    await js(`(()=>{const l=document.getElementById('log'); l.textContent=Array.from({length:400},(_,i)=>'line '+i).join('\\n'); l.scrollTop=0;})()`);
    await wait(200);
    const top = () => js(`(()=>{const g=id=>Math.round(document.getElementById(id).getBoundingClientRect().top); const l=document.getElementById('log'); const vp=document.querySelector('#mineView>.viewport').getBoundingClientRect(); const v=document.getElementById('mineView'); return {go:g('go'), goBottom:Math.round(document.getElementById('go').getBoundingClientRect().bottom), light:g('light'), logTop:l.scrollTop, logScrolls:l.scrollHeight>l.clientHeight, vpH:Math.round(vp.height), vpBottom:Math.round(vp.bottom), winH:innerHeight, viewScroll:v.scrollHeight>v.clientHeight}})()`);
    const a = await top();
    await js(`document.getElementById('log').scrollTop=99999`); await wait(200);
    const b = await top();
    const tag = `${w}x${h}`;
    ck(tag + ' log scrolls inside viewport', b.logScrolls && b.logTop > 0, JSON.stringify(b));
    ck(tag + ' Start button did not move', a.go === b.go && a.light === b.light);
    ck(tag + ' Start button fully visible', a.goBottom <= a.winH, `goBottom=${a.goBottom} win=${a.winH}`);
    ck(tag + ' viewport usable (>=140px)', b.vpH >= 140, 'vpH=' + b.vpH);
    if (h >= 720) ck(tag + ' viewport inside window', b.vpBottom <= b.winH, `bottom=${b.vpBottom} win=${b.winH}`);
    if (h >= 720) ck(tag + ' no whole-page scroll', !b.viewScroll);
    fs.writeFileSync(path.join(process.env.SHOT_DIR, `pin-${tag}.png`), (await wc.capturePage()).toPNG());
  }
  console.log(bad ? 'FAIL ' + bad : 'ALL OK'); app.exit(bad ? 1 : 0);
});
