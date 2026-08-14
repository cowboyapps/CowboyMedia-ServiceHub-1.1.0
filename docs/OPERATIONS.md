# ServiceHub Operations Runbook

Deploy pipeline, VPS layout, and recovery procedures. Moved out of `replit.md` (which keeps the day-to-day essentials).

## Replit ↔ GitHub sync (manual)

Replit does NOT auto-push. Workflow:
1. Change + verify in Replit.
2. `git add -A && git commit -m "<msg>" && git push origin main`. Canonical remote: `https://github.com/cowboyapps/CowboyMedia-ServiceHub-1.1.0.git`.
   - **"OAuth App lacks workflow scope"** (when touching `.github/workflows/`): push via PAT URL `git push https://cowboyapps:<PAT>@github.com/cowboyapps/CowboyMedia-ServiceHub-1.1.0.git main` (PAT needs `repo`+`workflow`). Run `git config --global credential.helper store` once to remember it.
3. Push fires the GitHub webhook (`https://cowboyhub.app/_deploy`) → VPS listener (`servicehub-deploy.service`, `127.0.0.1:5055`) → `deploy/update.sh` → PM2 reload.
4. Outcome posts to the deploy Discord channel: 🚀 start, ✅ success (+verify line + duration), ❌ failure (+exit code + last-20-line log tail), ⛔ dropped (auto-deploy paused).
5. **Pause prod deploys**: Admin Portal → Deploy → Pause auto-deploy (flag `app_settings.auto_deploy_enabled`). Pushes during a pause are DROPPED, not queued — push again after resuming.

## VPS deploy listener — install layout (greenest-ant)

