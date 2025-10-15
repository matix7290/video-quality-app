import db from "../../database";

export default function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const {
    sessionId,
    videoOrder,
    clientInfo,
    autoFullscreen,
    prolific,
    PROLIFIC_PID,
    STUDY_ID,
    SESSION_ID,
  } = req.body || {};

  if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });
  if (!videoOrder) return res.status(400).json({ error: "Missing videoOrder" });
  if (!clientInfo) return res.status(400).json({ error: "Missing clientInfo" });
  if (autoFullscreen === undefined)
    return res.status(400).json({ error: "Missing autoFullscreen" });

  // Wyciągnij wartości Prolific (obsługa obu form: obiekt + osobne pola)
  const prolific_pid = prolific?.PROLIFIC_PID ?? PROLIFIC_PID ?? null;
  const prolific_study_id = prolific?.STUDY_ID ?? STUDY_ID ?? null;
  const prolific_session_id = prolific?.SESSION_ID ?? SESSION_ID ?? null;

  try {
    // Idempotentny INSERT z aktualizacją po session_id
    const stmt = db.prepare(`
      INSERT INTO users (
        session_id, playlist, client_info, auto_fullscreen,
        prolific_pid, prolific_study_id, prolific_session_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        playlist = excluded.playlist,
        client_info = excluded.client_info,
        auto_fullscreen = excluded.auto_fullscreen,
        prolific_pid = COALESCE(excluded.prolific_pid, users.prolific_pid),
        prolific_study_id = COALESCE(excluded.prolific_study_id, users.prolific_study_id),
        prolific_session_id = COALESCE(excluded.prolific_session_id, users.prolific_session_id)
    `);

    stmt.run(
      sessionId,
      JSON.stringify(videoOrder),
      JSON.stringify(clientInfo),
      autoFullscreen ? 1 : 0,
      prolific_pid,
      prolific_study_id,
      prolific_session_id
    );

    return res.status(201).json({
      message: "User created/updated successfully",
      sessionId,
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
