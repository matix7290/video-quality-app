const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isoCBOR } = require('@simplewebauthn/server/helpers');
const { createPasskeyService, passkeyOrigin } = require('../utils/admin-passkeys.cjs');
const auth = require('../utils/admin-auth.cjs');
const root = path.resolve(__dirname, '..');
const { hashPassword, authConfiguration } = require('../utils/admin-password.cjs');
const previousAuth = Object.fromEntries(['ADMIN_PASSWORD', 'ADMIN_PASSWORD_HASH', 'ADMIN_SESSION_SECRET', 'ADMIN_ORIGIN'].map(name => [name, process.env[name]]));
let configuredHash;
let directory, db, service, req, credentialID, privateKey, counter = 0;
function request(host = 'localhost:3000') {
  return { headers: { host, origin: `http://${host}` }, socket: { remoteAddress: '127.0.0.1' }, cookies: {} };
}
function acceptCookie(result) { const [name, value] = result.cookie.split(';')[0].split('='); req.cookies[name] = value; }
const b64 = bytes => Buffer.from(bytes).toString('base64url');
function registration(options, { flags = 0x45, origin = 'http://localhost:3000' } = {}) {
  const pair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }); privateKey = pair.privateKey;
  const jwk = pair.publicKey.export({ format: 'jwk' });
  const publicKey = isoCBOR.encode(new Map([[1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(Buffer.from(jwk.x, 'base64url'))], [-3, new Uint8Array(Buffer.from(jwk.y, 'base64url'))]]));
  const id = crypto.randomBytes(32); credentialID = id.toString('base64url');
  const size = Buffer.alloc(2); size.writeUInt16BE(id.length);
  const authData = Buffer.concat([crypto.createHash('sha256').update('localhost').digest(), Buffer.from([flags]), Buffer.alloc(4), Buffer.alloc(16), size, id, Buffer.from(publicKey)]);
  const client = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin, crossOrigin: false }));
  const attestation = isoCBOR.encode(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', new Uint8Array(authData)]]));
  return { id: credentialID, rawId: credentialID, type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: b64(client), attestationObject: b64(attestation), transports: ['internal'] } };
}
function assertion(options, overrides = {}) {
  const stored = db.prepare('SELECT * FROM admin_passkeys WHERE id = ?').get(credentialID);
  const count = Buffer.alloc(4); count.writeUInt32BE(overrides.counter ?? ++counter);
  const rp = overrides.rpID || 'localhost';
  const authData = Buffer.concat([crypto.createHash('sha256').update(rp).digest(), Buffer.from([overrides.flags ?? 0x05]), count]);
  const client = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: overrides.challenge || options.challenge,
    origin: overrides.origin || 'http://localhost:3000', crossOrigin: false }));
  const signed = Buffer.concat([authData, crypto.createHash('sha256').update(client).digest()]);
  return { id: credentialID, rawId: credentialID, type: 'public-key', clientExtensionResults: {},
    response: { authenticatorData: b64(authData), clientDataJSON: b64(client), signature: b64(crypto.sign('sha256', signed, privateKey)), userHandle: stored.user_handle } };
}
before(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'video-passkeys-')); process.chdir(directory);
  delete process.env.ADMIN_PASSWORD; delete process.env.ADMIN_ORIGIN;
  configuredHash = await hashPassword('isolated-test-password');
  process.env.ADMIN_PASSWORD_HASH = configuredHash; process.env.ADMIN_SESSION_SECRET = 'ab'.repeat(32);
  db = require('../database'); service = createPasskeyService(db); req = request();
  req.cookies.study_admin = auth.loginCookie(req).split(';')[0].slice('study_admin='.length);
});
after(() => {
  db.close(); process.chdir(root); fs.rmSync(directory, { recursive: true, force: true });
  for (const [name, value] of Object.entries(previousAuth)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
});
test('registration and login verify real ECDSA WebAuthn signatures and persist counters', async () => {
  const reg = await service.registrationOptions(req, 'Test authenticator'); acceptCookie(reg);
  assert.equal(reg.options.authenticatorSelection.userVerification, 'required');
  assert.equal(reg.options.authenticatorSelection.residentKey, 'required');
  await service.register(req, registration(reg.options));
  assert.equal(service.list('localhost').length, 1);
  const first = await service.authenticationOptions(req); acceptCookie(first);
  assert.equal(first.options.userVerification, 'required');
  assert.equal(first.options.allowCredentials?.length || 0, 0);
  const response = assertion(first.options);
  await service.authenticate(req, response);
  assert.equal(db.prepare('SELECT counter FROM admin_passkeys').get().counter, 1);
  assert.ok(service.list('localhost')[0].last_used_at);
  await assert.rejects(service.authenticate(req, response), /Próba passkey/);
});
test('expired challenges and copied responses without the browser cookie cannot log in', async () => {
  let attempt = await service.authenticationOptions(req); acceptCookie(attempt);
  const response = assertion(attempt.options);
  await assert.rejects(service.authenticate({ ...req, cookies: {} }, response), /Brak próby/);
  db.prepare('UPDATE admin_webauthn_challenges SET expires_at = 0').run();
  await assert.rejects(service.authenticate(req, response), /Próba passkey/);
});
test('verification rejects wrong origins, RP IDs, challenges, user verification and signatures', async () => {
  for (const override of [{ origin: 'https://evil.example' }, { rpID: 'evil.example' }, { challenge: 'incorrect' }, { flags: 0x01 }, { flags: 0x04 }, { counter: 1 }, { badSignature: true }, { badUser: true }]) {
    const attempt = await service.authenticationOptions(req); acceptCookie(attempt);
    const response = assertion(attempt.options, override);
    if (override.badSignature) response.response.signature = b64(crypto.randomBytes(72));
    if (override.badUser) response.response.userHandle = 'unknown';
    await assert.rejects(service.authenticate(req, response));
    await assert.rejects(service.authenticate(req, response), /Próba passkey/);
  }
  assert.equal(db.prepare('SELECT counter FROM admin_passkeys').get().counter, 1);
});
test('registrations are bound to the authenticated browser session and require verified user presence', async () => {
  const count = service.list('localhost').length;
  let attempt = await service.registrationOptions(req, 'Wrong session'); acceptCookie(attempt);
  await assert.rejects(service.register({ ...req, cookies: { ...req.cookies, study_admin: 'different-session' } }, {}), /Próba passkey/);
  attempt = await service.registrationOptions(req, 'No verification'); acceptCookie(attempt);
  await assert.rejects(service.register(req, registration(attempt.options, { flags: 0x41 })));
  assert.equal(service.list('localhost').length, count);
});
test('configured origins are HTTPS-bound and registered passkeys prevent password-free localhost bypass', () => {
  assert.equal(passkeyOrigin(request()).rpID, 'localhost');
  assert.throws(() => passkeyOrigin(request('127.0.0.1:3000')));
  process.env.ADMIN_ORIGIN = 'https://study.example';
  const deployment = { ...request('study.example'), headers: { host: 'study.example', origin: 'https://study.example' } };
  assert.deepEqual(passkeyOrigin(deployment), { origin: 'https://study.example', rpID: 'study.example' });
  assert.throws(() => passkeyOrigin(request()));
  process.env.ADMIN_ORIGIN = 'http://study.example';
  assert.throws(() => passkeyOrigin(deployment));
  delete process.env.ADMIN_ORIGIN; delete process.env.ADMIN_PASSWORD_HASH; delete process.env.ADMIN_SESSION_SECRET;
  assert.equal(auth.authenticated(request()), false);
  process.env.ADMIN_PASSWORD_HASH = configuredHash; process.env.ADMIN_SESSION_SECRET = 'ab'.repeat(32);
});

test('passkey API protects enrollment and issues an administrator cookie only after successful verification', async () => {
  const source = fs.readFileSync(path.join(root, 'pages/api/admin/passkeys.js'), 'utf8').replace(/^import .*;\n/gm, '')
    .replace('export default ', '').replace(/^export const config.*$/gm, '');
  const handler = new Function('authConfiguration', 'db', 'sameOrigin', 'requireAdmin', 'loginCookie', 'createPasskeyService', 'passkeyOrigin', 'challengeCookie', `${source}; return handler;`)
    (authConfiguration, db, auth.sameOrigin, auth.requireAdmin, auth.loginCookie, createPasskeyService, passkeyOrigin, require('../utils/admin-passkeys.cjs').challengeCookie);
  async function call(body, cookies = req.cookies, headers = req.headers) {
    const res = { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; }, setHeader(name, value) { this.headers[name] = value; }, json(body) { this.body = body; return this; } };
    await handler({ ...req, method: 'POST', body, cookies, headers }, res); return res;
  }
  assert.equal((await call({ action: 'register-options', name: 'Denied' }, {})).statusCode, 401);
  assert.equal((await call({ action: 'register-options', name: 'Denied' }, req.cookies, { ...req.headers, origin: 'https://evil.example' })).statusCode, 403);
  const reg = await call({ action: 'register-options', name: 'API key' });
  assert.equal(reg.statusCode, 200); acceptCookie({ cookie: reg.headers['Set-Cookie'] });
  assert.equal((await call({ action: 'register-verify', response: registration(reg.body) })).statusCode, 201);
  let attempt = await call({ action: 'authenticate-options' }, {}); acceptCookie({ cookie: attempt.headers['Set-Cookie'] });
  let result = await call({ action: 'authenticate-verify', response: assertion(attempt.body, { origin: 'https://evil.example' }) });
  assert.equal(result.statusCode, 400);
  assert.doesNotMatch(String(result.headers['Set-Cookie']), /study_admin=/);
  attempt = await call({ action: 'authenticate-options' }, {}); acceptCookie({ cookie: attempt.headers['Set-Cookie'] });
  result = await call({ action: 'authenticate-verify', response: assertion(attempt.body) });
  assert.equal(result.statusCode, 200);
  const sessionCookie = result.headers['Set-Cookie'].find(value => value.startsWith('study_admin='));
  assert.ok(sessionCookie);
  assert.equal(auth.authenticated({ ...req, cookies: { study_admin: sessionCookie.split(';')[0].slice('study_admin='.length) } }), true);
});
