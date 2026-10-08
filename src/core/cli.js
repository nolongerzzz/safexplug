'use strict';
// Drives the official wallet tool (safex-wallet-cli) one action at a time, the way a person would in its terminal.
// A fresh tool is started for every action, so it always reads the newest offers from the node.
// The password goes to the tool's standard input only. It is never on a command line and never written to disk.
const { spawn } = require('child_process');

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;
const clean = (s) => String(s).replace(ANSI, '').replace(/\r/g, '');
const PROMPT = /\[wallet [^\]\n]*\]:\s*$/;

class Cli {
  constructor(bin, args, { timeout = 90000, cwd } = {}) {
    this.buf = ''; this.cursor = 0; this.dead = false; this.waiters = []; this.timeout = timeout;
    this.proc = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'], cwd });
    const take = (d) => { this.buf += clean(d.toString('utf8')); this.poke(); };
    this.proc.stdout.on('data', take); this.proc.stderr.on('data', take);
    this.proc.on('exit', () => { this.dead = true; this.poke(); }); this.proc.on('error', (e) => { this.dead = true; this.spawnError = e && e.code; this.poke(); });
    this.proc.stdin.on('error', () => {});
  }
  poke() { for (const w of this.waiters.slice()) w(); }
  send(line) { try { this.proc.stdin.write(line + '\n'); } catch (_) {} }
  // wait until any of the patterns appears in output not yet consumed; resolves {i, text, match}
  expect(patterns, ms = this.timeout) {
    return new Promise((resolve) => {
      const done = (r) => { clearTimeout(t); this.waiters = this.waiters.filter((w) => w !== check); resolve(r); };
      const check = () => {
        const rest = this.buf.slice(this.cursor);
        for (let i = 0; i < patterns.length; i++) {
          const m = patterns[i].exec(rest);
          if (m) { this.cursor += m.index + m[0].length; return done({ i, text: rest.slice(0, m.index + m[0].length), match: m }); }
        }
        if (this.dead) done({ i: -1, text: rest, dead: true });
      };
      const t = setTimeout(() => done({ i: -2, text: this.buf.slice(this.cursor), timeout: true }), ms);
      this.waiters.push(check); check();
    });
  }
  progress() { return progressOf(this.buf.slice(-4000)); }
  kill() { try { this.proc.kill('SIGTERM'); } catch (_) {} setTimeout(() => { try { this.proc.kill('SIGKILL'); } catch (_) {} }, 3000); }
  async close() { this.send('exit'); await this.expect([/$^/], 8000); this.kill(); }
}

const ERR = /Error: ([^\n]*)/;

// Open a wallet in the tool and get to its command prompt.
async function open(bin, { walletFile, walletDir, node, password, onStart }) {
  const c = new Cli(bin, ['--wallet-file', walletFile, '--daemon-address', node, '--log-file', require('path').join(walletDir, 'safex-wallet-cli.log')], { timeout: 90000, cwd: walletDir });
  if (onStart) { try { onStart(c); } catch (_) {} }   // lets the caller read the tool's block progress while it opens
  // the tool runs from the wallets folder so a plain file name finds the wallet
  // with piped input the tool does not print its password prompt, it just reads the first line
  c.send(password);
  // the tool reports a wrong password as "Error loading wallet ... possible corruption", so that text means wrong password here
  for (let n = 0; n < 4; n++) {
    const r2 = await c.expect([/Error loading wallet|invalid password/i, PROMPT, /failed to connect to daemon/i, ERR], 120000);
    if (r2.i === 0) { c.kill(); return { ok: false, error: 'Wrong password, or the wallet file could not be read.' }; }
    if (r2.i === 1) break;
    if (r2.i === 2) { c.noDaemon = true; continue; }
    if (r2.i === 3) { c.kill(); return { ok: false, error: r2.match[1] }; }
    c.kill(); return { ok: false, error: c.spawnError ? 'Could not start the wallet tool (' + c.spawnError + '). Is it downloaded, and does the wallets folder exist?' : 'The wallet tool did not open the wallet.' };
  }
  return { ok: true, c };
}

