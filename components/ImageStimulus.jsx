import { useEffect, useRef, useState } from 'react';

export default function ImageStimulus({ src, duration, autoFullscreen, onComplete, trans }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const stageRef = useRef(null);
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;

  useEffect(() => {
    if (!loaded) return;
    // Exposure begins after decoding/loading, never while the image is downloading.
    const timer = setTimeout(() => completeRef.current(), duration * 1000);
    return () => clearTimeout(timer);
  }, [loaded, duration]);

  const onLoad = () => {
    setLoaded(true);
    if (autoFullscreen && stageRef.current?.requestFullscreen) stageRef.current.requestFullscreen().catch(() => {});
  };
  const retry = () => { setFailed(false); setLoaded(false); setAttempt(value => value + 1); };
  const imageUrl = attempt ? `${src}${src.includes('?') ? '&' : '?'}retry=${attempt}` : src;

  return <div ref={stageRef} className="study-image-stage">
    {/* Native img preserves the imported pixels and dimensions without Next image optimization. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img key={attempt} src={imageUrl} alt={trans('image_stimulus')} className="study-image" hidden={!loaded}
      draggable={false} onLoad={onLoad} onError={() => { setLoaded(false); setFailed(true); }} />
    {!loaded && <div className="study-image-status">
      {failed ? <><p role="alert" className="study-error">{trans('image_load_error')}</p>
        <button className="study-button mt-4" onClick={retry}>{trans('image_retry')}</button></>
        : <p role="status">{trans('image_loading')}</p>}
    </div>}
  </div>;
}
