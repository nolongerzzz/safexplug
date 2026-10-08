'use strict';
// Stand-in for safex-wallet-rpc: same JSON-RPC shapes, in-memory state. Records every call so tests can prove
// that "prepare" never relays and that only confirm does.
const http = require('http');
function start({ cash = '1000000000000', tokens = '5000000000000', port = 0, addr = 'Safex' + '1'.repeat(93) } = {}) {
  const st = { height: 0, calls: [], relayed: [], cash, tokens, unlocked: { cash, tokens }, failTransfer: null };
  const history = { out: [{ txid: 'cc'.repeat(32), height: 101, timestamp: 1700000100, amount: 0, token_amount: 20000000000, token_transaction: true, fee: '150000000', address: 'SafexTEST', destinations: [{ amount: 20000000000, address: 'SafexDEST' }, { amount: 0, address: 'SafexDEST' }] }], in: [{ txid: 'aa'.repeat(32), height: 100, timestamp: 1700000000, amount: 1000000000000, token_amount: 0, token_transaction: false, fee: '18446744066049551616', address: 'SafexTEST' }] };
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
      const q = JSON.parse(b.replace(/([:\[,]\s*)(\d{16,})(?=\s*[,}\]])/g, '$1"$2"')); st.calls.push({ method: q.method, params: q.params });
      const ok = (result) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: q.id, result })); };
      const bad = (message, code = -1) => res.end(JSON.stringify({ jsonrpc: '2.0', id: q.id, error: { code, message } }));
      switch (q.method) {
        case 'open_wallet': if (q.params.password !== 'test-pass') return bad('Failed to open wallet'); st.opened = q.params.filename; return ok({});
        case 'get_balance': return ok({ balance: st.cash, unlocked_balance: st.unlocked.cash, token_balance: st.tokens, unlocked_token_balance: st.unlocked.tokens, staked_tokens: st.staked || 0, unlocked_staked_tokens: st.staked || 0 });
        case 'query_key': return ok({ key: (q.params && q.params.key_type === 'view_key') ? 'ab'.repeat(32) : (q.params && q.params.key_type === 'spend_key') ? 'cd'.repeat(32) : Array.from({ length: 25 }, (_, i) => 'word' + (i + 1)).join(' ') });
        case 'get_available_interest': return ok({ interest: '125000000000' });
        case 'get_address': return ok({ address: addr });
        case 'get_height': return ok({ height: st.height || 123 });
        case 'refresh': return ok({ blocks_fetched: 0, received_money: false });
        case 'get_transfers': return ok(history);
        case 'transfer': case 'transfer_token': {
          if (st.failTransfer) return bad(st.failTransfer);
          const d = q.params.destinations[0];
          return ok({ tx_hash: 'bb'.repeat(32), fee: '100000000', amount: d.amount, tx_metadata: 'meta:' + q.method + ':' + d.amount + ':x' + q.params.destinations.length });
        }
        case 'sweep_dust': { if (st.noDust) return ok({}); return ok({ tx_hash_list: ['dd'.repeat(32), 'ee'.repeat(32)], fee_list: ['100000000', '200000000'], amount_list: ['5000000000', '7000000000'], tx_metadata_list: ['meta:sweep1', 'meta:sweep2'] }); }
        case 'transfer_mixed': { if (st.noMixed) return bad('Method not found', -32601); if (st.failTransfer) return bad(st.failTransfer); return ok({ tx_hash: 'bc'.repeat(32), fee: '150000000', amount: q.params.amount, tx_metadata: 'meta:mixed:' + q.params.amount + ':' + q.params.token_amount }); }
        case 'relay_tx': st.relayed.push(q.params.hex); return ok({ tx_hash: 'bb'.repeat(32) });
        case 'swap_sell_prepare': { if (st.noSwap) return bad('Method not found', -32601); const h = `network 0\nseller ${addr}\nqty ${q.params.tokens}\nprice ${q.params.price}\n`; return ok({ public_part: 'SAFEXSWAP1 PREPARE\n' + h + 'input x\n', secret_part: 'SAFEXSWAP1 STATE\n' + h + 'source y\n' }); }
        case 'swap_buy_build': { if (st.noSwap) return bad('Method not found', -32601); const pp = q.params.public_part; const g = (k) => (new RegExp('^' + k + ' (.*)$', 'm').exec(pp) || [])[1]; return ok({ partial: `SAFEXSWAP1 PARTIAL\nnetwork 0\nseller ${g('seller')}\nqty ${g('qty')}\nprice ${g('price')}\nfee 20000000\ntx abcd\n`, fee: 20000000 }); }
        case 'swap_sell_sign': { if (st.noSwap) return bad('Method not found', -32601); if (!/^SAFEXSWAP1 STATE/.test(q.params.secret_part)) return bad('bad state'); if (st.failSign) return bad(st.failSign); return ok({ final_tx: 'SAFEXSWAP1 FINAL\nnetwork 0\ntxid ' + 'cc'.repeat(32) + '\ntx abcd\n', summary: 'ok summary' }); }
        case 'swap_submit': { if (st.noSwap) return bad('Method not found', -32601); if (!q.params.final_tx) return bad('empty'); st.relayed.push(q.params.final_tx); return ok({ tx_hash: 'cc'.repeat(32) }); }
        default: return bad('Method not found', -32601);
      }
    });
  });
  return new Promise((r) => srv.listen(port, '127.0.0.1', () => r({ st, port: srv.address().port, close: () => new Promise((x) => srv.close(x)) })));
}
// Stand-in for safexd: only get_info.
function startNode({ height = 2098731, target = 2098731 } = {}) {
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
    if (req.url === '/get_interest_map') { const q = JSON.parse(b || '{}'); const out = []; for (let i = q.begin_interval; i <= q.end_interval; i++) out.push({ cash_per_token: i === 1441 ? 5 : i === 1347 ? 534 : 0, interval: i }); res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ interest_per_interval: out, status: 'OK' })); }
    if (req.url === '/get_safex_offers') { res.setHeader('Content-Type', 'application/json'); return res.end(offersBody()); }
    const hx = (i) => i.toString(16).padStart(64, '0'); const TX = hx(777);
    const hdr = (h) => ({ height: h, hash: hx(h), prev_hash: hx(h - 1), timestamp: 1790000000 + h * 120, difficulty: 28000000, reward: 400e10, block_size: 1500 + h % 7, num_txes: h % 3, nonce: 99, depth: height - h, major_version: 8, orphan_status: false });
    if (req.url === '/get_transaction_pool') { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ status: 'OK', transactions: [{ id_hash: hx(901), blob_size: 1700, fee: 300000000, receive_time: 1790000050 }] })); }
    if (req.url === '/gettransactions') { res.setHeader('Content-Type', 'application/json'); const q = JSON.parse(b || '{}'); if (q.txs_hashes[0].startsWith('ff')) return res.end(JSON.stringify({ missed_tx: q.txs_hashes, status: 'OK' }));
      return res.end(JSON.stringify({ status: 'OK', txs: [{ as_hex: 'ab'.repeat(900), block_height: height - 3, in_pool: false, as_json: JSON.stringify({ vin: [{ key: { key_offsets: [1, 2, 3, 4, 5, 6, 7] } }], vout: [{ amount: 0 }, { amount: 0 }], rct_signatures: { txnFee: 1340000000 } }) }] })); }
    if (req.url === '/json_rpc') { const q = JSON.parse(b || '{}'); const ok = (r) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: '0', result: { status: 'OK', ...r } })); };
      if (q.method === 'get_last_block_header') return ok({ block_header: hdr(height) });
      if (q.method === 'get_block_headers_range') { const hs = []; for (let h = q.params.start_height; h <= q.params.end_height; h++) hs.push(hdr(h)); return ok({ headers: hs }); }
      if (q.method === 'get_block') { const h = q.params.height; if (h === undefined || h > height) { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ jsonrpc: '2.0', id: '0', error: { code: -2, message: h === undefined ? "Internal error: can't get block by hash." : 'Requested block height is too big.' } })); }
        return ok({ block_header: hdr(h), miner_tx_hash: hx(h + 5e6), tx_hashes: [TX], json: JSON.stringify({ miner_tx: { vout: [{ amount: 400e10 }] }, tx_hashes: [TX] }) }); } }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: '0', result: { height, target_height: target, synchronized: height >= target } })); }); });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ port: srv.address().port, close: () => new Promise((x) => srv.close(x)) })));
}
// A reply shaped like the real node's: raw key bytes in strings (stray backslashes, control characters, high bytes).
function offersBody() {
  const desc = (o) => [...Buffer.from(typeof o === 'string' ? o : JSON.stringify(o))].join(',');
  const key = Buffer.from([0x5c, 0x76, 0x0b, 0xca, 0x9b, 0x5c, 0x5c, 0x1f, 0xff, 0x61]);
  const one = (o) => Buffer.concat([Buffer.from(`{\r\n    "active": ${o.active},\r\n    "description": [${desc(o.d)}],\r\n    "height": ${o.height},\r\n    "min_sfx_price": ${o.min || 0},\r\n    "offer_id": "${o.id}",\r\n    "price": ${o.price},\r\n    "price_peg_id": "",\r\n    "price_peg_used": ${!!o.peg},\r\n    "quantity": ${o.qty},\r\n    "seller": "${o.seller}",\r\n    "seller_address": {\r\n      "m_spend_public_key": "`, 'latin1'), key,
    Buffer.from('",\r\n      "m_view_public_key": "', 'latin1'), key, Buffer.from(`"\r\n    },\r\n    "title": "${o.title}"\r\n  }`, 'latin1')]);
  const list = [
    { active: true, d: { description: 'Warm gel for sore muscles', sku: 'GEL-8', barcode: 'B000AAA', country: 'US,', shipping: true, main_image: 'https://example.invalid/a.jpg' }, height: 838210, price: 190700000000, qty: 1500, seller: 'sombra', title: 'Sombra Warm Gel', id: 'f8b24218a748af5b18d37069b3b8d7c5041ecfbdb4990c27f2faf7c2b31d67f5' },
    { active: false, d: { description: 'Camera' }, height: 1104436, price: 5850000000000, qty: 20, seller: 'focuscamera', title: 'Panasonic Camera', id: 'def' },
    { active: true, d: { description: 'Brand new listing' }, height: 2098725, price: 105263157900, qty: 4, seller: 'newbie', title: 'Young Listing', id: 'jkl' },
    { active: true, d: { description: 'Thermal paste' }, height: 1129568, price: 134000000000, qty: 96, seller: 'miningworld', title: 'Thermal Grizzly TG-Shield', id: 'ghi', peg: true, min: 50000000000 },
  ];
  if (offersBody.mine) list.push({ active: true, d: 'testlisting', height: 2098700, price: 10526315790, qty: 5, seller: 'test1seller', title: 'sft-test-offer', id: 'ab'.repeat(32) });
  const parts = [Buffer.from('{\r\n  "offers": [')]; list.forEach((o, i) => { if (i) parts.push(Buffer.from(',')); parts.push(one(o)); }); parts.push(Buffer.from('],\r\n  "status": "OK"\r\n}\r\n'));
  return Buffer.concat(parts);
}
module.exports = { start, startNode, offersBody };
