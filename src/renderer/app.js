'use strict';
(function () {
  const $ = (id) => document.getElementById(id);
  // Colour theme: Auto (follows the computer), Dark, Light. The choice is remembered on this computer; theme.js applies it before first paint.
  { const b = $('themeBtn'), L = { auto: '\u25D0 Auto', dark: '\u263E Dark', light: '\u2600 Light' }; let cur = 'auto'; try { cur = localStorage.getItem('sw-theme') || 'auto'; } catch (_) {} if (!L[cur]) cur = 'auto';
    const apply = () => { if (cur === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', cur); b.textContent = L[cur]; try { if (cur === 'auto') localStorage.removeItem('sw-theme'); else localStorage.setItem('sw-theme', cur); } catch (_) {} };
    b.onclick = () => { cur = cur === 'auto' ? 'dark' : cur === 'dark' ? 'light' : 'auto'; apply(); }; apply(); }
  const hue = (str) => { let h = 7; for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % 360; };
  const mkTag = (name) => { const t = document.createElement('span'); t.className = 'wtag'; t.textContent = name; t.style.setProperty('--h', hue(name)); return t; };
  const walletName = (file) => String(file || '').split('/').pop().replace(/\.keys$/, '');
  const W = window.wallet;
  let SWAP_ON = false;   // set from the app's feature switch (src/core/features.js) once it starts
  const S = { file: '', node: '127.0.0.1:17402', kind: 'cash', pending: null, timer: null, dir: '' };
  const screens = ['sStart', 'sFile', 'sNode', 'sPass', 'sWait'];
  const show = (id) => { for (const s of screens) $(s).hidden = s !== id; };
  const step = (n) => { $('steps').hidden = !n; for (let i = 1; i <= 3; i++) { const e = $('st' + i); e.className = n === i ? 'on' : n > i ? 'done' : ''; } };
  const say = (el, t, cls) => { el.hidden = !t; el.textContent = t || ''; if (cls !== undefined) el.className = cls; };

  async function start() {
    S.switching = false;
    const i = await W.init(); SWAP_ON = !!(i.features && i.features.swap); document.body.classList.toggle('no-swap', !SWAP_ON); $('tSell').hidden = !(i.features && i.features.sell); S.dir = i.walletsDir; S.node = i.defaultNode; { const m = /^(.+):(\d+)$/.exec(i.defaultNode || ''); if (m) { $('nHost').value = m[1]; $('nPort').value = m[2]; } } $('verFoot').textContent = `Safex SOLO-SYNC Wallet ${i.appVersion} · wallet tools ${i.version}`; document.title = `Safex SOLO-SYNC Wallet ${i.appVersion}`;
    $('toolsBox').hidden = i.tools || !i.supported;
    if (!i.supported) say($('startErr'), 'The wallet tools run on Linux, Mac and Windows only.');
    show('sStart'); step(0);
  }
  W.onLog((m) => { const l = $('dlLog'); l.hidden = false; l.textContent += m + '\n'; l.scrollTop = l.scrollHeight; });
  $('dlTools').onclick = async () => { $('dlTools').disabled = true; const r = await W.downloadTools(); if (r.ok) { $('toolsBox').hidden = true; } else { say($('startErr'), r.error); $('dlTools').disabled = false; } };

  // --- login flow: file -> node -> password ---
  const tool = (mode) => async () => { const r = await W.createWallet({ node: S.node, mode }); say($('startErr'), r.ok ? '' : r.error); if (!r.ok && /Download the wallet tools/.test(r.error || '')) { $('toolsBox').hidden = false; $('toolsBox').scrollIntoView(); } $('createNote').hidden = !r.ok; };
  $('bCreate').onclick = tool('new'); $('bSeed').onclick = tool('seed'); $('bSpend').onclick = tool('spend');
  async function openFile() {
    const r = await W.listWallets(); const box = $('walletList'); box.textContent = '';
    for (const f of r.wallets || []) { const b = document.createElement('button'); b.className = 'btn'; const nm = f.replace(/\.keys$/, ''); b.appendChild(mkTag(nm)); if (S.lastOpen === nm) { const w = document.createElement('span'); w.className = 'wnote'; w.textContent = 'was open'; b.appendChild(w); } b.onclick = () => choose((r.dir || S.dir) + '/' + f, b); box.appendChild(b); }
    S.file = ''; $('chosen').hidden = true; $('fileNext').disabled = true; step(1); show('sFile');
  }
  function choose(file, btn, outside) { S.file = file; $('adoptRow').hidden = !outside; $('adoptBox').checked = true; for (const b of $('walletList').children) b.classList.toggle('sel', b === btn); say($('chosen'), file); $('fileNext').disabled = false; }
  $('bOpen').onclick = openFile;
  $('bBrowse').onclick = async () => { const r = await W.pickFile(); if (r.ok) choose(r.file, null, r.outside); };
  $('fileNext').onclick = async () => {
    if (!$('adoptRow').hidden && $('adoptBox').checked) {
      const r = await W.adopt({ file: S.file });
      if (!r.ok) { say($('chosen'), r.error); $('adoptBox').checked = false; return; }
      S.file = r.file; say($('chosen'), r.file); $('adoptRow').hidden = true;
    }
    if (S.switching) return goNext(); step(2); show('sNode'); say($('nodeRes'), '');
  };
  // Forgiving: if the whole address (host:port) is typed or pasted into the host box, split it instead of adding the port twice.
  const nodeStr = () => {
    let h = $('nHost').value.trim().replace(/^https?:\/\//, '').replace(/\/+$/, ''), pt = $('nPort').value.trim();
    const m = /^([^:]+):(\d{2,5})$/.exec(h); if (m) { h = m[1]; pt = m[2]; $('nHost').value = h; $('nPort').value = pt; }
    return h + ':' + pt;
  };
  $('nodeNext').onclick = async () => {
    S.node = nodeStr(); const el = $('nodeRes'); say(el, 'Checking the node…', 'note');
    const r = await W.checkNode({ node: S.node });
    if (!r.ok) { say(el, `${r.error}. Start your node first, or change the address. You can continue anyway.`, 'note bad'); $('nodeNext').textContent = 'Continue anyway'; if (S.warned) goNext(); S.warned = true; return; }
    goNext();
  };
  function goNext() { S.warned = false; $('nodeNext').textContent = 'Check and continue'; $('passFor').textContent = S.file.split('/').pop(); $('passTag').textContent = ''; $('passTag').appendChild(mkTag(walletName(S.file))); $('pw').value = ''; say($('passErr'), ''); step(3); show('sPass'); $('pw').focus(); }
  for (const b of document.querySelectorAll('.back')) b.onclick = () => { const cur = screens.find((s) => !$(s).hidden); if (cur === 'sFile' && S.switching) { S.switching = false; $('login').hidden = true; $('app').hidden = false; poll(); } else if (cur === 'sPass' && S.switching) { step(1); show('sFile'); } else if (cur === 'sFile') { step(0); show('sStart'); } else if (cur === 'sNode') { step(1); show('sFile'); } else { step(2); show('sNode'); } };
  // Blank everything that belongs to the wallet that was open, so the next wallet never shows its numbers or transactions
  // (a wallet that is catching up with the chain answers slowly, and until it does the old screen would stay put).
  function resetWalletView() {
    S.gen = (S.gen || 0) + 1; S.addrs = []; S.addrFor = null; { const sel = $('addrPick'); sel.textContent = ''; const o = document.createElement('option'); o.value = ''; o.textContent = 'Saved addresses…'; sel.appendChild(o); $('addrDel').hidden = true; $('addrNameRow').hidden = true; }
    for (const k of ['balCash', 'balTok']) $(k).textContent = '\u2014';
    for (const k of ['subCash', 'subTok', 'subTokTotal']) $(k).textContent = '';
    $('addr').textContent = '\u2014'; $('blk').textContent = 'Block \u2014';
    const chip = $('chip'); chip.className = 'chip'; chip.textContent = 'Connecting\u2026';
    const tg = $('walletTag'); tg.textContent = ''; tg.hidden = true;
    $('hBody').textContent = ''; $('hEmpty').hidden = true;
    $('lastIn').textContent = '\u2014'; $('lastOut').textContent = '\u2014';
    $('recentList').textContent = ''; $('recentEmpty').hidden = false; $('recentEmpty').textContent = 'Loading this wallet\u2026';
    $('mkList').textContent = ''; M.rows = null; S.selTx = null; S.pending = null; $('stTotal').textContent = '\u2014'; $('stTotalSub').textContent = ''; $('stStatus').textContent = ''; $('stBody').textContent = '';
    for (const k of ['toAddr', 'amt']) { const e = $(k); if (e) e.value = ''; }
    const sm = $('sendMsg'); if (sm) sm.textContent = '';
  }
  async function unlock() {
    const pw = $('pw').value; $('pw').value = ''; say($('passErr'), ''); $('waitMsg').textContent = 'Opening your wallet…'; show('sWait');
    const r = await W.unlock({ file: S.file, node: S.node, password: pw });
    if (!r.ok) { show('sPass'); say($('passErr'), r.error); return; }
    S.switching = false; resetWalletView(); tab('home');
    $('login').hidden = true; $('app').hidden = false; poll(); if (S.wantExplorer) { S.wantExplorer = false; $('tExplorer').click(); } clearInterval(S.timer); S.timer = setInterval(poll, 5000);
    if (r.catchUp) { busyOn(); const c = await W.catchUp(); busyOff(); await poll(); if (!c.ok) say($('wMsg'), c.error); }   // a wallet far behind the chain is caught up with a progress readout
  }
  $('unlock').onclick = unlock; $('pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock(); });
  { const bs = [$('updBtn'), $('updBtn2')].filter(Boolean);   // the same button sits in the top bar and on the first screen, so an update can be started before logging in
    const b = new Proxy({}, { get: (_, k) => bs[0][k], set: (_, k, v) => { bs.forEach((x) => { x[k] = v; }); return true; } });
    let armTimer = null, info = null; const MAC = /Mac/.test(navigator.platform);   // on a Mac, reading Downloads asks permission, so it is only done when the button is pressed
    const label = () => { b.disabled = false; b.textContent = `Update to ${info.version}`; b.title = `Installs ${info.version} from your Downloads folder, then restarts the wallet (you will log in again).`; };
    const macIdle = (note) => { b.hidden = false; b.textContent = note || 'Check for update'; b.title = 'Looks in your Downloads folder for a newer update file (macOS asks permission the first time).'; };
    const check = async (manual) => { if (b.disabled) return; let r = null; try { r = await W.updateCheck(); } catch (_) {} info = r && r.update; if (!info) { if (MAC) { macIdle(manual === true ? 'No update in Downloads' : null); if (manual === true) setTimeout(() => { if (!info && !b.disabled) macIdle(); }, 4000); } else b.hidden = true; return; } b.hidden = false; if (!armTimer) label(); };
    b.onclick = async () => {
      if (!info) { if (MAC) check(true); return; }
      if (!armTimer) { b.textContent = 'Click again to install and restart'; armTimer = setTimeout(() => { armTimer = null; label(); }, 6000); return; }
      clearTimeout(armTimer); armTimer = null; b.disabled = true; b.textContent = 'Updating…';
      const r = await W.updateApply();
      if (r && r.ok) b.textContent = `Installed ${r.version}, restarting…`;
      else { b.disabled = false; b.textContent = 'Update failed'; b.title = (r && r.error) || 'Unknown error'; setTimeout(check, 12000); }
    };
    if (MAC) macIdle(); else { check(); setInterval(check, 600000); window.addEventListener('focus', check); } }
  $('switch').onclick = async () => { S.switching = true; resetWalletView(); $('app').hidden = true; $('login').hidden = false; const i = await W.init(); S.dir = i.walletsDir; await openFile(); };
  $('lock').onclick = async () => { clearInterval(S.timer); await W.lock(); $('app').hidden = true; $('login').hidden = false; resetWalletView(); tab('home'); await start(); };

  // --- wallet screens ---
  const tab = (name) => { exVisible = name === 'explorer'; for (const [v, t, n] of [['vHome', 'tHome', 'home'], ['vHist', 'tHist', 'hist'], ['vMarket', 'tMarket', 'market'], ['vStake', 'tStake', 'stake'], ['vSell', 'tSell', 'sell'], ['vSwap', 'tSwap', 'swap'], ['vExplorer', 'tExplorer', 'explorer'], ['vHelp', 'tHelp', 'help']]) { $(v).hidden = name !== n; $(t).classList.toggle('sel', name === n); } };
  $('tHome').onclick = () => tab('home'); $('tSell').onclick = () => tab('sell'); $('tSwap').onclick = () => { tab('swap'); swapLoad(); }; $('tHist').onclick = () => { S.selTx = null; markHist(); tab('hist'); }; $('tMarket').onclick = () => { tab('market'); if (!M.rows) loadMarket(); };
  $('tExplorer').onclick = () => { tab('explorer'); exVisible = true; exRefresh(true); };
  $('tStake').onclick = () => { tab('stake'); loadStake(); }; $('stLoad').onclick = loadStake;
  let stakeInfo = null;
  async function loadStake() {
    $('stLoad').disabled = true; say($('stMsg'), 'Reading staking data from your node…', 'msg');
    const r = await W.staking(); $('stLoad').disabled = false; const dl = $('stBody'); dl.textContent = ''; $('stStatus').textContent = '';
    if (!r.ok) return say($('stMsg'), r.error, 'msg bad');
    stakeInfo = r;
    $('stTotal').textContent = `${r.tokensTotal} SFT`; $('stTotalSub').textContent = `${r.tokensUnlocked} unlocked · ${r.tokensLockedAmt} locked · ${r.staked} staked`;
    const addTo = (d) => (k, v) => { const a = document.createElement('dt'); a.textContent = k; const b = document.createElement('dd'); b.textContent = v; d.append(a, b); };
    const st = addTo($('stStatus')), add = addTo(dl);
    st('Staked', `${r.staked} SFT`); st('Locked tokens', `${r.tokensLockedAmt} SFT`); st('Unlocked tokens', `${r.tokensUnlocked} SFT`); st('Staked and unlocked', `${r.stakedUnlocked} SFT`);
    st('Rewards available', r.interest != null ? `${r.interest} SFX` : 'not reported by the wallet tool (see below)');
    if (r.tip) { st('Current block', Number(r.tip).toLocaleString()); st('Next interval at block', Number(r.nextInterval).toLocaleString()); }
    if (r.interest == null && r.interestNote) { const n = document.createElement('dd'); n.className = 'small mute'; n.textContent = 'Wallet tool said: ' + r.interestNote; $('stStatus').append(document.createElement('dt'), n); }
    $('stAvail').textContent = r.tokensUnlocked; $('unAvail').textContent = r.staked;
    const n = r.network;
    if (!n.ok) { add('Network rewards', 'Unknown'); return say($('stMsg'), n.error, 'msg bad'); }
    add('Paying rewards now', n.recentPaying ? 'Yes. At least one of the last 10 intervals paid something.' : `No. None of the last ${n.recentChecked || 10} intervals paid anything.`);
    add('Last interval that paid', n.lastPaidInterval == null ? 'Never' : `${n.lastPaidInterval} (${age(n.lastPaidBlocksAgo).replace('old', 'ago')})`);
    add('Intervals that ever paid', `${n.paidIntervals} of ${n.intervals}`); say($('stMsg'), '');
  }
  function stakeAsk(kind) {
    const amount = $((kind === 'unstake' ? 'un' : 'st') + 'Amt').value.trim(), height = kind === 'unstake' ? $('unHeight').value.trim() : '';
    if (!/^\d{1,12}(\.\d{1,10})?$/.test(amount)) return say($('stMsg'), 'Enter an amount of SFT, for example 25000.', 'msg bad');
    const rows = [[kind === 'unstake' ? 'Unstake' : 'Stake', amount + ' SFT', true]]; if (height) rows.push(['Staked at block', height]);
    actShow(kind === 'unstake' ? 'Unstake tokens' : 'Stake tokens', rows, 'Enter your wallet password to ask the wallet tool for the exact network fee. Nothing is sent yet.', (pw) => W.stakeQuote({ kind, amount, height, password: pw }));
    Act.done = () => { $('stAmt').value = ''; $('unAmt').value = ''; $('unHeight').value = ''; loadStake(); };
  }
  $('stBtn').onclick = () => stakeAsk('stake'); $('unBtn').onclick = () => stakeAsk('unstake');
  const M = { rows: null, shown: 50, tip: 0 };
  const age = (b) => { const d = (b * 2) / 1440; return d >= 730 ? `about ${(d / 365).toFixed(1)} years old` : d >= 60 ? `about ${Math.round(d / 30)} months old` : d < 1 ? 'less than a day old' : `about ${Math.round(d)} days old`; };
  async function loadMarket() {
    $('mkLoad').disabled = true; say($('mkMsg'), 'Reading listings from your node…', 'msg');
    const r = await W.offers(); $('mkLoad').disabled = false;
    if (!r.ok) { say($('mkMsg'), r.error, 'msg bad'); return; }
    M.rows = r.rows; M.tip = r.tip; M.shown = 50; say($('mkMsg'), ''); renderMarket();
  }
  function renderMarket() {
    if (!M.rows) return;
    const q = $('mkSearch').value.trim().toLowerCase(), act = $('mkActive').checked, sort = $('mkSort').value;
    const gear = $('mkGear').checked, showNew = $('mkNew').checked;
    let rows = M.rows.filter((x) => (!act || x.active) && (!gear || x.gear) && (showNew || !x.ready || x.ready.ready) && (!q || x.title.toLowerCase().includes(q) || x.seller.toLowerCase().includes(q)));
    const num = (x) => { try { return BigInt(x.pegged ? x.minSfx : x.price); } catch (_) { return 0n; } };
    rows = rows.slice().sort((a, b) => (sort === 'new' ? b.height - a.height : sort === 'low' ? (num(a) < num(b) ? -1 : num(a) > num(b) ? 1 : 0) : (num(a) > num(b) ? -1 : num(a) < num(b) ? 1 : 0)));
    const hiddenNew = M.rows.filter((x) => x.ready && !x.ready.ready).length;
    $('mkCount').textContent = `${rows.length} listing${rows.length === 1 ? '' : 's'} (of ${M.rows.length} on chain)` + (hiddenNew && !showNew ? `, ${hiddenNew} still confirming (tick "Show confirming" to see them)` : '');
    const box = $('mkList'); box.textContent = '';
    for (const x of rows.slice(0, M.shown)) {
      const b = document.createElement('button'); b.className = 'mkitem';
      const t = document.createElement('span'); t.className = 't'; t.textContent = x.title;
      const p = document.createElement('span'); p.className = 'p'; p.textContent = x.pegged ? `pegged · min ${x.minFmt} SFX` : `${x.priceFmt} SFX`;
      const m = document.createElement('span'); m.className = 'm'; m.textContent = `${x.seller} · qty ${x.qtyFmt}`;
      const g = document.createElement('span'); g.className = 'tag'; g.textContent = `${x.active ? 'active on chain' : 'inactive'} · ${x.ageBlocks ? age(x.ageBlocks) : 'block ' + x.height}`;
      if (x.ready && !x.ready.ready) { const w = document.createElement('span'); w.className = 'wait'; w.textContent = ` · Confirming, ${x.ready.remaining} more blocks (about ${x.ready.minutes} min)`; g.appendChild(w); }
      b.append(t, p, m, g); b.onclick = () => openOffer(x.i); box.appendChild(b);
    }
    $('mkMore').hidden = rows.length <= M.shown;
  }
  async function openOffer(i) {
    const r = await W.offer({ i }); if (!r.ok) return say($('mkMsg'), r.error, 'msg bad');
    $('dTitle').textContent = r.title; const dl = $('dBody'); dl.textContent = '';
    const add = (k, v) => { if (!v) return; const a = document.createElement('dt'); a.textContent = k; const b = document.createElement('dd'); b.textContent = v; dl.append(a, b); };
    add('Seller', r.seller); if (r.pegged) add('Price peg (unverified)', `Priced against a peg set by its creator. Minimum ${r.minSfx} SFX. Peg rates are not maintained by the network, so no dollar value is shown.`); add('Price', r.pegged ? `Pegged price. Minimum ${r.minSfx} SFX` : `${r.price} SFX`); add('Quantity', r.qty);
    add('Status on chain', r.active ? 'Active (the chain only records that it was never closed)' : 'Inactive'); add('Listed at block', String(r.height));
    add('Ships', [r.shipping, r.country].filter(Boolean).join(' · ')); add('SKU', r.sku); add('Product code', r.barcode); add('Offer ID', r.offerId);
    $('dText').textContent = r.text; $('dImgs').textContent = r.images.length ? 'Picture links (not loaded here): ' + r.images.join('  ') : '';
    $('mkDetail').hidden = false; $('mkList').parentElement.hidden = true; $('mkSellerBox').hidden = true;
    M.cur = { ...r, i }; $('buyBox').hidden = !r.canBuy; $('buyQty').value = '1'; buyMath();
    const rd = r.ready, wait = r.canBuy && rd && !rd.ready; $('buyBtn').disabled = !!wait; $('buyBtn').textContent = wait ? `Confirming · ${rd.remaining} more blocks (about ${rd.minutes} min)` : 'Buy'; $('buyBtn').classList.toggle('waiting', !!wait);
  }
  $('mkBack').onclick = () => { $('mkDetail').hidden = true; $('mkList').parentElement.hidden = false; };
  $('mkSellers').onclick = () => {
    const box = $('mkSellerBox'); if (!box.hidden) { box.hidden = true; return; }
    if (!M.rows) return; const by = new Map();
    for (const x of M.rows) { const e = by.get(x.seller) || { name: x.seller, total: 0, active: 0, last: 0 }; e.total++; if (x.active) e.active++; e.last = Math.max(e.last, x.height); by.set(x.seller, e); }
    const list = [...by.values()].sort((a, b) => b.active - a.active || b.total - a.total);
    box.textContent = '';
    for (const e of list) {
      const b = document.createElement('button'); b.className = 'mkitem';
      const t = document.createElement('span'); t.className = 't'; t.textContent = e.name || '(no name)';
      const p = document.createElement('span'); p.className = 'p'; p.textContent = e.active ? `${e.active} active / ${e.total} listed` : `none active / ${e.total} listed`;
      const m = document.createElement('span'); m.className = 'm'; m.textContent = `newest listing ${age(Math.max(0, M.tip - e.last))}`;
      b.append(t, p, m); b.onclick = () => { $('mkSearch').value = e.name; if (!e.active) $('mkActive').checked = false; box.hidden = true; M.shown = 50; renderMarket(); }; box.appendChild(b);
    }
    box.hidden = false;
  };
  $('mkLoad').onclick = loadMarket; $('mkMore').onclick = () => { M.shown += 50; renderMarket(); };
  for (const id of ['mkSearch', 'mkSort', 'mkActive', 'mkGear', 'mkNew']) $(id).addEventListener(id === 'mkSearch' ? 'input' : 'change', () => { M.shown = 50; renderMarket(); });
  const syncTok = () => { const on = !!S.mixedSend && S.kind === 'cash' && !$('sendMax').checked; $('tokRow').hidden = !on; if (!on) $('amtTok').value = ''; };
  const asset = (kind) => { S.kind = kind; $('cardCash').classList.toggle('sel', kind === 'cash'); $('cardTok').classList.toggle('sel', kind === 'token'); $('sendTitle').textContent = kind === 'cash' ? 'Send Safex Cash (SFX)' : 'Send Safex Tokens (SFT)'; say($('sendMsg'), ''); syncTok(); if ($('sendMax').checked) fillMax(); };
  $('cardCash').onclick = () => asset('cash'); $('cardTok').onclick = () => asset('token');
  $('copy').onclick = async () => { await W.copy({ text: $('addr').textContent }); $('copy').classList.add('done'); $('copy').title = 'Copied'; setTimeout(() => { $('copy').classList.remove('done'); $('copy').title = 'Copy address'; }, 1500); };
  const when = (t) => (t ? new Date(t * 1000).toLocaleString() : '—');
  function markHist(scroll) { let hit = null; for (const tr of $('hBody').children) { const on = !!S.selTx && tr.dataset.txid === S.selTx; tr.classList.toggle('hl', on); if (on) hit = tr; } if (scroll && hit) hit.scrollIntoView({ block: 'center' }); }
  const showTx = (txid) => { S.selTx = txid; tab('hist'); markHist(true); };
  const link = (el, txid) => { if (!txid) return; el.tabIndex = 0; el.setAttribute('role', 'link'); el.title = 'Show in History'; el.onclick = () => showTx(txid); el.onkeydown = (e) => { if (e.key === 'Enter') showTx(txid); }; };
  async function poll() {
    if (S.switching) return; const gen = S.gen || 0; const s = await W.snapshot(); if (!s.ok || S.switching || gen !== (S.gen || 0)) return;   // a reply that crosses a wallet switch belongs to the old wallet: drop it
    S.mixedSend = !!s.mixedSend; S.availCash = s.cashUnlocked; S.availTok = s.tokensUnlocked; syncTok(); if ($('sendMax').checked) fillMax();
    if (s.name && S.addrFor !== s.name) { S.addrFor = s.name; loadAddrs(); }   // each wallet has its own saved addresses
    $('balCash').textContent = s.cashEstimated ? s.cash : s.cashUnlocked; $('balTok').textContent = s.tokensUnlocked;   // SFT: what can be spent now; locked tokens are shown under it, not in it
    // SFX works like SFT: the big number is what can be spent now, with the locked part under it (while a send settles it shows the estimate instead)
    $('subCash').textContent = [s.cashEstimated ? `≈ estimate while your send settles · ${s.cashUnlocked} available now` : '', !s.cashEstimated && s.cashLocked ? `${s.cashLockedAmt} locked` : ''].filter(Boolean).join(' · ');
    $('subTok').textContent = [s.tokensEstimated ? '≈ estimate while your send settles' : '', s.tokensLocked ? `${s.tokensLockedAmt} locked` : ''].filter(Boolean).join(' · ');
    // the big SFT number is what is unlocked (can be spent now); the locked amount sits under it and the total with staked beside it
    $('subTokTotal').textContent = s.staked && s.staked !== '0' ? `Total with staked: ${s.tokensTotal} SFT (${s.staked} staked)` : '';
    if (s.name) { const tg = $('walletTag'); const nm = walletName(s.name); if (tg.textContent !== nm) { tg.textContent = nm; tg.style.setProperty('--h', hue(nm)); } tg.hidden = false; S.lastOpen = nm; }
    $('addr').textContent = s.address; $('blk').textContent = 'Block ' + (s.nodeHeight || s.walletHeight || '—');
    const chip = $('chip'); if (!s.nodeOk) { chip.className = 'chip bad'; chip.textContent = 'Node not reachable'; } else if (!s.nodeSynced) { chip.className = 'chip warn'; chip.textContent = 'Node syncing'; } else if (!s.walletSynced) { chip.className = 'chip warn'; chip.textContent = `Wallet scanning (${s.walletHeight} / ${s.nodeHeight})`; } else { chip.className = 'chip ok'; chip.textContent = 'Synced'; }
    const body = $('hBody'); body.textContent = '';
    for (const x of s.history) {
      const tr = document.createElement('tr'); const cells = [when(x.time), x.txid, x.type === 'out' ? 'Out' : 'In', x.type === 'in' || x.type === 'out' ? 'Confirmed' : x.type === 'failed' ? 'Failed' : 'Pending', x.kind, x.amount, x.fee, x.height || '—', x.conf || '—'];
      tr.dataset.txid = x.txid; tr.onclick = () => { S.selTx = x.txid; markHist(); };
      cells.forEach((c, i) => { const td = document.createElement('td'); td.textContent = c; if (i === 1) { td.className = 'tx'; td.title = 'Open in Explorer'; td.onclick = (e) => { e.stopPropagation(); window.exOpenTx(c); }; } tr.appendChild(td); }); body.appendChild(tr);
    }
    $('hEmpty').hidden = s.history.length > 0; markHist();
    const isOut = (x) => x.type === 'out' || x.type === 'pending' || x.type === 'failed';
    const desc = (x) => `${isOut(x) ? '−' : '+'}${x.amount}${x.kind === 'SFX + SFT' ? '' : ' ' + x.kind}`;
    const UNLOCK = 11; // same Confs column as History: coins are spendable once it reads 11
    const state = (x) => {
      if (x.type === 'failed') return { t: 'Failed', c: 'bad' };
      if (!x.height) return { t: 'Waiting for first confirmation', c: 'wait' };
      if (x.conf < UNLOCK) { const n = UNLOCK - x.conf; return { t: `Locked · ${n} more block${n === 1 ? '' : 's'} (about ${n * 2} min)`, c: 'bad' }; }
      return { t: 'Unlocked', c: 'good' };
    };
    const pill = (el, x) => { const st = state(x); const b = document.createElement('span'); b.className = 'pill ' + st.c; b.textContent = st.t; el.appendChild(b); };
    const fillLine = (id, x) => { const el = $(id); el.textContent = ''; if (!x) { el.textContent = 'None yet'; el.parentElement.onclick = null; return; } const a = document.createElement('span'); a.className = 'amt ' + (x.kind === 'SFT' ? 'sft' : 'sfx'); a.textContent = desc(x); el.append(a, document.createElement('br')); const d = document.createElement('span'); d.className = 'd'; d.textContent = when(x.time) + ' '; el.appendChild(d); pill(el, x); link(el.parentElement, x.txid); };
    fillLine('lastIn', s.history.find((x) => !isOut(x)));
    fillLine('lastOut', s.history.find((x) => x.type !== 'failed' && isOut(x)));
    const rl = $('recentList'); rl.textContent = '';
    for (const x of s.history.slice(0, 5)) {
      const li = document.createElement('li'); li.className = x.type === 'failed' ? 'fail' : isOut(x) ? 'out' : 'in';
      const l = document.createElement('span'); const r = document.createElement('span');
      l.textContent = x.type === 'failed' ? 'Failed' : x.type === 'out' ? 'Sent' : x.type === 'in' ? 'Received' : isOut(x) ? 'Sending' : 'Incoming';
      const d = document.createElement('span'); d.className = 'd'; d.textContent = when(x.time) + ' '; pill(d, x); l.appendChild(d);
      r.textContent = desc(x); r.className = 'amt ' + (x.kind === 'SFT' ? 'sft' : 'sfx'); li.append(l, r); link(li, x.txid); rl.appendChild(li);
    }
    $('recentEmpty').textContent = 'No transactions yet.'; $('recentEmpty').hidden = s.history.length > 0;
  }
  const exSfx = (v) => (v == null ? '—' : (v >= 100 ? v.toFixed(2) : v.toFixed(4)).replace(/\.?0+$/, '') + ' SFX');
  // ---- light explorer -----------------------------------------------------
  let exVisible = false, exRows = [], exTip = 0, exBusy = false;
  const exShort = (h) => h ? h.slice(0, 10) + '…' + h.slice(-8) : '';
  const exAge = (t) => { const d = Math.max(0, Math.floor(Date.now() / 1000 - t)); return d < 90 ? d + ' s' : d < 5400 ? Math.round(d / 60) + ' min' : d < 172800 ? Math.round(d / 3600) + ' h' : Math.round(d / 86400) + ' d'; };
  const exKB = (n) => (n / 1024).toFixed(1) + ' KB';
  function exCell(tr, text, cls) { const td = document.createElement('td'); td.textContent = text; if (cls) td.className = cls; tr.appendChild(td); return td; }
  function exErr(msg) { $('exErr').hidden = !msg; $('exErr').textContent = msg || ''; }
  function exSourceUnused(r) { $('exSrc').textContent = r && r.source ? (r.source === 'local' ? 'Reading from your own node.' : 'Your node is not answering, so this is read from the public Safex node.') : ''; }
  function exRender() {
    const body = $('exBody'); body.textContent = '';
    for (const b of exRows) {
      const tr = document.createElement('tr'); tr.style.cursor = 'pointer'; tr.title = 'Open block ' + b.height;
      exCell(tr, b.height.toLocaleString(), 'num'); exCell(tr, exAge(b.time) + ' ago'); exCell(tr, exShort(b.hash)).title = b.hash;
      exCell(tr, String(b.txs), 'num'); exCell(tr, exKB(b.size), 'num'); exCell(tr, exSfx(b.reward), 'num');
      tr.onclick = () => exOpen(String(b.height));
      body.appendChild(tr);
    }
  }
  async function exRefresh(reset) {
    if (exBusy || !exVisible || !$('exDetail').hidden) return;
    exBusy = true;
    try {
      const r = await W.exRecent({ count: 20 });
      if (!r.ok) { exErr(r.error); return; }
      exErr(''); exTip = r.tip; exPoolRefresh();
      if (reset || !exRows.length) exRows = r.blocks;
      else { const low = r.blocks.length ? r.blocks[r.blocks.length - 1].height : 0; exRows = r.blocks.concat(exRows.filter((b) => b.height < low)); }
      $('exMore').hidden = false; exRender();
    } finally { exBusy = false; }
  }
  $('exMore').onclick = async () => {
    if (!exRows.length) return;
    const r = await W.exRecent({ count: 20, before: exRows[exRows.length - 1].height });
    if (!r.ok) { exErr(r.error); return; }
    exErr(''); exRows = exRows.concat(r.blocks); exRender();
    if (!r.blocks.length) $('exMore').hidden = true;
  };
  function fact(body, k, v, copy) {
    const tr = document.createElement('tr'); exCell(tr, k, 'k'); const td = exCell(tr, v); 
    if (copy) { td.style.cursor = 'copy'; td.title = 'Click to copy'; td.onclick = () => W.copy({ text: copy }); }
    body.appendChild(tr);
  }
  const HEX64 = /^[0-9a-f]{64}$/i;
  async function exOpen(q) {
    q = String(q || '').trim(); if (!q) return;
    let r = await W.exBlock({ q });
    // A 64-character hash may be a block hash or a transaction hash (the one people share after a send): try block, then transaction.
    if (!r.ok && HEX64.test(q)) { const t = await W.exTx({ hash: q.toLowerCase() }); if (t.ok) return exShowTx(t, true); if (r.error === 'No such block.') r = { ok: false, error: 'No block or transaction with that hash.' }; }
    if (!r.ok) { exErr(r.error); return; }
    exErr('');
    const h = r.header, mine = false;
    $('exList').hidden = true; $('exPoolBox').hidden = true; $('exDetail').hidden = false; $('exLatest').hidden = false; $('exTxBox').hidden = true; $('exTxsK').hidden = false; $('exTxs').hidden = false;
    $('exTitle').textContent = 'Block ' + h.height.toLocaleString() + (mine ? ' · paid to your wallet' : '') + (h.orphan ? ' · orphan' : '');
    const f = $('exFacts'); f.textContent = '';
    fact(f, 'Hash', h.hash, h.hash); fact(f, 'Previous', h.prev, h.prev);
    fact(f, 'Time', new Date(h.time * 1000).toLocaleString() + ' (' + exAge(h.time) + ' ago)');
    fact(f, 'Difficulty', Number(h.difficulty).toLocaleString()); fact(f, 'Reward', exSfx(h.reward));
    fact(f, 'Size', exKB(h.size)); fact(f, 'Confirmations', Number(h.depth).toLocaleString()); fact(f, 'Nonce', String(h.nonce));
    if (r.coinbase) fact(f, 'Coinbase', r.coinbase.outputs + ' output(s), ' + exSfx(r.coinbase.cash) + (r.coinbase.tokens ? ' + ' + r.coinbase.tokens + ' tokens' : ''));
    const box = $('exTxs'); box.textContent = '';
    if (!r.txHashes.length) box.textContent = 'No transactions besides the coinbase.';
    for (const t of r.txHashes) { const a = document.createElement('button'); a.className = 'txbtn'; a.textContent = t; a.onclick = () => exTx(t); box.appendChild(a); }
  }
  async function exTx(hash) {
    const r = await W.exTx({ hash });
    if (!r.ok) { exErr(r.error); return; }
    exShowTx(r, false);
  }
  // alone = opened by searching a transaction hash (no block page behind it), so show it as its own page
  function exShowTx(r, alone) {
    exErr(''); $('exTxBox').hidden = false; $('exTxK').hidden = !!alone;
    if (alone) {
      $('exList').hidden = true; $('exPoolBox').hidden = true; $('exDetail').hidden = false; $('exLatest').hidden = false;
      $('exTitle').textContent = 'Transaction'; $('exTxK').hidden = true; $('exFacts').textContent = ''; $('exTxs').textContent = ''; $('exTxsK').hidden = true; $('exTxs').hidden = true;
    }
    const f = $('exTxFacts'); f.textContent = '';
    fact(f, 'Hash', r.hash, r.hash);
    fact(f, 'Status', r.inPool ? 'Waiting in the pool (not in a block yet)' : 'In block ' + Number(r.height).toLocaleString() + (r.confirmations != null ? ' · ' + r.confirmations.toLocaleString() + ' confirmation' + (r.confirmations === 1 ? '' : 's') : ''));
    fact(f, 'Inputs / outputs', r.inputs + ' in, ' + r.outputs + ' out'); fact(f, 'Ring size', String(r.ringSize));
    fact(f, 'Fee', exSfx(r.fee)); fact(f, 'Size', exKB(r.size));
    if (r.tokenOutputs) fact(f, 'Token outputs', String(r.tokenOutputs));
    const bb = $('exTxBlock'); bb.hidden = r.height == null; if (r.height != null) bb.onclick = () => exOpen(String(r.height));
  }
  async function exPoolRefresh() {
    const r = await W.exPool(); const box = $('exPool'); box.textContent = '';
    if (!r.ok || !r.txs.length) { $('exPoolBox').hidden = true; return; }
    $('exPoolBox').hidden = false; $('exPoolK').textContent = 'Waiting in the pool (' + r.txs.length + ') · not in a block yet';
    for (const t of r.txs) { const a = document.createElement('button'); a.className = 'txbtn'; a.textContent = t.hash; a.title = exAge(t.time) + ' ago'; a.onclick = () => exOpen(t.hash); box.appendChild(a); }
  }
  function exBackToList() { $('exDetail').hidden = true; $('exList').hidden = false; $('exTxBox').hidden = true; $('exLatest').hidden = true; exErr(''); exRefresh(false); }
  $('exGo').onclick = () => exOpen($('exQ').value);
  $('exQ').onkeydown = (e) => { if (e.key === 'Enter') exOpen($('exQ').value); };
  $('exBack').onclick = exBackToList; $('exLatest').onclick = () => { $('exQ').value = ''; exBackToList(); };
  setInterval(() => exRefresh(false), 10000);
  const exOpenTab = () => { $('tExplorer').click(); };
  W.onOpenExplorer(() => { if (!$('app').hidden) exOpenTab(); else S.wantExplorer = true; });
  W.flags().then((f) => { if (f && f.explorer) S.wantExplorer = true; });
  window.exOpenTx = (h) => { exOpenTab(); exOpen(h); };

  // "Send everything": the entry box shows what is available (SFX: the network fee still comes out of it when you review)
  const fillMax = () => { const v = S.kind === 'cash' ? S.availCash : S.availTok; if (v != null) $('amt').value = v; };
  $('sendMax').onchange = () => { syncTok(); const on = $('sendMax').checked; $('amt').disabled = on; $('amt').placeholder = on ? 'Everything available, minus the network fee' : 'How much to send?'; if (on) fillMax(); else $('amt').value = ''; };
  $('review').onclick = async () => {
    $('review').disabled = true; say($('sendMsg'), '');
    const r = await W.prepare({ kind: S.kind, address: $('toAddr').value, amount: $('amt').value, ringSize: $('ring').value, max: $('sendMax').checked, tokenAmount: $('tokRow').hidden ? '' : $('amtTok').value });
    $('review').disabled = false;
    $('sweepBtn').classList.toggle('hot', !r.ok && /Sweep dust/.test(r.error || ''));
    if (!r.ok) return say($('sendMsg'), r.error, 'msg bad');
    S.pending = r; $('mTitle').textContent = 'Confirm send'; $('mToK').textContent = 'To'; $('mSend').textContent = 'Send now'; $('mAmt').textContent = r.mixed ? `${r.amount} SFX + ${r.tokenAmount} SFT (one transaction)` : `${r.amount} ${r.unit}`; $('mTo').textContent = r.address; $('mFee').textContent = `${r.fee} SFX`; openModal();
  };
  $('sweepBtn').onclick = async () => {
    $('sweepBtn').disabled = true; say($('sendMsg'), 'Looking for dust…');
    const r = await W.prepareSweep(); $('sweepBtn').disabled = false;
    if (!r.ok) return say($('sendMsg'), r.error, 'msg bad');
    say($('sendMsg'), ''); S.pending = r; $('mTitle').textContent = 'Confirm sweep'; $('mToK').textContent = 'Into'; $('mSend').textContent = 'Sweep now';
    $('mAmt').textContent = `${r.amount} ${r.unit}`; $('mTo').textContent = `Your own address: ${r.cashTxs} SFX transaction${r.cashTxs === 1 ? '' : 's'}. Privacy note: these old coins cannot be hidden among others, so the sweep publicly links them to your address.`; $('mFee').textContent = `${r.fee} SFX`; openModal();
  };
  // Saved addresses
  S.addrs = [];
  const drawAddrs = () => {
    const sel = $('addrPick'); sel.textContent = ''; const o0 = document.createElement('option'); o0.value = ''; o0.textContent = S.addrs.length ? 'Saved addresses…' : 'No saved addresses yet'; sel.appendChild(o0);
    for (const a of S.addrs) { const o = document.createElement('option'); o.value = a.address; o.textContent = a.label; sel.appendChild(o); }
    $('addrDel').hidden = true;
  };
  const loadAddrs = () => W.addrList().then((r) => { if (r && r.ok) { S.addrs = r.list; drawAddrs(); } });
  $('toAddr').addEventListener('input', () => { if ($('addrPick').value && $('addrPick').value !== $('toAddr').value.trim()) { $('addrPick').value = ''; $('addrDel').hidden = true; } });
  $('addrPick').onchange = () => { const v = $('addrPick').value; $('addrDel').hidden = !v; if (v) $('toAddr').value = v; };
  $('addrSave').onclick = () => { say($('sendMsg'), ''); const a = $('toAddr').value.trim(); const ex = S.addrs.find((x) => x.address === a); $('addrName').value = ex ? ex.label : ''; $('addrNameRow').hidden = false; $('addrName').focus(); };
  $('addrNo').onclick = () => { $('addrNameRow').hidden = true; };
  $('addrOk').onclick = async () => {
    const r = await W.addrSave({ label: $('addrName').value, address: $('toAddr').value });
    if (!r.ok) return say($('sendMsg'), r.error, 'msg bad');
    S.addrs = r.list; drawAddrs(); $('addrNameRow').hidden = true; $('addrPick').value = $('toAddr').value.trim(); $('addrDel').hidden = false;
  };
  $('addrName').onkeydown = (e) => { if (e.key === 'Enter') $('addrOk').click(); };
  $('addrDel').onclick = async () => { const r = await W.addrRemove({ address: $('addrPick').value }); if (r.ok) { S.addrs = r.list; drawAddrs(); } };
  const openSplit = (kind) => { S.splitKind = kind; $('sdTitle').textContent = kind === 'cash' ? 'Split SFX into coins' : 'Split SFT into coins'; say($('splitMsg'), ''); $('splitDlg').hidden = false; };
  $('splitCash').onclick = () => openSplit('cash'); $('splitTok').onclick = () => openSplit('token');
  $('sdCancel').onclick = () => { $('splitDlg').hidden = true; };
  $('splitReview').onclick = async () => {
    $('splitReview').disabled = true; say($('splitMsg'), '');
    const r = await W.prepareSplit({ kind: S.splitKind || S.kind, parts: $('parts').value, ringSize: $('sRing').value, amount: $('sAmt').value });
    $('splitReview').disabled = false;
    if (!r.ok) return say($('splitMsg'), r.error, 'msg bad');
    $('splitDlg').hidden = true; S.pending = r; $('mTitle').textContent = 'Confirm split'; $('mToK').textContent = 'Into'; $('mSend').textContent = 'Split now';
    $('mAmt').textContent = `${r.amount} ${r.unit}`; $('mTo').textContent = `${r.parts} coins of ${r.piece} ${r.unit} each, paid to your own address`; $('mFee').textContent = `${r.fee} SFX`; openModal();
  };
  // Opening the confirm box always starts clean (no leftover result from the last send)
  const openModal = () => { $('mResult').hidden = true; $('mWarn').hidden = false; $('mSend').hidden = false; $('mSend').disabled = false; $('mCancel').textContent = 'Cancel'; $('modal').hidden = false; };
  $('mCopy').onclick = async () => { await W.copy({ text: S.sentTx }); $('mCopy').textContent = 'Copied'; setTimeout(() => { $('mCopy').textContent = 'Copy transaction ID'; }, 1500); };
  $('mCancel').onclick = async () => { await W.cancel(); S.pending = null; $('modal').hidden = true; };
  $('mSend').onclick = async () => {
    const was = S.pending; $('mSend').disabled = true; $('mSend').textContent = 'Sending…'; const r = await W.confirm({ id: was && was.id });
    $('mSend').textContent = was && was.sweep ? 'Sweep now' : was && was.split ? 'Split now' : 'Send now'; S.pending = null;
    // The result stays in this box: the person reads it, copies the ID if wanted, and closes the box themselves.
    $('mWarn').hidden = true; $('mSend').hidden = true; $('mCancel').textContent = 'Close'; $('mResult').hidden = false; $('mResult').classList.toggle('bad', !r.ok);
    if (r.ok) {
      $('mTitle').textContent = was && was.sweep ? 'Sweep sent' : was && was.split ? 'Split sent' : 'Sent';
      $('mResultTitle').textContent = was && was.sweep ? 'Dust is being moved. Wait for it to confirm, then send again.' : was && was.mixed ? 'SFX and SFT went out in one transaction.' : 'Your transaction was sent.';
      const ids = r.txids && r.txids.length > 1 ? r.txids.join('\n') : r.txid; $('mResultTx').textContent = ids; S.sentTx = r.txid; $('mCopy').hidden = false;
      if (!(was && (was.split || was.sweep))) { $('toAddr').value = ''; $('amt').value = ''; $('amtTok').value = ''; $('addrPick').value = ''; $('addrDel').hidden = true; }
      poll();
    } else { $('mTitle').textContent = 'Not sent'; $('mResultTitle').textContent = r.error; $('mResultTx').textContent = ''; $('mCopy').hidden = true; }
  };

  // ---- money maths shown before anything is sent (exact whole units, 1 SFX = 10^10) ----
  const U = 10n ** 10n;
  const plainA = (v) => { const w = (v / U).toString(), f = (v % U).toString().padStart(10, '0').replace(/0+$/, ''); return f ? `${w}.${f}` : w; };
  const parseA = (t) => { const m = /^(\d{1,15})(?:\.(\d{1,10}))?$/.exec(String(t || '').trim()); if (!m) return null; const v = BigInt(m[1]) * U + BigInt((m[2] || '').padEnd(10, '0') || '0'); return v > 0n ? v : null; };
  const split95 = (total) => { const seller = total * 95n / 100n; return { seller, fee: total - seller }; };
  const dlRows = (dl, rows) => { dl.textContent = ''; for (const [k, v, big] of rows) { const a = document.createElement('dt'); a.textContent = k; const b = document.createElement('dd'); b.textContent = v; if (big) b.className = 'big'; dl.append(a, b); } };

  function buyMath() {
    const r = M.cur; if (!r || !r.canBuy) return;
    const q = /^\d{1,9}$/.test($('buyQty').value.trim()) ? BigInt($('buyQty').value.trim()) : 0n;
    if (q < 1n) return dlRows($('buyMath'), [['Quantity', 'enter a whole number']]);
    const total = BigInt(r.priceAtomic) * q, p = split95(total);
    dlRows($('buyMath'), [['You pay', plainA(total) + ' SFX', true], ['Seller receives', plainA(p.seller) + ' SFX'], ['Network share (5%)', plainA(p.fee) + ' SFX'], ['Plus network fee', 'shown before you confirm']]);
  }
  $('buyQty').addEventListener('input', buyMath);

  // ---- one dialog for buy / create account / create listing: details + password, then the real price, then confirm ----
  const Act = { stage: 0, quote: null, done: null };
  function actShow(title, rows, note, quote) {
    Act.done = null; Act.stage = 1; Act.quote = quote; $('actTitle').textContent = title; dlRows($('actRows'), rows); $('actNote').textContent = note || '';
    $('actPw').value = ''; $('actPwBox').hidden = false; $('actCancel').hidden = false; $('actCancel').disabled = false; say($('actMsg'), ''); $('actGo').textContent = 'Get price'; $('actGo').disabled = false; $('actCancel').textContent = 'Cancel'; $('actDlg').hidden = false; setTimeout(() => $('actPw').focus(), 50);
  }
  $('actCancel').onclick = async () => {
    if (Act.stage === 2) { $('actCancel').disabled = true; await W.actConfirm({ yes: false }); $('actCancel').disabled = false; }
    $('actDlg').hidden = true; Act.stage = 0; poll();
  };
  $('actGo').onclick = async () => {
    if (Act.stage === 3) { $('actDlg').hidden = true; Act.stage = 0; poll(); if (Act.done) Act.done(); return; }
    if (Act.stage === 1) {
      const pw = $('actPw').value; if (!pw) return say($('actMsg'), 'Enter your wallet password.', 'msg bad');
      $('actGo').disabled = true; say($('actMsg'), 'Asking the wallet tool for the exact price. This takes a few seconds and the live view pauses meanwhile.', 'msg');
      const tick = async () => { const b = await W.busy(); if (!(b.ok && b.busy)) return; const p = b.busy.progress, n = (x) => Number(x).toLocaleString();
        let t = b.busy.phase; if (p) { const left = p.eta == null ? '' : p.eta >= 5400 ? ` · about ${Math.round(p.eta / 3600)} hours left` : p.eta >= 90 ? ` · about ${Math.round(p.eta / 60)} min left` : ' · almost there'; t += `\nBlock ${n(p.cur)} of ${n(p.total)} (${p.pct}%)${left}`; }
        say($('actMsg'), t + '\nThe live view pauses meanwhile. Leave this open.', 'msg'); };
      const tk = setInterval(tick, 1500);
      let r; try { r = await Act.quote(pw); } finally { clearInterval(tk); } $('actPw').value = ''; $('actGo').disabled = false;
      if (!r.ok) return say($('actMsg'), r.error, 'msg bad');
      Act.stage = 2; $('actPwBox').hidden = true; say($('actMsg'), '');
      const rows = r.op === 'buy' ? [['Listing', r.title], ['Quantity', r.qty], ['You pay', r.total + ' SFX', true], ['Seller receives', r.seller + ' SFX'], ['Network share (5%)', r.networkShare + ' SFX'], ['Network fee', (r.txFee || '?') + ' SFX']]
        : r.op === 'stake' || r.op === 'unstake' ? [[r.op === 'stake' ? 'Stake' : 'Unstake', r.amount + ' SFT', true]].concat(r.height ? [['Staked at block', r.height]] : [], [['Network fee', (r.txFee || '?') + ' SFX']])
        : r.op === 'offer-change' ? [['Seller account', r.username], ['Listing', r.name], ['Quantity', r.oldQty === r.newQty ? r.newQty : `${r.oldQty} \u2192 ${r.newQty}`, r.oldQty !== r.newQty], ['Price per unit', r.oldPrice === r.newPrice ? r.newPrice + ' SFX' : `${r.oldPrice} \u2192 ${r.newPrice} SFX`, r.oldPrice !== r.newPrice], ['You receive per unit', r.newRecv + ' SFX'], ['Network fee', (r.txFee || '?') + ' SFX']]
        : r.op === 'offer-edit' ? [['Seller account', r.username], ['Listing', r.name], [r.active ? 'Reopen' : 'Close', r.active ? 'make it buyable again' : 'nobody can buy it', true], ['Network fee', (r.txFee || '?') + ' SFX']]
        : r.op === 'account' ? [['Seller account', r.username], ['Locks', '1,000 SFT'], ['Network fee', (r.txFee || '?') + ' SFX']]
        : [['Seller account', r.username], ['Listing', r.name], ['Quantity', r.qty], ['List price per unit', r.listPrice + ' SFX', true], ['You receive per unit', r.received + ' SFX'], ['Network fee', (r.txFee || '?') + ' SFX']];
      dlRows($('actRows'), rows); $('actNote').textContent = (r.lockNote || '') + (r.pre && !r.txFee ? ` The wallet tool asks first: "${r.pre}" Pressing Confirm answers yes to that only; you will see the network fee and confirm again before anything is sent.` : ' Check this, then confirm. A sent transaction cannot be undone.'); $('actGo').textContent = r.pre && !r.txFee ? 'Yes, continue' : 'Confirm and send';
      return;
    }
    if (Act.stage === 2) {
      $('actGo').disabled = true; $('actCancel').disabled = true; say($('actMsg'), 'Sending…', 'msg');
      const r = await W.actConfirm({ yes: true }); $('actGo').disabled = false; $('actCancel').disabled = false;
      if (r.ok && r.more) { say($('actMsg'), ''); const rows2 = [...$('actRows').querySelectorAll('dt')].map((d) => [d.textContent, d.nextSibling.textContent]).filter((x) => x[0] !== 'Network fee'); rows2.push(['Network fee', (r.txFee || '?') + ' SFX']); dlRows($('actRows'), rows2); $('actNote').textContent = r.txFee ? 'This is the final network fee. Check it, then confirm. A sent transaction cannot be undone.' : `The wallet tool asks: \"${r.pre}\" Confirm only if you understand it.`; $('actGo').textContent = 'Confirm and send'; return; }
      if (!r.ok) { say($('actMsg'), r.error, 'msg bad'); Act.stage = 3; $('actGo').textContent = 'Close'; $('actCancel').hidden = true; return; }
      Act.stage = 3; say($('actMsg'), 'Sent. Transaction ' + r.txid, 'msg'); $('actNote').textContent = 'It confirms in about 2 minutes. The wallet is reopening; your balances will update shortly.'; $('actGo').textContent = 'Close'; $('actCancel').hidden = true;
    }
  };
  $('buyBtn').onclick = () => {
    const r = M.cur; if (!r) return; const qty = $('buyQty').value.trim();
    if (!/^\d{1,9}$/.test(qty) || BigInt(qty) < 1n) return say($('mkMsg'), 'Quantity must be a whole number, 1 or more.', 'msg bad');
    const total = BigInt(r.priceAtomic) * BigInt(qty), p = split95(total);
    actShow('Buy: ' + r.title, [['Quantity', qty], ['You pay', plainA(total) + ' SFX', true], ['Seller receives', plainA(p.seller) + ' SFX'], ['Network share (5%)', plainA(p.fee) + ' SFX']], 'Enter your wallet password to ask the wallet tool for the exact price. Nothing is sent yet.', (pw) => W.buyQuote({ i: r.i, qty, password: pw }));
  };

  // ---- My listings ----
  const ML = { wallet: null };
  async function mlLoad(note) {
    const m = $('mlMsg'), box = $('mlList'); say(m, ''); box.textContent = ''; ML.wallet = walletName(S.file);
    const r = await W.sellerListings({ username: $('mlUser').value.trim() }); if (!r.ok) return say(m, r.error, 'msg bad');
    const dl = $('mlUsers'); dl.textContent = ''; for (const n of r.accounts || []) { const o = document.createElement('option'); o.value = n; dl.appendChild(o); }
    if (r.username && !$('mlUser').value.trim()) $('mlUser').value = r.username;
    if (!r.username) return say(m, 'Enter the seller account name you listed under.', 'msg');
    if (!r.rows.length) return say(m, (note ? note + ' ' : '') + `No listings found for ${r.username}. A new listing can take a few minutes to appear after it is sent.`, 'msg');
    if (note) say(m, note, 'msg');
    for (const x of r.rows) {
      const d = document.createElement('div'); d.className = 'swoffer'; const t = document.createElement('span');
      t.textContent = `${x.title}: ${x.qty} at ${x.priceFmt} SFX, ${x.active ? 'active' : 'closed'}`;
      const b = document.createElement('button'); b.className = 'btn small'; b.textContent = x.active ? 'Close' : 'Reopen'; b.disabled = !x.canEdit; if (!x.canEdit) b.title = x.why;
      b.onclick = () => actShow((x.active ? 'Close: ' : 'Reopen: ') + x.title, [['Seller account', r.username], ['Listing', x.title], ['Quantity', x.qty], ['Price per unit', x.priceFmt + ' SFX']], 'Enter your wallet password to ask the wallet tool for the exact price. Nothing is sent yet.', (pw) => W.sellerToggle({ i: x.i, active: !x.active, username: r.username, password: pw }));
      const eb = document.createElement('button'); eb.className = 'btn small'; eb.textContent = 'Edit'; eb.disabled = !x.canEdit; if (!x.canEdit) eb.title = x.why;
      const form = document.createElement('div'); form.className = 'mledit'; form.hidden = true;
      const mk = (ph, w) => { const e = document.createElement('input'); e.type = 'text'; e.placeholder = ph; e.spellcheck = false; e.style.width = w; return e; };
      const fN = mk('new price you receive', '11em'), fQ = mk('new quantity (now ' + x.qty + ')', '11em'), go = document.createElement('button'); go.className = 'btn small primary'; go.textContent = 'Review change';
      const note = document.createElement('small'); note.className = 'mute'; note.textContent = 'Price is what you want to receive per unit, the same as when listing; the buyer pays about 5% more. Leave a box empty to keep it. Open or closed stays as it is.';
      go.onclick = () => { if (!fN.value.trim() && !fQ.value.trim()) return say($('mlMsg'), 'Enter a new price, a new quantity, or both.', 'msg bad'); say($('mlMsg'), ''); actShow('Edit: ' + x.title, [['Seller account', r.username], ['Listing', x.title], ['Now', `${x.qty} at ${x.priceFmt} SFX`]], 'Enter your wallet password to ask the wallet tool for the exact price. Nothing is sent yet.', (pw) => W.sellerEdit({ i: x.i, net: fN.value.trim(), qty: fQ.value.trim(), username: r.username, password: pw })); };
      form.append(fN, fQ, go, note); eb.onclick = () => { form.hidden = !form.hidden; if (!form.hidden) fN.focus(); };
      d.append(t, eb, b, form); if (!x.canEdit) { const w = document.createElement('small'); w.className = 'mute'; w.textContent = x.why; d.appendChild(w); } box.appendChild(d);
    }
  }
  $('mlShow').onclick = mlLoad;
  $('mlImGo').onclick = async () => {
    const pw = $('mlPw').value, u = $('mlImUser').value.trim(), k = $('mlImKey').value.trim(); if (!pw) return say($('mlMsg'), 'Enter your wallet password above first.', 'msg bad');
    $('mlPw').value = ''; $('mlImKey').value = ''; say($('mlMsg'), 'Importing. The wallet pauses for a few seconds…', 'msg'); $('mlImGo').disabled = true;
    const r = await W.sellerImport({ username: u, secretKey: k, password: pw }); $('mlImGo').disabled = false;
    if (!r.ok) return say($('mlMsg'), r.error, 'msg bad');
    $('mlUser').value = r.username; await mlLoad('Imported ' + r.username + ' into this wallet.'); $('mlMsg').scrollIntoView({ block: 'center' });
  };
  $('mlFindGo').onclick = async () => {
    const pw = $('mlPw').value; $('mlPw').value = ''; if (!pw) return say($('mlMsg'), 'Enter your wallet password to look up the accounts.', 'msg bad');
    say($('mlMsg'), 'Reading this wallet\u2019s seller accounts. The wallet pauses for a few seconds…', 'msg'); $('mlFindGo').disabled = true;
    const r = await W.sellerAccounts({ password: pw, keys: false }); $('mlFindGo').disabled = false;
    if (!r.ok) return say($('mlMsg'), r.error, 'msg bad');
    if (!r.accounts.length) return say($('mlMsg'), (r.hasFile ? 'This wallet has a seller keys file, but the wallet tool listed no accounts. It said:\n' + (r.raw || '(nothing)') : 'This wallet holds no seller accounts: there is no seller keys file next to it. If the account was made in another wallet file or on another computer, bring its secret key in with the import below (or copy that wallet\u2019s .safex_account_keys file next to this one). Otherwise create one below.'), 'msg');
    $('mlUser').value = r.accounts[0].username; await mlLoad('Found in this wallet: ' + r.accounts.map((x) => x.username).join(', ') + '.'); $('mlMsg').scrollIntoView({ block: 'center' });
  };
  $('tSell').addEventListener('click', () => {
    // a different wallet is open than last time: forget the other wallet's account, list and suggestions
    if (ML.wallet !== walletName(S.file)) { ML.wallet = walletName(S.file); $('mlUser').value = ''; $('mlList').textContent = ''; $('mlUsers').textContent = ''; say($('mlMsg'), ''); }
    if (!$('mlList').children.length) mlLoad().catch(() => {});
  });

  // ---- Seller desk ----
  function ofMath() {
    const net = parseA($('ofNet').value); if (!net) return dlRows($('ofMath'), [['List price', 'enter what you want to receive']]);
    const price = (net * 100n + 94n) / 95n, got = price * 95n / 100n, fee = price - got;
    dlRows($('ofMath'), [['List at (per unit)', plainA(price) + ' SFX', true], ['Buyer pays', plainA(price) + ' SFX per unit'], ['Network share (5%)', plainA(fee) + ' SFX'], ['You receive', plainA(got) + ' SFX per unit']]);
  }
  $('ofNet').addEventListener('input', ofMath); ofMath();
  $('acBtn').onclick = () => {
    const username = $('acUser').value.trim(), data = $('acData').value.trim();
    actShow('Create seller account', [['Account name', username || '—'], ['Account data', data || '—'], ['Locks', '1,000 SFT']], 'This locks 1,000 SFT and costs a small SFX fee. Enter your wallet password to ask the wallet tool for the exact price. Nothing is sent yet.', (pw) => W.sellerQuote({ kind: 'account', username, data, password: pw }));
  };
  $('ofBtn').onclick = () => {
    const f = { username: $('ofUser').value.trim(), name: $('ofName').value.trim(), net: $('ofNet').value.trim(), qty: $('ofQty').value.trim(), desc: $('ofDesc').value.trim() };
    const net = parseA(f.net), price = net ? (net * 100n + 94n) / 95n : null;
    actShow('Create listing', [['Seller account', f.username || '—'], ['Listing', f.name || '—'], ['Quantity', f.qty || '—'], ['List price per unit', price ? plainA(price) + ' SFX' : '—', true], ['You receive per unit', price ? plainA(price * 95n / 100n) + ' SFX' : '—']], 'Enter your wallet password to ask the wallet tool for the exact price. Nothing is sent yet.', (pw) => W.sellerQuote({ kind: 'offer', ...f, password: pw }));
  };
  $('refreshBtn').onclick = async () => { $('refreshBtn').disabled = true; $('refreshBtn').textContent = 'Refreshing…'; await W.refresh(); await poll(); $('refreshBtn').textContent = 'Refresh'; $('refreshBtn').disabled = false; };


  // ---- Swap tab: click-through. The two wallets talk through a relay; the popup shows the step and who it is waiting on. ----
  const SW = { list: [], open: null, seen: {}, busy: false, asks: 0 };
  const swMsg = (t, bad) => say($('swMsg'), t, bad ? 'msg bad' : 'msg');
  const rowBtn = (box, rows, label, onClick) => {
    box.textContent = ''; if (!rows.length) { const e = document.createElement('p'); e.className = 'mute small'; e.textContent = 'Nothing here right now.'; box.appendChild(e); return; }
    for (const r of rows) {
      const d = document.createElement('div'); d.className = 'swoffer';
      const t = document.createElement('span'); t.textContent = `${r.tokens} SFT for ${r.price} SFX` + (r.mine ? ' (yours)' : '') + (r.mins ? ` · ${r.mins} min ago` : '');
      const b = document.createElement('button'); b.className = 'btn small primary'; b.textContent = label; b.disabled = !!r.mine; b.onclick = () => onClick(r);
      d.append(t, b); box.appendChild(d);
    }
  };
  async function swLoadBook(quiet) {
    const r = await W.swBook();
    const note = (t) => { for (const id of ['mkSwapNote', 'swBoardNote']) { const e = $(id); if (e) { e.textContent = t; e.hidden = !t; } } };
    if (!r.ok) { if (r.unsupported) return; SW.asks = 0; if ($('mkSwaps')) { $('mkSwaps').hidden = false; $('mkSwapList').textContent = ''; } note('Swap board unreachable, so offers cannot be shown: ' + (r.error || 'no answer from the swap relay') + '. Check the relay address under Swap settings.'); if (quiet) return; return swMsg(r.error, true); }
    const none = !r.asks.length && !r.bids.length;
    note(none ? 'No live swap offers right now. Nobody is selling or buying through this board at the moment. Post an offer of your own to start one.' : '');
    SW.asks = r.asks.filter((x) => !x.mine).length + r.bids.filter((x) => !x.mine).length;
    const ml = $('mkSwapList'); if (ml) { ml.textContent = ''; $('mkSwaps').hidden = false; for (const [rows, tag] of [[r.asks, 'For sale'], [r.bids, 'Wanted']]) for (const x of rows) { const d = document.createElement('div'); d.className = 'swoffer'; const t = document.createElement('span'); t.textContent = `${tag}: ${x.tokens} SFT for ${x.price} SFX` + (x.mine ? ' (yours)' : ''); const b = document.createElement('button'); b.className = 'btn small'; b.textContent = 'Open in Swap'; b.onclick = () => $('tSwap').click(); d.append(t, b); ml.appendChild(d); } }
    const key = JSON.stringify([r.asks, r.bids]); if (SW.bookKey === key) return; SW.bookKey = key;   // redraw only when something changed, so a click is never lost to a redraw
    rowBtn($('swAsks'), r.asks, 'Buy', async (x) => { const t = await W.swTake({ id: x.id }); if (!t.ok) return swMsg(t.error, true); swMsg(''); SW.open = x.id; swPoll(); });
    rowBtn($('swBids'), r.bids, 'Sell', async (x) => { const t = await W.swAnswer({ id: x.id }); if (!t.ok) return swMsg(t.error, true); swMsg(''); SW.open = x.id; swPoll(); });
  }
  async function swapLoad() {
    const c = await W.swConfig(); if (c.ok) { $('swRelayUrl').value = c.url || ''; $('swRelayShare').checked = !!c.share; $('swRelayInfo').textContent = `Using ${c.effective}${c.hosting ? ' (hosted by this wallet)' : ''}.`; }
    await swPoll(); if (!$('swMain').hidden) swLoadBook();
  }
  $('swRefresh').onclick = () => { SW.bookKey = null; swLoadBook(); };
  $('swRelaySave').onclick = async () => { const r = await W.swConfig({ url: $('swRelayUrl').value, share: $('swRelayShare').checked }); if (!r.ok) return swMsg(r.error, true); swMsg('Relay settings saved.'); $('swRelayInfo').textContent = `Using ${r.effective}${r.hosting ? ' (hosted by this wallet)' : ''}.`; swLoadBook(); };
  const post = (kind, q, p) => async () => {
    swMsg(''); const r = await W.swPost({ kind, tokens: $(q).value, price: $(p).value }); if (!r.ok) return swMsg(r.error, true);
    $(q).value = ''; $(p).value = ''; SW.open = r.id; if (r.existing) swMsg('You already have this swap waiting, so it was reopened instead of making another.'); await swPoll();
  };
  $('swPostAsk').onclick = post('ask', 'swQty', 'swPrice'); $('swPostBid').onclick = post('bid', 'swBQty', 'swBPrice');

  // ---- Help tab ----
  const HELP = { topics: null };
  function helpRender() {
    const q = $('helpQ').value.trim().toLowerCase(), box = $('helpList'); box.textContent = ''; let n = 0;
    for (const t of HELP.topics || []) {
      if (q && !(t.title + ' ' + t.body.join(' ')).toLowerCase().includes(q)) continue; n++;
      const d = document.createElement('details'); d.open = !!q; const sm = document.createElement('summary'); sm.textContent = t.title; d.appendChild(sm);
      for (const para of t.body) { const p = document.createElement('p'); p.className = 'small'; p.textContent = para; d.appendChild(p); }
      box.appendChild(d);
    }
    $('helpNone').hidden = n > 0;
  }
  const mixedNote = () => { $('helpMixed').textContent = S.mixedSend ? 'This wallet tool can send SFX and SFT in one transaction.' : 'This wallet tool cannot send SFX and SFT in one transaction (the field is hidden). On a Mac, run tools/mac-build-mixed.sh, then use the button below.'; };
  $('refreshTools').onclick = async () => {
    if (!S.armTools) { S.armTools = true; $('refreshTools').textContent = 'Click again to close the wallet and update the tools'; setTimeout(() => { S.armTools = false; $('refreshTools').textContent = 'Update wallet tools (re-copy / re-download)'; }, 6000); return; }
    S.armTools = false; $('refreshTools').textContent = 'Update wallet tools (re-copy / re-download)';
    $('refreshTools').disabled = true; say($('refreshMsg'), 'Updating the wallet tools…');
    const r = await W.refreshTools(); $('refreshTools').disabled = false; HELP.topics = null;
    if (!r.ok) return say($('refreshMsg'), r.error, 'msg bad');
    say($('refreshMsg'), 'Wallet tools updated. Unlock your wallet again to use them.', 'msg'); setTimeout(() => $('lock').click(), 800);
  };
  async function helpLoad() {
    mixedNote();
    if (HELP.topics) return; const r = await W.help(); if (!r.ok) return; HELP.topics = r.topics; helpRender();
    const pick = r.swapRpc && r.swapRpc.ok ? r.swapRpc : r.cli;
    $('helpCliNote').textContent = pick && pick.ok ? (pick === r.swapRpc ? 'From the swap-capable wallet tool.' : 'From the official wallet tool.') : (pick && pick.error) || 'Not available.';
    $('helpCliText').textContent = pick && pick.ok ? pick.text : '';
  }
  $('helpQ').oninput = helpRender; $('tHelp').onclick = () => { tab('help'); helpLoad(); };

  // ---- the popup ----
  // the little swap machine: the robot acts out the real step the swap is on
  function swMachine(v) {
    const sc = v.waiting === 'stopped' ? 'stop' : v.waiting === 'done' || v.step >= 5 ? 'land' : v.waiting === 'you' && v.action ? 'ask' : v.step <= 1 ? 'wait' : 'swap';
    const m = $('swMach'); m.dataset.scene = sc;
    const cur = (t) => (/SFT/.test(t || '') ? 'SFT' : 'SFX');
    $('swmCoinA').textContent = cur(v.gives); $('swmCoinBt').textContent = cur(v.gets);
    const mine = v.role === 'seller';
    $('swmCap').textContent = {
      wait: 'Order placed. The robot is waiting for someone to take the other side.',
      swap: mine ? 'The robot is swapping the coins. Hang tight.' : 'The robot is lining up the swap.',
      ask: mine ? 'The robot brought the buyer\u2019s coins. Click them to approve and send.' : 'The robot is back with your coins. Click them if they look right.',
      land: v.waiting === 'done' ? 'Done. The coins are in the wallet.' : 'Landed in the wallet, awaiting network confirmation.',
      stop: v.headline || 'The machine stopped.',
    }[sc];
    $('swmCoinB').style.cursor = sc === 'ask' && !SW.busy ? 'pointer' : '';
  }
  $('swmCoinB').onclick = () => { const g = $('swmGo'); if (!g.hidden && !g.disabled) g.click(); };
  function swRender() {
    const v = SW.list.find((x) => x.id === SW.open);
    $('swModal').hidden = !v; if (!v) return;
    $('swmGive').textContent = v.gives; $('swmGet').textContent = v.gets;
    const fees = $('swmFees'); fees.textContent = ''; fees.hidden = !(v.fee || v.total);
    if (v.fee) { const a = document.createElement('div'); a.textContent = `Network fee (paid by the buyer): ${v.fee} SFX`; fees.appendChild(a); }
    if (v.total && v.role === 'buyer') { const a = document.createElement('div'); a.innerHTML = ''; a.textContent = `Total you pay: ${v.total} SFX`; a.style.fontWeight = '700'; fees.appendChild(a); }
    swMachine(v);
    const ol = $('swmSteps'); ol.textContent = '';
    v.steps.forEach((name, i) => { const li = document.createElement('li'); const n = i + 1; li.className = v.waiting === 'stopped' ? '' : n < v.step || (v.waiting === 'done' && n <= v.step) ? 'done' : n === v.step ? 'on' : ''; const b = document.createElement('b'); b.textContent = li.className === 'done' ? '\u2713' : String(n); li.append(b, document.createTextNode(name)); ol.appendChild(li); });
    const who = $('swmWho'); who.className = 'swwho ' + v.waiting;
    who.textContent = v.waiting === 'you' ? 'Waiting on YOU' : v.waiting === 'done' ? 'Done' : v.waiting === 'stopped' ? v.headline || 'Stopped' : (v.headline || 'Waiting on the other wallet');
    $('swmDetail').textContent = (v.waiting === 'you' && v.headline ? v.headline + '. ' : '') + v.detail + (v.txid ? ' Transaction ' + v.txid : '');
    const go = $('swmGo'); go.hidden = !v.action; if (v.action) { go.textContent = v.action.label; go.dataset.what = v.action.key; go.disabled = SW.busy; }
    const nx = $('swmNext'); nx.hidden = !v.next; if (v.next) { nx.textContent = v.next.label; nx.dataset.as = v.next.as; }
    $('swmCancel').hidden = !v.canCancel; $('swmCancel').textContent = v.waiting === 'stopped' ? 'Remove' : 'Cancel swap';
    $('swmHide').textContent = 'Close';
  }
  async function swPoll() {
    const r = await W.swStatus(); if (!r.ok) return;
    if (!r.supported && r.bundled === false) { const os = r.platform === 'darwin' ? 'a Mac' : r.platform === 'win32' ? 'Windows' : 'this computer'; $('swNoTitle').textContent = 'Swaps are not available on ' + os + ' yet'; $('swNoText').textContent = 'The swap-capable wallet tool is only built for Linux so far. Everything else here works normally: balance, send, receive, staking, buying and selling on the Market, and your seller listings. To swap, open this wallet on a Linux computer.'; }
    $('swNo').hidden = r.supported; $('swMain').hidden = !r.supported; if (!r.supported) { SW.list = []; return swRender(); }
    SW.list = r.swaps || [];
    if (SW.resume) {
      const rs = SW.resume, here = SW.list.find((x) => x.id === rs.id);
      if (here && here.role === rs.as) { SW.resume = null; SW.open = rs.id; tab('swap'); swLoadBook(); }
      else if (walletName(S.file) === rs.from) SW.resume = null;   // came back to the same wallet: the person changed their mind
      else {
        SW.resume = null; tab('swap');
        const t = rs.as === 'buyer' && rs.kind === 'ask' ? await W.swTake({ id: rs.id }) : rs.as === 'seller' && rs.kind === 'bid' ? await W.swAnswer({ id: rs.id }) : { ok: false, error: 'This swap belongs to your other wallet. Switch back to it.' };
        if (!t.ok) swMsg(t.error, true); else { SW.open = rs.id; swMsg(''); }
        swLoadBook(); return swPoll();
      }
    }
    const needs = SW.list.some((x) => x.waiting === 'you' && x.action); $('tSwap').textContent = 'Swap' + (SW.asks ? ` (${SW.asks})` : '') + (needs ? ' \u25CF' : '');
    // a swap that newly needs a click pops up by itself, once
    for (const x of SW.list) { const k = x.id + ':' + x.state; if (x.waiting === 'you' && x.action && SW.seen[x.id] !== k) { SW.seen[x.id] = k; if (!SW.open) SW.open = x.id; } }
    const nYou = SW.list.filter((x) => x.waiting === 'you' && x.action).length, nOpen = SW.list.filter((x) => x.waiting !== 'done' && x.waiting !== 'stopped').length;
    $('swStripText').textContent = nYou ? `${nYou} swap${nYou > 1 ? 's' : ''} waiting on YOU` : nOpen ? `${nOpen} swap${nOpen > 1 ? 's' : ''} waiting on the other wallet` : `${SW.list.length} finished or stopped`;
    const box = $('swMineList'); box.textContent = ''; $('swMineCard').hidden = !SW.list.length;
    for (const x of SW.list) {
      const d = document.createElement('div'); d.className = 'swoffer';
      const t = document.createElement('b'); t.textContent = x.gives && x.gets ? `${x.gives} \u2192 ${x.gets}` : 'Swap';
      const st = document.createElement('span'); st.className = 'st ' + x.waiting; st.textContent = x.waiting === 'you' ? 'Waiting on YOU' : x.waiting === 'done' ? 'Done' : x.waiting === 'stopped' ? (x.headline || 'Stopped') : 'Waiting on the other wallet';
      const b = document.createElement('button'); b.className = 'btn small' + (x.waiting === 'you' ? ' primary' : ''); b.textContent = 'Open'; b.onclick = () => { SW.open = x.id; swRender(); };
      d.append(t, st, b); box.appendChild(d);
    }
    swRender();
  }
  $('swStripClear').onclick = async () => { const r = await W.swClear(); if (!r.ok) return swMsg(r.error, true); swMsg(r.cleared ? `Cleared ${r.cleared} swap${r.cleared > 1 ? 's' : ''}.` : 'Nothing to clear.'); SW.open = null; await swPoll(); swLoadBook(); };
  // one click: close this popup, open the wallet picker, and when the other wallet is unlocked the swap opens at its step
  $('swmNext').onclick = () => {
    const v = SW.list.find((x) => x.id === SW.open); if (!v || !v.next) return;
    SW.resume = { id: v.id, as: v.next.as, kind: v.kind, from: walletName(S.file) }; SW.open = null; $('swModal').hidden = true; $('switch').click();
  };
  $('swmGo').onclick = async () => {
    const what = $('swmGo').dataset.what; SW.busy = true; swRender(); say($('swmErr'), '');
    const r = await W.swAct({ id: SW.open, what }); SW.busy = false;
    if (!r.ok) say($('swmErr'), r.error, 'msg bad'); await swPoll(); if (r.ok && what === 'approve') poll();
  };
  $('swmCancel').onclick = async () => {
    const v = SW.list.find((x) => x.id === SW.open); const r = await W.swAct({ id: SW.open, what: v && v.waiting === 'stopped' ? 'dismiss' : 'cancel' });
    if (!r.ok) return say($('swmErr'), r.error, 'msg bad'); SW.open = null; await swPoll(); swLoadBook();
  };
  $('swmHide').onclick = async () => { const v = SW.list.find((x) => x.id === SW.open); if (v && (v.waiting === 'done')) await W.swAct({ id: SW.open, what: 'dismiss' }); SW.open = null; say($('swmErr'), ''); await swPoll(); };
  // keep the popup and the tab badge fresh while the wallet is open
  setInterval(() => { if (SWAP_ON && !$('app').hidden && !document.hidden) { swPoll().catch(() => {}); swLoadBook(true).catch(() => {}); } }, 3000);


  // ---- Wallet tab: backup, seed words, rescan ----
  const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' bytes');
  let busyTimer = null;
  const busyOn = () => { $('busyDlg').hidden = false; clearInterval(busyTimer); const tick = async () => { const b = await W.busy(); if (b.ok && b.busy) { const m = Math.floor(b.busy.seconds / 60), sec = b.busy.seconds % 60; $('busyMsg').textContent = `${b.busy.phase}  ${m ? m + ' min ' : ''}${sec} s`;
    const p = b.busy.progress; $('busyBar').hidden = $('busyProg').hidden = !p;
    if (p) { const n = (x) => Number(x).toLocaleString(); const left = p.eta == null ? '' : p.eta >= 5400 ? ` · about ${Math.round(p.eta / 3600)} hours left` : p.eta >= 90 ? ` · about ${Math.round(p.eta / 60)} min left` : ' · almost there'; $('busyFill').style.width = p.pct + '%'; $('busyProg').textContent = `Block ${n(p.cur)} of ${n(p.total)}  (${p.pct}%)${left}`; } } }; tick(); busyTimer = setInterval(tick, 1000); };
  const busyOff = () => { clearInterval(busyTimer); $('busyDlg').hidden = true; $('busyBar').hidden = $('busyProg').hidden = true; };
  $('wBackup').onclick = async () => {
    say($('wMsg'), ''); busyOn(); const r = await W.backup(); busyOff(); await poll();
    if (r.cancelled) return;
    if (!r.ok) return say($('wMsg'), r.error, 'msg bad');
    say($('wMsg'), `Saved to ${r.dir}\n` + r.files.map((f) => `${f.name}  (${fmtSize(f.size)})`).join('\n') + (r.hasAccountKeys ? '\nIncludes your seller account keys.' : '\nThis wallet has no seller account keys.'), 'msg');
  };
  const seedClose = () => { clearTimeout(S.seedT); $('seedWords').textContent = ''; $('kSellerList').textContent = ''; $('kSeller').hidden = true; ['kAddr', 'kSpend', 'kView'].forEach((k) => { $(k).textContent = ''; }); $('seedDlg').hidden = true; $('seedPw').value = ''; };
  $('wSeed').onclick = () => { $('seedAsk').hidden = false; $('seedShow').hidden = true; $('seedPw').value = ''; say($('seedMsg'), ''); $('seedDlg').hidden = false; setTimeout(() => $('seedPw').focus(), 50); };
  $('seedCancel').onclick = seedClose; $('seedHide').onclick = seedClose;
  document.querySelectorAll('.kcopy').forEach((b) => { b.onclick = async () => { const el = $(b.dataset.src); const text = b.dataset.src === 'seedWords' ? [...el.querySelectorAll('span')].map((x) => x.lastChild.textContent).join(' ') : el.textContent; if (!text || /^not available/.test(text)) return; if (b.dataset.src === 'kAddr') await W.copy({ text }); else await W.copySecret({ text }); const o = b.textContent; b.textContent = '\u2713'; setTimeout(() => { b.textContent = o; }, 1200); }; });
  $('seedGo').onclick = async () => {
    const pw = $('seedPw').value; $('seedPw').value = ''; if (!pw) return say($('seedMsg'), 'Enter your wallet password.', 'msg bad');
    const r = await W.keys({ password: pw }); if (!r.ok) return say($('seedMsg'), r.error, 'msg bad');
    $('kAddr').textContent = r.address || ''; $('kSpend').textContent = r.spend || 'not available from this wallet tool'; $('kView').textContent = r.view || 'not available from this wallet tool';
    const box = $('seedWords'); box.textContent = ''; r.words.split(/\s+/).filter(Boolean).forEach((w, i) => { const sp = document.createElement('span'); const n = document.createElement('i'); n.textContent = i + 1; sp.append(n, w); box.appendChild(sp); });
    $('seedAsk').hidden = true; $('seedShow').hidden = false; S.seedT = setTimeout(seedClose, 90000);
    $('kSeller').hidden = !r.hasSeller; $('kSellerList').textContent = '';
    if (r.hasSeller) {
      $('kSellerNote').textContent = 'Reading the seller account keys. This pauses the wallet for a few seconds…';
      const a = await W.sellerAccounts({ password: pw, keys: true });
      if ($('seedDlg').hidden) return;   // closed meanwhile: do not draw secrets into a hidden dialog
      if (!a.ok) { $('kSellerNote').textContent = a.error; return; }
      $('kSellerNote').textContent = a.accounts.length ? 'Not part of your seed words: back up the wallet file as well.' : 'No seller accounts found in this wallet.';
      for (const x of a.accounts) {
        const box = document.createElement('div'); box.className = 'keyrow'; const h = document.createElement('div'); h.className = 'kl'; h.textContent = x.username + (x.activated ? ` (activated: ${x.activated})` : ''); box.appendChild(h);
        for (const [lab, val] of [['Public key', x.publicKey], ['Secret key', x.secretKey]]) {
          const row = document.createElement('div'); row.className = 'kv2'; const c = document.createElement('code'); c.textContent = val ? `${lab}: ${val}` : `${lab}: not available${x.keysError ? ' (' + x.keysError + ')' : ''}`;
          const b = document.createElement('button'); b.className = 'ibtn kcopy'; b.textContent = '\u2750'; b.title = 'Copy (cleared from the clipboard after 30 seconds)'; b.onclick = async () => { if (val) { await W.copySecret({ text: val }); b.textContent = '\u2713'; setTimeout(() => (b.textContent = '\u2750'), 1200); } };
          row.append(c, b); box.appendChild(row);
        }
        $('kSellerList').appendChild(box);
      }
    }
  };
  const Rs = { mode: false };
  function rescanAsk(fromMode) {
    Rs.mode = fromMode; $('rsFromBox').hidden = !fromMode; $('rsFrom').value = '';
    $('rsTitle').textContent = fromMode ? 'Rescan from a block' : 'Hard rescan';
    $('rsText').textContent = (fromMode ? 'Rebuilds this wallet starting at the block you enter (faster; fine if the wallet is newer than that block). ' : 'Rebuilds this wallet from the very beginning of the chain. On a healthy node this takes several minutes. ') + 'A safety copy of the wallet files is made first, and your wallet reopens by itself when it finishes. Nothing is sent or spent.';
    $('rsPw').value = ''; say($('rsMsg'), ''); $('rsGo').disabled = false; $('rescanDlg').hidden = false; setTimeout(() => (fromMode ? $('rsFrom') : $('rsPw')).focus(), 50);
  }
  $('wRescanAll').onclick = () => { say($('wMsg'), ''); rescanAsk(false); };
  $('wRescanFrom').onclick = () => { say($('wMsg'), ''); rescanAsk(true); };
  $('rsCancel').onclick = () => { $('rescanDlg').hidden = true; };
  $('rsGo').onclick = async () => {
    const from = Rs.mode ? $('rsFrom').value.trim() : '';
    if (Rs.mode && !/^\d{1,9}$/.test(from)) return say($('rsMsg'), 'Enter the block number to start at (digits only), or close this and use Hard rescan.', 'msg bad');
    const pw = $('rsPw').value; if (!pw) return say($('rsMsg'), 'Enter your wallet password.', 'msg bad');
    $('rsGo').disabled = true; $('rsPw').value = ''; $('rescanDlg').hidden = true; busyOn();
    const r = await W.rescan({ from, password: pw }); busyOff(); await poll();
    if (!r.ok) { say($('wMsg'), r.error, 'msg bad'); return; }
    say($('wMsg'), `Rescan finished${r.from ? ' from block ' + r.from : ''}. A safety copy of the wallet files was kept before it started.`, 'msg');
  };
  $('recentAll').onclick = () => $('tHist').click();
  start();
})();
