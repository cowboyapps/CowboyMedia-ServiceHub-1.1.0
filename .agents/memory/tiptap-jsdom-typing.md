---
name: Driving TipTap/ProseMirror in jsdom tests
description: How to fill a required TipTap rich-text field in a jsdom component test so a real form submit passes validation
---

To type into a TipTap (ProseMirror) editor in a jsdom render test, grab the
contenteditable by its `${testIdPrefix}-content` data-testid, set `.innerHTML`,
then dispatch a bubbling `InputEvent("input")`. ProseMirror's DOM observer
flushes on that event and fires `onUpdate`, so the react-hook-form value updates
and a required `z.string().min(1)` message field passes validation on submit.

**Why:** ProseMirror ignores plain `.value` / `.textContent` writes; only a DOM
mutation + input event makes it sync state and call `onChange`. `setContent`
(what the editor does when the form value changes) updates *display* but does not
fire `onChange`, so seeding the form value alone won't help when the entry point
resets the message to "".

**How to apply:** any test that must submit a form containing a `RichTextEditor`
(e.g. alert updates, news, KB). Also: such a test fires a real `useMutation`, so
it MUST use `setupComponentTestTeardown` (collapses mutation gcTime to 0) or the
mutation gc timer hangs the file until the watchdog SIGKILLs it. If the same file
seeds a query cache and reads it back before an observer mounts (e.g. an update
timeline shown only when expanded), pass `collapseQueryGcTime: false`.