// Run one command that ends in a fee question. Returns { ok, fee, text } or { ok:false, error }.
// The tool prints a fresh prompt right after it echoes a command, before the result, so a prompt means nothing here.
// Only the fee question or an error line marks the end.
async function quote(c, command, { peg = false, passwordFirst = null } = {}) {
  c.send(command);
  if (passwordFirst) c.send(passwordFirst);
  for (let step = 0; step < 4; step++) {
    const r = await c.expect([/Is this okay\?\s*\(Y\/Yes\/N\/No\):\s*$/m, /price peg\?\s*\(Y\/Yes\/N\/No\):\s*$/m, ERR], 120000);
    if (r.i === 1) { c.send(peg ? 'y' : 'n'); continue; }
    if (r.i === 0) {
      const m = /transaction fee is ([0-9]+(?:\.[0-9]+)?)/i.exec(r.text);
      // A question without the fee in it is an earlier question from the tool (a purchase asks one before it shows the fee).
      // It is never answered here; the person sees its text and decides.
      return { ok: true, fee: m ? m[1] : null, text: r.text, preliminary: !m, pre: m ? '' : tail(r.text, 600) };
    }
    if (r.i === 2) return { ok: false, error: r.match[1] };
    return { ok: false, error: 'The wallet tool gave no price quote. Last thing it said: ' + tail(r.text) };
  }
  return { ok: false, error: 'Unexpected questions from the wallet tool.' };
}
const tail = (t, n = 300) => clean(t).split('\n').map((x) => x.trim()).filter(Boolean).slice(n > 300 ? -8 : -3).join(' | ').slice(0, n);
const lastError = (t) => { const m = /Error: ([^\n]*)/g; let x, last = null; while ((x = m.exec(t))) last = x[1]; return last; };

// Answer the fee question: yes sends it, no cancels it.
async function answer(c, yes) {
  c.send(yes ? 'y' : 'n');
  if (!yes) { await sentinel(c, 15000); return { ok: true, sent: false }; }
  const r = await c.expect([/successfully submitted, transaction <([0-9a-f]{64})>/i, ERR, /Is this okay\?\s*\(Y\/Yes\/N\/No\):\s*$/m], 120000);
  if (r.i === 0) return { ok: true, sent: true, txid: r.match[1] };
  if (r.i === 1) return { ok: false, error: r.match[1] };
  // the tool asked another question (the fee one) after the first: nothing is sent yet, the person is shown it
  if (r.i === 2) { const m = /transaction fee is ([0-9]+(?:\.[0-9]+)?)/i.exec(r.text); return { ok: true, sent: false, more: true, fee: m ? m[1] : null, pre: m ? '' : tail(r.text, 600) }; }
  return { ok: false, error: 'The wallet tool did not confirm the transaction. Last thing it said: ' + tail(r.text) };
}

// Commands that only print and never ask anything: send them followed by a marker the tool will reject by name.
// Its "unknown command" reply arrives after the real command has finished.
let mark = 0;
async function sentinel(c, ms = 60000) {
  const id = `zz_done_${Date.now()}_${++mark}`;
  c.send(id);
  const r = await c.expect([new RegExp(`unknown command: ${id}`)], ms);
  return { ok: r.i === 0, text: r.text.replace(new RegExp(`[^\\n]*${id}[^\\n]*\\n?`, 'g'), '') };
}
async function run(c, command, ms = 60000) {
  c.send(command);
  const r = await sentinel(c, ms);
  return { ok: r.ok, text: r.text, error: lastError(r.text) };
}

// Make a local account key set. The tool may ask for the password again for this one. With piped input it does not show
// the question, so the password is sent right behind the command; if it was not asked for, it is read as an unknown command.
async function accountNew(c, password, username, data) {
  c.send(`safex_account new ${username} ${data}`);
  c.send(password);
  const r = await c.expect([/New account created/, ERR], 40000);
  if (r.i === 0) return { ok: true };
  if (r.i === 1) return { ok: false, error: r.match[1] };
  return { ok: false, error: 'The wallet tool did not confirm the new account. Last thing it said: ' + tail(r.text).split(password).join('***') };
}

