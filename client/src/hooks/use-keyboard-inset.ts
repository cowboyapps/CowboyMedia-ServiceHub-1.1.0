import { useEffect, useState } from "react";

// Shared keyboard-inset detection for mobile typing surfaces.
//
// When the on-screen keyboard opens, iOS Safari/PWA does NOT shrink the layout
// viewport (100dvh ignores the keyboard) — it shrinks only the visualViewport
// and tries to scroll/pan the page so the focused input is visible, which
// slides the header away and leaves the fixed bottom nav floating mid-screen.
// The proven fix (from the ticket-detail page) is to measure how much of the
// layout viewport the keyboard covers via visualViewport and pad the chat
// container by that amount, so the composer sits directly above the keyboard
// while the page itself never scrolls.
//
// The measurement: window.innerHeight - vv.height is the keyboard height
// (plus any browser chrome). Crucially, vv.offsetTop must NOT be subtracted
// from the detection: when iOS *pans* the visual viewport down to reveal the
// focused input, offsetTop grows by roughly the keyboard height and would
// cancel the measurement to ~0 — the exact moment compensation is needed most
// (nav floats mid-screen, no padding applied). Instead, when a keyboard is
// detected while iOS has panned/scrolled, we actively un-pan via
// window.scrollTo(0, 0) so the layout snaps back and the padding does its job.
//
// A threshold (default 80px) filters out browser-chrome jitter so only a real
// keyboard registers. On Android Chrome with `interactive-widget=
// resizes-content` the layout viewport itself resizes, so innerHeight and
// vv.height shrink together and this hook correctly reports 0 — no double
// compensation.
export function useKeyboardInset(threshold = 80): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;
    const onChange = () => {
      const keyboard = Math.max(0, window.innerHeight - vv.height);
      const open = keyboard > threshold;
      setInset(open ? keyboard : 0);
      // iOS panned the visual viewport (or scrolled the document) to chase the
      // focused input; undo it so fixed elements line up with the padded
      // layout instead of drifting mid-screen.
      if (open && (vv.offsetTop > 0 || window.scrollY > 0)) {
        window.scrollTo(0, 0);
      }
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
