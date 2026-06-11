// In-app error alerter. Polls error_logs every 60s and posts a Discord
// notification when fatal errors or a 5xx burst appear within the last
// minute. Ensures master admins find out about a production regression
// within ~1 minute.
//
// Detection thresholds (intentionally simple, tunable later):
//   - ANY new error_logs row with severity 'fatal' since last poll
//   - 5+ new 5xx route errors since last poll (catches a burst even if no
//     individual one is fatal)
//
// Behavior:
//   - First poll seeds the cursor without alerting (so a long-running app
//     doesn't blast the channel on listener restart).
//   - One Discord post per cycle, listing distinct route+status pairs.
//   - Failures to send are swallowed (we never want the alerter itself to
//     crash the app).

import { storage } from "./storage";
import { sendDiscordMessage } from "./discord";
import { APP_VERSION } from "@shared/version";

const POLL_INTERVAL_MS = 60_000;
const FIVEXX_BURST_THRESHOLD = 5;

let lastSeenAt: Date | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

async function pollOnce(): Promise<void> {
  try {
    const since = lastSeenAt;
    const { logs: all } = await storage.getErrorLogs({ limit: 200, page: 1 });
    // Filter to rows created since the last poll (or, on a fresh boot,
    // ignore everything pre-existing — we only want to alert on NEW errors).
    const lookback = since ?? new Date(Date.now() - 5 * 60 * 1000);
    const logs = all.filter((l) => new Date(l.createdAt) > lookback);

    // Advance the cursor regardless of alert outcome — we don't want a
    // failing webhook to cause an unbounded backlog.
    if (logs.length > 0) {
      const newest = logs.reduce(
        (acc, l) => (new Date(l.createdAt) > acc ? new Date(l.createdAt) : acc),
        new Date(0),
      );
      lastSeenAt = newest;
    } else if (!lastSeenAt) {
      lastSeenAt = new Date();
    }

    // Don't alert on the first pass — just seed the cursor.
    if (since === null) return;

    const fatals = logs.filter((l) => l.severity === "fatal");
    const fivexx = logs.filter((l) => l.source === "route");

    if (fatals.length === 0 && fivexx.length < FIVEXX_BURST_THRESHOLD) return;

    const lines: string[] = [];
    if (fatals.length > 0) {
      lines.push(`**${fatals.length} FATAL** error${fatals.length === 1 ? "" : "s"}:`);
      for (const f of fatals.slice(0, 5)) {
        lines.push(`• [${f.source}] ${f.summary.slice(0, 200)}`);
      }
    }
    if (fivexx.length >= FIVEXX_BURST_THRESHOLD) {
      lines.push(`**${fivexx.length} 5xx** in last minute:`);
      for (const f of fivexx.slice(0, 5)) {
        lines.push(`• ${f.summary.slice(0, 200)}`);
      }
    }

    await sendDiscordMessage(
      {
        embeds: [
          {
            title: `:rotating_light: ServiceHub error alert (v${APP_VERSION})`,
            description: lines.join("\n"),
          },
        ],
      },
      "alert",
    );
  } catch (e) {
    console.error("[error-alerter] poll failed:", (e as Error)?.message);
  }
}

export function startErrorAlerter(): void {
  if (timer) return;
  timer = setInterval(pollOnce, POLL_INTERVAL_MS);
  // Do the seed pass immediately so the cursor is initialized without
  // waiting a full minute.
  void pollOnce();
}

export function stopErrorAlerter(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  lastSeenAt = null;
}
