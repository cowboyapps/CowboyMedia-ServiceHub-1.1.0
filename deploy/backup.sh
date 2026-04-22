#!/usr/bin/env bash
# Nightly DB backup. Invoked by systemd timer (servicehub-backup.timer).
# - pg_dump custom format
# - encrypts with BACKUP_ENCRYPTION_PASSPHRASE (gpg symmetric)
# - uploads to BACKUP_RCLONE_REMOTE if set
# - retains 30 daily + 12 monthly locally
# - logs to syslog under tag "servicehub-backup"

set -euo pipefail

LOG_TAG=servicehub-backup
log() { logger -t "$LOG_TAG" -- "$*"; echo "[$LOG_TAG] $*"; }

: "${DATABASE_URL:?DATABASE_URL not set}"
: "${BACKUP_ENCRYPTION_PASSPHRASE:?BACKUP_ENCRYPTION_PASSPHRASE not set}"

BACKUP_DIR=/var/backups/servicehub
mkdir -p "$BACKUP_DIR"
TS="$(date -u +%Y%m%d-%H%M%S)"
DAY="$(date -u +%Y%m%d)"
DUMP="$BACKUP_DIR/daily-$DAY.dump"
ENC="$DUMP.gpg"

log "starting backup -> $DUMP"
pg_dump --format=custom --no-owner --no-acl --dbname="$DATABASE_URL" --file="$DUMP"

log "encrypting -> $ENC"
gpg --batch --yes --pinentry-mode loopback \
  --passphrase "$BACKUP_ENCRYPTION_PASSPHRASE" \
  --symmetric --cipher-algo AES256 \
  --output "$ENC" "$DUMP"
rm -f "$DUMP"

# Monthly snapshot (keep one per month)
MONTH="$(date -u +%Y%m)"
MONTHLY="$BACKUP_DIR/monthly-$MONTH.dump.gpg"
if [[ ! -f "$MONTHLY" ]]; then
  cp "$ENC" "$MONTHLY"
  log "monthly snapshot saved: $MONTHLY"
fi

# Retention: 30 daily, 12 monthly
find "$BACKUP_DIR" -maxdepth 1 -name 'daily-*.dump.gpg' -mtime +30 -delete -print | \
  while read -r f; do log "purged old daily $f"; done
ls -1t "$BACKUP_DIR"/monthly-*.dump.gpg 2>/dev/null | tail -n +13 | while read -r f; do
  rm -f "$f"; log "purged old monthly $f"
done

# Off-site upload
if [[ -n "${BACKUP_RCLONE_REMOTE:-}" ]]; then
  log "uploading to $BACKUP_RCLONE_REMOTE"
  if rclone copy "$ENC" "$BACKUP_RCLONE_REMOTE/" 2>&1 | logger -t "$LOG_TAG"; then
    log "off-site upload OK"
  else
    log "ERROR off-site upload failed"
    # Email if mail is configured (don't fail the backup just because of this)
    if command -v mail >/dev/null 2>&1 && [[ -n "${VAPID_CONTACT_EMAIL:-}" ]]; then
      echo "ServiceHub off-site backup upload failed at $TS" | \
        mail -s "[servicehub] backup upload failure" "$VAPID_CONTACT_EMAIL" || true
    fi
  fi
else
  log "BACKUP_RCLONE_REMOTE not set, skipping off-site upload"
fi

log "backup complete"
