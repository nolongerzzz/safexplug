'use strict';
// Two-step send. Step 1 (prepare) asks the wallet tool to BUILD the transaction without relaying it, so the
// screen can show the exact amount and fee. Step 2 (confirm) relays that exact transaction. Nothing leaves the
// wallet until the person confirms, and the confirmed transaction is the one they were shown.
const { toAtomic, looksLikeAddress, fmt, UNIT } = require('./amounts');

const LOCKED_CASH = 'No spendable SFX right now. Every send pays a small network fee in SFX, and the leftover from your last send stays locked for 10 confirmations (about 20 minutes). Wait for the "available" amount under your SFX balance to show, then try again.';
// The wallet tool's own wording for "could not build it" is cryptic; explain the usual cause.
const friendly = (m) => (NEEDS_SWEEP.test(String(m)) ? SWEEP_HINT : /tx not possible|transaction not possible/i.test(String(m)) ? 'Not possible as asked: gathering that many coins costs more in fees than what is left over. Try a smaller amount (leave a few SFX out), or a smaller ring size.' : /no transaction created|transaction was not constructed/i.test(String(m)) ? 'The wallet could not build this transaction. The usual cause is that part of your coins is still locked from a recent send (or there is no spendable SFX for the fee). Wait for the "available" amounts to catch up and try again.' : String(m));
const NEEDS_SWEEP = /not enough outputs|sweep_dust|sweep_unmixable|unmixable/i;
const SWEEP_HINT = 'Not enough outputs to hide this send among. Some of your coins are "dust" (old tiny coins the network cannot mix yet). Use the "Sweep dust" button under your SFX balance: it sends those coins to your own address in new, mixable coins (a small fee), then your send will go through.';
const PRIORITY = 1;      // default priority
const RING_SIZE = 7;     // safexcore DEFAULT_MIX 6 + the real input
const RING_MIN = 3, RING_MAX = 15;
const SPLIT_MIN = 2, SPLIT_MAX = 20;
const RESERVE = 10000000000n; // 1 SFX kept back when splitting SFX, so the fee can be paid from what is left over
// A smaller ring makes the transaction a little smaller (slightly lower fee) but hides you among fewer decoys, and the
// network may refuse rings below its own minimum; the wallet tool then says so and nothing is sent.
function ring(n) { if (n == null || n === '') return RING_SIZE; const v = Number(n); return Number.isInteger(v) && v >= RING_MIN && v <= RING_MAX ? v : null; }
const RING_BAD = `Ring size must be a whole number from ${RING_MIN} to ${RING_MAX}.`;

function check({ kind, address, amount }) {
  if (kind !== 'cash' && kind !== 'token') return { error: 'Choose Cash or Tokens.' };
  if (!looksLikeAddress(address)) return { error: 'That does not look like a Safex address.' };
  const atomic = toAtomic(amount);
  if (atomic == null) return { error: 'Enter an amount above zero (up to 10 decimal places).' };
  // Checked live against the wallet tool: tokens only move in whole units; any fraction is refused with "destination amount is zero".
  if (kind === 'token' && atomic % UNIT !== 0n) return { error: 'Tokens only move in whole units. Enter a whole number of SFT, for example 25.' };
  return { atomic, address: String(address).trim() };
}

const NOT_FIT = /not possible|not enough|insufficient|unlocked/i;
// "Send everything": SFT is the whole unlocked tokens (the fee is paid in SFX, separately). SFX has to leave room for its own fee,
// and the fee depends on how many coins the wallet gathers, so try an amount, read the real fee, and move toward
// (available - fee). Keeps the largest amount the wallet accepts. Nothing is sent: every build is do_not_relay.
async function buildMax(wallet, kind, address, have, rs) {
  const method = kind === 'cash' ? 'transfer' : 'transfer_token';
  const build = (amt) => wallet.rpc(method, { destinations: [{ amount: amt, address }], account_index: 0, priority: PRIORITY, ring_size: rs,
    get_tx_key: false, do_not_relay: true, get_tx_hex: false, get_tx_metadata: true });
  if (kind === 'token') { const amt = have - (have % UNIT); if (amt <= 0n) return { error: 'You need at least 1 whole SFT available to send.' }; return { amt, r: await build(amt) }; }
  let amt = have - 3000000000n, step = 1500000000n, best = null, lastErr = null; // start 0.3 SFX under, then adjust by the real fee
  for (let i = 0; i < 14 && amt > 0n; i++) {
    try {
      const r = await build(amt); const fee = BigInt(r.fee || 0);
      if (!best || amt > best.amt) best = { amt, r };
      const cand = have - fee; if (cand <= amt) break; amt = cand; // the fee is lower than the room we left: use the room
    } catch (e) { lastErr = e; if (!NOT_FIT.test(String(e.message))) throw e; if (best) break; amt -= step; step *= 2n; }
  }
  if (!best) return { error: 'The wallet could not fit a transaction for everything. Usually it holds many tiny coins that each cost a fee to spend. Send a smaller amount first, a few times, to gather them.' + (lastErr ? ' (' + String(lastErr.message).slice(0, 80) + ')' : '') };
  return best;
}

