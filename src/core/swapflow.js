'use strict';
// The click-through swap: the two wallets talk through a relay, so people only click. This module is the brains behind
// the buttons and the popup: it posts and answers swaps on the relay, keeps this wallet's own swaps, and works out for
// each one which step it is on, who it is waiting on, and what (if anything) the person must click next.
//   Seller posts an ASK (offer ready)        -> buyer takes it  -> buyer confirms -> seller approves -> sent
//   Buyer posts a BID (request, no offer)    -> seller answers  -> buyer confirms -> seller approves -> sent
const http = require('http');
const fs = require('fs');
const path = require('path');
const { toAtomic, fmt, UNIT } = require('./amounts');
const swap = require('./swapapi');

const STEPS = ['Posted', 'Offer ready', 'Buyer confirms', 'Seller approves and sends', 'On the network'];
const REPLY_MAX_AGE_MS = 15 * 60 * 1000;
const plain = (v) => fmt(v).replace(/,/g, '');
const field = (t, k) => { for (const l of String(t || '').replace(/\r/g, '').split('\n')) if (l.startsWith(k + ' ')) return l.slice(k.length + 1).trim(); return null; };

// ---- relay client ----
function relayCall(base, method, p, body) {
  return new Promise((resolve) => {
    let u; try { u = new URL(p, base); } catch (_) { return resolve({ ok: false, error: 'The relay address is not valid.' }); }
    const data = body == null ? null : JSON.stringify(body);
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, timeout: 6000, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, (res) => {
      let b = ''; res.on('data', (d) => (b += d));
      res.on('end', () => {
        let j = {}; try { j = JSON.parse(b || '{}'); } catch (_) {}
        if (res.statusCode < 300) return resolve({ ok: true, ...j });
        // /swaps itself always exists on a real relay, so a 404 there means a different program is answering at this address
        if (res.statusCode === 404 && u.pathname === '/swaps') return resolve({ ok: false, status: 404, wrongServer: true, error: `Something other than a swap relay is answering at ${base}. Open Relay settings and use a different address, or clear the box to use this wallet's own relay.` });
        resolve({ ok: false, status: res.statusCode, error: j.error || `The relay refused (${res.statusCode}).` });
      });
    });
    const down = () => resolve({ ok: false, down: true, error: `Cannot reach the swap relay at ${base}. Check that it is running and the address is right.` });
    req.on('timeout', () => { req.destroy(); }); req.on('error', down);
    req.end(data);
  });
}

// ---- this wallet's own swaps (role + the key the relay gave) ----
function mineStore(dir, walletName) {
  const f = path.join(dir, 'swapmine-' + String(walletName || 'wallet').replace(/[^A-Za-z0-9_.-]/g, '_') + '.json');
  const read = () => { try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); return j && j.swaps ? j : { swaps: {} }; } catch (_) { return { swaps: {} }; } };
  const write = (j) => { fs.mkdirSync(dir, { recursive: true }); const t = f + '.tmp'; fs.writeFileSync(t, JSON.stringify(j), { mode: 0o600 }); fs.renameSync(t, f); };
  return { file: f, all: () => read().swaps, get: (id) => read().swaps[id] || null, put: (id, v) => { const j = read(); j.swaps[id] = v; write(j); }, del: (id) => { const j = read(); delete j.swaps[id]; write(j); } };
}

const held = new Map();   // swap id -> a reply built for the buyer to confirm (never sent until the person clicks)

