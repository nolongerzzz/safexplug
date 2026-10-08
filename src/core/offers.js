'use strict';
// Reads the old on-chain marketplace listings straight from the user's own node (/get_safex_offers). Read-only.
// The node's reply is not clean JSON: seller keys are raw bytes dropped into strings (stray backslashes, control
// characters, bytes that are not text). So the reply is read as bytes, those key blobs are cut out (they are not
// needed to browse), and the rest is repaired just enough to parse. Nothing here ever sends or signs anything.
const http = require('http');
const { isGear } = require('./gear');

function parse(buf) {
  let s = Buffer.from(buf).toString('latin1');                       // 1 byte = 1 char, so nothing is lost or mangled
  s = s.replace(/(m_(?:spend|view)_public_key": ")[\s\S]*?(",?\r?\n)/g, '$1$2');   // raw key bytes: not needed here
  s = s.replace(/\\(?!["\\\/bfnrtu])/g, '\\\\');                      // stray backslashes
  s = s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ' ');               // raw control characters inside strings
  s = s.replace(/([:\[,]\s*)(\d{16,})(?=\s*[,}\]])/g, '$1"$2"');            // keep very large numbers exact
  const j = JSON.parse(s);
  return Array.isArray(j.offers) ? j.offers : [];
}

const text = (v) => { const s = String(v == null ? '' : v); return /[^\x00-\xff]/.test(s) ? s : Buffer.from(s, 'latin1').toString('utf8'); };
const hex = (v) => Buffer.from(String(v == null ? '' : v), 'latin1').toString('hex');
// the node sends the id as 64 readable hex characters; only a raw 32-byte id needs converting
const idText = (v) => { const t = String(v == null ? '' : v); return /^[0-9a-fA-F]{64}$/.test(t) ? t.toLowerCase() : hex(t).slice(0, 64); };
const big = (x) => { try { return BigInt(x == null ? 0 : x); } catch (_) { return 0n; } };

// description arrives as a list of byte values holding a small JSON document made by the old marketplace
function detail(o) {
  let d = {};
  try { d = JSON.parse(Buffer.from(Array.isArray(o.description) ? o.description : []).toString('utf8')); } catch (_) { d = {}; }
  const str = (k) => (typeof d[k] === 'string' ? d[k].trim() : '');
  const images = ['main_image', 'image_2', 'image_3', 'image_4'].map(str).filter(Boolean);
  return { text: str('description'), sku: str('sku'), barcode: str('barcode'), country: str('country').replace(/,+$/, ''), shipping: d.shipping === true ? 'Ships' : d.shipping === false ? 'No shipping' : '', nft: d.nft === true, images };
}

// lean row for the list; the full record stays in the main process
function row(o, i, tip) {
  const h = Number(o.height) || 0;
  const title = text(o.title).trim() || '(untitled)';
  return { i, title, gear: isGear(title), seller: text(o.seller).trim(), price: String(big(o.price)), minSfx: String(big(o.min_sfx_price)), qty: String(big(o.quantity)),
    active: !!o.active, pegged: !!o.price_peg_used, height: h, ageBlocks: tip && h ? Math.max(0, tip - h) : 0 };
}

function fetchRaw(hostport, timeout = 60000) {
  return new Promise((resolve) => {
    const m = /^([A-Za-z0-9.\-]+):(\d{2,5})$/.exec(String(hostport)); if (!m) return resolve({ ok: false, error: 'Bad node address' });
    const req = http.request({ host: m[1], port: Number(m[2]), path: '/get_safex_offers', method: 'POST', timeout, headers: { 'Content-Type': 'application/json', 'Content-Length': 2 } }, (res) => {
      const parts = []; res.on('data', (d) => parts.push(d));
      res.on('end', () => resolve(res.statusCode === 200 ? { ok: true, body: Buffer.concat(parts) } : { ok: false, error: `The node answered ${res.statusCode}. It may not allow listing queries.` }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'The node took too long to answer.' }); });
    req.on('error', () => resolve({ ok: false, error: 'Node not reachable' })); req.end('{}');
  });
}

async function load(hostport, tip) {
  const r = await fetchRaw(hostport); if (!r.ok) return r;
  let offers; try { offers = parse(r.body); } catch (e) { return { ok: false, error: 'Could not read the node\'s listing data: ' + e.message }; }
  return { ok: true, offers, rows: offers.map((o, i) => row(o, i, tip)) };
}

module.exports = { parse, detail, row, load, text, hex, idText };
