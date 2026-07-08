import { useEffect, useState } from "react";

// Shared keyboard-inset detection for mobile typing surfaces.
//
// When the on-screen keyboard opens, iOS Safari/PWA does NOT shrink the layout
// viewport (100dvh ignores the keyboard) — it shrinks only the visualViewport
// and tries to scroll the page so the focused input is visible, which slides
// the header away and leaves the fixed bottom nav floating mid-screen. The
// proven fix (from the ticket-detail page) is to measure how much of the
// layout viewport the keyboard covers via visualViewport and pad the chat
// container by that amount, so the composer sits directly above the keyboard
// while the page itself never scrolls.
//
// The measurement: window.innerHeight - vv.height - vv.offsetTop is the space
// below the visual viewport — i.e. the keyboard (plus any browser chrome).
// A threshold (default 80px) filters out browser-chrome jitter so only a real
// keyboard registers. On Android Chrome with `interactive-widget=
// resizes-content` the layout viewport itself resizes, the offset stays ~0,
// and this hook correctly reports 0 — no double compensation.
export function useKeyboardInset(threshold = 80): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;
    const onChange = () => {
      const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setInset(offset > threshold ? offset : 0);
    };
    vv.addEventListener("resize", onChange);
    vv.addEventListener("scroll", onChange);
    // Rotation changes window.innerHeight without always firing a vv resize
    // first; re-measure so a stale inset can't survive an orientation change.
    window.addEventListener("orientationchange", onChange);
    onChange();
    return () => {
      vv.removeEventListener("resize", onChange);
      vv.removeEventListener("scroll", onChange);
      window.removeEventListener("orientationchange", onChange);
    };
  }, [threshold]);

  return inset;
}
