#!/usr/bin/env node
// GitHub → VPS deploy webhook listener.
//
// Listens on 127.0.0.1:5055 (nginx proxies /_deploy/ → here). Validates the
// HMAC-SHA256 signature, gates on the master_admin auto-deploy kill-switch,
// then exec's `sudo bash /opt/servicehub/deploy/update.sh` and pings the
// configured Discord webhook with the outcome.
//
// Required env (read from /etc/servicehub-deploy.env via systemd):
//   GITHUB_WEBHOOK_SECRET     - matches the secret you set on the repo webhook
//   APP_BASE_URL              - e.g. https://servicehub.example.com (for the
//                                kill-switch check + Discord URL discovery)
//   DEPLOY_DISCORD_WEBHOOK    - optional; if set, deploy outcomes are posted
//   DEPLOY_GATE_TOKEN         - REQUIRED. Bearer token for the kill-switch
//                                endpoint. Must match DEPLOY_GATE_TOKEN in
//                                the app's .env. Without it the gate fails
//                                CLOSED and no deploys run — by design, so a
//                                misconfigured listener can't bypass the
//                                Admin Portal pause toggle.
//
// The listener never has DB credentials and never touches the DB directly —
// the kill-switch is read over HTTP from the running app, so the source of
// truth stays in app_settings.
//
// Process model: short-lived spawn of update.sh per delivery. The script
// streams to a per-deploy log under /var/log/servicehub-deploy/<id>.log so
// the next request can fetch it via /_deploy/log/<id> for tail-in-Discord.

import http from "node:http";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PORT = 5055;
const HOST = "127.0.0.1";
const SECRET = process.env.GITHUB_WEBHOOK_SECRET || "";
const APP_BASE_URL = process.env.APP_BASE_URL || "http://127.0.0.1:5000";
const DISCORD_URL = process.env.DEPLOY_DISCORD_WEBHOOK || "";
const GATE_TOKEN = process.env.DEPLOY_GATE_TOKEN || "";
const LOG_DIR = "/var/log/servicehub-deploy";
const UPDATE_SCRIPT = "/opt/servicehub/deploy/update.sh";

if (!SECRET) {
  console.error("FATAL: GITHUB_WEBHOOK_SECRET is required");
  process.exit(1);
}

fs.mkdirSync(LOG_DIR, { recursive: true });

// Constant-time HMAC compare. GitHub sends `sha256=<hex>` in X-Hub-Signature-256.
function verifySignature(rawBody, header) {
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", SECRET).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function isAutoDeployEnabled() {
  // FAIL-CLOSED. If the gate token isn't configured or the app can't be
  // reached, refuse to deploy — a silent fail-open here would defeat the
  // Admin Portal pause toggle. Operators who want a permanent green light
  // should set DEPLOY_GATE_TOKEN and keep the toggle enabled.
  if (!GATE_TOKEN) {
    return { ok: false, reason: "DEPLOY_GATE_TOKEN not configured on listener (fail-closed)" };
  }
  try {
    const res = await fetch(`${APP_BASE_URL}/api/admin/app-settings`, {
      headers: { Authorization: `Bearer ${GATE_TOKEN}` },
    });
    if (!res.ok) {
      return { ok: false, reason: `app gate returned HTTP ${res.status} (fail-closed)` };
    }
    const j = await res.json();
    return { ok: !!j.autoDeployEnabled, reason: j.autoDeployPausedReason || null };
  } catch (e) {
    return { ok: false, reason: `app gate unreachable: ${e?.message || "error"} (fail-closed)` };
  }
}

