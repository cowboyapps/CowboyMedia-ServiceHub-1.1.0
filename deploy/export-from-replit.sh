#!/usr/bin/env bash
# Run this in the Replit shell (where DATABASE_URL points at the live DB).
# Produces servicehub-migration-<timestamp>.tar.gz in the current directory,
# containing:
#   db.dump              - pg_dump custom format, no owner/ACL
#   secrets.env.template - operator fills in real secret values, renames to secrets.env
#   MANIFEST.txt         - git SHA, timestamp, row counts of key tables
#   README.txt           - what to do with the bundle

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL not set"
  exit 1
fi
if ! command -v pg_dump >/dev/null 2>&1; then
  echo "ERROR: pg_dump not on PATH. On Replit run:  nix-shell -p postgresql_16"
  exit 1
fi

TS="$(date -u +%Y%m%d-%H%M%S)"
WORK="$(mktemp -d)"
OUT_DIR="$WORK/servicehub-migration-$TS"
mkdir -p "$OUT_DIR"

echo "==> Dumping database..."
pg_dump --format=custom --no-owner --no-acl --clean --if-exists \
  --dbname="$DATABASE_URL" --file="$OUT_DIR/db.dump"

echo "==> Generating MANIFEST.txt..."
GIT_SHA="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
# Schema version: hash of shared/schema.ts (the single source of truth for
# the Drizzle schema). On the VPS, after restore, the same hash should be
# producible from the deployed code if the schemas match. Mismatch is not
# an error (the VPS code is usually one or more commits ahead — that is
# the whole point of update.sh and additive-only migrations) but it is
# useful for forensic comparison if a restore behaves unexpectedly.
SCHEMA_HASH="unknown"
if [[ -f "shared/schema.ts" ]]; then
  SCHEMA_HASH="$(sha256sum shared/schema.ts | awk '{print $1}')"
fi
# List of tables present in the live DB at export time — restore can compare.
TABLE_LIST="$(psql "$DATABASE_URL" -tAc \
  "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name" \
  2>/dev/null | tr '\n' ',' | sed 's/,$//')"
{
  echo "ServiceHub migration bundle"
  echo "Generated: $TS UTC"
  echo "Source git SHA: $GIT_SHA"
  echo "Schema version (sha256 of shared/schema.ts): $SCHEMA_HASH"
  echo "Tables at export: $TABLE_LIST"
  echo ""
  echo "Row counts:"
  for tbl in users tickets ticket_messages services service_alerts news_stories \
             push_subscriptions community_messages email_templates \
             telegram_settings notifications; do
    count="$(psql "$DATABASE_URL" -tAc "SELECT count(*) FROM $tbl" 2>/dev/null || echo "n/a")"
    printf "  %-25s %s\n" "$tbl" "$count"
  done
} > "$OUT_DIR/MANIFEST.txt"

echo "==> Generating secrets.env.template..."
THIS_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE_SRC="$THIS_DIR/.env.template"
if [[ -f "$TEMPLATE_SRC" ]]; then
  # Strip comments + blank lines, keep KEY= rows with empty values, then
  # pre-fill the few values we know from this Replit instance.
  awk -F= '
    /^[[:space:]]*#/ {next}
    /^[[:space:]]*$/ {next}
    {print $1 "="}
  ' "$TEMPLATE_SRC" > "$OUT_DIR/secrets.env.template"
fi

# Pre-fill SESSION_SECRET and VAPID keys from the live env so the operator
# does not have to copy them by hand. (These MUST carry across; new values
# would invalidate sessions / push subscriptions.)
prefill() {
  local key="$1"; local val="${!1:-}"
  [[ -z "$val" ]] && return
  if grep -q "^${key}=" "$OUT_DIR/secrets.env.template"; then
    # escape & and / and \ for sed replacement
    local esc
    esc="$(printf '%s' "$val" | sed -e 's/[\/&]/\\&/g')"
    sed -i "s|^${key}=.*|${key}=${esc}|" "$OUT_DIR/secrets.env.template"
  else
    echo "${key}=${val}" >> "$OUT_DIR/secrets.env.template"
  fi
}
for k in SESSION_SECRET VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY VAPID_CONTACT_EMAIL \
         SENDGRID_API_KEY TELEGRAM_BOT_TOKEN ONESIGNAL_APP_ID ONESIGNAL_REST_API_KEY \
         FIREBASE_SERVICE_ACCOUNT_JSON; do
  prefill "$k"
done

cat > "$OUT_DIR/README.txt" <<'EOF'
ServiceHub migration bundle
===========================

Files:
  db.dump                pg_dump custom format. Restored on the VPS by migrate.sh.
  secrets.env.template   Pre-filled with secrets pulled from the live Replit env.
                         IMPORTANT: open this file, set APP_BASE_URL to the
                         destination domain (e.g. https://status.example.com),
                         fill any blank fields you actually use, then RENAME it
                         to secrets.env BEFORE running migrate.sh.
  MANIFEST.txt           Source git SHA + row counts. Sanity-check after restore.

On the VPS:
  scp servicehub-migration-*.tar.gz  root@vps:/root/
  ssh root@vps
  tar -tzf servicehub-migration-*.tar.gz | head     # peek inside
  # extract, edit secrets.env, re-bundle (or just edit in place inside the tar)
  sudo bash /opt/servicehub/deploy/migrate.sh /root/servicehub-migration-*.tar.gz
EOF

echo "==> Bundling..."
TARBALL="servicehub-migration-$TS.tar.gz"
tar -czf "$TARBALL" -C "$WORK" "servicehub-migration-$TS"
rm -rf "$WORK"

echo ""
echo "==========================================================="
echo "Bundle written: $(pwd)/$TARBALL"
echo ""
echo "Next steps:"
echo "  1. Download $TARBALL from this Repl (right-click -> Download)."
echo "  2. Extract locally, edit servicehub-migration-$TS/secrets.env.template:"
echo "       - set APP_BASE_URL to your VPS domain"
echo "       - fill any blank fields"
echo "       - rename to secrets.env"
echo "  3. Re-tar and scp to the VPS:"
echo "       tar -czf $TARBALL servicehub-migration-$TS"
echo "       scp $TARBALL  root@vps:/root/"
echo "  4. On the VPS:  sudo bash /opt/servicehub/deploy/migrate.sh /root/$TARBALL"
echo "==========================================================="
