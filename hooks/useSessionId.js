import { useEffect, useState } from "react";
import { v4 as uuidv4 } from "uuid";

export default function useSessionId() {
  const [sessionId, setSessionId] = useState(null);

  useEffect(() => {
    let stored = null;
    try {
      stored = localStorage.getItem("sessionId");
      if (!stored) {
        stored = uuidv4();
        localStorage.setItem("sessionId", stored);
      }
    } catch {}
    setSessionId(stored);
  }, []);

  return sessionId;
}
