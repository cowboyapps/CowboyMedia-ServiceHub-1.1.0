---
name: iOS PWA push diagnostics
description: Why iOS PWA push-enable failures need server-side capture, and the result+diagnostic pattern used for them.
---

# iOS PWA push-enable failures must be captured server-side

iOS PWA users cannot open a JS console, so a push-enable helper that catches every
error and returns a bare `false` with a generic toast leaves the real failure
**unobservable** — both to the customer and to us. Two iPhone "can't turn on
notifications" tasks in a row were caused by this diagnosis gap, not by the
underlying push code.

**The rule:** any client push / service-worker failure path must (a) return a
*specific* reason the user can act on, and (b) report the failure stage to the
server error log (category `push`, via `logError`), not just `console`.

**How it's wired here:**
- `subscribeToPush()` returns a discriminated `PushResult` (`{ok}` | `{ok:false, code, reason}`); every UI caller shows `result.reason`.
- `doSubscribe()` fire-and-forgets `reportPushDiagnostic(stage, detail)` → `POST /api/push/diagnostic` (auth) → `logError("push", ...)`, so the precise stage (`sw-ready`, `subscribe`, `no-vapid`, `not-standalone`, `server-register`, …) shows up in Admin Portal → error logs.

**iOS-specific gotchas baked into doSubscribe (keep them):**
- Web push only works in the **Home-Screen standalone** install — in a Safari tab `PushManager` exists but `subscribe()` fails. Guard with an iOS + non-standalone check and tell the user to open from the Home Screen.
- A fire-and-forget SW registration may not be done yet → `serviceWorker.ready` hangs to the timeout. Call `registerServiceWorker()` explicitly *before* awaiting `ready`.
- A subscription minted for an **old VAPID key** is stale (server can't deliver; iOS throws `InvalidStateError` if you resubscribe with a different key while it exists). Compare `subscription.options.applicationServerKey` bytes to the current key; on mismatch unsubscribe + resubscribe.

**Why:** the prior fix (timeouts + moving `requestPermission` into the gesture) only stopped the toggle *hanging*; it still failed silently. Surfacing the reason is what makes the next iOS report diagnosable instead of guesswork.
