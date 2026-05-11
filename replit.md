# ServiceHub - Service Status & Support Platform

ServiceHub is a PWA for centralized service status monitoring and customer support, offering real-time alerts, news, and ticketing.

## Run & Operate

- **Run Dev Server**: `npm run dev`
- **Build**: `npm run build` (runs `npm test` first via `prebuild`)
- **Typecheck**: `npm run typecheck`
- **Test**: `npm test` (runs all `*.test.ts` under `test/`, `shared/`, `server/` via `tsx --test`)
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
- **OpenAI Client**: `server/openai-client.ts`

## Architecture decisions

- **PWA First**: Emphasizes native app-like experience with installability, offline support, and push notifications.
- **Real-time Everything**: WebSockets are used extensively for chat, admin communications, and instant updates.
- **Role-Based Access**: Granular permissions system for admin users ensures secure access control.
- **Rich Content Editing**: TipTap editor used for news and knowledge base articles, ensuring rich text formatting.
- **Optimistic UI Updates**: Implemented in support ticketing for a smoother user experience, particularly with message sending.
- **Business Hours Logic**: Centralized configuration and server-side calculation for customer interactions and auto-responses, accounting for timezones and DST.
- **AI Integration**: Optional AI features for canned response suggestions and drafting replies, integrated with OpenAI.
- **Broadcast Channels**: Telegram and Discord fan-out modules (`server/telegram.ts`, `server/discord.ts`) mirror each other; admin call sites fire both side by side via fire-and-forget helpers. Discord supports per-service webhook overrides (services.discord_webhook_url) for alert / alert update / resolve / service update fan-outs; news still uses the global webhook.

## Product

- **Service Status Monitoring**: Real-time service health tracking, alerts, and incident management.
- **Support Ticketing System**: Category-based tickets, real-time messaging, and admin tools.
- **Customer Engagement**: News feed, unified notification center, community chat, and downloadable content.
- **Admin Portal**: Comprehensive tools for user, service, alert, and content management.
- **PWA Features**: Offline support, push notifications, and app badge management.
- **Knowledge Base**: Searchable articles with rich text, helpfulness feedback, and suggested articles for new tickets.
- **Customer Onboarding Tour**: Interactive tour for first-time customers highlighting key features.
- **Admin Announcements**: Popup announcements for customers with rich text and optional in-app links.
- **Public Status Page**: Unauthenticated `/status` page with live service health, 30-day uptime % + 90-day sparkline (when monitor linked), recent incidents, and per-service email "Follow" with confirm/unsubscribe via tokenised links.

## User preferences

I prefer detailed explanations.
I want iterative development.
Ask before making major changes.
When the user says "change the version to...", update the version string in `client/src/pages/settings-page.tsx`, `client/src/components/app-sidebar.tsx`, and `client/src/components/bottom-nav.tsx` without further explanation.

## Gotchas

- **Email Template Protection**: Custom email templates are protected from being overwritten during updates.
- **Telegram Integration**: Requires `TELEGRAM_BOT_TOKEN` secret; failures are non-blocking.
- **Discord Integration**: Webhook URL stored in DB (no env var); set via Admin Portal → Discord. Failures are non-blocking and never block customer notifications.
- **AI Integrations**: Requires `AI_INTEGRATIONS_OPENAI_BASE_URL` and `AI_INTEGRATIONS_OPENAI_API_KEY` for AI features to be active.
- **Rate Limits** (`server/rate-limits.ts`): Mounted on a few abuse-prone routes only. Login: 5 failures / minute / (IP+username). Register: 10 / hour / IP. Forgot- and reset-password: 3 / hour / IP. Ticket POST: 10 / hour / user. Report submission POST: 10 / minute / user. Community-chat post: 10 / minute / user. Community-chat reactions: 60 / minute / user. Admin and master_admin sessions bypass every limiter via `bypassRateLimitForAdmins`. Limits are enforced by `express-rate-limit` with an in-process memory store, so they reset on restart and are per-process — fine for current single-instance deployment, but document/replace if we ever run multi-process. Limit hits respond with JSON `{ error, retryAfterSeconds }` and a `Retry-After` header so the frontend can show a friendly toast.

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