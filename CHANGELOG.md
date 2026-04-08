# CowboyMedia Changelog

---

## Version 2.0 — April 8, 2026

A major update focused on real-time communication, smarter notifications, and a polished mobile experience.

### Two-Way Messaging
- **Conversational messaging** — You can now have real-time, back-and-forth conversations with the support team directly in the app. No more one-way messages.
- **Typing indicators** — See when the other person is typing, just like a native messaging app.
- **Smart auto-scroll** — New messages scroll into view automatically when you're at the bottom. If you've scrolled up to read older messages, a "New messages" pill appears so you don't lose your place.
- **Message input pinned to bottom** — The typing box stays fixed at the bottom of the screen, exactly like a native chat app.

### Unified Notification Center
- **Bell icon with badge** — A notification bell in the header shows your unread count at a glance. Tap it to see all your notifications in one place.
- **Grouped notifications** — Multiple messages from the same conversation are grouped into a single notification (e.g., "3 new messages") instead of cluttering the list with individual entries.
- **Tap to navigate, swipe to dismiss** — Tapping a notification takes you directly to the relevant page and clears it. The X button dismisses without navigating. "Clear all" wipes the entire list.
- **Smart suppression** — If you're already reading a conversation or ticket, the app won't pile up notifications for messages you're actively seeing.

### Mobile & PWA Improvements
- **Toast notifications moved to bottom** — Alerts like "Welcome back!" and "Alert posted" now appear above the bottom nav instead of covering the header and blocking navigation.
- **Safe area support** — Content properly accounts for the iPhone home indicator bar so nothing gets hidden behind the bottom navigation.
- **Smoother ticket chat** — The ticket conversation view is optimized with better scrolling, a pinned input bar, and real-time updates without page refreshes.
- **Pull-to-refresh** — Swipe down to refresh on most pages, with haptic feedback on supported devices.

### Notifications & Alerts
- **Customers receive message notifications** — Fixed an issue where customers weren't always notified when admins sent messages. Now works reliably for all admin roles.
- **Push notification badges** — The app icon badge on your home screen reflects unread notifications and clears automatically when you've caught up.
- **Email notifications** — Receive email alerts for new messages, ticket updates, and service alerts (respects your notification preferences in Settings).

---

## Version 1.5 — March–April 2026

### Forgot Password
- **Self-service password reset** — Forgot your password? Request a reset link via email and set a new one without contacting support.

### URL Monitoring & Service Health
- **Live service monitoring** — Services are now checked automatically at regular intervals. If something goes down, you'll know through alerts before you even notice.
- **Multiple check types** — Monitors support HTTP status checks, keyword detection, response time thresholds, SSL certificate validation, and more.
- **Incident history** — View a timeline of past outages and recoveries for each monitored service.
- **Recovery alerts** — Get notified not just when a service goes down, but also when it comes back online.

### Downloads
- **Downloads page** — Access files shared by the team, like guides, setup instructions, or media, directly from the app.

### Bug Fixes & Polish
- **Fixed header scrolling away** — On Android and iOS, the header and navigation stay pinned in place during ticket chats and other scrollable views.
- **Fixed iOS notch overlap** — Content no longer hides behind the notch or status bar on iPhones.
- **News page scrolling fixed** — News articles scroll smoothly on iOS without pull-to-refresh interfering.
- **Email cooldown** — Ticket reply notifications are rate-limited so your inbox doesn't flood during a fast back-and-forth conversation.

---

## Version 1.0 — February–March 2026

### Core Features
- **Service status dashboard** — See all your services at a glance with real-time status indicators.
- **Service alerts** — Get notified immediately when a service has an issue, with detailed updates as the situation evolves.
- **Support tickets** — Submit support requests by category with real-time chat, file attachments, and status tracking.
- **News stories** — Stay up to date with announcements and news published by the team, complete with photos.
- **Service updates** — View detailed update logs for each service.

### PWA Experience
- **Install as an app** — Add CowboyMedia to your home screen for a full-screen, native app-like experience on any device.
- **Push notifications** — Opt in to receive real-time push notifications for alerts, ticket updates, and news.
- **Offline support** — The app loads even with spotty connectivity thanks to service worker caching.
- **App badge** — The app icon shows an unread count badge on supported devices.

### Account & Settings
- **Theme support** — Choose between light, dark, or system theme.
- **Notification preferences** — Control which notifications you receive via push and email.
- **Setup reminders** — Helpful prompts to enable push notifications and configure your services when you first sign up.

### Reports & Requests
- **Report content issues** — Flag problems with specific services directly from the app.
- **Request movies/series** — Submit requests for new content to be added.
- **Report app issues** — Found a bug or have a feature idea? Submit it with optional screenshots.
