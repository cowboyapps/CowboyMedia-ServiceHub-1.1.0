---
name: Mobile UI expectations
description: User expectations for phone orientation and support-ticket presentation
---

The user says, "Everyone uses the app in mobile form," and wants to see dashboard designs in mobile layout.

**Why:** Phone use is the primary customer experience, not a secondary responsive variation.

**How to apply:** Prioritize phone layouts and show dashboard proposals at phone size first.

Support-ticket messaging should feel smoother and visually cleaner, especially pictures/videos, sent/read status, Delete for everyone, and long links. The user described the current conversation as “old and messy.”

**Why:** The user explicitly requested improvements to these parts of the ticket experience, not just another color/theme change.

**How to apply:** Judge changes against conversation readability and usability, preserving existing messaging behaviors and permissions.

The user wants the entire support-ticket experience upgraded in appearance and function to behave like texting, Telegram, or Messenger. This includes full-screen photo/video viewing, customer saving of images/videos/other attachments, customer/admin emoji reactions, copying full messages, and compact long links. They prefer a long-press message menu for reactions, Copy, and authorized admin Delete for everyone, with a three-dot menu as an alternative.

**Why:** The user explicitly expanded the support-ticket scope beyond visual cleanup.

**How to apply:** Treat these as functional customer/admin requirements, not cosmetic placeholders. Keep the separate restriction against restyling the rest of the app.

The user narrowed the UI work to “support ticket work and phone horizontal appearence” and said to “leave the app the way it looks throughout alone otherwise.”

**Why:** The user explicitly excluded broader app restyling.

**How to apply:** This was the earlier scope restriction; the user subsequently requested the dashboard style across customer and admin screens, as recorded below. Shared navigation fixes alone still do not authorize unrelated functional changes.

The user approved applying the alert-first dashboard canvas design to the actual customer dashboard, including its incident and all-clear layouts, while leaving the rest of the app unchanged.

**Why:** The user preferred the canvas appearance and explicitly answered “Apply the canvas design” after being told the app had not yet changed.

**How to apply:** Preserve the approved dashboard's visual hierarchy and styling when wiring real data. This approval does not authorize broader app restyling, a Git push, or publication.

The user likes the alert-first dashboard and wants to carry its style and theme throughout the app. When asked whether matching styling should include the Admin Portal, they selected “Customer and admin screens.”

**Why:** The user explicitly expanded the visual scope beyond the earlier dashboard-only and messaging-only restrictions.

**How to apply:** Use the approved dashboard as the visual reference for customer and admin refreshes, preserving their different purposes and existing functionality. This scope selection is not authorization to push to Git or publish.

The user subsequently extended the ticket-messaging upgrades to private
admin/customer messages, including fixing video sending. This extends the
conversation scope, not permission to redesign unrelated screens.

**Why:** The user requested "private messages with the same upgrades we made to support ticket messaging."

**How to apply:** Keep private conversations consistent with ticket messaging
while retaining their separate access rules and customer/admin relationships.

Phones should not switch into a sideways desktop layout. The user prefers preventing horizontal rotation; if horizontal phone use is allowed, it must be designed for phones, keep the menu on the bottom, and adjust the UI for phone use.

**Why:** The user said sideways phone screens with the menu down the side look very bad and are not designed to fit.

**How to apply:** Respect portrait preference where supported and ensure any unavoidable landscape fallback remains a phone interface. Do not treat a landscape phone as desktop merely because its viewport is wider.

A usable phone landscape ticket screen must preserve conversation space, not just keep navigation on the bottom. Long drafts and support-availability notices must not consume the entire short screen.

**Why:** Browser verification found that bottom navigation alone still left almost no visible conversation when the ordinary after-hours notice and a four-line empty composer were present.

**How to apply:** Keep phone composers compact with bounded growth and scrollable tools; expose availability details without permanently reserving their full height in short landscape views. Preserve the normal desktop/tablet layout.
