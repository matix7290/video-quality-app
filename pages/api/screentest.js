import db from "../../database";

export default function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method Not Allowed" });

  const { sessionId, payload } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });
  if (!payload || typeof payload !== "object")
    return res.status(400).json({ error: "Missing payload" });

  const toNull = (v) =>
    v === undefined || v === null || (typeof v === "number" && Number.isNaN(v))
      ? null
      : v;

  const coerce = (v) => {
    const val = toNull(v);
    if (val === null) return null;
    const t = typeof val;
    if (t === "number" || t === "string" || t === "bigint") return val;
    if (t === "boolean") return val ? 1 : 0;
    if (Buffer.isBuffer(val)) return val;
    try {
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  };

  const safeStr = (v) => (v == null ? null : String(v));

  try {
    // 🔹 Pobranie user_id z tabeli users na podstawie session_id
    const userRow = db
      .prepare("SELECT id FROM users WHERE session_id = ?")
      .get(sessionId);

    const userId = userRow ? userRow.id : null;

    // --- Rozbicie payloadu ---
    const data = {
      session_id: sessionId,
      user_id: userId, // nowo dodane pole
      screen_resolution: safeStr(payload.screen),
      browser_ua: safeStr(payload.browser),
      smallest_number: payload.smallestNumber,
      highest_number: payload.highestNumber,
      black_stars: payload.blackStars,
      focustime: payload.focustime,
      click_no: payload.clickNo,
      click_counter: payload.clickCounter,
      reliability: payload.reliability,
    };

    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_screentests_session ON screentests(session_id);`
    );

    const bindings = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, coerce(v)])
    );

    if (process.env.NODE_ENV !== "production") {
      const types = Object.fromEntries(
        Object.entries(bindings).map(([k, v]) => [
          k,
          v === null ? "null" : typeof v,
        ])
      );
      console.debug("screentest bindings types:", types);
    }

    const upsert = db.prepare(`
      INSERT INTO screentests (
        session_id, user_id, screen_resolution, browser_ua,
        smallest_number, highest_number, black_stars,
        focustime, click_no, click_counter, reliability
      ) VALUES (
        @session_id, @user_id, @screen_resolution, @browser_ua,
        @smallest_number, @highest_number, @black_stars,
        @focustime, @click_no, @click_counter, @reliability
      )
      ON CONFLICT(session_id) DO UPDATE SET
        user_id          = excluded.user_id,
        screen_resolution = excluded.screen_resolution,
        browser_ua        = excluded.browser_ua,
        smallest_number   = excluded.smallest_number,
        highest_number    = excluded.highest_number,
        black_stars       = excluded.black_stars,
        focustime         = excluded.focustime,
        click_no          = excluded.click_no,
        click_counter     = excluded.click_counter,
        reliability       = excluded.reliability
    `);

    upsert.run(bindings);
    return res.status(201).json({ ok: true, sessionId, userId });
  } catch (err) {
    console.error("Error saving screentest:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
