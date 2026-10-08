/**
 * Pobiera binarkę przez XHR i zwraca Blob URL (MP4 jako domyślny MIME).
 * Zwraca:
 *  - controller: pozwala przerwać request
 *  - onProgress(initialLoad:boolean): start żądania
 */
export function getBinaryAsBlobUrl({ url, onProgress, onDone, onError }) {
  const xhr = new XMLHttpRequest();
  let aborted = false;

  function handleProgress(e) {
    if (e.lengthComputable && onProgress) {
      onProgress((e.loaded / e.total) * 100);
    }
  }

  function handleLoad(e) {
    if (aborted) return;
    if (xhr.status < 200 || xhr.status >= 300 || !e.target.response?.byteLength) {
      fail();
      return;
    }
    const type = xhr.getResponseHeader('Content-Type')?.split(';')[0] || "video/mp4";
    const blob = new Blob([e.target.response], { type });
    const blobUrl = URL.createObjectURL(blob);
    onDone?.({ mime: type, blobUrl });
  }

  function fail() { if (!aborted) onError?.(); }

  function start() {
    xhr.open("GET", url, true);
    // Nie ustawiaj A-C-A-O po stronie klienta – to nagłówek serwera.
    xhr.responseType = "arraybuffer";
    xhr.onprogress = handleProgress;
    xhr.onload = handleLoad;
    xhr.onerror = fail;
    xhr.ontimeout = fail;
    xhr.timeout = 300000;
    xhr.send();
  }

  return {
    controller: {
      abort: () => {
        aborted = true;
        try {
          xhr.abort();
        } catch {}
      },
    },
    onProgress: start,
  };
}
