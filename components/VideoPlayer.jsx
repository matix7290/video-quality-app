import { forwardRef } from "react";

const VideoPlayer = forwardRef(function VideoPlayer(
  { onEnded, onError, preventPauseResume = false, children },
  ref
) {
  return (
    <video
      ref={ref}
      muted
      playsInline
      autoPlay
      className="absolute top-0 left-0 w-full pointer-events-none"
      style={{
        height:
          typeof window !== "undefined" && window.visualViewport
            ? window.visualViewport.height
            : "100vh",
      }}
      onEnded={onEnded}
      onError={onError}
      onPause={() => {
        if (preventPauseResume && ref?.current && !ref.current.ended) ref.current.play().catch(() => {});
      }}
      onSeeking={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </video>
  );
});

export default VideoPlayer;
