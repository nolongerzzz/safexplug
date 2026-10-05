// Dev-only: closing the window keeps the app alive while the node runs, and quits once nothing is running.
const { app, BrowserWindow } = require('electron');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
app.commandLine.appendSwitch('no-sandbox'); app.commandLine.appendSwitch('disable-gpu');
const SHIM = fs.mkdtempSync(path.join(os.tmpdir(), 'sxshim-'));
process.env.SHIM_DIR = SHIM;
process.env.SAFEX_DOCKER_BIN = path.join(__dirname, 'fake-docker.sh');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'sxka-')));
const MODE = process.argv.includes('--node') ? 'node' : 'idle';
if (MODE === 'node') { fs.writeFileSync(path.join(SHIM, 'image'), ''); fs.writeFileSync(path.join(SHIM, 'container'), 'running'); }
http.createServer((q, r) => r.end('{}')).listen(17402, '127.0.0.1');
let quit = false; app.on('will-quit', () => { quit = true; });
require('../src/main.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  await wait(4000);
  BrowserWindow.getAllWindows()[0].close(); await wait(2500);
  console.log(MODE, '- after closing window, app still running:', !quit);
  if (MODE === 'node') {
    fs.writeFileSync(path.join(SHIM, 'container'), 'exited'); await wait(14000);
    console.log('node - after node stopped, app quit by itself:', quit);
  }
  app.exit(0);
});
