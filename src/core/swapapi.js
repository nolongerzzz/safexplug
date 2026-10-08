'use strict';
// Co-signed SFT <-> SFX swap: the wallet tool does the cryptography (swap_* methods); this module is the "brains behind
// the buttons": it validates what the person typed, parses the text that is handed between the two wallets, keeps the
// seller's private state, and turns tool errors into plain sentences.
//   Seller: makeOffer -> (buyer sends back a reply) -> signReply -> send
//   Buyer : reviewOffer -> buildReply (shows fee) -> hand the reply to the seller
// Quantities are whole tokens; the wallet tool wants atomic units (10^10 per token), so everything is BigInt here.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { toAtomic, fmt, UNIT } = require('./amounts');

const OFFER_HEAD = 'SAFEXSWAP1 PREPARE', REPLY_HEAD = 'SAFEXSWAP1 PARTIAL', MAX_TEXT = 200000;

// Is this wallet tool new enough to know the swap steps? (The official 7.0.3 tool does not.)
async function supported(wallet) {
  try { await wallet.rpc('swap_submit', { final_tx: '' }); return true; }
  catch (e) { return !(e && (e.code === -32601 || /method not found/i.test(String(e.message)))); }
}

const lines = (t) => String(t || '').replace(/\r/g, '').split('\n');
const field = (t, k) => { for (const l of lines(t)) if (l.startsWith(k + ' ')) return l.slice(k.length + 1).trim(); return null; };
const clean = (t) => String(t || '').trim();

function parseOffer(text) {
  const t = clean(text);
  if (!t) return { ok: false, error: 'Paste the offer text first.' };
  if (t.length > MAX_TEXT) return { ok: false, error: 'That text is too long to be an offer.' };
  if (lines(t)[0].trim() !== OFFER_HEAD) return { ok: false, error: 'That is not a swap offer. Paste the whole text the seller sent, starting with "SAFEXSWAP1 PREPARE".' };
  const qty = field(t, 'qty'), price = field(t, 'price'), seller = field(t, 'seller');
  if (!/^\d{1,20}$/.test(qty || '') || !/^\d{1,20}$/.test(price || '') || !seller) return { ok: false, error: 'The offer text is damaged. Ask the seller to copy it again.' };
  const q = BigInt(qty), p = BigInt(price);
  if (q <= 0n || q % UNIT !== 0n || p <= 0n) return { ok: false, error: 'The offer has an invalid amount.' };
  return { ok: true, text: t, tokens: q, price: p, seller };
}
function parseReply(text) {
  const t = clean(text);
  if (!t) return { ok: false, error: 'Paste the buyer’s reply first.' };
  if (t.length > MAX_TEXT) return { ok: false, error: 'That text is too long to be a reply.' };
  if (lines(t)[0].trim() !== REPLY_HEAD) return { ok: false, error: 'That is not a buyer reply. Paste the whole text the buyer sent, starting with "SAFEXSWAP1 PARTIAL".' };
  const qty = field(t, 'qty'), price = field(t, 'price');
  return { ok: true, text: t, qty, price };
}

// Plain-language errors from the wallet tool.
function friendly(e) {
  const m = String((e && e.message) || e || '');
  if (/not enough unlocked tokens|not enough tokens/i.test(m)) return 'Not enough unlocked SFT for this. Wait for locked tokens to unlock, or offer fewer.';
  if (/not enough (unlocked )?(money|cash|sfx)/i.test(m)) return 'Not enough unlocked SFX to pay the price and the network fee.';
  if (/wallet tool is not running/i.test(m)) return 'The wallet tool is not running. Lock and unlock the wallet, then try again.';
  if (/did not answer in time/i.test(m)) return 'The wallet tool took too long. Try again in a moment.';
  if (/ring|decoy|not enough outs|get_outs/i.test(m)) return 'The node could not supply enough other coins to hide yours among. Try again, or use a smaller ring size in Send first.';
  if (/different network|network/i.test(m) && /swap|offer/i.test(m)) return 'This offer is for a different network.';
  return m.slice(0, 400) || 'The wallet tool reported a problem.';
}

// Seller's private state, one small file per wallet. It holds ring data for the seller's own coins, not keys.
function store(dir, walletName) {
  const f = path.join(dir, 'swaps-' + String(walletName || 'wallet').replace(/[^A-Za-z0-9_.-]/g, '_') + '.json');
  const read = () => { try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); return j && typeof j === 'object' && j.offers ? j : { offers: {} }; } catch (_) { return { offers: {} }; } };
  const write = (j) => { fs.mkdirSync(dir, { recursive: true }); const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(j), { mode: 0o600 }); fs.renameSync(tmp, f); };
  return {
    file: f,
    list: () => Object.entries(read().offers).map(([id, o]) => ({ id, tokens: o.tokens, price: o.price, created: o.created, offer: o.offer || '' })).sort((a, b) => b.created - a.created),
    get: (id) => read().offers[id] || null,
    put: (id, o) => { const j = read(); j.offers[id] = o; write(j); },
    del: (id) => { const j = read(); delete j.offers[id]; write(j); },
  };
}

