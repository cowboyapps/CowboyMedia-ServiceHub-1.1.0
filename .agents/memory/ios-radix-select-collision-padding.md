---
name: iOS Radix Select collisionPadding
description: Why tall Radix/shadcn Select menus render off the top of an iPhone screen and the fix
---

# iOS Radix Select menus overflow the status bar / notch

On iPhone (Safari + installed PWA), a Radix `Select` (shadcn `SelectContent`, `position="popper"`)
with many items, anchored to a trigger low on the screen, opens **upward** and lets the menu butt
against — and tuck **under** — the status bar / notch. The top rows become unreachable: there is no
visible scroll-up affordance because it sits behind the status bar.

**A `max-height` cap alone does NOT fix it.** We first tried
`max-h-[min(60dvh,var(--radix-select-content-available-height))]`. The menu stayed capped/scrollable
but its **top edge** still landed under the status bar, so the first items were still unreachable.

**Fix:** add `collisionPadding` to the `SelectContent` (e.g.
`collisionPadding={{ top: 60, bottom: 24, left: 12, right: 12 }}`). Radix then (1) keeps a margin
from the viewport edges so the menu top clears the status bar/notch, and (2) shrinks
`--radix-select-content-available-height` so the whole menu fits inside the safe area and every item
scrolls into view.

**Why:** `--radix-select-content-available-height` is measured to the layout-viewport edge, which on
iOS includes the area under the status bar/notch — so without collision padding Radix happily places
content there. Padding is what pulls the boundary inward.

**How to apply:** any long Select/Dropdown that can open near a screen edge on mobile. Keep the
`max-height` cap too (bounds + internal scroll); collision padding handles placement. We applied it
per-instance (the order-service dialog in `client/src/pages/my-services-page.tsx`) rather than in the
shared `client/src/components/ui/select.tsx`, to limit blast radius — consider globalizing the default
if this recurs on other screens.
