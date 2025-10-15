import { useCallback, useRef, useState } from "react";
import { getBinaryAsBlobUrl } from "@/utils/xhr";

export default function useVideoPrefetch() {
  const [progress, setProgress] = useState(0);
  const [nextBlobUrl, setNextBlobUrl] = useState("");
  const [nextMime, setNextMime] = useState("video/mp4");
  const [readyFlag, setReadyFlag] = useState(false);
  const currentReq = useRef(null);

  // NOWE: cache pobranych klipów
  const cacheRef = useRef(new Map()); // key: url, val: { mime, blobUrl }

  const triggerLoad = useCallback(async (url) => {
    if (!url) return;
    // jeśli już mamy w cache – nie pobieraj ponownie
    if (cacheRef.current.has(url)) {
      const { mime, blobUrl } = cacheRef.current.get(url);
      setNextMime(mime);
      setNextBlobUrl(blobUrl);
      setReadyFlag(true);
      setProgress(100);
      return;
    }

    setProgress(0);
    if (currentReq.current?.abort) currentReq.current.abort();

    const { controller, onProgress } = getBinaryAsBlobUrl({
      url,
      onProgress: (pct) => setProgress(pct),
      onDone: ({ mime, blobUrl }) => {
        cacheRef.current.set(url, { mime, blobUrl }); // zapisz do cache
        setNextMime(mime);
        setNextBlobUrl(blobUrl);
        setReadyFlag(true);
      },
    });

    currentReq.current = controller;
    onProgress(true);
  }, []);

  // NOWE: wymuś ustawienie src z cache, jeżeli istnieje
  const ensure = useCallback((url) => {
    if (!url) return false;
    const hit = cacheRef.current.get(url);
    if (hit) {
      setNextMime(hit.mime);
      setNextBlobUrl(hit.blobUrl);
      setReadyFlag(true); // odpali efekt ustawiający <video>.src
      setProgress(100);
      return true;
    }
    return false;
  }, []);

  const clearReadyFlag = useCallback(() => setReadyFlag(false), []);

  return {
    // dane do UI
    progress,
    nextBlobUrl,
    nextMime,
    readyFlag,
    clearReadyFlag,
    // API
    triggerLoad, // pobierz (i zcache’uj) dany klip
    ensure, // ustaw z cache jeśli jest (bez pobierania)
  };
}
