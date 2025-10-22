import { forwardRef, useEffect } from "react";

/**
 * Widoczny player. Zakładamy, że src jest już "gotowe" (preload wykonany osobno).
 */
const VideoPlayer = forwardRef(function VideoPlayer(
  {
    src,
    type = "video/mp4",
    onEnded,
    preventPauseResume = false,
    fillViewport = true,
  },
  ref
) {
  useEffect(() => {
    const el = ref?.current;
    if (!el) return;
    // Remontowanie: czyścimy i ładujemy świeże źródło
    try {
      el.pause?.();
      el.removeAttribute("src");
      while (el.firstChild) el.removeChild(el.firstChild);
      const source = document.createElement("source");
      source.src = src;
      source.type = type;
      el.appendChild(source);
      el.load();
      // graj jak tylko można
      const playSafe = () => el.play().catch(() => {});
      if (el.readyState >= 2) playSafe();
      else el.addEventListener("canplay", playSafe, { once: true });
    } catch {}
  }, [src, type, ref]);

  return (
    <video
      key={src}
      ref={ref}
      muted
      playsInline
      autoPlay
      preload="auto"
      crossOrigin="anonymous"
      disablePictureInPicture
      controls={false}
      className={`absolute top-0 left-0 w-full pointer-events-none ${
        fillViewport ? "" : ""
      }`}
      style={{
        height:
          typeof window !== "undefined" && window.visualViewport
            ? window.visualViewport.height
            : "100vh",
        visibility: "visible",
      }}
      onEnded={onEnded}
      onPause={() => {
        if (preventPauseResume && ref?.current?.play) ref.current.play();
      }}
      onSeeking={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
});

export default VideoPlayer;
