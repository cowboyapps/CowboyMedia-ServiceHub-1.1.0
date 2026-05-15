# GitHub → VPS deploy webhook listener

This is a small Node service that listens on `127.0.0.1:5055` for GitHub
push webhooks, validates the HMAC signature, and runs `deploy/update.sh`
when `main` advances. It is intentionally **separate** from the main app
process — a crashed app must not block deploys, and a deploy reload must
not kill its own webhook handler.

## What runs where

- **`server.mjs`** — the listener (vanilla Node, no deps). HMAC-SHA256
  signature validation, master_admin kill-switch via the app's
  `/api/admin/app-settings`, `sudo bash /opt/servicehub/deploy/update.sh`
  per delivery, Discord notifications on start / success / failure.
- **`servicehub-deploy.service`** — systemd unit. Drop in
  `/etc/systemd/system/`, then `systemctl daemon-reload && systemctl
  enable --now servicehub-deploy`.
- **nginx** — proxies `https://<your-domain>/_deploy` → `127.0.0.1:5055`.
  See the new `location = /_deploy` block in `deploy/nginx.conf.template`.

## One-time install on the VPS

```bash
# 1) Listener env file (chmod 600, owner root) ------------------------
sudo install -m 600 /dev/stdin /etc/servicehub-deploy.env <<'EOF'
GITHUB_WEBHOOK_SECRET=<paste a long random string; reuse on the GH side>
APP_BASE_URL=https://your-domain.example
DEPLOY_DISCORD_WEBHOOK=<optional Discord webhook URL for deploy notifications>
DEPLOY_GATE_TOKEN=<REQUIRED long random string; MUST match DEPLOY_GATE_TOKEN in /opt/servicehub/.env>
DEPLOY_REPO_FULL_NAME=cowboyapps/CowboyMedia-ServiceHub-1.1.0  # defense-in-depth: rejects pushes from any other repo even if HMAC validates
EOF

# 2) Sudoers: allow the servicehub user to run update.sh as root, no pw
sudo install -m 440 /dev/stdin /etc/sudoers.d/servicehub-deploy <<'EOF'
servicehub ALL=(root) NOPASSWD: /usr/bin/bash /opt/servicehub/deploy/update.sh, /usr/bin/bash /opt/servicehub/deploy/update.sh --ref *
EOF
sudo visudo -c   # validate

# 3) Log dir (listener creates this too, but pre-create with right owner)
sudo mkdir -p /var/log/servicehub-deploy
sudo chown servicehub:servicehub /var/log/servicehub-deploy

# 4) Systemd unit
sudo install -m 644 /opt/servicehub/deploy/webhook-listener/servicehub-deploy.service \
  /etc/systemd/system/servicehub-deploy.service
sudo systemctl daemon-reload
sudo systemctl enable --now servicehub-deploy
sudo systemctl status servicehub-deploy --no-pager

# 5) nginx — re-render from template (the /_deploy block is already in it)
#    then reload
sudo nginx -t && sudo systemctl reload nginx

# 6) Smoke test the local socket
curl -sS http://127.0.0.1:5055/health
```

## GitHub side (one-time)

Repo → **Settings → Webhooks → Add webhook**

- **Payload URL**: `https://your-domain.example/_deploy`
- **Content type**: `application/json`
- **Secret**: same value as `GITHUB_WEBHOOK_SECRET` above
- **Events**: "Just the `push` event"
- **Active**: ✓

GitHub posts a `ping` first; the listener replies `pong`. After that, any
push to `main` triggers a deploy.

## Manual sync from Replit → GitHub

Replit does **not** auto-push to GitHub. After you're happy with changes
in the Replit workspace, push manually:

```bash
git add -A && git commit -m "<msg>" && git push origin main
```

That push fires the GitHub webhook → this listener → `update.sh`.

## Pausing deploys (maintenance window)

In the admin portal, **Settings → Deploy** → toggle **Auto-deploy from
GitHub** off. The toggle writes `app_settings.auto_deploy_enabled = false`.
The listener checks this before invoking `update.sh`; pushes during a
pause are acknowledged with a Discord `:no_entry:` notice and dropped
(the next push after re-enabling will deploy the latest commit anyway).

If `DEPLOY_GATE_TOKEN` is **not** configured in
`/etc/servicehub-deploy.env` (or doesn't match the app's `.env`), the
listener fails CLOSED — every push is dropped with a Discord notice and
nothing deploys. This is by design: a misconfigured listener must not
silently bypass the Admin Portal pause toggle.

## Troubleshooting

```bash
# Live listener logs
sudo journalctl -u servicehub-deploy -f

# A specific deploy's log (deliveryId = X-GitHub-Delivery header)
sudo cat /var/log/servicehub-deploy/<deliveryId>.log

# Replay a delivery from the GitHub UI
# Repo → Settings → Webhooks → click the webhook → Recent Deliveries
# → pick a delivery → "Redeliver"
```
