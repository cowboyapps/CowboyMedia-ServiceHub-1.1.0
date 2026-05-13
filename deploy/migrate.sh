#!/usr/bin/env bash
# Migrate an existing ServiceHub instance from a source environment to a fresh VPS.
# Same as install.sh but restores DB + secrets from a migration bundle
# (or just a bare DB dump, when the box is already provisioned).
#
# Usage:
#   sudo bash migrate.sh <bundle.tar.gz>                  # full first-time install
#   sudo bash migrate.sh <bundle.tar.gz> --restore-only   # box already provisioned, sync secrets+DB
#   sudo bash migrate.sh <db.dump> --restore-only         # box already provisioned, refresh DB only
#
# Bundle is produced by deploy/export-from-source.sh.
# Bare dump path (the third form) is for routine "pull latest from source DB"
# refreshes between cutover-day and final flip — leaves $ENV_FILE untouched.

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: must be run as root (try: sudo bash $0 ...)"
  exit 1
fi

BUNDLE="${1:-}"
MODE="${2:-full}"
if [[ -z "$BUNDLE" || ! -f "$BUNDLE" ]]; then
  echo "Usage: sudo bash $0 <bundle.tar.gz|db.dump> [--restore-only]"
  exit 1
fi
[[ "$MODE" == "--restore-only" ]] && MODE=restore-only || MODE=full

# Detect bare-dump path: --restore-only with a *.dump file (not a tarball).
# In this mode we skip bundle extraction + secret reconciliation entirely
# and only re-run pg_restore + pm2 reload.
BARE_DUMP=0
if [[ "$MODE" == "restore-only" && "$BUNDLE" =~ \.(dump|backup)$ ]]; then
  BARE_DUMP=1
fi

APP_USER=servicehub
APP_DIR=/opt/servicehub
LOG_DIR=/var/log/servicehub
BACKUP_DIR=/var/backups/servicehub
ENV_FILE="$APP_DIR/.env"

if [[ "$BARE_DUMP" -eq 1 ]]; then
  # Bare-dump path: caller passed a *.dump straight from pg_dump. Skip bundle
  # extraction entirely. $ENV_FILE must already exist (we leave secrets alone).
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "ERROR: --restore-only with a bare dump requires $ENV_FILE to already exist."
    echo "       Either run a full migrate first, or pass a bundle.tar.gz instead."
    exit 1
  fi
  if ! id -u "$APP_USER" >/dev/null 2>&1; then
    echo "ERROR: $APP_USER does not exist; bare-dump mode is for already-provisioned hosts."
    exit 1
  fi
  DUMP_FILE="$BUNDLE"
  MANIFEST_FILE=""
  # Make readable by $APP_USER for pg_restore.
  chgrp "$APP_USER" "$DUMP_FILE" 2>/dev/null || true
  chmod 640 "$DUMP_FILE" 2>/dev/null || true
  echo "==> Bare-dump mode: refreshing DB from $DUMP_FILE (env untouched)"
