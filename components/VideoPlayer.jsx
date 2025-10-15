import { forwardRef } from "react";

const VideoPlayer = forwardRef(function VideoPlayer(
  { onEnded, preventPauseResume = false, fillViewport = false, children },
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
      onPause={() => {
        if (preventPauseResume && ref?.current?.play) ref.current.play();
      }}
      onSeeking={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </video>
  );
});

export default VideoPlayer;
