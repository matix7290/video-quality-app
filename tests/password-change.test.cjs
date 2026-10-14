const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const auth = require('../utils/admin-auth.cjs');
const passwords = require('../utils/admin-password.cjs');
const { createTotpService, codeAt } = require('../utils/admin-totp.cjs');
const root = path.resolve(__dirname, '..');
const saved = Object.fromEntries(['ADMIN_PASSWORD', 'ADMIN_PASSWORD_HASH', 'ADMIN_SESSION_SECRET'].map(name => [name, process.env[name]]));
let directory, db, handler, oldHash;
function request(body, cookie) {
  return { method: 'POST', body, headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
    socket: { remoteAddress: '127.0.0.1' }, cookies: cookie ? { study_admin: cookie } : {} };
}
async function call(body, cookie, origin = 'http://localhost:3000') {
  const res = { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; }, setHeader(name, value) { this.headers[name] = value; }, json(value) { this.body = value; return this; } };
  const req = request(body, cookie);
  req.headers.origin = origin;
  await handler(req, res);
  return res;
}
before(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'video-password-change-'));
  process.chdir(directory);
  delete process.env.ADMIN_PASSWORD;
  oldHash = await passwords.hashPassword('previous-admin-password');
  process.env.ADMIN_PASSWORD_HASH = oldHash;
  process.env.ADMIN_SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  db = require('../database');
  const source = fs.readFileSync(path.join(root, 'pages/api/admin/password.js'), 'utf8')
    .replace(/^import .*;\n/gm, '').replace('export default ', '').replace(/^export const config.*$/gm, '');
  const dependencies = { db, requireAdmin: auth.requireAdmin, loginCookie: auth.loginCookie, ...passwords };
  handler = new Function(...Object.keys(dependencies), `${source}; return handler;`)(...Object.values(dependencies));
});
after(() => {
  db.close(); process.chdir(root); fs.rmSync(directory, { recursive: true, force: true });
  for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
});
test('password change requires an admin session, current password and matching strong new passwords', async () => {
  const cookie = auth.loginCookie(request()).split(';')[0].slice('study_admin='.length);
  const valid = { currentPassword: 'previous-admin-password', newPassword: 'fresh-admin-password', confirmPassword: 'fresh-admin-password' };
  assert.equal((await call(valid)).statusCode, 401);
  assert.equal((await call(valid, cookie, 'https://evil.example')).statusCode, 403);
  assert.equal((await call({ ...valid, currentPassword: 'wrong' }, cookie)).statusCode, 401);
  assert.equal((await call({ ...valid, confirmPassword: 'different-password' }, cookie)).statusCode, 400);
  assert.equal((await call({ ...valid, newPassword: 'short', confirmPassword: 'short' }, cookie)).statusCode, 400);
  assert.equal((await call({ ...valid, newPassword: valid.currentPassword, confirmPassword: valid.currentPassword }, cookie)).statusCode, 400);
  assert.equal(passwords.authConfiguration(db).hash, oldHash);
});
test('password change revokes old sessions and keeps TOTP configuration usable', async () => {
  const req = request();
  const oldCookie = auth.loginCookie(req).split(';')[0].slice('study_admin='.length);
  const totp = createTotpService(db);
  const setup = totp.start(oldCookie);
  assert.equal(totp.activate(oldCookie, codeAt(setup.secret, Math.floor(Date.now() / 30000))), true);
  const result = await call({ currentPassword: 'previous-admin-password', newPassword: 'fresh-admin-password', confirmPassword: 'fresh-admin-password' }, oldCookie);
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.ok, true);
  const newCookie = result.headers['Set-Cookie'].split(';')[0].slice('study_admin='.length);
  assert.equal(auth.authenticated(request(null, oldCookie)), false);
  assert.equal(auth.authenticated(request(null, newCookie)), true);
  assert.equal((await call({ currentPassword: 'previous-admin-password', newPassword: 'another-admin-password', confirmPassword: 'another-admin-password' }, oldCookie)).statusCode, 401);
  assert.equal(await passwords.verifyPassword('previous-admin-password', passwords.authConfiguration(db).hash), false);
  assert.equal(await passwords.verifyPassword('fresh-admin-password', passwords.authConfiguration(db).hash), true);
  assert.equal(totp.enabled(), true);
  assert.equal(process.env.ADMIN_PASSWORD_HASH, oldHash);
  assert.equal(passwords.changePasswordHash(db, { hash: oldHash, secret: process.env.ADMIN_SESSION_SECRET }, oldHash), false);
});
test('server credential rotation takes precedence over the panel password override', async () => {
  const replacement = await passwords.hashPassword('server-recovery-password');
  process.env.ADMIN_PASSWORD_HASH = replacement;
  process.env.ADMIN_SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  assert.equal(passwords.authConfiguration(db).hash, replacement);
  assert.equal(await passwords.verifyPassword('fresh-admin-password', passwords.authConfiguration(db).hash), false);
  assert.equal(await passwords.verifyPassword('server-recovery-password', passwords.authConfiguration(db).hash), true);
});
