import { useEffect, useState } from "react";
import axios from "axios";

/**
 * Parsuje PROLIFIC_PID/STUDY_ID/SESSION_ID z query, zapisuje:
 * - setState
 * - localStorage
 * - cookie
 * - wysyła na backend /api/save-prolific
 */
export default function useProlific(router, sessionId) {
  const [prolific, setProlific] = useState(null);

  useEffect(() => {
    if (!router.isReady) return;

    const qs =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search)
        : null;

    const pid = router.query.PROLIFIC_PID || qs?.get("PROLIFIC_PID");
    const sid = router.query.STUDY_ID || qs?.get("STUDY_ID");
    const sess = router.query.SESSION_ID || qs?.get("SESSION_ID");

    const commit = (data) => {
      setProlific(data);
      try {
        localStorage.setItem("prolific", JSON.stringify(data));
        document.cookie = `prolific=${encodeURIComponent(
          JSON.stringify(data)
        )}; Max-Age=31536000; Path=/; SameSite=Lax`;
      } catch {}
    };

    if (pid || sid || sess) {
      const data = {
        PROLIFIC_PID: pid ?? null,
        STUDY_ID: sid ?? null,
        SESSION_ID: sess ?? null,
      };
      commit(data);

      axios
        .post("/api/save-prolific", {
          sessionId: sessionId || localStorage.getItem("sessionId"),
          ...data,
        })
        .catch((err) => console.error("Error saving prolific", err));
    } else {
      // Restore if present
      try {
        const cached = localStorage.getItem("prolific");
        if (cached) setProlific(JSON.parse(cached));
      } catch {}
    }
  }, [router.isReady, router.query, sessionId]);

  return prolific;
}
