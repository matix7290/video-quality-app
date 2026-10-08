import db from '../../../database';
import { sameOrigin, requireAdmin, loginCookie } from '../../../utils/admin-auth.cjs';
import { authConfiguration } from '../../../utils/admin-password.cjs';
import { createPasskeyService, passkeyOrigin, challengeCookie } from '../../../utils/admin-passkeys.cjs';
const service = createPasskeyService(db);
const attempts = new Map();
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Nieprawidłowe źródło żądania.' });
  const action = req.body?.action;
  if (req.method === 'GET' || req.method === 'DELETE' || ['register-options', 'register-verify'].includes(action)) {
    if (!requireAdmin(req, res)) return;
  }
  if (!['GET', 'POST', 'DELETE'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
  try {
    authConfiguration();
    const { rpID, origin } = passkeyOrigin(req);
    if (req.method === 'GET') return res.json({ keys: service.list(rpID), origin });
    if (req.method === 'DELETE') {
      if (typeof req.body?.id !== 'string') throw new Error('Nie wybrano klucza.');
      db.prepare('DELETE FROM admin_passkeys WHERE id = ? AND rp_id = ?').run(req.body.id, rpID);
      return res.json({ ok: true });
    }
    const key = req.socket.remoteAddress, now = Date.now();
    for (const [address, item] of attempts) if (item.until <= now) attempts.delete(address);
    const record = attempts.get(key) || { count: 0, until: now + 60000 };
    record.count++; attempts.set(key, record);
    if (record.count > 30) return res.status(429).json({ error: 'Zbyt wiele prób. Spróbuj ponownie za minutę.' });
    if (action === 'register-options') {
      const result = await service.registrationOptions(req, req.body.name);
      res.setHeader('Set-Cookie', result.cookie); return res.json(result.options);
    }
    if (action === 'authenticate-options') {
      const result = await service.authenticationOptions(req);
      res.setHeader('Set-Cookie', result.cookie); return res.json(result.options);
    }
    if (action === 'register-verify') {
      res.setHeader('Set-Cookie', challengeCookie(req, '', 0));
      await service.register(req, req.body.response); return res.status(201).json({ ok: true });
    }
    if (action === 'authenticate-verify') {
      res.setHeader('Set-Cookie', challengeCookie(req, '', 0));
      await service.authenticate(req, req.body.response);
      res.setHeader('Set-Cookie', [challengeCookie(req, '', 0), loginCookie(req)]);
      return res.json({ ok: true });
    }
    return res.status(400).json({ error: 'Nieprawidłowa operacja passkey.' });
  } catch (error) {
    // Internal verification errors need not disclose credential material.
    const expected = /^(Ustaw |ADMIN_ORIGIN |Dla passkey |Otwórz panel |Nieprawidłowy adres |Nie dodano |Podaj nazwę |Można zapisać |Brak próby |Próba passkey |Nieznany klucz |Nie wybrano |Klucz został |Nie udało)/.test(error.message);
    return res.status(400).json({ error: expected ? error.message : 'Nie udało się zweryfikować passkey. Rozpocznij ponownie lub użyj hasła.' });
  }
}
export const config = { api: { bodyParser: { sizeLimit: '128kb' } } };
