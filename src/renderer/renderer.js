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
    const node = name === 'node';
    $('mineView').hidden = node; $('nodeView').hidden = !node;
    $('tabBtnMine').className = node ? '' : 'sel'; $('tabBtnNode').className = node ? 'sel' : '';
    if (node) window.safex.nodeRefresh().then((p) => { panel = p; renderNodePanel(); });
  }
  $('tabBtnMine').onclick = () => showTab('mine');
  $('tabBtnNode').onclick = () => showTab('node');

  // ---- node panel ---------------------------------------------------------
  let panel = null;
  const nLog = $('nLog');
  function addNodeLog(line) {
    const div = document.createElement('div');
    if (/error|failed|could not|did not finish/i.test(line)) div.className = 'l-err';
    else if (/synced|successfully|is installed|is ready|started/i.test(line)) div.className = 'l-ok';
    div.textContent = line.replace(/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d+)?\s*/, '');
    div.title = line;
    nLog.appendChild(div);
    while (nLog.childElementCount > MAX_LINES) nLog.removeChild(nLog.firstChild);
    if ($('nFollow').checked) nLog.scrollTop = nLog.scrollHeight;
  }
  $('nClear').onclick = () => { nLog.textContent = ''; };
  $('nCopy').onclick = async () => {
    await window.safex.copyText([...nLog.children].map((c) => c.title || c.textContent).join('\n'));
    const b = $('nCopy'); const t = b.textContent; b.textContent = 'Copied'; setTimeout(() => (b.textContent = t), 1200);
  };

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
  window.safex.onNodePanel((p) => { panel = p; renderNodePanel(); });
  window.safex.onNodeLog(addNodeLog);
  // keep the node card live when node status arrives
  window.safex.onNode((n) => { node = n; renderNode(); renderNodePanel(); });

  fillForm();
  renderStats();
  window.safex.nodeRefresh().then((p) => { panel = p; renderNodePanel(); });
})();
