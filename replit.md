# ServiceHub - Service Status & Support Platform

ServiceHub is a PWA for centralized service status monitoring and customer support, offering real-time alerts, news, and ticketing.

## Run & Operate

- **Run Dev Server**: `npm run dev`
- **Build**: `npm run build` (runs `npm test` first via `prebuild`)
- **Typecheck**: `npm run typecheck`
- **Test**: `npm test` (runs all `*.test.ts` under `test/`, `shared/`, `server/` via `tsx --test`)
- **Codegen**: `npm run codegen`
- **DB Migrations**:
    - **Generate**: `npm run db:generate` after editing `shared/schema.ts` — produces `migrations/<idx>_<name>.sql`. Commit the SQL + the regenerated `migrations/meta/` files together.
    - **Apply**: automatic on app start (`server/migrate.ts` calls drizzle's migrator inside a transaction before `registerRoutes`). pm2 will not flip to a build whose migrations failed.
    - **Drift check**: `npm run db:check` — also runs as part of `prebuild` and in CI. Fails when `shared/schema.ts` and `migrations/` disagree.
    - **How to add a column**: edit `shared/schema.ts`, run `npm run db:generate`, commit the new SQL + meta files, push. The migrator applies it on the next boot. Do NOT hand-write `ALTER TABLE` in `server/index.ts`.
- **Environment Variables**:
    - `DATABASE_URL`
    - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
    - `SENDGRID_API_KEY`
    - `TELEGRAM_BOT_TOKEN` (optional)
    - `AI_INTEGRATIONS_OPENAI_BASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY` (optional)
    - `DEPLOY_GATE_TOKEN` (production only — long random string. Bearer token the VPS deploy webhook listener uses to read `app_settings.auto_deploy_enabled` over HTTP before invoking `update.sh`. Must match the value in `/etc/servicehub-deploy.env` on the VPS. If unset, the listener fails closed and refuses to deploy.)

## Replit ↔ GitHub sync (manual)

Replit does NOT auto-push to GitHub. The user-chosen workflow is:
1. Make changes in Replit. Verify locally.
2. From the Replit shell: `git add -A && git commit -m "<msg>" && git push origin main`.
   - **If the push errors with "OAuth App lacks workflow scope"** (happens when the change touches `.github/workflows/`), use a PAT URL instead:
     `git push https://cowboyapps:<PAT>@github.com/cowboyapps/CowboyMedia-ServiceHub-1.1.0.git main`.
     The PAT must have `repo` + `workflow` scopes. Run `git config --global credential.helper store` once so the credential is remembered.
3. The push fires the GitHub webhook → VPS webhook listener (`deploy/webhook-listener/`) → `deploy/update.sh` → PM2 reload.
4. Outcome posts to the deploy Discord channel (success ✅ / failure ❌ with last-20-lines log tail).
5. To pause production deploys (e.g. during a maintenance window), use **Admin Portal → Deploy → Pause auto-deploy**. The flag lives in `app_settings.auto_deploy_enabled`; the listener checks it before running `update.sh`.

## Manual deploy (when auto-deploy can't fire)

The webhook listener fails closed when the app is down (it can't read `app_settings.auto_deploy_enabled` from a dead app). When that happens, recover by hand on the VPS:

```bash
cd /opt/servicehub
sudo -u servicehub git pull origin main
sudo -u servicehub npm ci
sudo -u servicehub npm run build
sudo -u servicehub pm2 reload servicehub          # reload, NOT restart --update-env
sleep 12 && curl -s http://localhost:5000/api/health
```

Critical: **never use `pm2 restart --update-env`** unless you have first sourced `/opt/servicehub/.env` into your shell. The `--update-env` flag overwrites pm2's saved environment with the current shell's env, which silently blanks `DATABASE_URL` and crash-loops the app with `SASL: client password must be a string`. If you ever need to relaunch from scratch, do it like this:

```bash
sudo -u servicehub pm2 delete servicehub
sudo -u servicehub bash -c 'set -a; source /opt/servicehub/.env; set +a; cd /opt/servicehub && pm2 start dist/index.cjs --name servicehub'
sudo -u servicehub pm2 save
```

To audit DB schema drift against `shared/schema.ts`:

```bash
sudo -u servicehub bash -c 'set -a; source /opt/servicehub/.env; set +a; npx tsx script/audit-schema.ts'
```

Reports any tables defined in `shared/schema.ts` that are missing from the DB (drift caused by a schema edit without a corresponding migration apply) or extra tables in the DB that aren't declared in schema.ts (orphans from removed features). Returns exit code 1 if drift is found, so it's safe to wire into CI later.

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
When the user says "change the version to...", update the `APP_VERSION` constant in `shared/version.ts` (single source of truth — settings, sidebar, bottom nav, and the welcome popup all read from it) without further explanation.

## Build artifacts

- **`dist/.git-sha`**: Written by `npm run build` (see `script/build.ts`). The running server reads it once at boot to populate `gitSha` in `/api/health`. `deploy/update.sh` asserts `health.gitSha === $NEW_SHA` after every reload to catch the "deploy ran but HEAD never moved" failure mode. Do not commit; do not delete during runtime.
- **`migrations/`**: Versioned SQL migration files generated by `drizzle-kit generate` from `shared/schema.ts`, plus `migrations/meta/` (drizzle's journal + per-migration snapshots). Committed to git. Applied at app boot by `server/migrate.ts`. The `migrations/legacy/` subfolder holds the pre-drizzle hand-written SQL files, kept for historical reference only — never executed.

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