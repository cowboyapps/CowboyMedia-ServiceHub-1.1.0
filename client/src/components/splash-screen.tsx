import { useState, useRef, useEffect, useCallback } from "react";
import logoImg from "@assets/CowboyMedia_Uodated_Logo_1778328129619.png";
import splashVideoUrl from "@assets/ServiceHub_Loading_Screen_1778502829390.mp4";

const MIN_VISIBLE_MS = 800;
const HARD_TIMEOUT_MS = 5000;
const FADE_MS = 400;

export function SplashScreen({ onComplete }: { onComplete: () => void }) {
  const [fadeOut, setFadeOut] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const minTimeElapsedRef = useRef(false);
  const videoEndedRef = useRef(false);
  const completedRef = useRef(false);

  const beginFadeOut = useCallback(() => {
    setFadeOut((prev) => prev || true);
  }, []);

  const tryFinish = useCallback(() => {
    if (minTimeElapsedRef.current && videoEndedRef.current) {
      beginFadeOut();
    }
  }, [beginFadeOut]);

  useEffect(() => {
    const minTimer = setTimeout(() => {
      minTimeElapsedRef.current = true;
      tryFinish();
    }, MIN_VISIBLE_MS);

    // Hard fallback: never let the splash trap the user. Even if the video
    // never reports `ended`, `error`, or `canplay`, force-complete after this.
    const hardFallback = setTimeout(() => {
      videoEndedRef.current = true;
      minTimeElapsedRef.current = true;
      beginFadeOut();
    }, HARD_TIMEOUT_MS);

    // Defensive top-level safety net: ensure onComplete fires even if the
    // fade-out CSS transition / state update gets stuck for any reason.
    const ultimateSafety = setTimeout(() => {
      if (!completedRef.current) {
        completedRef.current = true;
        onComplete();
      }
    }, HARD_TIMEOUT_MS + FADE_MS + 500);

    return () => {
      clearTimeout(minTimer);
      clearTimeout(hardFallback);
      clearTimeout(ultimateSafety);
    };
  }, [tryFinish, beginFadeOut, onComplete]);

  useEffect(() => {
    if (!fadeOut) return;
    const timer = setTimeout(() => {
      if (!completedRef.current) {
        completedRef.current = true;
        onComplete();
      }
    }, FADE_MS);
    return () => clearTimeout(timer);
  }, [fadeOut, onComplete]);

  const handleVideoEnd = () => {
    videoEndedRef.current = true;
    tryFinish();
  };

  const handleVideoError = () => {
    // Video failed to load — treat as ended so we don't block on it.
    videoEndedRef.current = true;
    tryFinish();
  };

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-black transition-opacity duration-500 ${fadeOut ? "opacity-0 pointer-events-none" : "opacity-100"}`}
      data-testid="splash-screen"
    >
      {/* Always-visible logo so the user has something to look at even if
          the splash video fails to decode/load on this device. */}
      <img
        src={logoImg}
        alt="CowboyMedia"
        className={`absolute w-[60%] max-w-[260px] object-contain transition-opacity duration-300 ${videoReady ? "opacity-0" : "opacity-100"}`}
        data-testid="splash-logo-fallback"
      />
      <video
        ref={videoRef}
        src={splashVideoUrl}
        autoPlay
        muted
        playsInline
        preload="auto"
        onCanPlay={() => setVideoReady(true)}
        onEnded={handleVideoEnd}
        onError={handleVideoError}
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${videoReady ? "opacity-100" : "opacity-0"}`}
        data-testid="splash-video"
      />
    </div>
  );
}
