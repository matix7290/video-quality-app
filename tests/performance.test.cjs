const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { BlobCache } = require('../utils/blob-cache.cjs');
const configuration = require('../utils/study-config.cjs');
const { readStudy } = require('../utils/study.cjs');
const { Writable } = require('node:stream');
const { streamResultsCsv } = require('../utils/results-csv.cjs');
const { parseCsv } = require('../utils/questions.cjs');
const root = process.cwd();
let directory, db;

before(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'study-performance-'));
  process.chdir(directory);
  fs.mkdirSync('public/videos', { recursive: true });
  fs.mkdirSync('config');
  fs.writeFileSync('public/videos/one.mp4', 'fixture');
  fs.writeFileSync('config/control-questions.csv', 'video_name,question\none.mp4,First?\n');
  const old = new Database('video_quality.db');
  old.exec(`CREATE TABLE ratings (id INTEGER PRIMARY KEY, user_id INTEGER, video_name TEXT,
    clip_name TEXT, rating INTEGER, duration INTEGER, timestamp TEXT DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO ratings (id, user_id, video_name, clip_name, rating, duration)
      VALUES (1, 42, 'legacy.mp4', 'legacy', 3, 1), (2, 42, 'legacy.mp4', 'legacy', 4, 2);`);
  old.close();
  db = require('../database');
});
after(() => { db?.close(); process.chdir(root); fs.rmSync(directory, { recursive: true, force: true }); });

test('WAL migration keeps historical duplicates and prevents new ones; hot queries use indexes', () => {
  assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
  assert.equal(db.pragma('synchronous', { simple: true }), 2);
  assert.equal(db.pragma('busy_timeout', { simple: true }), 1000);
  assert.deepEqual(db.prepare('SELECT rating FROM ratings ORDER BY id').all(), [{ rating: 3 }, { rating: 4 }]);
  const insert = db.prepare("INSERT INTO ratings (user_id, video_name, clip_name, rating, phase) VALUES (42, 'legacy.mp4', 'legacy', 5, ?)");
  assert.throws(() => insert.run('standard'), /Duplicate session stimulus phase/);
  insert.run('slider');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ratings').get().n, 3);
  const ratingPlan = db.prepare('EXPLAIN QUERY PLAN SELECT id FROM ratings WHERE user_id = ? AND video_name = ? AND phase = ?').all(42, 'legacy.mp4', 'slider');
  assert.ok(ratingPlan.some(row => row.detail.includes('idx_ratings_session_phase_video')));
  const allocationPlan = db.prepare(`EXPLAIN QUERY PLAN SELECT COUNT(*) FROM users
    WHERE json_valid(settings_snapshot) AND json_extract(settings_snapshot, '$.version') = ?
      AND json_extract(settings_snapshot, '$.mode') = 'both'
      AND json_extract(settings_snapshot, '$.phaseOrder') = 'balanced'`).all('version');
  assert.ok(allocationPlan.some(row => row.detail.includes('idx_users_balanced_version')));
  // A separate reader can inspect committed data while a writer has an open transaction.
  const reader = new Database('video_quality.db', { readonly: true });
  try {
    db.exec('BEGIN IMMEDIATE');
    assert.equal(reader.prepare('SELECT COUNT(*) AS n FROM ratings').get().n, 3);
  } finally { db.exec('ROLLBACK'); reader.close(); }
});

