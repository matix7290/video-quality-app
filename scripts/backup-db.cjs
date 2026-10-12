const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');

async function main() {
  require('@next/env').loadEnvConfig(process.cwd(), false);
  if (process.argv.length !== 3) throw new Error('Usage: npm run db:backup -- /absolute/path/to/new-backup.db');
  const destination = path.resolve(process.argv[2]);
  const source = path.resolve(process.env.DATABASE_PATH || 'video_quality.db');
  if (!fs.existsSync(source)) throw new Error('Source database does not exist.');
  if (destination === source || fs.existsSync(destination)) throw new Error('Choose a new backup filename; existing files are never overwritten.');
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = path.join(path.dirname(destination), `.backup-${crypto.randomUUID()}.tmp`);
  fs.closeSync(fs.openSync(temporary, 'wx', 0o600));
  let db;
  try {
    db = new Database(source, { readonly: true, fileMustExist: true });
    await db.backup(temporary);
    const check = new Database(temporary, { readonly: true, fileMustExist: true });
    try {
      if (check.pragma('integrity_check', { simple: true }) !== 'ok') throw new Error('Backup integrity check failed.');
    } finally { check.close(); }
    fs.linkSync(temporary, destination); // Atomic publication without replacing another file.
    console.log(`Database backup saved: ${destination}`);
  } finally {
    db?.close();
    fs.rmSync(temporary, { force: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
