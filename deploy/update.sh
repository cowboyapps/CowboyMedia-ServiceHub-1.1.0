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

echo "==> Schema push (additive only — stdin closed; any prompt = abort)..."
# drizzle-kit push prompts on destructive changes. We close stdin so any
# prompt causes immediate non-zero exit, forcing the operator to handle the
# destructive change as a deliberate release rather than letting it slip in.
if ! sudo -u "$APP_USER" -H bash -lc "cd $APP_DIR && set -a && . $ENV_FILE && set +a && npm run db:push </dev/null"; then
  echo "ERROR: schema push failed (likely a destructive change or new prompt). Rolling back code to $PREV_SHA."
  sudo -u "$APP_USER" git -C "$APP_DIR" reset --hard "$PREV_SHA"
  sudo -u "$APP_USER" -H bash -lc "cd $APP_DIR && npm ci && npm run build" || true
  echo "       Snapshot kept on disk: $SNAPSHOT"
  echo "       Running app on $PREV_SHA was not reloaded; it is still serving the previous build."
  exit 1
fi

echo "==> Reloading PM2 (zero downtime)..."
sudo -u "$APP_USER" -H bash -lc "pm2 reload servicehub --update-env"

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
  sudo -u "$APP_USER" -H bash -lc "pm2 reload servicehub --update-env"
  echo "Rolled back to $PREV_SHA."
  exit 1
fi

echo "==> Update complete: $PREV_SHA  ->  $NEW_SHA"
echo "    Snapshot kept at $SNAPSHOT (rollback: deploy/rollback.sh)"
