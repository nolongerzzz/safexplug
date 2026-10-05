// Dev-only: seed hashrate logs, open the Rigs tab, screenshot the chart.
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
app.commandLine.appendSwitch('no-sandbox'); app.commandLine.appendSwitch('disable-gpu');
const OUT = process.env.SHOT_DIR || '/tmp/hs';
const ud = fs.mkdtempSync(path.join(require('os').tmpdir(), 'sxui-')); app.setPath('userData', ud);
const now = Math.floor(Date.now() / 1000);
const gen = (base, dips, startAgo) => { const a = []; for (let t = now - startAgo; t < now; t += 60) { let v = base * (1 + 0.06 * Math.sin(t / 900)); for (const [s, e] of dips) if (t > now - s && t < now - e) v = null; if (v) a.push([t, Math.round(v)]); } return a; };
fs.writeFileSync(path.join(ud, 'hashrate-log.json'), JSON.stringify(gen(2400, [[30000, 26000]], 86400 * 2)));
const rigs = [['Garage rig', '10.0.0.7', 18080, 1500, [[50000, 42000], [9000, 7000]], 86400], ['Mac laptop', '10.0.0.9', 18080, 700, [], 40000]];
fs.mkdirSync(path.join(ud, 'rig-logs'));
for (const [, h, p, b, d, st] of rigs) fs.writeFileSync(path.join(ud, 'rig-logs', crypto.createHash('sha1').update(`${h}:${p}`).digest('hex').slice(0, 12) + '.json'), JSON.stringify(gen(b, d, st)));
require('../src/main.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  await wait(2500);
  const w = BrowserWindow.getAllWindows()[0]; w.setSize(900, 900);
  const shot = async (n) => fs.writeFileSync(path.join(OUT, n), (await w.webContents.capturePage()).toPNG());
  const js = (c) => w.webContents.executeJavaScript(c);
  await js(`window.safex.setSettings({rigs:${JSON.stringify(rigs.map(([n, h, p]) => ({ name: n, host: h, port: p, token: '' })))}})`);
  await wait(4000); await js(`document.getElementById('tabBtnRigs').click()`); await wait(1500);
  await shot('rigs-24h.png');
  await js(`document.querySelector('#hcRange button[data-r="6h"]').click()`); await wait(800);
  await js(`(()=>{const s=document.getElementById('hcSvg'),r=s.getBoundingClientRect();s.dispatchEvent(new MouseEvent('mousemove',{clientX:r.left+r.width*0.6,clientY:r.top+60,bubbles:true}))})()`); await wait(300);
  await shot('rigs-6h-hover.png');
  await js(`document.getElementById('hcTable').click()`); await wait(300); await shot('rigs-table.png');
  console.log('ERR', await js(`document.getElementById('hcLegend').textContent`));
  app.exit(0);
});
