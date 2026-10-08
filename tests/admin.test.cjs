const { test, before, after } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
let directory;
before(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'video-auth-')); process.chdir(directory); });
after(() => { require('../database').close(); process.chdir(root); fs.rmSync(directory, { recursive: true, force: true }); });
const assert = require('node:assert/strict');
const auth = require('../utils/admin-auth.cjs');
const { hashPassword } = require('../utils/admin-password.cjs');
const savedAuth = Object.fromEntries(['ADMIN_PASSWORD', 'ADMIN_PASSWORD_HASH', 'ADMIN_SESSION_SECRET'].map(name => [name, process.env[name]]));
function clearAuth() { for (const name of Object.keys(savedAuth)) delete process.env[name]; }
function restoreAuth() { clearAuth(); for (const [name, value] of Object.entries(savedAuth)) if (value !== undefined) process.env[name] = value; }
const { questionRows, questionsToCsv } = require('../utils/questions.cjs');
function request(host = 'localhost:3000', address = '127.0.0.1') {
  return { headers: { host }, socket: { remoteAddress: address }, cookies: {} };
}
test('admin requires both loopback host and loopback socket locally, and rejects foreign origins', () => {
  clearAuth();
  try {
    assert.equal(auth.authenticated(request()), true);
    assert.equal(auth.authenticated(request('localhost:3000', '192.0.2.1')), false);
    assert.equal(auth.authenticated(request('evil.example:3000')), false);
    assert.equal(auth.authenticated(request('[::1]:3000', '::1')), true);
    assert.equal(auth.sameOrigin({ ...request(), headers: { host: 'localhost:3000', origin: 'https://evil.example' } }), false);
    assert.equal(auth.sameOrigin({ ...request(), headers: { host: 'localhost:3000', origin: 'http://localhost:3000' } }), true);
    assert.equal(auth.sameOrigin({ ...request(), headers: { host: 'localhost:3000', 'sec-fetch-site': 'cross-site' } }), false);
  } finally { restoreAuth(); }
});
test('signed login cookies expire, reject tampering and stop working after password or session key changes', async () => {
  clearAuth();
  process.env.ADMIN_PASSWORD_HASH = await hashPassword('test-password-for-cookie');
  process.env.ADMIN_SESSION_SECRET = 'ab'.repeat(32);
  try {
    const req = request('study.example', '192.0.2.1');
    assert.equal(auth.authenticated(req), false);
    const cookie = auth.loginCookie(req);
    assert.match(cookie, /HttpOnly; SameSite=Strict/);
    req.cookies.study_admin = cookie.split(';')[0].slice('study_admin='.length);
    assert.equal(auth.authenticated(req), true);
    const valid = req.cookies.study_admin;
    req.cookies.study_admin = '0.' + valid.split('.')[1];
    assert.equal(auth.authenticated(req), false);
    req.cookies.study_admin = valid.slice(0, -1) + 'z';
    assert.equal(auth.authenticated(req), false);
    req.cookies.study_admin = valid;
    const secret = process.env.ADMIN_SESSION_SECRET;
    process.env.ADMIN_SESSION_SECRET = 'cd'.repeat(32);
    assert.equal(auth.authenticated(req), false);
    process.env.ADMIN_SESSION_SECRET = secret;
    assert.equal(auth.authenticated(req), true);
    process.env.ADMIN_PASSWORD_HASH = await hashPassword('changed-password');
    assert.equal(auth.authenticated(req), false);
  } finally { restoreAuth(); }
});
test('question editor round-trips CSV commas, quotation marks and multiline content', () => {
  const rows = [{ video_name: 'a.mp4', question: 'Czy "pies",\nbiegnie?', correct_answer: 'tak', part: 'first' },
    { video_name: 'a.mp4', question: 'Pytanie bez klucza?', correct_answer: '', part: 'second' },
    { video_name: 'a.mp4', question: 'W obu częściach?', correct_answer: 'nie', part: 'both' }];
  assert.deepEqual(questionRows(questionsToCsv(rows), ['a.mp4']), rows);
  assert.equal(questionRows('video_name,question\na.mp4,Starsze pytanie?\n', ['a.mp4'])[0].part, 'first');
  assert.equal(questionRows('video_name,question,part\na.mp4,Puste przypisanie?,\n', ['a.mp4'])[0].part, 'first');
  assert.throws(() => questionRows('video_name,question,part\na.mp4,Błędna część?,third\n', ['a.mp4']), /part musi być/);
});

test('image question CSV uses stimulus_name and keeps compatibility with video_name', () => {
  const rows = [{ video_name: 'photo.png', question: 'Czy widać postać?', correct_answer: 'tak', part: 'both' }];
  const csv = questionsToCsv(rows, { stimulusType: 'image' });
  assert.match(csv, /^stimulus_name,question,correct_answer,part/);
  assert.deepEqual(questionRows(csv, ['photo.png']), rows);
  assert.deepEqual(questionRows(questionsToCsv(rows), ['photo.png']), rows);
  assert.throws(() => questionRows('stimulus_name,video_name,question\na.png,b.png,Q?\n', ['a.png', 'b.png']), /jednej kolumny/);
});
