const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { PassThrough } = require('node:stream');
const { streamResultsCsv } = require('../utils/results-csv.cjs');
const { streamResultsDatabase } = require('../utils/results-db.cjs');
const multer = require('multer');
const { requireAdmin } = require('../utils/admin-auth.cjs');
const { stimulusInfo, validStimulusHeader } = require('../utils/stimuli.cjs');
const root = path.resolve(__dirname, '..');
let directory, db;
function load(file, bindings) {
  const source = fs.readFileSync(path.join(root, 'pages/api', file), 'utf8').replace(/^import .*;\n/gm, '')
    .replace('export default ', '').replace(/^export const config.*$/gm, '');
  return new Function(...Object.keys(bindings), `${source}; return handler;`)(...Object.values(bindings));
}
function response() {
  const stream = new PassThrough();
  stream.on('data', chunk => { stream.body = (stream.body || '') + chunk.toString(); });
  return Object.assign(stream, { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; } });
}
function local() { return { method: 'GET', headers: { host: 'localhost:3000' }, socket: { remoteAddress: '127.0.0.1' }, cookies: {} }; }
before(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'video-admin-api-')); process.chdir(directory); fs.mkdirSync('public/videos', { recursive: true }); });
after(() => { db?.close(); process.chdir(root); fs.rmSync(directory, { recursive: true, force: true }); });
test('video import streams multipart data, rejects non-MP4 content and never overwrites existing files', async () => {
  const upload = load('admin/upload.js', { fs, path, os, multer, requireAdmin, stimulusInfo, validStimulusHeader });
  async function send(filename, content) {
    const req = Object.assign(new PassThrough(), local(), { method: 'POST' });
    const boundary = 'test-video-boundary';
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="${filename}"\r\nContent-Type: video/mp4\r\n\r\n`), content, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    req.headers['content-type'] = `multipart/form-data; boundary=${boundary}`; req.headers['content-length'] = String(body.length);
    const res = response(); const pending = upload(req, res); req.end(body); await pending; return res;
  }
  const mp4 = Buffer.from('\x00\x00\x00\x18ftypisom0000', 'latin1');
  assert.equal((await send('fixture.mp4', mp4)).statusCode, 201);
  assert.deepEqual(fs.readFileSync('public/videos/fixture.mp4'), mp4);
  assert.equal((await send('fixture.mp4', Buffer.from('\x00\x00\x00\x18ftypmp42altered', 'latin1'))).statusCode, 409);
  assert.deepEqual(fs.readFileSync('public/videos/fixture.mp4'), mp4);
  assert.equal((await send('invalid.mp4', Buffer.from('not video content'))).statusCode, 400);
  assert.equal(fs.existsSync('public/videos/invalid.mp4'), false);
  assert.equal((await send('file.txt', mp4)).statusCode, 400);
});
test('video endpoint supports ranges and rejects traversal and invalid ranges', async () => {
  const handler = load('stimuli/[name].js', { fs, path, stimulusInfo });
  async function request(name, range) {
    const req = { method: 'GET', query: { name }, headers: range ? { range } : {} };
    const res = response(); const chunks = [];
    res.on('data', chunk => chunks.push(chunk));
    const done = new Promise(resolve => res.on('end', resolve));
    handler(req, res); await done; return { ...res, data: Buffer.concat(chunks) };
  }
  const result = await request('fixture.mp4', 'bytes=4-7');
  assert.equal(result.statusCode, 206); assert.equal(result.data.toString(), 'ftyp');
  assert.equal(result.headers['Content-Length'], 4);
  assert.equal((await request('fixture.mp4', 'bytes=9999-')).statusCode, 416);
  assert.equal((await request('../fixture.mp4')).statusCode, 404);
  assert.equal((await request('missing.mp4')).statusCode, 404);
});
test('result exports require administrator access and filter completed sessions without changing data', async () => {
  db = require('../database');
  const insert = db.prepare('INSERT INTO users (session_id, auto_fullscreen, client_info, playlist, settings_snapshot, end_time) VALUES (?, 0, ?, ?, ?, ?)');
  const first = insert.run('complete', '{}', '[]', '{"version":"v1"}', '2026-10-07').lastInsertRowid;
  const second = insert.run('incomplete', '{}', '[]', '{"version":"v2"}', null).lastInsertRowid;
  db.prepare('INSERT INTO ratings (user_id, video_name, clip_name, rating, duration) VALUES (?, ?, ?, 4, 1)').run(first, '=danger.mp4', 'clip');
  db.prepare('INSERT INTO ratings (user_id, video_name, clip_name, rating, duration) VALUES (?, ?, ?, 4, 1)').run(second, 'normal.mp4', 'clip');
  const handler = load('admin/results.js', { db, requireAdmin, streamResultsCsv });
  let res = response(); await handler({ ...local(), query: { type: 'ratings', complete: '1' } }, res);
  assert.equal(res.statusCode, 200); assert.match(res.body, /study_version/); assert.match(res.body, /complete/); assert.doesNotMatch(res.body, /incomplete/); assert.match(res.body, /'=danger.mp4/);
  res = response(); await handler({ ...local(), query: {} }, res); assert.deepEqual(res.body, { sessions: 2, completed: 1, ratings: 2, answers: 0 });
  res = response(); await handler({ ...local(), socket: { remoteAddress: '192.0.2.1' }, query: {} }, res); assert.equal(res.statusCode, 401);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ratings').get().n, 2);
});

test('exports identify actual scale positions for slider-first and legacy sessions', async () => {
  const id = db.prepare('INSERT INTO users (session_id, auto_fullscreen, client_info, playlist, settings_snapshot) VALUES (?, 0, ?, ?, ?)')
    .run('reversed', '{}', '[]', JSON.stringify({ version: 'v3', mode: 'both', phaseOrder: 'balanced', phaseSequence: ['slider', 'standard'] })).lastInsertRowid;
  const insert = db.prepare('INSERT INTO ratings (user_id, video_name, clip_name, phase, scale_type, rating, duration) VALUES (?, ?, ?, ?, ?, 4, 1)');
  for (const phase of ['slider', 'standard']) {
    const rating = insert.run(id, 'reversed.mp4', 'clip', phase, phase === 'slider' ? 'continuous' : 'categorical');
    db.prepare('INSERT INTO control_answers (rating_id, question_id, question, answer) VALUES (?, ?, ?, ?)')
      .run(rating.lastInsertRowid, 'q1', 'Powtórzone pytanie?', phase === 'slider' ? 1 : 0);
  }
  const handler = load('admin/results.js', { db, requireAdmin, streamResultsCsv });
  const res = response(); await handler({ ...local(), query: { type: 'ratings' } }, res);
  const { parseCsv } = require('../utils/study.cjs');
  const [header, ...rows] = parseCsv(res.body);
  const field = (row, key) => row[header.indexOf(key)];
  const reversed = rows.filter(row => field(row, 'session_id') === 'reversed');
  assert.deepEqual(reversed.map(row => [field(row, 'phase'), field(row, 'first_phase'), field(row, 'phase_position')]), [['slider', 'slider', '1'], ['standard', 'slider', '2']]);
  assert.equal(field(rows[0], 'first_phase'), 'standard');
  assert.equal(field(rows[0], 'phase_position'), '1');
  const answerResponse = response(); await handler({ ...local(), query: { type: 'answers' } }, answerResponse);
  const [answerHeader, ...answerRows] = parseCsv(answerResponse.body);
  assert.deepEqual(answerRows.map(row => ['question_id', 'phase_position', 'phase', 'scale_type', 'answer'].map(key => row[answerHeader.indexOf(key)])), [
    ['q1', '1', 'slider', 'continuous', '1'], ['q1', '2', 'standard', 'categorical', '0'],
  ]);
});

test('image import accepts JPEG, PNG and WebP, checks content/type, rejects unsupported files and preserves originals', async () => {
  const upload = load('admin/upload.js', { fs, path, os, multer, requireAdmin, stimulusInfo, validStimulusHeader });
  async function send(filename, content, type = 'image') {
    const req = Object.assign(new PassThrough(), local(), { method: 'POST', query: { type } });
    const boundary = 'test-image-boundary';
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="video"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`), content, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    req.headers['content-type'] = `multipart/form-data; boundary=${boundary}`; req.headers['content-length'] = String(body.length);
    const res = response(); const pending = upload(req, res); req.end(body); await pending; return res;
  }
  const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
  const jpeg = Buffer.from('ffd8ffe00000000000000000', 'hex');
  const webp = Buffer.from('RIFF0000WEBP');
  for (const [name, content] of [['image.png', png], ['image.JPG', jpeg], ['image.jpeg', jpeg], ['image.webp', webp]]) {
    assert.equal((await send(name, content)).statusCode, 201);
    assert.deepEqual(fs.readFileSync(path.join('public/images', name)), content);
  }
  assert.equal((await send('image.png', Buffer.concat([png, Buffer.from('altered')]))).statusCode, 409);
  assert.deepEqual(fs.readFileSync('public/images/image.png'), png);
  for (const [name, content, type] of [['wrong.png', jpeg, 'image'], ['fake.jpg', Buffer.from('plain text'), 'image'],
    ['picture.svg', Buffer.from('<svg/>'), 'image'], ['animated.gif', Buffer.from('GIF89a'), 'image'], ['png', png, 'image'],
    ['not-image.mp4', Buffer.from('0000ftyp0000'), 'image'], ['not-video.png', png, 'video']]) {
    assert.equal((await send(name, content, type)).statusCode, 400);
    assert.equal(fs.existsSync(path.join('public/images', name)), false);
  }
});

