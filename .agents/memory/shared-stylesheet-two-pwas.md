---
name: Shared stylesheet across customer + admin PWAs
description: Both PWAs import the same index.css; global token changes restyle admin unless scoped.
---

The customer app and the Admin PWA (separate entry at /admin) both import `client/src/index.css`, so any change to the `:root`/`.dark` design tokens silently restyles the admin app too.

**Why:** During the 2026 customer brand redesign, admin was explicitly out of scope, but the global token rewrite leaked into it — caught only in code review. Admin is now pinned to its original palette via `html.admin-app` override blocks (class added in the admin entry point).

**How to apply:** When changing customer-facing design tokens, either scope them or add matching entries to the admin override block. Tailwind config values (e.g. borderRadius) compile to literal values and CANNOT be scoped per-app — changes there affect both apps.
