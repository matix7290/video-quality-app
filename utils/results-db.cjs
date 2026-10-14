const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const Database = require('better-sqlite3');

const RESULT_TABLES = new Set(['users', 'ratings', 'control_answers', 'screentests']);

async function streamResultsDatabase(db, res) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'video-results-'));
  const filename = path.join(directory, 'study-results.sqlite');
  try {
    await db.backup(filename);
    const copy = new Database(filename);
    try {
      copy.pragma('journal_mode = DELETE');
      copy.pragma('foreign_keys = OFF');
      const objects = copy.prepare("SELECT type, name FROM sqlite_master WHERE type IN ('table', 'view') ORDER BY CASE WHEN type = 'view' THEN 0 ELSE 1 END").all();
      for (const { type, name } of objects) {
        if (name.startsWith('sqlite_') || (type === 'table' && RESULT_TABLES.has(name))) continue;
        copy.exec(`DROP ${type.toUpperCase()} "${name.replaceAll('"', '""')}"`);
      }
      // Rebuild the file so removed administrator rows cannot remain in free pages.
      copy.exec('VACUUM');
    } finally { copy.close(); }
    res.setHeader('Content-Type', 'application/vnd.sqlite3');
    res.setHeader('Content-Disposition', 'attachment; filename="study-results.sqlite"');
    res.setHeader('Content-Length', fs.statSync(filename).size);
    await pipeline(fs.createReadStream(filename), res);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

module.exports = { streamResultsDatabase };
