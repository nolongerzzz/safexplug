#!/usr/bin/env node
'use strict';
// Stand-in for the official wallet tool, with the same habits as the real one when its input is piped:
// no password prompt is shown, every line is echoed back followed by a fresh prompt BEFORE the result,
// and questions end without a newline. Used by the tests only.
const fs = require('fs');
const args = process.argv.slice(2);
const log = (x) => { if (process.env.FAKE_CLI_LOG) fs.appendFileSync(process.env.FAKE_CLI_LOG, x + '\n'); };
log('ARGS ' + JSON.stringify(args));
const PW = process.env.FAKE_CLI_PASSWORD || 'secret-pw';
const KNOWN = (process.env.FAKE_CLI_OFFERS || 'f8b24218a748af5b18d37069b3b8d7c5041ecfbdb4990c27f2faf7c2b31d67f5').split(',');
const FEE = process.env.FAKE_CLI_FEE || '0.1340000000';
const PROMPT = '\x1b[1;33m[wallet Safex5]: \x1b[0m';
const out = (s) => process.stdout.write(s);
const ACCTS = (process.env.FAKE_CLI_ACCOUNTS || 'test1seller:my shop:Yes').split(',').filter(Boolean).map((x) => x.split(':'));
let prelimDone = false; let state = 'password', pendingCmd = null, buf = '', busy = false; const queue = [];
const tx = () => 'ab'.repeat(32);
out("This is the command line safex wallet.\nLogging to x\n");
function quoteOrPeg(cmd) { if (cmd.startsWith('safex_offer create')) { state = 'peg'; out('\nDo you want to attach this offer to a price peg?  (Y/Yes/N/No): '); } else quote(); }
function quote() { if (process.env.FAKE_CLI_PRELIM && !prelimDone) { state = 'prelim'; out('\nPurchasing 1 unit of the offer.\nIs this okay?  (Y/Yes/N/No): '); return; } state = 'fee'; out(`\nTransaction 1/1:\nThe transaction fee is ${FEE}. \nIs this okay?  (Y/Yes/N/No): `); }
function line(l) {
  if (state === 'password') {
    if (l !== PW) { out('Error loading wallet. Due to possible corruption, please remove wallet file and recreate it.\n'); process.exit(0); }
    log('PASSWORD_OK'); out('Opened wallet: Safex5xx\nUse "help" to see commands.\n'); out(PROMPT); state = 'cmd'; return;
  }
  if (state === 'newpw') { state = 'cmd'; if (l !== PW) { out('Error: invalid password\n'); } else { out('Wallet safex data saved\nNew account created\n'); } out(PROMPT); return; }
  if (state === 'keypw') { state = 'cmd'; if (l !== PW) { out('Error: invalid password\n'); } else { const u = pendingCmd; out(`Account ${u} keys:\nPublic key: ${'1'.repeat(64)}\nSecret key: ${'2'.repeat(64)}\n`); } out(PROMPT); return; }
  if (state === 'recpw') { state = 'cmd'; if (l !== PW) { out('Error: invalid password\n'); } else { ACCTS.push([pendingCmd, 'recovered', 'Yes']); out('Wallet safex data saved\nAccount recovered\n'); } out(PROMPT); return; }
  if (state === 'prelim') { log('PRELIM_ANSWER ' + l); prelimDone = true; quote(); return; }
  if (state === 'peg') { log('PEG ' + l); quote(); return; }
  if (state === 'fee') { log('FEE_ANSWER ' + l); state = 'cmd'; if (/^y/i.test(l)) out(`Transaction successfully submitted, transaction <${tx()}>\nYou can check its status by using the \`show_transfers\` command.\n`); out(PROMPT); return; }
  log('CMD ' + l);
  out(l + '\n' + PROMPT);          // echo and fresh prompt first, as the real tool does
  const w = l.split(' ').filter(Boolean);
  if (w[0] === 'exit') process.exit(0);
  if (w[0] === 'rescan_bc') { if (w[1] && !/^\d+$/.test(w[1])) { out('\r\x1b[KError: Invalid height\n' + PROMPT); return; } busy = true; setTimeout(() => { out('\r\x1b[KRefresh done, blocks received: 10\n' + PROMPT); busy = false; drain(); }, 700); return; }
  if (w[0] === 'refresh') { busy = true; out('\r\x1b[KStarting refresh...\n'); out('Height 100 / 400'); setTimeout(() => { out('\rHeight 250 / 400'); }, 250); setTimeout(() => { out('\rHeight 400 / 400\nRefresh done, blocks received: 400\n' + PROMPT); busy = false; drain(); }, 900); return; }
  if (w[0] === 'safex_purchase') { if (!KNOWN.includes(w[1])) { out('\r\x1b[KError: There is no offer with given id!!\n' + PROMPT); return; } return quote(); }
  if (w[0] === 'safex_account' && !w[1]) { const row = (a, b, c) => `#${a.padStart(15).padEnd(30)}#${b.padStart(40).padEnd(80)}#${c.padStart(7).padEnd(13)}#`; out(`\r\x1b[K${'#'.repeat(56)} Safex accounts ${'#'.repeat(55)}\n${row('Account Username', 'Account Data', 'Activated')}\n${'#'.repeat(127)}\n${ACCTS.map((a) => row(a[0], a[1] || '', a[2] || 'Yes')).join('\n')}\n${'#'.repeat(127)}\n` + PROMPT); return; }
  if (w[0] === 'safex_account' && w[1] === 'recover') { if (!/^[0-9a-f]{64}$/.test(w[3] || '')) { out('\r\x1b[KError: Failed to recover account ' + w[2] + '\n' + PROMPT); return; } pendingCmd = w[2]; state = 'recpw'; return; }
  if (w[0] === 'safex_account' && w[1] === 'keys') { pendingCmd = w[2]; state = 'keypw'; return; }
  if (w[0] === 'safex_account' && w[1] === 'new') { state = 'newpw'; return; }
  if (w[0] === 'safex_account' && w[1] === 'create') { if (process.env.FAKE_CLI_NOACCOUNT) { out('\r\x1b[KError: unknown safex account username\n' + PROMPT); return; } return quote(); }
  if (w[0] === 'stake_token' || w[0] === 'unstake_token') { if (process.env.FAKE_CLI_STAKEERR) { out('\r\x1b[KError: not enough tokens\n' + PROMPT); return; } return quote(); }
  if (w[0] === 'safex_offer' && w[1] === 'create') return quoteOrPeg(l);
  if (w[0] === 'safex_offer' && w[1] === 'edit') return quote();
  out('\r\x1b[Kunknown command: ' + w.join(' ') + '\n' + PROMPT);
}
function drain() { while (!busy && queue.length) line(queue.shift()); }
process.stdin.on('data', (d) => { buf += d.toString(); let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1); queue.push(l); } drain(); });
process.stdin.on('end', () => process.exit(0));