test('image endpoint serves original bytes with the correct MIME type and rejects path traversal and symlinks', async () => {
  const handler = load('stimuli/[name].js', { fs, path, stimulusInfo });
  async function request(name, method = 'GET') {
    const req = { method, query: { name }, headers: {} };
    const res = response(); const chunks = [];
    res.on('data', chunk => chunks.push(chunk));
    const done = new Promise(resolve => res.on('end', resolve));
    handler(req, res); await done; return { ...res, data: Buffer.concat(chunks) };
  }
  for (const [name, mime] of [['image.png', 'image/png'], ['image.JPG', 'image/jpeg'], ['image.webp', 'image/webp']]) {
    const res = await request(name);
    assert.equal(res.statusCode, 200); assert.equal(res.headers['Content-Type'], mime);
    assert.deepEqual(res.data, fs.readFileSync(path.join('public/images', name)));
    assert.equal((await request(name, 'HEAD')).data.length, 0);
  }
  assert.equal((await request('../images/image.png')).statusCode, 404);
  fs.symlinkSync(path.resolve('public/images/image.png'), 'public/images/link.png');
  assert.equal((await request('link.png')).statusCode, 404);
});

test('rating and answer exports identify image stimuli while preserving historical filename columns', async () => {
  const user = db.prepare("INSERT INTO users (session_id, auto_fullscreen, client_info, playlist, settings_snapshot, end_time) VALUES ('image-export', 0, '{}', '[]', ?, '2026-10-08')")
    .run(JSON.stringify({ mode: 'standard', stimulusType: 'image', version: 'image-v1' })).lastInsertRowid;
  const rating = db.prepare("INSERT INTO ratings (user_id, video_name, clip_name, rating, phase, stimulus_type) VALUES (?, 'photo.png', 'photo', 4, 'standard', 'image')").run(user).lastInsertRowid;
  db.prepare("INSERT INTO control_answers (rating_id, question_id, question, answer) VALUES (?, 'q1', 'Pytanie?', 1)").run(rating);
  const handler = load('admin/results.js', { db, requireAdmin, streamResultsCsv });
  const { parseCsv } = require('../utils/questions.cjs');
  for (const type of ['ratings', 'answers']) {
    const res = response(); await handler({ ...local(), query: { type, complete: '1' } }, res);
    const [header, ...rows] = parseCsv(res.body);
    const row = rows.find(row => row[header.indexOf('session_id')] === 'image-export');
    assert.equal(row[header.indexOf('stimulus_type')], 'image');
    assert.equal(row[header.indexOf('video_name')], 'photo.png');
    assert.equal(row[header.indexOf('phase_position')], '1');
  }
});

