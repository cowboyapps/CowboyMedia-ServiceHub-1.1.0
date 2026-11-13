---
name: Missing page bundles and HTML fallback
description: Why an after-update notification failure can be a cached page-code mismatch rather than a broken ticket link
---

Treat missing hashed page assets separately from SPA navigation. An HTML shell
returned with HTTP 200 for a missing JavaScript file can be cached as a successful
asset, preventing normal page-import retries from recovering.

**Why:** While investigating a ticket-notification error after the version 10.0
release, public requests to missing asset URLs on the live app returned 200 HTML.
The screenshot showed the lazy-page boundary, which can represent either an
import failure or a rendering exception; it did not prove a ticket API failure.

**How to apply:** Preserve real asset failures and reject HTML asset responses.
Do not assume a new React lazy wrapper forces the browser to re-fetch a failed
module URL. Any reload fallback must preserve the exact destination, survive the
reload through a bounded guard, and distinguish rejected imports from rendering
bugs; never auto-reload indiscriminately for all page exceptions.
