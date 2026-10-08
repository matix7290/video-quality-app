import { useState, useRef, useEffect } from "react";
import axios from "axios";
import { useRouter } from "next/router";
import { useTranslation } from "next-i18next";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";

import StartScreen from "@/components/StartScreen";
import ScreentestModal from "@/components/ScreentestModal";
import VideoPlayer from "@/components/VideoPlayer";
import ImageStimulus from "@/components/ImageStimulus";
import RatingPanel from "@/components/RatingPanel";
import ProgressBar from "@/components/ProgressBar";
import { phases, phaseIntroKeys } from '@/utils/study-phases.cjs';
import { questionsForPhase } from '@/utils/questions.cjs';

import useSessionId from "@/hooks/useSessionId";
import useProlific from "@/hooks/useProlific";
import useFullscreen from "@/hooks/useFullscreen";
import useScreentestListener from "@/hooks/useScreentestListener";
import useVideoPrefetch from "@/hooks/useVideoPrefetch";

export default function Home({ initialSettings }) {
  const { t: translate } = useTranslation("common");
  const [settings, setSettings] = useState(initialSettings);
  const trans = (key, fallback) => settings?.texts?.[router.locale || 'pl']?.[key] ?? translate(key, fallback);
  const studyPhases = phases(settings);
  const introKeys = phaseIntroKeys(studyPhases[1]);
  const router = useRouter();

  // session + prolific
  const sessionId = useSessionId();
  const prolific = useProlific(router, sessionId);

  // ui / flow
  const [isScreentestOpen, setIsScreentestOpen] = useState(false);
  const [screentestSaving, setScreentestSaving] = useState(false);
  const [screentestError, setScreentestError] = useState('');
  const [hasStarted, setHasStarted] = useState(false);
  const autoFullscreen = !!settings.autoFullscreen;
  const imageStudy = settings.stimulusType === 'image';
  const [showRating, setShowRating] = useState(false);
  const [endScreen, setEndScreen] = useState(false);
  const [phase, setPhase] = useState(phases(initialSettings)[0]);
  const [phaseIntro, setPhaseIntro] = useState(false);
  const [questions, setQuestions] = useState({});
  const [pendingRating, setPendingRating] = useState(null);
  const [answers, setAnswers] = useState({});
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const saveLock = useRef(false);
  const pendingPayload = useRef(null);

  // video flow
  const [videoList, setVideoList] = useState([]);
  const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
  const [video, setVideo] = useState(null);
  const [videoError, setVideoError] = useState(false);

  const ratingStartTime = useRef(null);
  const videoRef = useRef(null);

  // Fullscreen state controls when the participant can rate the video.
  const { isFullscreen } = useFullscreen();

  // preload hook (XHR -> Blob URL)
  const {
    progress,
    nextBlobUrl,
    nextMime,
    triggerLoad,
    readyFlag,
    clearReadyFlag,
    loadError,
    retryLoad,
  } = useVideoPrefetch();

  useScreentestListener(sessionId, () => {
    if (!isScreentestOpen || !videoList.length) return;
    setHasStarted(true);
    setIsScreentestOpen(false);
    setCurrentVideoIndex(0);
    setShowRating(false);
    ratingStartTime.current = null;
  }, {
    onSaving: value => { setScreentestSaving(value); if (value) setScreentestError(''); },
    onError: () => setScreentestError(trans('screentest_save_error')),
  });

  const startAssessment = async () => {
    if (starting || !sessionId) return;
    if (videoList.length) { if (settings.screenTest) setIsScreentestOpen(true); else setHasStarted(true); return; }
    setStarting(true);
    setError('');
    try {
      const { data } = await axios.get('/api/video-list');
      const shuffled = [...data.videos];
      for (let i = data.settings.randomize ? shuffled.length - 1 : 0; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const clientInfo = {
        userAgent: navigator.userAgent,
        language: navigator.language,
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
      const response = await axios.post('/api/create-user', {
        sessionId, videoOrder: shuffled, clientInfo,
        prolific, configVersion: data.settings.version,
      });
      setVideoList(response.data.videoOrder);
      setQuestions(response.data.questions);
      setSettings(response.data.settings);
      setPhase(phases(response.data.settings)[0]);
      if (response.data.settings.screenTest) setIsScreentestOpen(true);
      else setHasStarted(true);
    } catch (e) {
      setError(e.response?.data?.error || trans('start_error'));
    } finally { setStarting(false); }
  };

  // po „readyFlag” wstrzykujemy src wideo
  useEffect(() => {
    if (!readyFlag || imageStudy) return;
    clearReadyFlag();
    if (videoRef.current) {
      videoRef.current.type = nextMime || "video/mp4";
      videoRef.current.src = nextBlobUrl;
      try {
        videoRef.current.muted = true;
        videoRef.current.setAttribute("playsinline", "true");
        videoRef.current.setAttribute("autoplay", "true");
        // The administrator setting applies to every participant device.
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
  }, [readyFlag, nextBlobUrl, nextMime, clearReadyFlag, autoFullscreen, imageStudy]);

  useEffect(() => {
    if (!hasStarted || phaseIntro || endScreen || !videoList.length) return;
    const current = videoList[currentVideoIndex];
    setVideoError(false);
    setVideo(current);
    if (!imageStudy) triggerLoad(current);
  }, [hasStarted, currentVideoIndex, videoList, triggerLoad, phaseIntro, endScreen, imageStudy]);

  const handleVideoEnd = () => {
    ratingStartTime.current = Date.now();
    setShowRating(true);
  };

  const videoName = video ? decodeURIComponent(video.split('/').pop()) : '';
  const currentQuestions = questionsForPhase(questions[videoName] || [], settings, phase);

  const saveRating = async (value, controlAnswers) => {
    if (!video || saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    setError('');
    // Keep timing and responses unchanged if a failed request is retried.
    pendingPayload.current ||= {
      sessionId, videoName, rating: value, phase,
      duration: (Date.now() - ratingStartTime.current) / 1000,
      answers: controlAnswers,
    };
    try {
      await axios.post('/api/rate-video', pendingPayload.current);
      const last = currentVideoIndex === videoList.length - 1;
      if (last && phase === studyPhases[studyPhases.length - 1]) {
        await axios.post('/api/update-end-time', { sessionId });
        setEndScreen(true);
      } else if (last) {
        setPhaseIntro(true);
      } else {
        setCurrentVideoIndex(i => i + 1);
      }
      setShowRating(false);
      setPendingRating(null);
      setAnswers({});
      pendingPayload.current = null;
      ratingStartTime.current = null;
    } catch (e) {
      setError(trans('save_error'));
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  };

  const submitRating = (value) => {
    if (currentQuestions.length) setPendingRating(value);
    else saveRating(value, []);
  };

  const beginSecondPhase = () => {
    setPhase(studyPhases[1]);
    setCurrentVideoIndex(0);
    setPhaseIntro(false);
    setShowRating(false);
  };

  // ekrany „start/koniec”
  if (!hasStarted || endScreen) {
    return (
      <StartScreen
        endScreen={endScreen}
        trans={trans}
        mode={settings.mode}
        isFullscreen={isFullscreen}
        onStart={startAssessment}
        disabled={starting || !sessionId}
        error={error}
      >
        <ScreentestModal
          open={isScreentestOpen}
          onClose={() => setIsScreentestOpen(false)}
          title={trans("screentest_title", "Test ekranu")}
          saving={screentestSaving}
          error={screentestError}
          savingText={trans('saving')}
        />
      </StartScreen>
    );
  }

  if (phaseIntro) {
    return (
      <main className="study-background">
        <section className="study-card text-center">
          <h1 className="text-2xl font-bold">{trans(introKeys.title)}</h1>
          <p className="study-description mb-6 whitespace-pre-line">{trans(introKeys.instruction)}</p>
          <button className="study-button" onClick={beginSecondPhase}>{trans('start_part_two')}</button>
        </section>
      </main>
    );
  }

  return (
    <div className="study-background">
      {!showRating && imageStudy && videoList[currentVideoIndex] && (
        <ImageStimulus key={`${phase}-${currentVideoIndex}`} src={videoList[currentVideoIndex]}
          duration={settings.imageDuration} autoFullscreen={autoFullscreen} onComplete={handleVideoEnd} trans={trans} />
      )}
      {!showRating && !imageStudy && video && !loadError && !videoError && (
        <VideoPlayer ref={videoRef} onEnded={handleVideoEnd} onError={() => setVideoError(true)} preventPauseResume>
          {trans('video_tag_error')}
        </VideoPlayer>
      )}
      {!showRating && !imageStudy && (loadError || videoError) && (
        <section className="study-card text-center">
          <p role="alert" className="study-error">{trans('video_load_error')}</p>
          <button className="study-button mt-4" onClick={() => { setVideoError(false); retryLoad(videoList[currentVideoIndex]); }}>{trans('video_retry')}</button>
        </section>
      )}
      {!showRating && !imageStudy && !loadError && !videoError && progress < 100 && (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-1/2">
          <ProgressBar value={progress} />
        </div>
      )}
      {showRating && pendingRating === null && (
        <RatingPanel key={`${phase}-${currentVideoIndex}`} trans={trans}
          labels={settings.labels[router.locale || 'pl']} sliderStep={settings.sliderStep}
          onChoose={submitRating} disabled={isFullscreen || saving || !!pendingPayload.current}
          scale={phase} error={error} saving={saving}
          onRetry={() => saveRating(pendingPayload.current.rating, pendingPayload.current.answers)} />
      )}
      {showRating && pendingRating !== null && (
        <section className="study-card study-questions-card">
          <h1>{trans('control_questions')}</h1>
          <div className="study-questions-list">
            {currentQuestions.map(q => (
              <div key={q.id} className="study-question-group">
                <fieldset className="study-question" disabled={saving || !!pendingPayload.current}>
                  <legend>{q.question}</legend>
                  <div className="study-choices">
                    {[true, false].map(answer => (
                      <label key={String(answer)} className="study-choice">
                        <input type="radio" name={q.id} checked={answers[q.id] === answer}
                          onChange={() => setAnswers(previous => ({ ...previous, [q.id]: answer }))} />
                        <span className="study-choice-indicator" aria-hidden="true" />
                        <span>{trans(answer ? 'yes' : 'no')}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
            ))}
          </div>
          {error && <p role="alert" className="study-error mb-4">{error}</p>}
          <div className="study-questions-actions">
            <button className="study-button" disabled={saving || isFullscreen || currentQuestions.some(q => typeof answers[q.id] !== 'boolean')}
              onClick={() => saveRating(pendingRating, currentQuestions.map(q => ({ questionId: q.id, answer: answers[q.id] })))}>
              {trans(saving ? 'saving' : 'submit')}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

export async function getServerSideProps({ locale }) {
  const { readConfiguration, defaults } = require('../utils/study-config.cjs');
  let initialSettings;
  try { initialSettings = readConfiguration().settings; } catch { initialSettings = defaults(); }
  return { props: { initialSettings, ...(await serverSideTranslations(locale, ['common'])) } };
}
