import db from '../../../database';
import { requireAdmin } from '../../../utils/admin-auth.cjs';
function csvValue(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export default function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!req.query.type) {
    return res.json({ sessions: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
      completed: db.prepare('SELECT COUNT(*) AS n FROM users WHERE end_time IS NOT NULL').get().n,
      ratings: db.prepare('SELECT COUNT(*) AS n FROM ratings').get().n,
      answers: db.prepare('SELECT COUNT(*) AS n FROM control_answers').get().n });
  }
  if (!['ratings', 'answers'].includes(req.query.type)) return res.status(400).json({ error: 'Invalid export' });
  const complete = req.query.complete === '1' ? 'WHERE u.end_time IS NOT NULL' : '';
  const columns = req.query.type === 'ratings'
    ? ['session_id', 'study_version', 'prolific_pid', 'video_name', 'stimulus_type', 'phase', 'first_phase', 'phase_position', 'scale_type', 'rating', 'duration', 'timestamp', 'start_time', 'end_time']
    : ['session_id', 'study_version', 'video_name', 'stimulus_type', 'phase', 'first_phase', 'phase_position', 'scale_type', 'question_id', 'question', 'answer', 'correct_answer', 'is_correct'];
  const version = "COALESCE(json_extract(u.settings_snapshot, '$.version'), 'legacy') AS study_version";
  const firstPhase = `COALESCE(json_extract(u.settings_snapshot, '$.phaseSequence[0]'),
    CASE WHEN json_extract(u.settings_snapshot, '$.mode') = 'slider'
      OR json_extract(u.settings_snapshot, '$.phaseOrder') = 'slider-first' THEN 'slider' ELSE 'standard' END)`;
  const order = `${firstPhase} AS first_phase, CASE WHEN r.phase = ${firstPhase} THEN 1 ELSE 2 END AS phase_position`;
  const rows = req.query.type === 'ratings'
    ? db.prepare(`SELECT u.session_id, ${version}, ${order}, u.prolific_pid, r.video_name, r.stimulus_type, r.phase, r.scale_type, r.rating, r.duration, r.timestamp, u.start_time, u.end_time FROM ratings r JOIN users u ON u.id = r.user_id ${complete} ORDER BY r.id`).all()
    : db.prepare(`SELECT u.session_id, ${version}, ${order}, r.video_name, r.stimulus_type, r.phase, r.scale_type, a.question_id, a.question, a.answer, a.correct_answer, a.is_correct FROM control_answers a JOIN ratings r ON r.id = a.rating_id JOIN users u ON u.id = r.user_id ${complete} ORDER BY a.id`).all();
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${req.query.type}.csv"`);
  return res.send('\uFEFF' + columns.join(',') + '\r\n' + rows.map(row => columns.map(column => csvValue(row[column])).join(',')).join('\r\n'));
}
