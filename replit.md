# ServiceHub - Service Status & Support Platform

ServiceHub is a PWA for centralized service status monitoring and customer support, offering real-time alerts, news, and ticketing.

## Run & Operate

- **Run Dev Server**: `npm run dev`
- **Build**: `npm run build`
- **Typecheck**: `npm run typecheck`
- **Codegen**: `npm run codegen`
- **DB Push**: `drizzle-kit push:pg`
- **Environment Variables**:
    - `DATABASE_URL`
    - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
    - `SENDGRID_API_KEY`
    - `TELEGRAM_BOT_TOKEN` (optional)
    - `AI_INTEGRATIONS_OPENAI_BASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY` (optional)

## Stack

- **Frontend**: React, Vite, TailwindCSS, Shadcn UI, Wouter
- **Backend**: Express.js
- **Database**: PostgreSQL
- **ORM**: Drizzle ORM
- **Validation**: _Populate as you build_
- **Build Tool**: Vite
- **Real-time**: WebSockets

## Where things live

- **Frontend Source**: `client/src/`
- **Backend Source**: `server/src/`
- **Database Schema**: `db/schema.ts`
- **Migrations**: `migrations/`
- **Shared Utilities**: `shared/`
- **API Routes**: `server/src/routes.ts`
- **Notification Categories**: `shared/notification-categories.ts`
- **Knowledge Base Helpers**: `shared/kb.ts`
- **Announcement Routes Allowlist**: `shared/announcement-routes.ts`
- **SLA UI Helpers**: `client/src/lib/sla-ui.tsx`
- **OpenAI Client**: `server/openai-client.ts`

## Architecture decisions

- **PWA First**: Emphasizes native app-like experience with installability, offline support, and push notifications.
- **Real-time Everything**: WebSockets are used extensively for chat, admin communications, and instant updates.
- **Role-Based Access**: Granular permissions system for admin users ensures secure access control.
- **Rich Content Editing**: TipTap editor used for news, knowledge base articles, and postmortems, ensuring rich text formatting.
- **Optimistic UI Updates**: Implemented in support ticketing for a smoother user experience, particularly with message sending.
- **Business Hours Logic**: Centralized configuration and server-side calculation for SLAs and customer interactions, accounting for timezones and DST.
- **AI Integration**: Optional AI features for canned response suggestions and drafting replies, integrated with OpenAI.

## Product

- **Service Status Monitoring**: Real-time service health tracking, alerts, and incident management.
- **Support Ticketing System**: Category-based tickets, real-time messaging, and admin tools.
- **Customer Engagement**: News feed, unified notification center, community chat, and downloadable content.
- **Admin Portal**: Comprehensive tools for user, service, alert, and content management.
- **PWA Features**: Offline support, push notifications, and app badge management.
- **Knowledge Base**: Searchable articles with rich text, helpfulness feedback, and suggested articles for new tickets.
- **SLA Tracking**: Per-category service level agreement targets for first response and resolution times, with business hour considerations.
- **Incident Postmortems**: Rich-text postmortems for service alerts, with email and push notification fan-out to affected users.
- **Customer Onboarding Tour**: Interactive tour for first-time customers highlighting key features.
- **Admin Announcements**: Popup announcements for customers with rich text and optional in-app links.

## User preferences

I prefer detailed explanations.
I want iterative development.
Ask before making major changes.
When the user says "change the version to...", update the version string in `client/src/pages/settings-page.tsx`, `client/src/components/app-sidebar.tsx`, and `client/src/components/bottom-nav.tsx` without further explanation.

## Gotchas

- **Email Template Protection**: Custom email templates are protected from being overwritten during updates.
- **Telegram Integration**: Requires `TELEGRAM_BOT_TOKEN` secret; failures are non-blocking.
- **AI Integrations**: Requires `AI_INTEGRATIONS_OPENAI_BASE_URL` and `AI_INTEGRATIONS_OPENAI_API_KEY` for AI features to be active.
- **Postmortem Notifications**: "Original notification recipients" for postmortems relies on `user_notifications` table; alerts created before this tracking will not have specific recipients.

## Pointers

- **React Documentation**: `https://react.dev/`
- **TailwindCSS Documentation**: `https://tailwindcss.com/docs`
- **Drizzle ORM Documentation**: `https://orm.drizzle.team/docs/overview`
- **Vite Documentation**: `https://vitejs.dev/guide/`
- **Wouter Documentation**: `https://docs.wouter.com/`
- **Shadcn UI Documentation**: `https://ui.shadcn.com/docs`
- **Web Push API**: `https://developer.mozilla.org/en-US/docs/Web/API/Push_API`
- **date-fns-tz**: `https://date-fns.org/v2.30.0/docs/timezone`
- **DOMPurify**: `https://github.com/cure53/DOMPurify`