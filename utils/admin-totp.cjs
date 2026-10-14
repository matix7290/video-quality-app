const crypto = require('node:crypto');
const { authConfiguration } = require('./admin-password.cjs');

const STEP = 30;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function key() { return crypto.createHmac('sha256', Buffer.from(authConfiguration().secret, 'hex')).update('admin-totp-encryption-v1').digest(); }
function keyId() { return hash(key()); }
function encrypt(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}
function decrypt(value) {
  const bytes = Buffer.from(value, 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
}
function encodeBase32(bytes) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0, result = '';
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { result += alphabet[(value >>> (bits -= 5)) & 31]; }
  }
  return bits ? result + alphabet[(value << (5 - bits)) & 31] : result;
}
function decodeBase32(secret) {
  let bits = 0, value = 0;
  const result = [];
  for (const letter of secret) {
    const digit = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(letter);
    if (digit < 0) throw new Error('Invalid TOTP secret');
    value = (value << 5) | digit; bits += 5;
    if (bits >= 8) { result.push((value >>> (bits -= 8)) & 255); value &= (1 << bits) - 1; }
  }
  return Buffer.from(result);
}
function codeAt(secret, counter) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const offset = digest[19] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
function matchingCounter(secret, code, now = Date.now(), minimum = -1) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 1000 / STEP);
  for (const counter of [current - 1, current, current + 1]) {
    if (counter <= minimum || counter < 0) continue;
    if (crypto.timingSafeEqual(Buffer.from(codeAt(secret, counter)), Buffer.from(code))) return counter;
  }
  return null;
}
function createTotpService(db) {
  const row = () => db.prepare('SELECT * FROM admin_totp WHERE id = 1').get();
  const active = record => !!(record?.secret && record.key_id === keyId());
  function enabled() { return active(row()); }
  function start(session) {
    if (enabled()) throw new Error('Weryfikacja dwuetapowa jest już włączona.');
    const secret = encodeBase32(crypto.randomBytes(20));
    const expires = Date.now() + 10 * 60 * 1000;
    db.prepare(`INSERT INTO admin_totp (id, secret, key_id, last_counter, pending_secret, pending_binding, pending_expires_at)
      VALUES (1, NULL, ?, -1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
      secret = NULL, key_id = excluded.key_id, last_counter = -1,
      pending_secret = excluded.pending_secret, pending_binding = excluded.pending_binding,
      pending_expires_at = excluded.pending_expires_at`).run(keyId(), encrypt(secret), hash(session), expires);
    return { secret, uri: `otpauth://totp/${encodeURIComponent('Video Quality:administrator')}?secret=${secret}&issuer=${encodeURIComponent('Video Quality')}&algorithm=SHA1&digits=6&period=30` };
  }
  function activate(session, code) {
    const record = row();
    if (!record?.pending_secret || record.pending_expires_at <= Date.now() || record.pending_binding !== hash(session) || record.key_id !== keyId()) return false;
    const counter = matchingCounter(decrypt(record.pending_secret), code);
    if (counter === null) return false;
    return !!db.prepare(`UPDATE admin_totp SET secret = pending_secret, last_counter = ?,
      pending_secret = NULL, pending_binding = NULL, pending_expires_at = NULL
      WHERE id = 1 AND pending_secret = ? AND pending_binding = ?`).run(counter, record.pending_secret, hash(session)).changes;
  }
  function verify(code) {
    const record = row();
    if (!active(record)) return false;
    const counter = matchingCounter(decrypt(record.secret), code, Date.now(), record.last_counter);
    if (counter === null) return false;
    return !!db.prepare('UPDATE admin_totp SET last_counter = ? WHERE id = 1 AND last_counter < ? AND secret = ?')
      .run(counter, counter, record.secret).changes;
  }
  function disable(code) {
    if (!verify(code)) return false;
    db.prepare('DELETE FROM admin_totp WHERE id = 1').run();
    return true;
  }
  return { enabled, start, activate, verify, disable };
}
module.exports = { createTotpService, codeAt, matchingCounter };
