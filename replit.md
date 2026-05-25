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
    - **Apply**: automatic on app start (`server/migrate.ts` calls drizzle's migrator inside a transaction before `registerRoutes`). pm2 will not flip to a build whose migrations failed. Also applied during `prebuild` via `npm run db:migrate` (same `runMigrations()` entry point, just invoked from `script/migrate.ts`) so the column-drift audit that runs immediately after sees the new shape — without this the gate would fail closed on every new-column deploy.
    - **Drift check**: `npm run db:check` — also runs as part of `prebuild` and in CI. Fails when `shared/schema.ts` and `migrations/` disagree.
    - **How to add a column**: edit `shared/schema.ts`, run `npm run db:generate`, commit the new SQL + meta files, push. The migrator applies it on the next boot. Do NOT hand-write `ALTER TABLE` in `server/index.ts`.
- **Environment Variables**:
    - `DATABASE_URL`
    - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
    - `SENDGRID_API_KEY`
    - `TELEGRAM_BOT_TOKEN` (optional)
    - `AI_INTEGRATIONS_OPENAI_BASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY` (optional)
    - `DEPLOY_GATE_TOKEN` (production only — long random string. Bearer token the VPS deploy webhook listener uses to read `app_settings.auto_deploy_enabled` over HTTP before invoking `update.sh`. Must match the value in `/etc/servicehub-deploy.env` on the VPS. If unset, the listener fails closed and refuses to deploy.)
    - `CHANGELOG_APPEND_TOKEN` (long random string, **must be set on prod AND mirrored to Replit Secrets**). Bearer token the agent uses to append changelog bullets straight at production via `POST /api/agent/changelog/:version/append`. Without this, the agent can't satisfy the auto-append rule below — its appends would land in the dev DB and never reach customers. On the VPS it lives in `/etc/servicehub.env`; the prod server reads it via PM2's process env. Rotation: `openssl rand -hex 32`, update Replit Secrets, update `/etc/servicehub.env`, then `sudo -u servicehub pm2 reload servicehub --update-env` (remember to source the env file first — see "Manual deploy" below). The route fails closed (HTTP 503) when the env var is unset, so a typo'd or missing prod value blocks appends loudly instead of silently dropping them.

## Replit ↔ GitHub sync (manual)

Replit does NOT auto-push to GitHub. The user-chosen workflow is:
1. Make changes in Replit. Verify locally.
2. From the Replit shell: `git add -A && git commit -m "<msg>" && git push origin main`. The canonical remote is `https://github.com/cowboyapps/CowboyMedia-ServiceHub-1.1.0.git`.
   - **If the push errors with "OAuth App lacks workflow scope"** (touches `.github/workflows/`), use a PAT URL: `git push https://cowboyapps:<PAT>@github.com/cowboyapps/CowboyMedia-ServiceHub-1.1.0.git main`. PAT needs `repo` + `workflow` scopes. Run `git config --global credential.helper store` once so it's remembered.
3. The push fires the GitHub webhook (`https://cowboyhub.app/_deploy`) → VPS listener (`servicehub-deploy.service`, `127.0.0.1:5055`) → `deploy/update.sh` → PM2 reload.
4. Outcome posts to the deploy Discord channel: `:rocket:` on start, `:white_check_mark:` on success (with verification line + duration), `:x:` on failure (with exit code + last-20-lines log tail), `:no_entry:` if dropped because auto-deploy is paused.
5. To pause production deploys, use **Admin Portal → Deploy → Pause auto-deploy**. The flag lives in `app_settings.auto_deploy_enabled`; listener checks it via `GET /api/admin/app-settings` (gated by `DEPLOY_GATE_TOKEN` bearer) before running `update.sh`. Pushes during a pause are DROPPED, not queued — push again after resuming.

### VPS deploy listener — install layout (greenest-ant)

- **Service**: `systemctl status servicehub-deploy` (unit at `/etc/systemd/system/servicehub-deploy.service`, source-of-truth in `deploy/webhook-listener/servicehub-deploy.service`).
- **Live logs**: `sudo journalctl -u servicehub-deploy -f`
- **Per-deploy logs**: `/var/log/servicehub-deploy/<delivery-id>.log` (also via `GET /_deploy/log/<id>` with `DEPLOY_GATE_TOKEN` bearer). Latest: `ls -t /var/log/servicehub-deploy/*.log | head -1 | xargs tail -60`.
- **Listener env file**: `/etc/servicehub-deploy.env` (mode 600, root-only). Contains `GITHUB_WEBHOOK_SECRET`, `APP_BASE_URL` (`http://127.0.0.1:5000`), `DEPLOY_DISCORD_WEBHOOK`, `DEPLOY_GATE_TOKEN`, `DEPLOY_REPO_FULL_NAME=cowboyapps/CowboyMedia-ServiceHub-1.1.0`. After editing: `sudo systemctl restart servicehub-deploy`.
- **Sudoers entry**: `/etc/sudoers.d/servicehub-deploy` allows the `servicehub` user to run only `bash /opt/servicehub/deploy/update.sh` (with optional `--ref <sha>`) as root with no password. Validate edits with `sudo visudo -c`.
- **Nginx**: `location = /_deploy` and `location ^~ /_deploy/` blocks in `/etc/nginx/sites-enabled/servicehub` proxy to `127.0.0.1:5055`. Health: `curl https://cowboyhub.app/_deploy/health` → `{"ok":true}`. Never leave config backups in `sites-enabled/` (nginx reads every file → "duplicate upstream" failure); move them to `/root/`.
- **Rotating the deploy Discord webhook**: edit `DEPLOY_DISCORD_WEBHOOK` in `/etc/servicehub-deploy.env`, restart the listener. (Different webhook from the in-app news/alerts Discord webhook, which lives in the DB.)
- **Rotating `GITHUB_WEBHOOK_SECRET`**: `openssl rand -hex 32` → update `/etc/servicehub-deploy.env` → restart listener → paste the same value into GitHub (Settings → Webhooks → Secret). Mismatch = every push rejected with HTTP 401.
- **Force a redeploy of the current `main` head**: `sudo FORCE_DEPLOY=1 bash /opt/servicehub/deploy/update.sh`. Bypasses post-update health gates + column-drift check — only use when you've root-caused why those gates would fail.
- **Replay a webhook delivery** instead of force-pushing: GitHub repo → Settings → Webhooks → Recent Deliveries → Redeliver.

### Recurring deploy gotchas

- **`update.sh` self-modifies mid-run.** `git reset --hard $NEW_SHA` replaces the script on disk while bash is still reading it. The script body is wrapped in `{ ... } && exit` so bash parses the entire compound command into the in-memory AST before executing line 1 — DO NOT unwrap. Without the wrap, bash keeps reading the old inode via its open FD and any fix shipped to update.sh doesn't take effect until the deploy AFTER the one that ships it (and can cause stuck-loop failures where rollback restores the broken on-disk version).
- **Two self-heal blocks at the top of `update.sh` chown root-owned paths back to `servicehub` before they break the build.** (1) `/home/servicehub` (covers `.npm`, `.bash_profile`, `.bashrc`, `.npmrc`) — fixes `EACCES on /home/servicehub/.npm/_cacache` and `bash: .bash_profile: Permission denied`. (2) `$APP_DIR/.git` — fixes `insufficient permission for adding an object to repository database .git/objects` during `git fetch`. Both fail loudly on chown errors; PM2 is not touched if they can't recover.
- **All four `npm run build` invocations in `update.sh` need `NODE_ENV=test` prefix** (primary deploy + 3 rollback paths). `.env` sets `NODE_ENV=production`, which makes the chained `npm test` load React's production bundle and crash on `act() is not supported in production builds of React`. If you add a new `npm run build` call site here, copy the override.
- **The listener silently posts to bad Discord URLs.** `fetch()` only throws on network errors, not HTTP 401/404. If posts stop appearing, sanity-check: `curl -X POST -H "Content-Type: application/json" -d '{"content":"test"}' "<URL>"` (expect HTTP 204).
- **Listener is silent on the happy path.** `journalctl -u servicehub-deploy` only shows sudo audit lines + startup. Use per-deploy log files under `/var/log/servicehub-deploy/`.
- **Retracted "permission drift" theories (Tasks #211–#217, May 2026).** Multiple outages were misdiagnosed as filesystem permission drift, root-shell recoveries, or external cron jobs. Real cause: the listener's systemd unit had `ProtectHome=true`, mounting `/home`, `/root`, `/run/user` as empty tmpfs for the listener AND every sudo'd child (mount namespaces are inherited; sudo doesn't escape them). Fix: `ProtectHome=false` in the listener unit. The home-dir self-heal in update.sh is kept regardless — defends against real perm drift if it ever happens.

## Manual deploy (when auto-deploy can't fire)

The listener fails closed when the app is down (can't read `app_settings.auto_deploy_enabled` from a dead app). Recover by hand on the VPS:

```bash
cd /opt/servicehub
sudo -u servicehub git pull origin main
# If you hit EACCES on .npm or "Permission denied" on .bash_profile:
#   sudo chown -R servicehub:servicehub /home/servicehub
# (update.sh does this automatically on webhook-triggered deploys, but
#  manual recoveries don't.)
sudo -u servicehub bash -lc 'cd /opt/servicehub && \
  npm ci --include=dev && \
  set -a; source .env; set +a; \
  NODE_ENV=test npm run build && \
  pm2 reload servicehub --update-env && \
  pm2 save'
sleep 12 && curl -s http://localhost:5000/api/health | jq '{ok,gitSha,version}'
```

**Why the env tricks**: `--include=dev` is needed because `.env` sets `NODE_ENV=production` which would skip devDependencies (drizzle-kit, vite). `NODE_ENV=test` on the build is needed because prebuild's `npm test` loads React, and React's production bundle strips `act()` → tests crash. Both are scoped: production runtime constant is baked into `dist/` by esbuild's define at build time, independent of these vars.

**Never use `pm2 restart --update-env`** unless you've first sourced `/opt/servicehub/.env`. The flag overwrites pm2's saved environment with the current shell's env, silently blanking `DATABASE_URL` and crash-looping the app with `SASL: client password must be a string`. To relaunch from scratch:

```bash
sudo -u servicehub pm2 delete servicehub
sudo -u servicehub bash -c 'set -a; source /opt/servicehub/.env; set +a; cd /opt/servicehub && pm2 start dist/index.cjs --name servicehub'
sudo -u servicehub pm2 save
```

**Audit DB schema drift against `shared/schema.ts`**:

```bash
sudo -u servicehub bash -c 'set -a; source /opt/servicehub/.env; set +a; npx tsx script/audit-schema.ts'
```

Reports tables defined in `shared/schema.ts` missing from the DB, or extra tables in the DB not declared in schema.ts. Exit code 1 on drift, safe to wire into CI later.

## Stack

- **Frontend**: React, Vite, TailwindCSS, Shadcn UI, Wouter
- **Backend**: Express.js
- **Database**: PostgreSQL
- **ORM**: Drizzle ORM
- **Build Tool**: Vite
- **Real-time**: WebSockets

## Where things live

- **Frontend Source**: `client/src/`
- **Backend Source**: `server/` (flat — no `src/` subfolder)
- **Database Schema**: `shared/schema.ts`
- **Migrations**: `migrations/`
- **Shared Utilities**: `shared/`
- **API Routes**: `server/routes.ts`
- **Notification Categories**: `shared/notification-categories.ts`
- **Knowledge Base Helpers**: `shared/kb.ts`
- **Announcement Routes Allowlist**: `shared/announcement-routes.ts`
- **OpenAI Client**: `server/openai-client.ts`

## Architecture decisions

- **PWA First**: Native app-like experience with installability, offline support, push notifications.
- **Real-time Everything**: WebSockets used extensively for chat, admin communications, instant updates.
- **Role-Based Access**: Granular permissions system for admin users.
- **Rich Content Editing**: TipTap editor for news and knowledge base articles.
- **Optimistic UI Updates**: Used in support ticketing for smoother message sending.
- **Business Hours Logic**: Centralized configuration + server-side calculation for customer interactions and auto-responses, accounting for timezones and DST.
- **AI Integration**: Optional AI features for canned response suggestions and drafting replies, via OpenAI.
- **Broadcast Channels**: Telegram and Discord fan-out modules (`server/telegram.ts`, `server/discord.ts`) mirror each other; admin call sites fire both side-by-side via fire-and-forget helpers. Discord supports per-service webhook overrides (`services.discord_webhook_url`) for alert / alert update / resolve / service update fan-outs; news still uses the global webhook.

## Product

- **Service Status Monitoring**: Real-time service health tracking, alerts, incident management.
- **Support Ticketing**: Category-based tickets, real-time messaging, admin tools.
- **Customer Engagement**: News feed, unified notification center, community chat, downloadable content.
- **Admin Portal**: Tools for user, service, alert, and content management.
- **PWA Features**: Offline support, push notifications, app badge management.
- **Knowledge Base**: Searchable articles with rich text, helpfulness feedback, suggested articles for new tickets.
- **Customer Onboarding Tour**: Interactive tour for first-time customers.
- **Admin Announcements**: Popup announcements for customers with rich text and optional in-app links.
- **Public Status Page**: Unauthenticated `/status` page with live service health, 30-day uptime % + 90-day sparkline (when monitor linked), recent incidents, per-service email "Follow" with confirm/unsubscribe via tokenised links.

## User preferences

I prefer detailed explanations.
I want iterative development.
Ask before making major changes.
When the user says "change the version to...", update the `APP_VERSION` constant in `shared/version.ts` (single source of truth — settings, sidebar, and bottom nav all read from it) without further explanation. The "Welcome to version X" popup is decoupled: when the new version boots, the server auto-creates an empty draft changelog entry; the popup only fires once the user clicks **Publish** on it in Admin Portal → Changelog.

**Auto-append the changelog as we work.** Whenever a change ships that a customer can see or interact with, append a single bullet to the **current** `APP_VERSION`'s draft entry by running, from the Replit shell:

```bash
tsx script/append-bullet.ts <New|Improved|Fixed> "<one short customer-friendly sentence>"
```

That script POSTs to `https://cowboyhub.app/api/agent/changelog/:version/append` with the `CHANGELOG_APPEND_TOKEN` bearer, so the bullet lands in the **production** draft — the same DB the user reads in Admin Portal → Changelog on their phone. **Do NOT call the helper against the local Replit DB** — bullets there are invisible to prod and stranded forever once `APP_VERSION` bumps (see the v5.2 backfill of tasks #232/#233/#234 for what the drift looks like). The session-gated `POST /api/admin/changelog/:version/append` route still exists for the admin UI's "Edit draft" flow; only automated callers use the `/api/agent/...` twin. The `appendBulletToBody` helper in `shared/changelog-append.ts` is still the canonical merge function — both routes share it server-side. Rules:
- **What earns a bullet**: new user-visible features, fixes, UI/UX changes, and anything that meaningfully affects a function the customer interacts with (e.g. faster, clearer, more reliable, new option, new screen, new alert channel).
- **What does NOT earn a bullet**: pure refactors, dev tooling, internal plumbing, test-only changes, comments, type-only changes, build/CI tweaks, schema changes that aren't user-visible.
- **Heading buckets**: exactly three — `New` (brand new capability), `Improved` (existing thing got better/faster/clearer), `Fixed` (bug fix). Pick one per bullet.
- **Tone**: customer-friendly plain English, like "Faster ticket replies on slow networks." Not engineer-speak ("Refactored useTickets hook to memoize selector"). One short sentence per bullet.
- **Scope = current version only**. The moment `APP_VERSION` is bumped, switch to writing into the new version's draft and never touch any older entry (draft or published) again. The user is the only one who edits older entries.
- The user proofreads + tweaks + clicks **Publish** when they're ready. Do not publish on the user's behalf.

## Build artifacts

- **`dist/.git-sha`**: Written by `npm run build` (see `script/build.ts`). Server reads it once at boot to populate `gitSha` in `/api/health`. `deploy/update.sh` asserts `health.gitSha === $NEW_SHA` after every reload to catch the "deploy ran but HEAD never moved" failure mode. Do not commit; do not delete during runtime.
- **`migrations/`**: Versioned SQL files generated by `drizzle-kit generate` from `shared/schema.ts`, plus `migrations/meta/` (drizzle's journal + per-migration snapshots). Committed to git. Applied at app boot by `server/migrate.ts`. The `migrations/legacy/` subfolder holds pre-drizzle hand-written SQL files for historical reference only — never executed.

## Gotchas

- **Email Template Protection**: Custom email templates are protected from being overwritten during updates.
- **Telegram Integration**: Requires `TELEGRAM_BOT_TOKEN` secret; failures are non-blocking.
- **Discord Integration**: Webhook URL stored in DB (no env var); set via Admin Portal → Discord. Failures are non-blocking and never block customer notifications.
- **AI Integrations**: Requires `AI_INTEGRATIONS_OPENAI_BASE_URL` and `AI_INTEGRATIONS_OPENAI_API_KEY` for AI features to be active.
- **Rate Limits** (`server/rate-limits.ts`): Mounted on abuse-prone routes only. Login: 5 failures / min / (IP+username). Register: 10 / hr / IP. Forgot- and reset-password: 3 / hr / IP (shared budget). Ticket POST: 10 / hr / user. Report POST: 10 / min / user. Community-chat post: 10 / min / user. Community-chat reactions: 60 / min / user. Admin and master_admin sessions bypass every limiter via `bypassRateLimitForAdmins`. Enforced by `express-rate-limit` with an in-process memory store (resets on restart, per-process — fine for single-instance, document/replace if we ever go multi-process). Limit hits respond with JSON `{ error, retryAfterSeconds }` + `Retry-After` header so the frontend can toast it.
- **`service_alerts.resolved_at` may disagree with `status='resolved'` on historical rows.** The dashboard "Active alerts" counter used to filter on `resolved_at IS NULL` but now filters on `status != 'resolved'` (matches the alerts page). One-off reconcile if desired: `UPDATE service_alerts SET resolved_at = COALESCE(resolved_at, created_at) WHERE status = 'resolved' AND resolved_at IS NULL;` — safe to run repeatedly, not required for correct counts.

## Pointers

- React: `https://react.dev/`
- TailwindCSS: `https://tailwindcss.com/docs`
- Drizzle ORM: `https://orm.drizzle.team/docs/overview`
- Vite: `https://vitejs.dev/guide/`
- Wouter: `https://docs.wouter.com/`
- Shadcn UI: `https://ui.shadcn.com/docs`
- Web Push API: `https://developer.mozilla.org/en-US/docs/Web/API/Push_API`
- date-fns-tz: `https://date-fns.org/v2.30.0/docs/timezone`
- DOMPurify: `https://github.com/cure53/DOMPurify`
