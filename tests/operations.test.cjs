const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const Database = require('better-sqlite3');
const root = path.resolve(__dirname, '..');

test('production entry point rejects missing/legacy/incomplete credentials before starting a server', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'study-production-check-'));
  const env = { ...process.env, NODE_ENV: 'production' };
  for (const name of ['ADMIN_PASSWORD', 'ADMIN_PASSWORD_HASH', 'ADMIN_SESSION_SECRET']) delete env[name];
  try {
    for (const config of ['', 'ADMIN_PASSWORD=synthetic-test-password\n', 'ADMIN_PASSWORD_HASH=invalid-synthetic-hash\n']) {
      fs.writeFileSync(path.join(directory, '.env.local'), config);
      const result = spawnSync(process.execPath, [path.join(root, 'scripts/start-production.cjs')], { cwd: directory, env, encoding: 'utf8' });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /npm run admin:password/);
      assert.doesNotMatch(result.stderr, /synthetic-test-password|invalid-synthetic-hash|Ready in/);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('online backup includes committed WAL data, passes integrity checks and never overwrites files', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'study-backup-check-'));
  const source = path.join(directory, 'source.db'), destination = path.join(directory, 'backups/copy.db');
  const db = new Database(source);
  try {
    db.pragma('journal_mode = WAL');
    db.exec("CREATE TABLE observations (value TEXT); INSERT INTO observations VALUES ('committed WAL response');");
    assert.ok(fs.statSync(source + '-wal').size > 0);
    const env = { ...process.env, DATABASE_PATH: source };
    const run = output => spawnSync(process.execPath, [path.join(root, 'scripts/backup-db.cjs'), output], { cwd: directory, env, encoding: 'utf8' });
    assert.equal(run(destination).status, 0);
    const restored = new Database(destination, { readonly: true });
    try {
      assert.equal(restored.pragma('integrity_check', { simple: true }), 'ok');
      assert.equal(restored.prepare('SELECT value FROM observations').get().value, 'committed WAL response');
    } finally { restored.close(); }
    if (process.platform !== 'win32') assert.equal(fs.statSync(destination).mode & 0o777, 0o600);
    const original = fs.readFileSync(destination);
    assert.equal(run(destination).status, 1);
    assert.deepEqual(fs.readFileSync(destination), original);
    assert.equal(run(source).status, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM observations').get().n, 1);
  } finally { db.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
