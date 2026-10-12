const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { setImmediate: yieldToRequests } = require('node:timers/promises');

function csvValue(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
async function streamResultsCsv(db, type, completeOnly, res) {
  const ratings = type === 'ratings';
  const columns = ratings
    ? ['session_id', 'study_version', 'prolific_pid', 'video_name', 'stimulus_type', 'phase', 'first_phase', 'phase_position', 'scale_type', 'rating', 'duration', 'timestamp', 'start_time', 'end_time']
    : ['session_id', 'study_version', 'video_name', 'stimulus_type', 'phase', 'first_phase', 'phase_position', 'scale_type', 'question_id', 'question', 'answer', 'correct_answer', 'is_correct'];
  const version = "COALESCE(json_extract(u.settings_snapshot, '$.version'), 'legacy') AS study_version";
  const firstPhase = `COALESCE(json_extract(u.settings_snapshot, '$.phaseSequence[0]'),
    CASE WHEN json_extract(u.settings_snapshot, '$.mode') = 'slider'
      OR json_extract(u.settings_snapshot, '$.phaseOrder') = 'slider-first' THEN 'slider' ELSE 'standard' END)`;
  const order = `${firstPhase} AS first_phase, CASE WHEN r.phase = ${firstPhase} THEN 1 ELSE 2 END AS phase_position`;
  const table = ratings ? 'ratings' : 'control_answers', source = ratings ? 'r' : 'a';
  // Bound the export to rows already stored; do not chase new answers indefinitely.
  const upper = db.prepare(`SELECT COALESCE(MAX(id), 0) AS id FROM ${table}`).get().id;
  const where = `WHERE ${source}.id > ? AND ${source}.id <= ? ${completeOnly ? 'AND u.end_time IS NOT NULL' : ''}`;
  const query = db.prepare(ratings
    ? `SELECT r.id AS cursor, u.session_id, ${version}, ${order}, u.prolific_pid, r.video_name, r.stimulus_type, r.phase, r.scale_type, r.rating, r.duration, r.timestamp, u.start_time, u.end_time FROM ratings r JOIN users u ON u.id = r.user_id ${where} ORDER BY r.id LIMIT 500`
    : `SELECT a.id AS cursor, u.session_id, ${version}, ${order}, r.video_name, r.stimulus_type, r.phase, r.scale_type, a.question_id, a.question, a.answer, a.correct_answer, a.is_correct FROM control_answers a JOIN ratings r ON r.id = a.rating_id JOIN users u ON u.id = r.user_id ${where} ORDER BY a.id LIMIT 500`);
  async function* chunks() {
    yield '\uFEFF' + columns.join(',') + '\r\n';
    let cursor = 0;
    while (!res.destroyed) {
      const rows = query.all(cursor, upper);
      if (!rows.length) break;
      yield rows.map(row => columns.map(column => csvValue(row[column])).join(',')).join('\r\n') + '\r\n';
      cursor = rows[rows.length - 1].cursor;
      // Let participant writes run between batches; pipeline respects slow clients.
      await yieldToRequests();
    }
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${type}.csv"`);
  await pipeline(Readable.from(chunks()), res);
}
module.exports = { streamResultsCsv };
