import db from '../../../database';
import { requireAdmin } from '../../../utils/admin-auth.cjs';
import { streamResultsCsv } from '../../../utils/results-csv.cjs';
import { streamResultsDatabase } from '../../../utils/results-db.cjs';

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (!['GET', 'DELETE'].includes(req.method)) return res.status(405).json({ error: 'Ta operacja nie jest dostępna.' });
  try {
    if (req.method === 'DELETE') {
      if (req.body?.confirmation !== 'DELETE_ALL_RESULTS') return res.status(400).json({ error: 'Brak potwierdzenia usunięcia wszystkich wyników.' });
      db.transaction(() => {
        db.prepare('DELETE FROM control_answers').run();
        db.prepare('DELETE FROM ratings').run();
        db.prepare('DELETE FROM screentests').run();
        db.prepare('DELETE FROM users').run();
      })();
      return res.json({ sessions: 0, completed: 0, ratings: 0, answers: 0 });
    }
    if (!req.query.type) {
      return res.json({ sessions: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
        completed: db.prepare('SELECT COUNT(*) AS n FROM users WHERE end_time IS NOT NULL').get().n,
        ratings: db.prepare('SELECT COUNT(*) AS n FROM ratings').get().n,
        answers: db.prepare('SELECT COUNT(*) AS n FROM control_answers').get().n });
    }
    if (req.query.type === 'database') return await streamResultsDatabase(db, res);
    if (!['ratings', 'answers'].includes(req.query.type)) return res.status(400).json({ error: 'Nieprawidłowy rodzaj pobieranych wyników.' });
    await streamResultsCsv(db, req.query.type, req.query.complete === '1', res);
  } catch (error) {
    if (res.destroyed) return;
    console.error(req.method === 'DELETE' ? 'Cannot delete results:' : 'Cannot export results:', error);
    if (res.headersSent) return res.destroy();
    return res.status(500).json({ error: req.method === 'DELETE' ? 'Nie udało się usunąć wyników. Spróbuj ponownie.' : 'Nie udało się pobrać wyników.' });
  }
}
export const config = { api: { responseLimit: false } };
