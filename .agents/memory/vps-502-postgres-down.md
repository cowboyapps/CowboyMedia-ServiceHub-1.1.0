---
name: VPS 502 diagnosis
description: How to diagnose production 502s on the self-hosted VPS; Postgres death is a prime suspect and the app doesn't retry DB connects at boot.
---

# VPS 502 diagnosis

Rule: a production 502 with the deploy listener healthy (`https://cowboyhub.app/_deploy/health` returns ok) means the PM2 app process is down, not nginx/deploy. First suspect infrastructure (Postgres, disk, OOM) before blaming the latest deploy/migration.

**Why:** Aug 14, 2026 outage: Postgres died on the VPS (`ECONNREFUSED 127.0.0.1:5432`); the app crash-looped until PM2 gave up and stayed down even after Postgres was restored — needed manual `pm2 restart servicehub`. The push that had just gone out was innocent.

**How to apply:**
- From workspace: `curl https://cowboyhub.app/api/health` (app) vs `/_deploy/health` (listener). Authenticated listener endpoints need DEPLOY_GATE_TOKEN, which is NOT a workspace secret — ask the user for Discord deploy message or SSH output instead.
- Ask user to run: `sudo -u servicehub pm2 logs servicehub --lines 60 --nostream`, `sudo systemctl status postgresql`, `df -h`, `dmesg | grep -i oom`.
- Boot has no DB-connect retry (see follow-up task about reconnect-with-backoff); until fixed, app needs manual restart after any DB outage.
- Scanner noise in logs (`GET /api/.env 200` etc.) is the SPA catch-all answering bots — not a leak.
