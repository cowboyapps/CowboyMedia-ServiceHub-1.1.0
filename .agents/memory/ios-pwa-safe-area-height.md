---
name: iOS PWA safe-area + viewport-height double-count
description: Why the app-shell header "scrolls away sometimes" on iPhone PWA, and the layout invariant that prevents it.
---

# iOS PWA safe-area + viewport-height double-count

If `body` carries `padding: env(safe-area-inset-top) ... env(safe-area-inset-bottom)` (for notch/home-bar insets) AND the app-shell root is sized to the full dynamic viewport (`h-dvh` / `100dvh`), the document height becomes `100dvh + safe-area-top + safe-area-bottom` — taller than the viewport by the inset amounts. On iOS standalone PWA that surplus lets the **whole document** rubber-band scroll, sliding any element outside the inner scroll region (e.g. a top app header) up under the status bar. Symptom report: "the header scrolls away sometimes."

**Rule:** the element that owns the full-viewport height must subtract whatever vertical safe-area padding the body adds, so `body padding + shell height == 100dvh` exactly. The shell root height should be `calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))` (always include the `0px` fallback or the whole calc voids on browsers without `env()` support, collapsing the layout).

**Why:** `overscroll-behavior: none` alone does NOT fix this — it only damps the bounce; the document is still genuinely overflowing and scrollable. The only real fix is removing the height surplus.

**How to apply:** whenever you set a root container to `100dvh`/`h-dvh`/`h-screen`, check whether `body` (or an ancestor) also applies safe-area padding on the same axis. If so, cancel it in the height calc. Don't move the safe-area padding off `body` unless you re-home it inside the app (other top-level/unauth pages may rely on body padding + body scroll).
