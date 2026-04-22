#!/usr/bin/env bash
# Fresh ServiceHub install on Ubuntu 22.04 / 24.04.
# Run as root (or with sudo) on a fresh VPS. Prompts for everything it needs.
#
# Usage:  sudo bash install.sh
#
# For an existing-data migration, use migrate.sh instead.

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: must be run as root (try: sudo bash $0)"
  exit 1
fi

UBUNTU_VERSION="$(lsb_release -rs 2>/dev/null || echo unknown)"
echo "Detected Ubuntu: $UBUNTU_VERSION"

read -rp "Domain name (e.g. status.example.com): " DOMAIN
read -rp "Admin contact email (used for TLS + VAPID): " ADMIN_EMAIL
read -rp "Postgres DB password to create [auto-generate]: " DB_PASSWORD
DB_PASSWORD="${DB_PASSWORD:-$(openssl rand -hex 24)}"
read -rp "Git repo URL (https://github.com/youraccount/servicehub.git): " GIT_REPO
read -rp "Git ref to deploy [main]: " GIT_REF
GIT_REF="${GIT_REF:-main}"

APP_USER=servicehub
APP_DIR=/opt/servicehub
LOG_DIR=/var/log/servicehub
BACKUP_DIR=/var/backups/servicehub
ENV_FILE="$APP_DIR/.env"

echo "==> Installing system packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y \
  ca-certificates curl gnupg lsb-release \
  build-essential git ufw fail2ban \
  nginx certbot python3-certbot-nginx \
  rclone unattended-upgrades logrotate

# Postgres 16 from PGDG (Ubuntu defaults vary: 22.04 ships PG14, 24.04 ships PG16).
# Pin explicitly to keep behaviour identical across both LTS versions.
echo "==> Installing Postgres 16 (PGDG repo)..."
install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  | gpg --dearmor -o /etc/apt/keyrings/postgresql.gpg
CODENAME="$(lsb_release -cs)"
echo "deb [signed-by=/etc/apt/keyrings/postgresql.gpg] http://apt.postgresql.org/pub/repos/apt $CODENAME-pgdg main" \
  > /etc/apt/sources.list.d/pgdg.list
apt-get update -y
apt-get install -y postgresql-16 postgresql-contrib-16

# Node 20 (NodeSource)
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]]; then
  echo "==> Installing Node 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# PM2
if ! command -v pm2 >/dev/null 2>&1; then
  echo "==> Installing PM2..."
  npm install -g pm2
fi

echo "==> Creating system user $APP_USER..."
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --create-home --shell /bin/bash "$APP_USER"
fi

echo "==> Preparing directories..."
mkdir -p "$APP_DIR" "$LOG_DIR" "$BACKUP_DIR"
chown -R "$APP_USER:$APP_USER" "$APP_DIR" "$LOG_DIR" "$BACKUP_DIR"

echo "==> Configuring Postgres..."
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

echo "==> Cloning repo to $APP_DIR..."
if [[ ! -d "$APP_DIR/.git" ]]; then
  sudo -u "$APP_USER" git clone "$GIT_REPO" "$APP_DIR"
fi
sudo -u "$APP_USER" git -C "$APP_DIR" fetch --all --tags
sudo -u "$APP_USER" git -C "$APP_DIR" reset --hard "$GIT_REF"

