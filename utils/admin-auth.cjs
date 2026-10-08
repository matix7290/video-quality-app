const crypto = require('node:crypto');
const { passwordConfigured, authConfiguration } = require('./admin-password.cjs');
const COOKIE = 'study_admin';
function sameOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host && ['http:', 'https:'].includes(new URL(origin).protocol); }
  catch { return false; }
}
function localRequest(req) {
  const remote = req.socket?.remoteAddress;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) return false;
  try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(`http://${req.headers.host}`).hostname); }
  catch { return false; }
}
function equal(a, b) {
  return crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(), crypto.createHash('sha256').update(b).digest());
}
function sign(value) {
  const { hash, secret } = authConfiguration();
  return crypto.createHmac('sha256', Buffer.from(secret, 'hex')).update(`${value}:${crypto.createHash('sha256').update(hash).digest('hex')}`).digest('hex');
}
function hasPasskeys() {
  return !!require('../database').prepare('SELECT 1 FROM admin_passkeys LIMIT 1').get();
}
function authenticated(req) {
  if (!passwordConfigured()) return !hasPasskeys() && localRequest(req);
  const token = req.cookies?.[COOKIE] || '';
  const [expiry, signature, extra] = token.split('.');
  try {
    return extra === undefined && /^\d+$/.test(expiry || '') && Number(expiry) > Date.now() && Number(expiry) <= Date.now() + 8 * 3600 * 1000 &&
      /^[a-f0-9]{64}$/.test(signature || '') && equal(signature, sign(expiry));
  } catch { return false; }
}
function requireAdmin(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!sameOrigin(req)) { res.status(403).json({ error: 'Żądanie musi pochodzić z tej aplikacji.' }); return false; }
  if (!authenticated(req)) {
    const registered = hasPasskeys();
    res.status(401).json({ error: passwordConfigured() ? 'Zaloguj się do panelu.' : registered ? 'Przywróć konfigurację hasła poleceniem npm run admin:password i zrestartuj serwer.' : 'Panel bez hasła jest dostępny wyłącznie przez localhost.', passwordRequired: passwordConfigured() || registered });
    return false;
  }
  return true;
}
function cookie(req, token, maxAge) {
  // Reverse proxies should set X-Forwarded-Proto when terminating HTTPS.
  const secure = req.socket?.encrypted || req.headers['x-forwarded-proto'] === 'https';
  return `${COOKIE}=${token}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
function loginCookie(req) { const expiry = String(Date.now() + 8 * 3600 * 1000); return cookie(req, `${expiry}.${sign(expiry)}`, 8 * 3600); }
module.exports = { sameOrigin, localRequest, equal, requireAdmin, authenticated, loginCookie, cookie, hasPasskeys };
