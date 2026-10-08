'use strict';
// Backing up a wallet means copying its files while the wallet tool is not using them.
// A wallet is up to four files: <name> (scan cache), <name>.keys (the keys, protected by the wallet password),
// <name>.safex_account_keys (seller account keys: NOT recoverable from the 25 seed words) and <name>.address.txt.
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const SUFFIXES = ['', '.keys', '.safex_account_keys', '.address.txt'];
const stamp = (d = new Date()) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const safeName = (n) => /^[A-Za-z0-9._-]+$/.test(n) && !n.startsWith('.');

function filesOf(walletDir, name) {
  return SUFFIXES.map((s) => name + s).filter((f) => { try { return fs.statSync(path.join(walletDir, f)).isFile(); } catch (_) { return false; } });
}

// Copy into <destRoot>/safex-backup-<name>-<time>/ and check every copy. Never overwrites: the folder name carries the time.
function copyWallet(walletDir, name, destRoot, now = new Date()) {
  if (!safeName(name)) return { ok: false, error: 'Unusual wallet name, nothing was copied.' };
  const have = filesOf(walletDir, name);
  if (!have.includes(name + '.keys')) return { ok: false, error: 'The wallet keys file was not found, nothing was copied.' };
  let dir = path.join(destRoot, `safex-backup-${name}-${stamp(now)}`); let n = 1;
  while (fs.existsSync(dir)) dir = path.join(destRoot, `safex-backup-${name}-${stamp(now)}-${++n}`);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { return { ok: false, error: 'Could not create the backup folder: ' + e.code }; }
  const files = [];
  try {
    for (const f of have) {
      const src = path.join(walletDir, f), dst = path.join(dir, f);
      fs.copyFileSync(src, dst, fs.constants.COPYFILE_EXCL);
      const a = fs.statSync(src).size, b = fs.statSync(dst).size;
      if (a !== b) throw new Error(`${f}: copy is ${b} bytes, expected ${a}`);
      if (a < 5 * 1024 * 1024 && sha(src) !== sha(dst)) throw new Error(`${f}: copy does not match`);
      files.push({ name: f, size: b });
    }
    fs.writeFileSync(path.join(dir, 'RESTORE.txt'),
      `Safex wallet backup of "${name}", made ${new Date(now).toString()}.\n\nTo restore: close Safex Wallet, copy every file in this folder (not this note) into your wallets folder,\nthen open the wallet from Safex Wallet. Keep these files offline and private.\n` +
      (have.includes(name + '.safex_account_keys') ? 'This backup includes your seller account keys (.safex_account_keys). They cannot be rebuilt from your seed words.\n' : ''));
  } catch (e) { return { ok: false, error: 'Backup failed: ' + e.message, dir }; }
  return { ok: true, dir, files, hasAccountKeys: have.includes(name + '.safex_account_keys') };
}

// Keep only the newest `keep` automatic backups of one wallet.
function prune(autoRoot, name, keep = 3) {
  try {
    const list = fs.readdirSync(autoRoot).filter((d) => d.startsWith(`safex-backup-${name}-`)).sort();
    for (const d of list.slice(0, Math.max(0, list.length - keep))) fs.rmSync(path.join(autoRoot, d), { recursive: true, force: true });
  } catch (_) {}
}

// "Add this wallet to my list": copy a wallet's files from wherever they are into the wallets folder, never overwriting.
function adoptWallet(file, walletsDir) {
  const dir = path.dirname(file), base = path.basename(file);
  if (!base.endsWith('.keys')) return { ok: false, error: 'Pick the .keys file of the wallet.' };
  const name = base.slice(0, -5);
  if (!safeName(name)) return { ok: false, error: 'Unusual wallet name, nothing was copied. Use letters, numbers, dot, dash or underscore.' };
  if (path.resolve(dir) === path.resolve(walletsDir)) return { ok: true, file, already: true };
  if (fs.existsSync(path.join(walletsDir, base))) return { ok: false, error: `A wallet called "${name}" is already in your list, so nothing was copied. Rename one of them first, or open it from the list.` };
  const have = filesOf(dir, name);
  try {
    fs.mkdirSync(walletsDir, { recursive: true });
    for (const f of have) {
      const a = path.join(dir, f), b = path.join(walletsDir, f);
      fs.copyFileSync(a, b, fs.constants.COPYFILE_EXCL);
      if (fs.statSync(a).size !== fs.statSync(b).size) throw new Error(`${f}: the copy is the wrong size`);
    }
  } catch (e) { return { ok: false, error: 'Could not add the wallet: ' + e.message }; }
  return { ok: true, file: path.join(walletsDir, base), files: have };
}

module.exports = { adoptWallet, SUFFIXES, filesOf, copyWallet, prune, stamp, safeName };
