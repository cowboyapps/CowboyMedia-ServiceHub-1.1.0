---
name: iOS keyboard-inset detection vs viewport pan
description: Why keyboard detection must ignore visualViewport.offsetTop and un-pan with scrollTo(0,0)
---

**Rule:** Detect the on-screen keyboard as `window.innerHeight - visualViewport.height` only. Never subtract `visualViewport.offsetTop` from the detection value, and when the keyboard is open while `offsetTop > 0` (or `scrollY > 0`), call `window.scrollTo(0, 0)` to un-pan.

**Why:** iOS pans the visual viewport down (offsetTop grows by ~the keyboard height) to chase the focused input. The subtraction cancels the measurement to ~0 at exactly the moment compensation is needed — the fixed bottom nav floats mid-screen, the header slides away, and no padding is applied (real user screenshot of the ticket reply composer, July 2026).

**How to apply:** `client/src/hooks/use-keyboard-inset.ts` is the single shared implementation; all typing surfaces (ticket detail, community chat, messages, admin portal, report dialog, bottom nav) consume its scalar inset. Android `interactive-widget=resizes-content` is safe: innerHeight and vv.height shrink together, so the diff stays ~0 — no double compensation. Regression pinned in `test/bottom-nav-keyboard-inset.test.ts` ("viewport pan must not cancel keyboard detection").
