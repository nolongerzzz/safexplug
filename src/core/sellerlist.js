'use strict';
// "My listings": the chain keeps every listing, so closing one means editing it to inactive. This builds the exact
// `safex_offer edit` command from the listing the node reports, and refuses when the command could not carry it faithfully.
const { text, idText } = require('./offers');
const { plain } = require('./market-math');

const big = (x) => { try { return BigInt(x == null ? 0 : x); } catch (_) { return 0n; } };
const rawDesc = (o) => { try { return Buffer.from(Array.isArray(o.description) ? o.description : []).toString('utf8'); } catch (_) { return ''; } };

// the listings of one seller account, newest first
function mine(offers, username) {
  const u = String(username || '').trim(); if (!u) return [];
  const out = [];
  offers.forEach((o, i) => {
    if (text(o.seller).trim() !== u) return;
    out.push({ i, id: idText(o.offer_id), title: text(o.title).trim() || '(untitled)', price: String(big(o.price)), qty: String(big(o.quantity)), active: !!o.active, pegged: !!o.price_peg_used, height: Number(o.height) || 0, ...editable(o) });
  });
  return out.sort((a, b) => b.height - a.height);
}
// can this listing be edited from the app without altering it?
function editable(o) {
  const title = text(o.title).trim();
  if (!title || /\s/.test(title)) return { canEdit: false, why: 'This listing’s name has spaces, and the wallet tool’s edit command cannot carry that.' };
  if (o.price_peg_used) return { canEdit: false, why: 'This listing is tied to a price peg, which is not supported here yet.' };
  const d = rawDesc(o);
  if (/[\r\n\t]/.test(d.trim()) || d.length > 2000) return { canEdit: false, why: 'This listing’s description cannot be sent back through the command line unchanged.' };
  if (d.trim().startsWith('{')) return { canEdit: false, why: 'This is an older marketplace listing with a structured description. Editing it here would rewrite that.' };
  return { canEdit: true };
}
// the edit command that sets a listing active (true) or inactive (false), keeping everything else as it is
// `change` may carry a new price (atomic units, what a buyer pays per unit) and/or a new quantity (whole number); anything left out stays.
function editCommand(o, username, active, change = {}) {
  const e = editable(o); if (!e.canEdit) return { ok: false, error: e.why };
  const desc = rawDesc(o).trim().replace(/\s+/g, ' ');
  const price = change.price != null ? big(change.price) : big(o.price);
  const qty = change.qty != null ? BigInt(change.qty) : big(o.quantity);
  return { ok: true, command: `safex_offer edit ${username} ${idText(o.offer_id)} ${text(o.title).trim()} ${plain(price)} ${qty} ${active ? 1 : 0} ${desc}`.trim() };
}
module.exports = { mine, editable, editCommand };
