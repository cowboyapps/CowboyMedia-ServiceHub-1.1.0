import { useState, useRef, useEffect, useCallback } from "react";

export function SplashScreen({ onComplete }: { onComplete: () => void }) {
  const [fadeOut, setFadeOut] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoReady, setVideoReady] = useState(false);
  const minTimeElapsedRef = useRef(false);
  const videoEndedRef = useRef(false);

  const tryFinish = useCallback(() => {
    if (minTimeElapsedRef.current && videoEndedRef.current && !fadeOut) {
      setFadeOut(true);
    }
  }, [fadeOut]);

  useEffect(() => {
    const minTimer = setTimeout(() => {
      minTimeElapsedRef.current = true;
      tryFinish();
    }, 2000);
    const fallback = setTimeout(() => {
      if (!fadeOut) setFadeOut(true);
    }, 15000);
    return () => {
      clearTimeout(minTimer);
      clearTimeout(fallback);
    };
  }, [tryFinish, fadeOut]);

  useEffect(() => {
    if (fadeOut) {
      const timer = setTimeout(onComplete, 600);
      return () => clearTimeout(timer);
    }
  }, [fadeOut, onComplete]);

  const handleVideoEnd = () => {
    videoEndedRef.current = true;
    tryFinish();
    if (minTimeElapsedRef.current) {
      setFadeOut(true);
    }
  };

  const handleVideoError = () => {
    videoEndedRef.current = true;
    setTimeout(() => {
      if (!fadeOut) setFadeOut(true);
    }, 2000);
  };

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-black transition-opacity duration-500 ${fadeOut ? "opacity-0 pointer-events-none" : "opacity-100"}`}
      data-testid="splash-screen"
    >
      <video
        ref={videoRef}
        src="/splash.mp4"
        autoPlay
        muted
        playsInline
        onCanPlay={() => setVideoReady(true)}
        onEnded={handleVideoEnd}
        onError={handleVideoError}
        className={`max-w-full max-h-full object-contain transition-opacity duration-300 ${videoReady ? "opacity-100" : "opacity-0"}`}
        data-testid="splash-video"
      />
    </div>
  );
}