// ---- actions ----
async function post(ctx, { kind, tokens, price, dup = false }) {
  const q = toAtomic(tokens), p = toAtomic(price);
  if (!q || q % UNIT !== 0n) return { ok: false, error: 'Enter a whole number of SFT, for example 100.' };
  if (!p) return { ok: false, error: kind === 'bid' ? 'Enter the total SFX you will pay, for example 25.' : 'Enter the total SFX you want for them, for example 25.' };
  // the same swap twice would only clutter the board: reopen the one already waiting
  for (const [id, m] of dup ? [] : Object.entries(ctx.mine.all())) {
    if (m.kind === kind && m.tokens === q.toString() && m.price === p.toString()) {
      const g = await relayCall(ctx.relay, 'GET', '/swaps/' + id);
      if (g.ok && ['bid', 'offered'].includes(g.state)) return { ok: true, id, existing: true };
    }
  }
  if (kind === 'bid') {
    const r = await relayCall(ctx.relay, 'POST', '/swaps', { kind: 'bid', tokens: q.toString(), price: p.toString() });
    if (!r.ok) return r; ctx.mine.put(r.id, { role: 'buyer', kind: 'bid', key: r.key, tokens: q.toString(), price: p.toString(), created: Date.now() }); return { ok: true, id: r.id };
  }
  const o = await swap.makeOffer(ctx.wallet, ctx.st, { tokens: plain(q), price: plain(p) }); if (!o.ok) return o;
  const r = await relayCall(ctx.relay, 'POST', '/swaps', { kind: 'ask', tokens: q.toString(), price: p.toString(), offer: o.offer });
  if (!r.ok) { ctx.st.del(o.id); return r; }
  ctx.mine.put(r.id, { role: 'seller', kind: 'ask', key: r.key, offerId: o.id, tokens: q.toString(), price: p.toString(), created: Date.now() }); return { ok: true, id: r.id };
}
async function book(ctx) {
  const r = await relayCall(ctx.relay, 'GET', '/swaps'); if (!r.ok) return r;
  const mine = ctx.mine.all(), row = (s) => ({ id: s.id, tokens: fmt(s.tokens), price: fmt(s.price), mine: !!mine[s.id], mins: Math.round(s.age / 60000) });
  return { ok: true, asks: r.asks.map(row), bids: r.bids.map(row) };
}
// A buyer picks a seller's ask. Nothing is sent: the reply is built and shown for the buyer to confirm.
async function take(ctx, id) {
  const s = await relayCall(ctx.relay, 'GET', '/swaps/' + id); if (!s.ok) return s;
  if (s.kind !== 'ask' || s.state !== 'offered') return { ok: false, error: 'That offer is no longer available.' };
  if (ctx.mine.get(id)) return { ok: false, error: 'That is your own offer.' };
  ctx.mine.put(id, { role: 'buyer', kind: 'ask', key: null, created: Date.now() }); return { ok: true, id };
}
// A seller answers a buyer's request with a real offer.
async function answer(ctx, id) {
  const s = await relayCall(ctx.relay, 'GET', '/swaps/' + id); if (!s.ok) return s;
  if (s.kind !== 'bid' || s.state !== 'bid') return { ok: false, error: 'That request was already answered.' };
  if (ctx.mine.get(id)) return { ok: false, error: 'That is your own request.' };
  const o = await swap.makeOffer(ctx.wallet, ctx.st, { tokens: plain(s.tokens), price: plain(s.price) }); if (!o.ok) return o;
  const r = await relayCall(ctx.relay, 'POST', `/swaps/${id}/offer`, { offer: o.offer });
  if (!r.ok) { ctx.st.del(o.id); return r; }
  ctx.mine.put(id, { role: 'seller', kind: 'bid', key: r.key, offerId: o.id, created: Date.now() }); return { ok: true, id };
}

// Builds (once) the buyer's reply for a swap in the "offered" state and keeps it for the confirm click.
async function prepareBuyer(ctx, id, s) {
  const h = held.get(id); if (h) return h;
  const own = await ctx.wallet.address();
  const rv = swap.reviewOffer(s.offer, own);
  let out;
  if (!rv.ok) out = { error: rv.error };
  else if (rv.own) out = { error: 'This offer came from this same wallet.' };
  else if (swap.parseOffer(s.offer).tokens.toString() !== s.tokens || swap.parseOffer(s.offer).price.toString() !== s.price) out = { error: 'The offer does not match the agreed amounts. Cancel this swap.' };
  else {
    const b = await swap.buildReply(ctx.wallet, { text: s.offer });
    out = b.ok ? { reply: b.reply, fee: b.fee, total: b.total, feeAtomic: b.feeAtomic } : { error: b.error };
  }
  if (!out.error) held.set(id, out);
  return out;
}

