import { requireAdmin } from '../../../utils/admin-auth.cjs';
import { removeStimulus } from '../../../utils/remove-stimulus.cjs';

export default function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Ta operacja nie jest dostępna.' });
  try {
    return res.json(removeStimulus(req.body?.name));
  } catch (error) {
    const status = error.status || (error.message.startsWith('CSV') || error.message.includes('cudzysł') ? 400 : 500);
    return res.status(status).json({ error: status === 500 ? 'Nie udało się usunąć bodźca. Spróbuj ponownie.' : error.message });
  }
}
