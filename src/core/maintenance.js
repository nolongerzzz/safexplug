'use strict';
// Chain-data maintenance for the node: health check, backup, restore.
// Everything runs in short-lived containers against the node's real data
// volume, and only while the node is stopped.
const D = require('./docker');

const MAINT = 'safex-maint';
const BACKUP_PREFIX = 'safex-node-backup';
const DB_DIR = '/data/lmdb';

// Same proven scripts as the original Safex Node app.
const BACKUP_SCRIPT = 'touch /to/.INCOMPLETE && cp -a /from/. /to/ && sync && a=$(stat -c %s /from/lmdb/data.mdb) && b=$(stat -c %s /to/lmdb/data.mdb) && echo "Copied data.mdb: $a bytes -> $b bytes" && [ "$a" = "$b" ] && rm -f /to/.INCOMPLETE && echo BACKUP_OK';
const RESTORE_SCRIPT = 'test -f /from/lmdb/data.mdb && find /to -mindepth 1 -delete && cp -a /from/. /to/ && sync && a=$(stat -c %s /from/lmdb/data.mdb) && b=$(stat -c %s /to/lmdb/data.mdb) && echo "Restored data.mdb: $a bytes -> $b bytes" && [ "$a" = "$b" ] && echo RESTORE_OK';
const PROBE_SCRIPT = 'test -f /data/lmdb/data.mdb || { echo NO_DATA; exit 0; }; used=$(du -sk /data | cut -f1); avail=$(df -Pk /data | awk \'NR==2 {print $4}\'); echo "$used $avail"';

const ts = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

// Which volume (or folder) does the node really store its chain in?
// Read it from the container; fall back to the default name for a fresh setup.
async function dataSource() {
  const r = await D.run(['inspect', D.CONTAINER, '--format', '{{json .Mounts}}']);
  if (r.ok) {
    try {
      const m = JSON.parse(r.out).find((x) => x.Destination === '/data');
      if (m) return m.Type === 'volume' ? { kind: 'volume', ref: m.Name } : { kind: 'bind', ref: m.Source };
    } catch (_) { /* fall through */ }
  }
  return { kind: 'volume', ref: D.VOLUME };
}

// Never mount a volume that doesn't exist yet: docker would silently create an
// empty one and every check would then report "no chain data".
async function dataExists(src) {
  if (src.kind === 'bind') return true;
  return (await D.run(['volume', 'inspect', src.ref])).ok;
}

const mountArg = (src, dest, mode) => `${src.ref}:${dest}${mode ? ':' + mode : ''}`;

async function backupIsValid(name) {
  const r = await D.run(['run', '--rm', '--entrypoint', 'sh', '-v', `${name}:/from:ro`, D.IMAGE, '-c',
    'test -f /from/lmdb/data.mdb && test ! -e /from/.INCOMPLETE']);
  return r.ok;
}

async function validBackups() {
  const r = await D.run(['volume', 'ls', '--format', '{{.Name}}', '--filter', `name=${BACKUP_PREFIX}`]);
  if (!r.ok) return [];
  const names = r.out.split('\n').map((x) => x.trim()).filter((x) => x.startsWith(BACKUP_PREFIX)).sort();
  const good = [];
  for (const n of names) if (await backupIsValid(n)) good.push(n);
  return good;
}

async function overview() {
  const src = await dataSource();
  const [has, backups] = await Promise.all([dataExists(src), validBackups()]);
  return { data: has, source: src.ref, backups: backups.length, newest: backups[backups.length - 1] || null };
}

// Run a docker command, streaming lines to emit(); resolves {ok, lines}.
function stream(args, emit) {
  return new Promise((resolve) => {
    const st = new D.Streamer(args); const lines = [];
    st.on('line', (l) => { lines.push(l); emit(l); });
    st.on('exit', (code) => resolve({ ok: code === 0, lines }));
  });
}

async function guard(emit, { needBackup = false } = {}) {
  const s = await D.status();
  if (s.engine !== 'ok') return 'Docker is not ready.';
  if (s.container === 'running' || s.container === 'restarting') return 'Stop the node first. Maintenance works on the chain data while the node is not running.';
  if (!s.image) return 'Build the node image first (press Start node once, or Rebuild node image).';
  if (needBackup && !(await validBackups()).length) return 'Make a backup first.';
  await D.run(['rm', '-f', MAINT]); // leftover from an interrupted task
  return null;
}

