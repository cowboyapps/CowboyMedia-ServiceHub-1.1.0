---
name: Radix Select long-item clipping on mobile
description: Why long <SelectItem> labels get cut off in the shadcn Select dropdown on narrow/mobile viewports, and the fix.
---

# Radix Select long-item clipping

The shadcn `SelectContent` primitive has `overflow-x-hidden` and the popper
width grows to the widest item (`min-w` = trigger width, then up to max-content).
On a narrow viewport a long single-line `<SelectItem>` label makes the content
wider than the screen; `collisionPadding` repositions but does NOT shrink width,
so the overflow is clipped and the end of the label is unreadable (e.g. WHMCS
shipping options "Outside USA (Place order with this option and con…").

**Fix:** cap the content width to the viewport AND let items wrap:
- `SelectContent` className: `max-w-[calc(100vw-1.5rem)]`
- long `SelectItem`s: `whitespace-normal break-words`

**Why:** capping max-width alone forces wrapping (block children wrap text within
the constrained width); the explicit wrap classes are belt-and-suspenders. A
max-height cap does nothing for horizontal clipping.

**How to apply:** any Select whose option text can be long/user-or-WHMCS-driven,
especially inside dialogs on mobile. The trigger keeps `[&>span]:line-clamp-1`
so the selected value stays one line — only the open menu wraps.
