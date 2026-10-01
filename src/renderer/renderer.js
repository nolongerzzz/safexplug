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
  let waiting = false;
  let waitText = '';
  let node = { state: 'unknown' };
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
    chip.className = 'nodechip ' + (node.state || '');
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
  function renderState() {
    const go = $('go');
    let light = 'off', text = 'Stopped';
    if (waiting) { light = 'wait'; text = waitText || 'Waiting for node to sync'; }
    else if (running) {
      if (stats.connected) { light = 'on'; text = 'Mining'; }
      else { light = 'wait'; text = 'Connecting…'; }
    }
    $('light').className = 'light ' + light;
    $('statusText').textContent = text;
    go.textContent = running || waiting ? 'Stop mining' : 'Start mining';
    go.className = 'go' + (running || waiting ? ' active' : '');
    const lock = running || waiting;
    ['address', 'name', 'pool', 'node', 'cpu', 'donate'].forEach((id) => ($(id).disabled = lock));
  }

  function renderStats() {
    $('hashrate').textContent = fmtHs(stats.hashrate);
    $('threads').textContent = stats.threads ?? '—';
    $('shares').textContent = `${stats.accepted || 0} / ${stats.rejected || 0}`;
    $('blocks').textContent = stats.blocks || 0;
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
  window.safex.onStats((s) => { stats = s; renderStats(); });
  window.safex.onState((s) => {
    running = !!s.running;
    if (!running) {
      stats.hashrate = null; stats.connected = false;
      if (s.exit && s.exit.code) addLog(`Miner exited (code ${s.exit.code}).`);
    }
    renderStats();
  });
  window.safex.onWaiting((w) => { waiting = w.waiting; waitText = w.text || ''; renderState(); });

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

  // ---- tabs ---------------------------------------------------------------
  function showTab(name) {
    for (const t of ['mine', 'node', 'rigs']) {
      $(t + 'View').hidden = t !== name;
      $('tabBtn' + t[0].toUpperCase() + t.slice(1)).className = t === name ? 'sel' : '';
    }
    if (name === 'node') { window.safex.nodeRefresh().then(applyRefresh); loadMaint(); }
    if (name === 'rigs') renderRigs();
  }
  $('tabBtnMine').onclick = () => showTab('mine');
  $('tabBtnNode').onclick = () => showTab('node');
  $('tabBtnRigs').onclick = () => showTab('rigs');

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

  // ---- network hashrate ---------------------------------------------------
  window.safex.onNet((n) => {
    const chip = $('netChip');
    if (!n.hs) { chip.hidden = true; return; }
    chip.hidden = false;
    $('netHs').textContent = fmtHs(n.hs);
    chip.title = n.source === 'public'
      ? 'Estimated from network difficulty, read from the public node (no local node found).'
      : 'Estimated from network difficulty, read from your node.';
  });

  // ---- rigs ---------------------------------------------------------------
  let rigRows = [];
  const fmtUp = (s) => { if (!s) return '—'; const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };
  const cell = (tr, text, cls) => { const td = document.createElement('td'); td.textContent = text; if (cls) td.className = cls; tr.appendChild(td); return td; };
  function pill(td, text, cls) { const sp = document.createElement('span'); sp.className = 'pill ' + cls; sp.textContent = text; td.appendChild(sp); }

  function renderRigs() {
    const body = $('rigBody'); body.textContent = '';
    // this machine
    const me = document.createElement('tr'); me.className = 'me';
    cell(me, 'This machine'); const st = cell(me, ''); pill(st, running ? (stats.connected ? 'mining' : 'connecting') : 'stopped', running && stats.connected ? 'on' : 'warn');
    cell(me, running ? fmtHs(stats.hashrate) : '—', 'num'); cell(me, stats.threads ?? '—', 'num');
    cell(me, `${stats.accepted || 0} / ${stats.rejected || 0}`, 'num'); cell(me, '—'); cell(me, '');
    body.appendChild(me);
    let hs = running ? (stats.hashrate || 0) : 0, acc = running ? (stats.accepted || 0) : 0, rej = running ? (stats.rejected || 0) : 0, online = running && stats.connected ? 1 : 0;
    rigRows.forEach((r, i) => {
      const tr = document.createElement('tr');
      cell(tr, r.name);
      const td = cell(tr, '');
      if (!r.online) pill(td, r.reason === 'auth' ? 'wrong token' : 'offline', 'off');
      else if (r.otherWallet) pill(td, 'other wallet', 'warn');
      else pill(td, 'mining', 'on');
      cell(tr, r.online ? fmtHs(r.hashrate) : '—', 'num'); cell(tr, r.online ? (r.threads ?? '—') : '—', 'num');
      cell(tr, r.online ? `${r.accepted} / ${r.rejected}` : '—', 'num'); cell(tr, r.online ? fmtUp(r.uptime) : '—');
      const x = cell(tr, ''); const b = document.createElement('button'); b.className = 'mini'; b.textContent = 'Remove';
      b.onclick = async () => { settings = await window.safex.setSettings({ rigs: settings.rigs.filter((_, j) => j !== i) }); };
      x.appendChild(b); body.appendChild(tr);
      if (r.online && !r.otherWallet) { hs += r.hashrate || 0; acc += r.accepted; rej += r.rejected; online += 1; }
    });
    $('cHs').textContent = fmtHs(hs || null); $('cOnline').textContent = `${online} of ${rigRows.length + 1}`; $('cShares').textContent = `${acc} / ${rej}`;
    $('shareStats').checked = settings.shareStats;
    $('shareInfo').hidden = !settings.shareStats;
    if (settings.shareStats) { $('myAddr').value = `${init.lanAddress || 'this-machine'}:${settings.apiPort}`; $('myToken').value = settings.apiToken; }
  }
  window.safex.onRigs((rows) => { rigRows = rows; if (!$('rigsView').hidden) renderRigs(); });

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

  fillForm();
  renderStats();
  window.safex.nodeRefresh().then(applyRefresh);
  showPlaceholder();
})();