// ---- buyer-started swaps: the buyer sends a request (how many SFT, for how much); the seller answers it with a normal offer ----
const REQ_HEAD = 'SAFEXSWAP1 REQUEST';
function makeRequest({ tokens, price }) {
  const q = toAtomic(tokens), p = toAtomic(price);
  if (!q || q % UNIT !== 0n) return { ok: false, error: 'Enter a whole number of SFT, for example 100.' };
  if (!p) return { ok: false, error: 'Enter the total SFX you are willing to pay, for example 25.' };
  return { ok: true, request: `${REQ_HEAD}\nqty ${q}\nprice ${p}\n`, tokens: fmt(q), price: fmt(p) };
}
function readRequest(text) {
  const t = clean(text);
  if (!t) return { ok: false, error: 'Paste the buyer\u2019s request first.' };
  if (t.length > 2000 || lines(t)[0].trim() !== REQ_HEAD) return { ok: false, error: 'That is not a swap request. Paste the whole text the buyer sent, starting with "SAFEXSWAP1 REQUEST".' };
  const qty = field(t, 'qty'), price = field(t, 'price');
  if (!/^\d{1,20}$/.test(qty || '') || !/^\d{1,20}$/.test(price || '')) return { ok: false, error: 'The request text is damaged. Ask the buyer to copy it again.' };
  const q = BigInt(qty), p = BigInt(price);
  if (q <= 0n || q % UNIT !== 0n || p <= 0n) return { ok: false, error: 'The request has an invalid amount.' };
  return { ok: true, tokens: fmt(q).replace(/,/g, ''), price: fmt(p).replace(/,/g, '') };
}

// ---- seller ----
async function makeOffer(wallet, st, { tokens, price, ringSize }) {
  const q = toAtomic(tokens), p = toAtomic(price);
  if (!q || q % UNIT !== 0n) return { ok: false, error: 'Enter a whole number of SFT, for example 100.' };
  if (!p) return { ok: false, error: 'Enter the total SFX you want for them, for example 25.' };
  let r;
  try { r = await wallet.rpc('swap_sell_prepare', { tokens: q, price: p, ring_size: Number(ringSize) || 0 }); } catch (e) { return { ok: false, error: friendly(e) }; }
  if (!r.public_part || !r.secret_part) return { ok: false, error: 'The wallet tool sent back an empty offer.' };
  const id = crypto.createHash('sha256').update(r.public_part).digest('hex').slice(0, 12);
  st.put(id, { tokens: q.toString(), price: p.toString(), secret: r.secret_part, offer: r.public_part, created: Date.now() });
  return { ok: true, id, offer: r.public_part, tokens: fmt(q), price: fmt(p) };
}
// Checks the buyer's reply against the stored offers and returns what would be signed. Nothing is sent yet.
async function signReply(wallet, st, text) {
  const rp = parseReply(text); if (!rp.ok) return rp;
  const cands = st.list().filter((o) => o.tokens === rp.qty && o.price === rp.price);
  if (!cands.length) return { ok: false, error: 'This reply does not match any offer you made on this wallet. Check that it is for the right offer, and that you are in the same wallet.' };
  let last = null;
  for (const c of cands) {
    try {
      const r = await wallet.rpc('swap_sell_sign', { partial: rp.text, secret_part: st.get(c.id).secret });
      if (!r.final_tx) { last = new Error('The wallet tool signed nothing.'); continue; }
      return { ok: true, offerId: c.id, final: r.final_tx, summary: String(r.summary || ''), tokens: fmt(c.tokens), price: fmt(c.price) };
    } catch (e) { last = e; }
  }
  return { ok: false, error: friendly(last) };
}
async function send(wallet, st, { offerId, final }) {
  let r;
  try { r = await wallet.rpc('swap_submit', { final_tx: final }); } catch (e) { return { ok: false, error: friendly(e) }; }
  if (!r.tx_hash) return { ok: false, error: 'The node did not accept the swap.' };
  if (offerId) st.del(offerId);
  return { ok: true, txid: String(r.tx_hash) };
}

// ---- buyer ----
function reviewOffer(text, ownAddress) {
  const o = parseOffer(text); if (!o.ok) return o;
  return { ok: true, tokens: fmt(o.tokens), price: fmt(o.price), seller: o.seller, own: !!ownAddress && o.seller === ownAddress, text: o.text };
}
async function buildReply(wallet, { text, ringSize, priority }) {
  const o = parseOffer(text); if (!o.ok) return o;
  let r;
  try { r = await wallet.rpc('swap_buy_build', { public_part: o.text, ring_size: Number(ringSize) || 0, priority: Number(priority) || 1 }); } catch (e) { return { ok: false, error: friendly(e) }; }
  if (!r.partial) return { ok: false, error: 'The wallet tool built nothing.' };
  return { ok: true, reply: r.partial, fee: fmt(r.fee, { min: 0 }), feeAtomic: String(r.fee == null ? 0 : r.fee), tokens: fmt(o.tokens), price: fmt(o.price), total: fmt(BigInt(o.price) + BigInt(r.fee || 0)) };
}

module.exports = { makeRequest, readRequest, supported, parseOffer, parseReply, friendly, store, makeOffer, signReply, send, reviewOffer, buildReply };
