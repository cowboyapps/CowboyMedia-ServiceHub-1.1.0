#!/usr/bin/env bash
# Roll back code + data to a previous state.
# Interactive: lists pre-update snapshots and lets you pick one.
#
# Usage:
#   sudo bash rollback.sh                       # interactive
#   sudo bash rollback.sh <snapshot> <git-sha>  # non-interactive

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: must be run as root"
  exit 1
fi

APP_USER=servicehub
APP_DIR=/opt/servicehub
ENV_FILE="$APP_DIR/.env"
BACKUP_DIR=/var/backups/servicehub

SNAPSHOT="${1:-}"
GIT_SHA="${2:-}"

if [[ -z "$SNAPSHOT" ]]; then
  echo "Available snapshots in $BACKUP_DIR:"
  mapfile -t SNAPS < <(ls -1t "$BACKUP_DIR"/pre-update-*.dump 2>/dev/null || true)
  if [[ ${#SNAPS[@]} -eq 0 ]]; then
    echo "  (none)"
    exit 1
  fi
  for i in "${!SNAPS[@]}"; do
    printf "  [%d] %s\n" "$i" "${SNAPS[$i]}"
  done
  read -rp "Pick a snapshot index: " IDX
  SNAPSHOT="${SNAPS[$IDX]}"
fi

if [[ ! -f "$SNAPSHOT" ]]; then
  echo "ERROR: snapshot not found: $SNAPSHOT"
  exit 1
fi

if [[ -z "$GIT_SHA" ]]; then
  read -rp "Git ref to roll back to (leave blank to keep current code): " GIT_SHA
fi

echo "==> About to:"
echo "    Restore DB from: $SNAPSHOT"
[[ -n "$GIT_SHA" ]] && echo "    Reset code to:   $GIT_SHA"
read -rp "Proceed? (yes/NO): " CONFIRM
[[ "$CONFIRM" == "yes" ]] || { echo "Aborted."; exit 1; }

if [[ -n "$GIT_SHA" ]]; then
  sudo -u "$APP_USER" git -C "$APP_DIR" fetch --all --tags
  sudo -u "$APP_USER" git -C "$APP_DIR" reset --hard "$GIT_SHA"
  sudo -u "$APP_USER" -H bash -lc "cd $APP_DIR && npm ci && npm run build"
fi

echo "==> Restoring DB..."
sudo -u "$APP_USER" -H bash -lc "set -a && . $ENV_FILE && set +a && \
  pg_restore --clean --if-exists --no-owner --no-acl \
    --dbname=\"\$DATABASE_URL\" \"$SNAPSHOT\""

echo "==> Reloading PM2..."
sudo -u "$APP_USER" -H bash -lc "pm2 reload servicehub --update-env"

echo "==> Rollback complete."
