import { useCallback, useEffect, useRef, useState } from "react";
import { getBinaryAsBlobUrl } from "@/utils/xhr";
import { BlobCache } from "@/utils/blob-cache.cjs";

export default function useVideoPrefetch() {
  const [progress, setProgress] = useState(0);
  const [nextBlobUrl, setNextBlobUrl] = useState("");
  const [nextMime, setNextMime] = useState("video/mp4");
  const [readyFlag, setReadyFlag] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const currentReq = useRef(null);

  const cacheRef = useRef(null);
  if (!cacheRef.current) cacheRef.current = new BlobCache(url => URL.revokeObjectURL(url));
  useEffect(() => {
    const cache = cacheRef.current;
    return () => {
      currentReq.current?.abort();
      cache.clear();
    };
  }, []);

  const triggerLoad = useCallback(async (url) => {
    if (!url) return;
    currentReq.current?.abort();
    setLoadError(false);
    setReadyFlag(false);
    // jeśli już mamy w cache – nie pobieraj ponownie
    const hit = cacheRef.current.get(url);
    if (hit) {
      const { mime, blobUrl } = hit;
      setNextMime(mime);
      setNextBlobUrl(blobUrl);
      setReadyFlag(true);
      setProgress(100);
      return;
    }

    setProgress(0);

    const { controller, onProgress } = getBinaryAsBlobUrl({
      url,
      onProgress: (pct) => setProgress(pct),
      onDone: ({ mime, blobUrl, size }) => {
        cacheRef.current.set(url, { mime, blobUrl, size });
        setNextMime(mime);
        setNextBlobUrl(blobUrl);
        setReadyFlag(true);
      },
      onError: () => { setLoadError(true); setProgress(0); },
    });

    currentReq.current = controller;
    onProgress(true);
  }, []);

  const retryLoad = useCallback((url) => {
    cacheRef.current.delete(url);
    triggerLoad(url);
  }, [triggerLoad]);

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
    loadError,
    retryLoad,
    clearReadyFlag,
    // API
    triggerLoad, // pobierz (i zcache’uj) dany klip
    ensure, // ustaw z cache jeśli jest (bez pobierania)
  };
}