test('deleting all results requires admin confirmation and clears participant data only', async () => {
  const handler = load('admin/results.js', { db, requireAdmin, streamResultsCsv });
  fs.mkdirSync('config', { recursive: true });
  fs.writeFileSync('config/study.json', '{"settings":"unchanged"}');
  db.prepare("INSERT INTO screentests (session_id) VALUES ('screen-only')").run();
  db.prepare("INSERT INTO screentests (session_id, user_id) VALUES ('image-export', ?)")
    .run(db.prepare("SELECT id FROM users WHERE session_id = 'image-export'").get().id);
  const before = Object.fromEntries(['users', 'ratings', 'control_answers', 'screentests'].map(table => [table, db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]));
  assert.ok(Object.values(before).every(count => count > 0));

  let res = response();
  await handler({ ...local(), method: 'DELETE', body: { confirmation: 'DELETE_ALL_RESULTS' }, socket: { remoteAddress: '192.0.2.1' } }, res);
  assert.equal(res.statusCode, 401);
  res = response();
  await handler({ ...local(), method: 'DELETE', body: {} }, res);
  assert.equal(res.statusCode, 400);
  for (const [table, count] of Object.entries(before)) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, count);

  res = response();
  await handler({ ...local(), method: 'DELETE', body: { confirmation: 'DELETE_ALL_RESULTS' } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { sessions: 0, completed: 0, ratings: 0, answers: 0 });
  for (const table of Object.keys(before)) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
  assert.equal(fs.readFileSync('config/study.json', 'utf8'), '{"settings":"unchanged"}');
  assert.equal(fs.existsSync('public/videos/fixture.mp4'), true);
});

