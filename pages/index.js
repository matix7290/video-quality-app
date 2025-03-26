import {useState, useEffect, useRef} from 'react';
import axios from 'axios';
import {v4 as uuidv4} from 'uuid';

export default function Home() {
    const [video, setVideo] = useState(null);
    const [rating, setRating] = useState(null);
    const [sessionId, setSessionId] = useState(null);
    const [hasStarted, setHasStarted] = useState(false);
    const [showRating, setShowRating] = useState(false);
    const [scaleFactor, setScaleFactor] = useState(1);
    const ratingPanelRef = useRef(null);
    const [isVideoLoaded, setIsVideoLoaded] = useState(false);
    const [autoFullscreen, setAutoFullscreen] = useState(false);
    const [videoList, setVideoList] = useState([]);
    const [currentVideoIndex, setCurrentVideoIndex] = useState(0);
    const videoRef = useRef(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [ratingStartTime, setRatingStartTime] = useState(null);
    const [loadingProgress, setLoadingProgress] = useState(0);

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

    useEffect(() => {
        if (video) {
            setIsVideoLoaded(false);
            loadVideo(video);
        }
    }, [video]);

    const startAssessment = () => {
        const newSessionId = uuidv4();
        setSessionId(newSessionId);
        setHasStarted(true);
        setIsVideoLoaded(false);

        axios.get('/api/video-list').then((res) => {
            const shuffledVideos = res.data.videos.sort(() => Math.random() - 0.5);
            setVideoList(shuffledVideos);
            setCurrentVideoIndex(0);

            // Przekazanie kolejności video do API
            const clientInfo = {
                userAgent: navigator.userAgent,
                language: navigator.language,
                platform: navigator.platform,
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
                    setShowRating(false);
                })
                .catch(error => console.error("Błąd podczas zapisywania użytkownika:", error));
        });
    };

    const loadVideo = (url) => {
        GET(url);

        console.log(url);

        function onProgress(event) {
            if (event.lengthComputable) {
                let completion = (event.loaded / event.total) * 100;
                setLoadingProgress(completion);
                console.log(completion);
            }
        }

        function onLoad(event) {
            let type = 'video/mp4';
            let blob = new Blob([event.target.response], {
                type: type
            });
            videoRef.current.type = type;
            videoRef.current.src = URL.createObjectURL(blob);
            handleVideoLoaded().then(r => {});
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
    }

    const handleVideoEnd = () => {
        setRatingStartTime(Date.now()); // Zapisz czas rozpoczęcia oceny
        setShowRating(true);
    };

    const handleVideoLoaded = async () => {
        setIsVideoLoaded(true);
        if (videoRef.current) {
            try {
                videoRef.current.muted = true;
                videoRef.current.setAttribute("playsinline", "true");
                videoRef.current.setAttribute("autoplay", "true");

                const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                if (!prefersReducedMotion) {
                    if (autoFullscreen) {
                        try {
                            if (videoRef.current.requestFullscreen) {
                                await videoRef.current.requestFullscreen();
                            } else if (videoRef.current.mozRequestFullScreen) {
                                await videoRef.current.mozRequestFullScreen();
                            } else if (videoRef.current.webkitRequestFullscreen) {
                                await videoRef.current.webkitRequestFullscreen();
                            } else if (videoRef.current.msRequestFullscreen) {
                                await videoRef.current.msRequestFullscreen();
                            } else if (videoRef.current.webkitEnterFullscreen) {
                                videoRef.current.webkitEnterFullscreen();
                            }
                        } catch (error) {
                            console.error("Nie udało się przejść w tryb pełnoekranowy", error);
                        }
                    }
                    await videoRef.current.play();
                }
            } catch (error) {
                console.error("Błąd odtwarzania wideo", error);
                videoRef.current.addEventListener("click", () => {
                    videoRef.current.muted = true;
                    videoRef.current.play();
                }, {once: true});
            }
        }
    };

    const submitRating = (value) => {
        if (!video) return;

        const duration = ratingStartTime ? (Date.now() - ratingStartTime) / 1000 : null; // Oblicz czas w sekundach

        setRating(value);
        axios.post('/api/rate-video', {
            sessionId,
            videoName: video.split('/').pop(),
            rating: value,
            duration,
        }).then(() => {
            if (currentVideoIndex < videoList.length - 1) {
                setCurrentVideoIndex(currentVideoIndex + 1);
                setVideo(videoList[currentVideoIndex + 1]);
                setShowRating(false);
                setRatingStartTime(null); // Zresetuj czas
            } else {
                // Wysłanie CURRENT_TIMESTAMP do users.end_time
                axios.post('/api/update-end-time', {sessionId})
                    .then(() => {
                        alert('Dziękujemy za ocenę wszystkich filmów!');
                        setRating(null);
                        setHasStarted(false);
                    })
                    .catch(error => console.error("Błąd podczas zapisywania czasu zakończenia:", error));
            }
        });
    };

    if (!hasStarted) {
        return (
            <div
                className="flex flex-col items-center justify-center h-screen m-0 p-0 bg-gray-900 bg-opacity-75 text-white">
                <div className="backdrop-blur-md bg-white/30 p-8 rounded-xl shadow-lg text-center">
                    <h1 className="text-4xl font-extrabold text-white">Witaj!</h1>
                    <h2 className="text-lg font-medium text-white mt-2">
                        Za chwilę zobaczysz kilka sekwencji video. Twoim zadaniem jest ocenienie ich jakości.
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
            {!isVideoLoaded && (
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
