// Append one changelog bullet to the **rolling draft on production**, via
// the bearer-token-gated /api/agent/changelog/append route. This is the call
// site the Replit agent uses to satisfy the "auto-append the changelog as we
// work" rule in replit.md — writing straight at the prod DB avoids the
// dev/prod drift that used to leave bullets stranded in the Replit-side
// database.
//
// The changelog now has a single always-open rolling draft; every bullet
// lands there no matter what the current version number is. The caller no
// longer needs to know or send the live version — publishing happens later,
// automatically, when the version number changes.
//
// Usage:
//   tsx script/append-bullet.ts <New|Improved|Fixed> "<one short bullet>"
//
// Env vars (read from .env via the same dotenv plumbing the app uses):
//   CHANGELOG_APPEND_TOKEN  — required. Bearer token; must match the
//                             value set on the VPS in /etc/servicehub.env.
//   CHANGELOG_APPEND_URL    — optional. Defaults to
//                             https://cowboyhub.app/api/agent/changelog
//                             (the script appends `/append`). Override for
//                             staging.
//
// Exits non-zero on any failure (bad args, missing token, non-2xx
// response). The agent treats that as a hard failure and surfaces it.

import "dotenv/config";
import { isBulletHeading } from "../shared/changelog-append";

async function main() {
  const [headingArg, ...rest] = process.argv.slice(2);
  const bullet = rest.join(" ").trim();
  if (!headingArg || !bullet) {
    console.error('Usage: tsx script/append-bullet.ts <New|Improved|Fixed> "<bullet>"');
    process.exit(2);
  }
  if (!isBulletHeading(headingArg)) {
    console.error(`Invalid heading: ${headingArg}. Must be one of: New, Improved, Fixed.`);
    process.exit(2);
  }
  const token = process.env.CHANGELOG_APPEND_TOKEN;
  if (!token) {
    console.error("CHANGELOG_APPEND_TOKEN not set. Add it to Replit Secrets (and mirror to /etc/servicehub.env on the VPS).");
    process.exit(2);
  }
  const base = (process.env.CHANGELOG_APPEND_URL ?? "https://cowboyhub.app/api/agent/changelog").replace(/\/$/, "");
  const url = `${base}/append`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ heading: headingArg, bullet }),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`Append failed: HTTP ${res.status} ${res.statusText}\n${text}`);
    process.exit(1);
  }
  // Echo back the bullet count so the operator can confirm at a glance.
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* tolerated */ }
  const liMatches = typeof parsed?.bodyHtml === "string" ? parsed.bodyHtml.match(/<li\b/gi) : null;
  const count = liMatches ? liMatches.length : "?";
  console.log(`Appended to the rolling changelog draft. Total bullets now: ${count}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
