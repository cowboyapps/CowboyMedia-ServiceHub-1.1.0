# ServiceHub - Service Status & Support Platform

## Overview
ServiceHub is a comprehensive Progressive Web App (PWA) designed to provide a centralized platform for service status monitoring and customer support. It enables customers to track service health, receive real-time alerts via push notifications, access news updates, and submit support tickets with integrated real-time messaging. For administrators, the platform offers extensive control over users, services, alerts, and news content. A key ambition is to deliver a native app-like experience through PWA capabilities, ensuring accessibility and engagement across devices.

## User Preferences
I prefer detailed explanations.
I want iterative development.
Ask before making major changes.
When the user says "change the version to...", update the version string in `client/src/pages/settings-page.tsx`, `client/src/components/app-sidebar.tsx`, and `client/src/components/bottom-nav.tsx` without further explanation.

## System Architecture
ServiceHub is built with a modern web stack, emphasizing PWA capabilities and real-time communication.

### UI/UX Decisions
The frontend utilizes React with Vite, styled using TailwindCSS and Shadcn UI for a clean, modern aesthetic. Wouter is used for routing. The application supports system/light/dark theme modes (system mode auto-syncs with device `prefers-color-scheme`, with manual override available) and features a mobile-responsive design with safe area support. Scroll position is remembered per-route via the `useScrollRestore` hook. PWA manifest includes shortcuts for Services, Tickets, Alerts, and News. Image lightboxes are implemented for an enhanced viewing experience.

### Mobile Navigation (Version 1.1)
- **Bottom Navigation Bar** (`client/src/components/bottom-nav.tsx`): Fixed bottom tab bar on mobile (<768px) with 5 tabs: Services, Tickets, Alerts, News, More. "More" opens a bottom sheet (Shadcn Sheet, side="bottom") with overflow-only items: Service Updates, Messages, Report/Request, Settings, Admin Portal (if admin). Includes user info row (avatar, name, role, logout) and version text. Badge support: Tickets tab shows unread ticket notification count; More tab shows a dot badge when overflow sections have unread items. Desktop sidebar is completely unchanged — bottom nav only renders on mobile.
- **Sticky Header**: Header stays fixed at top (outside scroll container) with `flex-shrink-0` and `min-h-[3rem]`, uses `bg-muted` background for visual separation in both light/dark themes. Outer container uses `h-dvh` (not `h-screen`) to prevent mobile browser address bar from causing outer page scroll. Centered CowboyMedia logo (`h-12` on mobile, `h-8` on desktop) links to dashboard (`/`). Mobile header shows a "Dashboard" rounded-rectangle button (left side, `rounded-lg`, Home icon) for quick home access. Desktop header shows SidebarTrigger on left + centered logo. OfflineBanner renders above PullToRefresh so it stays visible.
- **Directional Page Transitions**: `PageTransition` component uses route depth (0=dashboard, 1=top-level, 2=detail) to animate `slide-in-right` (going deeper), `slide-in-left` (going shallower), or `page-enter` (same level). CSS keyframes in `index.css` with `prefers-reduced-motion` fallback.
- **Haptic Feedback** (`client/src/lib/haptics.ts`): `hapticLight()`, `hapticMedium()`, `hapticSuccess()`, `hapticError()` using `navigator.vibrate()`. Applied to bottom nav taps (light) and pull-to-refresh trigger (medium). Gracefully no-ops on unsupported platforms.
- **Content-Shaped Skeletons**: Loading states on Dashboard, Services, Alerts, News, and Tickets pages use skeletons that mirror actual card layouts (status dots, title lines, badges, image placeholders).
- **Lazy Image Loading** (`client/src/components/lazy-image.tsx`): Uses IntersectionObserver (200px rootMargin) + crossfade transition. Shows shimmer placeholder before image enters viewport. Applied to news list images and dashboard news thumbnails.

