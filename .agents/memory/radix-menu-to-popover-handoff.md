---
name: Radix menu → popover handoff
description: Opening a Popover from a DropdownMenu item — setTimeout(0) races the menu's focus restore; use onCloseAutoFocus.
---

Rule: when a DropdownMenuItem should open another Radix overlay (Popover, Dialog with focus trap), do NOT open it in `onSelect` via `setTimeout(0)`. Instead set a ref flag in `onSelect` and open the overlay in the menu content's `onCloseAutoFocus`, calling `e.preventDefault()` there so focus restore to the trigger doesn't dismiss the new overlay.

**Why:** the bare `setTimeout(0)` intermittently loses the race with the menu's close/focus-restore sequence — the newly-mounted popover gets dismissed immediately (flaked ~50% in jsdom multi-file runs; same hazard in real browsers).

**How to apply:** menu item `onSelect={() => pendingRef.current = true}`; `DropdownMenuContent onCloseAutoFocus={(e) => { if (pendingRef.current) { pendingRef.current = false; e.preventDefault(); setOpen(true); } }}`. Plain DOM actions like clicking a hidden file input are fine with `setTimeout(0)` — only overlay-vs-overlay handoffs need this.

Related: a Popover launched this way can hide its trigger (`hideTrigger` prop) and anchor to an invisible 1px span inside a `relative` parent.

jsdom note: Radix DropdownMenu focus scope needs `global.MutationObserver = window.MutationObserver`, and components compiled by tsx's classic JSX runtime need `global.React`.
