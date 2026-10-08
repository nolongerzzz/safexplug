'use strict';
// The Help tab's content, and a live capture of the wallet tool's own option list so the reference can never drift from
// the tool that is actually installed.
const { spawn } = require('child_process');
const fs = require('fs');

const TOPICS = [
  { id: 'start', title: 'Getting started', body: [
    'Your wallet is a pair of files in the wallets folder, protected by your password. Unlocking opens it and connects to your own node (127.0.0.1:17402 by default). Nothing is sent to any website or account.',
    'The wallet can only show balances after it has caught up with the chain. If the numbers look low right after unlocking, wait for the sync to finish, or use Rescan from the address bar.',
    'Back up the wallet from the address bar (download icon) and keep your seed words somewhere offline. Anyone with the seed words or the keys file and password can spend your coins.' ] },
  { id: 'send', title: 'Sending SFX and SFT', body: [
    'Send shows the amount, the recipient and the network fee before anything leaves your wallet. A sent transaction cannot be undone, so check the address character by character.',
    'Tokens (SFT) move in whole units only. Cash (SFX) can have decimals. Change from a send comes back to you as a new coin and is locked for a short while until the network confirms it.' ] },
  { id: 'stake', title: 'Staking', body: [
    'Staking locks SFT so it can earn a share of the fees the network collects. Only unlocked tokens can be staked, and the Staking tab shows the exact amounts and rules the chain reports for your wallet.' ] },
  { id: 'swap', title: 'Swap: SFT for SFX', body: [
    'A swap is one ordinary transaction that both wallets sign: the seller signs the tokens, the buyer signs the cash. It uses no marketplace command, so there is no 5% marketplace fee. The only cost is the normal network fee, paid by the buyer and shown before you confirm.',
    'The five steps are Posted, Offer ready, Buyer confirms, Seller approves and sends, On the network. The machine in the popup acts out whichever step you are on. When the robot asks "Are these good?", clicking the coins confirms your side. Nothing leaves your wallet until the seller approves.',
    'Offers live on the swap board (a relay), not on the chain. An open offer expires after about an hour, a finished one disappears about 10 minutes after it completes, and a buyer reply older than 15 minutes is refused as unsafe.',
    'A seller cannot sign ahead of time, because the buyer’s signature covers its own coins and outputs. That is why the seller’s wallet has to be online at the last step.' ] },

  { id: 'market', title: 'Market and listings', body: [
    'The Market tab reads the chain’s own marketplace listings. “Active” only means the chain has no record of the listing being closed; the chain keeps old listings forever, so use the Active filter.',
    'Seller accounts have their own keys, separate from your 25 seed words. The key button shows them under \u201cSeller account keys\u201d. Back up the wallet file (it holds them in .safex_account_keys) as well as the seed words.',
    'A marketplace purchase pays a 5% share to stakers. A swap does not. The wallet tool sometimes shows a preliminary “Is this okay?” prompt before the real fee prompt, so the buy dialog may ask you to confirm twice.' ] },
  { id: 'tools', title: 'What the wallet tool is', body: [
    'The app drives the official Safex wallet programs. safex-wallet-cli is the interactive one used for setup actions such as creating a wallet or buying. safex-wallet-rpc runs quietly in the background and answers the app. On Linux the swap tool is a patched build of the same rpc that adds the swap methods.',
    'The Wallet tool options section below is captured from the installed program, so it always matches what you have.' ] },
  { id: 'errors', title: 'Common messages', body: [
    '“Cannot reach the swap relay”: the relay address is wrong or that wallet is not running. Check Relay settings on the Swap tab.',
    '“Something other than a swap relay is answering”: another program is using that port. Pick a different address, or clear the box to use this wallet’s own relay.',
    '“No wallet file”: the wallet tool has no wallet open yet. Unlock a wallet first.',
    '“The buyer’s reply is more than 15 minutes old”: cancel the swap and make a new one.',
    'Board is empty: nobody is posting right now. The Swap and Market tabs say so in words, and show a count on the Swap tab when offers exist.' ] },
];

// Runs the installed tool with --help and returns its text (or why it could not).
function cliHelp(bin, { timeout = 8000 } = {}) {
  return new Promise((resolve) => {
    if (!bin || !fs.existsSync(bin)) return resolve({ ok: false, error: 'The wallet tools are not installed yet.' });
    let out = '', done = false; const fin = (r) => { if (!done) { done = true; resolve(r); } };
    let p; try { p = spawn(bin, ['--help'], { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return fin({ ok: false, error: e.message }); }
    const to = setTimeout(() => { try { p.kill('SIGKILL'); } catch (_) {} fin({ ok: false, error: 'The tool did not answer in time.' }); }, timeout);
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
    p.on('error', (e) => { clearTimeout(to); fin({ ok: false, error: e.message }); });
    p.on('close', () => { clearTimeout(to); const t = out.replace(/\r/g, '').trim(); fin(t ? { ok: true, text: t.slice(0, 40000) } : { ok: false, error: 'The tool printed no help text.' }); });
  });
}
module.exports = { TOPICS, cliHelp };
