const crypto = require('node:crypto');
const webauthn = require('@simplewebauthn/server');
const { localRequest, cookie: adminCookie } = require('./admin-auth.cjs');
const CHALLENGE_COOKIE = 'study_webauthn';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function passkeyOrigin(req) {
  let url;
  if (process.env.ADMIN_ORIGIN) {
    try { url = new URL(process.env.ADMIN_ORIGIN); } catch { throw new Error('ADMIN_ORIGIN musi być pełnym adresem strony administratora.'); }
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
        (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost'))) {
      throw new Error('ADMIN_ORIGIN musi wskazywać HTTPS albo http://localhost, bez ścieżki.');
    }
    if (url.host !== req.headers.host) throw new Error('Otwórz panel pod adresem ustawionym w ADMIN_ORIGIN.');
  } else {
    if (!localRequest(req) || new URL(`http://${req.headers.host}`).hostname !== 'localhost') {
      throw new Error('Dla passkey otwórz http://localhost lub ustaw ADMIN_ORIGIN na adres HTTPS wdrożenia.');
    }
    url = new URL(`http://${req.headers.host}`);
  }
  if (req.headers.origin && req.headers.origin !== url.origin) throw new Error('Nieprawidłowy adres źródłowy żądania passkey.');
  return { origin: url.origin, rpID: url.hostname };
}
function challengeCookie(req, token, maxAge = 300) {
  return adminCookie(req, token, maxAge).replace(/^study_admin=/, `${CHALLENGE_COOKIE}=`);
}
function createPasskeyService(db, verifier = webauthn) {
  function list(rpID) { return db.prepare('SELECT id, name, created_at, last_used_at FROM admin_passkeys WHERE rp_id = ? ORDER BY created_at, id').all(rpID); }
  function keys(rpID) { return db.prepare('SELECT * FROM admin_passkeys WHERE rp_id = ?').all(rpID); }
  function saveChallenge(req, kind, options, details, extra = {}) {
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('DELETE FROM admin_webauthn_challenges WHERE expires_at <= ? OR token_hash = ?').run(Date.now(), hash(req.cookies?.[CHALLENGE_COOKIE] || ''));
    db.prepare(`INSERT INTO admin_webauthn_challenges
      (token_hash, kind, challenge, origin, rp_id, user_handle, name, session_binding, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(hash(token), kind, options.challenge, details.origin, details.rpID,
      extra.userHandle || null, extra.name || null, kind === 'register' ? hash(req.cookies?.study_admin || '') : null, Date.now() + 300000);
    return { options, cookie: challengeCookie(req, token) };
  }
  function consume(req, kind) {
    const token = req.cookies?.[CHALLENGE_COOKIE];
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Brak próby passkey. Rozpocznij ponownie.');
    const record = db.prepare('DELETE FROM admin_webauthn_challenges WHERE token_hash = ? RETURNING *').get(hash(token));
    const details = passkeyOrigin(req);
    if (!record || record.kind !== kind || record.expires_at <= Date.now() || record.origin !== details.origin || record.rp_id !== details.rpID ||
        (kind === 'register' && record.session_binding !== hash(req.cookies?.study_admin || ''))) {
      throw new Error('Próba passkey wygasła lub jest nieprawidłowa. Rozpocznij ponownie.');
    }
    return record;
  }
  async function registrationOptions(req, name) {
    if (typeof name !== 'string' || !name.trim() || name.length > 100) throw new Error('Podaj nazwę klucza (do 100 znaków).');
    const details = passkeyOrigin(req), existing = keys(details.rpID);
    if (existing.length >= 20) throw new Error('Można zapisać maksymalnie 20 kluczy.');
    const userHandle = existing[0]?.user_handle || crypto.randomBytes(32).toString('base64url');
    const options = await verifier.generateRegistrationOptions({ rpName: 'Video Quality · administrator', rpID: details.rpID,
      userName: 'administrator', userDisplayName: 'Administrator badania', userID: new Uint8Array(Buffer.from(userHandle, 'base64url')),
      attestationType: 'none', supportedAlgorithmIDs: [-7, -257],
      excludeCredentials: existing.map(key => ({ id: key.id, transports: JSON.parse(key.transports) })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' }, timeout: 60000 });
    return saveChallenge(req, 'register', options, details, { name: name.trim(), userHandle });
  }
  async function register(req, response) {
    const record = consume(req, 'register');
    const result = await verifier.verifyRegistrationResponse({ response, expectedChallenge: record.challenge,
      expectedOrigin: record.origin, expectedRPID: record.rp_id, requireUserVerification: true, supportedAlgorithmIDs: [-7, -257] });
    if (!result.verified) throw new Error('Nie udało się zweryfikować nowego klucza.');
    const info = result.registrationInfo;
    const key = info.credential;
    db.prepare(`INSERT INTO admin_passkeys (id, rp_id, user_handle, public_key, counter, transports, name, device_type, backed_up)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(key.id, record.rp_id, record.user_handle, Buffer.from(key.publicKey), key.counter,
      JSON.stringify(key.transports || []), record.name, info.credentialDeviceType, Number(info.credentialBackedUp));
  }
  async function authenticationOptions(req) {
    const details = passkeyOrigin(req);
    if (!keys(details.rpID).length) throw new Error('Nie dodano jeszcze passkey dla tego adresu. Zaloguj się hasłem i dodaj klucz w zakładce Dostęp.');
    // Discoverable credentials keep credential identifiers off the public login endpoint.
    const options = await verifier.generateAuthenticationOptions({ rpID: details.rpID, userVerification: 'required', timeout: 60000 });
    return saveChallenge(req, 'authenticate', options, details);
  }
  async function authenticate(req, response) {
    const record = consume(req, 'authenticate');
    const key = typeof response?.id === 'string' && db.prepare('SELECT * FROM admin_passkeys WHERE id = ? AND rp_id = ?').get(response.id, record.rp_id);
    if (!key || response.response?.userHandle !== key.user_handle) throw new Error('Nieznany klucz administratora.');
    const result = await verifier.verifyAuthenticationResponse({ response, expectedChallenge: record.challenge,
      expectedOrigin: record.origin, expectedRPID: record.rp_id, requireUserVerification: true,
      credential: { id: key.id, publicKey: new Uint8Array(key.public_key), counter: key.counter, transports: JSON.parse(key.transports) } });
    if (!result.verified) throw new Error('Nie udało się potwierdzić logowania passkey.');
    // A removed key or concurrent counter update must not issue a session.
    const changed = db.prepare('UPDATE admin_passkeys SET counter = ?, last_used_at = CURRENT_TIMESTAMP WHERE id = ? AND counter = ?')
      .run(result.authenticationInfo.newCounter, key.id, key.counter).changes;
    if (!changed) throw new Error('Klucz został zmieniony. Ponów logowanie.');
  }
  return { list, registrationOptions, register, authenticationOptions, authenticate };
}
module.exports = { createPasskeyService, passkeyOrigin, challengeCookie, CHALLENGE_COOKIE };
