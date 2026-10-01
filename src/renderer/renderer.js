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
      mode: settings.mode,
    };
  }
  async function save() { settings = await window.safex.setSettings(readForm()); }

  ['address', 'name', 'pool', 'node', 'cpu', 'donate', 'autostart', 'requireSynced'].forEach((id) =>
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
    else if (node.state === 'syncing') {
      t.textContent = `Syncing ${node.percent.toFixed(1)}% · ${node.height.toLocaleString()} / ${node.target.toLocaleString()}`;
      $('syncFill').style.width = node.percent + '%';
    } else if (node.state === 'offline') t.textContent = 'Node not reachable';
    else t.textContent = 'Checking node…';
  }

  // ---- status strip -------------------------------------------------------
  function renderState() {
    const go = $('go');
    let light = 'off', text = 'Stopped';
    if (waiting) { light = 'wait'; text = 'Waiting for node to sync'; }
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
  window.safex.onWaiting((w) => { waiting = w.waiting; renderState(); });
  window.safex.onNode((n) => { node = n; renderNode(); });

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

  fillForm();
  renderStats();
})();
