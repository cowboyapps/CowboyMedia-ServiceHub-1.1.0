import { useCallback, useEffect, useState } from "react";

// Cool-off after a user dismisses the install banner, so it doesn't nag on
// every visit. Two weeks is long enough to not annoy, short enough that people
// who change their mind get a second chance.
export const INSTALL_DISMISS_KEY = "pwaInstallBannerDismissedUntil";
export const INSTALL_DISMISS_COOLOFF_MS = 14 * 24 * 60 * 60 * 1000;

// The Chromium `beforeinstallprompt` event isn't in the TS DOM lib.
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export function isIOS(): boolean {
  try {
    return (
      /iP(hone|ad|od)/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1)
    );
  } catch {
    return false;
  }
}

// True only for real Safari on iOS — the only iOS browser where the Share →
// "Add to Home Screen" flow is available. Chrome/Firefox/Edge/Opera on iOS
// (CriOS/FxiOS/EdgiOS/OPiOS) and in-app webviews can't install, so we must not
// show them the Safari guidance.
export function isIOSSafari(): boolean {
  if (!isIOS()) return false;
  try {
    const ua = navigator.userAgent;
    const isOtherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|mercury/i.test(ua);
    return /Safari/i.test(ua) && !isOtherBrowser;
  } catch {
    return false;
  }
}

export function isStandalone(): boolean {
  try {
    return (
      (typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(display-mode: standalone)").matches) ||
      (navigator as unknown as { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

export function isInstallDismissActive(now: number = Date.now()): boolean {
  try {
    const raw = localStorage.getItem(INSTALL_DISMISS_KEY);
    if (!raw) return false;
    const until = Number(raw);
    return Number.isFinite(until) && until > now;
  } catch {
    return false;
  }
}

export function recordInstallDismiss(now: number = Date.now()): void {
  try {
    localStorage.setItem(INSTALL_DISMISS_KEY, String(now + INSTALL_DISMISS_COOLOFF_MS));
  } catch {
    /* localStorage unavailable (private mode / disabled) — banner just reappears next session */
  }
}

export interface PwaInstallState {
  /** A native install prompt has been captured and is ready to fire. */
  canPromptInstall: boolean;
  /** iOS Safari, where we show manual "Add to Home Screen" guidance instead. */
  isIOSSafari: boolean;
  /** App is already installed / running standalone. */
  isStandalone: boolean;
  /** Fire the native prompt. Resolves with the outcome. */
  promptInstall: () => Promise<"accepted" | "dismissed" | "unavailable">;
}

export function usePwaInstall(): PwaInstallState {
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState<boolean>(() => isStandalone());

  useEffect(() => {
    const onBeforeInstallPrompt = (e: Event) => {
      // Stop Chrome's own mini-infobar so our banner is the single entry point.
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<"accepted" | "dismissed" | "unavailable"> => {
    if (!installEvent) return "unavailable";
    try {
      await installEvent.prompt();
      const { outcome } = await installEvent.userChoice;
      // The event can only be used once; drop it either way so the banner hides.
      setInstallEvent(null);
      if (outcome === "accepted") setInstalled(true);
      return outcome;
    } catch {
      setInstallEvent(null);
      return "unavailable";
    }
  }, [installEvent]);

  return {
    canPromptInstall: !!installEvent && !installed,
    isIOSSafari: !installed && isIOSSafari(),
    isStandalone: installed,
    promptInstall,
  };
}
