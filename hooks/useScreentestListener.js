import { useEffect, useRef } from "react";
import axios from "axios";

/**
 * Nasłuchuje postMessage z screentestu i:
 * - zapisuje payload na backend /api/screentest
 * - odpala callback startu oceny
 */
export default function useScreentestListener(sessionId, onDone, { onSaving, onError } = {}) {
  const saving = useRef(false);
  useEffect(() => {
    async function handleMessage(event) {
      if (event.origin !== window.location.origin || event.source !== document.querySelector('iframe')?.contentWindow) return;
      if (!event.data || event.data.type !== "SCREENTEST_RESULT") return;
      if (!sessionId || saving.current) return;
      saving.current = true;
      onSaving?.(true);
      try {
        await axios.post("/api/screentest", { sessionId, payload: event.data.payload });
        onDone?.();
      } catch { onError?.(); }
      finally { saving.current = false; onSaving?.(false); }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [sessionId, onDone, onSaving, onError]);
}