async function prepare(wallet, { kind, address, amount, ringSize, max }) {
  const rs = ring(ringSize); if (rs == null) return { ok: false, error: RING_BAD };
  const c = max ? (kind !== 'cash' && kind !== 'token' ? { error: 'Choose Cash or Tokens.' } : !looksLikeAddress(address) ? { error: 'That does not look like a Safex address.' } : { address: String(address).trim() })
    : check({ kind, address, amount });
  if (c.error) return { ok: false, error: c.error };
  const bal = await wallet.balance();
  const have = BigInt(kind === 'cash' ? bal.cashUnlocked : bal.tokensUnlocked);
  if (!max && c.atomic > have) return { ok: false, error: `Not enough unlocked ${kind === 'cash' ? 'Cash' : 'Tokens'}: you have ${fmt(have)} available.` };
  // Every send, tokens included, pays its network fee in SFX, so some spendable SFX is needed even for a token send.
  if (BigInt(bal.cashUnlocked) <= 0n) return { ok: false, error: LOCKED_CASH };
  const method = kind === 'cash' ? 'transfer' : 'transfer_token';
  try {
    let r, atomic = c.atomic;
    if (max) { const m = await buildMax(wallet, kind, c.address, have, rs); if (m.error) return { ok: false, error: m.error }; r = m.r; atomic = m.amt; }
    else r = await wallet.rpc(method, { destinations: [{ amount: c.atomic, address: c.address }], account_index: 0, priority: PRIORITY, ring_size: rs,
      get_tx_key: false, do_not_relay: true, get_tx_hex: false, get_tx_metadata: true });
    if (!r.tx_metadata) return { ok: false, error: 'The wallet tool did not return a transaction to confirm. Nothing was sent.' };
    return { ok: true, kind, address: c.address, amount: String(atomic), fee: String(r.fee), txid: r.tx_hash, metadata: r.tx_metadata, max: !!max, before: { cash: bal.cash, tokens: bal.tokens } };
  } catch (e) { return { ok: false, error: friendly(e.message) }; }
}

// One transaction that pays SFX and SFT together to one address. Needs the wallet tool's transfer_mixed (the tool that ships with this app);
// the official release tool does not have it. Nothing is relayed here; confirm() relays the exact transaction that was built.
async function prepareMixed(wallet, { address, amount, tokenAmount, ringSize }) {
  const rs = ring(ringSize); if (rs == null) return { ok: false, error: RING_BAD };
  const cc = check({ kind: 'cash', address, amount }); if (cc.error) return { ok: false, error: cc.error };
  const tc = check({ kind: 'token', address, amount: tokenAmount }); if (tc.error) return { ok: false, error: tc.error };
  const bal = await wallet.balance();
  if (cc.atomic > BigInt(bal.cashUnlocked)) return { ok: false, error: `Not enough unlocked Cash: you have ${fmt(BigInt(bal.cashUnlocked))} available.` };
  if (tc.atomic > BigInt(bal.tokensUnlocked)) return { ok: false, error: `Not enough unlocked Tokens: you have ${fmt(BigInt(bal.tokensUnlocked))} available.` };
  try {
    const r = await wallet.rpc('transfer_mixed', { address: cc.address, amount: cc.atomic, token_amount: tc.atomic, account_index: 0, priority: PRIORITY, ring_size: rs,
      get_tx_key: false, do_not_relay: true, get_tx_hex: false, get_tx_metadata: true });
    if (!r.tx_metadata) return { ok: false, error: 'The wallet tool did not return a transaction to confirm. Nothing was sent.' };
    return { ok: true, kind: 'cash', mixed: true, address: cc.address, amount: String(cc.atomic), tokenAmount: String(tc.atomic), fee: String(r.fee), txid: r.tx_hash, metadata: r.tx_metadata, before: { cash: bal.cash, tokens: bal.tokens } };
  } catch (e) {
    if (/method not found/i.test(String(e.message))) return { ok: false, error: 'This wallet tool cannot send SFX and SFT in one transaction. Send them one after the other instead.' };
    return { ok: false, error: friendly(e.message) };
  }
}

