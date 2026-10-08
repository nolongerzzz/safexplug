'use strict';
// Marketplace money rules, all in exact whole units (1 SFX = 10^10). Nothing here uses floating point.
// From the wallet tool's own purchase help: "95% of cash sent is given to the seller, 5% is taken as fee".
// The transaction (network) fee is separate and is shown by the tool when you confirm.
const { UNIT, toAtomic } = require('./amounts');

const SELLER_PCT = 95n;
const MIN_PRICE = UNIT / 10000n; // 0.0001 SFX
const MAX_NAME = 80, MAX_USER = 32, MAX_DATA = 2048;

// What a buyer pays for a purchase and how it splits.
function breakdown(priceAtomic, qty) {
  const price = BigInt(priceAtomic), q = BigInt(qty);
  const total = price * q;
  const seller = total * SELLER_PCT / 100n; // rounded down: the seller is never promised more than arrives
  return { total, seller, fee: total - seller };
}

// The price to list at so that, after the 5% fee, the seller receives at least `net` per unit.
function listPriceFor(netAtomic) {
  const net = BigInt(netAtomic);
  return (net * 100n + SELLER_PCT - 1n) / SELLER_PCT; // rounded up
}

// "I want 1" -> { price, net } ; null when the amount is not a plain number or is below the lowest price allowed.
function fromNet(text) {
  const net = toAtomic(text); if (net == null) return null;
  const price = listPriceFor(net);
  if (price < MIN_PRICE) return { error: 'Lowest price the chain accepts is 0.0001 SFX.' };
  return { price, net, received: breakdown(price, 1n).seller };
}

// Plain characters only, because the wallet tool splits its commands on spaces and spaces inside names are not confirmed.
const SAFE = /^[A-Za-z0-9._,\-]+$/;
function checkUsername(u) {
  const s = String(u || '');
  if (!/^[a-z0-9_-]+$/.test(s)) return 'Account name can only use lowercase letters, digits, _ and -.';
  if (s.length > MAX_USER) return `Account name can be at most ${MAX_USER} characters.`;
  return null;
}
function checkOfferName(n) {
  const s = String(n || '');
  if (!s) return 'Give the listing a name.';
  if (!SAFE.test(s)) return 'For now a listing name can use letters, digits and . , _ - only (no spaces).';
  if (s.length > MAX_NAME) return `Listing name can be at most ${MAX_NAME} characters.`;
  return null;
}
function checkOfferDesc(d) {
  const s = String(d || '');
  if (!s) return 'Add a short description.';
  if (!SAFE.test(s)) return 'For now the description can use letters, digits and . , _ - only (no spaces).';
  if (Buffer.byteLength(s) > MAX_DATA) return `Description can be at most ${MAX_DATA} bytes.`;
  return null;
}
function checkQuantity(q) {
  const s = String(q || '').trim();
  if (!/^\d{1,9}$/.test(s) || Number(s) < 1) return 'Quantity must be a whole number, 1 or more.';
  return null;
}

// plain decimal text for the wallet tool's command line: no thousands commas, trailing zeros trimmed
function plain(atomic) { const v = BigInt(atomic); const w = (v / UNIT).toString(); const f = (v % UNIT).toString().padStart(10, '0').replace(/0+$/, ''); return f ? `${w}.${f}` : w; }

// A listing follows the same spend line as coins: ready when its Confs reads 11 (same as the History column).
// Blocks are about 2 minutes. tip = 0 means the node height is unknown, so nothing is blocked.
const READY_CONFS = 11;
function listingState(height, tip) {
  const h = Number(height) || 0, t = Number(tip) || 0;
  if (!h || !t) return { known: false, confs: 0, ready: true, remaining: 0, minutes: 0 };
  const confs = Math.max(0, t - h + 1), remaining = Math.max(0, READY_CONFS - confs);
  return { known: true, confs, ready: remaining === 0, remaining, minutes: remaining * 2 };
}

module.exports = { READY_CONFS, listingState, plain, SELLER_PCT, MIN_PRICE, breakdown, listPriceFor, fromNet, checkUsername, checkOfferName, checkOfferDesc, checkQuantity };
