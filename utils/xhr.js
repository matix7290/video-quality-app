/**
 * Pobiera binarkę przez XHR i zwraca Blob URL (MP4 jako domyślny MIME).
 * Zwraca:
 *  - controller: pozwala przerwać request
 *  - onProgress(initialLoad:boolean): start żądania
 */
export function getBinaryAsBlobUrl({ url, onProgress, onDone }) {
  let xhr = new XMLHttpRequest();
  let aborted = false;

  function handleProgress(e) {
    if (e.lengthComputable && onProgress) {
      onProgress((e.loaded / e.total) * 100);
    }
  }

  function handleLoad(e) {
    if (aborted) return;
    const type = "video/mp4";
    const blob = new Blob([e.target.response], { type });
    const blobUrl = URL.createObjectURL(blob);
    onDone?.({ mime: type, blobUrl });
  }

  function start() {
    xhr.open("GET", url, true);
    // Nie ustawiaj A-C-A-O po stronie klienta – to nagłówek serwera.
    xhr.responseType = "arraybuffer";
    xhr.onprogress = handleProgress;
    xhr.onload = handleLoad;
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