function view(id, m, s, extra = {}) {
  const buyer = m.role === 'buyer', tokens = fmt(s.tokens), price = fmt(s.price);
  const v = { id, role: m.role, kind: m.kind, next: null, tokens, price, state: s.state, steps: STEPS, step: 1, waiting: 'other', headline: '', detail: '', action: null, canCancel: false, fee: null, total: null, txid: s.txid || null,
    gives: buyer ? price + ' SFX' : tokens + ' SFT', gets: buyer ? tokens + ' SFT' : price + ' SFX' };
  if (s.fee) v.fee = fmt(s.fee, { min: 0 });
  if (s.state === 'cancelled') { Object.assign(v, { step: 0, waiting: 'stopped', headline: 'Cancelled', detail: 'Nothing was sent. Your coins did not move.' }); return Object.assign(v, extra); }
  if (s.state === 'bid') Object.assign(v, { step: 2, headline: buyer ? 'Waiting for a seller' : '', detail: 'Your request is on the board. Next, a seller has to click it. If the seller is your other wallet: press Switch wallet (top right), unlock it, open the Swap tab and click Sell next to this request. Nothing else to do here.', canCancel: true });
  if (s.state === 'offered') {
    v.step = 3; v.canCancel = true;
    if (!buyer) Object.assign(v, { headline: 'Waiting for a buyer', detail: 'Your offer is on the board. Next, a buyer has to click it. If the buyer is your other wallet: press Switch wallet (top right), unlock it, open the Swap tab and click Buy next to this offer. Then come back here to approve.' });
    else Object.assign(v, { waiting: 'you', headline: 'Your turn: confirm', detail: 'Building your side of the swap…' });
  }
  if (s.state === 'replied') {
    v.step = 4; v.canCancel = !buyer;
    if (buyer) Object.assign(v, { headline: 'Waiting for the seller', detail: 'Your side is done and your coins have not moved. They move only when the seller approves and sends. This cannot be withdrawn from here once sent, so only the seller can stop it.' });
    else Object.assign(v, { waiting: 'you', headline: 'Your turn: approve and send', detail: 'The buyer confirmed. Check the amounts above, then approve to send the swap.', action: { key: 'approve', label: 'Approve and send' } });
  }
  // where the person goes next, when the ball is in the other wallet's court (the popup turns this into one button)
  if (v.waiting === 'other') {
    if (s.state === 'offered' && !buyer && m.kind === 'ask') v.next = { as: 'buyer', label: 'Continue as the buyer in my other wallet' };
    else if (s.state === 'offered' && !buyer) v.next = { as: 'buyer', label: 'Go to the buyer wallet to confirm' };
    else if (s.state === 'bid' && buyer) v.next = { as: 'seller', label: 'Continue as the seller in my other wallet' };
    else if (s.state === 'replied' && buyer) v.next = { as: 'seller', label: 'Go to the seller wallet to approve' };
  }
  if (s.state === 'sent') Object.assign(v, { step: 5, waiting: 'done', headline: 'Sent to the network', detail: 'The swap was sent. It shows in History once it has confirmations.' });
  return Object.assign(v, extra);
}

async function status(ctx) {
  const mine = ctx.mine.all(), out = [];
  for (const id of Object.keys(mine)) {
    const m = mine[id], r = await relayCall(ctx.relay, 'GET', '/swaps/' + id);
    if (r.down) { out.push({ id, role: m.role, waiting: 'stopped', steps: STEPS, step: 0, state: 'down', headline: 'Cannot reach the relay', detail: r.error, tokens: '', price: '', gives: '', gets: '', canCancel: true, action: null }); continue; }
    if (r.status === 404 && !r.wrongServer) { if (m.offerId) ctx.st.del(m.offerId); held.delete(id); ctx.mine.del(id); continue; }   // the relay forgot it (expired or restarted): nothing to show, nothing was sent
    if (!r.ok) { out.push({ id, role: m.role, waiting: 'stopped', steps: STEPS, step: 0, state: 'down', headline: 'Problem with the relay', detail: r.error, tokens: '', price: '', gives: '', gets: '', canCancel: true, action: null }); continue; }
    let extra = {};
    if (m.role === 'buyer' && r.state === 'offered') {
      const h = await prepareBuyer(ctx, id, r);
      if (h.error) extra = { headline: 'Problem with this offer', detail: h.error, waiting: 'stopped' };
      else extra = { fee: h.fee, total: h.total, detail: 'Check the amounts and fee above. Nothing leaves your wallet until the seller approves.', action: { key: 'confirm', label: 'Confirm and send my side' } };
    }
    out.push(view(id, m, r, extra));
  }
  return { ok: true, swaps: out };
}

