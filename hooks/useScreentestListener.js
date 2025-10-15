import { useEffect } from "react";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";

/**
 * Nasłuchuje postMessage z screentestu i:
 * - zapisuje payload na backend /api/screentest
 * - odpala callback startu oceny
 */
export default function useScreentestListener(sessionId, onDone) {
  useEffect(() => {
    function handleMessage(event) {
      if (!event.data || event.data.type !== "SCREENTEST_RESULT") return;

      axios
        .post("/api/screentest", {
          sessionId: sessionId || uuidv4(),
          payload: event.data.payload,
        })
        .catch((err) => console.error("Error saving screentest", err));

      onDone?.();
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [sessionId, onDone]);
}