test('SQLite export contains all result tables and omits administrator tables and their data', async () => {
  const Database = require('better-sqlite3');
  const user = db.prepare("INSERT INTO users (session_id, auto_fullscreen, client_info, playlist) VALUES ('database-export', 0, '{}', '[]')").run().lastInsertRowid;
  const rating = db.prepare("INSERT INTO ratings (user_id, video_name, clip_name, rating) VALUES (?, 'fixture.mp4', 'fixture', 4)").run(user).lastInsertRowid;
  db.prepare("INSERT INTO control_answers (rating_id, question_id, question, answer) VALUES (?, 'q1', 'Test?', 1)").run(rating);
  db.prepare("INSERT INTO screentests (session_id, user_id) VALUES ('database-export', ?)").run(user);
  const secret = 'administrator-secret-marker-12345';
  db.prepare("INSERT INTO admin_webauthn_challenges (token_hash, kind, challenge, origin, rp_id, expires_at) VALUES ('token', 'register', ?, 'http://localhost:3000', 'localhost', 9999999999999)").run(secret);

  const handler = load('admin/results.js', { db, requireAdmin, streamResultsCsv, streamResultsDatabase });
  let res = response();
  await handler({ ...local(), socket: { remoteAddress: '192.0.2.1' }, query: { type: 'database' } }, res);
  assert.equal(res.statusCode, 401);

  res = response();
  const chunks = [];
  res.on('data', chunk => chunks.push(chunk));
  await handler({ ...local(), query: { type: 'database', complete: '1' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'application/vnd.sqlite3');
  assert.match(res.headers['Content-Disposition'], /study-results\.sqlite/);
  const bytes = Buffer.concat(chunks);
  assert.equal(res.headers['Content-Length'], bytes.length);
  assert.equal(bytes.subarray(0, 16).toString(), 'SQLite format 3\u0000');
  assert.equal(bytes.includes(Buffer.from(secret)), false);
  fs.writeFileSync('exported-results.sqlite', bytes);
  const exported = new Database('exported-results.sqlite', { readonly: true, fileMustExist: true });
  try {
    assert.deepEqual(exported.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name),
      ['control_answers', 'ratings', 'screentests', 'users']);
    for (const table of ['users', 'ratings', 'control_answers', 'screentests']) {
      assert.equal(exported.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 1);
    }
    assert.equal(exported.prepare('SELECT end_time FROM users').get().end_time, null);
    assert.equal(exported.pragma('integrity_check', { simple: true }), 'ok');
  } finally { exported.close(); }
  assert.equal(db.prepare('SELECT challenge FROM admin_webauthn_challenges').get().challenge, secret);
});
