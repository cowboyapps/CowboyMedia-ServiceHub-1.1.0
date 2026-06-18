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
- **Never depend solely on `navigator.serviceWorker.ready`** — on iOS standalone it can hang to the timeout *even when an active worker already exists*, and it also hangs forever if the SW's `install` step stalls. Use a helper (`getActiveRegistration`) that: returns the `register()`/`getRegistration()` result immediately if `reg.active`; else races a `statechange`→`"activated"` listener (on `reg.installing||reg.waiting`) against `serviceWorker.ready`, bounded by a timeout; with a final `getRegistration().active` fallback before throwing. The activation listener must **only ever resolve, never reject** — a fast reject (missing/redundant worker) would win the race and rob a working subscription. `pushManager.subscribe` only needs `registration.active`, not page control, so a not-yet-controlling registration is fine.
- **Bound the SW `install` precache.** A single `cache.add(url)` whose fetch hangs (never settles) blocks `install` → the worker never reaches `"activated"` → `ready` never resolves. Race each precache add against a ~3s timeout (`precacheWithTimeout` in sw.js); offline completeness on a slow first install is the accepted tradeoff. Per-url `.catch()` is NOT enough — it handles rejection, not a hang.
- A subscription minted for an **old VAPID key** is stale (server can't deliver; iOS throws `InvalidStateError` if you resubscribe with a different key while it exists). Compare `subscription.options.applicationServerKey` bytes to the current key; on mismatch unsubscribe + resubscribe.

**Why:** the first fix (timeouts + moving `requestPermission` into the gesture) only stopped the toggle *hanging*; it still failed silently. The second fix (PushResult + server diagnostics) surfaced the real stage — `sw-ready` — which is what pinpointed `serviceWorker.ready` as the culprit and led to the `getActiveRegistration` + bounded-install fix. Diagnose-then-fix: don't guess at iOS push failures, capture the stage first.

**Can't read the VPS prod logs from Replit.** Prod runs on the self-hosted VPS (cowboyhub.app) with its own Postgres, so `reportPushDiagnostic` lands in the VPS DB, NOT the Replit dev DB, and `executeSql(environment:"production")` hits a *Replit* replica that isn't this app's prod — useless here. When a sw-ready failure persists even after the fix is confirmed deployed (compare prod `/api/health` gitSha to `git rev-parse HEAD`; grep the prod bundle/`/sw.js` for the new symbols), the practical move is to **encode the live SW state into the toast string itself** (`swSnapshot`: `reg/got/active/inst/wait/ctrl`) — iPhone users can't open a console but they DO screenshot the toast, so the snapshot reaches you that way. `reg=null` ⇒ register() threw; `inst=installing` stuck ⇒ install never completed; `got=n` ⇒ no registration at all. registerServiceWorker swallows the register() rejection (returns null), so stash the reason in a module var and append it to the snapshot as `err=...` — without it `reg=null` alone can't tell a SecurityError (blocked site data/cookies) from a script-load failure. `reg=null got=n` on a real iPhone points at a device-side cause (Safari "Block All Cookies"/content blocker disabling SWs, or a stale Home Screen install) more than a code bug — remedy: remove + re-add the PWA to the Home Screen, check Safari site-data settings.