test('100 warm manifest reads reuse parsing/catalog work, detect file/config changes and isolate callers', () => {
  const first = readStudy();
  let scans = 0, reads = 0;
  const originalScan = fs.readdirSync, originalRead = fs.readFileSync;
  fs.readdirSync = (...args) => { scans++; return originalScan(...args); };
  fs.readFileSync = (...args) => { reads++; return originalRead(...args); };
  try {
    for (let i = 0; i < 100; i++) {
      const manifest = readStudy();
      manifest.questions['one.mp4'][0].question = 'Mutation';
      manifest.settings.texts.pl.welcome = 'Mutation';
      manifest.videos.length = 0;
    }
    assert.equal(scans, 0); assert.equal(reads, 0);
  } finally { fs.readdirSync = originalScan; fs.readFileSync = originalRead; }
  assert.deepEqual(readStudy(), first);
  fs.writeFileSync('config/control-questions.csv', 'video_name,question\none.mp4,Changed?\n');
  const changed = readStudy();
  assert.notEqual(changed.settings.version, first.settings.version);
  assert.equal(changed.questions['one.mp4'][0].question, 'Changed?');
  fs.writeFileSync('public/videos/two.mp4', 'new fixture');
  assert.equal(readStudy().videos.length, 2);
  const settings = { ...configuration.defaults(), selectedVideos: ['one.mp4'], mode: 'slider' };
  configuration.writeConfiguration(settings, 'video_name,question\n');
  assert.equal(readStudy().settings.mode, 'slider');
  const saved = JSON.parse(fs.readFileSync('config/study.json', 'utf8'));
  saved.settings.mode = 'standard';
  fs.writeFileSync('config/study.json', JSON.stringify(saved));
  assert.equal(readStudy().settings.mode, 'standard');
  fs.unlinkSync('public/videos/one.mp4');
  assert.throws(() => readStudy(), /nie jest już dostępny/);
  fs.unlinkSync('config/study.json');
  fs.writeFileSync('config/control-questions.csv', 'video_name,question\n');
  assert.equal(readStudy().videos.length, 1);
});

test('blob cache evicts least recently used URLs by bytes/count and releases each URL once', () => {
  const released = [];
  const cache = new BlobCache(url => released.push(url), 100, 2);
  const value = (blobUrl, size = 40) => ({ blobUrl, size, mime: 'video/mp4' });
  cache.set('a', value('blob:a')); cache.set('b', value('blob:b'));
  cache.get('a'); cache.set('c', value('blob:c'));
  assert.equal(cache.get('b'), undefined);
  assert.deepEqual(released, ['blob:b']);
  cache.set('large', value('blob:large', 150));
  assert.equal(cache.entries.size, 1); assert.equal(cache.bytes, 150);
  assert.ok(cache.get('large'));
  cache.set('small', value('blob:small'));
  cache.delete('small'); cache.delete('small'); cache.clear();
  assert.equal(cache.bytes, 0);
  assert.deepEqual(released.sort(), ['blob:a', 'blob:b', 'blob:c', 'blob:large', 'blob:small'].sort());
});

test('large CSV exports handle slow clients, preserve all rows and allow writes between batches', async () => {
  const id = db.prepare("INSERT INTO users (session_id, auto_fullscreen, client_info, playlist, end_time) VALUES ('export-load', 0, '{}', '[]', CURRENT_TIMESTAMP)").run().lastInsertRowid;
  const insert = db.prepare("INSERT INTO ratings (user_id, video_name, clip_name, rating) VALUES (?, ?, 'test', 4)");
  db.transaction(() => { for (let i = 0; i < 1100; i++) insert.run(id, `clip-${i}.mp4`); })();
  let csv = '', wroteDuringExport = false;
  const response = new Writable({ highWaterMark: 1, write(chunk, encoding, done) {
    csv += chunk.toString();
    setImmediate(() => {
      if (!wroteDuringExport) { insert.run(id, 'later.mp4'); wroteDuringExport = true; }
      done();
    });
  } });
  response.setHeader = () => {};
  await streamResultsCsv(db, 'ratings', true, response);
  const [header, ...rows] = parseCsv(csv);
  assert.equal(rows.length, 1100);
  assert.equal(new Set(rows.map(row => row[header.indexOf('video_name')])).size, 1100);
  assert.ok(wroteDuringExport);
  assert.doesNotMatch(csv, /later\.mp4/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ratings WHERE user_id = ?').get(id).n, 1101);
});
