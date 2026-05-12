#!/usr/bin/env bash
# Pull, build, push schema, reload PM2. Zero downtime via `pm2 reload`.
#
# Usage:
#   sudo bash update.sh                # deploy origin/main
#   sudo bash update.sh --ref <sha>    # deploy specific commit (hotfix)
#
# Behaviour:
#   - Takes a pre-update DB snapshot to /var/backups/servicehub/pre-update-<ts>.dump
#   - Fails loudly (no destructive prompts answered "y") if drizzle wants to drop columns
#   - On post-update health check failure: rolls back code + restores snapshot

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: must be run as root (try: sudo bash $0)"
  exit 1
fi

REF=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) REF="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

APP_USER=servicehub
APP_DIR=/opt/servicehub
ENV_FILE="$APP_DIR/.env"
BACKUP_DIR=/var/backups/servicehub
TS="$(date -u +%Y%m%d-%H%M%S)"
SNAPSHOT="$BACKUP_DIR/pre-update-$TS.dump"
PREV_SHA="$(sudo -u "$APP_USER" git -C "$APP_DIR" rev-parse HEAD)"

echo "==> Pre-update DB snapshot -> $SNAPSHOT"
mkdir -p "$BACKUP_DIR"
sudo -u "$APP_USER" -H bash -lc "set -a && . $ENV_FILE && set +a && \
  pg_dump --format=custom --no-owner --no-acl --clean --if-exists \
    --dbname=\"\$DATABASE_URL\" --file=\"$SNAPSHOT\""

echo "==> Fetching latest..."
sudo -u "$APP_USER" git -C "$APP_DIR" fetch --all --tags --prune

TARGET="${REF:-origin/main}"
echo "==> Checking out $TARGET (was $PREV_SHA)..."
sudo -u "$APP_USER" git -C "$APP_DIR" reset --hard "$TARGET"
NEW_SHA="$(sudo -u "$APP_USER" git -C "$APP_DIR" rev-parse HEAD)"

if [[ "$PREV_SHA" == "$NEW_SHA" ]]; then
  echo "==> Already at $NEW_SHA. Nothing to do."
  exit 0
fi

echo "==> npm ci && npm run build..."
sudo -u "$APP_USER" -H bash -lc "cd $APP_DIR && npm ci && npm run build"

echo "==> Schema push (additive only — destructive prompt = abort)..."
# drizzle-kit push prompts on destructive changes. We close stdin so any
# prompt causes the interactive selector to immediately yield no answer.
# Historically that exited 0 with no schema applied — a silent skip — which
# caused at least one prod outage (missing TOTP column broke login). We now
# capture the push output and require a positive sentinel ("Changes applied"
# or "No changes detected") before treating it as success. Anything else,
# including the "stdin closed" / no-answer case, aborts the deploy.
PUSH_LOG="$(mktemp)"
trap 'rm -f "$PUSH_LOG"' EXIT
PUSH_RC=0
sudo -u "$APP_USER" -H bash -lc "cd $APP_DIR && set -a && . $ENV_FILE && set +a && npm run db:push </dev/null" 2>&1 | tee "$PUSH_LOG" || PUSH_RC=$?

push_failed=0
push_failure_reason=""
if [[ "$PUSH_RC" -ne 0 ]]; then
  push_failed=1
  push_failure_reason="db:push exited non-zero ($PUSH_RC) — likely a destructive change requiring an interactive answer, or a config/connection error. See output above."
elif ! grep -qE "(Changes applied|No changes detected)" "$PUSH_LOG"; then
  push_failed=1
  push_failure_reason="db:push exited 0 but produced no 'Changes applied' or 'No changes detected' marker. Treating as a SILENT SKIP — the schema was NOT pushed. This is the failure mode that caused the previous outage."
fi

if [[ "$push_failed" -eq 1 ]]; then
  echo "ERROR: schema push did not complete cleanly."
  echo "       $push_failure_reason"
  echo "       Rolling back code to $PREV_SHA. PM2 was NOT reloaded; the previous build is still serving."
  echo "       Snapshot kept on disk: $SNAPSHOT"
  sudo -u "$APP_USER" git -C "$APP_DIR" reset --hard "$PREV_SHA"
  sudo -u "$APP_USER" -H bash -lc "cd $APP_DIR && npm ci && npm run build" || true
  exit 1
