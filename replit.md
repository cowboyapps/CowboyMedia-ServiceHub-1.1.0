# ServiceHub - Service Status & Support Platform

ServiceHub is a PWA for centralized service status monitoring and customer support, offering real-time alerts, news, and ticketing.

**Deploy pipeline, VPS layout, manual-deploy and recovery runbooks live in `docs/OPERATIONS.md`.** Read it before touching anything deploy-related (webhook listener, update.sh, PM2, prod env files, token rotation).

## Run & Operate

- **Dev**: `npm run dev` · **Codegen**: `npm run codegen` · **Typecheck**: `npm run check` (tsc)
- **Build**: `npm run build`. The `prebuild` gate runs first and fails fast (chained `&&`): `lint` → `check` (tsc) → `db:migrate` → `db:check` → `db:check:columns` → `test`. So a lint/type error, schema drift, or failing test blocks the build before it can reach a deploy.
- **Test**: `npm test` — runs every `*.test.ts` under `test/`, `shared/`, `server/` via `script/run-tests.ts`, each file in its own `tsx --test` subprocess. Files are split into two groups: **light** (plain server/shared logic) run in parallel, **heavy** (anything that imports `jsdom` — React render tests) run (near-)sequentially so they can't OOM the runner. Always prints an aggregated summary; exits non-zero on any failure/hang. Run a subset by passing paths: `tsx script/run-tests.ts test/sw.test.ts`.
  - Tunables: `TEST_CONCURRENCY_LIGHT` (light parallelism, default 4), `TEST_CONCURRENCY` (heavy parallelism, default 1 — keep low to avoid OOM), `TEST_FILE_TIMEOUT_MS` (per-file watchdog, default 180000).
  - **Run the whole suite end-to-end inside the container** (a single full run is too long for one tool call / detached runs get reaped): use the resumable, time-budgeted walk. `TEST_TIME_BUDGET_MS=90000 tsx script/run-tests.ts --resume` runs as many files as fit the budget, records every green file (keyed by mtime) to `node_modules/.cache/servicehub-test-progress.json`, and exits **2** if any remain. Re-run the same command to continue where it left off; progress survives even if the shell is killed mid-run. Exit **0** = full clean pass (cache auto-cleared), **1** = real failure, **2** = incomplete (resume to finish). `--reset` (or `TEST_RESET=1`) clears progress before running. CI/`prebuild` runs plain `npm test` (no budget) so it still walks everything in one process.