async function notifyDiscord(content) {
  if (!DISCORD_URL) return;
  try {
    await fetch(DISCORD_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
  } catch (e) {
    console.error("[discord] notify failed:", e?.message);
  }
}

function runDeploy(ref, deliveryId) {
  return new Promise((resolve) => {
    const logPath = path.join(LOG_DIR, `${deliveryId}.log`);
    const out = fs.createWriteStream(logPath);
    const args = ["bash", UPDATE_SCRIPT];
    if (ref) args.push("--ref", ref);
    const startedAt = Date.now();
    const child = spawn("sudo", args, { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.pipe(out);
    child.stderr.pipe(out);
    child.on("close", (code) => {
      out.end();
      resolve({ code, logPath, durationMs: Date.now() - startedAt });
    });
  });
}

function fmtDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${s % 60}s`;
}

// update.sh prints "==> Health check OK" / "==> Update complete" lines on
// success and a "Rolled back to <sha>" line on failure-with-rollback. We
// echo the most informative of those into the Discord notification so the
// reader can tell at a glance whether verification passed.
function extractVerificationOutcome(logText) {
  const lines = logText.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (/Update complete:|Health check OK|Rolled back to|gitSha matches|gitSha mismatch/.test(l)) {
      return l.trim();
    }
  }
  return null;
}

const server = http.createServer((req, res) => {
  // Health probe for nginx + smoke checks.
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }

  // Tail of the most recent deploy log for Discord deep-link.
  if (req.method === "GET" && req.url?.startsWith("/log/")) {
    const id = req.url.slice(5).replace(/[^a-zA-Z0-9_-]/g, "");
    const p = path.join(LOG_DIR, `${id}.log`);
    if (!fs.existsSync(p)) {
      res.writeHead(404);
      return res.end("not found");
    }
    res.writeHead(200, { "Content-Type": "text/plain" });
    return fs.createReadStream(p).pipe(res);
  }

  if (req.method !== "POST" || req.url !== "/") {
    res.writeHead(404);
    return res.end("not found");
  }

  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", async () => {
    const raw = Buffer.concat(chunks);
    const sig = req.headers["x-hub-signature-256"];
    if (!verifySignature(raw, sig)) {
      console.warn("[webhook] bad signature from", req.socket.remoteAddress);
      res.writeHead(401);
      return res.end("bad signature");
    }

    const event = req.headers["x-github-event"];
    const deliveryId = (req.headers["x-github-delivery"] || crypto.randomUUID()).toString();

    if (event === "ping") {
      res.writeHead(200);
      return res.end("pong");
    }
    if (event !== "push") {
      res.writeHead(204);
      return res.end();
    }

    let payload;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      res.writeHead(400);
      return res.end("bad json");
    }

    // Only deploy on push to main.
    if (payload.ref !== "refs/heads/main") {
      res.writeHead(204);
      return res.end();
    }

    const sha = payload.after;
    const author = payload.head_commit?.author?.name || "unknown";
    const message = (payload.head_commit?.message || "").split("\n")[0];

    // Kill-switch gate. Behavior is DROP, not queue: the next push after
    // re-enabling will deploy whatever HEAD is on `main` at that point,
    // which is always at least as new as the dropped commit. Queueing
    // would risk replaying a stale SHA after the operator has moved on.
    const gate = await isAutoDeployEnabled();
    if (!gate.ok) {
      const note = `Auto-deploy paused${gate.reason ? `: ${gate.reason}` : ""}. SHA \`${sha.slice(0, 7)}\` was DROPPED (not queued — push again after resuming).`;
      console.log("[webhook] gated:", note);
      await notifyDiscord(`:no_entry: ${note}`);
      res.writeHead(202);
      return res.end("paused");
    }

    // Ack immediately — GitHub times out at 10s and update.sh takes minutes.
    res.writeHead(202, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ deliveryId, sha }));

    await notifyDiscord(`:rocket: Deploying \`${sha.slice(0, 7)}\` by ${author}\n> ${message}`);
    const { code, logPath, durationMs } = await runDeploy(sha, deliveryId);
    const logText = fs.readFileSync(logPath, "utf8");
    const verification = extractVerificationOutcome(logText) || "(no verification line found in log)";
    if (code === 0) {
      await notifyDiscord(
        `:white_check_mark: Deploy \`${sha.slice(0, 7)}\` succeeded in ${fmtDuration(durationMs)}.\nVerification: \`${verification}\``,
      );
    } else {
      const tail = logText.split("\n").slice(-20).join("\n");
      await notifyDiscord(
        `:x: Deploy \`${sha.slice(0, 7)}\` FAILED (exit ${code}) after ${fmtDuration(durationMs)}.\nVerification: \`${verification}\`\nLast 20 lines:\n\`\`\`\n${tail.slice(-1400)}\n\`\`\``,
      );
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[webhook] listening on ${HOST}:${PORT}`);
});