async function act(ctx, id, what) {
  const m = ctx.mine.get(id); if (!m) return { ok: false, error: 'That swap is not in this wallet.' };
  if (what === 'dismiss') { held.delete(id); ctx.mine.del(id); return { ok: true }; }
  const s = await relayCall(ctx.relay, 'GET', '/swaps/' + id); if (!s.ok) return s;
  if (what === 'confirm') {
    if (m.role !== 'buyer' || s.state !== 'offered') return { ok: false, error: 'Nothing to confirm right now.' };
    const h = await prepareBuyer(ctx, id, s); if (h.error) return { ok: false, error: h.error };
    const r = await relayCall(ctx.relay, 'POST', `/swaps/${id}/reply`, { reply: h.reply, fee: h.feeAtomic, key: m.key || undefined });
    if (!r.ok) { if (r.status === 409) { ctx.mine.del(id); held.delete(id); } return r; }
    if (r.key) ctx.mine.put(id, { ...m, key: r.key }); held.delete(id); return { ok: true };
  }
  if (what === 'approve') {
    if (m.role !== 'seller' || s.state !== 'replied') return { ok: false, error: 'Nothing to approve right now.' };
    if (s.repliedAgo != null && s.repliedAgo > REPLY_MAX_AGE_MS) return { ok: false, error: 'The buyer’s reply is more than 15 minutes old, so it is not safe to use. Cancel this swap and make a new one.' };
    const sg = await swap.signReply(ctx.wallet, ctx.st, s.reply); if (!sg.ok) return sg;
    const sent = await swap.send(ctx.wallet, ctx.st, { offerId: sg.offerId, final: sg.final }); if (!sent.ok) return sent;
    await relayCall(ctx.relay, 'POST', `/swaps/${id}/sent`, { txid: sent.txid, key: m.key });
    return { ok: true, txid: sent.txid };
  }
  if (what === 'cancel') {
    if (m.role === 'seller' && m.offerId) ctx.st.del(m.offerId);
    held.delete(id);
    if (m.key) { const r = await relayCall(ctx.relay, 'POST', `/swaps/${id}/cancel`, { key: m.key }); if (!r.ok && !r.down && r.status !== 404 && r.status !== 409) return r; }
    ctx.mine.del(id); return { ok: true };
  }
  return { ok: false, error: 'Unknown action.' };
}

// Withdraws every swap of this wallet that is still only waiting (nothing signed), and drops ones the relay forgot.
async function clearWaiting(ctx) {
  let n = 0;
  for (const [id, m] of Object.entries(ctx.mine.all())) {
    const r = await relayCall(ctx.relay, 'GET', '/swaps/' + id);
    if (r.down || r.wrongServer) continue;
    const waiting = !r.ok || ['bid', 'offered', 'cancelled', 'sent'].includes(r.state) || (r.state === 'replied' && m.role === 'seller');
    if (!waiting) continue;
    if (r.ok && ['bid', 'offered', 'replied'].includes(r.state) && m.key) await relayCall(ctx.relay, 'POST', `/swaps/${id}/cancel`, { key: m.key });
    if (m.offerId) ctx.st.del(m.offerId); held.delete(id); ctx.mine.del(id); n++;
  }
  return { ok: true, cleared: n };
}

module.exports = { clearWaiting, STEPS, relayCall, mineStore, post, book, take, answer, status, act, view, held };
