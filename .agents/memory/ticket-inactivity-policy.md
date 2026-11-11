---
name: Ticket inactivity policy
description: Scope and safety decisions for automatic ticket closure.
---

Automatic ticket closure is opt-in. Count elapsed calendar days since creation or the most recent public reply/attachment from either side; internal notes, edits, reads and reactions do not restart the timer.

**Why:** The requested policy closes tickets without communication, not tickets without customer replies alone. Internal staff activity should not conceal customer-facing inactivity.

**How to apply:** Keep the automated label mandatory even with custom message text. Persist the inactivity reason and original activity time independently of the closing reply so deleting a message cannot erase why the ticket closed. Preserve serialization with new replies and atomic closure/audit writes.

Reject a late public reply specifically when automatic closure won the race; do not broaden this guard to all historical manually closed tickets.

**Why:** Existing transcript/edit workflows can contain messages created on manually closed tickets. The inactivity feature must not change those unrelated behaviors.

**How to apply:** Test reply-versus-closure races and automatic closure using isolated database fixtures; never enable the singleton policy against real development tickets merely to run a test.

Advance reminders require separate admin consent, even when automatic closure is already enabled. They follow existing ticket-reply channel preferences; quiet hours defer email/push but not passive in-app cards. Never extend closure merely because a reminder was deferred or sent.

**Why:** The requested reminder is optional and must respect customer choices without changing the existing inactivity policy. Reusing ticket-update preferences avoids silently opting customers into a new notification category.

**How to apply:** Treat public communication from either side as a new reminder cycle. Keep duplicate prevention independent per channel so creating an in-app card does not consume a quiet-hours-deferred email or push.

An investigation hold exempts a ticket from the inactivity sweep; it does not pause or reset elapsed communication time. Removing or expiring a hold can make a stale ticket immediately eligible, and manual closure stays available.

**Why:** Holds are exceptions to the existing global policy, not new communication or a replacement inactivity policy.

**How to apply:** Explain immediate eligibility in hold controls. Keep permission checks and audit persistence atomic with the hold, and serialize holds with replies and automated closure.

External reminder success means provider acceptance, not proof of inbox delivery, display or reading. Automatically retry only explicit rate-limit rejections, never uncertain outcomes after a timeout, restart or failed result write. Acceptance on any push device consumes that channel for the cycle.

**Why:** SendGrid mail sending and the current Web Push transport have no true delivery idempotency key. Replaying an uncertain send or a partly accepted multi-device push could duplicate the reminder.

**How to apply:** Commit claims before network sends, keep successes and ambiguous claims consumed, and cap/back off confirmed rejections. Every retry must revalidate the current public-activity cycle, preferences, quiet hours, policy and deadline under the same locks as replies and closure.
