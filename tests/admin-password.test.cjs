const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { hashPassword, verifyPassword, parseHash, passwordConfigured, authConfiguration } = require('../utils/admin-password.cjs');
const auth = require('../utils/admin-auth.cjs');
const { replaceCredentials, migrateFile } = require('../scripts/admin-password.cjs');
const root = path.resolve(__dirname, '..');
const saved = Object.fromEntries(['ADMIN_PASSWORD', 'ADMIN_PASSWORD_HASH', 'ADMIN_SESSION_SECRET'].map(name => [name, process.env[name]]));
let directory, hash;
before(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'video-password-'));
  hash = await hashPassword('zażółć-$długie-hasło');
  for (const name of Object.keys(saved)) delete process.env[name];
});
after(() => {
  fs.rmSync(directory, { recursive: true, force: true });
  for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
});
test('scrypt uses fresh salts and verifies Unicode passwords without retaining plaintext', async () => {
  assert.ok(await verifyPassword('zażółć-$długie-hasło', hash));
  assert.equal(await verifyPassword('wrong', hash), false);
  assert.equal(await verifyPassword(undefined, hash), false);
  assert.equal(await verifyPassword('a'.repeat(4097), hash), false);
  assert.notEqual(await hashPassword('zażółć-$długie-hasło'), hash);
  assert.doesNotMatch(hash, /zażółć|\$/);
  assert.throws(() => parseHash(hash.replace('131072', '999999999')));
});
test('legacy plaintext and incomplete configurations fail closed even on localhost', () => {
  const req = { headers: { host: 'localhost:3000' }, socket: { remoteAddress: '127.0.0.1' }, cookies: {} };
  for (const values of [{ ADMIN_PASSWORD: 'legacy' }, { ADMIN_PASSWORD_HASH: hash }, { ADMIN_SESSION_SECRET: 'ab'.repeat(32) }, { ADMIN_PASSWORD_HASH: '' }]) {
    for (const name of Object.keys(saved)) delete process.env[name];
    Object.assign(process.env, values);
    assert.equal(passwordConfigured(), true);
    assert.throws(authConfiguration);
    assert.equal(auth.authenticated(req), false);
    assert.throws(() => auth.loginCookie(req));
  }
  for (const name of Object.keys(saved)) delete process.env[name];
});
test('migration removes duplicate and multiline plaintext entries, preserves other settings and writes mode 600', async () => {
  const filename = path.join(directory, '.env.local');
  const other = '# keep this comment\nADMIN_ORIGIN=https://study.example\nOTHER="line one\nADMIN_PASSWORD=unrelated-text\nline three"\n';
  fs.writeFileSync(filename, `${other}export ADMIN_PASSWORD='line one\nline two' # secret\nADMIN_PASSWORD="duplicate"\n`, { mode: 0o644 });
  assert.equal(await migrateFile(filename, 'line one\nline two'), true);
  const migrated = fs.readFileSync(filename, 'utf8');
  assert.ok(migrated.startsWith(other));
  assert.doesNotMatch(migrated.slice(other.length), /line one|line two|duplicate|ADMIN_PASSWORD=/);
  assert.equal(fs.statSync(filename).mode & 0o777, 0o600);
  const newHash = migrated.match(/^ADMIN_PASSWORD_HASH=(.*)$/m)[1];
  const secret = migrated.match(/^ADMIN_SESSION_SECRET=(.*)$/m)[1];
  assert.ok(await verifyPassword('line one\nline two', newHash));
  assert.equal(await migrateFile(filename, undefined, newHash, secret), false);
  assert.equal(fs.readFileSync(filename, 'utf8'), migrated);
  assert.deepEqual(fs.readdirSync(directory), ['.env.local']);
  assert.throws(() => replaceCredentials(migrated, 'invalid', secret));
});
test('Next.js dotenv expansion keeps the effective existing password after migration', async () => {
  const envDir = fs.mkdtempSync(path.join(directory, 'env-'));
  fs.writeFileSync(path.join(envDir, '.env.local'), 'BASE=example\nADMIN_PASSWORD="$BASE-escaped\\$literal"\n');
  const script = `const {loadEnvConfig}=require('@next/env'); const {combinedEnv}=loadEnvConfig(process.argv[1], true, {info(){},error(){}}, true); process.stdout.write(JSON.stringify({password:combinedEnv.ADMIN_PASSWORD,hash:combinedEnv.ADMIN_PASSWORD_HASH}));`;
  const env = { ...process.env }; for (const name of Object.keys(saved)) delete env[name]; delete env.__NEXT_PROCESSED_ENV;
  const initial = spawnSync(process.execPath, ['-e', script, envDir], { cwd: root, env, encoding: 'utf8' });
  assert.equal(initial.status, 0);
  const password = JSON.parse(initial.stdout).password;
  assert.equal(password, 'example-escaped$literal');
  await migrateFile(path.join(envDir, '.env.local'), password);
  const current = spawnSync(process.execPath, ['-e', script, envDir], { cwd: root, env, encoding: 'utf8' });
  assert.equal(current.status, 0);
  const parsed = JSON.parse(current.stdout);
  assert.equal(parsed.password, undefined);
  assert.ok(await verifyPassword(password, parsed.hash));
});
test('password API verifies the hash, rate limits requests and exposes no stored credentials', async () => {
  process.env.ADMIN_PASSWORD_HASH = hash; process.env.ADMIN_SESSION_SECRET = 'ab'.repeat(32);
  const source = fs.readFileSync(path.join(root, 'pages/api/admin/auth.js'), 'utf8').replace(/^import .*;\n/gm, '').replace('export default ', '').replace(/^export const config.*$/gm, '');
  const dependencies = { ...auth, passwordConfigured, authConfiguration, verifyPassword };
  const handler = new Function(...Object.keys(dependencies), `${source}; return handler;`)(...Object.values(dependencies));
  async function call(password, address = '127.0.0.1', method = 'POST') {
    const res = { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; }, setHeader(name, value) { this.headers[name] = value; }, json(body) { this.body = body; return this; } };
    await handler({ method, headers: { host: 'localhost:3000' }, socket: { remoteAddress: address }, cookies: {}, body: { password } }, res); return res;
  }
  assert.equal((await call('wrong')).statusCode, 401);
  const result = await call('zażółć-$długie-hasło');
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, { ok: true });
  assert.ok(result.headers['Set-Cookie']);
  const active = call('zażółć-$długie-hasło');
  assert.equal((await call('wrong', '192.0.2.1')).statusCode, 503);
  await active;
  for (let n = 0; n < 10; n++) assert.equal((await call(undefined, '192.0.2.2')).statusCode, 401);
  assert.equal((await call(undefined, '192.0.2.2')).statusCode, 429);
  delete process.env.ADMIN_PASSWORD_HASH;
  assert.equal((await call('zażółć-$długie-hasło')).statusCode, 503);
  assert.equal((await call(undefined, '127.0.0.1', 'GET')).body.authenticated, false);
});
