import { sessionSettings, phases } from '../../utils/study-config.cjs';
import db from '../../database';
import { validateResponse } from '../../utils/study.cjs';
import { questionsForPhase } from '../../utils/questions.cjs';
export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { sessionId, videoName, rating, duration, phase = 'standard', answers = [] } = req.body || {};
  const user = typeof sessionId === 'string' && db.prepare('SELECT * FROM users WHERE session_id = ?').get(sessionId);
  if (!user) return res.status(404).json({ error: 'Session not found' });
  const playlist = JSON.parse(user.playlist);
  if (!playlist.some(url => decodeURIComponent(url.split('/').pop()) === videoName)) {
    return res.status(400).json({ error: 'Video not in session playlist' });
  }
  const settings = sessionSettings(user);
  const studyPhases = phases(settings);
  if (!studyPhases.includes(phase)) return res.status(400).json({ error: 'Phase not enabled for this session' });
  const questions = questionsForPhase(JSON.parse(user.questions_snapshot)[videoName] || [], settings, phase);
  try { validateResponse({ rating, duration, phase, answers }, questions, settings); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  if (studyPhases.length === 2 && phase === studyPhases[1]) {
    const rated = db.prepare('SELECT DISTINCT video_name FROM ratings WHERE user_id = ? AND phase = ?').all(user.id, studyPhases[0]);
    if (playlist.some(url => !rated.some(r => r.video_name === decodeURIComponent(url.split('/').pop())))) {
      return res.status(409).json({ error: 'Complete the first phase before starting the second' });
    }
  }
  try {
    db.transaction(() => {
      // Retrying a request after a lost response must not duplicate observations.
      const existing = db.prepare('SELECT id FROM ratings WHERE user_id = ? AND video_name = ? AND phase = ?').get(user.id, videoName, phase);
      if (existing) return;
      const clipName = videoName.match(/^([^_]+)/)?.[1] || 'Unknown';
      const vmaf = videoName.match(/_vmaf_(\d+)/)?.[1];
      const result = db.prepare(`INSERT INTO ratings
        (user_id, video_name, clip_name, vmaf, rating, duration, phase, scale_type, stimulus_type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(user.id, videoName, clipName, vmaf ? Number(vmaf) : null,
        rating, duration, phase, phase === 'slider' ? 'continuous' : 'categorical', settings.stimulusType);
      const insert = db.prepare(`INSERT INTO control_answers
        (rating_id, question_id, question, answer, correct_answer, is_correct) VALUES (?, ?, ?, ?, ?, ?)`);
      for (const question of questions) {
        const answer = answers.find(a => a.questionId === question.id).answer;
        insert.run(result.lastInsertRowid, question.id, question.question, Number(answer),
          question.correctAnswer === null ? null : Number(question.correctAnswer),
          question.correctAnswer === null ? null : Number(answer === question.correctAnswer));
      }
    })();
    return res.json({ message: 'Rating saved successfully' });
  } catch (error) {
    console.error('Error saving response:', error);
    return res.status(500).json({ error: 'Cannot save response' });
  }
}
