---
name: Driving a Radix Select in jsdom tests
description: How to change a @radix-ui/react-select value from a jsdom component test (open + select).
---

# Driving a Radix Select in a jsdom component test

To change a Radix `Select` value in a jsdom `tsx --test`:
1. Open the menu: dispatch a `PointerEvent("pointerdown", {button:0, pointerType:"mouse", bubbles:true})` on the trigger. Radix only opens for `pointerType === "mouse"`.
2. Select the option: dispatch a plain `MouseEvent("click", {bubbles:true})` on the `SelectItem` element (find it by its `data-testid`).

Both steps inside `act()` + a frame flush.

**Why:** Two tempting approaches fail:
- The hidden native `<select>` (Radix BubbleSelect) is empty while the menu is closed — `SelectItem`s only register their `<option>`s while `SelectContent` is mounted, so setting its value never matches an option.
- A portaled `pointerup` on the item does NOT reach React's root listener (React 18 attaches to the root container; Radix portals `SelectContent` to `document.body`, outside it). A `click`, however, does fire `SelectItem`'s `onClick` → `handleSelect` (default `pointerTypeRef` is `"touch"`, so `onClick` selects).

**How to apply:** Any jsdom test that needs to flip a shadcn/Radix Select (sort dropdowns, filters). Also stub `HTMLElement.prototype.{hasPointerCapture,setPointerCapture,releasePointerCapture,scrollIntoView}` so opening doesn't throw. Reference: `test/store-catalogue-sort.test.ts`.
