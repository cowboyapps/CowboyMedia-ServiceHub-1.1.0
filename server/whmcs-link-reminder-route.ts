import type { Request, Response } from "express";

// Handler factory for the admin "nudge unlinked customers" action:
//   POST /api/admin/whmcs/link-reminder   body: { includeDismissed?: boolean }
//
// Backs the "Send reminder" button on the Customer Link Adoption card
// (Admin Portal → WHMCS Billing). Sends each eligible unlinked customer a
// reminder to connect their billing account — an in-app bell card and/or an
// email, per that customer's notification prefs (category
// "whmcs_link_reminder"). Customers who dismissed the signup prompt are only
// included when the admin explicitly opts in via includeDismissed.
//
// Throttle contract (the reason this file exists as a tested unit):
//   - A customer reminded within the last LINK_REMINDER_THROTTLE_DAYS is
//     SKIPPED, so repeat button clicks never spam the same person.
//   - The throttle marker (users.whmcs_link_reminder_last_sent_at) is stamped
//     ONLY when at least one channel was actually delivered. A customer whose
//     prefs disable both channels is counted separately and NOT marked, so
//     they become reachable again the moment they re-enable a channel.
//   - Per-customer delivery/marker failures never abort the sweep; that
//     customer is just not counted as notified.
//
// Response (locked shape the frontend confirmation toast reads):
//   { ok: true, notified, skippedThrottled, skippedNoChannel, totalCandidates }

export const LINK_REMINDER_THROTTLE_DAYS = 7;
export const LINK_REMINDER_THROTTLE_MS = LINK_REMINDER_THROTTLE_DAYS * 24 * 60 * 60 * 1000;

export interface LinkReminderCandidate {
  id: string;
  email?: string | null;
  fullName?: string | null;
  whmcsLinkPromptDismissedAt?: Date | null;
  whmcsLinkReminderLastSentAt?: Date | null;
}

export interface LinkReminderRouteDeps {
  /** WHMCS wired up + the customer linking flow switched on. */
  getLinkConfig: () => Promise<{ configured: boolean; enabled: boolean }>;
  /** Unlinked, non-staff customers (dismissed-prompt users included; filtered here). */
  listUnlinkedCustomers: () => Promise<LinkReminderCandidate[]>;
  /** Category prefs — bell card / email wanted for "whmcs_link_reminder"? */
  wantsInApp: (user: LinkReminderCandidate) => boolean;
  wantsEmail: (user: LinkReminderCandidate) => boolean;
  /** Deliver the bell card. Throwing skips only this customer. */
  createInApp: (user: LinkReminderCandidate) => Promise<unknown>;
  /** Deliver the email. Fire-and-forget semantics are fine. */
  sendEmail: (user: LinkReminderCandidate) => unknown;
  /** Stamp users.whmcs_link_reminder_last_sent_at. */
  markReminded: (userId: string, at: Date) => Promise<unknown>;
  logActivity?: (category: string, action: string, opts: { actorId?: string; summary: string }) => void;
  /** Injectable clock for deterministic throttling in tests. */
  now?: () => number;
}

export function createWhmcsLinkReminderHandler(deps: LinkReminderRouteDeps) {
  const now = deps.now ?? Date.now;
  return async (req: Request, res: Response) => {
    try {
      const includeDismissed = req.body?.includeDismissed === true;

      const { configured, enabled } = await deps.getLinkConfig();
      if (!configured || !enabled) {
        return res.status(409).json({ ok: false, message: "WHMCS billing linking is not configured or not enabled." });
      }

      const all = await deps.listUnlinkedCustomers();
      const candidates = all.filter((u) => includeDismissed || !u.whmcsLinkPromptDismissedAt);

      const nowMs = now();
      let notified = 0;
      let skippedThrottled = 0;
      let skippedNoChannel = 0;

      for (const user of candidates) {
        const last = user.whmcsLinkReminderLastSentAt?.getTime();
        if (last != null && nowMs - last < LINK_REMINDER_THROTTLE_MS) {
          skippedThrottled++;
          continue;
        }

        const inApp = deps.wantsInApp(user);
        const email = deps.wantsEmail(user) && !!user.email;
        if (!inApp && !email) {
          // Nothing deliverable — do NOT stamp the marker so a future pref
          // change makes them reachable again immediately.
          skippedNoChannel++;
          continue;
        }

        try {
          if (inApp) await deps.createInApp(user);
          if (email) void deps.sendEmail(user);
          await deps.markReminded(user.id, new Date(nowMs));
          notified++;
        } catch (e) {
          // Per-customer failure: keep sweeping the rest.
          console.error("[whmcs-link-reminder] delivery failed for user", user.id, (e as Error)?.message);
        }
      }

      deps.logActivity?.("admin", "whmcs_link_reminder_sent", {
        actorId: req.session?.userId ?? undefined,
        summary: `Sent billing-link reminders to ${notified} customer${notified === 1 ? "" : "s"} (${skippedThrottled} recently reminded, ${skippedNoChannel} unreachable${includeDismissed ? ", dismissed included" : ""})`,
      });

      res.json({ ok: true, notified, skippedThrottled, skippedNoChannel, totalCandidates: candidates.length });
    } catch (e) {
      res.status(500).json({ ok: false, message: e instanceof Error ? e.message : String(e) });
    }
  };
}
