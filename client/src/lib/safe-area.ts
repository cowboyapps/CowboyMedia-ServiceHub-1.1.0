// Caches the iOS safe-area insets into CSS variables (--sat / --sab).
//
// iOS WebKit intermittently reports env(safe-area-inset-top) as 0 on cold
// launch / resume of a standalone PWA (status-bar-style: black-translucent)
// until some reflow happens. When that 0 lands, the header slides up under the
// notch / status bar and looks broken. Pure CSS can't defend against the
// transient 0, so we resolve the real inset from a hidden probe element and
// cache the largest value seen for the current orientation. A momentary 0 can
// then never shrink the header back into the notch. The cache is reset on
// resize / orientation change so landscape (smaller top inset) is measured
// fresh instead of inheriting the portrait value.

let probe: HTMLDivElement | null = null;
let maxTop = 0;
let maxBottom = 0;

function ensureProbe(): HTMLDivElement {
  if (probe) return probe;
  probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = [
    "position:fixed",
    "top:0",
    "left:0",
    "width:0",
    "height:0",
    "visibility:hidden",
    "pointer-events:none",
    "padding-top:env(safe-area-inset-top)",
    "padding-bottom:env(safe-area-inset-bottom)",
  ].join(";");
  document.body.appendChild(probe);
  return probe;
}

function apply(reset: boolean): void {
  const el = ensureProbe();
  if (reset) {
    maxTop = 0;
    maxBottom = 0;
  }
  const cs = getComputedStyle(el);
  const top = parseFloat(cs.paddingTop) || 0;
  const bottom = parseFloat(cs.paddingBottom) || 0;
  maxTop = Math.max(maxTop, top);
  maxBottom = Math.max(maxBottom, bottom);
  const root = document.documentElement.style;
  root.setProperty("--sat", `${maxTop}px`);
  root.setProperty("--sab", `${maxBottom}px`);
}

// Poll a handful of frames: iOS often reports 0 for the first paint(s) and
// only fills in the real inset after a reflow. We only honour `reset` on the
// first frame so a transient 0 right after the reset can't stick.
function pollApply(reset: boolean, frames = 10): void {
  let tries = 0;
  const step = () => {
    apply(reset && tries === 0);
    if (++tries < frames) requestAnimationFrame(step);
  };
  step();
}

export function setupSafeAreaInsets(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const start = () => pollApply(false);
  if (document.body) {
    start();
  } else {
    window.addEventListener("DOMContentLoaded", start, { once: true });
  }

  // Orientation / size changes legitimately change the insets — measure fresh.
  window.addEventListener("resize", () => pollApply(true));
  window.addEventListener("orientationchange", () => pollApply(true));
  // Resume from background can re-trigger the transient-0 bug.
  window.addEventListener("pageshow", () => pollApply(false));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) pollApply(false);
  });
}
