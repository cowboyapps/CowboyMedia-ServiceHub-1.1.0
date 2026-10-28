---
name: iOS keyboard-inset detection vs viewport pan
description: Measure iOS keyboard occlusion from the visual viewport bottom edge and un-pan the document
---

**Rule:** Detect keyboard opening from `window.innerHeight - visualViewport.height`, then derive padding from the visual viewport bottom edge by subtracting `offsetTop`. If iOS pan consumes the full padding inset, retain a minimal nonzero open signal. Re-measure across viewport settling and un-pan with `window.scrollTo(0, 0)`.

**Why:** iOS resizes and pans the visual viewport in stages. Ignoring a retained positive `offsetTop` counts top displacement as keyboard coverage, over-padding the layout and leaving the composer floating far above the keyboard.

**How to apply:** Keep shared detection for typing surfaces. Threshold raw viewport loss, use bottom-edge occlusion for padding, clamp to a 1px open sentinel after full pan, snap open, re-pin local scroll, and retain the close transition.

**Android distinction:** Zero occlusion padding does not mean the software keyboard is closed. With `interactive-widget=resizes-content`, both viewports shrink together. Navigation visibility and its reserved space must use keyboard-open state separately from inset padding.

**Why:** The user reported long drafts hidden behind bottom navigation on Pixel and Galaxy devices; treating zero Android inset as a closed keyboard left that navigation over the composer.

**How to apply:** Preserve zero Android padding, use focus plus viewport shrink for visibility (not focus alone), and retain the pre-focus baseline through small animation steps. Browser layout checks must wait for the resize event before asserting settled geometry; desktop viewport emulation does not establish physical-device compatibility.

**Rotation constraint:** Never estimate the unobscured landscape viewport by adding the portrait keyboard height. Keyboard heights differ by orientation, so that estimate can keep navigation hidden after dismissal. Learn each orientation's closed baseline; for a new orientation reached while typing, track the open viewport's rebound rather than carrying portrait occlusion over.
