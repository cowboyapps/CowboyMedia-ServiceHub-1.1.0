---
name: Conversation scroll intent
description: Separate following intent from measured distance; commit outgoing bubbles before scrolling and preserve history browsing.
---

# Conversation scroll intent

Following the newest message is user intent, not just the measured distance from
the current bottom. An outgoing send or retry must request following regardless
of the sender's previous position; scrolling must happen after the bubble commits.
Explicit upward browsing cancels continued following, and incoming replies must
not pull someone out of older history. A Latest control should depend on scroll
position, not require a newly arrived message.

**Why:** Scrolling synchronously after a React state setter measures the old
message list. Late image sizing, optimistic-to-saved replacement, and keyboard or
composer resizing then grow the bottom gap without the user choosing to scroll
away. Treating that gap as intent makes the latest outgoing message disappear.
The user explicitly said they should not have to close the keyboard to find it.

**How to apply:** Scroll the conversation pane itself, not the document or a
zero-height marker through `scrollIntoView`. Follow committed content and later
layout changes with coalesced, cleaned-up callbacks; stop following on deliberate
history browsing. Do not infer keyboard visibility solely from positive inset:
Android can resize both viewports and report zero.

Legacy chat surfaces may still use first-load frame/short-timeout re-pinning.
Do not gate those initial callbacks solely on a near-bottom measurement: late
images can make that measurement false. Preserve their existing behavior unless
that surface is explicitly in scope.
