'use strict';
// Read-only view of this machine's Tailscale network, via `tailscale status --json`.
// Used to explain WHY a rig is unreachable (machine off vs miner not answering).
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

function binary() {
  const forced = process.env.SAFEX_TAILSCALE_BIN;
  if (forced) return fs.existsSync(forced) ? forced : null;
  const cands = ['/usr/bin/tailscale', '/usr/local/bin/tailscale', '/opt/homebrew/bin/tailscale',
    '/Applications/Tailscale.app/Contents/MacOS/Tailscale', 'C:\\Program Files\\Tailscale\\tailscale.exe'];
  for (const c of cands) { try { if (fs.statSync(c).isFile()) return c; } catch (_) {} }
  for (const d of String(process.env.PATH || '').split(path.delimiter)) {
    const p = path.join(d, process.platform === 'win32' ? 'tailscale.exe' : 'tailscale');
    try { if (fs.statSync(p).isFile()) return p; } catch (_) {}
  }
  return null;
}

const isV4 = (ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip);
const shortName = (n) => String(n || '').replace(/\.$/, '').split('.')[0].toLowerCase();

function lastSeenMs(iso) {
  if (!iso || /^0001-/.test(iso)) return null;       // Tailscale uses year 1 for "now/unknown"
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function toNode(n) {
  return {
    name: n.HostName || shortName(n.DNSName),
    dns: String(n.DNSName || '').replace(/\.$/, '').toLowerCase(),
    ips: (n.TailscaleIPs || []).filter(isV4),
    online: !!n.Online,
    lastSeen: lastSeenMs(n.LastSeen),
    os: n.OS || '',
  };
}

// Turn the raw JSON into a compact, predictable shape.
function parseStatus(j) {
  const state = j.BackendState || 'Unknown';
  const out = { installed: true, state, running: state === 'Running', self: null, peers: [] };
  if (j.Self) out.self = toNode(j.Self);
  for (const k of Object.keys(j.Peer || {})) out.peers.push(toNode(j.Peer[k]));
  return out;
}

function status() {
  const bin = binary();
  return new Promise((resolve) => {
    if (!bin) return resolve({ installed: false, running: false, state: 'NotInstalled', self: null, peers: [] });
    execFile(bin, ['status', '--json'], { timeout: 6000, maxBuffer: 4 * 1024 * 1024 }, (e, out) => {
      try { return resolve(parseStatus(JSON.parse(String(out || '{}')))); }
      catch (_) { /* fall through */ }
      resolve({ installed: true, running: false, state: e && /permission|access denied/i.test(String(e.message)) ? 'NoAccess' : 'Stopped', self: null, peers: [] });
    });
  });
}

// Find the tailnet machine a rig's host refers to (by 100.x address, or by name).
function matchHost(ts, host) {
  if (!ts || !host) return null;
  const all = [...(ts.self ? [ts.self] : []), ...ts.peers];
  const h = String(host).toLowerCase().replace(/\.$/, '');
  return all.find((n) => n.ips.includes(h) || n.dns === h || n.name.toLowerCase() === h || shortName(n.dns) === h) || null;
}

const isTailscaleAddress = (host) => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/.test(host || '');

// What to tell the user about one rig. `rig` is a poll row from rigs.pollAll.
function describe(ts, rig, now = Date.now()) {
  const onTailnet = isTailscaleAddress(rig.host);
  if (!ts || !ts.installed) return onTailnet ? { level: 'warn', text: 'Tailscale address, but Tailscale is not installed here' } : null;
  if (!ts.running) return onTailnet || matchHost(ts, rig.host) ? { level: 'warn', text: 'Tailscale is not running on this machine' } : null;
  const node = matchHost(ts, rig.host);
  if (!node) return onTailnet ? { level: 'warn', text: 'Tailscale address not found in your network' } : { level: 'dim', text: 'Not on Tailscale (reached directly)' };
  if (node.online) {
    return rig.online
      ? { level: 'ok', text: `Tailscale online · ${node.ips[0] || rig.host}` }
      : { level: 'warn', text: `Machine is online (${node.ips[0] || rig.host}) but the miner is not answering. Is mining started, and "Share stats" on?` };
  }
  const ago = node.lastSeen ? ` · last seen ${ageText(now - node.lastSeen)} ago` : '';
  return { level: 'bad', text: `Machine is offline on Tailscale${ago}` };
}

function ageText(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 2) return 'a minute';
  if (m < 120) return `${m} min`;
  const h = m / 60;
  return h < 48 ? `${h.toFixed(1).replace(/\.0$/, '')} h` : `${Math.round(h / 24)} days`;
}

// A line for this machine itself.
function describeSelf(ts) {
  if (!ts || !ts.installed) return { level: 'dim', text: 'Tailscale not installed' };
  if (!ts.running) return { level: 'warn', text: ts.state === 'NeedsLogin' ? 'Tailscale needs you to log in' : 'Tailscale is not running' };
  return { level: 'ok', text: `Tailscale online · ${(ts.self && ts.self.ips[0]) || ''}`.trim() };
}

module.exports = { status, parseStatus, matchHost, describe, describeSelf, isTailscaleAddress, binary };
