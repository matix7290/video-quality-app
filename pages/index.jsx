import { useState, useRef, useEffect, useCallback } from "react";
import axios from "axios";
import { useTranslation } from "next-i18next";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import { v4 as uuidv4 } from "uuid";

import StartScreen from "@/components/StartScreen";
import ScreentestModal from "@/components/ScreentestModal";
import VideoPlayer from "@/components/VideoPlayer";
import RatingPanel from "@/components/RatingPanel";
import Loader from "@/components/Loader";

export default function Home() {
  const { t: trans } = useTranslation("common");

  // --- Sesja / Prolific (prosty wariant)
  const [sessionId, setSessionId] = useState(null);
  useEffect(() => {
    let s = localStorage.getItem("sessionId");
    if (!s) {
      s = uuidv4();
      localStorage.setItem("sessionId", s);
    }
    setSessionId(s);
  }, []);

  // --- Stany aplikacji
  const [hasStarted, setHasStarted] = useState(false);
  const [isScreentestOpen, setIsScreentestOpen] = useState(false);
  const [showRating, setShowRating] = useState(false);
  const [endScreen, setEndScreen] = useState(false);

  // --- Źródła wideo (double-buffer)
  const [currentSrc, setCurrentSrc] = useState(null); // to gra teraz (widoczne)
  const [nextSrc, setNextSrc] = useState(null); // to preloadujemy w tle

  // --- Pasek ładowania dla PRELOAD (ukrytego wideo)
  const [preloadPercent, setPreloadPercent] = useState(null);
  const [preloadReady, setPreloadReady] = useState(false);

  // --- Referencje do video
  const visibleVideoRef = useRef(null);
  const preloadVideoRef = useRef(null);

  const ratingStartTime = useRef(null);

  // ---- Funkcje pomocnicze ----
  const getNextFromAPI = useCallback(
    async (excludeId = "") => {
      const url = `/api/random-video?sessionId=${
        sessionId || ""
      }&exclude=${excludeId}`;
      const { data } = await axios.get(url, {
        timeout: 15000,
        headers: { "Cache-Control": "no-store" },
      });
      return data?.video || null;
    },
    [sessionId]
  );

  const hardResetVideo = (el) => {
    if (!el) return;
    try {
      el.pause?.();
      el.removeAttribute("src");
      while (el.firstChild) el.removeChild(el.firstChild);
      el.load();
    } catch {}
  };

  // --- Uruchomienie badania (po screenteście)
  const startAssessment = async () => {
    setIsScreentestOpen(true);
  };

  // Tu w prawdziwej aplikacji nasłuchujesz zamknięcia screentest i dopiero startujesz.
  // Dla uproszczenia: kiedy modal się otworzył, zaraz go zamknij i startuj.
  useEffect(() => {
    if (!isScreentestOpen) return;
    (async () => {
      setIsScreentestOpen(false);
      setHasStarted(true);

      // Pobierz PIERWSZY klip (grający) i DRUGI (do preloadu)
      const first = await getNextFromAPI("");
      if (!first) {
        setEndScreen(true);
        return;
      }
      setCurrentSrc(first);

      const second = await getNextFromAPI(first.split("/").pop());
      setNextSrc(second);
    })();
  }, [isScreentestOpen, getNextFromAPI]);

  // --- PRELOAD hidden video: kiedy nextSrc się zmienia, preloaduj
  useEffect(() => {
    const el = preloadVideoRef.current;
    if (!el || !nextSrc) return;

    setPreloadPercent(0);
    setPreloadReady(false);

    // Wyczyść i ustaw nowe źródło do preloadu
    hardResetVideo(el);
    try {
      const source = document.createElement("source");
      source.src = nextSrc; // BEZ cache-bustera — chcemy cache!
      source.type = "video/mp4";
      el.appendChild(source);
      el.preload = "auto";

      const onProgress = () => {
        try {
          if (!Number.isFinite(el.duration) || el.duration <= 0) {
            setPreloadPercent(null); // indeterminate
            return;
          }
          if (el.buffered && el.buffered.length > 0) {
            const end = el.buffered.end(el.buffered.length - 1);
            const ratio = Math.max(0, Math.min(1, end / el.duration));
            setPreloadPercent(ratio * 100);
          }
        } catch {
          setPreloadPercent(null);
        }
      };

      const onCanPlayThrough = () => {
        setPreloadReady(true);
        setPreloadPercent(100);
      };

      el.addEventListener("progress", onProgress);
      el.addEventListener("loadedmetadata", onProgress);
      el.addEventListener("canplay", onProgress);
      el.addEventListener("canplaythrough", onCanPlayThrough, { once: true });
      el.load();
    } catch {
      setPreloadPercent(null);
    }
  }, [nextSrc]);

  // --- Zakończenie odtwarzania: pokaż rating
  const handleEnded = () => {
    ratingStartTime.current = Date.now();
    setShowRating(true);
  };

  // --- Po ocenie: natychmiast przełącz na preloadowane nextSrc i rozpocznij preload kolejnego
  const submitRating = async (value) => {
    if (!currentSrc) return;
    const duration =
      ratingStartTime.current != null
        ? (Date.now() - ratingStartTime.current) / 1000
        : null;

    try {
      await axios.post("/api/rate-video", {
        sessionId,
        videoName: currentSrc.split("/").pop(),
        rating: value,
        duration,
      });
    } catch {}

    setShowRating(false);
    ratingStartTime.current = null;

    // 1) przełącz widoczny player na nextSrc (już gotowe), więc natychmiast gra
    if (nextSrc) setCurrentSrc(nextSrc);

    // 2) pobierz kolejne do preloadu
    const excludeId = (nextSrc || currentSrc).split("/").pop();
    const another = await getNextFromAPI(excludeId);
    if (another) {
      setNextSrc(another);
    } else {
      // brak kolejnych — zakończ badanie
      try {
        await axios.post("/api/update-end-time", { sessionId });
      } catch {}
      setEndScreen(true);
    }
  };

  // --- Ekrany
  if (!hasStarted || endScreen) {
    return (
      <StartScreen
        endScreen={endScreen}
        trans={trans}
        autoFullscreen={false}
        setAutoFullscreen={() => {}}
        isFullscreen={false}
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
      {/* WIDOCZNY player */}
      {currentSrc && (
        <VideoPlayer
          ref={visibleVideoRef}
          src={currentSrc}
          onEnded={handleEnded}
          preventPauseResume
        />
      )}

      {/* UKRYTY player do PRELOADU kolejnego klipu */}
      <video
        ref={preloadVideoRef}
        muted
        playsInline
        preload="auto"
        crossOrigin="anonymous"
        style={{ display: "none" }}
      />

      {/* Pasek ładowania: pokazuj, jeśli trwa preload następnego albo w trakcie ratingu */}
      {(!preloadReady || showRating) && nextSrc && (
        <div className="absolute bottom-10 left-1/2 transform -translate-x-1/2 w-1/2">
          <Loader
            percent={preloadPercent}
            label={
              showRating
                ? trans("preloading_next", "Przygotowuję kolejny film…")
                : trans("loading", "Ładowanie…")
            }
          />
        </div>
      )}

      {/* Panel oceny */}
      {showRating && (
        <RatingPanel trans={trans} onChoose={submitRating} disabled={false} />
      )}
    </div>
  );
}

export async function getServerSideProps({ locale }) {
  return { props: { ...(await serverSideTranslations(locale, ["common"])) } };
}
