import db from '../../../database';
import { requireAdmin, loginCookie } from '../../../utils/admin-auth.cjs';
import { passwordConfigured, authConfiguration, verifyPassword, hashPassword, changePasswordHash } from '../../../utils/admin-password.cjs';

const attempts = new Map();
let changing = false;
export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Ta operacja nie jest dostępna.' });
  if (!passwordConfigured()) return res.status(403).json({ error: 'Najpierw ustaw hasło administratora.' });
  const { currentPassword, newPassword, confirmPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || !currentPassword) return res.status(400).json({ error: 'Podaj obecne hasło.' });
  if (typeof newPassword !== 'string' || newPassword.length < 12 || Buffer.byteLength(newPassword) > 4096) return res.status(400).json({ error: 'Nowe hasło musi mieć co najmniej 12 znaków i najwyżej 4096 bajtów.' });
  if (newPassword !== confirmPassword) return res.status(400).json({ error: 'Nowe hasła nie są zgodne.' });
  if (newPassword === currentPassword) return res.status(400).json({ error: 'Nowe hasło musi różnić się od obecnego.' });
  const key = req.socket.remoteAddress;
  const now = Date.now();
  for (const [address, attempt] of attempts) if (attempt.until <= now) attempts.delete(address);
  const attempt = attempts.get(key) || { count: 0, until: now + 60000 };
  attempt.count++;
  attempts.set(key, attempt);
  if (attempt.count > 5) return res.status(429).json({ error: 'Zbyt wiele prób. Spróbuj ponownie za minutę.' });
  if (changing) return res.status(503).json({ error: 'Trwa zmiana hasła. Spróbuj ponownie za chwilę.' });
  changing = true;
  try {
    const previous = authConfiguration(db);
    if (!await verifyPassword(currentPassword, previous.hash)) return res.status(401).json({ error: 'Obecne hasło jest nieprawidłowe.' });
    const nextHash = await hashPassword(newPassword);
    if (!changePasswordHash(db, previous, nextHash)) return res.status(409).json({ error: 'Hasło zostało zmienione w międzyczasie. Zaloguj się ponownie.' });
    attempts.delete(key);
    res.setHeader('Set-Cookie', loginCookie(req));
    return res.json({ ok: true });
  } catch {
    return res.status(503).json({ error: 'Nie udało się zmienić hasła. Spróbuj ponownie.' });
  } finally { changing = false; }
}
export const config = { api: { bodyParser: { sizeLimit: '16kb' } } };