// The seller accounts this wallet holds: the tool prints them as a table (username, data, activated).
function parseAccounts(text) {
  const out = [];
  for (const raw of String(text).split('\n')) {
    // the real tool puts its "[wallet Safex5]: " prompt in front of every line it prints, so drop that first
    const l = raw.replace(/^(\s*\[wallet [^\]\n]*\]:\s*)+/, '').trim();
    if (!l.startsWith('#') || /Account Username|^#[-\s#]*$|Safex accounts/.test(l)) continue;
    const p = l.split('#').map((x) => x.trim()); if (p.length < 5 || !p[1]) continue;
    out.push({ username: p[1], data: p.slice(2, p.length - 2).join(' '), activated: p[p.length - 2] });
  }
  return out;
}
async function accounts(c) {
  // A tool that is still busy (for example catching up with the chain after a long time closed) can take a while to reach the
  // command, so wait longer, and keep whatever table it did print even when its closing reply is slow.
  const r = await run(c, 'safex_account', 120000);
  const gotTable = /Safex accounts|Account Username/.test(r.text);
  if (!r.ok && !gotTable) return { ok: false, error: 'The wallet tool did not answer within two minutes. The last thing it said: ' + (tail(r.text, 300).replace(/\s+/g, ' ').trim() || '(nothing)') };
  return { ok: true, accounts: parseAccounts(r.text), raw: tail(r.text, 800) };
}
// One account's keys. The tool may ask for the password first (it does not show the question when its input is piped), so the
// password is sent right behind the command, the same way as for a new account. Nothing it prints is kept except the two keys.
async function accountKeys(c, password, username) {
  c.send(`safex_account keys ${username}`); c.send(password);
  const r = await c.expect([/Public key: ([0-9a-f]{64})[\s\S]{0,120}?Secret key: ([0-9a-f]{64})/, ERR], 30000);
  if (r.i === 0) return { ok: true, publicKey: r.match[1], secretKey: r.match[2] };
  return { ok: false, error: r.i === 1 ? r.match[1] : 'The wallet tool did not show the keys.' };
}

// Brings a seller account into this wallet from its secret key (the tool's own `safex_account recover`). The tool may ask for the
// password first, so it is sent right behind the command. The key is never echoed into an error message.
async function accountRecover(c, password, username, secretKey) {
  c.send(`safex_account recover ${username} ${secretKey}`); c.send(password);
  const r = await c.expect([/Account recovered/, /Failed to recover account/, ERR], 40000);
  if (r.i === 0) return { ok: true };
  const hide = (t) => String(t || '').split(secretKey).join('[key]').split(password).join('***');
  if (r.i === 1) return { ok: false, error: 'The wallet tool could not recover that account. Check the account name and the secret key.' };
  if (r.i === 2) return { ok: false, error: hide(r.match[1]) };
  return { ok: false, error: 'The wallet tool did not confirm the import. Last thing it said: ' + hide(tail(r.text)) };
}

// Rescan: with no block it starts from scratch, with a block it starts there. The tool is busy until it finishes, so the
// marker only comes back afterwards. Success is the absence of an error line.
async function rescan(c, from) {
  const cmd = from == null || from === '' ? 'rescan_bc' : `rescan_bc ${Number(from)}`;
  c.send(cmd);
  const r = await sentinel(c, 60 * 60 * 1000);
  if (!r.ok) return { ok: false, error: 'The wallet tool stopped answering during the rescan.' };
  const e = lastError(r.text);
  return e ? { ok: false, error: e } : { ok: true, text: r.text };
}

// Progress while the tool scans: it prints "Height 417468 / 2100086" over and over. The last pair in the output is where it is now.
const HEIGHT = /Height (\d+) \/ (\d+)/g;
function progressOf(text) {
  let m, last = null; HEIGHT.lastIndex = 0;
  while ((m = HEIGHT.exec(text))) last = m;
  if (!last) return null;
  const cur = Number(last[1]), total = Number(last[2]);
  return total > 0 && cur <= total ? { cur, total, pct: Math.min(100, Math.floor((cur * 100) / total)) } : null;
}
// Seconds left, from the first reading and the newest one. null until there is enough to go on.
function etaSeconds(first, now, total) {
  if (!first || !now || now.cur <= first.cur || now.t - first.t < 3000) return null;
  const rate = (now.cur - first.cur) / ((now.t - first.t) / 1000);
  return rate > 0 ? Math.max(0, Math.round((total - now.cur) / rate)) : null;
}

module.exports = { parseAccounts, accounts, accountKeys, accountRecover, rescan, Cli, open, quote, answer, run, sentinel, accountNew, clean, tail, progressOf, etaSeconds };
