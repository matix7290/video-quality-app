import { sameOrigin, loginCookie, cookie, authenticated, hasPasskeys } from '../../../utils/admin-auth.cjs';
import { passwordConfigured, authConfiguration, verifyPassword } from '../../../utils/admin-password.cjs';
const attempts = new Map();
let verifying = false;
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Nieprawidłowe źródło żądania.' });
  if (req.method === 'GET') return res.json({ authenticated: authenticated(req), passwordRequired: passwordConfigured() || hasPasskeys() });
  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', cookie(req, '', 0));
    return res.json({ ok: true });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!passwordConfigured()) return res.status(403).json({ error: 'Otwórz panel przez localhost.' });
  let configuration;
  try { configuration = authConfiguration(); }
  catch (error) { return res.status(503).json({ error: error.message }); }
  const key = req.socket.remoteAddress;
  const now = Date.now();
  for (const [address, item] of attempts) if (item.until < now) attempts.delete(address);
  const record = attempts.get(key) || { count: 0, until: now + 60000 };
  record.count++; attempts.set(key, record);
  if (record.count > 10) return res.status(429).json({ error: 'Zbyt wiele prób. Spróbuj ponownie za minutę.' });
  // Bound simultaneous memory use; asynchronous scrypt leaves study requests responsive.
  if (verifying) return res.status(503).json({ error: 'Trwa weryfikacja logowania. Spróbuj ponownie za chwilę.' });
  verifying = true;
  try {
    if (!await verifyPassword(req.body?.password, configuration.hash)) return res.status(401).json({ error: 'Nieprawidłowe hasło.' });
    // Never issue a cookie if credentials were changed while verification was running.
    const current = authConfiguration();
    if (current.hash !== configuration.hash || current.secret !== configuration.secret) return res.status(503).json({ error: 'Konfiguracja logowania zmieniła się. Spróbuj ponownie.' });
    attempts.delete(key);
    res.setHeader('Set-Cookie', loginCookie(req));
    return res.json({ ok: true });
  } catch { return res.status(503).json({ error: 'Nie udało się sprawdzić hasła. Spróbuj ponownie.' }); }
  finally { verifying = false; }
}
export const config = { api: { bodyParser: { sizeLimit: '8kb' } } };
