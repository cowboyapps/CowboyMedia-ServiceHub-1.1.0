---
name: Dual-PWA split (customer / + admin /admin)
description: Rules for keeping the customer and admin apps isolated after the /admin PWA split
---

The app ships as TWO separately-installable PWAs from one repo: customer app at `/` (index.html) and "ServiceHub Admin" at `/admin` (admin.html, own manifest/icons, staff-only login).

**Rule:** any link between the two apps must be a HARD navigation (`navigateAcrossApps` / `window.location.assign` from `client/src/lib/admin-nav.ts`, or a plain `<a href>`), never a wouter `navigate()`/`<Link>`. SPA-routing into the other app's URL space renders the wrong bundle.

**Why:** each app is its own Vite entry with its own router; the customer SPA no longer contains AdminPortal, and `/admin*` inside the customer router only exists as a `window.location.replace` redirect.

**How to apply:**
- New admin entry points in customer UI → use `navigateAcrossApps`; tests can stub via `__setAssignForTests`.
- One shared `client/public/sw.js` serves both scopes — it derives app identity from `self.registration.scope` (admin scope → `servicehub-admin-*` caches, `/admin` shell fallback, `adminApp: true` in stale-deploy messages). Never fork it into two SW files, and never hardcode `/` paths in it.
- Push subscriptions are per-scope: admin entry calls `configurePushScope('/admin')` before SW registration.
- Server must serve admin.html for every `/admin*` path in BOTH dev (`server/vite.ts`) and prod (`server/static.ts`) fallbacks.
