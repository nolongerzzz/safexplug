// Dev-only: Explorer tab in the real app against a fake node.
const { app, BrowserWindow } = require('electron');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
app.commandLine.appendSwitch('no-sandbox'); app.commandLine.appendSwitch('disable-gpu');
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'sxex-')); app.setPath('userData', ud);
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ mode: 'solo', node: '127.0.0.1:17402', publicFallback: false, autostart: false }));
const hash = (i) => i.toString(16).padStart(64, '0');
const mkHeader = (h) => ({ height: h, hash: hash(h), prev_hash: hash(h - 1), timestamp: 1_790_000_000 + h * 120, difficulty: 28000000, reward: 400e10, block_size: 1500 + h % 7, num_txes: h % 3, nonce: 12345 + h, depth: 2097600 - h, major_version: 8, orphan_status: false });
const TXH = hash(777), POOLTX = hash(900);
const calls = [];
const srv = http.createServer((q, r) => {
  let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => {
    if (!b) return r.end(JSON.stringify({ status: 'OK', height: 2097601, target_height: 0, synchronized: true, outgoing_connections_count: 6, incoming_connections_count: 0, difficulty: 28000000 }));
    const body = JSON.parse(b); calls.push([q.url, body.method]);
    if (q.url === '/get_transaction_pool') return r.end(JSON.stringify({ status: 'OK', transactions: [{ id_hash: POOLTX, blob_size: 1800, fee: 340000000, receive_time: Math.floor(Date.now() / 1000) - 30 }] }));
    if (q.url === '/gettransactions' && body.txs_hashes[0] === POOLTX) return r.end(JSON.stringify({ status: 'OK', txs: [{ as_hex: 'cd'.repeat(800), in_pool: true, block_height: 0, as_json: JSON.stringify({ vin: [{ key: { key_offsets: [1, 2, 3, 4, 5, 6, 7] } }], vout: [{ amount: 0 }, { amount: 0 }], rct_signatures: { txnFee: 340000000 } }) }] }));
    if (q.url === '/gettransactions') {
      if (body.txs_hashes[0] !== TXH) return r.end(JSON.stringify({ missed_tx: body.txs_hashes, status: 'OK' }));
      return r.end(JSON.stringify({ status: 'OK', txs: [{ as_hex: 'ab'.repeat(900), block_height: 2097581, in_pool: false,
        as_json: JSON.stringify({ vin: [{ key: { amount: 0, key_offsets: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] } }, { key: { key_offsets: [1, 2] } }], vout: [{ amount: 0 }, { amount: 0, token_amount: 5 }, { amount: 0 }], rct_signatures: { txnFee: 340000000 } }) }] }));
    }
    const m = body.method, p = body.params || {};
    const ok = (result) => r.end(JSON.stringify({ jsonrpc: '2.0', id: '0', result: { status: 'OK', ...result } }));
    if (m === 'get_last_block_header') return ok({ block_header: mkHeader(2097600) });
    if (m === 'get_block_headers_range') { const hs = []; for (let h = p.start_height; h <= p.end_height; h++) hs.push(mkHeader(h)); return ok({ headers: hs }); }
    if (m === 'get_block') {
      const h = p.height !== undefined ? p.height : parseInt(p.hash, 16);
      if (p.hash && h < 1000000) return r.end(JSON.stringify({ jsonrpc: '2.0', id: '0', error: { code: -5, message: "Internal error: can't get block by hash. Hash = " + p.hash + '.' } }));   // real nodes: a transaction hash is not a block hash
      if (h > 2097600) return r.end(JSON.stringify({ jsonrpc: '2.0', id: '0', error: { code: -2, message: 'Requested block height is too big.' } }));
      return ok({ block_header: mkHeader(h), miner_tx_hash: hash(h + 5e6), tx_hashes: [TXH, hash(778)],
        json: JSON.stringify({ miner_tx: { vout: [{ amount: 300e10 }, { amount: 100.34e10 }, { amount: 0, token_amount: 1e10 }] }, tx_hashes: [TXH, hash(778)] }) });
    }
    r.end(JSON.stringify({ jsonrpc: '2.0', id: '0', error: { code: -32601, message: 'Method not found' } }));
  });
}).listen(17402, '127.0.0.1');