- **Service**: `systemctl status servicehub-deploy` (unit `/etc/systemd/system/servicehub-deploy.service`, source `deploy/webhook-listener/servicehub-deploy.service`). Live logs: `sudo journalctl -u servicehub-deploy -f`.
- **Per-deploy logs**: `/var/log/servicehub-deploy/<delivery-id>.log` (or `GET /_deploy/log/<id>` with `DEPLOY_GATE_TOKEN` bearer). Latest: `ls -t /var/log/servicehub-deploy/*.log | head -1 | xargs tail -60`.
- **Listener env file**: `/etc/servicehub-deploy.env` (mode 600, root-only). Holds `GITHUB_WEBHOOK_SECRET`, `APP_BASE_URL` (`http://127.0.0.1:5000`), `DEPLOY_DISCORD_WEBHOOK`, `DEPLOY_GATE_TOKEN`, `DEPLOY_REPO_FULL_NAME=cowboyapps/CowboyMedia-ServiceHub-1.1.0`. After editing: `sudo systemctl restart servicehub-deploy`.
- **Sudoers** (`/etc/sudoers.d/servicehub-deploy`): lets `servicehub` run only `bash /opt/servicehub/deploy/update.sh` (optional `--ref <sha>`) as root, no password. Validate with `sudo visudo -c`.
- **Nginx**: `location = /_deploy` + `location ^~ /_deploy/` in `/etc/nginx/sites-enabled/servicehub` proxy to `127.0.0.1:5055`. Health: `curl https://cowboyhub.app/_deploy/health` → `{"ok":true}`. Never leave config backups in `sites-enabled/` (nginx reads every file → "duplicate upstream"); move them to `/root/`.
- **Rotate deploy Discord webhook**: edit `DEPLOY_DISCORD_WEBHOOK` in the listener env file, restart listener. (Separate from the in-app news/alerts Discord webhook, which lives in the DB.)
- **Rotate `GITHUB_WEBHOOK_SECRET`**: `openssl rand -hex 32` → update listener env file → restart → paste same value into GitHub (Settings → Webhooks → Secret). Mismatch = every push 401s.
- **Force redeploy current `main` head**: `sudo FORCE_DEPLOY=1 bash /opt/servicehub/deploy/update.sh` (bypasses health + column-drift gates — only after root-causing why they'd fail).
- **Replay a delivery** instead of force-pushing: GitHub → Settings → Webhooks → Recent Deliveries → Redeliver.

## Recurring deploy gotchas

- **`update.sh` self-modifies mid-run.** `git reset --hard $NEW_SHA` rewrites the script on disk while bash reads it. The body is wrapped in `{ ... } && exit` so bash parses the whole compound command into memory before line 1 runs — **DO NOT unwrap**. Without it, bash keeps reading the old inode, so a fix to update.sh only takes effect the deploy *after* the one that ships it (and can cause stuck rollback loops).
- **Two self-heal chown blocks at the top of `update.sh`** restore `servicehub` ownership before they break the build: (1) `/home/servicehub` (`.npm`, `.bash_profile`, `.bashrc`, `.npmrc`) — fixes EACCES on `.npm/_cacache` + `.bash_profile: Permission denied`; (2) `$APP_DIR/.git` — fixes "insufficient permission for adding an object" during `git fetch`. Both fail loudly; PM2 untouched if they can't recover.
- **All four `npm run build` calls in `update.sh` need the `NODE_ENV=test` prefix** (primary + 3 rollback paths). `.env` sets `NODE_ENV=production`, which makes the chained `npm test` load React's prod bundle and crash on `act() is not supported in production builds`. Copy the override into any new build call site.
- **PM2 splits long log lines and can trip the post-deploy log-tail gate.** The express logger embeds the JSON response body after `:: `; PM2's ~1KB/line buffer splits longer lines, and only the first chunk keeps the `[express]` prefix. Continuation chunks slip past the gate's `grep -v "[express]"` filter, so any route returning historical error-like strings (`column "x" does not exist`, `Migration error`, `relation .* does not exist`, `ECONNREFUSED`) can roll back a healthy deploy. Defense: (1) `server/index.ts` caps the embedded body to 200 chars; (2) the gate also strips lines starting with a JSON glyph (`"`, `,`, `:`, `{`, `}`). Do NOT add `[`/`]` to that set (`[migrate]`/`[seed]` are real crash signal). Don't relax either half.
- **Listener posts silently to bad Discord URLs** — `fetch()` only throws on network errors, not HTTP 401/404. If posts stop, test: `curl -X POST -H "Content-Type: application/json" -d '{"content":"test"}' "<URL>"` (expect 204).
- **Site-down watchdog lives in the listener** — `servicehub-deploy.service` pings `http://127.0.0.1:5000/api/health` every 60s; 3 consecutive failures (~3 min) post one `:rotating_light:` "Site is DOWN" alert to the deploy Discord webhook, recovery posts one "back up" message with the downtime duration (no repeats during an outage). Treats HTTP errors, timeouts, and `ok:false` (DB down) as down. Tunables in `/etc/servicehub-deploy.env`: `WATCHDOG_HEALTH_URL`, `WATCHDOG_INTERVAL_MS`, `WATCHDOG_FAIL_THRESHOLD`; restart the listener after edits. Requires `DEPLOY_DISCORD_WEBHOOK` — if unset the watchdog logs but can't alert. Silence during planned maintenance: `sudo systemctl stop servicehub-deploy` (remember to start it after). Watchdog check lines appear in `journalctl -u servicehub-deploy` only when checks fail.
- **Listener is silent on the happy path** — `journalctl` shows only sudo audit + startup; use the per-deploy log files.
- **Retracted "permission drift" theories (May 2026).** Several outages were misdiagnosed as filesystem perm drift / external cron. Real cause: the listener unit had `ProtectHome=true`, which mounts `/home`, `/root`, `/run/user` as empty tmpfs for the listener AND every sudo'd child (mount namespaces are inherited). Fix: `ProtectHome=false`. The update.sh home-dir self-heal is kept anyway as defense-in-depth.

## Manual deploy (when auto-deploy can't fire)

The listener fails closed when the app is down (can't read the auto-deploy flag from a dead app). Recover by hand on the VPS:

```bash
cd /opt/servicehub
sudo -u servicehub git pull origin main
# On EACCES (.npm) or "Permission denied" (.bash_profile):
#   sudo chown -R servicehub:servicehub /home/servicehub   # update.sh does this automatically; manual recovery doesn't
sudo -u servicehub bash -lc 'cd /opt/servicehub && \
  npm ci --include=dev && \
  set -a; source .env; set +a; \
  NODE_ENV=test npm run build && \
  pm2 reload servicehub --update-env && \
  pm2 save'
sleep 12 && curl -s http://localhost:5000/api/health | jq '{ok,gitSha,version}'
```

**Why the env tricks**: `--include=dev` because `.env` sets `NODE_ENV=production` (would skip drizzle-kit/vite). `NODE_ENV=test` on the build because prebuild's `npm test` loads React and the prod bundle strips `act()` → crash. Both are build-time only; the production runtime constant is baked into `dist/` by esbuild's define regardless.

**Never `pm2 restart --update-env` without first sourcing `/opt/servicehub/.env`** — it overwrites pm2's saved env with the current shell's, blanking `DATABASE_URL` and crash-looping with `SASL: client password must be a string`. Relaunch from scratch:

```bash
sudo -u servicehub pm2 delete servicehub
sudo -u servicehub bash -c 'set -a; source /opt/servicehub/.env; set +a; cd /opt/servicehub && pm2 start dist/index.cjs --name servicehub'
sudo -u servicehub pm2 save
```

**Audit schema drift** (same tool as the `db:check:columns` gate — reports missing/stray tables vs the `KNOWN_UNMANAGED_TABLES` allowlist, per-table column diffs, and out-of-band triggers/functions/indexes; exit 1 on drift):

```bash
sudo -u servicehub bash -c 'cd /opt/servicehub && set -a; source .env; set +a; ./node_modules/.bin/tsx script/audit-columns.ts'
```

**Recover deleted KB/news images from a backup** (`script/recover-kb-images.ts`): a pre-fix orphan sweep deleted `uploaded_files` blobs still embedded in KB articles / news. Articles keep their `/uploads/<uuid>` paths, so the missing blobs can be re-inserted from a pre-deletion backup — scoped to ONLY those rows, never a full restore. It finds `/uploads/<uuid>` paths in live `kb_articles.body_html` / `news_stories.content`, keeps only those missing from live `uploaded_files`, pulls exactly those from `BACKUP_DATABASE_URL`, inserts with `ON CONFLICT (filename) DO NOTHING` (idempotent, no overwrites). Reports any path absent from the backup too (use an earlier one).

```bash
createdb servicehub_backup
pg_restore -d servicehub_backup pre-deletion.dump     # or: psql -d servicehub_backup -f backup.sql
# Dry-run (writes nothing); add --apply once the report looks right:
sudo -u servicehub bash -c "set -a; source /opt/servicehub/.env; set +a; \
  BACKUP_DATABASE_URL='postgres://.../servicehub_backup' npx tsx script/recover-kb-images.ts"
```

## Secrets / tokens (prod)

- `DEPLOY_GATE_TOKEN` (prod only). Bearer token the VPS deploy listener uses to read `app_settings.auto_deploy_enabled` over HTTP before running `update.sh`. Must match `/etc/servicehub-deploy.env`. Unset → listener fails closed (refuses to deploy).
- `CHANGELOG_APPEND_TOKEN` (long random; **set on prod AND mirrored to Replit Secrets**). Bearer token for the agent's changelog appends to production (`POST /api/agent/changelog/append`; legacy `:version` twin still accepted). Without it, appends land in the dev DB and never reach customers. On the VPS it lives in `/opt/servicehub/.env` (the app env file, read via PM2 process env — NOT `/etc/servicehub-deploy.env`, which is the separate listener file). Route fails closed (HTTP 503) when unset. Rotate: `openssl rand -hex 32` → update Replit Secrets + `/opt/servicehub/.env` → `sudo -u servicehub pm2 reload servicehub --update-env` (source the env file first — see Manual deploy).

## Build artifacts

- **`dist/.git-sha`**: written by `npm run build` (`script/build.ts`); server reads it once at boot for `gitSha` in `/api/health`. `update.sh` asserts `health.gitSha === $NEW_SHA` after each reload to catch "deploy ran but HEAD never moved". Don't commit; don't delete at runtime.
- **`migrations/`**: drizzle-kit SQL + `migrations/meta/` (journal + snapshots), committed, applied at boot by `server/migrate.ts`. `migrations/legacy/` holds pre-drizzle hand-written SQL for reference only — never executed.
