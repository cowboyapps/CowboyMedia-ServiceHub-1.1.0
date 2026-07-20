import { useEffect } from "react";

// iOS pans/scrolls the layout viewport to chase a focused input when the
// on-screen keyboard opens, and sometimes leaves that residual pan behind
// after the keyboard closes — the app-shell header stays slid up under the
// status bar. The shell document is never meant to scroll (its root is sized
// to exactly the visible viewport), so any window scroll while no keyboard is
// open is that leftover pan: snap it back to 0.
//
// Only mount this inside the authenticated app shell. Unauthenticated pages
// (auth, public status, password reset) use normal document scrolling and
// must NOT have their scroll position reset.
export function useViewportUnpan(threshold = 80): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;

    let raf = 0;
    const unpan = () => {
      cancelAnimationFrame(raf);
      // Wait a frame so we measure after iOS settles the viewport change.
      raf = requestAnimationFrame(() => {
        const keyboard = vv ? Math.max(0, window.innerHeight - vv.height) : 0;
        const keyboardOpen = keyboard > threshold;
        if (!keyboardOpen && (window.scrollY > 0 || (vv?.offsetTop ?? 0) > 0)) {
          window.scrollTo(0, 0);
        }
      });
    };

    // Keyboard close fires a visualViewport resize; leaving an input fires
    // focusout; resume from background can also restore a stale pan.
    vv?.addEventListener("resize", unpan);
    vv?.addEventListener("scroll", unpan);
    window.addEventListener("focusout", unpan);
    window.addEventListener("pageshow", unpan);

    return () => {
      cancelAnimationFrame(raf);
      vv?.removeEventListener("resize", unpan);
      vv?.removeEventListener("scroll", unpan);
      window.removeEventListener("focusout", unpan);
      window.removeEventListener("pageshow", unpan);
    };
  }, [threshold]);
}