### DB migrations
- **Add a column**: edit `shared/schema.ts` → `npm run db:generate` (produces `migrations/<idx>_<name>.sql`) → commit the SQL **and** regenerated `migrations/meta/` together → push. Never hand-write `ALTER TABLE` in `server/index.ts`.
- **Apply**: automatic at boot (`server/migrate.ts`, drizzle migrator in a transaction before `registerRoutes`; pm2 won't flip to a build whose migrations failed). Also run in `prebuild` via `npm run db:migrate` so the column-drift audit right after sees the new shape.
- **Drift check**: `npm run db:check` (schema.ts vs migrations) and `npm run db:check:columns` (schema.ts vs live DB) — both run in `prebuild`/CI.

### Environment variables
- `DATABASE_URL`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `SENDGRID_API_KEY`
- `TELEGRAM_BOT_TOKEN` (optional), `AI_INTEGRATIONS_OPENAI_BASE_URL` / `AI_INTEGRATIONS_OPENAI_API_KEY` (optional)
- `WHMCS_API_IDENTIFIER` / `WHMCS_API_SECRET` (optional). Base URL is NOT an env var — it lives in the `whmcs_settings` DB row (Admin Portal → WHMCS Billing). Integration no-ops if any of {identifier, secret, baseUrl} is missing.
- Prod-only tokens (`DEPLOY_GATE_TOKEN`, `CHANGELOG_APPEND_TOKEN` — the latter mirrored to Replit Secrets): see `docs/OPERATIONS.md` for semantics and rotation.

## Deploying (summary)

Replit does NOT auto-push. `git add -A && git commit && git push origin main` fires the GitHub webhook → VPS listener → `deploy/update.sh` → PM2 reload, with outcome posted to the deploy Discord channel. Pause via Admin Portal → Deploy. Full pipeline detail, gotchas, and manual-recovery commands: `docs/OPERATIONS.md`.

## Stack

React · Vite · TailwindCSS · Shadcn UI · Wouter (frontend) · Express.js (backend) · PostgreSQL + Drizzle ORM · WebSockets (real-time).

## Where things live

- Frontend: `client/src/` · Backend: `server/` (flat, no `src/`) · Shared: `shared/` · Migrations: `migrations/`
- Schema: `shared/schema.ts` · API routes: `server/routes.ts`
- Notification categories: `shared/notification-categories.ts` · KB helpers: `shared/kb.ts` · Announcement routes allowlist: `shared/announcement-routes.ts`
- OpenAI client: `server/openai-client.ts` · WHMCS: `server/whmcs.ts` (stateless API wrapper + parsing) + `server/whmcs-settings.ts` (admin settings)

## Architecture decisions

- **PWA First**: installable, offline, push notifications.
- **Real-time Everything**: WebSockets for chat, admin comms, instant updates.
- **Role-Based Access**: granular admin permissions.
- **Rich Content**: TipTap editor for news + KB.
- **Optimistic UI**: in support ticketing.
- **Business Hours Logic**: centralized config + server-side calc, timezone/DST-aware.
- **AI**: optional canned-response + draft-reply suggestions via OpenAI.
- **Broadcast Channels**: Telegram + Discord fan-out modules (`server/telegram.ts`, `server/discord.ts`) mirror each other; admin call sites fire both via fire-and-forget. Discord supports per-service webhook overrides (`services.discord_webhook_url`) for alert/update/resolve/service fan-outs; news uses the global webhook.
- **WHMCS Billing**: `server/whmcs.ts` is a stateless client (mirrors the Telegram pattern) — creds from env, base URL from `whmcs_settings` singleton, never throws into handlers (returns tagged `{ok,...}`), no-ops when unconfigured. Linking stores `users.whmcs_client_id` (nullable, **UNIQUE**) + `users.whmcs_linked_at` (one WHMCS client ↔ at most one ServiceHub user). GET `/api/admin/users/:id/whmcs` is **PURE** (never writes/500s), locked shape `{ configured, enabled, link, linkedClient, suggestion }` (`linkedClient`/`suggestion` null when WHMCS unreachable). Auto-link via POST `/api/admin/users/:id/whmcs/auto-match` (idempotent, 409 on conflict), fired once by the frontend when a `suggestion` exists. Email matching is exact + case-insensitive.

## Product

Service status monitoring (health, alerts, incidents) · Support ticketing (categories, real-time messaging, admin tools) · Customer engagement (news feed, unified notification center, community chat, downloads) · Admin Portal (users, services, alerts, content) · PWA (offline, push, app badge) · Knowledge Base (rich-text search, helpfulness feedback, suggested articles on new tickets) · Customer onboarding tour · Admin announcements (rich-text popups + optional in-app links) · Public Status Page (unauth `/status`: live health, 30-day uptime % + 90-day sparkline when monitor linked, recent incidents, per-service email "Follow" with tokenised confirm/unsubscribe).

## User preferences

I prefer detailed explanations.
I want iterative development.
Ask before making major changes.
When the user says "change the version to...", update the `APP_VERSION` constant in `shared/version.ts` (single source of truth — settings, sidebar, and bottom nav all read from it) without further explanation. The rolling-draft changelog model (see below) still applies: on the new version's first boot, the server stamps the collected rolling-draft notes with the new `APP_VERSION` (status `awaiting_publish`) and opens a fresh rolling draft; a master admin then clicks **Publish** (Admin Portal → Changelog, or the "ready to publish" prompt). **There is NO customer-facing "Welcome to version X" popup any more** (removed July 2026 — too many signup popups): publishing simply makes the entry live on the `/whats-new` page ("What's new in this version" link in Settings). No notification of any kind is sent to customers on publish. Do not re-add a version popup.

**Auto-append the changelog as we work.** The changelog uses a **rolling-draft** model (`shared/changelog-rollover.ts`): a single always-open draft (reserved sentinel version `__rolling_draft__`, status `collecting`) collects every note regardless of the current version number. There is no per-version draft and no "wrong version / cannot append" rejection any more — the rolling draft always exists (created on demand) and always accepts appends. Whenever a change ships that a customer can see or interact with, append a single bullet from the Replit shell:

```bash
tsx script/append-bullet.ts <New|Improved|Fixed> "<one short customer-friendly sentence>"
```

That script POSTs to `https://cowboyhub.app/api/agent/changelog/append` (no version in the path) with the `CHANGELOG_APPEND_TOKEN` bearer, so the bullet lands in the **production** rolling draft — the same DB the user reads in Admin Portal → Changelog. **Do NOT call the helper against the local Replit DB** — bullets there are invisible to prod. (The session-gated `POST /api/admin/changelog/append` route backs the admin UI's "Edit draft" flow; legacy `:version` twins still exist and ignore the version param. All share the `appendBulletToBody` merge helper in `shared/changelog-append.ts`.) Rules:
- **Earns a bullet**: new user-visible features, fixes, UI/UX changes, anything meaningfully affecting a customer-facing function (faster, clearer, more reliable, new option/screen/alert channel).
- **No bullet**: pure refactors, dev tooling, internal plumbing, test-only/type-only/comment changes, build/CI tweaks, non-user-visible schema changes.
- **Buckets**: exactly three — `New` (brand new), `Improved` (existing got better), `Fixed` (bug fix). One per bullet.
- **Tone**: customer-friendly plain English ("Faster ticket replies on slow networks"), not engineer-speak. One short sentence.
- **Just append — don't worry about the version.** Bullets always land in the open rolling draft. On a version bump + reboot, the collected notes are auto-stamped with the new `APP_VERSION` (status `awaiting_publish`) and a fresh rolling draft opens. Never touch already-published history (the user owns those).
- **Publishing only happens as part of a version change.** The rolling draft is never directly publishable; only a version-stamped `awaiting_publish` entry is. The user proofreads, tweaks, and clicks **Publish** (or uses the on-open "ready to publish" prompt). Do not publish on the user's behalf.

## Gotchas

- **Email templates**: custom templates protected from being overwritten during updates.
- **Telegram**: needs `TELEGRAM_BOT_TOKEN`; failures non-blocking.
- **Discord**: webhook URL in DB (no env var), set via Admin Portal → Discord; failures non-blocking, never block customer notifications.
- **AI**: needs `AI_INTEGRATIONS_OPENAI_BASE_URL` + `AI_INTEGRATIONS_OPENAI_API_KEY` to be active.
- **Rate limits** (`server/rate-limits.ts`, abuse-prone routes only): login 5 fails/min/(IP+user); register 10/hr/IP; forgot+reset password 3/hr/IP (shared); ticket POST 10/hr/user; report POST 10/min/user; community post 10/min/user; community reactions 60/min/user. Admin/master_admin bypass all (`bypassRateLimitForAdmins`). In-process memory store (per-process, resets on restart — fine for single instance; revisit if multi-process). Hits return JSON `{ error, retryAfterSeconds }` + `Retry-After`.
- **`service_alerts.resolved_at` may disagree with `status='resolved'` on old rows.** The dashboard "Active alerts" counter filters on `status != 'resolved'` (matches the alerts page). Optional one-off reconcile (idempotent, not required): `UPDATE service_alerts SET resolved_at = COALESCE(resolved_at, created_at) WHERE status = 'resolved' AND resolved_at IS NULL;`

## Pointers

[React](https://react.dev/) · [TailwindCSS](https://tailwindcss.com/docs) · [Drizzle ORM](https://orm.drizzle.team/docs/overview) · [Vite](https://vitejs.dev/guide/) · [Wouter](https://docs.wouter.com/) · [Shadcn UI](https://ui.shadcn.com/docs) · [Web Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API) · [date-fns-tz](https://date-fns.org/v2.30.0/docs/timezone) · [DOMPurify](https://github.com/cure53/DOMPurify)
