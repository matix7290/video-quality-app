import db from '../../../database';
import { requireAdmin } from '../../../utils/admin-auth.cjs';
import { passwordConfigured } from '../../../utils/admin-password.cjs';
import { createTotpService } from '../../../utils/admin-totp.cjs';
const totp = createTotpService(db);

export default function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (!passwordConfigured()) return res.status(403).json({ error: 'Najpierw ustaw hasło administratora.' });
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') return res.json({ enabled: totp.enabled() });
    if (req.method !== 'POST') return res.status(405).json({ error: 'Ta operacja nie jest dostępna.' });
    const action = req.body?.action;
    if (action === 'start') return res.json(totp.start(req.cookies.study_admin));
    if (action === 'activate') {
      if (!totp.activate(req.cookies.study_admin, req.body?.code)) return res.status(400).json({ error: 'Nieprawidłowy kod lub konfiguracja wygasła. Zacznij ponownie.' });
      return res.json({ enabled: true });
    }
    if (action === 'disable') {
      if (!totp.disable(req.body?.code)) return res.status(400).json({ error: 'Nieprawidłowy lub wykorzystany kod uwierzytelniający.' });
      return res.json({ enabled: false });
    }
    return res.status(400).json({ error: 'Nieprawidłowa operacja.' });
  } catch {
    return res.status(500).json({ error: 'Nie udało się zmienić ustawień weryfikacji dwuetapowej.' });
  }
}
export const config = { api: { bodyParser: { sizeLimit: '8kb' } } };
