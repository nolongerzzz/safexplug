'use strict';
// "Update" button engine, shared by the miner and the wallet.
// Looks in the Downloads folder for  <prefix>-<version>-update.tar.xz  (the overlay
// packages we hand out), checks it only touches the app's own folders, backs up what
// it will replace, unpacks it over the app folder, and the caller then restarts the app.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const ALLOWED = ['package.json', 'README.md', 'LICENSE', 'src/', 'test/', 'tools/', 'assets/'];
const verParts = (v) => String(v).split('.').map((x) => parseInt(x, 10) || 0);
function cmp(a, b) { const x = verParts(a), y = verParts(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; }

// The real user's home, even when the app runs as root from the full-speed launcher.
function homeFromUserData(userData) {
  // Linux ~/.config/..., macOS ~/Library/..., Windows C:\\Users\\name\\AppData\\Roaming\\...
  const m = /^(.*?)[\\/](?:\.config|Library|AppData)[\\/]/.exec(String(userData || ''));
  return m && m[1] ? m[1] : os.homedir();
}
function downloadDirs(userData) { return [...new Set([path.join(homeFromUserData(userData), 'Downloads'), path.join(os.homedir(), 'Downloads')])]; }

const denied = new Set();

// Newest package in the given folders that is newer than `current`; null if none.
function findUpdate({ prefix, current, dirs }) {
  const re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-(\\d+\\.\\d+\\.\\d+)-update\\.tar\\.xz$');
  let best = null;
  for (const dir of dirs) {
    // macOS asks the user before an app may read Downloads. A "no" is remembered here so the folder is not tried (and asked about) again.
    if (denied.has(dir)) continue;
    let names = []; try { names = fs.readdirSync(dir); } catch (e) { if (e && (e.code === 'EPERM' || e.code === 'EACCES')) denied.add(dir); continue; }
    for (const n of names) {
      const m = re.exec(n); if (!m || cmp(m[1], current) <= 0) continue;
      let st; try { st = fs.statSync(path.join(dir, n)); } catch (_) { continue; }
      if (!st.isFile() || st.size < 1000) continue;
      if (!best || cmp(m[1], best.version) > 0) best = { file: path.join(dir, n), version: m[1] };
    }
  }
  return best;
}

// Every path in the package must be relative, free of "..", and inside the allowed set.
function safeEntry(name) {
  const n = String(name).replace(/\\/g, '/').replace(/^\.\//, '');
  if (!n || path.isAbsolute(n) || n.split('/').includes('..') || n.includes('\0')) return false;
  return ALLOWED.some((a) => (a.endsWith('/') ? n === a.slice(0, -1) || n.startsWith(a) : n === a));
}

const run = (cmd, args) => new Promise((resolve, reject) => execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024 }, (err, out, errOut) => (err ? reject(new Error((errOut || err.message).toString().trim().slice(0, 300))) : resolve(out.toString()))));

async function apply({ file, version, appDir, backupDir, currentVersion }) {
  const list = (await run('tar', ['-tJf', file])).split('\n').map((s) => s.trim()).filter(Boolean);
  if (!list.length) throw new Error('The update file is empty.');
  const bad = list.find((e) => !safeEntry(e));
  if (bad) throw new Error(`The update file has an unexpected entry (${bad.slice(0, 60)}), so it was not installed.`);
  if (!list.some((e) => e.replace(/^\.\//, '') === 'package.json')) throw new Error('The update file has no package.json, so it was not installed.');
  // back up what is about to be replaced, so a bad update can be undone by hand
  fs.mkdirSync(backupDir, { recursive: true });
  const have = ['package.json', 'src', 'README.md'].filter((x) => fs.existsSync(path.join(appDir, x)));
  await run('tar', ['-cf', path.join(backupDir, `before-${version}-from-${currentVersion}.tar`), '-C', appDir, ...have]);
  await run('tar', ['-xJf', file, '-C', appDir, '--no-same-owner']);
  // when running as root (full-speed launcher) hand the new files back to the folder's owner
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    const st = fs.statSync(appDir);
    for (const e of list) { try { fs.chownSync(path.join(appDir, e.replace(/^\.\//, '')), st.uid, st.gid); } catch (_) {} }
  }
  const got = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).version;
  if (got !== version) throw new Error(`Unpacked, but the app folder reports ${got}, not ${version}. The backup is in ${backupDir}.`);
  return { version: got };
}

module.exports = { cmp, findUpdate, safeEntry, apply, downloadDirs, homeFromUserData, ALLOWED };
