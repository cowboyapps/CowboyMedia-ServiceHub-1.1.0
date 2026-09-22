import { useState, useRef, useEffect, useCallback } from "react";
import { APP_VERSION } from "@shared/version";
import logoImg from "@assets/cowboymedia_servicehub_dark_trimmed.png";
import splashVideoUrl from "@assets/ServiceHub_Loading_Screen_1778502829390.mp4";

const VISIBLE_MS = 2000;
const FADE_MS = 200;

export function SplashScreen({ onComplete }: { onComplete: () => void }) {
  const [fadeOut, setFadeOut] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const completedRef = useRef(false);

  const beginFadeOut = useCallback(() => {
    setFadeOut((prev) => prev || true);
  }, []);

  useEffect(() => {
    // Fixed intro duration, independent of video loading or playback length.
    const visibleTimer = setTimeout(beginFadeOut, VISIBLE_MS);

    // Defensive top-level safety net: ensure onComplete fires even if the
    // fade-out CSS transition / state update gets stuck for any reason.
    const ultimateSafety = setTimeout(() => {
      if (!completedRef.current) {
        completedRef.current = true;
        onComplete();
      }
    }, VISIBLE_MS + FADE_MS + 500);

    return () => {
      clearTimeout(visibleTimer);
      clearTimeout(ultimateSafety);
    };
  }, [beginFadeOut, onComplete]);

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

  const handleVideoError = () => {
    // Keep the logo visible if playback fails; the intro timer still runs.
    setVideoReady(false);
  };

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-black transition-opacity ${fadeOut ? "opacity-0 pointer-events-none" : "opacity-100"}`}
      style={{ transitionDuration: `${FADE_MS}ms` }}
      data-testid="splash-screen"
    >
      {/* Always-visible logo (with the app version beneath it) so the user has
          something to look at even if the splash video fails to decode/load on
          this device. The version reads from APP_VERSION, so it tracks every
          future version bump automatically. */}
      <div
        className={`absolute inset-0 flex flex-col items-center justify-center transition-opacity duration-300 ${videoReady ? "opacity-0" : "opacity-100"}`}
        data-testid="splash-logo-fallback"
      >
        <img
          src={logoImg}
          alt="CowboyMedia"
          className="w-[60%] max-w-[260px] object-contain"
        />
        <p
          className="mt-3 text-xs font-medium tracking-wide text-white/70"
          data-testid="text-splash-version"
        >
          Version {APP_VERSION}
        </p>
      </div>
      <video
        ref={videoRef}
        src={splashVideoUrl}
        autoPlay
        muted
        playsInline
        preload="auto"
        onCanPlay={() => setVideoReady(true)}
        onError={handleVideoError}
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${videoReady ? "opacity-100" : "opacity-0"}`}
        data-testid="splash-video"
      />
    </div>
  );
}
