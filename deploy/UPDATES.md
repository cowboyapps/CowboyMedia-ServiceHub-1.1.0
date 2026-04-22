# Day-to-day dev → deploy flow

We continue developing on Replit. The VPS is **production**. Pushing changes is one SSH command.

## Golden rules

1. **Schema migrations must be additive only.** Add tables, add nullable columns, add indexes. Never drop or rename. If you must rename, do it in two releases: add new column → backfill + dual-write → drop old column in the next release after verifying.
2. **Never run `npm run db:push --force` on the VPS.** `update.sh` runs `db:push` without `--force` and pipes "No" to any prompt — it will fail loudly if drizzle wants to drop something. That failure is a **feature**: it forces you to handle destructive changes deliberately.
3. **Always cut a tag for non-trivial releases.** `git tag v1.2.3 && git push --tags`. Then `update.sh --ref v1.2.3`. Makes rollbacks unambiguous.
4. **Watch logs after deploy.** `update.sh` does an automated health check and rolls back automatically if it fails, but a green health check doesn't catch every regression. `pm2 logs` for 5 minutes.

## Standard release

On Replit:
```bash
git push origin main
```
On the VPS:
```bash
ssh root@vps
sudo bash /opt/servicehub/deploy/update.sh
```
Done. `update.sh`:
- Snapshots the DB to `/var/backups/servicehub/pre-update-<timestamp>.dump`.
- Pulls and resets to `origin/main`.
- `npm ci && npm run build`.
- Pushes schema (refuses destructive changes).
- `pm2 reload servicehub` (zero downtime — PM2 fork mode reload is graceful).
- Health-checks `/api/health`. If it fails, automatically restores the snapshot and rolls back code.

## Hotfix a specific commit

```bash
sudo bash /opt/servicehub/deploy/update.sh --ref <git-sha>
```

## Manual rollback

```bash
sudo bash /opt/servicehub/deploy/rollback.sh
# Pick from the list of pre-update snapshots, optionally provide the prior git SHA.
```

## Emergency: DB only

```bash
sudo bash /opt/servicehub/deploy/restore.sh
# Lists local + remote (rclone) snapshots, pulls if needed, restores after confirmation.
```

## Adding a new env var

1. Add it to `deploy/.env.template` with a comment explaining what it does and whether it's required.
2. Read it in code via `process.env.X` with a sensible fallback (or fail-fast at startup).
3. After deploying with `update.sh`, edit `/opt/servicehub/.env` on the VPS, then `pm2 reload servicehub --update-env`.

## Adding a new dependency

Just add it to `package.json` like normal and push. `update.sh` runs `npm ci` so the new dep is installed on deploy. If it's a native module (rare), test on a temp VPS first to make sure it compiles for Linux x64 — Replit's Nix env can hide Linux-specific build problems.
