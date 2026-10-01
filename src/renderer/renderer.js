'use strict';
(async () => {
  const $ = (id) => document.getElementById(id);
  const MAX_LINES = 1000;

  const fmtHs = (v) => {
    if (v === null || v === undefined) return '—';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + ' MH/s';
    if (v >= 1e3) return (v / 1e3).toFixed(2) + ' kH/s';
    return v.toFixed(1) + ' H/s';
  };

  const init = await window.safex.init();
  let settings = init.settings;
  let running = init.running;
  let waiting = false, waitSecs = 0;
  let waitText = '';
  let node = { state: 'unknown' };
  let payCount = null;
  let stats = {};

  $('cpuModel').textContent = `${init.cpuModel} · ${init.cores} threads`;
  $('foot').textContent = `Safex Community Miner ${init.version} · MIT · xmrig engine`;

  // ---- settings <-> form -------------------------------------------------
  function fillForm() {
    $('address').value = settings.address;
    $('name').value = settings.name;
    $('pool').value = settings.pool;
    $('node').value = settings.node;
    $('cpu').value = String(settings.cpu);
    $('donate').value = String(settings.donate);
    $('autostart').checked = settings.autostart;
    $('requireSynced').checked = settings.requireSynced;
    $('autostartNode').checked = settings.autostartNode;
    renderMode();
  }
  function readForm() {
    return {
      address: $('address').value.trim(),
      name: $('name').value,
      pool: $('pool').value,
      node: $('node').value.trim(),
      cpu: parseInt($('cpu').value, 10),
      donate: parseInt($('donate').value, 10),
      autostart: $('autostart').checked,
      requireSynced: $('requireSynced').checked,
      autostartNode: $('autostartNode').checked,
      mode: settings.mode,
    };
  }
  async function save() { settings = await window.safex.setSettings(readForm()); }

  ['address', 'name', 'pool', 'node', 'cpu', 'donate', 'autostart', 'requireSynced', 'autostartNode'].forEach((id) =>
    $(id).addEventListener('change', save));

  function setMode(m) { settings.mode = m; save(); renderMode(); }
  $('modePool').onclick = () => !running && setMode('pool');
  $('modeSolo').onclick = () => !running && setMode('solo');

  function renderMode() {
    const solo = settings.mode === 'solo';
    $('modePool').className = solo ? '' : 'sel';
    $('modeSolo').className = solo ? 'sel' : '';
    $('poolRow').hidden = solo;
    if (typeof renderExpected === 'function') renderExpected();
    $('soloRow').hidden = !solo;
    $('gateWrap').hidden = !solo;
    renderNode();
    renderState();
  }

  // ---- node chip ----------------------------------------------------------
  function renderNode() {
    const solo = settings.mode === 'solo';
    $('syncBar').hidden = !(solo && node.state === 'syncing');
    const chip = $('nodeChip');
    const wasSynced = chip.classList.contains('synced');
    chip.className = 'nodechip ' + (node.state || '');
    if (node.state === 'synced' && !wasSynced && chip.dataset.seen) { chip.classList.add('justsynced'); setTimeout(() => chip.classList.remove('justsynced'), 1800); }
    if (node.state) chip.dataset.seen = '1';
    const t = $('nodeText');
    if (node.state === 'synced') t.textContent = `Synced · block ${node.height.toLocaleString()} · ${node.peers} peers`;
    else if (node.state === 'syncing' && !node.peers) {
      t.textContent = 'Connecting to peers…';
    } else if (node.state === 'syncing') {
      t.textContent = `Syncing ${node.percent.toFixed(1)}% · ${node.height.toLocaleString()} / ${node.target.toLocaleString()}`;
      $('syncFill').style.width = node.percent + '%';
    } else if (node.state === 'offline') t.textContent = 'Node not reachable';
    else t.textContent = 'Checking node…';
  }

  // ---- status strip -------------------------------------------------------
  // 3-step entrance: node synced -> miner starting -> mining. Shown only while starting.
  let railSeen = false, railTimer = null;
  function renderRail() {
    const rail = $('rail');
    if (!waiting && !running) { clearTimeout(railTimer); rail.hidden = true; railSeen = false; return; }
    const stage = waiting ? (node.state === 'synced' ? 1 : 0) : (stats.connected ? 3 : 2);
    if (stage === 3 && !railSeen) { rail.hidden = true; return; }  // already mining when the app opened
    clearTimeout(railTimer); railSeen = stage < 3;
    rail.hidden = false; rail.className = 'rail s' + stage;
    if (stage === 3) railTimer = setTimeout(() => { rail.hidden = true; }, 2200);
  }

  function renderState() {
    const go = $('go');
    let light = 'off', text = 'Stopped';
    if (waiting) { light = 'wait'; text = waitText || 'Waiting for sync'; }
    else if (running) {
      if (stats.connected) { light = 'on'; text = 'Mining'; }
      else { light = 'wait'; text = 'Connecting…'; }
    }
    $('light').className = 'light ' + light;
    if ($('statusText').textContent !== text) { const st = $('statusText'); st.classList.remove('swap'); void st.offsetWidth; st.classList.add('swap'); }
    renderRail();
    $('statusText').textContent = text; $('statusText').title = waiting && waitSecs ? `Mining starts in ${waitSecs}s` : '';
    go.textContent = running || waiting ? 'Stop mining' : 'Start mining';
    go.className = 'go' + (running || waiting ? ' active' : '');
    const lock = running || waiting;
    ['address', 'name', 'pool', 'node', 'cpu', 'donate'].forEach((id) => ($(id).disabled = lock));
  }

  function renderStats() {
    $('hashrate').textContent = fmtHs(stats.hashrate);
    $('threads').textContent = stats.threads ?? '—';
    $('shares').textContent = `${stats.accepted || 0} / ${stats.rejected || 0}`;
    const run = stats.blocks || 0;
    if (payCount != null) { $('blocks').textContent = Math.max(payCount, run); $('blocksSub').textContent = 'this run: ' + run; }
    else { $('blocks').textContent = run; $('blocksSub').textContent = 'this run'; }
    renderExpected();
    const warn = [];
    if (running && stats.msr === false)
      warn.push('CPU tuning (MSR) was not applied, so hashrate will be lower. On Linux run the app with root, or see the README.');
    if (running && stats.hugepages !== null && stats.hugepages !== undefined && stats.hugepages < 100)
      warn.push(`Huge pages only ${stats.hugepages}% — hashrate may be reduced.`);
    const b = $('banner');
    b.hidden = warn.length === 0;
    b.textContent = warn.join(' ');
    renderState();
  }

  // ---- viewport -----------------------------------------------------------
  const logEl = $('log');
  function addLog(line) {
    const div = document.createElement('div');
    const m = line.replace(/^\[[^\]]*\]\s*/, '');
    if (/^\$ /.test(line)) div.className = 'l-cmd';
    else if (/FAILED|error|ERROR|rejected/i.test(line)) div.className = /rejected/i.test(line) ? 'l-warn' : 'l-err';
    else if (/speed 10s/.test(line)) div.className = 'l-hr';
    else if (/accepted|BLOCK FOUND|READY/i.test(line)) div.className = 'l-ok';
    div.textContent = /^\$ /.test(line) ? line : m;
    div.title = line;
    logEl.appendChild(div);
    while (logEl.childElementCount > MAX_LINES) logEl.removeChild(logEl.firstChild);
    if ($('follow').checked) logEl.scrollTop = logEl.scrollHeight;
  }
  $('clearLog').onclick = () => { logEl.textContent = ''; };
  $('copyLog').onclick = async () => {
    const text = [...logEl.children].map((c) => c.title || c.textContent).join('\n');
    await window.safex.copyText(text);
    const b = $('copyLog'); const t = b.textContent; b.textContent = 'Copied'; setTimeout(() => (b.textContent = t), 1200);
  };

  // ---- events from main ---------------------------------------------------
  window.safex.onLog(addLog);
  window.safex.onStats((s) => { if (running && (s.blocks || 0) > (stats.blocks || 0)) setPayBubble(true); stats = s; renderStats(); });
  window.safex.onState((s) => {
    running = !!s.running;
    if (!running) {
      stats.hashrate = null; stats.connected = false;
      if (s.exit && s.exit.code) addLog(`Miner exited (code ${s.exit.code}).`);
    }
    renderStats();
  });
  window.safex.onWaiting((w) => { waiting = w.waiting; waitText = w.text || ''; waitSecs = w.seconds || 0; renderState(); });

  // ---- start / stop -------------------------------------------------------
  $('go').onclick = async () => {
    const err = $('error');
    err.hidden = true;
    if (running || waiting) { await window.safex.stop(); return; }
    $('go').disabled = true;
    const r = await window.safex.start(readForm());
    $('go').disabled = false;
    if (!r.ok) { err.textContent = r.error; err.hidden = false; }
  };


  // ---- light explorer -----------------------------------------------------
  let exVisible = false, exRows = [], exTip = 0, exMine = [], exBusy = false;
  const exShort = (h) => h ? h.slice(0, 10) + '…' + h.slice(-8) : '';
  const exAge = (t) => { const d = Math.max(0, Math.floor(Date.now() / 1000 - t)); return d < 90 ? d + ' s' : d < 5400 ? Math.round(d / 60) + ' min' : d < 172800 ? Math.round(d / 3600) + ' h' : Math.round(d / 86400) + ' d'; };
  const exKB = (n) => (n / 1024).toFixed(1) + ' KB';
  function exCell(tr, text, cls) { const td = document.createElement('td'); td.textContent = text; if (cls) td.className = cls; tr.appendChild(td); return td; }
  function exErr(msg) { $('exErr').hidden = !msg; $('exErr').textContent = msg || ''; }
  function exSource(r) { $('exSrc').textContent = r && r.source ? (r.source === 'local' ? 'Reading from your own node.' : 'Your node is not answering, so this is read from the public Safex node.') : ''; }
  function exRender() {
    const body = $('exBody'); body.textContent = '';
    for (const b of exRows) {
      const tr = document.createElement('tr'); tr.style.cursor = 'pointer'; tr.title = 'Open block ' + b.height;
      if (exMine.includes(b.height)) tr.className = 'me';
      exCell(tr, b.height.toLocaleString(), 'num'); exCell(tr, exAge(b.time) + ' ago'); exCell(tr, exShort(b.hash)).title = b.hash;
      exCell(tr, String(b.txs), 'num'); exCell(tr, exKB(b.size), 'num'); exCell(tr, fmtSfx(b.reward), 'num');
      exCell(tr, exMine.includes(b.height) ? 'yours' : '');
      tr.onclick = () => exOpen(String(b.height));
      body.appendChild(tr);
    }
  }
  async function exRefresh(reset) {
    if (exBusy || !exVisible || !$('exDetail').hidden) return;
    exBusy = true;
    try {
      const r = await window.safex.exRecent(20, null);
      if (!r.ok) { exErr(r.error); return; }
      exErr(''); exSource(r); exTip = r.tip; exMine = r.mine || [];
      if (reset || !exRows.length) exRows = r.blocks;
      else { const low = r.blocks.length ? r.blocks[r.blocks.length - 1].height : 0; exRows = r.blocks.concat(exRows.filter((b) => b.height < low)); }
      $('exMore').hidden = false; exRender();
    } finally { exBusy = false; }
  }
  $('exMore').onclick = async () => {
    if (!exRows.length) return;
    const r = await window.safex.exRecent(20, exRows[exRows.length - 1].height);
    if (!r.ok) { exErr(r.error); return; }
    exErr(''); exRows = exRows.concat(r.blocks); exMine = r.mine || exMine; exRender();
    if (!r.blocks.length) $('exMore').hidden = true;
  };
  function fact(body, k, v, copy) {
    const tr = document.createElement('tr'); exCell(tr, k).className = 'k'; const td = exCell(tr, v); td.style.whiteSpace = 'normal'; td.style.wordBreak = 'break-all';
    if (copy) { td.style.cursor = 'copy'; td.title = 'Click to copy'; td.onclick = () => window.safex.copyText(copy); }
    body.appendChild(tr);
  }
  async function exOpen(q) {
    q = String(q || '').trim(); if (!q) return;
    const r = await window.safex.exBlock(q);
    if (!r.ok) { exErr(r.error); return; }
    exErr(''); exSource(r);
    const h = r.header, mine = (r.mine || []).includes(h.height);
    $('exList').hidden = true; $('exDetail').hidden = false; $('exLatest').hidden = false; $('exTxBox').hidden = true;
    $('exTitle').textContent = 'Block ' + h.height.toLocaleString() + (mine ? ' · paid to your wallet' : '') + (h.orphan ? ' · orphan' : '');
    const f = $('exFacts'); f.textContent = '';
    fact(f, 'Hash', h.hash, h.hash); fact(f, 'Previous', h.prev, h.prev);
    fact(f, 'Time', new Date(h.time * 1000).toLocaleString() + ' (' + exAge(h.time) + ' ago)');
    fact(f, 'Difficulty', Number(h.difficulty).toLocaleString()); fact(f, 'Reward', fmtSfx(h.reward));
    fact(f, 'Size', exKB(h.size)); fact(f, 'Confirmations', Number(h.depth).toLocaleString()); fact(f, 'Nonce', String(h.nonce));
    if (r.coinbase) fact(f, 'Coinbase', r.coinbase.outputs + ' output(s), ' + fmtSfx(r.coinbase.cash) + (r.coinbase.tokens ? ' + ' + r.coinbase.tokens + ' tokens' : ''));
    const box = $('exTxs'); box.textContent = '';
    if (!r.txHashes.length) box.textContent = 'No transactions besides the coinbase.';
    for (const t of r.txHashes) { const a = document.createElement('button'); a.className = 'mini txbtn'; a.textContent = t; a.onclick = () => exTx(t); box.appendChild(a); }
  }
  async function exTx(hash) {
    const r = await window.safex.exTx(hash);
    if (!r.ok) { exErr(r.error); return; }
    exErr(''); $('exTxBox').hidden = false;
    const f = $('exTxFacts'); f.textContent = '';
    fact(f, 'Hash', r.hash, r.hash); fact(f, 'Status', r.inPool ? 'Waiting in the pool' : 'In block ' + Number(r.height).toLocaleString());
    fact(f, 'Inputs / outputs', r.inputs + ' in, ' + r.outputs + ' out'); fact(f, 'Ring size', String(r.ringSize));
    fact(f, 'Fee', fmtSfx(r.fee)); fact(f, 'Size', exKB(r.size));
    if (r.tokenOutputs) fact(f, 'Token outputs', String(r.tokenOutputs));
  }
  function exBackToList() { $('exDetail').hidden = true; $('exList').hidden = false; $('exLatest').hidden = true; exErr(''); exRefresh(false); }
  $('exGo').onclick = () => exOpen($('exQ').value);
  $('exQ').onkeydown = (e) => { if (e.key === 'Enter') exOpen($('exQ').value); };
  $('exBack').onclick = exBackToList; $('exLatest').onclick = () => { $('exQ').value = ''; exBackToList(); };
  setInterval(() => exRefresh(false), 10000);

  // ---- tabs ---------------------------------------------------------------
  function showTab(name) {
    for (const t of ['mine', 'node', 'rigs', 'pay', 'explorer']) {
      $(t + 'View').hidden = t !== name;
      $('tabBtn' + t[0].toUpperCase() + t.slice(1)).className = t === name ? 'sel' : '';
    }
    if (name === 'node') { window.safex.nodeRefresh().then(applyRefresh); loadMaint(); }
    if (name === 'rigs') renderRigs();
    exVisible = name === 'explorer'; if (exVisible) exRefresh(true);
    $('wsRemove').hidden = name !== 'pay' || !(ws && ws.wallet);
    if (name === 'pay') { setPayBubble(false); if (payCount !== null) { settings.walletSeen = payCount; window.safex.setSettings({ walletSeen: payCount }); } drawCharts(); $('pAddr').value = settings.walletRpc || ''; window.safex.walletGet().then(renderPay); loadWs(); loadDay(); }
  }
  $('tabBtnMine').onclick = () => showTab('mine');
  $('tabBtnNode').onclick = () => showTab('node');
  $('tabBtnRigs').onclick = () => showTab('rigs');
  $('tabBtnPay').onclick = () => showTab('pay');
  $('tabBtnExplorer').onclick = () => showTab('explorer');

  // ---- node panel ---------------------------------------------------------
  let panel = null;
  const nLog = $('nLog');
  let lastSeq = 0;
  function showPlaceholder() {
    if (nLog.childElementCount) return;
    const d = document.createElement('div'); d.className = 'placeholder';
    d.textContent = 'Waiting for node output… A synced node is quiet; a status line appears here every 30 seconds while it runs.';
    nLog.appendChild(d);
  }
  function addNodeLog(entry) {
    if (typeof entry === 'string') entry = { n: lastSeq + 1, t: entry };
    if (entry.n <= lastSeq) return;           // already shown (replay overlap)
    lastSeq = entry.n;
    const ph = nLog.querySelector('.placeholder'); if (ph) ph.remove();
    const line = entry.t;
    const div = document.createElement('div');
    if (/^\[status\]/.test(line)) div.className = 'l-app';
    else if (/^SUMMARY /.test(line)) div.className = /status=OK\b/.test(line) ? 'l-ok' : 'l-err';
    else if (/\berror\b|failed|could not|did not finish|stopped:/i.test(line)) div.className = 'l-err';
    else if (/synced|successfully|is installed|is ready|started|BACKUP_OK|RESTORE_OK/i.test(line)) div.className = 'l-ok';
    div.textContent = line.replace(/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d+)?\s*/, '');
    div.title = line;
    nLog.appendChild(div);
    while (nLog.childElementCount > MAX_LINES) nLog.removeChild(nLog.firstChild);
    if ($('nFollow').checked) nLog.scrollTop = nLog.scrollHeight;
  }
  $('nClear').onclick = () => { nLog.textContent = ''; showPlaceholder(); };
  $('nCopy').onclick = async () => {
    await window.safex.copyText([...nLog.children].filter((c) => !c.classList.contains('placeholder')).map((c) => c.title || c.textContent).join('\n'));
    const b = $('nCopy'); const t = b.textContent; b.textContent = 'Copied'; setTimeout(() => (b.textContent = t), 1200);
  };

  function applyRefresh(p) {
    panel = p; renderNodePanel();
    (p.log || []).forEach(addNodeLog);      // replay anything printed before we were ready
    renderMaint();
  }

  // ---- maintenance ----------------------------------------------------------
  let maintInfo = null;
  async function loadMaint() { try { maintInfo = await window.safex.maintOverview(); } catch (_) { maintInfo = null; } renderMaint(); }
  function renderMaint() {
    if (!panel) return;
    const d = panel.docker, busy = !!panel.busy;
    const stopped = d.engine === 'ok' && d.container !== 'running' && d.container !== 'restarting';
    const haveImage = d.image;
    let info;
    if (d.engine !== 'ok') info = 'Docker is not ready yet. Set it up above first.';
    else if (!stopped) info = 'Stop the node to use these. They work on the chain data while the node is not running.';
    else if (!haveImage) info = 'Build the node image first (press Start node once, or Rebuild image).';
    else info = maintInfo
      ? `${maintInfo.data ? 'Chain data found' : 'No chain data yet'} · ${maintInfo.backups} backup${maintInfo.backups === 1 ? '' : 's'}${maintInfo.newest ? ' · newest ' + maintInfo.newest.replace('safex-node-backup-', '') : ''}`
      : 'Reading status…';
    $('maintInfo').textContent = info;
    const can = stopped && haveImage && !busy;
    $('mHealth').disabled = !(can && maintInfo && maintInfo.data);
    $('mBackup').disabled = !(can && maintInfo && maintInfo.data);
    $('mRestore').disabled = !(can && maintInfo && maintInfo.backups > 0);
    $('mRebuild').disabled = !(d.engine === 'ok' && !busy);
  }
  async function runMaint(kind) {
    ['mHealth', 'mBackup', 'mRestore', 'mRebuild'].forEach((id) => ($(id).disabled = true));
    $('maintResult').hidden = true;
    if (kind === 'rebuild') await window.safex.nodeAction('rebuild');
    else await window.safex.maintRun(kind);
    await loadMaint();
  }
  $('mHealth').onclick = () => runMaint('health');
  $('mBackup').onclick = () => runMaint('backup');
  $('mRestore').onclick = () => runMaint('restore');
  $('mRebuild').onclick = () => runMaint('rebuild');
  window.safex.onMaintResult((r) => {
    const el = $('maintResult'); let text = '', cls = '';
    if (r.cancelled) { el.hidden = true; return; }
    if (!r.ok) { text = r.error || 'That did not finish.'; cls = 'bad'; }
    else if (r.kind === 'health') {
      if (r.status === 'OK') text = `Chain health: OK. All ${r.blocks.toLocaleString()} blocks are readable.`;
      else if (r.status === 'DAMAGED') { text = `Chain is damaged: first unreadable block ${Number(r.firstBad).toLocaleString()}, ${r.errors.toLocaleString()} bad record(s). Restore a backup, or let the node resync.`; cls = 'bad'; }
      else { text = `Health check finished with status ${r.status}. See the output below.`; cls = 'warn'; }
    }
    else if (r.kind === 'backup') text = `Backup saved: ${r.name}. Start the node again when you are ready.`;
    else if (r.kind === 'restore') text = `Chain restored from ${r.from}. Start the node to resume syncing from there.`;
    el.textContent = text; el.className = 'result ' + cls; el.hidden = false;
  });

  // Decide the one thing the user should do next.
  function nodeNextStep(p) {
    const d = p.docker;
    if (p.busy) return { state: p.busy, hint: 'Please wait. You can watch progress below.', btn: null };
    if (!d.installed) {
      const linux = p.plan.kind === 'linux-apt';
      return { state: 'Docker is not installed', action: 'install-docker',
        btn: linux ? 'Install Docker' : 'Get Docker',
        hint: linux ? 'One click. You will be asked for your password once.' : 'Opens the Docker download page. Install it, then come back.' };
    }
    if (d.engine === 'down') return { state: 'Docker is not running', action: 'start-engine', btn: 'Start Docker',
      hint: 'On Mac or Windows, open the Docker app instead.' };
    if (d.engine === 'no-permission') return { state: 'Docker needs access', action: 'start-engine', btn: 'Fix access',
      hint: 'Asks for your password once to let this app use Docker.' };
    if (d.container === 'running') return { state: 'Node running', action: 'stop', btn: 'Stop node',
      hint: 'Stopping saves the chain safely and can take up to two minutes.' };
    if (d.container === 'restarting') return { state: 'Node is restarting', action: 'stop', btn: 'Stop node', hint: 'It is restarting itself. Check the output below.' };
    return { state: d.container === 'stopped' ? 'Node stopped' : 'Node not set up', action: 'start', btn: 'Start node',
      hint: d.image || d.container === 'stopped' ? 'Starts your node and keeps it running across restarts.' : 'First time: builds the node (a few minutes, about 100 MB), then starts it.' };
  }

  function renderNodePanel() {
    if (!panel) return;
    const step = nodeNextStep(panel);
    $('nodeState').textContent = step.state;
    $('nodeHint').textContent = step.hint;
    const b = $('nodeBtn');
    b.hidden = !step.btn; b.textContent = step.btn || ''; b.dataset.action = step.action || '';
    b.disabled = !step.btn; b.className = 'go small' + (step.action === 'stop' ? ' active' : '');
    const running = panel.docker.container === 'running';
    if (running && node && node.height) {
      $('nHeight').textContent = node.height.toLocaleString();
      $('nTarget').textContent = (node.target || node.height).toLocaleString();
      $('nPeers').textContent = node.peers ?? '—';
      $('nPct').textContent = node.state === 'synced' ? 'Synced' : node.percent.toFixed(1) + '%';
      $('nodeFill').style.width = (node.state === 'synced' ? 100 : node.percent) + '%';
      $('nodeState').textContent = node.state === 'synced' ? 'Node running · synced' : 'Node running · syncing';
    } else {
      ['nHeight', 'nTarget', 'nPeers', 'nPct'].forEach((id) => ($(id).textContent = '—'));
      $('nodeFill').style.width = '0';
    }
  }
  $('nodeBtn').onclick = async () => {
    const a = $('nodeBtn').dataset.action;
    if (!a) return;
    $('nodeBtn').disabled = true;
    await window.safex.nodeAction(a);
  };
  window.safex.onNodePanel((p) => { panel = p; renderNodePanel(); renderMaint(); });
  window.safex.onNodeLog(addNodeLog);
  // keep the node card live when node status arrives
  window.safex.onNode((n) => { node = n; renderNode(); renderNodePanel(); });

  // ---- expected time to a block --------------------------------------------
  let netDiff = null;
  const SS = window.SafexStats;
  function expectedParts(hashrate) {
    const T = SS.expectedBlockSeconds(netDiff, hashrate);
    return { time: SS.fmtDuration(T), sub: T ? `avg · next hour ${SS.fmtPercent(SS.chanceWithin(3600, T))}` : (netDiff ? 'start mining' : 'needs a node') };
  }
  function renderExpected() {
    const solo = settings.mode === 'solo';
    $('expTile').hidden = !solo;     // only meaningful when mining alone, not in a pool
    if (!solo) return;
    const e = expectedParts(running ? stats.hashrate : null);
    $('expTime').textContent = e.time; $('expSub').textContent = e.sub;
  }

  // ---- network hashrate ---------------------------------------------------
  function applyNet(n) {
    netDiff = n.difficulty || null; renderExpected(); if (!$('rigsView').hidden) renderRigs();
    const chip = $('netChip');
    if (!n.hs) { chip.hidden = true; return; }
    chip.hidden = false;
    $('netHs').textContent = fmtHs(n.hs);
    chip.title = n.source === 'public'
      ? 'Estimated from network difficulty, read from the public node (no local node found).'
      : 'Estimated from network difficulty, read from your node.';
  }
  window.safex.onNet(applyNet);
  if (init.net) applyNet(init.net);

  // ---- rigs ---------------------------------------------------------------
  let rigRows = [];
  let selfTs = null;
  const fmtUp = (s) => { if (!s) return '—'; const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };
  const cell = (tr, text, cls) => { const td = document.createElement('td'); td.textContent = text; if (cls) td.className = cls; tr.appendChild(td); return td; };
  // ✓ green = answering and hashing, ✗ red = down, ! amber = answering but not hashing / needs attention
  const MARK = { ok: ['✓', 'Mining'], bad: ['✗', 'Not responding'], warn: ['!', 'Needs a look'] };
  function nameCell(tr, name, line, mark) {
    const td = document.createElement('td');
    const a = document.createElement('div'); a.className = 'rname';
    if (mark) { const m = document.createElement('span'); m.className = 'mark mark-' + mark; m.textContent = MARK[mark][0]; m.title = MARK[mark][1]; a.appendChild(m); }
    a.appendChild(document.createTextNode(name)); td.appendChild(a);
    if (line) { const b = document.createElement('div'); b.className = 'tsline ts-' + line.level; b.textContent = line.text; td.appendChild(b); }
    tr.appendChild(td);
  }
  function pill(td, text, cls) { const sp = document.createElement('span'); sp.className = 'pill ' + cls; sp.textContent = text; td.appendChild(sp); }

  // Tab bubbles: red glow on Rigs when a rig is offline or hung; green glow on Payments for a new block.
  const rigProblems = (rows) => rows.filter((r) => !r.online || r.hung).length;
  function setRigBadge(n) {
    const b = $('bubRigs'); b.hidden = n === 0; b.title = n ? `${n} rig${n === 1 ? '' : 's'} offline or hung` : '';
    $('tabBtnRigs').classList.toggle('alert', n > 0);
  }
  let selfAvg = null;
  const avgCells = (tr, a) => { for (const k of ['h1', 'h6', 'h24']) cell(tr, a && a[k] ? fmtHs(a[k]) : '—', 'num'); };
  function renderRigs() {
    const body = $('rigBody'); body.textContent = '';
    // this machine
    const me = document.createElement('tr'); me.className = 'me';
    nameCell(me, 'This machine', selfTs, running && stats.connected ? 'ok' : running ? 'warn' : 'bad'); const st = cell(me, ''); pill(st, running ? (stats.connected ? 'mining' : 'connecting') : 'stopped', running && stats.connected ? 'on' : 'warn');
    { const c = cell(me, running ? fmtHs(stats.hashrate) : '—', 'num'); if (stats.threads) c.title = `${stats.threads} threads`; }
    avgCells(me, selfAvg);
    cell(me, `${stats.accepted || 0} / ${stats.rejected || 0}`, 'num'); cell(me, '—'); cell(me, '');
    body.appendChild(me);
    let hs = running ? (stats.hashrate || 0) : 0, acc = running ? (stats.accepted || 0) : 0, rej = running ? (stats.rejected || 0) : 0, online = running && stats.connected ? 1 : 0;
    rigRows.forEach((r, i) => {
      const tr = document.createElement('tr');
      const mk = (!r.online || r.hung) ? 'bad' : (r.otherWallet || !(r.hashrate > 0)) ? 'warn' : 'ok';
      nameCell(tr, r.name, r.ts, mk);
      const td = cell(tr, '');
      if (!r.online) pill(td, r.reason === 'auth' ? 'wrong token' : 'offline', 'off');
      else if (r.hung) pill(td, 'hung', 'off');
      else if (r.otherWallet) pill(td, 'other wallet', 'warn');
      else pill(td, 'mining', 'on');
      { const c = cell(tr, r.online ? fmtHs(r.hashrate) : '—', 'num'); const tip = []; if (r.threads) tip.push(`${r.threads} threads`); if (r.hashesTotal) tip.push(`${r.hashesTotal.toLocaleString()} hashes this run`); if (tip.length) c.title = tip.join(' · '); }
      avgCells(tr, r.avg);
      cell(tr, r.online ? `${r.accepted} / ${r.rejected}` : '—', 'num'); cell(tr, r.online ? fmtUp(r.uptime) : '—');
      const x = cell(tr, ''); const b = document.createElement('button'); b.className = 'mini'; b.textContent = 'Remove';
      b.onclick = async () => { settings = await window.safex.setSettings({ rigs: settings.rigs.filter((_, j) => j !== i) }); };
      x.appendChild(b); body.appendChild(tr);
      if (r.online && !r.otherWallet) { hs += r.hashrate || 0; acc += r.accepted; rej += r.rejected; online += 1; }
    });
    setRigBadge(rigProblems(rigRows));
    { const e = expectedParts(hs || null); $('cExp').textContent = e.time; $('cExpSub').textContent = e.sub; }
    $('cHs').textContent = fmtHs(hs || null); $('cOnline').textContent = `${online} of ${rigRows.length + 1}`; $('cShares').textContent = `${acc} / ${rej}`;
    $('shareStats').checked = settings.shareStats;
    $('shareInfo').hidden = !settings.shareStats;
    if (settings.shareStats) { $('myAddr').value = `${init.lanAddress || 'this-machine'}:${settings.apiPort}`; $('myToken').value = settings.apiToken; }
  }
  window.safex.onRigs((p) => { rigRows = p.rows || []; selfTs = p.self || null; selfAvg = p.selfAvg || null; setRigBadge(rigProblems(rigRows)); if (!$('rigsView').hidden) renderRigs(); });

  $('rAdd').onclick = async () => {
    const err = $('rErr'); err.hidden = true;
    const m = /^([A-Za-z0-9.\-]+):(\d{2,5})$/.exec($('rHost').value.trim());
    if (!m) { err.textContent = 'Address should look like 100.101.102.103:18080'; err.hidden = false; return; }
    const rig = { name: $('rName').value.trim() || m[1], host: m[1], port: parseInt(m[2], 10), token: $('rToken').value.trim() };
    if (settings.rigs.some((r) => r.host === rig.host && r.port === rig.port)) { err.textContent = 'That miner is already in the list.'; err.hidden = false; return; }
    settings = await window.safex.setSettings({ rigs: [...settings.rigs, rig] });
    $('rName').value = ''; $('rHost').value = ''; $('rToken').value = '';
  };
  $('shareStats').addEventListener('change', async () => {
    settings = await window.safex.setSettings({ shareStats: $('shareStats').checked }); renderRigs();
  });
  $('copyShare').onclick = async () => {
    await window.safex.copyText(`${$('myAddr').value}  token: ${$('myToken').value}`);
    const b = $('copyShare'); const t = b.textContent; b.textContent = 'Copied'; setTimeout(() => (b.textContent = t), 1200);
  };
  // re-render the rigs table when our own stats change
  const _origStats = window.safex.onStats;
  window.safex.onStats(() => { if (!$('rigsView').hidden) renderRigs(); });

  // ---- payments -----------------------------------------------------------
  function setPayBubble(on) { $('bubPay').hidden = !on; $('tabBtnPay').classList.toggle('glow', on); }
  const fmtSfx = (v) => (v >= 100 ? v.toFixed(2) : v.toFixed(4)).replace(/\.?0+$/, '') + ' SFX';
  const fmtWhen = (t) => new Date(t * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  let payNote = '';
  function renderPay(p) {
    p = p || { state: 'off' };
    const msgs = { off: 'Enter the address of your local wallet tool to start the tally.',
      offline: 'Can\'t reach the wallet tool yet. It may still be starting, or waiting for your node.',
      notwallet: 'That address answered, but it is not a wallet tool. 127.0.0.1:17402 is your NODE. The wallet tool is 127.0.0.1:18082.',
      login: 'The wallet tool wants a login. Start it with --disable-rpc-login (local only).',
      error: 'The wallet tool answered with an error: ' + (p.error || ''), ok: 'Connected. Updates every 30 s.' };
    $('pState').textContent = payNote || msgs[p.state] || '';
    const ok = p.state === 'ok';
    $('pTotal').textContent = ok ? fmtSfx(p.sfx) : '—';
    $('pSince').textContent = p.managed ? (p.scanFrom ? `since block ${p.scanFrom.toLocaleString()}` : 'all your wallet has found') : p.miningSince ? 'since ' + fmtWhen(p.miningSince) : 'since you started mining';
    if (ok) {
      payCount = p.count; renderStats();
      if (settings.walletSeen < 0) settings = { ...settings, walletSeen: p.count }, window.safex.setSettings({ walletSeen: p.count });   // first connect: nothing is "new" yet
      else if (p.count > settings.walletSeen) { if ($('payView').hidden) setPayBubble(true); else { settings.walletSeen = p.count; window.safex.setSettings({ walletSeen: p.count }); } }
    }
    $('pCount').textContent = ok ? String(p.count) : '0';
    $('pLatest').textContent = ok && p.latest ? `latest ${fmtWhen(p.latest)}` : '';
    $('pDay').textContent = ok ? fmtSfx(p.last24.sfx) : '—';
    $('pDayN').textContent = ok ? `${p.last24.count} payment${p.last24.count === 1 ? '' : 's'} in the last 24 h` : '';
    const body = $('pBody'); body.textContent = '';
    for (const r of ok ? p.recent : []) {
      const tr = document.createElement('tr');
      cell(tr, fmtWhen(r.time)); cell(tr, r.height ? String(r.height) : '—', 'num'); cell(tr, fmtSfx(r.sfx), 'num'); cell(tr, r.type === 'block' ? 'Mined' : 'Received'); cell(tr, String(r.confirmations), 'num');
      body.appendChild(tr);
    }
  }
  window.safex.onWallet((p) => { renderPay(p); });
  $('pSave').onclick = async () => {
    const v = $('pAddr').value.trim();
    settings = await window.safex.setSettings({ walletRpc: v });
    payNote = v && settings.walletRpc !== v ? 'The wallet tool must be on this computer, like 127.0.0.1:18082.' : '';
    if (payNote) $('pState').textContent = payNote;
  };

  // ---- 24 h charts (inline SVG, no libraries) -----------------------------
  const NS = 'http://www.w3.org/2000/svg';
  function drawArea(svg, vals, fmt, endLabels) {
    const W = 420, H = 110, padL = 4, padB = 16; svg.textContent = '';
    const mk = (n, a) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); svg.appendChild(e); return e; };
    const real = vals.filter((v) => v != null); const max = real.length ? Math.max(...real) : 0;
    if (!max) { const t = mk('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'chart-empty' }); t.textContent = 'nothing recorded yet'; return; }
    const n = vals.length, x = (i) => padL + (n === 1 ? 0 : i / (n - 1)) * (W - padL * 2), y = (v) => 6 + (1 - v / max) * (H - padB - 10);
    let d = '', started = false, line = '';
    vals.forEach((v, i) => { const yy = v == null ? y(0) : y(v); line += (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + yy.toFixed(1); });
    mk('path', { d: line + `L${x(n - 1)} ${H - padB}L${x(0)} ${H - padB}Z`, class: 'chart-fill' });
    mk('path', { d: line, class: 'chart-line', fill: 'none' });
    mk('line', { x1: padL, x2: W - padL, y1: H - padB, y2: H - padB, class: 'chart-axis' });
    const tm = mk('text', { x: padL + 2, y: 12, class: 'chart-label' }); tm.textContent = 'peak ' + fmt(max);
    const a = mk('text', { x: padL, y: H - 3, class: 'chart-label' }); a.textContent = endLabels[0];
    const b = mk('text', { x: W - padL, y: H - 3, 'text-anchor': 'end', class: 'chart-label' }); b.textContent = endLabels[1];
  }
  function drawCharts() {
    window.safex.chartDay().then((c) => {
      drawArea($('chHash'), c.hash, fmtHs, ['24 h ago', 'now']);
      drawArea($('chPay'), c.paysKnown ? c.pay : [], fmtSfx, ['24 h ago', 'now']);
    });
  }
  setInterval(() => { if (!$('payView').hidden) drawCharts(); }, 30000);

  // ---- wallet setup (view-only, official wallet tools) -----------------------
  let ws = null; const wsLog = $('wsLog');
  function renderWs() {
    if (!ws) return;
    const st = $('wsState');
    $('manualWallet').hidden = ws.supported;
    $('wsRemove').hidden = !ws.wallet || $('payView').hidden; $('wsPanel').classList.toggle('done', !!ws.wallet); if (ws.wallet) wsLog.hidden = true;
    $('wsDl').disabled = ws.busy || ws.tools || !ws.supported;
    $('wsDl').textContent = ws.tools ? '1. Wallet tools ready ✓' : ws.busy ? 'Downloading…' : '1. Download wallet tools';
    $('wsAdd').disabled = !ws.tools || ws.wallet || !ws.terminal;
    $('wsAdd').textContent = ws.wallet ? '2. Wallet added ✓' : '2. Add my wallet';
    if (!$('wsHeight').value && ws.nodeHeight) $('wsHeight').placeholder = 'e.g. ' + Math.max(0, ws.nodeHeight - 5000);
    let msg;
    if (!ws.supported) msg = 'The one-click wallet tools are Linux-only for now. On this system, run the official safex-wallet-rpc yourself and enter its address below.';
    else if (!ws.tools) msg = 'Step 1: download the official wallet tools (checked against the release checksums).';
    else if (!ws.wallet) msg = ws.terminal ? 'Step 2: click "Add my wallet". A window opens; paste your address, then your private view key, there. "Scan from block" is where to start looking for payments (about when you started mining; earlier is safe but slower).' : 'No terminal program was found to open the wallet tool window.';
    else msg = ws.running ? 'Wallet tool is running and reading your node. It will catch up with the chain first, so the tally can lag until it has scanned.' : 'Wallet is set up. The wallet tool starts once your node answers.';
    st.textContent = msg;
  }
  const loadDay = () => window.safex.statsDay().then((d) => {
    $('hDay').textContent = d.avg ? fmtHs(d.avg) : '—';
    const h = d.minutes / 60; $('hDayN').textContent = d.avg ? `mining ${h >= 10 ? Math.round(h) : h.toFixed(1)} h of 24` : 'no mining recorded yet';
  });
  const loadWs = () => window.safex.wsStatus().then((x) => { ws = x; renderWs(); });
  window.safex.onWsLog((l) => { wsLog.hidden = false; wsLog.textContent += l + '\n'; wsLog.scrollTop = wsLog.scrollHeight; });
  $('wsDl').onclick = async () => {
    wsLog.textContent = ''; ws.busy = true; renderWs();
    const r = await window.safex.wsDownload();
    if (!r.ok) { wsLog.hidden = false; wsLog.textContent += 'Stopped: ' + r.error + '\n'; }
    loadWs();
  };
  $('wsAdd').onclick = async () => {
    const h = $('wsHeight').value.trim();
    if (h && !/^\d{1,9}$/.test(h)) { $('wsState').textContent = 'Scan-from block should be a number.'; return; }
    const r = await window.safex.wsAdd({ height: h ? parseInt(h, 10) : Math.max(0, (ws.nodeHeight || 0) - 5000) });
    $('wsState').textContent = r.ok ? 'The wallet window is open. Paste your address, then your private view key, there. This page updates when it is done.' : r.error;
  };
  $('wsRemove').onclick = async () => { await window.safex.wsRemove(); loadWs(); };
  setInterval(() => { if (!$('payView').hidden) { loadWs(); loadDay(); } }, 3000);

  fillForm();
  renderStats();
  window.safex.nodeRefresh().then(applyRefresh);
  showPlaceholder();
})();
