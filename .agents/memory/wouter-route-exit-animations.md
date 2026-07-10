---
name: Wouter route exit animations
description: How to animate route OUT (not just IN) without re-firing the outgoing page's mount side effects.
---

# Animating route enter+exit with wouter

**Rule:** Do NOT implement route exit animations by keeping the outgoing route
mounted in a *second* wouter `<Router hook={frozen}>` tree/overlay. That second
tree is a fresh **remount** of the departing page (the in-flow layer re-keys and
unmounts the original instance), so the departing page's mount effects run
again during the ~exit window.

**Why:** several pages POST on mount (e.g. a services page calling a
`mark-read` endpoint in a mount `useEffect`). Remounting them on *leave*
re-fires those POSTs — a real behavior regression, even though it looks fine.
Two code reviews rejected the overlay approach for exactly this.

**How to apply — use the browser View Transitions API instead (single tree):**
- Render ONE routed tree: `<Router hook={routerHook}>{children}</Router>`.
- `routerHook` returns `[renderedLocation, navigate]` where `renderedLocation`
  is React state and `navigate` is the **real** browser navigate from the outer
  `useLocation()` — so in-page `<Link>`/navigation still change the real URL.
- On URL change, advance `renderedLocation` **inside**
  `document.startViewTransition(() => flushSync(() => setRenderedLocation(next)))`.
  The browser snapshots the old DOM first; flushSync makes the single tree swap
  the route **exactly once** (old unmounts once, new mounts once — identical
  lifecycle to a plain navigation), then crossfades the snapshot. No double
  mount → no duplicated side effects.
- Fallback: if `startViewTransition` is missing (Firefox) or
  `prefers-reduced-motion` is set, do a plain `setRenderedLocation(next)` — no
  motion, nothing can get stuck (no onAnimationEnd cleanup to strand).
- CSS: a root-scoped crossfade (`::view-transition-old/new(root)`) is enough —
  persistent chrome (sidebar/nav) is pixel-identical old vs new so only the
  changed page content shows motion, and there's no layout shift. Tokenize its
  duration/easing and disable it under `prefers-reduced-motion`.

`flushSync` comes from `react-dom`. Type `startViewTransition` via a
`Document & { startViewTransition?: (cb:()=>void)=>unknown }` cast to avoid `any`.
