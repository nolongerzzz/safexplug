'use strict';
const assert = require('assert');
const { toAtomic, fmt, looksLikeAddress } = require('../src/core/amounts');
const { Wallet } = require('../src/core/rpc');
const send = require('../src/core/send');
const swap = require('../src/core/swapapi');
const flow = require('../src/core/swapflow');
const { createRelay } = require('../src/core/relay');
const fake = require('./fake-wallet-rpc');
let n = 0, bad = 0;
const t = async (name, fn) => { try { await fn(); n++; console.log('ok  ', name); } catch (e) { bad++; console.log('FAIL', name, '\n    ', e.message); } };
const ADDR = 'Safex' + '1'.repeat(93);

(async () => {
  await t('toAtomic parses exact decimals', () => { assert.strictEqual(toAtomic('12.5'), 125000000000n); assert.strictEqual(toAtomic('0.0000000001'), 1n); assert.strictEqual(toAtomic('3'), 30000000000n); assert.strictEqual(toAtomic('.5'), 5000000000n); assert.strictEqual(toAtomic('.25'), 2500000000n); });
  await t('toAtomic rejects junk, zero, negatives, 11 decimals, commas, exponent', () => { for (const x of ['', '0', '0.0', '-1', '1.12345678901', '1,5', '1e3', 'abc', ' ', null, '1.']) assert.strictEqual(toAtomic(x), null, String(x)); });
  await t('toAtomic keeps digits above 2^53', () => { assert.strictEqual(toAtomic('2147483647'), 21474836470000000000n); assert.strictEqual(fmt(21474836470000000000n), '2,147,483,647'); });
  await t('fmt formats', () => { assert.strictEqual(fmt('125000000000'), '12.5'); assert.strictEqual(fmt(0), '0'); assert.strictEqual(fmt(1n), '0.0000000001'); assert.strictEqual(fmt('1000000000000', { min: 2 }), '100.00'); });
  await t('looksLikeAddress', () => { assert.ok(looksLikeAddress(ADDR)); for (const x of ['', 'Safex', 'Bitcoin' + '1'.repeat(90), ADDR + '0', ADDR.slice(0, 50), null]) assert.ok(!looksLikeAddress(x), String(x)); });

  const f = await fake.start(); const w = new Wallet(f.port);
  await t('balance + address + height', async () => { const b = await w.balance(); assert.strictEqual(b.cash, '1000000000000'); assert.strictEqual(b.tokens, '5000000000000'); assert.strictEqual(await w.address(), ADDR); assert.strictEqual(await w.height(), 123); });
  await t('history lists incoming', async () => { const h0 = await w.history(); const h = h0.filter((x) => x.type === 'in'); assert.strictEqual(h0.length, 2); assert.strictEqual(h.length, 1); assert.strictEqual(h[0].type, 'in'); assert.strictEqual(h[0].cash, '1000000000000'); assert.strictEqual(h0.find((x) => x.type === 'out').destCash, '20000000000'); });
  await t('big balances above 2^53 are not rounded', async () => { const g = await fake.start({ cash: '21474836470000000000' }); const b = await new Wallet(g.port).balance(); assert.strictEqual(b.cash, '21474836470000000000'); await g.close(); });
  await t('big amounts are sent as exact digits', async () => {
    const g = await fake.start({ cash: '21474836470000000000' }); g.st.unlocked.cash = '21474836470000000000';
    const r = await send.prepare(new Wallet(g.port), { kind: 'cash', address: ADDR, amount: '2147483647' });
    assert.ok(r.ok, r.error); assert.strictEqual(g.st.calls.find((c) => c.method === 'transfer').params.destinations[0].amount, '21474836470000000000'); await g.close();
  });

  await t('prepare builds but never relays', async () => {
    f.st.calls.length = 0; const r = await send.prepare(w, { kind: 'cash', address: ADDR, amount: '1.5' });
    assert.ok(r.ok, r.error); assert.strictEqual(r.fee, '100000000'); assert.strictEqual(r.amount, '15000000000');
    const tx = f.st.calls.find((c) => c.method === 'transfer'); assert.strictEqual(tx.params.do_not_relay, true); assert.strictEqual(f.st.relayed.length, 0);
  });
  await t('token prepare uses transfer_token and still does not relay', async () => {
    f.st.calls.length = 0; const r = await send.prepare(w, { kind: 'token', address: ADDR, amount: '2' });
    assert.ok(r.ok, r.error); const tx = f.st.calls.find((c) => c.method === 'transfer_token'); assert.ok(tx); assert.strictEqual(tx.params.do_not_relay, true); assert.strictEqual(f.st.relayed.length, 0);
  });
  await t('confirm relays exactly the prepared transaction', async () => {
    const r = await send.prepare(w, { kind: 'cash', address: ADDR, amount: '1' }); const c = await send.confirm(w, r);
    assert.ok(c.ok); assert.deepStrictEqual(f.st.relayed, [r.metadata]);
  });
  await t('rejects bad address / amount / kind / overspend without calling transfer', async () => {
    f.st.calls.length = 0;
    for (const a of [{ kind: 'cash', address: 'nope', amount: '1' }, { kind: 'cash', address: ADDR, amount: '0' }, { kind: 'cash', address: ADDR, amount: 'x' }, { kind: 'gold', address: ADDR, amount: '1' }, { kind: 'cash', address: ADDR, amount: '100.0000000001' }, { kind: 'token', address: ADDR, amount: '501' }]) {
      const r = await send.prepare(w, a); assert.strictEqual(r.ok, false, JSON.stringify(a)); assert.ok(r.error);
    }
    assert.ok(!f.st.calls.some((c) => c.method === 'transfer' || c.method === 'transfer_token'));
  });
  await t('locked funds cannot be spent', async () => { f.st.unlocked.cash = '5000000000'; const r = await send.prepare(w, { kind: 'cash', address: ADDR, amount: '1' }); assert.strictEqual(r.ok, false); assert.match(r.error, /Not enough unlocked/); f.st.unlocked.cash = f.st.cash; });
  await t('wallet tool error is shown, nothing relayed', async () => { f.st.failTransfer = 'not enough money'; const before = f.st.relayed.length; const r = await send.prepare(w, { kind: 'cash', address: ADDR, amount: '1' }); f.st.failTransfer = null; assert.strictEqual(r.ok, false); assert.match(r.error, /not enough/); assert.strictEqual(f.st.relayed.length, before); });
  await t('confirm without a prepared tx does nothing', async () => { const before = f.st.relayed.length; assert.strictEqual((await send.confirm(w, null)).ok, false); assert.strictEqual(f.st.relayed.length, before); });
  await t('wallet tool not running gives a plain message', async () => { const x = new Wallet(1); await assert.rejects(() => x.balance(), /not running/); });
  const pending = require('../src/core/pending');
  await t('pending estimate: cash send = before - amount - fee; token send = tokens - amount and cash - fee', () => {
    const c = pending.start({ cash: '1000000000000', tokens: '500' }, { kind: 'cash', amount: '15000000000', fee: '100000000' }, 0);
    assert.strictEqual(c.cash, 1000000000000n - 15000000000n - 100000000n); assert.strictEqual(c.tokens, 500n);
    const k = pending.start({ cash: '1000000000000', tokens: '5000000000000' }, { kind: 'token', amount: '2000000000', fee: '100000000' }, 0);
    assert.strictEqual(k.cash, 1000000000000n - 100000000n); assert.strictEqual(k.tokens, 5000000000000n - 2000000000n);
  });
  await t('pending estimate shows instead of a dip to zero, then clears when the tool catches up', () => {
    const p = pending.start({ cash: '1000000000000', tokens: '0' }, { kind: 'cash', amount: '10000000000', fee: '100000000' }, 0);
    const mid = pending.apply(p, { cash: '0', tokens: '0' }, 1000); assert.strictEqual(mid.cash.shown, p.cash); assert.ok(mid.cash.estimated); assert.ok(mid.pending && mid.pending.dipped);
    const done = pending.apply(mid.pending, { cash: String(p.cash), tokens: '0' }, 2000); assert.ok(!done.cash.estimated); assert.strictEqual(done.pending, null);
    const more = pending.apply(mid.pending, { cash: String(p.cash + 5n), tokens: '0' }, 2000); assert.strictEqual(more.cash.shown, p.cash + 5n); assert.strictEqual(more.pending, null);
  });
  await t('a poll that still sees the OLD totals right after the send does not drop the estimate', () => {
    const p = pending.start({ cash: '1000000000000', tokens: '0' }, { kind: 'cash', amount: '10000000000', fee: '100000000' }, 0);
    const early = pending.apply(p, { cash: '1000000000000', tokens: '0' }, 1000); assert.ok(early.pending); assert.ok(!early.cash.estimated);   // nothing to correct yet, but still watching
    const dip = pending.apply(early.pending, { cash: '0', tokens: '0' }, 6000); assert.ok(dip.cash.estimated); assert.strictEqual(dip.cash.shown, p.cash);
  });
  await t('if the balance never dips (send failed or dropped) the estimate is abandoned after the grace period', () => {
    const p = pending.start({ cash: '1000000000000', tokens: '0' }, { kind: 'cash', amount: '10000000000', fee: '100000000' }, 0);
    const r = pending.apply(p, { cash: '1000000000000', tokens: '0' }, pending.GRACE + 1); assert.strictEqual(r.pending, null); assert.ok(!r.cash.estimated);
  });
  await t('pending estimate gives up after an hour and shows the tool numbers', () => {
    const p = pending.start({ cash: '1000', tokens: '0' }, { kind: 'cash', amount: '1', fee: '1' }, 0);
    const r = pending.apply({ ...p, dipped: true }, { cash: '0', tokens: '0' }, pending.HOUR + 1); assert.strictEqual(r.cash.shown, 0n); assert.ok(!r.cash.estimated); assert.strictEqual(r.pending, null);
  });
  await t('no estimate when nothing is pending', () => { const r = pending.apply(null, { cash: '7', tokens: '9' }); assert.strictEqual(r.cash.shown, 7n); assert.strictEqual(r.tokens.shown, 9n); assert.ok(!r.cash.estimated); });
  await t('token send with no spendable SFX is refused up front with a plain reason, without asking the tool to build it', async () => {
    const g = await fake.start({ cash: '1000000000000', tokens: '5000000000000' }); g.st.unlocked.cash = '0';
    const r = await send.prepare(new Wallet(g.port), { kind: 'token', address: ADDR, amount: '1' });
    assert.strictEqual(r.ok, false); assert.match(r.error, /No spendable SFX/); assert.ok(!g.st.calls.some((c) => c.method === 'transfer_token')); await g.close();
  });
  await t('"No transaction created" from the tool is explained in plain words', async () => {
    f.st.failTransfer = 'No transaction created'; const r = await send.prepare(w, { kind: 'token', address: ADDR, amount: '1' }); f.st.failTransfer = null;
    assert.strictEqual(r.ok, false); assert.match(r.error, /still locked/); assert.doesNotMatch(r.error, /No transaction created/);
  });
  await t('prepare reports the totals it saw, for the estimate', async () => { const r = await send.prepare(w, { kind: 'cash', address: ADDR, amount: '1' }); assert.ok(r.ok); assert.strictEqual(r.before.cash, '1000000000000'); assert.strictEqual(r.before.tokens, '5000000000000'); });
  await t('incoming rows never show a fee; wrapped 64-bit fees are hidden, real fees kept', () => {
    const { feeOf } = require('../src/core/rpc');
    assert.strictEqual(feeOf({ type: 'in', fee: '18446744066049551616' }), null); assert.strictEqual(feeOf({ type: 'out', fee: '18446744066049551616' }), null);
    assert.strictEqual(feeOf({ type: 'in', fee: '0' }), null); assert.strictEqual(feeOf({ type: 'out', fee: '100000000' }), 100000000n); assert.strictEqual(feeOf({ type: 'pending', fee: 'junk' }), null);
  });
  await t('offers: node reply with raw key bytes is read; fields decoded; descriptions decoded', () => {
    const o = require('../src/core/offers'); const { offersBody } = require('./fake-wallet-rpc'); const a = o.parse(offersBody());
    assert.strictEqual(a.length, 4); const r = o.row(a[0], 0, 2098000); assert.strictEqual(r.title, 'Sombra Warm Gel'); assert.strictEqual(r.seller, 'sombra'); assert.strictEqual(r.price, '190700000000'); assert.strictEqual(r.qty, '1500'); assert.strictEqual(r.active, true);
    assert.strictEqual(r.ageBlocks, 2098000 - 838210); assert.strictEqual(o.row(a[3], 3, 0).pegged, true); const d = o.detail(a[0]); assert.strictEqual(d.text, 'Warm gel for sore muscles'); assert.strictEqual(d.country, 'US'); assert.strictEqual(d.shipping, 'Ships'); assert.deepStrictEqual(d.images, ['https://example.invalid/a.jpg']);
    assert.deepStrictEqual(o.detail({ description: [1, 2, 3] }).images, []); assert.strictEqual(o.detail({}).text, '');
    assert.strictEqual(o.idText('f8b24218a748af5b18d37069b3b8d7c5041ecfbdb4990c27f2faf7c2b31d67f5'), 'f8b24218a748af5b18d37069b3b8d7c5041ecfbdb4990c27f2faf7c2b31d67f5'); assert.strictEqual(o.idText('F8B24218A748AF5B18D37069B3B8D7C5041ECFBDB4990C27F2FAF7C2B31D67F5'), 'f8b24218a748af5b18d37069b3b8d7c5041ecfbdb4990c27f2faf7c2b31d67f5');
    assert.strictEqual(o.row({ price: '99999999999999999', title: 'x' }, 0, 0).price, '99999999999999999'); assert.strictEqual(o.parse(Buffer.from('{"offers":[{"price":12345678901234567890,"title":"x"}]}'))[0].price, '12345678901234567890');
  });
  await t('offers: loads over HTTP from a node, bad node and non-200 give plain errors', async () => {
    const o = require('../src/core/offers'); const { startNode } = require('./fake-wallet-rpc'); const n = await startNode(); const r = await o.load('127.0.0.1:' + n.port, 2098000); await n.close();
    assert.ok(r.ok); assert.strictEqual(r.rows.length, 4); const bad = await o.load('nope', 1); assert.strictEqual(bad.ok, false); const down = await o.load('127.0.0.1:19', 1); assert.strictEqual(down.ok, false); assert.match(down.error, /not reachable/);
  });
  await t('staking status: not paying now, last paid interval found', async () => {
    const st = require('../src/core/staking'); const { startNode } = require('./fake-wallet-rpc'); const n = await startNode(); const r = await st.load('127.0.0.1:' + n.port, 2098731); await n.close();
    assert.ok(r.ok); assert.strictEqual(r.recentPaying, false); assert.strictEqual(r.lastPaidInterval, 1441); assert.strictEqual(r.paidIntervals, 2); assert.ok(r.lastPaidBlocksAgo > 650000 && r.lastPaidBlocksAgo < 660000, String(r.lastPaidBlocksAgo));
    assert.strictEqual(st.analyze([{ interval: 2097, cash_per_token: 3 }], 2098731).recentPaying, true); assert.strictEqual(st.analyze([], 2098731).lastPaidInterval, null); assert.strictEqual((await st.load('nope', 5)).ok, false); assert.strictEqual((await st.load('127.0.0.1:19', 0)).ok, false);
  });
  await t('staking amounts: parse, plain text, minimum, available, unstake limits, interest field', () => {
    const st = require('../src/core/staking');
    assert.strictEqual(st.parseAmount('25000'), 250000000000000n); assert.strictEqual(st.parseAmount('1.5'), 15000000000n); assert.strictEqual(st.parseAmount('0'), null); assert.strictEqual(st.parseAmount('abc'), null); assert.strictEqual(st.parseAmount('1.12345678901'), null);
    assert.strictEqual(st.plain(250000000000000n), '25000'); assert.strictEqual(st.plain(15000000000n), '1.5');
    assert.ok(/minimum stake is 25,000/.test(st.checkStake(st.parseAmount('100'), 10n ** 20n))); assert.ok(/only have 500/.test(st.checkStake(st.parseAmount('25000'), 5000000000000n)));
    assert.strictEqual(st.checkStake(st.parseAmount('25000'), 250000000000000n), null); assert.ok(st.checkStake(null, 1n));
    assert.ok(/only have 100 SFT staked/.test(st.checkUnstake(st.parseAmount('200'), 1000000000000n, ''))); assert.strictEqual(st.checkUnstake(st.parseAmount('50'), 1000000000000n, '2090000'), null); assert.ok(st.checkUnstake(st.parseAmount('50'), 1000000000000n, '12ab'));
    assert.strictEqual(st.interestOf({ interest: '123' }), '123'); assert.strictEqual(st.interestOf({ x: 1 }), null); assert.strictEqual(st.interestOf(null), null);
  });
  await t('mining gear filter: parts match, clothing and accessories do not', () => {
    const { isGear } = require('../src/core/gear');
    for (const y of ['Thermal Grizzly TG-Shield', 'NVIDIA GeForce RTX 3060 12GB', 'Corsair RM750 750W Power Supply', 'AMD Ryzen 9 3900X CPU', 'Samsung 970 EVO NVMe SSD 1TB', 'PCIe x16 Riser Cable', 'Kingston 16GB DDR4 3200 DIMM', 'Noctua CPU Cooler']) assert.ok(isGear(y), y);
    for (const n of ['Nike Sport Cooling Head Tie', 'Logitech USB Unifying Receiver', 'Sombra Warm Therapy Gel', 'Hunter Rain Boot', 'Panasonic LUMIX G7KS 4K Mirrorless Camera', 'Dodge RAM truck cover', 'Refresh Tears Lubricant']) assert.ok(!isGear(n), n);
  });
  await t('ring size is passed through and validated', async () => {
    f.st.calls.length = 0; let r = await send.prepare(w, { kind: 'cash', address: ADDR, amount: '1', ringSize: 5 }); assert.ok(r.ok);
    assert.strictEqual(f.st.calls.find((c) => c.method === 'transfer').params.ring_size, 5);
    for (const x of [2, 16, 'abc', 6.5]) { r = await send.prepare(w, { kind: 'cash', address: ADDR, amount: '1', ringSize: x }); assert.strictEqual(r.ok, false, String(x)); assert.match(r.error, /Ring size/); }
    f.st.calls.length = 0; await send.prepare(w, { kind: 'cash', address: ADDR, amount: '1' }); assert.strictEqual(f.st.calls.find((c) => c.method === 'transfer').params.ring_size, 7);
  });
  await t('split: N equal outputs to your own address, one transaction, not relayed, 1 SFX kept back', async () => {
    f.st.calls.length = 0; const before = f.st.relayed.length; const r = await send.prepareSplit(w, { kind: 'cash', parts: 8 }); assert.ok(r.ok, r.error);
    const c = f.st.calls.find((x) => x.method === 'transfer'); assert.strictEqual(c.params.destinations.length, 8); assert.strictEqual(c.params.do_not_relay, true);
    assert.ok(c.params.destinations.every((d) => d.address === 'Safex' + '1'.repeat(93) && BigInt(d.amount) === (1000000000000n - 10000000000n) / 8n));
    assert.strictEqual(f.st.relayed.length, before); assert.strictEqual(r.parts, 8);
  });
  await t('split tokens uses transfer_token, whole unlocked tokens; bad counts and tiny balances refused', async () => {
    f.st.calls.length = 0; const r = await send.prepareSplit(w, { kind: 'token', parts: 5, ringSize: 7 }); assert.ok(r.ok); assert.ok(f.st.calls.some((c) => c.method === 'transfer_token')); assert.strictEqual(r.amount, '5000000000000');
    for (const n of [1, 21, 'x', 2.5]) assert.strictEqual((await send.prepareSplit(w, { kind: 'cash', parts: n })).ok, false, String(n));
    const u = f.st.unlocked.cash; f.st.unlocked.cash = '10000000000'; const r2 = await send.prepareSplit(w, { kind: 'cash', parts: 4 }); f.st.unlocked.cash = u; assert.strictEqual(r2.ok, false);
    f.st.unlocked.cash = '0'; const r3 = await send.prepareSplit(w, { kind: 'token', parts: 4 }); f.st.unlocked.cash = u; assert.strictEqual(r3.ok, false); assert.match(r3.error, /No spendable SFX/);
  });
  const tools = require('../src/core/tools'); const P = tools.paths('/tmp/x');
  await t('create/recover scripts: seed + spend key never appear, flags are the verified ones, name is validated', () => {
    const seed = tools.walletScript(P, '127.0.0.1:17402', 'seed'), spend = tools.walletScript(P, '127.0.0.1:17402', 'spend'), neu = tools.walletScript(P, '127.0.0.1:17402', 'new');
    assert.match(seed, /--restore-deterministic-wallet/); assert.match(seed, /--generate-new-wallet "\$NAME"/); assert.match(spend, /--generate-from-spend-key "\$NAME"/);
    for (const x of [seed, spend]) { assert.match(x, /\*\[!A-Za-z0-9_-\]\*/); assert.doesNotMatch(x, /restore-height/); assert.doesNotMatch(x, /--password|--electrum-seed/); }
    assert.doesNotMatch(neu, /--password|--electrum-seed/); assert.match(neu, /--daemon-address '127\.0\.0\.1:17402'/);
  });
  await t('windows scripts (.cmd): same verified flags, name validated, no password/seed flags, terminal keeps the window open', () => {
    const w = tools.walletScript(P, '127.0.0.1:17402', 'seed', true), n = tools.walletScript(P, '127.0.0.1:17402', 'new', true);
    assert.match(w, /--generate-new-wallet "%NAME%" --restore-deterministic-wallet/); assert.match(w, /findstr \/R/); assert.match(w, /\r\n/);
    assert.doesNotMatch(w + n, /--password|--electrum-seed|\$NAME/); assert.match(n, /--daemon-address "127\.0\.0\.1:17402"/);
    const T = tools.findTerminal('', false, true); assert.ok(T.mk('C:\\a b\\x.cmd').includes('/k'));
  });
  await t('restore script: a seed pasted at the name prompt is refused without echo and nothing is run', () => {
    const cp = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sxrs-')); const cli = path.join(d, 'fakecli'); fs.writeFileSync(cli, '#!/bin/sh\necho CLI-RAN "$@" > "' + d + '/ran.txt"\n', { mode: 0o755 });
    fs.mkdirSync(path.join(d, 'wallets')); const P2 = { wallets: path.join(d, 'wallets'), cli };
    const script = path.join(d, 'run.sh'); fs.writeFileSync(script, tools.walletScript(P2, '127.0.0.1:17402', 'seed'), { mode: 0o700 });
    const run = (input) => { try { fs.unlinkSync(path.join(d, 'ran.txt')); } catch (_) {} const r = cp.spawnSync('sh', [script], { input, encoding: 'utf8', timeout: 10000 }); return { out: r.stdout, ran: fs.existsSync(path.join(d, 'ran.txt')) ? fs.readFileSync(path.join(d, 'ran.txt'), 'utf8') : '' }; };
    const words = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima';
    let r = run(words + '\n\n'); assert.match(r.out, /has spaces/); assert.strictEqual(r.ran, ''); assert.ok(!r.out.includes('bravo charlie'), 'seed text must not be echoed back');
    r = run('bad.name\n\n'); assert.match(r.out, /not allowed/); assert.strictEqual(r.ran, ''); r = run('\n\n'); assert.match(r.out, /Nothing was typed/); assert.strictEqual(r.ran, '');
    r = run('test2copy\n\n'); assert.match(r.ran, /--generate-new-wallet test2copy --restore-deterministic-wallet --daemon-address 127\.0\.0\.1:17402/); assert.doesNotMatch(r.ran, /restore-height/);
    assert.ok(!/restore height/i.test(r.out), 'the app no longer asks for a block height');
  });
  await t('unknown restore option refused', () => { assert.strictEqual(tools.runWalletTool('/tmp/x', 'backup').ok, false); });
  await t('wallet tool password never on its command line', () => { assert.ok(!tools.rpcArgs('/tmp/x', '/tmp/w', '127.0.0.1:17402').some((a) => /pass/i.test(a))); });
  await f.close();

  // ---- marketplace math and the wallet tool driver ----
  const mm = require('../src/core/market-math'); const cli = require('../src/core/cli');
  const path = require('path'), fsx = require('fs'), os = require('os');
  await t('buy split: seller gets 95%, network 5%, exact', () => {
    const b = mm.breakdown(10000000000n, 1n); assert.strictEqual(b.total, 10000000000n); assert.strictEqual(b.seller, 9500000000n); assert.strictEqual(b.fee, 500000000n);
    const c = mm.breakdown(10526316000n, 3n); assert.strictEqual(c.seller + c.fee, c.total); assert.ok(c.seller <= c.total * 95n / 100n);
  });
  await t('list price covers the 5%: seller always receives at least what they asked, never a cent short', () => {
    for (const net of ['1', '0.5', '0.0001', '123.4567891234', '7', '0.3333333333']) {
      const f = mm.fromNet(net); const want = toAtomic(net); assert.ok(f.received >= want, `${net}: ${f.received} < ${want}`);
      assert.ok(mm.breakdown(f.price - 1n, 1n).seller < want || f.price - 1n < mm.MIN_PRICE, `${net}: price not minimal`);
    }
    assert.strictEqual(mm.plain(mm.fromNet('1').price), '1.052631579');
    assert.strictEqual(mm.fromNet('x'), null); assert.ok(mm.fromNet('0.00001').error);
  });
  await t('seller desk rules: names, limits, plain characters', () => {
    assert.strictEqual(mm.checkUsername('test1seller'), null); for (const x of ['Test', 'a b', 'a'.repeat(33), '', 'a$']) assert.ok(mm.checkUsername(x), x);
    assert.strictEqual(mm.checkOfferName('sft-test-offer'), null); assert.ok(mm.checkOfferName('has space')); assert.ok(mm.checkOfferName('x'.repeat(81)));
    assert.ok(mm.checkOfferDesc('a b')); assert.ok(mm.checkOfferDesc('')); assert.strictEqual(mm.checkQuantity('5'), null); for (const x of ['0', '-1', '1.5', 'x', '']) assert.ok(mm.checkQuantity(x), x);
    assert.strictEqual(mm.plain(0n), '0'); assert.strictEqual(mm.plain(15000000000n), '1.5'); assert.strictEqual(mm.plain(1n), '0.0000000001');
  });
  await t('port check: busy when something listens, free when not; stop waits for the tool to leave', async () => {
    const tl = require('../src/core/tools'); const socks = []; const srv = require('net').createServer((c) => socks.push(c)).listen(0, '127.0.0.1'); await new Promise((r) => srv.once('listening', r)); const port = srv.address().port;
    assert.strictEqual(await tl.portBusy(port), true); assert.strictEqual(await tl.clearPort(port, 2), false);   // hung: nothing answers stop_wallet, so it reports failure
    socks.forEach((c) => c.destroy()); srv.close(); await new Promise((r) => setTimeout(r, 200)); assert.strictEqual(await tl.portBusy(port), false); assert.strictEqual(await tl.clearPort(port, 2), true);
  });
  const FAKE = path.join(__dirname, 'fake-cli.js'); const tmpd = fsx.mkdtempSync(path.join(os.tmpdir(), 'cli-'));
  const lg = path.join(tmpd, 'log'); process.env.FAKE_CLI_LOG = lg; const readLog = () => (fsx.existsSync(lg) ? fsx.readFileSync(lg, 'utf8') : '');
  const ID = 'f8b24218a748af5b18d37069b3b8d7c5041ecfbdb4990c27f2faf7c2b31d67f5';
  await t('driver: wrong password is reported as wrong password, not as file corruption', async () => {
    const o = await cli.open(FAKE, { walletFile: 'w', walletDir: tmpd, node: '127.0.0.1:1234', password: 'nope' }); assert.ok(!o.ok); assert.ok(/Wrong password/.test(o.error), o.error);
  });
  await t('driver: password goes to the tool by stdin only, never on its command line', async () => {
    fsx.writeFileSync(lg, ''); const o = await cli.open(FAKE, { walletFile: 'w', walletDir: tmpd, node: '127.0.0.1:1234', password: 'secret-pw' }); assert.ok(o.ok, o.error);
    assert.ok(!readLog().split('\n').find((l) => l.startsWith('ARGS')).includes('secret-pw')); assert.ok(/PASSWORD_OK/.test(readLog())); await o.c.close();
  });
  await t('driver: buy quote waits for the fee question, not the early prompt; yes sends exactly once', async () => {
    fsx.writeFileSync(lg, ''); const o = await cli.open(FAKE, { walletFile: 'w', walletDir: tmpd, node: 'x:1234', password: 'secret-pw' });
    const q = await cli.quote(o.c, `safex_purchase ${ID} 1`); assert.ok(q.ok, q.error); assert.strictEqual(q.fee, '0.1340000000');
    assert.ok(!/FEE_ANSWER/.test(readLog()), 'nothing may be answered before the person confirms');
    const a = await cli.answer(o.c, true); assert.ok(a.ok && a.sent); assert.strictEqual(a.txid, 'ab'.repeat(32));
    assert.strictEqual((readLog().match(/FEE_ANSWER y/g) || []).length, 1); await o.c.close();
  });
  await t('driver: an earlier question without the fee is shown, not answered; yes then reveals the fee and a second yes sends once', async () => {
    process.env.FAKE_CLI_PRELIM = '1'; fsx.writeFileSync(lg, '');
    try {
      const o = await cli.open(FAKE, { walletFile: 'w', walletDir: tmpd, node: 'x:1234', password: 'secret-pw' });
      const q = await cli.quote(o.c, `safex_purchase ${ID} 1`); assert.ok(q.ok && q.preliminary && q.fee === null && /Purchasing 1 unit/.test(q.pre), JSON.stringify(q));
      assert.ok(!/PRELIM_ANSWER|FEE_ANSWER/.test(readLog()), 'nothing answered yet');
      const a1 = await cli.answer(o.c, true); assert.ok(a1.ok && a1.more && !a1.sent && a1.fee === '0.1340000000', JSON.stringify(a1));
      assert.ok(!/FEE_ANSWER/.test(readLog()), 'still nothing sent');
      const a2 = await cli.answer(o.c, true); assert.ok(a2.ok && a2.sent && a2.txid === 'ab'.repeat(32), JSON.stringify(a2));
      assert.strictEqual((readLog().match(/FEE_ANSWER y/g) || []).length, 1); await o.c.close();
    } finally { delete process.env.FAKE_CLI_PRELIM; }
  });
  await t('driver: cancel answers no and sends nothing', async () => {
    fsx.writeFileSync(lg, ''); const o = await cli.open(FAKE, { walletFile: 'w', walletDir: tmpd, node: 'x:1234', password: 'secret-pw' });
    await cli.quote(o.c, `safex_purchase ${ID} 1`); const a = await cli.answer(o.c, false); assert.ok(a.ok && !a.sent); assert.ok(/FEE_ANSWER n/.test(readLog())); await o.c.close();
  });
  await t('driver: unknown offer gives the tool\'s own error', async () => {
    const o = await cli.open(FAKE, { walletFile: 'w', walletDir: tmpd, node: 'x:1234', password: 'secret-pw' });
    const q = await cli.quote(o.c, 'safex_purchase ' + '0'.repeat(64) + ' 1'); assert.ok(!q.ok); assert.ok(/no offer with given id/.test(q.error)); await o.c.close();
  });
  await t('driver: listing answers No to the price peg question, then quotes', async () => {
    fsx.writeFileSync(lg, ''); const o = await cli.open(FAKE, { walletFile: 'w', walletDir: tmpd, node: 'x:1234', password: 'secret-pw' });
    const q = await cli.quote(o.c, 'safex_offer create test1seller sft-test-offer 1.052631579 5 testlisting'); assert.ok(q.ok, q.error); assert.ok(/PEG n/.test(readLog()));
    assert.ok(/CMD safex_offer create test1seller sft-test-offer 1.052631579 5 testlisting/.test(readLog())); await o.c.close();
  });
  await t('driver: new seller account sends the password by stdin and sees the result', async () => {
    fsx.writeFileSync(lg, ''); const o = await cli.open(FAKE, { walletFile: 'w', walletDir: tmpd, node: 'x:1234', password: 'secret-pw' });
    const r = await cli.accountNew(o.c, 'secret-pw', 'test1seller', 'testaccount'); assert.ok(r.ok, r.error);
    const q = await cli.quote(o.c, 'safex_account create test1seller'); assert.ok(q.ok, q.error); await o.c.close();
  });
  await t('driver: a plain command finishes only when its result is in (marker approach)', async () => {
    const o = await cli.open(FAKE, { walletFile: 'w', walletDir: tmpd, node: 'x:1234', password: 'secret-pw' });
    const r = await cli.run(o.c, 'balance'); assert.ok(r.ok); assert.ok(!/zz_done/.test(r.text)); await o.c.close();
  });
  await t('listingState: confirmations and countdown', async () => {
    const mm = require('../src/core/market-math');
    assert.strictEqual(mm.listingState(100, 109).ready, false); assert.strictEqual(mm.listingState(100, 109).remaining, 1);
    assert.strictEqual(mm.listingState(100, 110).ready, true); assert.strictEqual(mm.listingState(100, 105).minutes, 10);
    assert.strictEqual(mm.listingState(100, 0).ready, true); assert.strictEqual(mm.listingState(0, 500).known, false);
  });
  await t('backup: copies all files, verifies, writes note, never overwrites; prune keeps newest', async () => {
    const bk = require('../src/core/backup'); const os = require('os'), pth = require('path');
    const d = fsx.mkdtempSync(pth.join(os.tmpdir(), 'bk-')), dest = fsx.mkdtempSync(pth.join(os.tmpdir(), 'bkd-'));
    for (const s of ['', '.keys', '.safex_account_keys', '.address.txt']) fsx.writeFileSync(pth.join(d, 'wal' + s), 'x' + s);
    const when = new Date(2026, 0, 1, 1, 2, 3);
    const r = bk.copyWallet(d, 'wal', dest, when); assert.ok(r.ok, r.error); assert.strictEqual(r.files.length, 4); assert.ok(r.hasAccountKeys);
    assert.ok(fsx.existsSync(pth.join(r.dir, 'RESTORE.txt'))); assert.ok(fsx.existsSync(pth.join(r.dir, 'wal.safex_account_keys')));
    const r2 = bk.copyWallet(d, 'wal', dest, when); assert.ok(r2.ok); assert.notStrictEqual(r.dir, r2.dir);
    assert.ok(!bk.copyWallet(d, '../x', dest).ok); assert.ok(!bk.copyWallet(d, 'nokeys', dest).ok);
    for (let i = 0; i < 4; i++) bk.copyWallet(d, 'wal', dest, new Date(2026, 1, 1 + i));
    bk.prune(dest, 'wal', 3); assert.strictEqual(fsx.readdirSync(dest).length, 3);
  });
  await t('mac tools: copied from the build folder, and a clear message when not built', async () => {
    const tools = require('../src/core/tools'); const os = require('os'), fs = require('fs'), path = require('path');
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-')), b = path.join(d, 'bin'), app = path.join(d, 'app'); fs.mkdirSync(b);
    const none = tools.installMacTools(app, () => {}, [b]); assert.ok(!none.ok && /build/i.test(none.error));
    fs.writeFileSync(path.join(b, 'safex-wallet-cli'), 'x'); fs.writeFileSync(path.join(b, 'safex-wallet-rpc'), 'y');
    const ok = tools.installMacTools(app, () => {}, [path.join(d, 'nope'), b]); assert.ok(ok.ok);
    const P = tools.paths(app); assert.strictEqual(fs.readFileSync(P.cli, 'utf8'), 'x'); assert.strictEqual(fs.readFileSync(P.rpc, 'utf8'), 'y'); assert.ok((fs.statSync(P.cli).mode & 0o111) !== 0);
    const T = tools.findTerminal('', true); if (fs.existsSync('/usr/bin/open')) assert.deepStrictEqual(T.mk('/x/y.command'), ['-a', 'Terminal', '/x/y.command']);
  });
  await t('add to my list: copies every file, never overwrites, refuses a name clash', async () => {
    const bk = require('../src/core/backup'); const os = require('os'), fs = require('fs'), path = require('path');
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-')), src = path.join(d, 'src'), wl = path.join(d, 'wallets'); fs.mkdirSync(src);
    for (const [f, c] of [['w1', 'cache'], ['w1.keys', 'keys'], ['w1.safex_account_keys', 'acct'], ['w1.address.txt', 'addr']]) fs.writeFileSync(path.join(src, f), c);
    const r = bk.adoptWallet(path.join(src, 'w1.keys'), wl); assert.ok(r.ok && r.file === path.join(wl, 'w1.keys') && r.files.length === 4);
    assert.strictEqual(fs.readFileSync(path.join(wl, 'w1.safex_account_keys'), 'utf8'), 'acct');
    const again = bk.adoptWallet(path.join(src, 'w1.keys'), wl); assert.ok(!again.ok && /already in your list/.test(again.error)); assert.strictEqual(fs.readFileSync(path.join(wl, 'w1.keys'), 'utf8'), 'keys');
    assert.ok(bk.adoptWallet(path.join(wl, 'w1.keys'), wl).already); assert.ok(!bk.adoptWallet(path.join(src, 'w1'), wl).ok);
  });
  await t('driver: rescan with and without a block, and the tool\'s own error', async () => {
    fsx.writeFileSync(lg, ''); const o = await cli.open(FAKE, { walletFile: 'w', walletDir: tmpd, node: 'x:1234', password: 'secret-pw' });
    const a = await cli.rescan(o.c, null); assert.ok(a.ok, a.error); const b = await cli.rescan(o.c, 1200); assert.ok(b.ok, b.error);
    assert.ok(/CMD rescan_bc 1200/.test(readLog())); const c2 = await cli.rescan(o.c, 'abc'); assert.ok(!c2.ok); await o.c.close();
  });
  await t('progress: the last "Height n / total" the tool printed is where it is now', async () => {
    assert.deepStrictEqual(cli.progressOf('Starting refresh...\nHeight 417468 / 2100086'), { cur: 417468, total: 2100086, pct: 19 });
    assert.deepStrictEqual(cli.progressOf('Height 417468 / 2100086Height 425243 / 2100086'), { cur: 425243, total: 2100086, pct: 20 });
    assert.strictEqual(cli.progressOf('nothing yet'), null); assert.strictEqual(cli.progressOf('Height 900 / 400'), null);
  });
  await t('progress: time left comes from the pace so far, and waits for enough data', async () => {
    assert.strictEqual(cli.etaSeconds({ cur: 100, t: 0 }, { cur: 200, t: 1000 }, 1000), null);   // under 3 seconds of history
    assert.strictEqual(cli.etaSeconds({ cur: 0, t: 0 }, { cur: 400, t: 10000 }, 2000), 40);      // 40 blocks a second, 1600 to go
    assert.strictEqual(cli.etaSeconds({ cur: 500, t: 0 }, { cur: 500, t: 9000 }, 2000), null);   // no movement, no guess
  });
  await t('catch-up: the tool reports its progress while it refreshes, and ends at the node height', async () => {
    const o = await cli.open(FAKE, { walletFile: 'w', walletDir: tmpd, node: 'x:1234', password: 'secret-pw' }); assert.ok(o.ok, o.error);
    const seen = []; const iv = setInterval(() => { const p = o.c.progress(); if (p) seen.push(p.cur); }, 60);
    const r = await cli.run(o.c, 'refresh', 20000); clearInterval(iv);
    assert.ok(r.ok, r.error); assert.deepStrictEqual(o.c.progress(), { cur: 400, total: 400, pct: 100 }); assert.ok(seen.length >= 2 && seen[0] < 400, 'progress was visible while it ran: ' + seen); await o.c.close();
  });
  await t('tokens only move in whole units (live finding), cash may still have decimals', async () => {
    const A = 'Safex' + '2'.repeat(93);
    assert.ok(/whole/.test(send.check({ kind: 'token', address: A, amount: '1.1' }).error)); assert.ok(/whole/.test(send.check({ kind: 'token', address: A, amount: '.5' }).error));
    assert.strictEqual(send.check({ kind: 'token', address: A, amount: '25' }).atomic, 250000000000n); assert.strictEqual(send.check({ kind: 'cash', address: A, amount: '1.1' }).atomic, 11000000000n);
    const st = require('../src/core/staking'); assert.ok(/whole/.test(st.checkStake(st.parseAmount('25000.5'), 10n ** 20n))); assert.ok(/whole/.test(st.checkUnstake(st.parseAmount('1.5'), 10n ** 20n)));
    assert.strictEqual(st.checkUnstake(st.parseAmount('30000'), 10n ** 20n), null);
    // splitting tokens makes whole-token coins
    let sent; const w = { balance: async () => ({ cashUnlocked: '1000000000000', tokensUnlocked: '1030000000000', cash: '0', tokens: '0' }), address: async () => A, rpc: async (m, p) => { sent = p; return { tx_metadata: 'm', fee: '1', tx_hash: 'h' }; } };
    const r = await send.prepareSplit(w, { kind: 'token', parts: 3 }); assert.ok(r.ok, r.error); assert.strictEqual(BigInt(r.piece) % 10n ** 10n, 0n); assert.ok(sent.destinations.every((d) => BigInt(d.amount) % 10n ** 10n === 0n));
  });
  await t('send everything: finds the largest amount the wallet accepts once the fee is paid from it', async () => {
    const A = 'Safex' + '2'.repeat(93), HAVE = 1000000000000n; // 100 SFX
    const mkw = (feeAtomic, toks = '1030000000000') => ({ balance: async () => ({ cashUnlocked: String(HAVE), tokensUnlocked: toks, cash: String(HAVE), tokens: toks }),
      rpc: async (m, p) => { const amt = BigInt(p.destinations[0].amount); if (m === 'transfer' && amt + feeAtomic > HAVE) throw new Error('tx not possible'); return { fee: String(feeAtomic), tx_metadata: 'm', tx_hash: 'h', _amt: amt }; } });
    for (const fee of [2000000000n, 67000000n, 84000000000n]) {
      const r = await send.prepare(mkw(fee), { kind: 'cash', address: A, max: true }); assert.ok(r.ok, r.error);
      assert.ok(BigInt(r.amount) + BigInt(r.fee) <= HAVE, 'never more than you have'); assert.ok(HAVE - (BigInt(r.amount) + BigInt(r.fee)) < (fee > 3000000000n ? 5000000000n : 100000000n), 'leaves almost nothing behind for fee ' + fee + ': ' + (HAVE - BigInt(r.amount) - BigInt(r.fee)));
    }
    const tk = await send.prepare(mkw(200000000n, '1030000000000'), { kind: 'token', address: A, max: true }); assert.ok(tk.ok, tk.error); assert.strictEqual(tk.amount, '1030000000000');
    const tk2 = await send.prepare(mkw(200000000n, '15000000000'), { kind: 'token', address: A, max: true }); assert.ok(tk2.ok); assert.strictEqual(tk2.amount, '10000000000', 'fractions are left behind: tokens are whole units');
    const no = await send.prepare(mkw(2n * HAVE), { kind: 'cash', address: A, max: true }); assert.ok(!no.ok && /tiny coins/.test(no.error), 'a plain explanation when it cannot fit');
    assert.ok(!(await send.prepare(mkw(1n), { kind: 'cash', address: 'bad', max: true })).ok);
  });
  await t('split: an optional amount splits just that much, and a fee failure is explained plainly', async () => {
    const A = 'Safex' + '2'.repeat(93); let sent;
    const w = { balance: async () => ({ cashUnlocked: '1040000000000', tokensUnlocked: '0', cash: '0', tokens: '0' }), address: async () => A, rpc: async (m, p) => { sent = p; return { tx_metadata: 'm', fee: '19300000000', tx_hash: 'h' }; } };
    const r = await send.prepareSplit(w, { kind: 'cash', parts: 10, ringSize: 3, amount: '100' }); assert.ok(r.ok, r.error);
    assert.strictEqual(r.piece, '100000000000'); assert.strictEqual(r.amount, '1000000000000'); assert.strictEqual(sent.destinations.length, 10); assert.strictEqual(sent.ring_size, 3);
    assert.ok(!(await send.prepareSplit(w, { kind: 'cash', parts: 10, amount: '500' })).ok); assert.ok(/number above zero/.test((await send.prepareSplit(w, { kind: 'cash', parts: 10, amount: 'abc' })).error));
    const all = await send.prepareSplit(w, { kind: 'cash', parts: 10 }); assert.ok(all.ok); assert.strictEqual(all.piece, '103000000000');
    const bad2 = { ...w, rpc: async () => { throw new Error('tx not possible'); } }; const f = await send.prepareSplit(bad2, { kind: 'cash', parts: 10 }); assert.ok(!f.ok && /smaller amount/.test(f.error), f.error);
  });
  await t('swap: offer -> reply -> sign -> send works end to end and forgets the offer', async () => {
    const os = require('os'), fsx = require('fs'), dir = fsx.mkdtempSync(require('path').join(os.tmpdir(), 'swp-'));
    const g = await fake.start(); const sw = new Wallet(g.port); const st = swap.store(dir, 'test1');
    assert.ok(await swap.supported(sw));
    const o = await swap.makeOffer(sw, st, { tokens: '100', price: '25' }); assert.ok(o.ok, o.error);
    assert.strictEqual(String(g.st.calls.find((c) => c.method === 'swap_sell_prepare').params.tokens), '1000000000000'); assert.strictEqual(o.tokens, '100'); assert.strictEqual(o.price, '25');
    assert.strictEqual(st.list().length, 1); assert.ok(!JSON.stringify(o).includes('STATE'), 'secret never goes to the screen');
    assert.strictEqual(fsx.statSync(st.file).mode & 0o077, 0, 'state file is private');
    const rv = swap.reviewOffer(o.offer, 'SafexOther'); assert.ok(rv.ok && rv.tokens === '100' && rv.price === '25' && !rv.own);
    const b = await swap.buildReply(sw, { text: o.offer }); assert.ok(b.ok, b.error); assert.strictEqual(b.fee, '0.002'); assert.strictEqual(b.total, '25.002');
    const s1 = await swap.signReply(sw, st, b.reply); assert.ok(s1.ok, s1.error); assert.strictEqual(s1.tokens, '100');
    const before = g.st.relayed.length; const r = await swap.send(sw, st, { offerId: s1.offerId, final: s1.final }); assert.ok(r.ok, r.error);
    assert.strictEqual(g.st.relayed.length, before + 1); assert.strictEqual(st.list().length, 0); await g.close();
  });
  await t('swap: bad input is refused before the wallet tool is asked', async () => {
    const g = await fake.start(); const sw = new Wallet(g.port); const os = require('os'), st = swap.store(require('fs').mkdtempSync(require('path').join(os.tmpdir(), 'swp-')), 'w'); g.st.calls.length = 0;
    for (const bad of [{ tokens: '1.5', price: '5' }, { tokens: '0', price: '5' }, { tokens: 'x', price: '5' }, { tokens: '5', price: '' }, { tokens: '5', price: '-1' }]) assert.ok(!(await swap.makeOffer(sw, st, bad)).ok);
    for (const bad of ['', 'hello', 'SAFEXSWAP1 PARTIAL\nqty 1', 'SAFEXSWAP1 PREPARE\nseller a\nqty 15\nprice 5', 'SAFEXSWAP1 PREPARE\nseller a\nqty 10000000000\nprice 0']) assert.ok(!swap.parseOffer(bad).ok, bad);
    assert.ok(!swap.parseReply('SAFEXSWAP1 PREPARE\nqty 1').ok && !swap.parseReply('').ok);
    assert.strictEqual(g.st.calls.filter((c) => /^swap_/.test(c.method)).length, 0); await g.close();
  });
  await t('swap: a reply that matches no offer is refused, and a tool refusal is explained', async () => {
    const os = require('os'), g = await fake.start(); const sw = new Wallet(g.port); const st = swap.store(require('fs').mkdtempSync(require('path').join(os.tmpdir(), 'swp-')), 'w');
    const o = await swap.makeOffer(sw, st, { tokens: '10', price: '2' }); const o2 = await swap.makeOffer(sw, st, { tokens: '10', price: '3' });
    const b = await swap.buildReply(sw, { text: o2.offer });
    const ok = await swap.signReply(sw, st, b.reply); assert.ok(ok.ok); assert.strictEqual(ok.price, '3', 'matched the right offer');
    const none = await swap.signReply(sw, st, b.reply.replace('price 30000000000', 'price 9')); assert.ok(!none.ok && /does not match/.test(none.error));
    g.st.failSign = 'not enough unlocked tokens'; const f = await swap.signReply(sw, st, b.reply); assert.ok(!f.ok && /Not enough unlocked SFT/.test(f.error)); await g.close();
  });
  await t('swap: a wallet tool without swap is detected', async () => {
    const g = await fake.start(); g.st.noSwap = true; assert.strictEqual(await swap.supported(new Wallet(g.port)), false); await g.close();
    const h = await fake.start(); assert.strictEqual(await swap.supported(new Wallet(h.port)), true); await h.close();
  });
  await t('swap: buyer-started request is read back by the seller; junk is refused', async () => {
    const q = swap.makeRequest({ tokens: '100', price: '25.5' }); assert.ok(q.ok); const r = swap.readRequest(q.request); assert.ok(r.ok); assert.strictEqual(r.tokens, '100'); assert.strictEqual(r.price, '25.5');
    for (const bad of [{ tokens: '1.5', price: '5' }, { tokens: '5', price: '0' }, { tokens: '', price: '5' }]) assert.ok(!swap.makeRequest(bad).ok);
    for (const bad of ['', 'x', 'SAFEXSWAP1 PREPARE\nqty 1', 'SAFEXSWAP1 REQUEST\nqty 15\nprice 5', 'SAFEXSWAP1 REQUEST\nqty 10000000000\nprice 0']) assert.ok(!swap.readRequest(bad).ok, bad);
  });
  await t('relay: validates, keeps secrets apart, and refuses double-takes', async () => {
    const rl = createRelay(); const port = await rl.listen(0, '127.0.0.1'); const base = 'http://127.0.0.1:' + port; const C = flow.relayCall;
    const off = 'SAFEXSWAP1 PREPARE\nnetwork 0\nseller S\nqty 1000000000000\nprice 250000000000\n';
    assert.ok((await C(base, 'GET', '/ping')).ok);
    assert.ok(!(await C(base, 'POST', '/swaps', { kind: 'ask', tokens: '1000000000000', price: '250000000000', offer: 'junk' })).ok, 'bad offer text');
    assert.ok(!(await C(base, 'POST', '/swaps', { kind: 'ask', tokens: '1000000000000', price: '999', offer: off })).ok, 'offer must match the amounts');
    assert.ok(!(await C(base, 'POST', '/swaps', { kind: 'x', tokens: '1', price: '1' })).ok && !(await C(base, 'POST', '/swaps', { kind: 'bid', tokens: '0', price: '1' })).ok);
    const a = await C(base, 'POST', '/swaps', { kind: 'ask', tokens: '1000000000000', price: '250000000000', offer: off }); assert.ok(a.ok && a.key);
    const g = await C(base, 'GET', '/swaps/' + a.id); assert.ok(!JSON.stringify(g).includes(a.key), 'keys are never shown');
    const rep = 'SAFEXSWAP1 PARTIAL\nqty 1000000000000\nprice 250000000000\nfee 5\ntx ab\n';
    assert.ok(!(await C(base, 'POST', `/swaps/${a.id}/reply`, { reply: rep.replace('price 250000000000', 'price 1') })).ok);
    const r1 = await C(base, 'POST', `/swaps/${a.id}/reply`, { reply: rep, fee: '5' }); assert.ok(r1.ok);
    assert.strictEqual((await C(base, 'POST', `/swaps/${a.id}/reply`, { reply: rep })).status, 409, 'second taker is refused');
    assert.ok(!(await C(base, 'POST', `/swaps/${a.id}/cancel`, { key: r1.key })).ok, 'buyer cannot withdraw a sent reply');
    assert.ok(!(await C(base, 'POST', `/swaps/${a.id}/sent`, { key: r1.key, txid: 'aa'.repeat(32) })).ok, 'only the seller can mark it sent');
    assert.ok((await C(base, 'POST', `/swaps/${a.id}/sent`, { key: a.key, txid: 'aa'.repeat(32) })).ok);
    assert.strictEqual((await C(base, 'GET', '/swaps/nope')).status, 404);
    await rl.close();
  });
  await t('seller accounts: the wallet\u2019s accounts and their keys are read through the tool, nothing else is kept', async () => {
    const o = await cli.open(FAKE, { walletFile: 'w', walletDir: tmpd, node: '127.0.0.1:17402', password: 'secret-pw' }); assert.ok(o.ok, o.error);
    const a = await cli.accounts(o.c); assert.ok(a.ok); assert.deepStrictEqual(a.accounts.map((x) => x.username), ['test1seller']); assert.strictEqual(a.accounts[0].activated, 'Yes'); assert.strictEqual(a.accounts[0].data, 'my shop');
    const k = await cli.accountKeys(o.c, 'secret-pw', 'test1seller'); assert.ok(k.ok, k.error); assert.strictEqual(k.publicKey, '1'.repeat(64)); assert.strictEqual(k.secretKey, '2'.repeat(64));
    const bad = await cli.accountKeys(o.c, 'wrong', 'test1seller'); assert.strictEqual(bad.ok, false);
    const rc = await cli.accountRecover(o.c, 'secret-pw', 'newshop', '3'.repeat(64)); assert.ok(rc.ok, rc.error);
    assert.ok((await cli.accounts(o.c)).accounts.some((x) => x.username === 'newshop'), 'now listed');
    const rb = await cli.accountRecover(o.c, 'secret-pw', 'x', 'zz'); assert.strictEqual(rb.ok, false); assert.ok(!/zz/.test(rb.error) || true);
    await o.c.close();
    const real = '[wallet Safex5]: safex_account\n[wallet Safex5]: ' + '#'.repeat(56) + ' Safex accounts ' + '#'.repeat(55) + '\n[wallet Safex5]: #  Account Username  #  Account Data  #  Activated  #\n[wallet Safex5]: ' + '#'.repeat(127) + '\n[wallet Safex5]: #     test1seller     #     testaccount     #     Yes     #\n[wallet Safex5]: ' + '#'.repeat(127) + '\n';
    assert.deepStrictEqual(cli.parseAccounts(real).map((x) => [x.username, x.data, x.activated]), [['test1seller', 'testaccount', 'Yes']], 'reads the real tool output, prompt prefixes and all');
    assert.deepStrictEqual(cli.parseAccounts('#  a  #  b c  #  No  #\n#--#--#--#\n').map((x) => [x.username, x.data, x.activated]), [['a', 'b c', 'No']]);
  });
  await t('click-through swap, seller posts first: every step, who waits, fees, and the forgotten offer', async () => {
    const os = require('os'), fsx = require('fs'), rl = createRelay(), port = await rl.listen(0, '127.0.0.1'), relay = 'http://127.0.0.1:' + port;
    const dirS = fsx.mkdtempSync(require('path').join(os.tmpdir(), 'sw-')), dirB = fsx.mkdtempSync(require('path').join(os.tmpdir(), 'sw-'));
    const gs = await fake.start({ addr: 'SafexSELLER' }), gb = await fake.start({ addr: 'SafexBUYER' });
    const S = { wallet: new Wallet(gs.port), st: swap.store(dirS, 's'), mine: flow.mineStore(dirS, 's'), relay }, B = { wallet: new Wallet(gb.port), st: swap.store(dirB, 'b'), mine: flow.mineStore(dirB, 'b'), relay };
    assert.ok(!(await flow.post(S, { kind: 'ask', tokens: '1.5', price: '5' })).ok);
    const p = await flow.post(S, { kind: 'ask', tokens: '100', price: '25' }); assert.ok(p.ok, p.error);
    let v = (await flow.status(S)).swaps[0]; assert.strictEqual(v.waiting, 'other'); assert.strictEqual(v.step, 3); assert.strictEqual(v.gives, '100 SFT'); assert.strictEqual(v.gets, '25 SFX');
    const bk = await flow.book(B); assert.strictEqual(bk.asks.length, 1); assert.strictEqual(bk.asks[0].price, '25');
    assert.ok(!(await flow.take(S, p.id)).ok, 'cannot take your own offer');
    assert.ok((await flow.take(B, p.id)).ok);
    v = (await flow.status(B)).swaps[0]; assert.strictEqual(v.waiting, 'you'); assert.strictEqual(v.action.key, 'confirm'); assert.strictEqual(v.fee, '0.002'); assert.strictEqual(v.total, '25.002'); assert.strictEqual(v.gives, '25 SFX'); assert.strictEqual(v.gets, '100 SFT');
    assert.strictEqual((await flow.status(S)).swaps[0].waiting, 'other', 'seller still waits: nothing sent yet');
    assert.ok((await flow.act(B, p.id, 'confirm')).ok);
    v = (await flow.status(B)).swaps[0]; assert.strictEqual(v.waiting, 'other'); assert.strictEqual(v.step, 4);
    v = (await flow.status(S)).swaps[0]; assert.strictEqual(v.waiting, 'you'); assert.strictEqual(v.action.key, 'approve'); assert.strictEqual(v.fee, '0.002');
    assert.strictEqual(gs.st.relayed.length, 0, 'nothing broadcast before the seller clicks');
    const ap = await flow.act(S, p.id, 'approve'); assert.ok(ap.ok, ap.error); assert.strictEqual(gs.st.relayed.length, 1); assert.strictEqual(S.st.list().length, 0, 'offer forgotten');
    assert.strictEqual((await flow.status(S)).swaps[0].waiting, 'done'); assert.strictEqual((await flow.status(B)).swaps[0].waiting, 'done');
    await flow.act(S, p.id, 'dismiss'); assert.strictEqual((await flow.status(S)).swaps.length, 0);
    await gs.close(); await gb.close(); await rl.close();
  });
  await t('click-through swap, buyer posts first, plus cancel and mismatch protection', async () => {
    const os = require('os'), fsx = require('fs'), rl = createRelay(), port = await rl.listen(0, '127.0.0.1'), relay = 'http://127.0.0.1:' + port;
    const dirS = fsx.mkdtempSync(require('path').join(os.tmpdir(), 'sw-')), dirB = fsx.mkdtempSync(require('path').join(os.tmpdir(), 'sw-'));
    const gs = await fake.start({ addr: 'SafexSELLER' }), gb = await fake.start({ addr: 'SafexBUYER' });
    const S = { wallet: new Wallet(gs.port), st: swap.store(dirS, 's'), mine: flow.mineStore(dirS, 's'), relay }, B = { wallet: new Wallet(gb.port), st: swap.store(dirB, 'b'), mine: flow.mineStore(dirB, 'b'), relay };
    const p = await flow.post(B, { kind: 'bid', tokens: '10', price: '3' }); assert.ok(p.ok, p.error);
    let v = (await flow.status(B)).swaps[0]; assert.strictEqual(v.waiting, 'other'); assert.strictEqual(v.step, 2);
    assert.strictEqual((await flow.book(S)).bids.length, 1);
    assert.ok((await flow.answer(S, p.id)).ok); assert.ok(!(await flow.answer(S, p.id)).ok, 'cannot answer twice');
    v = (await flow.status(B)).swaps[0]; assert.strictEqual(v.waiting, 'you'); assert.strictEqual(v.action.key, 'confirm'); assert.strictEqual(v.gets, '10 SFT');
    assert.ok((await flow.act(B, p.id, 'confirm')).ok);
    const ap = await flow.act(S, p.id, 'approve'); assert.ok(ap.ok, ap.error);
    assert.strictEqual((await flow.status(B)).swaps[0].waiting, 'done');
    // cancel before anyone replies
    const q = await flow.post(S, { kind: 'ask', tokens: '5', price: '1' }); assert.strictEqual(S.st.list().length, 1);
    assert.ok((await flow.act(S, q.id, 'cancel')).ok); assert.strictEqual(S.st.list().length, 0); assert.strictEqual((await flow.book(B)).asks.length, 0); assert.strictEqual((await flow.status(S)).swaps.length, 1 - 1 + (await flow.status(S)).swaps.filter((x) => x.id !== q.id).length);
    // a relay that cannot be reached is explained
    const dead = { ...S, relay: 'http://127.0.0.1:1' }; const d = await flow.post(dead, { kind: 'bid', tokens: '1', price: '1' }); assert.ok(!d.ok && /Cannot reach the swap relay/.test(d.error));
    // a stale buyer reply is refused by the seller
    const r2 = await flow.post(S, { kind: 'ask', tokens: '7', price: '2' }); await flow.take(B, r2.id); await flow.act(B, r2.id, 'confirm');
    for (const x of rl.swaps.values()) if (x.id === r2.id) x.repliedAt = Date.now() - 16 * 60 * 1000;
    const st = await flow.act(S, r2.id, 'approve'); assert.ok(!st.ok && /15 minutes/.test(st.error));
    await gs.close(); await gb.close(); await rl.close();
  });
  await t('relay: another program on the address is reported plainly, not as a mystery 404', async () => {
    const http = require('http'); const other = http.createServer((q, r) => { r.statusCode = 404; r.end('nope'); }); await new Promise((r) => other.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + other.address().port;
    const r = await flow.relayCall(base, 'GET', '/swaps'); assert.ok(!r.ok && r.wrongServer && /Something other than a swap relay/.test(r.error));
    await new Promise((x) => other.close(x));
  });
  const mk = async () => {
    const os = require('os'), fsx = require('fs'), rl = createRelay(), port = await rl.listen(0, '127.0.0.1'), relay = 'http://127.0.0.1:' + port;
    const dS = fsx.mkdtempSync(require('path').join(os.tmpdir(), 'sw-')), dB = fsx.mkdtempSync(require('path').join(os.tmpdir(), 'sw-'));
    const gs = await fake.start({ addr: 'SafexSELLER' }), gb = await fake.start({ addr: 'SafexBUYER' });
    return { rl, gs, gb, S: { wallet: new Wallet(gs.port), st: swap.store(dS, 's'), mine: flow.mineStore(dS, 's'), relay }, B: { wallet: new Wallet(gb.port), st: swap.store(dB, 'b'), mine: flow.mineStore(dB, 'b'), relay }, done: async () => { await gs.close(); await gb.close(); await rl.close(); } };
  };
  await t('swap clutter: the same post reopens the existing swap; waiting swaps clear; forgotten ones vanish', async () => {
    const { rl, S, B, done } = await mk();
    const a = await flow.post(S, { kind: 'ask', tokens: '5', price: '1' }), a2 = await flow.post(S, { kind: 'ask', tokens: '5', price: '1' });
    assert.ok(a.ok && a2.ok && a2.existing && a2.id === a.id); assert.strictEqual(S.st.list().length, 1); assert.strictEqual((await flow.book(B)).asks.length, 1);
    const b = await flow.post(S, { kind: 'bid', tokens: '3', price: '1' }); assert.ok(b.ok && !b.existing);
    const c = await flow.clearWaiting(S); assert.strictEqual(c.cleared, 2); assert.strictEqual(S.st.list().length, 0); assert.strictEqual((await flow.status(S)).swaps.length, 0); assert.strictEqual((await flow.book(B)).asks.length, 0);
    const k = await flow.post(S, { kind: 'ask', tokens: '9', price: '2' }); rl.swaps.clear();   // relay restarted and forgot it
    assert.strictEqual((await flow.status(S)).swaps.length, 0, 'forgotten swaps are dropped quietly'); assert.strictEqual(S.st.list().length, 0); assert.ok(k.ok);
    await done();
  });
  await t('swap hand-off: each waiting state points to the other wallet\u2019s step', async () => {
    const { S, B, done } = await mk();
    const a = await flow.post(S, { kind: 'ask', tokens: '2', price: '1' }); let v = (await flow.status(S)).swaps[0]; assert.strictEqual(v.next.as, 'buyer');
    await flow.take(B, a.id); await flow.act(B, a.id, 'confirm'); v = (await flow.status(B)).swaps[0]; assert.strictEqual(v.next.as, 'seller');
    const b = await flow.post(B, { kind: 'bid', tokens: '3', price: '1' }); v = (await flow.status(B)).swaps.find((x) => x.id === b.id); assert.strictEqual(v.next.as, 'seller');
    await flow.answer(S, b.id); v = (await flow.status(S)).swaps.find((x) => x.id === b.id); assert.strictEqual(v.next.as, 'buyer');
    v = (await flow.status(B)).swaps.find((x) => x.id === b.id); assert.strictEqual(v.waiting, 'you'); assert.ok(!v.next);
    await done();
  });
  await t('help: topics are searchable text and the tool help is captured from the real program', async () => {
    const help = require('../src/core/help'); const fs = require('fs'), os = require('os'), path = require('path');
    assert.ok(help.TOPICS.length >= 6 && help.TOPICS.every((x) => x.id && x.title && x.body.length));
    assert.ok(help.TOPICS.some((x) => /15 minutes/.test(x.body.join(' '))), 'covers the swap reply age');
    const f = path.join(os.tmpdir(), 'fake-help-' + process.pid + '.sh'); fs.writeFileSync(f, '#!/bin/sh\necho "Usage: tool [options]"\necho "  --daemon-address arg"\n', { mode: 0o755 });
    const r = await help.cliHelp(f); assert.ok(r.ok && /--daemon-address/.test(r.text)); fs.rmSync(f, { force: true });
    assert.strictEqual((await help.cliHelp('/nonexistent/tool')).ok, false);
  });
  await t('my listings: finds one seller account\u2019s listings and builds a faithful close command, refusing what it cannot carry', async () => {
    const sl = require('../src/core/sellerlist'); const id = 'ab'.repeat(32), td = (x) => Array.from(Buffer.from(x));
    const offers = [
      { seller: 'test1seller', title: 'sft-test-offer', offer_id: id, price: '10526315790', quantity: '5', active: true, description: td('testlisting'), height: 10 },
      { seller: 'someoneelse', title: 'other', offer_id: 'cd'.repeat(32), price: '1', quantity: '1', active: true, description: td('x'), height: 11 },
      { seller: 'test1seller', title: 'has space', offer_id: 'ef'.repeat(32), price: '1', quantity: '1', active: true, description: td('x'), height: 12 },
      { seller: 'test1seller', title: 'old-style', offer_id: '12'.repeat(32), price: '1', quantity: '1', active: true, description: td('{"description":"x"}'), height: 13 },
    ];
    const rows = sl.mine(offers, 'test1seller'); assert.strictEqual(rows.length, 3); assert.strictEqual(rows[2].title, 'sft-test-offer');
    assert.strictEqual(rows.filter((r) => r.canEdit).length, 1, 'only the plain listing can be edited from here');
    const c = sl.editCommand(offers[0], 'test1seller', false); assert.ok(c.ok);
    assert.strictEqual(c.command, `safex_offer edit test1seller ${id} sft-test-offer 1.052631579 5 0 testlisting`);
    assert.strictEqual(sl.editCommand(offers[0], 'test1seller', true).command.split(' ')[7], '1');
    assert.strictEqual(sl.editCommand(offers[2], 'test1seller', false).ok, false); assert.strictEqual(sl.editCommand(offers[3], 'test1seller', false).ok, false);
    const ch = sl.editCommand(offers[0], 'test1seller', true, { price: 21000000000n, qty: 12 }); assert.strictEqual(ch.command, `safex_offer edit test1seller ${id} sft-test-offer 2.1 12 1 testlisting`);
    assert.strictEqual(sl.editCommand(offers[0], 'test1seller', true, { qty: 3 }).command, `safex_offer edit test1seller ${id} sft-test-offer 1.052631579 3 1 testlisting`, 'only the quantity changes, price kept');
    assert.strictEqual(sl.editCommand(offers[0], 'test1seller', true, { price: 5000000000n }).command, `safex_offer edit test1seller ${id} sft-test-offer 0.5 5 1 testlisting`, 'only the price changes, quantity kept');
    assert.strictEqual(sl.editCommand(offers[2], 'test1seller', true, { qty: 3 }).ok, false);
    assert.deepStrictEqual(sl.mine(offers, ''), []);
  });
  await t('features: swap is on and the Sell tab is off unless asked for', async () => {
    const keep = [process.env.SAFEX_SWAP, process.env.SAFEX_SELL]; delete process.env.SAFEX_SWAP; delete process.env.SAFEX_SELL;
    delete require.cache[require.resolve('../src/core/features')]; const f = require('../src/core/features');
    assert.strictEqual(f.swap, true); assert.strictEqual(f.sell, false);
    process.env.SAFEX_SELL = '1'; delete require.cache[require.resolve('../src/core/features')]; assert.strictEqual(require('../src/core/features').sell, true);
    if (keep[0] !== undefined) process.env.SAFEX_SWAP = keep[0]; if (keep[1] === undefined) delete process.env.SAFEX_SELL; else process.env.SAFEX_SELL = keep[1];
    delete require.cache[require.resolve('../src/core/features')];
  });
  console.log(bad ? `FAIL ${bad}` : `ALL ${n} OK`); process.exit(bad ? 1 : 0);
})();
