import { sessionSettings, phases } from '../../utils/study-config.cjs';
import db from "../../database";
import { readStudy, publicQuestions } from '../../utils/study.cjs';

export default function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const {
    sessionId,
    videoOrder,
    clientInfo,
    prolific,
    PROLIFIC_PID,
    STUDY_ID,
    SESSION_ID,
  } = req.body || {};

  if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId.length > 200) return res.status(400).json({ error: "Invalid sessionId" });
  if (!Array.isArray(videoOrder)) return res.status(400).json({ error: "Invalid videoOrder" });
  if (!clientInfo || typeof clientInfo !== 'object' || Array.isArray(clientInfo)) return res.status(400).json({ error: "Invalid clientInfo" });

  // Wyciągnij wartości Prolific (obsługa obu form: obiekt + osobne pola)
  const prolific_pid = prolific?.PROLIFIC_PID ?? PROLIFIC_PID ?? null;
  const prolific_study_id = prolific?.STUDY_ID ?? STUDY_ID ?? null;
  const prolific_session_id = prolific?.SESSION_ID ?? SESSION_ID ?? null;
  if ([prolific_pid, prolific_study_id, prolific_session_id].some(value => value !== null && (typeof value !== 'string' || value.length > 200))) {
    return res.status(400).json({ error: 'Invalid Prolific identifiers' });
  }

  try {
    const existing = db.prepare('SELECT playlist, questions_snapshot, settings_snapshot, auto_fullscreen FROM users WHERE session_id = ?').get(sessionId);
    if (existing) return res.json({ sessionId, videoOrder: JSON.parse(existing.playlist), questions: publicQuestions(JSON.parse(existing.questions_snapshot)), settings: sessionSettings(existing) });
    const study = readStudy();
    if (!Array.isArray(videoOrder) || !study.videos.length || videoOrder.length !== study.videos.length ||
        new Set(videoOrder).size !== videoOrder.length || videoOrder.some(url => !study.videos.includes(url))) {
      return res.status(400).json({ error: 'Konfiguracja filmów zmieniła się. Odśwież stronę i spróbuj ponownie.' });
    }
    if (req.body.configVersion && req.body.configVersion !== study.settings.version) {
      return res.status(409).json({ error: 'Konfiguracja badania zmieniła się. Odśwież stronę i spróbuj ponownie.' });
    }
    // Serialize allocation and insertion so parallel starts and retries cannot skew 50/50.
    const allocation = db.transaction(() => {
      const existing = db.prepare('SELECT playlist, questions_snapshot, settings_snapshot, auto_fullscreen FROM users WHERE session_id = ?').get(sessionId);
      if (existing) return { existing };
      const settings = { ...study.settings };
      if (settings.mode === 'both' && settings.phaseOrder === 'balanced') {
        const { count } = db.prepare(`SELECT COUNT(*) AS count FROM users
          WHERE json_extract(settings_snapshot, '$.version') = ?
          AND json_extract(settings_snapshot, '$.mode') = 'both'
          AND json_extract(settings_snapshot, '$.phaseOrder') = 'balanced'`).get(settings.version);
        settings.phaseSequence = count % 2 ? ['slider', 'standard'] : ['standard', 'slider'];
      } else settings.phaseSequence = phases(settings);
      // Store the question configuration used for this session.
      const stmt = db.prepare(`
        INSERT INTO users (
          session_id, playlist, client_info, auto_fullscreen,
          prolific_pid, prolific_study_id, prolific_session_id, questions_snapshot, settings_snapshot
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        sessionId,
        JSON.stringify(videoOrder),
        JSON.stringify(clientInfo),
        settings.autoFullscreen ? 1 : 0,
        prolific_pid,
        prolific_study_id,
        prolific_session_id,
        JSON.stringify(study.questions),
        JSON.stringify(settings)
      );
      return { settings };
    }).immediate();
    if (allocation.existing) return res.json({ sessionId, videoOrder: JSON.parse(allocation.existing.playlist), questions: publicQuestions(JSON.parse(allocation.existing.questions_snapshot)), settings: sessionSettings(allocation.existing) });

    return res.status(201).json({
      message: "User created/updated successfully",
      sessionId,
      videoOrder,
      questions: publicQuestions(study.questions),
      settings: allocation.settings,
      prolific: {
        PROLIFIC_PID: prolific_pid,
        STUDY_ID: prolific_study_id,
        SESSION_ID: prolific_session_id,
      },
    });
  } catch (error) {
    console.error("Error creating/updating user:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