### Technical Implementations
- **Frontend**: React, Vite, TailwindCSS, Shadcn UI, Wouter.
- **Backend**: Express.js, secured with session-based authentication using scrypt for password hashing.
- **Database**: PostgreSQL, managed via Drizzle ORM.
- **Real-time Communication**: WebSockets are used for real-time messaging in ticket support and admin chat functionalities.
- **File Management**: Multer is used for file uploads, storing data as base64 in the PostgreSQL `uploaded_files` table.
- **PWA Features**: Implemented with a Service Worker and Web App Manifest for installability on mobile devices, providing an offline-first and native app-like experience. Includes offline indicator banner, API response caching for offline data display, and auto-refresh on reconnection. Service worker cache version: `servicehub-v8` (static assets). Push notification badge uses monochrome silhouette icon (`/icons/badge-96.png`) for Android status bar. App badge (home screen icon count) uses `setAppBadge(count)`/`clearAppBadge()`: SW sets numeric count on push, clears on notification click when none remain; both sidebar (desktop) and bottom-nav (mobile) sync badge to in-app unread total on mount and `visibilitychange` (foreground resume).
- **Push Notifications**: Utilizes the Web Push API with VAPID for service alerts and ticket updates, avoiding third-party services like OneSignal or Firebase.
- **Email Services**: Integration with SendGrid for all transactional email communications.

### Feature Specifications
- **Authentication & Authorization**: Local username/password authentication with a robust admin role system. `master_admin` has full access, while custom admin roles have granular, permission-based access (`users.view`, `services.manage`, `admin_chat`, `support_tickets`, etc.).
- **Service Monitoring**: Comprehensive service status tracking with subscription options. Alerts automatically update service statuses (degraded/outage/maintenance) and resolve to operational. Consolidated push and email notifications are sent for alert events.
- **Support Ticketing**: Category-based ticket system with access control, allowing specific admin roles to view, claim, and interact with tickets. Real-time messaging, ticket transfer capabilities between admins, and visibility controls for claimed tickets are included. Typing indicators show when the other party is composing a message. Email notifications are suppressed when the recipient is actively viewing the ticket (WebSocket presence tracking with auto-reconnect and PWA visibility change re-registration). Push notifications always send regardless of presence. Enter key does NOT send messages — only the Send button does. Admin must provide a resolution note to close; customer can close without one (system records "Customer closed without providing a closing description"). A full conversation transcript email is sent to BOTH admin and customer when a ticket is closed, including ticket description, all messages, and the resolution/closing note.
- **Admin Communications**: Real-time admin chat with threads and file attachments. Typing indicators, mobile-optimized scrolling, URL word-wrap, push notification suppression when actively viewing threads, and refresh buttons mirror the support ticket chat improvements. `master_admin` can send broadcast priority alerts that persist and require acknowledgment.
- **Customer Engagement**: News stories with photo support, private messaging from admins to customers (with push, email, and in-app popups), and a customer message center with unread badges.
- **User Onboarding**: Setup reminder system with in-app dialogs and email notifications to encourage push notification and service configuration.

### Admin Activity Logs
- `admin_activity_logs` table stores all major system events: emails sent, push notifications, ticket lifecycle, alert lifecycle, service updates, news, reports, user role changes
- Gated by `logs.view` permission — assignable per admin role
- `logActivity()` helper in `server/routes.ts` writes logs fire-and-forget (non-blocking)
- Email logs store template key and subject only (no PII/variable content)
- Push logs store the notification payload (title, body, url)
- Frontend `LogsTab` component with category filter, search, pagination, and collapsible detail view

### Downloads
- `downloads` table: id, title, description, downloaderCode, downloadUrl, imageUrl (optional thumbnail), createdAt
- Admin management via "Downloads" tile in Admin Portal (CRUD with thumbnail upload)
- Customer-facing `/downloads` page with card grid; clicking opens detail dialog with title, description, downloader code (with copy button), and download link
- Admin routes gated by `downloads.view` / `downloads.manage` permissions
- Navigation: sidebar (between Report/Request and Settings), bottom nav More sheet, route registered in App.tsx
- Relevant files: `shared/schema.ts`, `server/storage.ts`, `server/routes.ts`, `client/src/pages/downloads-page.tsx`, `client/src/pages/admin-portal.tsx` (DownloadsTab), `client/src/components/bottom-nav.tsx`, `client/src/components/app-sidebar.tsx`

### Email Template Protection
- `customized` boolean column on `emailTemplates` table tracks admin-edited templates
- The seeder (`upsertEmailTemplate`) skips body/subject overwrites on customized templates but still syncs new `availableVariables`
- Editing a template via admin panel sets `customized = true`; resetting to defaults sets `customized = false`

## External Dependencies
- **Database**: PostgreSQL
- **Email Service**: SendGrid
- **Web Push API**: VAPID (for push notifications)
