import { useState, useRef, useEffect, useCallback } from "react";
import axios from "axios";
import { useRouter } from "next/router";
import { useTranslation } from "next-i18next";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";

import StartScreen from "@/components/StartScreen";
import ScreentestModal from "@/components/ScreentestModal";
import VideoPlayer from "@/components/VideoPlayer";
import RatingPanel from "@/components/RatingPanel";
import ProgressBar from "@/components/ProgressBar";

import useSessionId from "@/hooks/useSessionId";
import useProlific from "@/hooks/useProlific";
import useFullscreen from "@/hooks/useFullscreen";
import useScreentestListener from "@/hooks/useScreentestListener";
import useVideoPrefetch from "@/hooks/useVideoPrefetch";

export default function Home() {
  const { t: trans } = useTranslation("common");
  const router = useRouter();

  // session + prolific
  const sessionId = useSessionId();
  const prolific = useProlific(router, sessionId);

  // ui / flow
  const [isScreentestOpen, setIsScreentestOpen] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [autoFullscreen, setAutoFullscreen] = useState(false);
  const [showRating, setShowRating] = useState(false);
  const [endScreen, setEndScreen] = useState(false);

  // video flow
  const [videoList, setVideoList] = useState([]);
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
  const [video, setVideo] = useState(null);
  const [nextVideo, setNextVideo] = useState(null);

  const ratingStartTime = useRef(null);
  const videoRef = useRef(null);

  // fullscreen on mobile
  const { isFullscreen } = useFullscreen();

  // preload hook (XHR -> Blob URL)
  const {
    progress,
    nextBlobUrl,
    nextMime,
    triggerLoad,
    readyFlag,
    clearReadyFlag,
    ensure,
  } = useVideoPrefetch();

  // mobile detection once
  useEffect(() => {
    if (typeof window !== "undefined") {
      const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
      setAutoFullscreen(isMobile);
    }
  }, []);

  // screentest listener → zapis + start oceny
  useScreentestListener(sessionId, async () => {
    let list = videoList;
    if (!list?.length) {
      try {
        const res = await axios.get("/api/video-list");
        list = res.data.videos.sort(() => Math.random() - 0.5);
        setVideoList(list);
      } catch (e) {
        console.error("Cannot fetch video list in start after screentest:", e);
        setIsScreentestOpen(false);
        return;
      }
    }

    setHasStarted(true);
    setIsScreentestOpen(false);
    setCurrentVideoIndex(0);
    setShowRating(false);
    ratingStartTime.current = null;

    setVideo(list[0] || null);
    setNextVideo(list[1] || null);

    // Preload pierwszego
    if (list[0]) triggerLoad(list[0], true);
  });

  // kiedy wchodzimy na stronę – pobierz listę i zapisz „user”
  const startAssessment = () => {
    axios.get("/api/video-list").then((res) => {
      const shuffled = res.data.videos.sort(() => Math.random() - 0.5);
      setVideoList(shuffled);

      const clientInfo = {
        userAgent: navigator.userAgent,
        language: navigator.language,
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };

      axios
        .post("/api/create-user", {
          sessionId,
          videoOrder: shuffled,
          clientInfo,
          autoFullscreen: autoFullscreen ? 1 : 0,
          prolific,
        })
        .catch((err) => console.error("Error saving user:", err));
    });

    setIsScreentestOpen(true);
  };

  // po „readyFlag” wstrzykujemy src wideo
  useEffect(() => {
    if (!readyFlag) return;
    clearReadyFlag();
    if (videoRef.current) {
      videoRef.current.type = nextMime || "video/mp4";
      videoRef.current.src = nextBlobUrl;
      try {
        videoRef.current.muted = true;
        videoRef.current.setAttribute("playsinline", "true");
        videoRef.current.setAttribute("autoplay", "true");
        // mobile auto fullscreen (bez „czekania na interakcję” jeśli się da)
        if (autoFullscreen && videoRef.current.requestFullscreen) {
          videoRef.current.requestFullscreen().catch(() => {});
        }
        videoRef.current.play().catch(() => {
          // fallback: klik wideo = play
          videoRef.current.addEventListener(
            "click",
            () => {
              videoRef.current.muted = true;
              videoRef.current.play().catch(() => {});
            },
            { once: true }
          );
        });
      } catch (e) {
        console.error("Video playback error", e);
      }
    }
  }, [readyFlag, nextBlobUrl, nextMime, clearReadyFlag, autoFullscreen]);

  // start preloadu dla next video
  useEffect(() => {
    if (!hasStarted || !videoList.length) return;

    const cur = videoList[currentVideoIndex];
    const nxt = videoList[currentVideoIndex + 1];

    setVideo(cur || null);
    setNextVideo(nxt || null);

    // 1) spróbuj natychmiast ustawić bieżący film z cache
    const hadInCache = ensure(cur);

    // 2) jeśli bieżącego nie było w cache (np. wejście z pominięciem prefetchu) – pobierz go
    if (!hadInCache && cur) triggerLoad(cur);

    // 3) prefetch kolejnego (o ile istnieje)
    if (nxt) triggerLoad(nxt);
  }, [hasStarted, currentVideoIndex, videoList, ensure, triggerLoad]);

  const handleVideoEnd = () => {
    ratingStartTime.current = Date.now();
    setShowRating(true);
  };

  const submitRating = useCallback(
    (value) => {
      if (!video) return;

      const duration = ratingStartTime.current
        ? (Date.now() - ratingStartTime.current) / 1000
        : null;

      axios
        .post("/api/rate-video", {
          sessionId,
          videoName: video.split("/").pop(),
          rating: value,
          duration,
        })
        .catch(() => {});

      // kolejny klip czy koniec?
      if (currentVideoIndex < videoList.length - 1) {
        setCurrentVideoIndex((i) => i + 1);
        setShowRating(false);
        ratingStartTime.current = null;
      } else {
        axios
          .post("/api/update-end-time", { sessionId })
          .then(() => setEndScreen(true))
          .catch((e) => console.error("Error saving end time:", e));
      }
    },
    [video, sessionId, currentVideoIndex, videoList.length]
  );

  // ekrany „start/koniec”
  if (!hasStarted || endScreen) {
    return (
      <StartScreen
        endScreen={endScreen}
        trans={trans}
        autoFullscreen={autoFullscreen}
        setAutoFullscreen={setAutoFullscreen}
        isFullscreen={isFullscreen}
        onStart={startAssessment}
      >
        <ScreentestModal
          open={isScreentestOpen}
          onClose={() => setIsScreentestOpen(false)}
          title={trans("screentest_title", "Test ekranu")}
        />
      </StartScreen>
    );
  }

  return (
    <div className="absolute top-0 left-0 w-full h-screen bg-gray-900 bg-opacity-75 text-white">
      {!showRating && video && (
        <VideoPlayer
          ref={videoRef}
          onEnded={handleVideoEnd}
          preventPauseResume
          fillViewport
        >
          {trans("video_tag_error")}
        </VideoPlayer>
      )}

      {!showRating && progress < 100 && (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-1/2">
          <ProgressBar value={progress} />
        </div>
      )}

      {showRating && (
        <RatingPanel
          trans={trans}
          onChoose={submitRating}
          disabled={isFullscreen}
        />
      )}
    </div>
  );
}

export async function getServerSideProps({ locale }) {
  return { props: { ...(await serverSideTranslations(locale, ["common"])) } };
}
