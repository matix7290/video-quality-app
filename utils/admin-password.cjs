const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
// OWASP scrypt minimum: 128 MiB, a unique salt for every password.
const options = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const configurationError = 'Ustaw hasło poleceniem npm run admin:password i zrestartuj serwer.';
function parseHash(value) {
  const match = /^scrypt:131072:8:1:([a-f0-9]{32}):([a-f0-9]{128})$/.exec(value || '');
  if (!match) throw new Error(configurationError);
  return { salt: Buffer.from(match[1], 'hex'), key: Buffer.from(match[2], 'hex') };
}
async function hashPassword(password) {
  if (typeof password !== 'string' || !password.length || Buffer.byteLength(password) > 4096) throw new Error('Hasło musi mieć od 1 do 4096 bajtów.');
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64, options);
  // Colons avoid Next.js dotenv expansion of dollar signs.
  return `scrypt:131072:8:1:${salt.toString('hex')}:${key.toString('hex')}`;
}
async function verifyPassword(password, hash) {
  const stored = parseHash(hash);
  if (typeof password !== 'string' || !password.length || Buffer.byteLength(password) > 4096) return false;
  const key = await scrypt(password, stored.salt, 64, options);
  return crypto.timingSafeEqual(key, stored.key);
}
function passwordConfigured() {
  return ['ADMIN_PASSWORD', 'ADMIN_PASSWORD_HASH', 'ADMIN_SESSION_SECRET'].some(name => process.env[name] !== undefined);
}
function authConfiguration() {
  parseHash(process.env.ADMIN_PASSWORD_HASH);
  if (process.env.ADMIN_PASSWORD !== undefined || !/^[a-f0-9]{64}$/.test(process.env.ADMIN_SESSION_SECRET || '')) throw new Error(configurationError);
  return { hash: process.env.ADMIN_PASSWORD_HASH, secret: process.env.ADMIN_SESSION_SECRET };
}
module.exports = { hashPassword, verifyPassword, parseHash, passwordConfigured, authConfiguration };
