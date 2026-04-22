#!/usr/bin/env bash
# Interactive restore from a daily/monthly backup created by backup.sh.
# Lists local backups; optionally pulls a remote one via rclone first.
#
# Usage:  sudo bash restore.sh

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: must be run as root"; exit 1
fi

APP_USER=servicehub
APP_DIR=/opt/servicehub
ENV_FILE="$APP_DIR/.env"
BACKUP_DIR=/var/backups/servicehub

set -a; . "$ENV_FILE"; set +a

echo "Local snapshots:"
mapfile -t LOCAL < <(ls -1t "$BACKUP_DIR"/*.dump.gpg "$BACKUP_DIR"/pre-update-*.dump 2>/dev/null || true)
for i in "${!LOCAL[@]}"; do printf "  [%d] %s\n" "$i" "${LOCAL[$i]}"; done

if [[ -n "${BACKUP_RCLONE_REMOTE:-}" ]]; then
  echo ""
  read -rp "Pull a remote snapshot first? (y/N): " PULL
  if [[ "$PULL" == "y" ]]; then
    echo "Remote snapshots in $BACKUP_RCLONE_REMOTE:"
    rclone ls "$BACKUP_RCLONE_REMOTE/" | head -50
    read -rp "Filename to download: " RFILE
    rclone copy "$BACKUP_RCLONE_REMOTE/$RFILE" "$BACKUP_DIR/"
    LOCAL=("$BACKUP_DIR/$RFILE" "${LOCAL[@]}")
  fi
fi

read -rp "Pick a snapshot index to restore: " IDX
PICK="${LOCAL[$IDX]}"
[[ -f "$PICK" ]] || { echo "Not found: $PICK"; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
DUMP="$WORK/restore.dump"

if [[ "$PICK" == *.gpg ]]; then
  read -rsp "Encryption passphrase (BACKUP_ENCRYPTION_PASSPHRASE): " PASS; echo
  echo "==> Decrypting..."
  echo "$PASS" | gpg --batch --yes --pinentry-mode loopback --passphrase-fd 0 \
    --decrypt --output "$DUMP" "$PICK"
else
  cp "$PICK" "$DUMP"
fi

echo "==> About to OVERWRITE the database from $PICK."
read -rp "Type 'yes' to proceed: " CONFIRM
[[ "$CONFIRM" == "yes" ]] || { echo "Aborted."; exit 1; }

echo "==> Stopping app..."
sudo -u "$APP_USER" -H bash -lc "pm2 stop servicehub" || true

echo "==> Restoring..."
sudo -u "$APP_USER" -H bash -lc "set -a && . $ENV_FILE && set +a && \
  pg_restore --clean --if-exists --no-owner --no-acl \
    --dbname=\"\$DATABASE_URL\" \"$DUMP\""

echo "==> Starting app..."
sudo -u "$APP_USER" -H bash -lc "pm2 start servicehub"

echo "==> Restore complete."
