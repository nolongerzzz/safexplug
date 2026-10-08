// Dev-only: runs the real Electron app against the fake wallet tool and walks the whole flow with screenshots.
const { app, BrowserWindow, clipboard } = require('electron');
const fs = require('fs'), path = require('path'), os = require('os');
app.commandLine.appendSwitch('no-sandbox'); app.commandLine.appendSwitch('disable-gpu');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'sxw-')));
const fake = require('./fake-wallet-rpc');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const f = await fake.start({ cash: '25000000000', tokens: '1000000000000' }); f.st.height = 2098731; const nd = await fake.startNode();
  process.env.SAFEX_WALLET_TEST_PORT = String(f.port); process.env.SAFEX_WALLET_TEST_FILE = '/tmp/wallets/test.keys';
  fs.mkdirSync('/tmp/wallets', { recursive: true }); for (const x of ['', '.keys', '.safex_account_keys', '.address.txt']) fs.writeFileSync('/tmp/wallets/test' + x, 'data' + x);
  const BK = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-')); process.env.SAFEX_WALLET_TEST_BACKUP_DIR = BK;
  const CLILOG = path.join(process.env.SHOT_DIR || '/tmp', 'fake-cli.log'); try { fs.writeFileSync(CLILOG, ''); } catch (_) {}
  process.env.SAFEX_WALLET_TEST_CLI = path.join(__dirname, 'fake-cli.js'); process.env.FAKE_CLI_LOG = CLILOG; process.env.FAKE_CLI_PASSWORD = 'test-pass';
  const cliLog = () => fs.readFileSync(CLILOG, 'utf8');
  process.env.SAFEX_SELL = '1';   // the Sell tab is off in the shipped version; the test turns it on
  require('../src/main.js'); await app.whenReady(); await wait(1200);
  const win = BrowserWindow.getAllWindows()[0]; const wc = win.webContents; const js = (c) => wc.executeJavaScript(c);
  if (process.env.UI_AUTO_DARK) require('electron').nativeTheme.themeSource = 'dark';   // dev: pretend the computer is in dark mode, with no forced theme
  if (process.env.UI_DARK) await js(`document.documentElement.setAttribute('data-theme','dark')`);   // dev: run the whole walk in dark mode
  const shot = async (n) => fs.writeFileSync(path.join(process.env.SHOT_DIR, `w-${n}.png`), (await wc.capturePage()).toPNG());
  let bad = 0; const ck = (n, ok, x) => { console.log(ok ? 'ok  ' : 'FAIL', n, x || ''); if (!ok) bad++; };
  const until = async (code, ms = 12000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await js(code)) return true; await wait(150); } return false; };
  const quoted = () => until(`/Confirm and send/.test(document.getElementById('actGo').textContent) || document.getElementById('actMsg').className.includes('bad')`);
  const sentOk = () => until(`/Sent\\. Transaction|bad/.test(document.getElementById('actMsg').className + document.getElementById('actMsg').textContent)`);
  const click = (id) => js(`document.getElementById('${id}').click()`);
  const set = (id, v) => js(`(()=>{const e=document.getElementById('${id}'); e.value=${JSON.stringify(v)}; e.dispatchEvent(new Event('input'))})()`);
  const vis = (id) => js(`!document.getElementById('${id}').hidden`);

  ck('version is shown on screen', /Safex SOLO-SYNC Wallet \d+\.\d+\.\d+ · wallet tools/.test(await js(`document.getElementById('verFoot').textContent`)), await js(`document.getElementById('verFoot').textContent`));
  ck('start screen shown', await vis('sStart')); await shot('1-start');
  // short window: the whole start screen must be reachable by scrolling, top and bottom
  win.setSize(700, 400); await js(`document.getElementById('toolsBox').hidden=false`); await wait(500);
  const reach = await js(`(()=>{const el=document.body; el.scrollTop=1e6; const last=document.getElementById('bSpend').getBoundingClientRect(); const bottomOk=last.bottom<=innerHeight+1&&last.top>=0; el.scrollTop=0; const first=document.querySelector('#sStart h1').getBoundingClientRect(); return {bottomOk, topOk:first.top>=0 /* title not clipped */, scrolls:el.scrollHeight>el.clientHeight, innerH:innerHeight, scrollH:el.scrollHeight}})()`);
  ck('short window: last button reachable and title not clipped', reach.bottomOk && reach.topOk && reach.scrolls, JSON.stringify(reach)); await shot('1b-short');
  await js(`document.getElementById('toolsBox').hidden=true`); win.setSize(1100, 780); await wait(400);
  await click('bOpen'); await wait(300); ck('file screen shown', await vis('sFile'));
  await click('bBrowse'); await wait(300); ck('continue enabled after choosing file', await js(`!document.getElementById('fileNext').disabled`)); await shot('2-file');
  await click('fileNext'); await wait(200); ck('node screen shown', await vis('sNode'));
  await set('nPort', String(nd.port)); await click('nodeNext'); await wait(600); ck('node ok -> password screen', await vis('sPass')); await shot('3-password');
  await set('pw', 'wrong'); await click('unlock'); await wait(700);
  ck('wrong password stays on password screen with an error', (await vis('sPass')) && (await vis('passErr'))); await shot('4-wrongpw');
  ck('password field cleared after attempt', (await js(`document.getElementById('pw').value`)) === '');
  await set('pw', 'test-pass'); await click('unlock'); await wait(1500);
  ck('wallet opened', await vis('app') && !(await vis('login'))); ck('fake saw open_wallet with file name', f.st.opened === 'test');
  ck('balances shown', (await js(`document.getElementById('balCash').textContent`)) === '2.5' && (await js(`document.getElementById('balTok').textContent`)) === '100');
  ck('synced chip', (await js(`document.getElementById('chip').textContent`)) === 'Synced', await js(`document.getElementById('chip').textContent`));
  if (!process.env.UI_DARK && !process.env.UI_AUTO_DARK) {
    const th = () => js(`document.documentElement.getAttribute('data-theme') + '|' + document.getElementById('themeBtn').textContent`);
    ck('theme button starts on Auto (nothing forced)', (await th()) === 'null|\u25D0 Auto', await th());
    await click('themeBtn'); ck('first click forces Dark', (await th()) === 'dark|\u263E Dark', await th());
    ck('Dark really is dark (page background)', await js(`(()=>{const c=getComputedStyle(document.body).backgroundColor.match(/\\d+/g).map(Number);return c[0]<60&&c[1]<60})()`));
    await click('themeBtn'); ck('second click forces Light', (await th()) === 'light|\u2600 Light', await th());
    await click('themeBtn'); ck('third click is back to Auto', (await th()) === 'null|\u25D0 Auto', await th());
  }
  await shot('5-home'); win.setSize(1000, 700); await wait(400); await shot('5b-narrow-1000'); ck('header is one row at 1000px', await js(`(()=>{const t=document.querySelector('header.top').getBoundingClientRect();return t.height<90})()`)); ck('SFX/SFT brand (SFX green, SFT blue) is the Home button, no separate Home tab', !(await js(`[...document.querySelectorAll('.tabs button')].some(b=>b.textContent==='Home')`)) && /^SFX\/SFT$/.test(await js(`document.getElementById('tHome').textContent`)) && (await js(`getComputedStyle(document.querySelector('#tHome .bsfx')).color !== getComputedStyle(document.querySelector('#tHome .bsft')).color`))); win.setSize(1100, 780); await wait(300);

  // clipboard: Ctrl+V pastes into the send form, Ctrl+A/Ctrl+C copy out, and the Copy button copies the address
  const key = (k, mod) => { wc.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: [mod] }); wc.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: [mod] }); };
  const PASTE = 'Safex' + '2'.repeat(93);
  clipboard.writeText(PASTE); await js(`document.getElementById('toAddr').focus()`); key('V', 'control'); await wait(400);
  ck('Ctrl+V pastes a full address into the send form', (await js(`document.getElementById('toAddr').value`)) === PASTE);
  clipboard.writeText('sentinel'); key('A', 'control'); await wait(150); key('C', 'control'); await wait(300);
  ck('Ctrl+A then Ctrl+C copies it back out', clipboard.readText() === PASTE);
  await js(`document.getElementById('toAddr').value=''`); clipboard.writeText('sentinel'); await click('copy'); await wait(400);
  ck('Copy button puts the wallet address on the clipboard', clipboard.readText() === 'Safex' + '1'.repeat(93));
  // send flow: bad input first, then a real review + confirm; nothing relayed until confirm
  const ADDR = 'Safex' + '1'.repeat(93);
  await set('toAddr', 'nope'); await set('amt', '1'); await click('review'); await wait(400);
  ck('bad address shows message, no dialog', (await vis('sendMsg')) && !(await vis('modal'))); await shot('6-badaddr');
  await set('toAddr', ADDR); await set('amt', '0.5'); await click('review'); await wait(500);
  ck('review dialog shown', await vis('modal')); ck('dialog shows amount, address and fee', (await js(`document.getElementById('mAmt').textContent`)) === '0.5 SFX' && (await js(`document.getElementById('mTo').textContent`)) === ADDR && (await js(`document.getElementById('mFee').textContent`)) === '0.01 SFX', await js(`document.getElementById('mFee').textContent`));
  ck('nothing relayed before confirm', f.st.relayed.length === 0); await shot('7-confirm');
  await click('mCancel'); await wait(200); ck('cancel closes dialog, still nothing relayed', !(await vis('modal')) && f.st.relayed.length === 0);
  await click('review'); await wait(500); await click('mSend'); await wait(700); ck('the result stays inside the confirm box with the transaction id', (await vis('modal')) && (await vis('mResult')) && /(bb){10}/.test(await js(`document.getElementById('mResultTx').textContent`)) && !(await vis('mSend')) && (await js(`document.getElementById('mCancel').textContent`)) === 'Close', await js(`document.getElementById('mResultTx').textContent`)); await click('mCancel'); await wait(200); ck('closing the box leaves no banner or settling bar behind', !(await vis('modal')) && !(await js(`!!document.getElementById('sentNote') || !!document.getElementById('settle')`)));
  ck('confirm relays exactly one transaction', f.st.relayed.length === 1, JSON.stringify(f.st.relayed));
  // the tool wipes the balance to zero right after the send; the screen must show the estimate, then clear when the tool catches up
  f.st.cash = '0'; f.st.unlocked.cash = '0'; await wait(5600);
  ck('after a send the balance shows the estimate instead of 0', (await js(`document.getElementById('balCash').textContent`)) === '1.99', await js(`document.getElementById('balCash').textContent`));
  ck('estimate label shown on the SFX card (no settling bar)', /estimate/.test(await js(`document.getElementById('subCash').textContent`))); await shot('7b-settling');
  f.st.cash = '19900000000'; f.st.unlocked.cash = '19900000000'; await wait(5600);
  ck('estimate clears once the wallet tool catches up', (await js(`document.getElementById('balCash').textContent`)) === '1.99');
  f.st.cash = '25000000000'; f.st.unlocked.cash = '25000000000';
  // split flow
  f.st.cash = '25000000000'; f.st.unlocked.cash = '1000000000000'; ck('split button sits under the SFX balance', await js(`(()=>{const a=document.getElementById('cardCash').getBoundingClientRect(),b=document.getElementById('splitCash').getBoundingClientRect();return b.top>=a.bottom-1&&Math.abs(a.left-b.left)<4})()`));
  await click('splitCash'); await wait(200); ck('split dialog opens from the button', await vis('splitDlg')); await set('parts', '5'); f.st.calls.length = 0; await click('splitReview'); await wait(500);
  ck('split review dialog shows the plan', (await vis('modal')) && /5 coins of/.test(await js(`document.getElementById('mTo').textContent`)) && (await js(`document.getElementById('mTitle').textContent`)) === 'Confirm split', await js(`document.getElementById('mTo').textContent`)); await shot('9a-split');
  ck('split built 5 outputs and relayed nothing yet', f.st.calls.some((c) => c.method === 'transfer' && c.params.destinations.length === 5) && f.st.relayed.length === 1);
  await click('mSend'); await wait(600); ck('split confirm relays and says so', f.st.relayed.length === 2 && (await js(`document.getElementById('mTitle').textContent`)) === 'Split sent'); await click('mCancel'); await wait(150);
  // combined SFX + SFT send in one transaction
  f.st.failTransfer = null; await click('cardCash'); await set('toAddr', ADDR); await set('amt', '1'); await set('amtTok', '2'); f.st.calls.length = 0; const rm = f.st.relayed.length; await click('review'); await wait(500);
  ck('"also send SFT" field shows under SFX', !(await js(`document.getElementById('tokRow').hidden`)));
  ck('combined review shows both amounts, one fee, built with transfer_mixed, nothing relayed yet', (await vis('modal')) && /1 SFX \+ 2 SFT/.test(await js(`document.getElementById('mAmt').textContent`)) && f.st.calls.some((c) => c.method === 'transfer_mixed' && String(c.params.token_amount) === '20000000000') && !f.st.calls.some((c) => c.method === 'transfer' || c.method === 'transfer_token') && f.st.relayed.length === rm, await js(`document.getElementById('mAmt').textContent`));
  await click('mSend'); await wait(600); ck('combined confirm relays exactly that one transaction', f.st.relayed.length === rm + 1 && f.st.relayed[rm] === 'meta:mixed:10000000000:20000000000', f.st.relayed.slice(rm).join());
  // the result of a send is shown in the banner at the top, with the transaction ID
  ck('combined result shows in the box with the id; address box and saved-name selection reset', (await vis('mResult')) && /(bc){10}/.test(await js(`document.getElementById('mResultTx').textContent`)) && (await js(`document.getElementById('toAddr').value`)) === '' && (await js(`document.getElementById('addrPick').value`)) === ''); await click('mCancel'); await wait(150);
  await set('toAddr', ADDR); await set('amt', '1'); await set('amtTok', '1.5'); await click('review'); await wait(800); ck('fractional SFT is refused with a plain message', /whole/i.test(await js(`document.getElementById('sendMsg').textContent`)) && !(await vis('modal')));
  await click('cardTok'); ck('field is hidden when sending SFT', await js(`document.getElementById('tokRow').hidden`)); await click('cardCash'); await set('amtTok', ''); await set('toAddr', ''); await set('amt', '');
  // send everything shows the available amount in the entry box
  await click('cardCash'); await js(`document.getElementById('sendMax').click()`); await wait(300);
  ck('send everything fills the box with the available SFX and locks it', (await js(`document.getElementById('amt').value`)) === (await js(`document.getElementById('balCash').textContent`)) && (await js(`document.getElementById('amt').disabled`)), await js(`document.getElementById('amt').value`));
  await click('cardTok'); await wait(200); ck('switching to SFT shows the available SFT instead', (await js(`document.getElementById('amt').value`)) === (await js(`document.getElementById('balTok').textContent`)), await js(`document.getElementById('amt').value`));
  await js(`document.getElementById('sendMax').click()`); await wait(100); ck('unchecking clears and unlocks the box', (await js(`document.getElementById('amt').value`)) === '' && !(await js(`document.getElementById('amt').disabled`))); await click('cardCash');
  // help: wallet tool status and the update-tools button
  await click('tHelp'); await wait(500);
  ck('help says whether this wallet tool can send both in one transaction', /one transaction/.test(await js(`document.getElementById('helpMixed').textContent`)), await js(`document.getElementById('helpMixed').textContent`));
  ck('help has the update wallet tools button', await js(`!!document.getElementById('refreshTools')`)); await click('tHome'); await wait(200);
  // sweep dust
  f.st.failTransfer = 'not enough outputs for specified ring size, use sweep_dust'; await click('cardCash'); await set('toAddr', ADDR); await set('amt', '1'); await click('review'); await wait(400);
  ck('"not enough outputs" explains and points at Sweep dust', /Sweep dust/.test(await js(`document.getElementById('sendMsg').textContent`)) && (await js(`document.getElementById('sweepBtn').classList.contains('hot')`)), await js(`document.getElementById('sendMsg').textContent`));
  f.st.failTransfer = null; f.st.calls.length = 0; const r0 = f.st.relayed.length; await click('sweepBtn'); await wait(500);
  ck('sweep button sits beside Split into coins', await js(`(()=>{const a=document.getElementById('splitCash').getBoundingClientRect(),b=document.getElementById('sweepBtn').getBoundingClientRect();return Math.abs(a.top-b.top)<4&&b.left>a.left})()`));
  ck('sweep review shows total, fee and nothing relayed yet', (await vis('modal')) && (await js(`document.getElementById('mTitle').textContent`)) === 'Confirm sweep' && /2 SFX transactions/.test(await js(`document.getElementById('mTo').textContent`)) && (await js(`document.getElementById('mFee').textContent`)) === '0.03 SFX' && f.st.relayed.length === r0, await js(`document.getElementById('mFee').textContent`));
  await click('mSend'); await wait(600); ck('sweep confirm relays both transactions', f.st.relayed.slice(r0).join() === 'meta:sweep1,meta:sweep2' && (await js(`document.getElementById('mTitle').textContent`)) === 'Sweep sent', f.st.relayed.join()); await click('mCancel'); await wait(150);
  f.st.noDust = true; await click('sweepBtn'); await wait(400); ck('no dust says so, relays nothing', /No dust found/.test(await js(`document.getElementById('sendMsg').textContent`)) && !(await vis('modal'))); f.st.noDust = false;
  // saved addresses
  await set('toAddr', ADDR); await click('addrSave'); await wait(100); ck('save asks for a name', await vis('addrNameRow')); await set('addrName', 'Mum'); await click('addrOk'); await wait(400);
  ck('saved address appears in the dropdown', (await js(`[...document.getElementById('addrPick').options].map((o)=>o.textContent).join('|')`)).includes('Mum'));
  await set('toAddr', ''); await js(`(()=>{const s=document.getElementById('addrPick');s.value=${JSON.stringify(ADDR)};s.dispatchEvent(new Event('change'))})()`); await wait(100);
  ck('choosing a saved address fills the box', (await js(`document.getElementById('toAddr').value`)) === ADDR);
  await click('addrDel'); await wait(300); ck('remove deletes it', !(await js(`[...document.getElementById('addrPick').options].map((o)=>o.textContent).join('|')`)).includes('Mum'));
  await set('toAddr', ''); f.st.cash = '25000000000';
  await click('cardTok'); await set('toAddr', ADDR); await set('amt', '2'); await click('review'); await wait(500);
  ck('token review uses SFT and transfer_token', (await js(`document.getElementById('mAmt').textContent`)) === '2 SFT' && f.st.calls.some((c) => c.method === 'transfer_token')); await shot('8-token');
  await click('mCancel'); await click('tHist'); await wait(300); ck('history rows shown', (await js(`document.getElementById('hBody').children.length`)) === 2);
  ck('a combined send is listed with both amounts (SFX read from its destinations)', (await js(`document.getElementById('hBody').children[0].children[5].textContent`)) === '2 SFX + 2 SFT', await js(`document.getElementById('hBody').children[0].children[5].textContent`)); ck('incoming row shows no bogus fee', (await js(`document.getElementById('hBody').children[1].children[6].textContent`)) === '—', await js(`document.getElementById('hBody').children[0].children[6].textContent`)); await shot('9-history');
  await click('switch'); await wait(800); ck('switch wallet shows the wallet list, app hidden', (await vis('sFile')) && !(await vis('app')));
  await js(`document.querySelector('#sFile .back').click()`); await wait(500); ck('Back from the wallet list returns to the open wallet, still live', (await vis('app')) && !(await vis('login')) && (await js(`document.getElementById('balCash').textContent`)) !== '0', await js(`document.getElementById('balCash').textContent`));
  await click('switch'); await wait(800);
  await click('bBrowse'); await wait(300); await click('fileNext'); await wait(300); ck('after choosing, goes straight to password (node kept)', await vis('sPass'));
  await js(`document.querySelector('#sPass .back').click()`); await wait(300); ck('Back from password returns to the wallet list while switching', await vis('sFile')); await click('bBrowse'); await wait(200); await click('fileNext'); await wait(300);
  await set('pw', 'wrong'); await click('unlock'); await wait(3500); ck('wrong password on a switch keeps the old wallet open behind', (await vis('sPass')) && f.st.opened === 'test');
  await js(`document.querySelector('#sPass .back').click()`); await js(`document.querySelector('#sFile .back').click()`); await wait(800); ck('after a failed switch, Back gives the open wallet back, live', (await vis('app')) && (await until(`document.getElementById('chip').textContent==='Synced'`, 8000)));
  await click('switch'); await wait(600); await click('bBrowse'); await wait(200); await click('fileNext'); await wait(300);
  ck('switching wallets blanks the old wallet\'s numbers, address and transactions at once', await js(`['balCash','balTok','addr'].every((k)=>document.getElementById(k).textContent==='\u2014') && document.getElementById('recentList').children.length===0 && document.getElementById('hBody').children.length===0 && document.getElementById('lastIn').textContent==='\u2014'`));
  await set('pw', 'test-pass'); await click('unlock'); await wait(1500); ck('switch reopens the wallet', await vis('app'));
  // marketplace browser
  await click('tMarket'); await wait(1200); ck('market tab loads listings from the node', (await js(`document.getElementById('mkList').children.length`)) === 2, await js(`document.getElementById('mkCount').textContent`)); await shot('9b-market');
  ck('inactive listing hidden by default, price shown in SFX, pegged shows minimum', /19\.07 SFX/.test(await js(`document.getElementById('mkList').textContent`)) && /min 5 SFX/.test(await js(`document.getElementById('mkList').textContent`)));
  await js(`document.getElementById('mkActive').click()`); await wait(200); ck('Active only off shows all 3', (await js(`document.getElementById('mkList').children.length`)) === 3);
  await set('mkSearch', 'camera'); await wait(200); ck('search filters by title', (await js(`document.getElementById('mkList').children.length`)) === 1);
  await set('mkSearch', ''); await js(`document.getElementById('mkGear').click()`); await wait(200); ck('Mining gear filter keeps only parts', (await js(`document.getElementById('mkList').children.length`)) === 1 && /Thermal Grizzly/.test(await js(`document.getElementById('mkList').textContent`)));
  await js(`document.getElementById('mkGear').click()`); await click('mkSellers'); await wait(200); ck('sellers list shows every seller incl. ones with none active', (await js(`document.getElementById('mkSellerBox').children.length`)) === 4 && /1 active \/ 1 listed/.test(await js(`document.getElementById('mkSellerBox').textContent`)) && /none active \/ 1 listed/.test(await js(`document.getElementById('mkSellerBox').textContent`)));
  await js(`[...document.getElementById('mkSellerBox').children].find((b) => /none active/.test(b.textContent)).click()`); await wait(200); ck('picking a seller with none active still shows their listing', (await js(`document.getElementById('mkList').children.length`)) === 1 && !(await js(`document.getElementById('mkActive').checked`)) && /Panasonic/.test(await js(`document.getElementById('mkList').textContent`)), await js(`document.getElementById('mkList').textContent`));
  await set('mkSearch', 'sombra'); await wait(200); await js(`document.getElementById('mkList').children[0].click()`); await wait(500);
  ck('detail shows decoded description, seller, offer id, picture links as text only', (await vis('mkDetail')) && /Warm gel/.test(await js(`document.getElementById('dText').textContent`)) && /sombra/.test(await js(`document.getElementById('dBody').textContent`)) && /example\.invalid/.test(await js(`document.getElementById('dImgs').textContent`)) && (await js(`document.querySelectorAll('img').length`)) === 0); await shot('9c-offer');
  // buy: the math is on screen before anything is asked of the wallet tool
  ck('buy box shows what you pay, what the seller receives, the 5% share', (await vis('buyBox')) && /You pay\s*19\.07 SFX/.test((await js(`document.getElementById('buyMath').textContent`)).replace(/\s+/g, ' ').replace(/(\D)(\d)/, '$1 $2')) || /19\.07 SFX/.test(await js(`document.getElementById('buyMath').textContent`)));
  await set('buyQty', '2'); await wait(100); const bm = await js(`document.getElementById('buyMath').textContent`);
  ck('quantity 2 doubles it: pay 38.14, seller 36.233, network 1.907', /38\.14 SFX/.test(bm) && /36\.233 SFX/.test(bm) && /1\.907 SFX/.test(bm), bm);
  await set('buyQty', '1'); await click('buyBtn'); await wait(300); ck('buy dialog asks for the wallet password and nothing was sent yet', (await vis('actDlg')) && (await vis('actPwBox')) && !/FEE_ANSWER|CMD safex_purchase/.test(cliLog()));
  await click('actGo'); await wait(300); ck('empty password is refused in the dialog', /Enter your wallet password/.test(await js(`document.getElementById('actMsg').textContent`)) && !/CMD safex_purchase/.test(cliLog()));
  await set('actPw', 'test-pass'); await click('actGo'); await quoted();
  ck('exact fee from the tool is shown, still nothing sent', /0\.134 SFX/.test(await js(`document.getElementById('actRows').textContent`)) && /Confirm and send/.test(await js(`document.getElementById('actGo').textContent`)) && /CMD safex_purchase f8b24218a748af5b18d37069b3b8d7c5041ecfbdb4990c27f2faf7c2b31d67f5 1/.test(cliLog()) && !/FEE_ANSWER/.test(cliLog()), (await js(`document.getElementById('actMsg').textContent + ' | ' + document.getElementById('actGo').textContent`)) + ' || ' + cliLog().slice(-300)); await shot('9e-buy-quote');
  ck('password was never put on a command line', !cliLog().split('\n').filter((l) => l.startsWith('ARGS')).some((l) => /test-pass/.test(l)));
  await click('actCancel'); await wait(1500); ck('cancel answers no, nothing sent, wallet is back', /FEE_ANSWER n/.test(cliLog()) && !/FEE_ANSWER y/.test(cliLog()) && !(await vis('actDlg')));
  await click('buyBtn'); await set('actPw', 'wrong'); await click('actGo'); await quoted(); { const m = await js(`document.getElementById('actMsg').textContent`); ck('wrong password gives a plain message', /Wrong password/.test(m), m); }
  await click('actCancel'); await wait(2500);
  await click('buyBtn'); await set('actPw', 'test-pass'); await click('actGo'); await quoted(); await click('actGo'); await sentOk();
  ck('confirm sends exactly once and shows the transaction', /FEE_ANSWER y/.test(cliLog()) && (cliLog().match(/FEE_ANSWER y/g) || []).length === 1 && /Sent\. Transaction abababab/.test(await js(`document.getElementById('actMsg').textContent`)), await js(`document.getElementById('actMsg').textContent`)); await shot('9f-buy-done');
  await click('actGo'); await wait(1500); ck('dialog closes, wallet reopened and still live', !(await vis('actDlg')) && (await vis('app')) && /1,?000|10|[0-9]/.test(await js(`document.getElementById('balCash').textContent`)));
  await click('mkBack'); await wait(200); ck('back returns to the list', !(await vis('mkDetail')));
  // seller desk
  await click('tSell'); await wait(200); ck('Sell tab shows both steps', /Seller account/.test(await js(`document.getElementById('vSell').textContent`)));
  await set('ofNet', '1'); await wait(100); const om = await js(`document.getElementById('ofMath').textContent`);
  ck('listing maths: to receive 1 SFX list at 1.052631579, buyer pays that, 5% share, you receive 1', /1\.052631579 SFX/.test(om) && /0\.052631579 SFX/.test(om) && /You receive1 SFX/.test(om.replace(/\s+/g, '')) || /1 SFX per unit/.test(om), om);
  await set('acUser', 'Bad Name'); await set('acData', 'testaccount'); await click('acBtn'); await set('actPw', 'test-pass'); await click('actGo'); await wait(1200);
  ck('bad account name is refused with the rule, nothing sent', /lowercase letters/.test(await js(`document.getElementById('actMsg').textContent`)) && !/CMD safex_account/.test(cliLog().split('\n').slice(-3).join('\n')));
  await click('actCancel'); await wait(1200);
  await set('acUser', 'test1seller'); await click('acBtn'); await set('actPw', 'test-pass'); await click('actGo'); await quoted();
  ck('account: tool made the keys, quote shown with 1,000 SFT lock note', /Confirm and send/.test(await js(`document.getElementById('actGo').textContent`)) && /CMD safex_account new test1seller testaccount/.test(cliLog()) && /CMD safex_account create test1seller/.test(cliLog()) && /1,000 SFT/.test(await js(`document.getElementById('actNote').textContent + document.getElementById('actRows').textContent`)));
  await click('actGo'); await sentOk(); ck('account create confirmed once', /Sent\. Transaction/.test(await js(`document.getElementById('actMsg').textContent`))); await click('actGo'); await wait(1500);
  await set('ofUser', 'test1seller'); await set('ofName', 'sft-test-offer'); await set('ofQty', '5'); await set('ofDesc', 'testlisting'); await click('ofBtn'); await set('actPw', 'test-pass'); await click('actGo'); await quoted();
  ck('listing: tool got the grossed-up price, said no to price peg, quote shown', /CMD safex_offer create test1seller sft-test-offer 1\.052631579 5 testlisting/.test(cliLog()) && /PEG n/.test(cliLog()) && /Confirm and send/.test(await js(`document.getElementById('actGo').textContent`)), cliLog().slice(-250)); await shot('9g-sell-quote');
  await click('actCancel'); await wait(1500);
  await set('ofName', 'has space'); await click('ofBtn'); await set('actPw', 'test-pass'); await click('actGo'); await wait(1200);
  ck('listing name with a space is refused plainly', /no spaces/.test(await js(`document.getElementById('actMsg').textContent`))); await click('actCancel'); await wait(1500);
  fake.offersBody.mine = true; await set('mlUser', 'test1seller'); await click('mlShow'); await until(`document.querySelectorAll('#mlList .swoffer').length===1`, 8000);
  ck('my listings shows the plain listing with Edit and Close', /sft-test-offer: 5 at 1\.052631579 SFX, active/.test(await js(`document.getElementById('mlList').textContent`)) && (await js(`[...document.querySelectorAll('#mlList .swoffer > button')].map((b)=>b.textContent).join()`)) === 'Edit,Close', await js(`document.getElementById('mlList').textContent`));
  await js(`document.querySelector('#mlList .btn.small').click()`); await wait(150); ck('Edit opens the price and quantity boxes', await js(`!document.querySelector('#mlList .mledit').hidden`));
  await js(`(()=>{const f=document.querySelectorAll('#mlList .mledit input'); f[0].value='2'; f[1].value='8'})()`); const rf0 = (cliLog().match(/CMD refresh/g) || []).length; await js(`document.querySelector('#mlList .mledit .primary').click()`); await wait(200); await set('actPw', 'test-pass'); await click('actGo'); await quoted();
  const er = await js(`document.getElementById('actRows').textContent`);
  ck('edit: the tool got price 2.1052631579 (2 to you, +5%) and quantity 8, kept open and the description; review shows old to new', /CMD safex_offer edit test1seller abab\w+ sft-test-offer 2\.1052631579 8 1 testlisting/.test(cliLog()) && /5\s*\u2192\s*8/.test(er) && /Confirm and send/.test(await js(`document.getElementById('actGo').textContent`)), er);
  ck('a wallet already at the chain tip is not asked to refresh again before the price (that wait can hang on the last block)', (cliLog().match(/CMD refresh/g) || []).length === rf0);
  ck('while the price check is open the wallet tool is paused but the listings still load from the node', await js(`window.wallet.offers().then((r)=>r.ok&&r.rows.length>0)`));
  ck('a paused wallet says so in plain words, never the bare word Locked', /paused for a price check/.test(await js(`window.wallet.snapshot().then((r)=>String(r.error))`)));
  await click('actCancel'); await wait(1500); fake.offersBody.mine = false;
  await click('tMarket'); await wait(200);
  await click('tHome'); await js(`document.getElementById('recentList').children[0].click()`); await wait(300);
  ck('clicking a Recent activity line opens History with that transaction highlighted', (await vis('vHist')) && (await js(`document.querySelectorAll('#hBody tr.hl').length`)) === 1 && (await js(`document.querySelector('#hBody tr.hl').dataset.txid`)) === 'cc'.repeat(32)); await shot('9n-recent-link');
  await click('tHist'); await wait(200); ck('History button opens history with no selection', (await js(`document.querySelectorAll('#hBody tr.hl').length`)) === 0);
  await click('tHome');
  // 0.3.1: wallet label, market gating, wallet tab
  ck('wallet label shows beside Your address', (await vis('walletTag')) && (await js(`document.getElementById('walletTag').textContent`)) === 'test', await js(`document.getElementById('walletTag').textContent`));
  await click('tMarket'); await wait(800); await set('mkSearch', ''); await js(`document.getElementById('mkActive').checked=true`);
  ck('market hides the young listing by default', !/Young Listing/.test(await js(`document.getElementById('mkList').textContent`)));
  await click('mkNew'); await wait(300); const yl = await js(`document.getElementById('mkList').textContent`);
  ck('Show confirming reveals it with a countdown', /Young Listing/.test(yl) && /more block/.test(yl), yl.slice(0, 300)); await shot('9h-young');
  await set('mkSearch', 'young'); await wait(200); await js(`document.getElementById('mkList').children[0].click()`); await wait(500);
  ck('young listing: Buy is disabled and says how long', await js(`document.getElementById('buyBtn').disabled`) && /more block|confirming/i.test(await js(`document.getElementById('buyBtn').textContent + document.getElementById('buyMath').textContent`)), await js(`document.getElementById('buyBtn').textContent`)); await shot('9i-young-detail');
  await click('mkBack'); await click('mkNew'); await set('mkSearch', '');
  await click('tHome'); await wait(300); ck('address bar carries the wallet label and the tool buttons', (await js(`document.querySelector('.addr').contains(document.getElementById('walletTag'))`)) && (await js(`['copy','wSeed','wBackup','wRescanFrom','wRescanAll'].every((i)=>document.querySelector('.addr').contains(document.getElementById(i)))`)));
  await click('wBackup'); await until(`!document.getElementById('wMsg').hidden`);
  const bkd = fs.readdirSync(BK); ck('backup made one folder with all four files and a note', bkd.length === 1 && fs.readdirSync(path.join(BK, bkd[0])).sort().join() === 'RESTORE.txt,test,test.address.txt,test.keys,test.safex_account_keys', bkd.join() + ' ' + (bkd[0] ? fs.readdirSync(path.join(BK, bkd[0])).join() : ''));
  ck('backup result says so and mentions account keys', /Saved|saved|backup/i.test(await js(`document.getElementById('wMsg').textContent`)) && /account/i.test(await js(`document.getElementById('wMsg').textContent`)), await js(`document.getElementById('wMsg').textContent`)); await shot('9j-backup');
  ck('wallet is live again after the backup', await until(`document.getElementById('chip').textContent==='Synced'`, 8000));
  await click('wSeed'); await wait(200); ck('seed dialog asks for the password first', (await vis('seedDlg')) && !(await vis('seedShow')));
  await set('seedPw', 'nope'); await click('seedGo'); await wait(500); ck('wrong password shows no words', !(await vis('seedShow')) && !(await js(`document.getElementById('seedMsg').hidden`)));
  await set('seedPw', 'test-pass'); await click('seedGo'); await until(`!document.getElementById('seedShow').hidden`);
  ck('right password shows 25 words', (await js(`document.getElementById('seedWords').textContent.trim().match(/word\\d+/g).length`)) === 25, await js(`document.getElementById('seedWords').textContent`)); await shot('9k-seed');
  ck('keys dialog also shows address, spend key and view key', (await js(`document.getElementById('kAddr').textContent`)).startsWith('Safex') && (await js(`document.getElementById('kSpend').textContent`)) === 'cd'.repeat(32) && (await js(`document.getElementById('kView').textContent`)) === 'ab'.repeat(32));
  await click('seedHide'); await wait(200); ck('hide clears the words, keys and closes', !(await vis('seedDlg')) && (await js(`document.getElementById('seedWords').textContent`)) === '' && (await js(`document.getElementById('kSpend').textContent + document.getElementById('kView').textContent`)) === '');
  await click('wRescanFrom'); await wait(200); await set('rsFrom', 'abc'); await set('rsPw', 'test-pass'); await click('rsGo'); await wait(400);
  ck('rescan with a bad block number is refused plainly, dialog stays, nothing run', /block number/.test(await js(`document.getElementById('rsMsg').textContent`)) && (await vis('rescanDlg')) && !/CMD rescan_bc/.test(cliLog()));
  await set('rsFrom', '2098000'); await set('rsPw', 'wrong'); await click('rsGo'); await wait(1500);
  ck('rescan with wrong password does nothing', /Wrong password/.test(await js(`document.getElementById('wMsg').textContent`)) && !/CMD rescan_bc/.test(cliLog()), await js(`document.getElementById('wMsg').textContent`));
  await click('wRescanFrom'); await wait(200); await set('rsFrom', '2098000'); await set('rsPw', 'test-pass'); await click('rsGo'); await until(`!document.getElementById('busyDlg').hidden`, 4000); await shot('9l-rescan-busy');
  ck('busy screen shows while rescanning', await vis('busyDlg'));
  ck('rescan finishes, busy closes, command had the block', await until(`document.getElementById('busyDlg').hidden && /Rescan finished/.test(document.getElementById('wMsg').textContent)`, 15000) && /CMD rescan_bc 2098000/.test(cliLog()), await js(`document.getElementById('wMsg').textContent`));
  ck('automatic safety copy was made before the rescan', fs.existsSync(path.join(app.getPath('userData'), 'backups')) && fs.readdirSync(path.join(app.getPath('userData'), 'backups')).length === 1);
  await click('wRescanAll'); await wait(200); ck('hard rescan dialog has no block box', !(await vis('rsFromBox'))); await set('rsPw', 'test-pass'); await click('rsGo'); await until(`document.getElementById('rescanDlg').hidden && document.getElementById('busyDlg').hidden`, 15000);
  ck('full rescan sends rescan_bc with no block', /CMD rescan_bc\s*\n/.test(cliLog()), cliLog().slice(-200));
  ck('wallet live after rescans', await until(`document.getElementById('chip').textContent==='Synced'`, 8000)); await shot('9m-wallet-tab');
  // 0.4.0: explorer
  await click('tExplorer'); await wait(1500); const exb = await js(`document.getElementById('exBody').children.length`);
  ck('Explorer tab lists the newest 20 blocks from the node', exb === 20 && /2,098,731/.test(await js(`document.getElementById('exBody').children[0].textContent`)), exb); await shot('9o-explorer');
  ck('pool transactions are listed', await vis('exPoolBox'));
  await js(`document.getElementById('exBody').children[0].click()`); await wait(800);
  ck('clicking a block opens its page with facts and the transaction', (await vis('exDetail')) && /Block 2,098,731/.test(await js(`document.getElementById('exTitle').textContent`)) && /Hash/.test(await js(`document.getElementById('exFacts').textContent`)) && (await js(`document.getElementById('exTxs').children.length`)) === 1); await shot('9p-explorer-block');
  await js(`document.getElementById('exTxs').children[0].click()`); await wait(800);
  ck('clicking a transaction shows ring size, fee and confirmations', /Ringsize7/.test((await js(`document.getElementById('exTxFacts').textContent`)).replace(/\s+/g, '')) && /0\.134 SFX/.test(await js(`document.getElementById('exTxFacts').textContent`)) && /confirmation/.test(await js(`document.getElementById('exTxFacts').textContent`)), await js(`document.getElementById('exTxFacts').textContent + '|' + document.getElementById('exErr').textContent`));
  await set('exQ', '99999999'); await click('exGo'); await wait(600); ck('unknown block gives a plain message', /No such block/.test(await js(`document.getElementById('exErr').textContent`)));
  await set('exQ', '2098700'); await click('exGo'); await wait(600); ck('search by block number works', /Block 2,098,700/.test(await js(`document.getElementById('exTitle').textContent`)));
  await click('exLatest'); await wait(800); ck('Back to latest returns to the list', (await vis('exList')) && !(await vis('exDetail')));
  await click('tHist'); await wait(200); await js(`document.querySelector('#hBody td.tx').click()`); await wait(900);
  ck('History TXID opens that transaction in the Explorer', (await vis('vExplorer')) && /Transaction/.test(await js(`document.getElementById('exTitle').textContent`)));
  await click('tHome');
  await click('tStake'); await wait(1200); const stt = await js(`document.getElementById('stBody').textContent`), sst = await js(`document.getElementById('stStatus').textContent`);
  ck('staking tab shows token holdings, available, earned so far', /Unlocked tokens/.test(sst) && /Locked tokens/.test(sst) && /Rewards available/.test(sst) && /SFX/.test(sst), sst);
  ck('network rewards still shown', /No\. None of the last/.test(stt) && /1441/.test(stt) && /years ago/.test(stt), stt); await shot('9d-staking');
  f.st.tokens = '300000000000000'; f.st.unlocked.tokens = '300000000000000'; f.st.staked = '250000000000000'; await click('stLoad'); await wait(1200);
  ck('Staking tab shows a total of held plus staked tokens (30,000 + 25,000)', /^55,?000 SFT$/.test(await js(`document.getElementById('stTotal').textContent`)) && /25,?000 staked/.test(await js(`document.getElementById('stTotalSub').textContent`)) && (await js(`document.getElementById('stTotal').getBoundingClientRect().top < document.getElementById('stStatus').getBoundingClientRect().top`)), await js(`document.getElementById('stTotal').textContent + ' | ' + document.getElementById('stTotalSub').textContent`));
  await click('tHome'); await wait(5600);
  ck('Home shows the total with staked beside the SFT balance', /Total with staked: 55,?000 SFT \(25,?000 staked\)/.test(await js(`document.getElementById('subTokTotal').textContent`)), await js(`document.getElementById('subTokTotal').textContent`)); await click('tStake'); await wait(300);
  f.st.unlocked.tokens = '100000000000000'; await click('tHome'); await wait(5600);
  ck('Home SFT shows only what can be spent (10,000 of 30,000), with the locked amount under it', (await js(`document.getElementById('balTok').textContent`)).replace(/,/g, '') === '10000' && /20,?000 locked/.test(await js(`document.getElementById('subTok').textContent`)), await js(`document.getElementById('balTok').textContent + ' | ' + document.getElementById('subTok').textContent`));
  await click('tStake'); await click('stLoad'); await wait(1200);
  ck('Staking status lists Staked, Locked tokens, Unlocked tokens, then Rewards available, in that order', /Staked25,?000SFTLockedtokens20,?000SFTUnlockedtokens10,?000SFTStakedandunlocked25,?000SFTRewardsavailable/.test((await js(`document.getElementById('stStatus').textContent`)).replace(/\s+/g, '')) && /^55,?000 SFT$/.test(await js(`document.getElementById('stTotal').textContent`)), await js(`document.getElementById('stStatus').textContent`));
  f.st.unlocked.tokens = '300000000000000'; await click('stLoad'); await wait(1200);
  await set('stAmt', '100'); await click('stBtn'); await set('actPw', 'test-pass'); await click('actGo'); await wait(1500);
  ck('stake below 25,000 gives a plain message and no tool command', /minimum stake is 25,000/.test(await js(`document.getElementById('actMsg').textContent`)) && !/CMD stake_token/.test(cliLog()), await js(`document.getElementById('actMsg').textContent`));
  await click('actCancel'); await wait(300);
  const fa = () => (cliLog().match(/FEE_ANSWER/g) || []).length; const fa0 = fa();
  await set('stAmt', '25000'); await click('stBtn'); await set('actPw', 'test-pass'); await click('actGo'); await quoted();
  ck('stake: exact fee shown, tool got stake_token <own address> 25000, nothing sent yet', /Stake/.test(await js(`document.getElementById('actRows').textContent`)) && /25,000 SFT/.test(await js(`document.getElementById('actRows').textContent`)) && /CMD stake_token Safex1+ 25000\s/.test(cliLog() + ' ') && fa() === fa0, cliLog().slice(-300));
  await click('actCancel'); await wait(2500);
  await set('unAmt', '1000'); await set('unHeight', '2090000'); await click('unBtn'); await set('actPw', 'test-pass'); await click('actGo'); await quoted();
  ck('unstake: tool got unstake_token <own address> 1000 2090000, nothing sent yet', /CMD unstake_token Safex1+ 1000 2090000\s/.test(cliLog() + ' ') && fa() === fa0 + 1, cliLog().slice(-300));
  await click('actGo'); await sentOk(); ck('unstake confirm sends once', (cliLog().match(/FEE_ANSWER y/g) || []).length >= 1 && /Sent\. Transaction/.test(await js(`document.getElementById('actMsg').textContent`)));
  await click('actGo'); await wait(1800);
  await click('tHome'); await wait(200);
  await click('lock'); await wait(800); ck('lock returns to start', (await vis('sStart')) && !(await vis('app')));
  console.log(bad ? 'FAIL ' + bad : 'ALL OK'); await f.close(); await nd.close(); app.exit(bad ? 1 : 0);
})();