// ---- health check (read only) ----------------------------------------------
async function health(emit) {
  const bad = await guard(emit); if (bad) return { ok: false, error: bad };
  const src = await dataSource();
  if (!(await dataExists(src))) return { ok: false, error: 'No chain data found yet. Start the node once so it can create it.' };
  emit('Checking the node image has the health-check tool…');
  const pre = await D.run(['run', '--rm', '--entrypoint', 'sh', D.IMAGE, '-c', 'command -v python3 >/dev/null 2>&1 && test -f /opt/safex/diagnose-chain-db.py']);
  if (!pre.ok) return { ok: false, imageOld: true, error: 'This node image was made before the health check existed. Press "Rebuild image" (needs internet, your chain is not touched), then run the check again.' };
  emit('Reading every block record (read-only). This takes a minute or two…');
  const r = await stream(['run', '--rm', '--name', MAINT, '--entrypoint', 'python3', '-v', mountArg(src, '/data', 'ro'), D.IMAGE, '/opt/safex/diagnose-chain-db.py', DB_DIR], emit);
  const line = r.lines.reverse().find((l) => l.startsWith('SUMMARY '));
  if (!line) return { ok: false, error: 'The scan stopped before finishing. That can itself be a sign of severe damage. See the output above.' };
  const kv = Object.fromEntries(line.slice(8).split(' ').map((p) => p.split('=')));
  return { ok: true, status: kv.status, blocks: Number(kv.blocks) || 0, readable: Number(kv.readable) || 0, missing: Number(kv.missing) || 0, errors: Number(kv.errors) || 0, firstBad: kv.first_bad };
}

// ---- backup ------------------------------------------------------------------
async function backup(emit) {
  const bad = await guard(emit); if (bad) return { ok: false, error: bad };
  const src = await dataSource();
  if (!(await dataExists(src))) return { ok: false, error: 'No chain data found yet.' };
  emit('Checking there is chain data and enough free space…');
  const probe = await D.run(['run', '--rm', '--entrypoint', 'sh', '-v', mountArg(src, '/data', 'ro'), D.IMAGE, '-c', PROBE_SCRIPT]);
  if (!probe.ok) return { ok: false, error: probe.err || 'Could not read the chain data.' };
  if (probe.out.trim() === 'NO_DATA') return { ok: false, error: 'There is no chain data to back up yet.' };
  const [used, avail] = probe.out.split(/\s+/).map(Number);
  if (!Number.isFinite(used) || !Number.isFinite(avail)) return { ok: false, error: 'Could not work out free disk space.' };
  emit(`Chain data: ${Math.round(used / 1024).toLocaleString()} MB. Free in Docker's disk: ${Math.round(avail / 1024).toLocaleString()} MB.`);
  if (avail < used + used / 10) return { ok: false, error: 'Not enough free space for another full copy. Free up space (for example an old backup) and try again.' };
  // Never reuse a name: cleaning up a failed backup must not be able to touch a good one.
  let name = `${BACKUP_PREFIX}-${ts()}`;
  for (let i = 2; (await D.run(['volume', 'inspect', name])).ok && i < 50; i++) name = `${BACKUP_PREFIX}-${ts()}-${i}`;
  emit(`Creating backup volume ${name}…`);
  const mk = await D.run(['volume', 'create', name]);
  if (!mk.ok) return { ok: false, error: mk.err };
  emit('Copying the chain. This can take several minutes and prints little until it finishes…');
  const r = await stream(['run', '--rm', '--name', MAINT, '--entrypoint', 'sh', '-v', mountArg(src, '/from', 'ro'), '-v', `${name}:/to`, D.IMAGE, '-c', BACKUP_SCRIPT], emit);
  if (r.ok && r.lines.some((l) => l.trim() === 'BACKUP_OK')) return { ok: true, name };
  emit('The backup did not complete. Removing the partial copy. Your chain data was not touched.');
  await D.run(['volume', 'rm', '-f', name]);
  return { ok: false, error: 'The backup did not complete. Your chain data was not touched.' };
}

// ---- restore -----------------------------------------------------------------
async function restore(emit) {
  const bad = await guard(emit, { needBackup: true }); if (bad) return { ok: false, error: bad };
  const src = await dataSource();
  const newest = (await validBackups()).pop();
  if (!newest) return { ok: false, error: 'No complete backup was found.' };
  emit(`Restoring from ${newest}. The current chain data is being replaced…`);
  const r = await stream(['run', '--rm', '--name', MAINT, '--entrypoint', 'sh', '-v', `${newest}:/from:ro`, '-v', mountArg(src, '/to'), D.IMAGE, '-c', RESTORE_SCRIPT], emit);
  if (r.ok && r.lines.some((l) => l.trim() === 'RESTORE_OK')) return { ok: true, from: newest };
  emit('The restore did not finish. Your backup is untouched. Run Restore again.');
  return { ok: false, error: 'The restore did not finish. Your backup is untouched. Run Restore again.' };
}

module.exports = { overview, health, backup, restore, dataSource, validBackups,
  BACKUP_SCRIPT, RESTORE_SCRIPT, PROBE_SCRIPT, MAINT, BACKUP_PREFIX };
