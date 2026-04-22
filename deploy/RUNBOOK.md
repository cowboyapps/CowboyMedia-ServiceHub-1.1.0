# ServiceHub VPS cutover runbook

Plain-English, step-by-step. Read it once front-to-back **before** booking maintenance time.

---

## 0. VPS provider recommendations

Anything with KVM virtualization, ≥2 vCPU, ≥4 GB RAM, ≥40 GB SSD, Ubuntu 22.04 LTS or 24.04 LTS.

Tested-good options:
- Hetzner CPX21 (~€8/mo) — best price/perf, EU/US locations.
- DigitalOcean Premium AMD 2 GB ($18/mo) — easy snapshots.
- Vultr High-Frequency 2 GB ($12/mo) — fast NVMe.

Avoid OpenVZ-only providers; some block kernel features Postgres needs.

---

## 1. Pre-flight (T minus 1 week)

1. Buy the VPS. Note its public IPv4.
2. In your DNS provider, **lower TTL** on the production A record from whatever it is (usually 3600s) down to **60s**. Wait at least one full old-TTL cycle for resolvers to pick this up. This makes the cutover-day DNS swap propagate in ~1 minute.
3. Create a temp subdomain — e.g. `vps-test.yourdomain.com` — pointing at the new VPS IP. We will use this for the dry run.

## 2. Dry run on the temp subdomain (T minus 2-3 days)

1. SSH to the VPS as root.
2. Clone this repo to `/root/servicehub-installer` and run:
   ```bash
   git clone <your-repo-url> /root/servicehub-installer
   sudo bash /root/servicehub-installer/deploy/install.sh
   ```
3. When prompted, enter `vps-test.yourdomain.com` as the domain.
4. Watch the script. It should finish in ~5 minutes.
5. Smoke-test the temp URL: log in with `admin / admin123`, post a test news, post a test ticket message, verify push notifications work, verify Telegram fires (after pasting the bot token into `.env` and `pm2 reload`).
6. **Tear it down**: `sudo systemctl stop pm2-servicehub nginx postgresql` and snapshot the VPS, OR provision a brand new VPS for the real cutover. Either way, do not let the dry-run instance bleed into the cutover.

## 3. T minus 24 hours

1. Confirm DNS TTL is still 60s on the production record.
2. Email customers: **15-minute maintenance window at <date/time UTC>**.
3. (Optional) Add a maintenance banner to the Replit instance.

## 4. T minus 1 hour — provision the real VPS

On a fresh VPS:
```bash
git clone <your-repo-url> /root/servicehub-installer
# DO NOT run install.sh — we'll use migrate.sh instead which carries our data over.
```

We pre-stage everything except the data so the actual cutover window is small.

## 5. T zero — the cutover (≤15 min)

### 5a. In the Replit shell

```bash
# Make sure pg_dump is on PATH; on Replit you may need:
nix-shell -p postgresql_16
bash deploy/export-from-replit.sh
# This produces servicehub-migration-<ts>.tar.gz in the current directory.
```

Download the bundle to your laptop. Extract it. Open `secrets.env.template`:
- Set `APP_BASE_URL=https://yourdomain.com` (the **real** domain, NOT the temp one).
- The script has pre-filled `SESSION_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `SENDGRID_API_KEY`, `TELEGRAM_BOT_TOKEN`. Verify they look right.
- Rename the file to `secrets.env`.
- Re-tar it: `tar -czf servicehub-migration-<ts>.tar.gz servicehub-migration-<ts>`.

### 5b. Ship to VPS and migrate

```bash
scp servicehub-migration-<ts>.tar.gz root@<vps-ip>:/root/
ssh root@<vps-ip>
sudo bash /root/servicehub-installer/deploy/migrate.sh /root/servicehub-migration-<ts>.tar.gz
```

The script:
- Installs everything (~3 min on a 2 vCPU VPS).
- Restores the dump.
- Starts the app under PM2.
- Configures Nginx for `<yourdomain.com>` (parsed from `APP_BASE_URL`).
- Issues a TLS cert via Certbot — but only if DNS already resolves to this IP. If you haven't flipped DNS yet, this will fail; that's fine.

### 5c. Smoke test against the VPS *before* DNS flip

Without changing DNS, hit the new server using `--resolve`:
```bash
curl --resolve yourdomain.com:443:<vps-ip> https://yourdomain.com/api/health
# expect: {"ok":true,"db":"up"}
```

If you used HTTP-only (no cert yet), use `:80`. Or test against the temp subdomain you used in the dry run.

### 5d. Flip DNS

In your DNS provider, change the A record for `yourdomain.com` to point at the new VPS IP. With 60s TTL it will propagate in ~1 minute. Verify:
```bash
dig +short yourdomain.com
```
Wait until you see the new IP.

### 5e. Issue the TLS certificate

Now that DNS resolves to the VPS:
```bash
ssh root@<vps-ip>
sudo certbot --nginx -d yourdomain.com
```

### 5f. Final verification (the post-cutover checklist)

Open `https://yourdomain.com` in a fresh browser tab. Verify in this order:

- [ ] Login as admin works.
- [ ] Login as a real customer works (their old session may have rolled — that's fine, the SESSION_SECRET was preserved so cookies should still be valid).
- [ ] Open an existing ticket. Reply to it. Reply appears for the customer in real time (= WebSocket OK).
- [ ] Post a news story. Telegram fires.
- [ ] On a phone with push enabled, trigger a test alert. Push notification arrives.
- [ ] Forgot-password flow sends an email with a link to `https://yourdomain.com/reset-password?...`.
- [ ] Upload an image (avatar or news image). It saves and displays.
- [ ] Open community chat. Type a message. It appears for other connected clients.
- [ ] PWA installs from the address bar.

Watch logs for 30 minutes:
```bash
sudo -u servicehub pm2 logs servicehub
```

### 5g. Decommission the Replit instance

Leave it running for 24 hours as a fallback (in case you need to grab a forgotten file). Then stop it.

---

## 6. Rollback decision tree

If anything in 5f fails and you can't fix it inside 5 minutes:

```
DNS already flipped?
  YES -> flip DNS back to old Replit IP. Wait 60s. You're back on Replit.
         Investigate at leisure. The bundle is still on disk; you can re-try.
  NO  -> just don't flip. The Replit instance is still serving live.
         Investigate; re-run migrate.sh after fixing.
```

If you flipped DNS, then the cert was issued on the VPS, and now you want to roll back: that's still fine. The old Replit cert is unchanged. Browsers will use whichever cert the IP they hit serves.

---

## 7. SSH hardening (do this once)

```bash
# As root on the VPS, after install:
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl reload ssh
# Make sure your key is in /root/.ssh/authorized_keys BEFORE running this.
```

Optional: change SSH port, restrict source IPs in UFW, enable unattended-upgrades for security patches (already installed by `install.sh`; enable with `dpkg-reconfigure -plow unattended-upgrades`).

---

## 8. Common things that go wrong, and the fix

| Symptom | Cause | Fix |
| --- | --- | --- |
| `certbot` says "challenge failed" | DNS not yet propagated | Wait. Verify with `dig +short`. |
| WebSockets connect but messages never appear | Nginx missing `Upgrade`/`Connection` headers | Re-copy `nginx.conf.template` over `/etc/nginx/sites-available/servicehub`, replace `__DOMAIN__`, `nginx -t && systemctl reload nginx`. |
| Sessions all logged out | `SESSION_SECRET` was regenerated | The migrate script refuses this; you would have hit it explicitly. Restore from snapshot, fix `secrets.env`, retry. |
| Push notifications stop arriving | VAPID keys regenerated, OR domain changed | Same domain + same VAPID keys = no problem. If either changed, every browser sub is dead; users must re-enable. |
| `pg_restore` errors about missing extensions | The dump uses `pgcrypto` for `gen_random_uuid()`. | `sudo -u postgres psql servicehub -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto;'` then re-run. |
| App keeps restart-looping | Bad env var | `sudo -u servicehub pm2 logs servicehub --lines 100`. Most often a missing or malformed `DATABASE_URL`. |
| `Error: SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string` spamming err.log | PM2 was started in a shell that never sourced `.env`, so `DATABASE_URL` is undefined. Should not happen with current scripts; only seen on instances installed before that fix. | `sudo -u servicehub bash -lc 'cd /opt/servicehub && set -a && . .env && set +a && pm2 restart servicehub --update-env && pm2 save'` |
| Nginx 502 | App not listening on 5000 | `curl http://127.0.0.1:5000/api/health` directly. If it fails, fix the app first. |
| Disk filling | Logs / backups | `du -sh /var/log/servicehub /var/backups/servicehub`. logrotate caps logs; backup script caps snapshots. |

---

## 9. Day-2 ops cheatsheet

```bash
# Tail app logs
sudo -u servicehub pm2 logs servicehub

# Restart app
sudo -u servicehub pm2 reload servicehub

# Manual backup right now
sudo systemctl start servicehub-backup.service

# Check backup timer
systemctl list-timers | grep servicehub

# Disk + DB size
du -sh /var/lib/postgresql /var/log/servicehub /var/backups/servicehub
sudo -u postgres psql -c "SELECT pg_size_pretty(pg_database_size('servicehub'));"

# Update to latest main
sudo bash /opt/servicehub/deploy/update.sh

# Roll back the last update
sudo bash /opt/servicehub/deploy/rollback.sh
```
