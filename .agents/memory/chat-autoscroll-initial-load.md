---
name: Chat auto-scroll on open
description: Why chat pages must scroll the container to scrollHeight and re-pin across frames on first load.
---

# Chat auto-scroll to newest on open

All three chat surfaces (support ticket detail, admin↔customer messages, community
chat) share the same scroll pattern: a `scrollContainerRef` (the `overflow-y-auto`
div), a zero-height `messagesEndRef` marker at the bottom, an `isNearBottomRef`,
and a `prevMessageCountRef` effect that scrolls on first load / on new messages.

**Rule:** `scrollToBottom` must scroll the explicit container
(`el.scrollTo({ top: el.scrollHeight, behavior })`), keeping
`messagesEndRef.scrollIntoView` only as a fallback. On **first message load**,
re-pin to the bottom across a `requestAnimationFrame` plus a couple of short
timeouts (~120ms / ~350ms), with cleanup (`cancelAnimationFrame`/`clearTimeout`
returned from the effect).

**Why:** `scrollIntoView` on a zero-height trailing marker is unreliable on open —
it defaults to aligning the marker to the *top* and targets the nearest scrollable
ancestor, and it fires in the commit phase *before* images/avatars finish sizing,
so the single synchronous scroll lands short of the true bottom. Users then had to
tap the "New messages" pill to reach the newest message. Re-pinning across frames
lets the view settle once async content grows the scroll height.

**How to apply:** when touching any chat scroll logic, do NOT guard the first-load
re-pin timeouts on `isNearBottomRef` — late-loading images grow `scrollHeight`
without moving `scrollTop`, which makes `isNearBottom` read false and would skip
the very re-pin that fixes the bug. The 350ms window can fight a user who scrolls
up immediately on open; that tradeoff is intentional (open == show newest).
