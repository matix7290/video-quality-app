import db from '../../../database';
import { requireAdmin } from '../../../utils/admin-auth.cjs';
import { streamResultsCsv } from '../../../utils/results-csv.cjs';

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    if (!req.query.type) {
      return res.json({ sessions: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
        completed: db.prepare('SELECT COUNT(*) AS n FROM users WHERE end_time IS NOT NULL').get().n,
        ratings: db.prepare('SELECT COUNT(*) AS n FROM ratings').get().n,
        answers: db.prepare('SELECT COUNT(*) AS n FROM control_answers').get().n });
    }
    if (!['ratings', 'answers'].includes(req.query.type)) return res.status(400).json({ error: 'Invalid export' });
    await streamResultsCsv(db, req.query.type, req.query.complete === '1', res);
  } catch (error) {
    if (res.destroyed) return;
    console.error('Cannot export results:', error);
    if (res.headersSent) return res.destroy();
    return res.status(500).json({ error: 'Cannot export results' });
  }
}
export const config = { api: { responseLimit: false } };
