'use strict';
// Pure functions: turn xmrig output lines into structured events.
// No Electron / Node APIs here so they can be unit tested on their own.

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;

function stripAnsi(s) {
  return String(s).replace(ANSI, '');
}

function num(s) {
  if (s === undefined || s === null || s === 'n/a') return null;
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : null;
}

// "speed 10s/60s/15m 6320.1 6301.4 n/a H/s max 6400.2 H/s"
const SPEED = /speed\s+10s\/60s\/15m\s+(\S+)\s+(\S+)\s+(\S+)\s+(k?H\/s)(?:\s+max\s+(\S+)\s+(k?H\/s))?/i;
// "accepted (12/1) diff 120000 (81 ms)"
const SHARES = /(?:accepted|rejected)\s+\((\d+)\/(\d+)\)/i;
// daemon / solo mode: "BLOCK FOUND", "block found", "found block"
const BLOCK = /block\s+found|found\s+block|new\s+block\s+found/i;
// "new job from 127.0.0.1:17402 diff 12345 algo rx/sfx height 2097366"
const JOB = /new job from\s+(\S+)\s+diff\s+(\S+)\s+algo\s+(\S+)(?:\s+height\s+(\d+))?/i;
const CONNECT_ERR = /connect error|connection refused|couldn't resolve|timed out|socket closed/i;
const USE_POOL = /use (?:pool|daemon)\s+(\S+)/i;
const CPU = /cpu\s+use profile\s+(\S+)\s+\((\d+)\s+threads?\)/i;
const HUGEPAGES = /huge pages\s+(\d+)%/i;
const MSR_FAIL = /failed to apply msr mod/i;
const MSR_OK = /msr\s+register values for .* has been set successfully/i;

function toHs(value, unit) {
  if (value === null) return null;
  return /^k/i.test(unit) ? value * 1000 : value;
}

// Parse one line. Returns an array of events (usually 0 or 1).
function parseLine(raw) {
  const line = stripAnsi(raw).trim();
  if (!line) return [];
  const events = [];

  let m = SPEED.exec(line);
  if (m) {
    const unit = m[4];
    events.push({
      type: 'hashrate',
      h10: toHs(num(m[1]), unit),
      h60: toHs(num(m[2]), unit),
      h15m: toHs(num(m[3]), unit),
      max: m[5] ? toHs(num(m[5]), m[6]) : null,
    });
  }

  m = SHARES.exec(line);
  if (m) {
    events.push({
      type: 'shares',
      accepted: parseInt(m[1], 10),
      rejected: parseInt(m[2], 10),
    });
  }

  if (BLOCK.test(line)) events.push({ type: 'block-found' });

  m = JOB.exec(line);
  if (m) {
    events.push({
      type: 'job',
      from: m[1],
      algo: m[3],
      height: m[4] ? parseInt(m[4], 10) : null,
    });
  }

  m = CPU.exec(line);
  if (m) events.push({ type: 'threads', profile: m[1], threads: parseInt(m[2], 10) });

  m = HUGEPAGES.exec(line);
  if (m) events.push({ type: 'hugepages', percent: parseInt(m[1], 10) });

  if (MSR_FAIL.test(line)) events.push({ type: 'msr', ok: false });
  else if (MSR_OK.test(line)) events.push({ type: 'msr', ok: true });

  if (CONNECT_ERR.test(line)) events.push({ type: 'connection-error', message: line });

  m = USE_POOL.exec(line);
  if (m) events.push({ type: 'connected', target: m[1] });

  return events;
}

// xmrig writes chunks, not lines. Buffer until newline.
class LineSplitter {
  constructor(onLine) {
    this.buf = '';
    this.onLine = onLine;
  }
  push(chunk) {
    this.buf += chunk.toString();
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      this.onLine(this.buf.slice(0, i).replace(/\r$/, ''));
      this.buf = this.buf.slice(i + 1);
    }
  }
  flush() {
    if (this.buf) this.onLine(this.buf);
    this.buf = '';
  }
}

function formatHs(v) {
  if (v === null || v === undefined) return '—';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + ' MH/s';
  if (v >= 1e3) return (v / 1e3).toFixed(2) + ' kH/s';
  return v.toFixed(1) + ' H/s';
}

module.exports = { parseLine, LineSplitter, stripAnsi, formatHs };