fi

echo "==> Verifying schema is in sync (re-running push; expect 'No changes detected')..."
# Second push pass: if the first one truly applied the schema, this one must
# report "No changes detected". If it instead reports "Changes applied" or
# emits a prompt (no marker), the first pass either lied about success or the
# code+DB are still out of sync. Either way: abort before reloading PM2.
VERIFY_LOG="$(mktemp)"
trap 'rm -f "$PUSH_LOG" "$VERIFY_LOG"' EXIT
VERIFY_RC=0
sudo -u "$APP_USER" -H bash -lc "cd $APP_DIR && set -a && . $ENV_FILE && set +a && npm run db:push </dev/null" 2>&1 | tee "$VERIFY_LOG" || VERIFY_RC=$?

verify_failed=0
verify_reason=""
if [[ "$VERIFY_RC" -ne 0 ]]; then
  verify_failed=1
  verify_reason="verification db:push exited non-zero ($VERIFY_RC). Schema is not in the expected state."
elif grep -q "Changes applied" "$VERIFY_LOG"; then
  verify_failed=1
  verify_reason="verification pass APPLIED additional changes — the first push was incomplete. Schema drift detected."
elif ! grep -q "No changes detected" "$VERIFY_LOG"; then
  verify_failed=1
  verify_reason="verification pass produced no 'No changes detected' marker — db:push likely hit a prompt with closed stdin and silently skipped."
fi

if [[ "$verify_failed" -eq 1 ]]; then
  echo "ERROR: post-push verification failed."
  echo "       $verify_reason"
  echo "       Rolling back code to $PREV_SHA. PM2 was NOT reloaded; the previous build is still serving."
  echo "       Snapshot kept on disk: $SNAPSHOT"
  sudo -u "$APP_USER" git -C "$APP_DIR" reset --hard "$PREV_SHA"
  sudo -u "$APP_USER" -H bash -lc "cd $APP_DIR && npm ci && npm run build" || true
  exit 1
fi
echo "    schema verified in sync."

echo "==> Reloading PM2 (zero downtime)..."
# Source $ENV_FILE so --update-env actually has fresh vars to propagate
# (--update-env reads from the calling shell's environment, not from disk).
# Re-save afterwards so PM2's resurrect dump matches running state.
sudo -u "$APP_USER" -H bash -lc "set -a && . $ENV_FILE && set +a && \
  pm2 reload servicehub --update-env && pm2 save"

echo "==> Post-update health check..."
sleep 5
HEALTH_OK=0
for i in 1 2 3 4 5; do
  if curl -fsS "http://127.0.0.1:5000/api/health" | grep -q '"ok":true'; then
    HEALTH_OK=1
    break
  fi
  echo "   attempt $i: not ok yet, retrying..."
  sleep 3
done

if [[ "$HEALTH_OK" -ne 1 ]]; then
  echo "ERROR: post-update health check failed. Rolling back code AND data."
  sudo -u "$APP_USER" git -C "$APP_DIR" reset --hard "$PREV_SHA"
  sudo -u "$APP_USER" -H bash -lc "cd $APP_DIR && npm ci && npm run build"
  sudo -u "$APP_USER" -H bash -lc "set -a && . $ENV_FILE && set +a && \
    pg_restore --clean --if-exists --no-owner --no-acl \
      --dbname=\"\$DATABASE_URL\" \"$SNAPSHOT\""
  sudo -u "$APP_USER" -H bash -lc "set -a && . $ENV_FILE && set +a && \
    pm2 reload servicehub --update-env && pm2 save"
  echo "Rolled back to $PREV_SHA."
  exit 1
fi

echo "==> Update complete: $PREV_SHA  ->  $NEW_SHA"
echo "    Snapshot kept at $SNAPSHOT (rollback: deploy/rollback.sh)"
