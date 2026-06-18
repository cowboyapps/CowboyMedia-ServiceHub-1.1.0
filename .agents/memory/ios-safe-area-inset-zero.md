---
name: iOS safe-area-inset transient zero
description: Why the iOS PWA header slid under the notch and how the inset cache fixes it
---

# iOS header slides under the notch (intermittent)

On iOS standalone PWAs using `apple-mobile-web-app-status-bar-style: black-translucent`
+ `viewport-fit=cover`, the webview is full-screen and content MUST be padded by
`env(safe-area-inset-top)`. The header sliding under the notch/status bar
"sometimes" is the WebKit bug where `env(safe-area-inset-top)` is reported as
**0 on cold launch / resume from background** until some reflow happens. A CSS-only
`body { padding-top: env(safe-area-inset-top) }` therefore collapses to 0 in that
window and the header overlaps the status bar.

**Fix (do not regress):** resolve the inset from a hidden probe element in JS,
cache the **max value seen per orientation** into CSS vars `--sat` / `--sab`, and
have all consumers read `var(--sat, env(...))` / `var(--sab, env(...))` (env stays
as the pre-JS / non-iOS fallback). Reset the cache on `resize`/`orientationchange`
(so landscape's smaller top inset is measured fresh, not inherited from portrait),
re-poll on `pageshow`/`visibilitychange` (resume re-triggers the 0), and poll a
handful of frames per trigger to beat the transient 0. Keep the rAF loop bounded.

**Why:** a momentary 0 can never shrink the header back into the notch once a real
inset has been observed. On desktop/Android (insets 0) the vars resolve to `0px`,
so behavior is identical to before — this is iOS-only in effect.

**How to apply:** any new safe-area consumer should use the `var(--sat/--sab, env(...))`
pattern, never bare `env(safe-area-inset-top/bottom)`, or it will flicker under the
notch on iOS resume.