// Split: pay yourself several equal coins in ONE transaction (one fee), so later small sends only lock one coin.
async function prepareSplit(wallet, { kind, parts, ringSize, amount }) {
  if (kind !== 'cash' && kind !== 'token') return { ok: false, error: 'Choose Cash or Tokens.' };
  const rs = ring(ringSize); if (rs == null) return { ok: false, error: RING_BAD };
  const n = Number(parts); if (!Number.isInteger(n) || n < SPLIT_MIN || n > SPLIT_MAX) return { ok: false, error: `Choose between ${SPLIT_MIN} and ${SPLIT_MAX} coins.` };
  const bal = await wallet.balance();
  if (BigInt(bal.cashUnlocked) <= 0n) return { ok: false, error: LOCKED_CASH };
  const have = BigInt(kind === 'cash' ? bal.cashUnlocked : bal.tokensUnlocked);
  // Optional "amount to split": split just that much, and the wallet gathers only the coins it needs for it. Left empty it
  // splits everything available (minus a reserve for the fee), which can fail on a wallet full of tiny coins.
  let total = kind === 'cash' ? have - RESERVE : have;
  if (amount != null && String(amount).trim() !== '') {
    const a = toAtomic(amount); if (a == null) return { ok: false, error: 'Enter the amount to split as a number above zero, or leave it empty to split everything.' };
    if (a > have) return { ok: false, error: `You only have ${fmt(have)} ${kind === 'cash' ? 'SFX' : 'SFT'} available.` };
    total = a;
  }
  let piece = total > 0n ? total / BigInt(n) : 0n;
  if (kind === 'token') piece -= piece % UNIT; // whole tokens only
  if (piece <= 0n) return { ok: false, error: kind === 'cash' ? `Not enough spendable SFX to split into ${n} coins (1 SFX is kept back for the fee).` : `Not enough spendable Tokens to split into ${n} coins.` };
  const address = await wallet.address();
  const method = kind === 'cash' ? 'transfer' : 'transfer_token';
  try {
    const r = await wallet.rpc(method, { destinations: Array.from({ length: n }, () => ({ amount: piece, address })), account_index: 0, priority: PRIORITY, ring_size: rs,
      get_tx_key: false, do_not_relay: true, get_tx_hex: false, get_tx_metadata: true });
    if (!r.tx_metadata) return { ok: false, error: 'The wallet tool did not return a transaction to confirm. Nothing was sent.' };
    return { ok: true, split: true, kind, parts: n, piece: String(piece), address, amount: String(piece * BigInt(n)), fee: String(r.fee), txid: r.tx_hash, metadata: r.tx_metadata, before: { cash: bal.cash, tokens: bal.tokens } };
  } catch (e) { return { ok: false, error: friendly(e.message) }; }
}

// Sweep dust: the wallet tool's own command that moves unmixable coins into new ones at your own address. Built without relaying,
// so the fee is shown first; confirm relays every transaction it built.
// Cash only. The wallet tool can also build a token sweep, but the network refuses it: the node's minimum-ring check only looks at
// cash inputs, so a token sweep (ring size 0, paid for with an ordinary cash input) is rejected as "too low ring size" (live: "Failed to commit tx").
async function prepareSweep(wallet) {
  const bal = await wallet.balance();
  if (BigInt(bal.cashUnlocked) <= 0n) return { ok: false, error: LOCKED_CASH };
  const sum = (a) => (a || []).reduce((t, x) => t + BigInt(x || 0), 0n);
  try {
    const rc = await wallet.rpc('sweep_dust', { get_tx_keys: false, do_not_relay: true, get_tx_hex: false, get_tx_metadata: true });
    const cm = (rc.tx_metadata_list || []).filter(Boolean);
    if (!cm.length) return { ok: false, error: 'No dust found. Nothing needs sweeping, so "not enough outputs" has another cause (for example the node has too few coins to build the ring from).' };
    return { ok: true, sweep: true, kind: 'cash', metadata: cm, cashTxs: cm.length, fee: String(sum(rc.fee_list)), amount: String(sum(rc.amount_list)),
      txids: rc.tx_hash_list || [], txid: (rc.tx_hash_list || [])[0] || '', address: await wallet.address(), before: { cash: bal.cash, tokens: bal.tokens } };
  } catch (e) { return { ok: false, error: /method not found/i.test(String(e.message)) ? 'This wallet tool version has no sweep_dust command.' : String(e.message) }; }
}

async function confirm(wallet, prepared) {
  if (!prepared || !prepared.metadata) return { ok: false, error: 'Nothing to confirm.' };
  if (Array.isArray(prepared.metadata)) {
    let n = 0;
    try { for (const m of prepared.metadata) { await wallet.rpc('relay_tx', { hex: m }); n++; } return { ok: true, txid: prepared.txid, txids: prepared.txids || [prepared.txid], count: n }; }
    catch (e) { return { ok: false, error: (n ? `${n} of ${prepared.metadata.length} sent, then: ` : '') + e.message }; }
  }
  try { await wallet.rpc('relay_tx', { hex: prepared.metadata }); return { ok: true, txid: prepared.txid }; }
  catch (e) { return { ok: false, error: e.message }; }
}

module.exports = { prepare, prepareMixed, prepareSplit, prepareSweep, NEEDS_SWEEP, ring, confirm, check, friendly, LOCKED_CASH, PRIORITY, RING_SIZE };
