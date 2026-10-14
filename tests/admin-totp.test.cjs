const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTotpService, codeAt } = require('../utils/admin-totp.cjs');
const { hashPassword, authConfiguration, verifyPassword, passwordConfigured } = require('../utils/admin-password.cjs');
const auth = require('../utils/admin-auth.cjs');
const root = path.resolve(__dirname, '..');
const saved = Object.fromEntries(['ADMIN_PASSWORD', 'ADMIN_PASSWORD_HASH', 'ADMIN_SESSION_SECRET'].map(name => [name, process.env[name]]));
let directory, db, totp, enrolledSecret;
function handlerFor(file, dependencies) {
  const source = fs.readFileSync(path.join(root, file), 'utf8').replace(/^import .*;\n/gm, '').replace('export default ', '').replace(/^export const config.*$/gm, '');
  return new Function(...Object.keys(dependencies), `${source}; return handler;`)(...Object.values(dependencies));
}
function call(handler, method, body, cookies = {}) {
  const res = { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; }, setHeader(name, value) { this.headers[name] = value; }, json(value) { this.body = value; return this; } };
  return Promise.resolve(handler({ method, body, cookies, headers: { host: 'localhost:3000', origin: 'http://localhost:3000' }, socket: { remoteAddress: '127.0.0.1' } }, res)).then(() => res);
}
test('TOTP uses RFC 6238 SHA-1 counters and six-digit codes', () => {
  assert.equal(codeAt('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1), '287082');
});
before(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'video-totp-'));
  process.chdir(directory);
  delete process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD_HASH = await hashPassword('totp-test-password');
  process.env.ADMIN_SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  db = require('../database');
  totp = createTotpService(db);
});
after(() => {
  db.close(); process.chdir(root); fs.rmSync(directory, { recursive: true, force: true });
  for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
});
test('TOTP enrollment requires the same admin session, confirms an app code, and rejects reuse', () => {
  const setup = totp.start('session-one');
  enrolledSecret = setup.secret;
  assert.match(setup.secret, /^[A-Z2-7]{32}$/);
  assert.match(setup.uri, /^otpauth:\/\/totp\//);
  assert.doesNotMatch(db.prepare('SELECT pending_secret FROM admin_totp').get().pending_secret, new RegExp(setup.secret));
  const code = codeAt(setup.secret, Math.floor(Date.now() / 30000));
  assert.equal(totp.activate('session-two', code), false);
  assert.equal(totp.activate('session-one', '000000'), false);
  assert.equal(totp.activate('session-one', code), true);
  assert.equal(totp.enabled(), true);
  assert.equal(totp.verify(code), false);
  const nextCode = codeAt(setup.secret, Math.floor(Date.now() / 30000) + 1);
  assert.equal(totp.verify(nextCode), true);
  assert.equal(totp.verify(nextCode), false);
  assert.equal(totp.disable(nextCode), false);
});
test('password API requires a fresh app code before issuing a session', async () => {
  const handler = handlerFor('pages/api/admin/auth.js', { ...auth, passwordConfigured, authConfiguration, verifyPassword, db, createTotpService });
  let result = await call(handler, 'POST', { password: 'incorrect' });
  assert.equal(result.statusCode, 401);
  assert.equal(result.body.codeRequired, undefined);
  result = await call(handler, 'POST', { password: 'totp-test-password' });
  assert.equal(result.statusCode, 202);
  assert.deepEqual(result.body, { codeRequired: true });
  assert.equal(result.headers['Set-Cookie'], undefined);
  const actualNow = Date.now;
  try {
    Date.now = () => actualNow() + 90000;
    const code = codeAt(enrolledSecret, Math.floor(Date.now() / 30000));
    result = await call(handler, 'POST', { password: 'totp-test-password', code });
    assert.equal(result.statusCode, 200);
    assert.ok(result.headers['Set-Cookie']);
    assert.equal((await call(handler, 'POST', { password: 'totp-test-password', code })).statusCode, 401);
  } finally { Date.now = actualNow; }
  assert.equal((await call(handler, 'GET')).body.authenticated, false);
});
test('TOTP settings API requires authentication and rejects invalid operations', async () => {
  const handler = handlerFor('pages/api/admin/totp.js', { db, requireAdmin: auth.requireAdmin, passwordConfigured, createTotpService });
  assert.equal((await call(handler, 'GET')).statusCode, 401);
  const session = auth.loginCookie({ headers: {}, socket: {} }).split(';')[0].slice('study_admin='.length);
  const cookies = { study_admin: session };
  assert.equal((await call(handler, 'GET', null, cookies)).body.enabled, true);
  assert.equal((await call(handler, 'POST', { action: 'disable', code: '000000' }, cookies)).statusCode, 400);
  assert.equal((await call(handler, 'POST', { action: 'unknown' }, cookies)).statusCode, 400);
  const actualNow = Date.now;
  try {
    Date.now = () => actualNow() + 180000;
    const code = codeAt(enrolledSecret, Math.floor(Date.now() / 30000));
    assert.equal((await call(handler, 'POST', { action: 'disable', code }, cookies)).body.enabled, false);
    assert.equal((await call(handler, 'GET', null, cookies)).body.enabled, false);
  } finally { Date.now = actualNow; }
});
