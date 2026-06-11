---
name: WHMCS subfolder-redirect self-heal
description: Why the WHMCS API client retries on redirect, and the common vanity-subdomain → subfolder deployment trap.
---

# WHMCS vanity-subdomain → subfolder redirect

A very common real-world WHMCS deployment puts the app in a **subfolder**
(`https://example.com/billing`) while a **vanity subdomain**
(`https://billing.example.com`) 301-redirects to it. The redirect target is the
HTML **admin/client area** (e.g. `…/billing/admin/login.php`), NOT the API.

**Why this bites:** `fetch` follows redirects by default, so a POST to
`<subdomain>/includes/api.php` lands on an HTML login page → non-JSON body →
every WHMCS feature (connection test, client search, billing) fails with
"WHMCS returned a web page instead of API data". Following the redirect does
**not** help because it points at `/admin`, not the API root.

**Fix in place:** `whmcsApiCall` detects `!data && res.redirected`, calls
`deriveWhmcsRootFromUrl(res.url)` (strips `/admin`,`/clientarea`,`/includes`,…
+ trailing `*.php` to recover the install root), and retries the API call once
against that root. So saving either the subdomain OR the real subfolder root
works.

**Why kept stateless / not persisted:** `server/whmcs.ts` is a documented
stateless client — the healed root is NOT written back to `whmcs_settings`
(only `getWhmcsSettings()` reads). Trade-off: while the heal is active every
call pays a double round-trip. If that ever becomes steady state, memoize the
healed root in-process (do not write the DB from whmcs.ts).

**How to find the real root for a given WHMCS:** `curl -s -D - -o /dev/null -X
POST "<candidate>/includes/api.php" --data "action=GetClients&responsetype=json"`
— a healthy API root returns JSON `{"result":"error","message":"Authentication
Failed"}` (HTTP 403) even with no credentials; a wrong root returns HTML or a
3xx Location pointing at the real path.

**Also:** WHMCS returns auth failures ("Authentication Failed") and IP-allowlist
misses ("Invalid IP <ip>") as `result:error` JSON with a **non-2xx** status —
`whmcsApiCall` now surfaces that message instead of a bare "HTTP 403" so the
admin can tell the two apart on the connection test.
