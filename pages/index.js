import {useState, useEffect, useRef, useCallback} from 'react';
import axios from 'axios';
import {v4 as uuidv4} from 'uuid';

export default function Home() {
    const [video, setVideo] = useState(null);
    const [sessionId, setSessionId] = useState(null);
    const [hasStarted, setHasStarted] = useState(false);
    const [showRating, setShowRating] = useState(false);
    const [scaleFactor, setScaleFactor] = useState(1);
    const ratingPanelRef = useRef(null);
    const [isVideoReady, setIsVideoReady] = useState(false);
    const [autoFullscreen, setAutoFullscreen] = useState(false);
    const [videoList, setVideoList] = useState([]);
    const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
    const videoRef = useRef(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [ratingStartTime, setRatingStartTime] = useState(null);
    const [loadingProgress, setLoadingProgress] = useState(0);
    const [nextVideo, setNextVideo] = useState('');
    const [nextVideoUrl, setNextVideoUrl] = useState('');
    const [nextVideoType, setNextVideoType] = useState('');
    const [playTriggered, setPlayTriggered] = useState(false);
    const [loadTriggered, setLoadTriggered] = useState(false);
    const waitForLoadingRef = useRef(false);

    useEffect(() => {
        let storedSessionId = localStorage.getItem('sessionId');
        if (!storedSessionId) {
            storedSessionId = uuidv4();
            localStorage.setItem('sessionId', storedSessionId);
        }
        setSessionId(storedSessionId);
    }, []);

    useEffect(() => {
        if (showRating && ratingPanelRef.current) {
            const panelHeight = ratingPanelRef.current.offsetHeight;
            const windowHeight = window.visualViewport ? window.visualViewport.height : document.documentElement.clientHeight;
            if (panelHeight > windowHeight) {
                setScaleFactor(windowHeight / panelHeight);
            } else {
                setScaleFactor(1);
            }
        }
    }, [showRating]);

    useEffect(() => {
        if (typeof window !== "undefined") {
            const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
            setAutoFullscreen(isMobile);
        }
    }, []);

    useEffect(() => {
        const checkFullscreen = () => {
            setIsFullscreen(document.fullscreenElement !== null);
        };

        document.addEventListener("fullscreenchange", checkFullscreen);
        return () => {
            document.removeEventListener("fullscreenchange", checkFullscreen);
        };
    }, []);

    const loadVideo = useCallback((url, initialLoad = false) => {
        console.log('loading...')
        setLoadingProgress(0);
        GET(url);

        function onProgress(event) {
            if (event.lengthComputable) {
                let completion = (event.loaded / event.total) * 100;
                setLoadingProgress(completion);
            }
        }

        function onLoad(event) {
            let type = 'video/mp4';
            let blob = new Blob([event.target.response], { type: type });

            setNextVideoType(type);
            setNextVideoUrl(URL.createObjectURL(blob));

            if (initialLoad) {
                setLoadTriggered(true);
            }
        }

        function GET(url) {
            let xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.setRequestHeader('Access-Control-Allow-Origin', '*');
            xhr.responseType = 'arraybuffer';
            xhr.onprogress = onProgress;
            xhr.onload = onLoad;
            xhr.send();
        }
    }, [setLoadingProgress]);

    useEffect(() => {
        if (video && video === videoList[0]) {
            setIsVideoReady(false);
            loadVideo(video, true);
        }
    }, [video, loadVideo, videoList]);

    useEffect(() => {
        if (nextVideo && nextVideo !== videoList[0] && playTriggered && currentVideoIndex < videoList.length - 1) {
            setPlayTriggered(false);
            loadVideo(nextVideo, false);
        }
    }, [playTriggered, loadVideo, nextVideo, videoList, currentVideoIndex])

    const startAssessment = () => {
        const newSessionId = uuidv4();
        setSessionId(newSessionId);
        setHasStarted(true);
        setIsVideoReady(false);

        axios.get('/api/video-list').then((res) => {
            const shuffledVideos = res.data.videos.sort(() => Math.random() - 0.5);
            setVideoList(shuffledVideos);
            setCurrentVideoIndex(0);

            // Przekazanie kolejności video do API
            const clientInfo = {
                userAgent: navigator.userAgent,
                language: navigator.language,
                screenWidth: window.screen.width,
                screenHeight: window.screen.height,
                viewportWidth: window.innerWidth,
                viewportHeight: window.innerHeight,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            };
            axios.post('/api/create-user', {
                sessionId: newSessionId,
                videoOrder: shuffledVideos,
                clientInfo,
                autoFullscreen: autoFullscreen ? 1 : 0
            })
                .then(() => {
                    setVideo(shuffledVideos[0]);
                    setNextVideo(shuffledVideos[1]);
                    setShowRating(false);
                })
                .catch(error => console.error("Błąd podczas zapisywania użytkownika:", error));
        });
    };

    const handleVideoEnd = () => {
        setRatingStartTime(Date.now()); // Zapisz czas rozpoczęcia oceny
        setShowRating(true);
    };

    const handleVideoLoaded = useCallback(async (type, blob, videoElementRef = videoRef) => {
        console.log('playing...')

        if (videoElementRef?.current) {
            videoElementRef.current.type = type;
            videoElementRef.current.src = blob;
        }

        setIsVideoReady(true);
        const videoEl = videoElementRef.current;
        if (videoEl) {
            try {
                videoEl.muted = true;
                videoEl.setAttribute("playsinline", "true");
                videoEl.setAttribute("autoplay", "true");

                const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                if (!prefersReducedMotion) {
                    if (autoFullscreen) {
                        try {
                            if (videoEl.requestFullscreen) {
                                await videoEl.requestFullscreen();
                            }
                        } catch (error) {
                            console.error("Nie udało się przejść w tryb pełnoekranowy", error);
                        }
                    }

                    const playVideo = async (videoElement) => {
                        try {
                            setPlayTriggered(true);
                            await videoElement.play();
                        } catch (err) {
                            console.error('Błąd odtwarzania:', err);
                        }
                    };

                    await playVideo(videoEl);
                }
            } catch (error) {
                console.error("Błąd odtwarzania wideo", error);
                videoEl.addEventListener("click", () => {
                    videoEl.muted = true;
                    videoEl.play();
                }, {once: true});
            }
        }
    }, [autoFullscreen]);

    useEffect(() => {
        if (waitForLoadingRef.current && loadingProgress === 100) {
            waitForLoadingRef.current = false;
            setLoadTriggered(true);
        }
    }, [loadingProgress]);

    const submitRating = (value) => {
        if (!video) return;

        const duration = ratingStartTime ? (Date.now() - ratingStartTime) / 1000 : null; // Oblicz czas w sekundach

        axios.post('/api/rate-video', {
            sessionId,
            videoName: video.split('/').pop(),
            rating: value,
            duration,
        }).then(() => {});

        setIsVideoReady(false);

        if (currentVideoIndex < videoList.length - 1) {
            setCurrentVideoIndex(currentVideoIndex + 1);
            setVideo(videoList[currentVideoIndex + 1]);
            setNextVideo(videoList[currentVideoIndex + 2]);
            setShowRating(false);
            setRatingStartTime(null);
            setIsVideoReady(false);

            if (loadingProgress === 100) {
                setLoadTriggered(true);
            } else {
                waitForLoadingRef.current = true;
            }
        } else {
            axios.post('/api/update-end-time', { sessionId })
                .then(() => {
                    alert('Dziękujemy za ocenę wszystkich filmów!');
                    setHasStarted(false);
                })
                .catch(error => console.error("Błąd podczas zapisywania czasu zakończenia:", error));
        }
    };

    useEffect(() => {
        // console.log(loadingProgress)
        if (loadTriggered) {
            setLoadTriggered(false);
            handleVideoLoaded(nextVideoType, nextVideoUrl, videoRef).then(() => {});
        }
    }, [handleVideoLoaded, loadTriggered, loadingProgress, nextVideoType, nextVideoUrl]);

    if (!hasStarted) {
        return (
            <div
                className="flex flex-col items-center justify-center h-screen m-0 p-0 bg-gray-900 bg-opacity-75 text-white">
                <div className="backdrop-blur-md bg-white/30 p-8 rounded-xl shadow-lg text-center">
                    <h1 className="text-4xl font-extrabold text-white">Witaj!</h1>
                    <h2 className="text-lg font-medium text-white mt-2">
                        Za chwilę zobaczysz kilka sekwencji video. Twoim zadaniem jest ocenienie ich jakości.<br/>
                        Między sekwencjami wideo mogą pojawić się ekrany ładowania. Przy ocenie treści nie bierz ich pod uwagę.<br/>
                    </h2>
                    <label
                        className="flex items-center justify-center mt-4 bg-white/30 p-2 rounded-lg shadow-md cursor-pointer">
                        <input
                            type="checkbox"
                            checked={autoFullscreen}
                            onChange={() => !/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) && setAutoFullscreen(!autoFullscreen)}
                            className="hidden"
                        />
                        <span
                            className={`w-10 h-5 flex items-center bg-gray-300 rounded-full p-1 transition ${autoFullscreen ? 'bg-green-500' : 'bg-gray-400'}`}>
                <span
                    className={`bg-white w-4 h-4 rounded-full shadow-md transform ${autoFullscreen ? 'translate-x-5' : ''}`}></span>
              </span>
                        <span className="ml-3 text-white font-semibold">Automatyczny tryb pełnoekranowy</span>
                    </label>
                    <button
                        onClick={startAssessment}
                        className="mt-6 px-8 py-3 bg-white/20 text-white font-bold text-lg rounded-lg shadow-lg hover:bg-white/30 transition-all"
                        disabled={isFullscreen}
                    >
                        Rozpocznij
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="absolute top-0 left-0 w-full h-screen bg-gray-900 bg-opacity-75 text-white">
            {!showRating && video && (
                <video
                    ref={videoRef}
                    muted
                    playsInline
                    autoPlay
                    className="absolute top-0 left-0 w-full pointer-events-none"
                    style={{height: window.visualViewport ? window.visualViewport.height : '100vh'}}
                    onEnded={handleVideoEnd}
                    onPause={() => videoRef.current?.play()}
                    onSeeking={(e) => e.preventDefault()}
                    onContextMenu={(e) => e.preventDefault()} // Blokuje menu kontekstowe
                >
                    Twoja przeglądarka nie obsługuje tagu wideo.
                </video>
            )}
            {!isVideoReady && loadingProgress !== 100 && (
                <div className="absolute bottom-10 left-1/2 transform -translate-x-1/2 w-1/2 bg-gray-700 rounded-full h-4 overflow-hidden shadow-lg">
                    <div
                        className="bg-blue-500 h-full transition-all duration-300"
                        style={{ width: `${loadingProgress}%` }}
                    ></div>
                </div>
            )}
            {showRating && (
                <div
                    ref={ratingPanelRef}
                    className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 backdrop-blur-md bg-white/30 p-6 rounded-xl shadow-lg text-center w-3/4 max-w-2xl"
                    style={{transform: `translate(-50%, -50%) scale(${scaleFactor})`}}
                >
                    <p className="text-xl font-semibold text-white">Oceń jakość video:</p>
                    <div className="mt-2 flex flex-col space-y-2">
                        {["Doskonała", "Dobra", "Przeciętna", "Niska", "Zła"].map((label, index) => (
                            <button
                                key={index}
                                onClick={() => submitRating(5 - index)}
                                className="px-4 py-3 rounded-lg text-white font-semibold transition-all bg-white/20 hover:bg-white/30 shadow-md"
                                disabled={isFullscreen}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