require('../src/main.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
process.on('uncaughtException', (e) => { console.log('UNCAUGHT', e); app.exit(1); });
app.whenReady().then(async () => { console.log('ready');
  const wc = BrowserWindow.getAllWindows()[0].webContents; const OUT = process.env.SHOT_DIR; const js = (c) => wc.executeJavaScript(c);
  await wait(3000); console.log('go');
  await js(`document.getElementById('tabBtnExplorer').click()`); await wait(1500);
  console.log('rows:', await js(`document.querySelectorAll('#exBody tr').length`), '| first:', await js(`document.querySelector('#exBody tr').innerText.replace(/\\s+/g,' ')`));
  console.log('source:', await js(`document.getElementById('exSrc').textContent`));
  fs.writeFileSync(path.join(OUT, 'e-list.png'), (await wc.capturePage()).toPNG());
  await js(`document.getElementById('exMore').click()`); await wait(800);
  console.log('after older:', await js(`document.querySelectorAll('#exBody tr').length`));
  await js(`document.querySelector('#exBody tr').click()`); await wait(800);
  console.log('title:', await js(`document.getElementById('exTitle').textContent`), '| facts:', await js(`document.querySelectorAll('#exFacts tr').length`), '| txs:', await js(`document.querySelectorAll('#exTxs button').length`));
  await js(`document.querySelector('#exTxs button').click()`); await wait(800);
  console.log('tx facts:', await js(`[...document.querySelectorAll('#exTxFacts tr')].map(t=>t.innerText.replace(/\\s+/g,' ')).join(' ; ')`));
  fs.writeFileSync(path.join(OUT, 'e-detail.png'), (await wc.capturePage()).toPNG());
  await js(`document.getElementById('exQ').value='abc'; document.getElementById('exGo').click()`); await wait(600);
  console.log('bad search:', await js(`document.getElementById('exErr').textContent`));
  await js(`document.getElementById('exQ').value='99999999'; document.getElementById('exGo').click()`); await wait(600);
  console.log('missing:', await js(`document.getElementById('exErr').textContent`));
  await js(`document.getElementById('exLatest').click()`); await wait(1000);
  console.log('back to list visible:', await js(`!document.getElementById('exList').hidden`), 'rows', await js(`document.querySelectorAll('#exBody tr').length`));
  // ---- search by transaction hash (what people share after a send) ----
  let bad = 0; const ck = (n, ok, x) => { console.log(ok ? 'ok  ' : 'FAIL', n, x || ''); if (!ok) bad++; };
  const txt = (id) => js(`document.getElementById('${id}').innerText.replace(/\\s+/g,' ')`);
  await wait(500);
  ck('pool list shown with the waiting transaction', (await js(`!document.getElementById('exPoolBox').hidden`)) && (await js(`document.querySelector('#exPool button').textContent`)) === POOLTX, await txt('exPoolK'));
  fs.writeFileSync(path.join(OUT, 'e-pool.png'), (await wc.capturePage()).toPNG());
  await js(`document.getElementById('exQ').value='${TXH}'; document.getElementById('exGo').click()`); await wait(900);
  ck('tx hash search opens a transaction page', (await txt('exTitle')) === 'Transaction' && (await js(`!document.getElementById('exTxBox').hidden`)));
  const facts = await js(`[...document.querySelectorAll('#exTxFacts tr')].map(t=>t.innerText.replace(/\\s+/g,' ')).join(' ; ')`);
  ck('shows its block and confirmations', /In block 2,097,581 · 20 confirmations/.test(facts), facts);
  ck('block-only parts are hidden on a transaction page', (await js(`document.getElementById('exTxs').hidden`)) && (await js(`document.getElementById('exFacts').children.length`)) === 0);
  ck('Open its block button is shown', await js(`!document.getElementById('exTxBlock').hidden`)); fs.writeFileSync(path.join(OUT, 'e-tx.png'), (await wc.capturePage()).toPNG());
  await js(`document.getElementById('exTxBlock').click()`); await wait(900);
  ck('Open its block shows block 2,097,581', (await txt('exTitle')).startsWith('Block 2,097,581'), await txt('exTitle')); ck('and hides the transaction box', await js(`document.getElementById('exTxsK').hidden === false && document.getElementById('exTxBox').hidden`));
  await js(`document.getElementById('exLatest').click()`); await wait(900);
  await js(`document.getElementById('exQ').value='${POOLTX}'; document.getElementById('exGo').click()`); await wait(900);
  const pf = await js(`[...document.querySelectorAll('#exTxFacts tr')].map(t=>t.innerText.replace(/\\s+/g,' ')).join(' ; ')`);
  ck('pool transaction says it is not in a block yet', /Waiting in the pool/.test(pf) && (await js(`document.getElementById('exTxBlock').hidden`)), pf);
  await js(`document.getElementById('exLatest').click()`); await wait(900);
  await js(`document.getElementById('exQ').value='${hash(2097500)}'; document.getElementById('exGo').click()`); await wait(900);
  ck('a block hash still opens the block', (await txt('exTitle')).startsWith('Block 2,097,500'), await txt('exTitle'));
  await js(`document.getElementById('exLatest').click()`); await wait(900);
  await js(`document.getElementById('exQ').value='${hash(123456789)}'; document.getElementById('exGo').click()`); await wait(900);
  ck('unknown 64-char hash gives one clear message', (await txt('exErr')) === 'No block or transaction with that hash.', await txt('exErr'));
  await js(`document.getElementById('exTxs').hidden = false`);
  console.log(bad ? 'FAIL ' + bad : 'EXPLORER ALL OK');
  app.exit(bad ? 1 : 0);
});
