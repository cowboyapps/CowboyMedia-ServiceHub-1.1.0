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
2. From the Replit shell: `git add -A && git commit -m "<msg>" && git push origin main`. The canonical remote is `https://github.com/cowboyapps/CowboyMedia-ServiceHub-1.1.0.git`.
   - **If the push errors with "OAuth App lacks workflow scope"** (happens when the change touches `.github/workflows/`), use a PAT URL instead:
     `git push https://cowboyapps:<PAT>@github.com/cowboyapps/CowboyMedia-ServiceHub-1.1.0.git main`.
     The PAT must have `repo` + `workflow` scopes. Run `git config --global credential.helper store` once so the credential is remembered.
3. The push fires the GitHub webhook (configured at https://github.com/cowboyapps/CowboyMedia-ServiceHub-1.1.0/settings/hooks → `https://cowboyhub.app/_deploy`) → VPS listener (`servicehub-deploy.service`, `127.0.0.1:5055`) → `deploy/update.sh` → PM2 reload.
4. Outcome posts to the deploy Discord channel: `:rocket:` on start, `:white_check_mark:` on success (with verification line + duration), `:x:` on failure (with exit code + last-20-lines log tail), `:no_entry:` if dropped because auto-deploy is paused.
5. To pause production deploys (e.g. during a maintenance window), use **Admin Portal → Deploy → Pause auto-deploy**. The flag lives in `app_settings.auto_deploy_enabled`; the listener checks it via `GET /api/admin/app-settings` (gated by `DEPLOY_GATE_TOKEN` bearer) before running `update.sh`. Pushes during a pause are DROPPED, not queued — push again after resuming and the latest commit will deploy.

### VPS deploy listener — install layout (greenest-ant)

End-to-end verified: a real push from Replit to `main` posts `:rocket:` (start) and `:white_check_mark:` (success with verification line + duration) into the configured Discord channel. Two install-time gotchas found and fixed during the smoke test — see "Recurring deploy gotchas" below.

- **Service**: `systemctl status servicehub-deploy` (systemd unit at `/etc/systemd/system/servicehub-deploy.service`, source-of-truth copy in `deploy/webhook-listener/servicehub-deploy.service`).
- **Live logs**: `sudo journalctl -u servicehub-deploy -f`
- **Per-deploy logs**: `/var/log/servicehub-deploy/<github-delivery-id>.log` (also tail-able via `GET /_deploy/log/<id>` with the `DEPLOY_GATE_TOKEN` bearer). Open the latest with `ls -t /var/log/servicehub-deploy/*.log | head -1 | xargs tail -60`.
- **Listener env file**: `/etc/servicehub-deploy.env` (mode 600, root-only). Contains `GITHUB_WEBHOOK_SECRET`, `APP_BASE_URL` (`http://127.0.0.1:5000`), `DEPLOY_DISCORD_WEBHOOK`, `DEPLOY_GATE_TOKEN`, `DEPLOY_REPO_FULL_NAME=cowboyapps/CowboyMedia-ServiceHub-1.1.0`. After editing, `sudo systemctl restart servicehub-deploy`.
- **Sudoers entry**: `/etc/sudoers.d/servicehub-deploy` allows the `servicehub` user to run only `bash /opt/servicehub/deploy/update.sh` (with optional `--ref <sha>`) as root with no password. Validate edits with `sudo visudo -c`.
- **Nginx**: `location = /_deploy` and `location ^~ /_deploy/` blocks in `/etc/nginx/sites-enabled/servicehub` proxy to `127.0.0.1:5055`. Health probe: `curl https://cowboyhub.app/_deploy/health` → `{"ok":true}`. **Gotcha**: nginx reads every file in `sites-enabled/` — never leave config backups (`servicehub.bak-*`) in that dir or it'll fail with "duplicate upstream". Move them to `/root/`.
- **Rotating the Discord webhook URL**: edit `/etc/servicehub-deploy.env` → change `DEPLOY_DISCORD_WEBHOOK=...` → `sudo systemctl restart servicehub-deploy`. The app itself doesn't store this URL (different from the in-app news/alerts Discord webhook, which is in the DB).
- **Rotating `GITHUB_WEBHOOK_SECRET`**: generate a new value with `openssl rand -hex 32`, replace it in `/etc/servicehub-deploy.env`, `sudo systemctl restart servicehub-deploy`, **then** paste the same value into the GitHub webhook config (Settings → Webhooks → edit the webhook → Secret → Update). Both sides must match or HMAC validation fails and every push is rejected with HTTP 401.
- **Force a redeploy of the current `main` head** (e.g. after a config change, or to retry a stuck deploy): `sudo FORCE_DEPLOY=1 bash /opt/servicehub/deploy/update.sh`. `FORCE_DEPLOY=1` bypasses the post-update health gates and the column-drift check — only use it when you've already root-caused why those gates would fail.
- **Replay a webhook delivery** instead of force-pushing: GitHub repo → Settings → Webhooks → click the webhook → Recent Deliveries → pick one → Redeliver.

### Recurring deploy gotchas (seen during install + worth knowing)

- **`/home/servicehub` "permission drift" was actually systemd `ProtectHome=true` (Task #217, May 2026 — definitive root cause).** Every "perm drift" outage from Tasks #211 → #217 had the same real cause and it had nothing to do with permissions. The webhook listener's systemd unit (`deploy/webhook-listener/servicehub-deploy.service`) had `ProtectHome=true`, which mounts `/home`, `/root`, and `/run/user` as empty inaccessible tmpfs for the listener and **every child process it spawns** — including the `sudo bash /opt/servicehub/deploy/update.sh` it launches. systemd's mount-namespace isolation is inherited by sudo'd subprocesses; sudo does NOT escape it. So inside `update.sh`, `/home/servicehub` appeared as an empty read-only tmpfs: `[[ -d /home/servicehub ]]` returned false, `mkdir -p` failed with EROFS, `sudo -u servicehub -H bash -lc` couldn't see its own `.bash_profile` ("Permission denied"), and `npm ci` couldn't write its cache (EACCES). The actual on-disk filesystem was healthy and writable the entire time — proven by `sudo -u servicehub touch /home/servicehub/test-write` succeeding silently from a normal shell while the same operation failed inside the listener-spawned namespace. **Fix**: `ProtectHome=false` in the listener unit (do NOT re-enable unless you rework update.sh to run in a separate systemd unit outside this namespace — see the comment block in the .service file). **The `update.sh` self-heal block and the gitSha-aware "Already at SHA" cross-check are still kept** — they're sound defensive code and will catch a real EROFS / a real PM2-lag situation if one ever occurs. They were just firing against a phantom filesystem before. **Retracted theories**: Task #215's "manual root-shell recoveries" conclusion was wrong (the diagnostic ran outside the namespace so it saw a clean filesystem); Task #214's "external cron" theory was wrong (no automated source ever existed). Operators can resume running `npm`/`pm2` as `servicehub` from a normal shell freely — the warning below is still good hygiene but it was never the cause of the outages.
- **(Retracted) `/home/servicehub` permissions drift to root.** Any time someone runs `npm`, `pm2`, or anything else that writes under the app user's home as bare `root` (e.g. an emergency manual recovery), files under `/home/servicehub/.npm`, `~/.bash_profile`, `~/.npmrc`, etc. end up root-owned and the next `servicehub`-user `npm ci` dies with `EACCES`. `update.sh` now self-heals the **entire** `/home/servicehub` tree (not just `~/.npm`) at the very start of every deploy — before `pg_dump`, before `git fetch`, before `npm ci` — and aborts loudly if a recursive `chown` doesn't stick (immutable attr, broken mount, SELinux). Manual fix when it ever needs one: `sudo chown -R servicehub:servicehub /home/servicehub`. Avoid by **always** running `npm`/`pm2` via `sudo -u servicehub` or `sudo -u servicehub -H bash -lc '...'`, never as bare root. The `:x:` Discord failure embed now also appends a one-line remediation hint when this pattern is detected in the log tail (`EACCES` on `.npm` or `.bash_profile: Permission denied`), so on-call doesn't have to grep the runbook at 3am.
  - **Self-heal robustness fix (May 2026, after a real outage with HTTP-stuck PM2)**: the original self-heal used `if [[ -d "$HOME_DIR" ]]; then ... else WARN "skipping"; fi`, which silently no-op'd in an outage where `[[ -d ]]` returned false even though the directory clearly existed (the very next `bash -lc` successfully sourced `.bash_profile` from inside it — most likely culprit: the home is a symlink to a momentarily-unreachable mount, or SELinux/AppArmor scoping). Fix: replaced the `-d` skip path with `mkdir -p` + always-run-the-chown + an `ls -ld` stat assertion that aborts loudly with the kernel's actual error if the path still isn't a directory. Plus a belt-and-braces explicit chown of `.bash_profile`/`.bashrc`/`.npmrc`/`.profile` even when `find` reports zero offenders, in case `find` walked past a hidden mount boundary. Same incident also exposed an **"Already at SHA. Nothing to do." trap**: the short-circuit at the top of update.sh assumed working-tree HEAD equals running PM2, but a previous deploy can advance HEAD via `git reset --hard` and then crash before `pm2 reload`, leaving prod stuck on the old build forever. Fix: the short-circuit now cross-checks `/api/health.gitSha` from the running app — if PM2's gitSha doesn't match working-tree HEAD, the deploy falls through and runs the full pipeline to bring PM2 in sync.
  - **Root cause confirmed (Task #215, May 2026)**: the recurring source is **manual root-shell recoveries**, not anything automated. The VPS diagnostic (`deploy/diagnose-home-perms.sh`, run May 15 2026) ruled out every other suspect: zero current offenders under `/home/servicehub`, zero crons or systemd timers that touch the home dir or run `npm`/`pm2`, and the only sudoers entry for the `servicehub` user is the narrowly-scoped `/opt/servicehub/deploy/update.sh` rule (`/etc/sudoers.d/servicehub-deploy`). What `/root/.bash_history` shows instead is **lots** of root-shell recovery activity — multi-hour root sessions packed with manual `npm ci` / `npm run build` / `pm2 ...` commands during outages. Almost all correctly prefix `sudo -u servicehub`, but one missed prefix (or a `chown -R 998:998 /home/servicehub/.npm` style hand-fix that misses `.bash_profile` / `.bashrc` / `.npmrc`) is enough to plant a root-owned file that breaks the next deploy. **Prevention rule (operators, please read)**: in a root shell on the VPS, **NEVER** run `npm`, `pm2`, `node`, or anything that touches `/home/servicehub` directly. Always go through `sudo -u servicehub -H bash -lc '...'` (the `-H` is critical — it sets `HOME=/home/servicehub` so dotfiles get the right owner). When you have to run a `chown` to recover, always chown the entire home tree (`sudo chown -R servicehub:servicehub /home/servicehub`), never just `~/.npm` — that's how `.bash_profile` keeps coming back root-owned. The self-heal block at the top of `deploy/update.sh` is the durable safety net; the diagnostic script (`deploy/diagnose-home-perms.sh`) stays in-tree for the next time something exotic appears.
- **The listener silently posts to bad Discord URLs.** `fetch()` only throws on network errors — not on HTTP 401/404 from Discord — so a malformed or revoked webhook URL produces zero log output. If you stop seeing Discord posts, sanity-check the URL with `curl -X POST -H "Content-Type: application/json" -d '{"content":"test"}' "<URL>"` (expect HTTP 204).
- **Listener has no log line on the happy path.** `journalctl -u servicehub-deploy` only shows sudo audit lines and the listener's own startup message — successful incoming pushes are silent. Use the per-deploy log file under `/var/log/servicehub-deploy/` for actual deploy output.

## Manual deploy (when auto-deploy can't fire)

The webhook listener fails closed when the app is down (it can't read `app_settings.auto_deploy_enabled` from a dead app). When that happens, recover by hand on the VPS:

```bash
cd /opt/servicehub
sudo -u servicehub git pull origin main
# If `npm ci` dies with EACCES on /home/servicehub/.npm/_cacache (or you
# see `bash: /home/servicehub/.bash_profile: Permission denied`), the
# home dir has root-owned files from an earlier root-run npm/pm2.
# One-line fix (covers .npm, dotfiles, everything):
#   sudo chown -R servicehub:servicehub /home/servicehub
# (deploy/update.sh now does this automatically as the very first step
#  of every webhook-triggered deploy, but manual recoveries don't.)
#
# IMPORTANT: do NOT source .env before `npm ci`/`npm run build`. .env
# contains NODE_ENV=production, which makes (a) `npm ci` skip
# devDependencies (drizzle-kit, vite, etc → "drizzle-kit: not found"
# during prebuild's db:check), and (b) `npm test` load React's
# production bundle (which strips `act()` → tests crash with "act(...)
# is not supported in production builds of React"). The all-in-one
# formula below scopes both fixes correctly:
sudo -u servicehub bash -lc 'cd /opt/servicehub && \
  npm ci --include=dev && \
  set -a; source .env; set +a; \
  NODE_ENV=test npm run build && \
  pm2 reload servicehub --update-env && \
  pm2 save'
sleep 12 && curl -s http://localhost:5000/api/health | jq '{ok,gitSha,version}'
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
When the user says "change the version to...", update the `APP_VERSION` constant in `shared/version.ts` (single source of truth — settings, sidebar, and bottom nav all read from it) without further explanation. The "Welcome to version X" popup is decoupled: when the new version boots, the server auto-creates an empty draft changelog entry; the popup only fires once the user clicks **Publish** on it in Admin Portal → Changelog.

**Auto-append the changelog as we work.** Whenever a change ships that a customer can see or interact with, append a single bullet to the **current** `APP_VERSION`'s draft entry by calling `POST /api/admin/changelog/:version/append` with `{ heading, bullet }`. Use the existing helper (`appendBulletToBody` in `shared/changelog-append.ts`) for any non-route call sites. Rules:
- **What earns a bullet**: new user-visible features, fixes, UI/UX changes, and anything that meaningfully affects a function the customer interacts with (e.g. faster, clearer, more reliable, new option, new screen, new alert channel).
- **What does NOT earn a bullet**: pure refactors, dev tooling, internal plumbing, test-only changes, comments, type-only changes, build/CI tweaks, schema changes that aren't user-visible.
- **Heading buckets**: exactly three — `New` (brand new capability), `Improved` (existing thing got better/faster/clearer), `Fixed` (bug fix). Pick one per bullet.
- **Tone**: customer-friendly plain English, like "Faster ticket replies on slow networks." Not engineer-speak ("Refactored useTickets hook to memoize selector"). One short sentence per bullet.
- **Scope = current version only**. The moment `APP_VERSION` is bumped, switch to writing into the new version's draft and never touch any older entry (draft or published) again. The user is the only one who edits older entries.
- The user proofreads + tweaks + clicks **Publish** when they're ready. Do not publish on the user's behalf.

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