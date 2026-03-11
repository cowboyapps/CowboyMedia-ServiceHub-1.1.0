# ServiceHub - Service Status & Support Platform

## Overview
ServiceHub is a comprehensive Progressive Web App (PWA) designed to provide a centralized platform for service status monitoring and customer support. It enables customers to track service health, receive real-time alerts via push notifications, access news updates, and submit support tickets with integrated real-time messaging. For administrators, the platform offers extensive control over users, services, alerts, and news content. A key ambition is to deliver a native app-like experience through PWA capabilities, ensuring accessibility and engagement across devices.

## User Preferences
I prefer detailed explanations.
I want iterative development.
Ask before making major changes.
When the user says "change the version to...", update the version string in both `client/src/pages/profile-page.tsx` and `client/src/components/app-sidebar.tsx` without further explanation.

## System Architecture
ServiceHub is built with a modern web stack, emphasizing PWA capabilities and real-time communication.

### UI/UX Decisions
The frontend utilizes React with Vite, styled using TailwindCSS and Shadcn UI for a clean, modern aesthetic. Wouter is used for routing. The application supports system/light/dark theme modes (system mode auto-syncs with device `prefers-color-scheme`, with manual override available) and features a mobile-responsive design with safe area support. Scroll position is remembered per-route via the `useScrollRestore` hook. PWA manifest includes shortcuts for Services, Tickets, Alerts, and News. Image lightboxes are implemented for an enhanced viewing experience.

### Technical Implementations
- **Frontend**: React, Vite, TailwindCSS, Shadcn UI, Wouter.
- **Backend**: Express.js, secured with session-based authentication using scrypt for password hashing.
- **Database**: PostgreSQL, managed via Drizzle ORM.
- **Real-time Communication**: WebSockets are used for real-time messaging in ticket support and admin chat functionalities.
- **File Management**: Multer is used for file uploads, storing data as base64 in the PostgreSQL `uploaded_files` table.
- **PWA Features**: Implemented with a Service Worker and Web App Manifest for installability on mobile devices, providing an offline-first and native app-like experience. Includes offline indicator banner, API response caching for offline data display, and auto-refresh on reconnection. Service worker cache version: `servicehub-v6` (static assets) + `servicehub-v6-api` (API response cache, cleared on logout for privacy).
- **Push Notifications**: Utilizes the Web Push API with VAPID for service alerts and ticket updates, avoiding third-party services like OneSignal or Firebase.
- **Email Services**: Integration with SendGrid for all transactional email communications.

### Feature Specifications
- **Authentication & Authorization**: Local username/password authentication with a robust admin role system. `master_admin` has full access, while custom admin roles have granular, permission-based access (`users.view`, `services.manage`, `admin_chat`, `support_tickets`, etc.).
- **Service Monitoring**: Comprehensive service status tracking with subscription options. Alerts automatically update service statuses (degraded/outage/maintenance) and resolve to operational. Consolidated push and email notifications are sent for alert events.
- **Support Ticketing**: Category-based ticket system with access control, allowing specific admin roles to view, claim, and interact with tickets. Real-time messaging, ticket transfer capabilities between admins, and visibility controls for claimed tickets are included. Typing indicators show when the other party is composing a message. Email notifications are suppressed when the recipient is actively viewing the ticket (WebSocket presence tracking). A full conversation transcript email is sent to the customer when a ticket is closed.
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

### Email Template Protection
- `customized` boolean column on `emailTemplates` table tracks admin-edited templates
- The seeder (`upsertEmailTemplate`) skips body/subject overwrites on customized templates but still syncs new `availableVariables`
- Editing a template via admin panel sets `customized = true`; resetting to defaults sets `customized = false`

## External Dependencies
- **Database**: PostgreSQL
- **Email Service**: SendGrid
- **Web Push API**: VAPID (for push notifications)