else
  WORK="$(mktemp -d)"
  trap 'rm -rf "$WORK"' EXIT
  # mktemp -d creates a 0700 dir owned by root. The unprivileged $APP_USER
  # (servicehub) needs to traverse it to read the extracted db.dump for
  # pg_restore, so relax to 0755 (traversable, not writable by others).
  chmod 755 "$WORK"
  echo "==> Extracting bundle to $WORK..."
  tar -xzf "$BUNDLE" -C "$WORK"
  BUNDLE_ROOT="$(find "$WORK" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  [[ -z "$BUNDLE_ROOT" ]] && BUNDLE_ROOT="$WORK"
  # Grant just enough access for the unprivileged $APP_USER to read db.dump
  # via group ownership — avoids world-readable bits. secrets.env stays
  # root-only (0600, root:root) since only this root script parses it.
  if id -u "$APP_USER" >/dev/null 2>&1; then
    chgrp "$APP_USER" "$BUNDLE_ROOT"
    chmod 750 "$BUNDLE_ROOT"
    if [[ -f "$BUNDLE_ROOT/db.dump" ]]; then
      chgrp "$APP_USER" "$BUNDLE_ROOT/db.dump"
      chmod 640 "$BUNDLE_ROOT/db.dump"
    fi
  else
    # First-time install: $APP_USER doesn't exist yet. Fall back to broader
    # perms; they'll be re-tightened on subsequent --restore-only runs and
    # the temp dir is wiped on EXIT regardless.
    chmod 755 "$BUNDLE_ROOT"
    [[ -f "$BUNDLE_ROOT/db.dump" ]] && chmod 644 "$BUNDLE_ROOT/db.dump"
  fi

  DUMP_FILE="$BUNDLE_ROOT/db.dump"
  SECRETS_FILE="$BUNDLE_ROOT/secrets.env"
  MANIFEST_FILE="$BUNDLE_ROOT/MANIFEST.txt"

  if [[ ! -f "$DUMP_FILE" ]]; then
    echo "ERROR: bundle missing db.dump"
    exit 1
  fi
  if [[ ! -f "$SECRETS_FILE" ]]; then
    echo "ERROR: bundle missing secrets.env (operator must fill secrets.env.template before re-bundling, or copy in place)"
    exit 1
  fi

  echo "==> Loading secrets from $SECRETS_FILE (strict KEY=VALUE parse)..."
  # Do NOT `source` an untrusted bundle file as root — it would execute arbitrary
  # shell. Parse only well-formed KEY=VALUE lines and export them ourselves.
  ALLOWED_KEYS="DATABASE_URL SESSION_SECRET APP_BASE_URL NODE_ENV PORT VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY VAPID_CONTACT_EMAIL SENDGRID_API_KEY TELEGRAM_BOT_TOKEN ONESIGNAL_APP_ID ONESIGNAL_REST_API_KEY FIREBASE_SERVICE_ACCOUNT_JSON BACKUP_ENCRYPTION_PASSPHRASE BACKUP_RCLONE_REMOTE"
  while IFS= read -r line; do
    # skip blanks and comments
    [[ "$line" =~ ^[[:space:]]*$ ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    # require KEY=VALUE where KEY is [A-Z_][A-Z0-9_]*
    if [[ ! "$line" =~ ^([A-Z_][A-Z0-9_]*)=(.*)$ ]]; then
      echo "WARN: ignoring malformed line in secrets.env: $line"
      continue
    fi
    key="${BASH_REMATCH[1]}"
    val="${BASH_REMATCH[2]}"
    # strip surrounding single or double quotes if present
    if [[ "$val" =~ ^\".*\"$ ]] || [[ "$val" =~ ^\'.*\'$ ]]; then
      val="${val:1:${#val}-2}"
    fi
    if [[ " $ALLOWED_KEYS " != *" $key "* ]]; then
      echo "WARN: ignoring non-allowlisted key in secrets.env: $key"
      continue
    fi
    printf -v "$key" '%s' "$val"
    export "$key"
  done < "$SECRETS_FILE"

  # Refuse to proceed if mandatory secrets are blank — they MUST be carried
  # across or live state breaks (sessions, push subs).
  for v in SESSION_SECRET VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY APP_BASE_URL; do
    if [[ -z "${!v:-}" ]]; then
      echo "ERROR: mandatory secret '$v' is empty in secrets.env. Refusing to continue."
      echo "       Migrating with empty values would invalidate sessions or push subscriptions."
      exit 1
    fi
  done

  DOMAIN="$(echo "$APP_BASE_URL" | sed -E 's#^https?://##; s#/.*##')"
  echo "==> Domain derived from APP_BASE_URL: $DOMAIN"
fi
# end of bundle-vs-bare-dump branch

# Apply versioned drizzle migrations against the live DB. The in-process
# migrator (server/migrate.ts) also runs at startup, but during a fresh
# install / restore we want migrations applied BEFORE pm2 spawns so a
# malformed migration aborts the install instead of leaving a half-restored
# DB behind a not-yet-started app. Failure here exits non-zero and aborts
# the script before PM2 is started/reloaded.
run_migrations_with_verify() {
  local label="$1"
  local rc=0
  sudo -u "$APP_USER" -H bash -lc \
    "cd $APP_DIR && set -a && . $ENV_FILE && set +a && \
     node -e \"require('tsx/cjs'); require('./server/migrate').runMigrations().catch(e => { console.error(e); process.exit(1); })\"" \
    || rc=$?
  if [[ "$rc" -ne 0 ]]; then
    echo "ERROR: $label — drizzle migrator exited non-zero ($rc)."
    echo "       Aborting before PM2 is touched. Investigate and re-run."
    exit 1
  fi
  echo "    migrations applied / schema verified."
}

if [[ "$MODE" == "full" ]]; then
  read -rp "Admin contact email (TLS): " ADMIN_EMAIL
  read -rp "Postgres DB password to create [auto-generate]: " DB_PASSWORD
  DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -hex 24)}"
  read -rp "Git repo URL: " GIT_REPO
  read -rp "Git ref to deploy [main]: " GIT_REF
  GIT_REF="${GIT_REF:-main}"

  echo "==> Preparing host (clearing pre-installed web servers / firewalls)..."
  export DEBIAN_FRONTEND=noninteractive
  # Some VPS templates ship Apache2 listening on :80, which silently blocks
  # Nginx from binding. Purge before installing our stack.
  if dpkg -l 2>/dev/null | awk '{print $2}' | grep -qx apache2; then
    echo "    apache2 detected — stopping & purging to free port 80"
    systemctl disable --now apache2 2>/dev/null || true
    apt-get purge -y apache2 apache2-utils apache2-bin apache2-data 2>/dev/null || true
    apt-get autoremove -y 2>/dev/null || true
  fi
  # firewalld preinstalled+active on Liquid Web (and a few others). Open
  # http/https there and skip UFW further down.
  USE_FIREWALLD=0
  if systemctl is-active --quiet firewalld 2>/dev/null; then
    echo "    firewalld is active — will configure it (skipping UFW)"
    USE_FIREWALLD=1
    firewall-cmd --permanent --add-service=http  >/dev/null
    firewall-cmd --permanent --add-service=https >/dev/null
    firewall-cmd --permanent --add-service=ssh   >/dev/null
    firewall-cmd --reload >/dev/null
  fi

  echo "==> Installing system packages..."
  apt-get update -y
  apt-get install -y \
    ca-certificates curl gnupg lsb-release build-essential git ufw fail2ban \
    nginx certbot python3-certbot-nginx \
    rclone unattended-upgrades logrotate

  # Postgres 16 from PGDG (pinned across 22.04 and 24.04).
  echo "==> Installing Postgres 16 (PGDG repo)..."
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    | gpg --dearmor -o /etc/apt/keyrings/postgresql.gpg
  CODENAME="$(lsb_release -cs)"
  echo "deb [signed-by=/etc/apt/keyrings/postgresql.gpg] http://apt.postgresql.org/pub/repos/apt $CODENAME-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
  apt-get update -y
  apt-get install -y postgresql-16 postgresql-contrib-16

  if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  fi
  command -v pm2 >/dev/null 2>&1 || npm install -g pm2

  id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$APP_USER"
  mkdir -p "$APP_DIR" "$LOG_DIR" "$BACKUP_DIR"
  chown -R "$APP_USER:$APP_USER" "$APP_DIR" "$LOG_DIR" "$BACKUP_DIR"

  # Now that $APP_USER exists, re-tighten the bundle perms set during
  # first-time fallback (above) from world-readable down to group-only.
  chgrp "$APP_USER" "$BUNDLE_ROOT"
  chmod 750 "$BUNDLE_ROOT"
  if [[ -f "$BUNDLE_ROOT/db.dump" ]]; then
    chgrp "$APP_USER" "$BUNDLE_ROOT/db.dump"
    chmod 640 "$BUNDLE_ROOT/db.dump"
  fi

  systemctl enable --now postgresql
  sudo -u postgres psql <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$APP_USER') THEN
    CREATE ROLE $APP_USER LOGIN PASSWORD '$DB_PASSWORD';
  ELSE
    ALTER ROLE $APP_USER WITH PASSWORD '$DB_PASSWORD';
  END IF;
END
\$\$;
SQL
  sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='servicehub'" \
    | grep -q 1 || sudo -u postgres createdb -O "$APP_USER" servicehub

  if [[ ! -d "$APP_DIR/.git" ]]; then
    sudo -u "$APP_USER" git clone "$GIT_REPO" "$APP_DIR"
  fi
  sudo -u "$APP_USER" git -C "$APP_DIR" fetch --all --tags
  sudo -u "$APP_USER" git -C "$APP_DIR" reset --hard "$GIT_REF"

  echo "==> Writing $ENV_FILE from migrated secrets..."
  install -m 600 -o "$APP_USER" -g "$APP_USER" /dev/null "$ENV_FILE"
  # Single-quote each value so `. $ENV_FILE` is safe even when the value
  # contains JSON, spaces, or shell metacharacters.
  write_env_kv() {
    local k="$1" v="$2"
    printf "%s='%s'\n" "$k" "${v//\'/\'\\\'\'}"
  }
  {
    write_env_kv DATABASE_URL "postgres://$APP_USER:$DB_PASSWORD@127.0.0.1:5432/servicehub"
    write_env_kv SESSION_SECRET "$SESSION_SECRET"
    write_env_kv APP_BASE_URL  "$APP_BASE_URL"
    write_env_kv NODE_ENV      "production"
    write_env_kv PORT          "${PORT:-5000}"
    write_env_kv VAPID_PUBLIC_KEY  "$VAPID_PUBLIC_KEY"
    write_env_kv VAPID_PRIVATE_KEY "$VAPID_PRIVATE_KEY"
    write_env_kv VAPID_CONTACT_EMAIL "${VAPID_CONTACT_EMAIL:-$ADMIN_EMAIL}"
    write_env_kv SENDGRID_API_KEY     "${SENDGRID_API_KEY:-}"
    write_env_kv TELEGRAM_BOT_TOKEN   "${TELEGRAM_BOT_TOKEN:-}"
    write_env_kv ONESIGNAL_APP_ID     "${ONESIGNAL_APP_ID:-}"
    write_env_kv ONESIGNAL_REST_API_KEY "${ONESIGNAL_REST_API_KEY:-}"
    write_env_kv FIREBASE_SERVICE_ACCOUNT_JSON "${FIREBASE_SERVICE_ACCOUNT_JSON:-}"
    write_env_kv BACKUP_ENCRYPTION_PASSPHRASE "${BACKUP_ENCRYPTION_PASSPHRASE:-$(openssl rand -hex 24)}"
    write_env_kv BACKUP_RCLONE_REMOTE "${BACKUP_RCLONE_REMOTE:-}"
  } > "$ENV_FILE"
  chown "$APP_USER:$APP_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"

  echo "==> Building app (env sourced so prebuild's db:check sees DATABASE_URL)..."
  sudo -u "$APP_USER" -H bash -lc "cd $APP_DIR && set -a && . $ENV_FILE && set +a && npm ci && npm run build"

  echo "==> Applying versioned drizzle migrations (initial schema)..."
  run_migrations_with_verify "initial schema migration"
else
  # restore-only path. Two sub-modes:
  #   - bundle:   reconcile $ENV_FILE secrets with what came in the bundle
  #   - bare dump: skip reconciliation entirely (env is operator-managed)
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "ERROR: --restore-only requires $ENV_FILE to already exist (run full migrate first)."
    exit 1
  fi
  if [[ "$BARE_DUMP" -eq 1 ]]; then
    echo "==> Bare-dump mode: leaving $ENV_FILE untouched (no secret reconciliation)."
  else
  # ensure mandatory secrets in the existing .env match what came in the
  # bundle. The constraint is non-negotiable — if the box was provisioned
  # with fresh SESSION_SECRET / VAPID values, restoring the DB without
  # overwriting those env values would still invalidate sessions and push
  # subscriptions.
  echo "==> Reconciling secrets in $ENV_FILE with bundle (all allowlisted keys)..."
  # Sync every allowlisted key that the bundle provides (non-empty), not just
  # the mandatory ones. Keeps optional secrets (SendGrid, Telegram, etc.) in
  # lockstep with the source instance so behaviour after cutover is identical.
  for v in $ALLOWED_KEYS; do
    bundle_val="${!v:-}"
    [[ -z "$bundle_val" ]] && continue
    current_val="$(grep -E "^${v}=" "$ENV_FILE" | head -n1 | sed -E "s/^${v}=//" || true)"
    if [[ "$current_val" != "$bundle_val" ]]; then
      echo "    syncing $v from bundle"
      # Quote the value so `. $ENV_FILE` parses safely even when the value
      # contains spaces or shell metacharacters (e.g. FIREBASE_SERVICE_ACCOUNT_JSON).
      # Single-quote and escape any embedded single quotes.
      quoted="'${bundle_val//\'/\'\\\'\'}'"
      if grep -qE "^${v}=" "$ENV_FILE"; then
        # Use a delimiter unlikely to collide with JSON contents.
        python3 -c "
import sys, re
p='$ENV_FILE'; k='$v'; v=sys.argv[1]
with open(p) as f: lines=f.readlines()
out=[]; replaced=False
for ln in lines:
    if ln.startswith(k+'='):
        out.append(k+'='+v+'\n'); replaced=True
    else: out.append(ln)
if not replaced: out.append(k+'='+v+'\n')
open(p,'w').writelines(out)
" "$quoted"
      else
        printf '%s=%s\n' "$v" "$quoted" >> "$ENV_FILE"
      fi
    fi
  done
  chown "$APP_USER:$APP_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  fi
  # end of bundle-vs-bare-dump reconciliation branch
fi

echo "==> Restoring database from $DUMP_FILE..."
# --clean --if-exists drops & recreates objects; --no-owner/--no-acl strips
# source-environment role grants. After this, we re-apply schema for any new
# tables/columns added since the dump (additive-only migrations).
sudo -u "$APP_USER" -H bash -lc "cd $APP_DIR && set -a && . $ENV_FILE && set +a && \
  pg_restore --clean --if-exists --no-owner --no-acl --dbname=\"\$DATABASE_URL\" \"$DUMP_FILE\""

echo "==> Applying versioned drizzle migrations (post-restore catch-up)..."
run_migrations_with_verify "post-restore schema catch-up"

if [[ "$MODE" == "full" ]]; then
  echo "==> Starting PM2..."
  # Source $ENV_FILE before pm2 start so DATABASE_URL et al. land in the
  # spawned Node process. Pass --update-env on save so PM2's saved dump
  # (read by `pm2 resurrect` on reboot) contains the correct env too.
  sudo -u "$APP_USER" -H bash -lc "cd $APP_DIR && set -a && . $ENV_FILE && set +a && \
    pm2 start deploy/ecosystem.config.cjs --update-env && pm2 save"
  # When pm2 startup is invoked as root with -u $APP_USER, PM2 self-installs
  # the systemd unit; no need to pipe its hint output through bash (which
  # used to fail with `bash: line 1: $: command not found`).
  env PATH=$PATH:/usr/bin pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER"

  echo "==> Configuring Nginx..."
  NGINX_CONF=/etc/nginx/sites-available/servicehub
  sed "s/__DOMAIN__/$DOMAIN/g" "$APP_DIR/deploy/nginx.conf.template" > "$NGINX_CONF"
  ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/servicehub
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx

  if [[ "${USE_FIREWALLD:-0}" -eq 1 ]]; then
    echo "==> firewalld already configured for http/https/ssh; skipping UFW."
  else
    ufw allow OpenSSH || true
    ufw allow 'Nginx Full' || true
    ufw --force enable
  fi
  systemctl enable --now fail2ban

  cat > /etc/logrotate.d/servicehub <<EOF
$LOG_DIR/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
}
EOF

  install -m 0755 "$APP_DIR/deploy/backup.sh" /usr/local/sbin/servicehub-backup
  cat > /etc/systemd/system/servicehub-backup.service <<EOF
[Unit]
Description=ServiceHub nightly DB backup
After=postgresql.service

[Service]
Type=oneshot
EnvironmentFile=$ENV_FILE
ExecStart=/usr/local/sbin/servicehub-backup
EOF
  cat > /etc/systemd/system/servicehub-backup.timer <<EOF
[Unit]
Description=Run ServiceHub nightly backup at 03:15

[Timer]
OnCalendar=*-*-* 03:15:00
Persistent=true

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now servicehub-backup.timer
else
  echo "==> Reloading PM2..."
  sudo -u "$APP_USER" -H bash -lc "set -a && . $ENV_FILE && set +a && \
    (pm2 reload servicehub --update-env || \
     (cd $APP_DIR && pm2 start deploy/ecosystem.config.cjs --update-env)) && pm2 save"
fi

echo "==> Smoke-testing /api/health..."
sleep 5
curl -fsS "http://127.0.0.1:5000/api/health" || echo "WARNING: health endpoint not responding"

if [[ "$MODE" == "full" ]]; then
  echo "==> Issuing TLS certificate via Certbot..."
  certbot --nginx --non-interactive --agree-tos -m "$ADMIN_EMAIL" -d "$DOMAIN" --redirect || \
    echo "    Certbot failed. Run manually once DNS is live: certbot --nginx -d $DOMAIN"
fi

if [[ -f "$MANIFEST_FILE" ]]; then
  echo "==> Migration manifest:"
  cat "$MANIFEST_FILE"
fi

echo "==> Migration complete."