echo "==> Generating SESSION_SECRET and VAPID keys (fresh install only)..."
SESSION_SECRET="$(openssl rand -hex 48)"
VAPID_OUT="$(sudo -u "$APP_USER" -H bash -lc "cd $APP_DIR && npx --yes web-push generate-vapid-keys --json")"
VAPID_PUBLIC="$(echo "$VAPID_OUT" | grep -oE '"publicKey":"[^"]+"' | cut -d'"' -f4)"
VAPID_PRIVATE="$(echo "$VAPID_OUT" | grep -oE '"privateKey":"[^"]+"' | cut -d'"' -f4)"

echo "==> Writing $ENV_FILE..."
# Single-quote every value so `. $ENV_FILE` parses safely even when values
# contain JSON, spaces, or shell metacharacters. Embedded single quotes are
# escaped with the standard '\'' trick.
write_env_kv() {
  local k="$1" v="$2"
  printf "%s='%s'\n" "$k" "${v//\'/\'\\\'\'}"
}
{
  write_env_kv DATABASE_URL "postgres://$APP_USER:$DB_PASSWORD@127.0.0.1:5432/servicehub"
  write_env_kv SESSION_SECRET "$SESSION_SECRET"
  write_env_kv APP_BASE_URL  "https://$DOMAIN"
  write_env_kv NODE_ENV      "production"
  write_env_kv PORT          "5000"
  write_env_kv VAPID_PUBLIC_KEY  "$VAPID_PUBLIC"
  write_env_kv VAPID_PRIVATE_KEY "$VAPID_PRIVATE"
  write_env_kv VAPID_CONTACT_EMAIL "$ADMIN_EMAIL"
  write_env_kv SENDGRID_API_KEY     ""
  write_env_kv TELEGRAM_BOT_TOKEN   ""
  write_env_kv ONESIGNAL_APP_ID     ""
  write_env_kv ONESIGNAL_REST_API_KEY ""
  write_env_kv FIREBASE_SERVICE_ACCOUNT_JSON ""
  write_env_kv BACKUP_ENCRYPTION_PASSPHRASE "$(openssl rand -hex 24)"
  write_env_kv BACKUP_RCLONE_REMOTE ""
} > "$ENV_FILE"
chown "$APP_USER:$APP_USER" "$ENV_FILE"
chmod 600 "$ENV_FILE"

echo "==> Building app (npm ci && npm run build)..."
sudo -u "$APP_USER" -H bash -lc "cd $APP_DIR && npm ci && npm run build"

echo "==> Pushing schema (drizzle db:push)..."
sudo -u "$APP_USER" -H bash -lc "cd $APP_DIR && set -a && . $ENV_FILE && set +a && npm run db:push"

echo "==> Starting PM2..."
# Source $ENV_FILE before pm2 start so the spawned Node process inherits
# DATABASE_URL and friends. PM2's `env_file` option is silently ignored on
# older PM2 builds, so we never rely on it. `--update-env` + `pm2 save`
# captures the env into the saved dump that `pm2 resurrect` reads on boot.
sudo -u "$APP_USER" -H bash -lc "cd $APP_DIR && set -a && . $ENV_FILE && set +a && \
  pm2 start deploy/ecosystem.config.cjs --update-env && pm2 save"
# pm2 startup writes a systemd unit that runs PM2 as $APP_USER on boot.
# When invoked as root with -u $APP_USER it self-installs; the previous
# `| tail -n 1 | bash` only piped a "$ ..." copy/paste hint into bash and
# produced a noisy `bash: line 1: $: command not found`.
env PATH=$PATH:/usr/bin pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER"

echo "==> Configuring Nginx..."
NGINX_CONF=/etc/nginx/sites-available/servicehub
sed "s/__DOMAIN__/$DOMAIN/g" "$APP_DIR/deploy/nginx.conf.template" > "$NGINX_CONF"
ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/servicehub
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "==> Configuring UFW..."
ufw allow OpenSSH || true
ufw allow 'Nginx Full' || true
ufw --force enable

echo "==> Configuring fail2ban..."
systemctl enable --now fail2ban

echo "==> Enabling unattended security upgrades..."
# Force-enable so a fresh install ships with auto-patching even if the
# distro default is "ask". Auto-reboots disabled to avoid surprise restarts.
cat > /etc/apt/apt.conf.d/20auto-upgrades <<EOF
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
cat > /etc/apt/apt.conf.d/51servicehub-unattended <<EOF
Unattended-Upgrade::Allowed-Origins {
        "\${distro_id}:\${distro_codename}-security";
        "\${distro_id}ESMApps:\${distro_codename}-apps-security";
        "\${distro_id}ESM:\${distro_codename}-infra-security";
};
Unattended-Upgrade::Automatic-Reboot "false";
EOF
systemctl enable --now unattended-upgrades

echo "==> Installing logrotate config..."
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

echo "==> Installing nightly backup systemd timer..."
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

echo "==> Smoke-testing /api/health..."
sleep 5
if curl -fsS "http://127.0.0.1:5000/api/health" | grep -q '"ok":true'; then
  echo "    health OK"
else
  echo "    WARNING: health check did not return ok=true. Check pm2 logs servicehub"
fi

echo "==> Issuing TLS certificate via Certbot..."
echo "    (Skip with Ctrl-C if DNS for $DOMAIN does not yet point to this server.)"
certbot --nginx --non-interactive --agree-tos -m "$ADMIN_EMAIL" -d "$DOMAIN" --redirect || \
  echo "    Certbot failed. Run manually once DNS is live: certbot --nginx -d $DOMAIN"

cat <<EOF

==========================================================
ServiceHub installed.

  Domain:         https://$DOMAIN
  App dir:        $APP_DIR
  Logs:           $LOG_DIR  (or: pm2 logs servicehub)
  Env file:       $ENV_FILE  (chmod 600)
  Backups timer:  systemctl status servicehub-backup.timer

NEXT STEPS:
  1. Edit $ENV_FILE to fill SENDGRID_API_KEY, TELEGRAM_BOT_TOKEN, etc.
     Then: sudo -u $APP_USER pm2 reload servicehub
  2. Configure rclone for off-site backups:
       sudo -u $APP_USER rclone config
     Set BACKUP_RCLONE_REMOTE in $ENV_FILE.
  3. Log in at https://$DOMAIN with admin / admin123 and change the password.
==========================================================
EOF
