---
name: My Services page test dependencies
description: jsdom tests that render my-services-page must track context providers and catalogue fixture shape as the page evolves
---

# My Services page component tests must track page dependencies

Several jsdom tests render `client/src/pages/my-services-page.tsx` directly
(`my-services-empty-state`, `store-catalogue-filter`, `store-catalogue-sort`,
`store-order-options`, `store-order-estimate`). When the page gains a new
context dependency or reads a new catalogue field, every one of these fixtures
must be updated in lockstep or the whole file crashes (which the single-pass
runner reports as the file failing).

**Rules learned:**
- The page (AddProductFlow) calls `useAuth()`, so the test wrapper must nest the
  page inside `AuthProvider` (from `client/src/lib/auth`), e.g.
  `createElement(AuthProvider, null, createElement(MyServicesPage))`. Missing it
  → "useAuth must be used within AuthProvider".
- Step 2 of the order flow renders a photo gallery via `product.images.length`,
  so catalogue fixtures must include `images: []` (not just `imageUrl`). Missing
  it → `Cannot read properties of undefined (reading 'length')`.
- The catalogue sort is **remembered** across dialog reopen (the
  `setSortKey("featured")` reset was removed when per-user sort persistence
  shipped). A test asserting the sort "resets to Featured" on reopen is testing
  retired behavior — assert it persists instead.

**Why:** these are feature changes that left sibling tests encoding the old
contract; the failures only surfaced once the page actually rendered.

**How to apply:** before changing my-services-page's providers, the catalogue
payload shape, or the order-flow render path, grep `rg -l my-services-page test/`
and update each fixture/wrapper.

**Env note:** `store-order-options` was thought to OOM standalone, but the real
cause was an event-loop hang, not memory — see
[jsdom client-component tests](jsdom-client-component-tests.md) "Toasts block
process exit". Any test here that surfaces a toast (required-field block /
order-success) must unref the shadcn removal timer or the file hangs.
