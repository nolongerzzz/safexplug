// Dev-only: Node tab "let my other devices use this node" hint in the real app, with the fake docker CLI.
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path'), os = require('os');
app.commandLine.appendSwitch('no-sandbox'); app.commandLine.appendSwitch('disable-gpu');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sxsh-')); process.env.SHIM_DIR = dir; process.env.SAFEX_DOCKER_BIN = path.join(__dirname, 'fake-docker.sh');
fs.writeFileSync(path.join(dir, 'image'), ''); fs.writeFileSync(path.join(dir, 'container'), 'running\n'); fs.writeFileSync(path.join(dir, 'portbind'), '0.0.0.0:17402\n');
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'sxshu-')); app.setPath('userData', ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ shareNode: true, publicFallback: false }));
require('../src/main.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  const wc = BrowserWindow.getAllWindows()[0].webContents; const js = (c) => wc.executeJavaScript(c);
  await wait(2500); await js(`document.getElementById('tabBtnNode').click()`); await wait(2000);
  console.log('checked:', await js(`document.getElementById('shareNode').checked`), '| hint:', await js(`document.getElementById('shareHint').hidden ? 'hidden' : document.getElementById('shareHint').textContent`));
  fs.writeFileSync(path.join(dir, 'portbind'), '127.0.0.1:17402\n'); await js(`window.safex.nodeRefresh().then(applyRefresh=>0)`); await wait(300);
  await js(`document.getElementById('tabBtnMine').click(); document.getElementById('tabBtnNode').click()`); await wait(2000);
  console.log('after closing:', await js(`document.getElementById('shareHint').textContent`));
  fs.writeFileSync(path.join(process.env.SHOT_DIR, 'share.png'), (await wc.capturePage()).toPNG());
  app.exit(0);
});
