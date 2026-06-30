// Read-only production verification for the "a new service was added to your
// account" notifier (the direct-in-WHMCS order path) and its interplay with the
// store "ready" path.
//
// WHY THIS EXISTS: the detection logic is unit-tested with injected deps, but
// the Replit dev environment's IP cannot reach WHMCS, so the real
// poll -> DB -> popup/bell/push path is never exercised there. WHMCS IS
// reachable from the VPS, so this script is meant to be RUN ON THE VPS to
// confirm the end-to-end wiring against a real linked customer.
//
// It is strictly READ-ONLY: it loads the customer's live WHMCS services, reads
// the persisted markers / baseline / pending orders / announcements / bell rows,
// and PREDICTS what the next notifier pass would do — it never writes a marker,
// announcement, baseline, or notification. So it is safe to run against prod and
// will not itself fire (or suppress) a real customer notification.
//
// Usage (on the VPS, with the app env sourced):
//   sudo -u servicehub bash -c 'cd /opt/servicehub && set -a; source .env; set +a; \
//     ./node_modules/.bin/tsx script/verify-service-added-notify.ts <email|client=<id>>'
//
// Example:
//   tsx script/verify-service-added-notify.ts customer@example.com
//   tsx script/verify-service-added-notify.ts client=1234

import { storage } from "../server/storage";
import { hasWhmcsCredentials, normalizeBaseUrl } from "../server/whmcs";
import { loadServicesList } from "../server/whmcs-billing";
import {
  planServiceNotifications,
  serviceLabel,
  type ServiceNotifyCandidate,
} from "@shared/whmcs-service-notify";

const RENEW_SOON_DAYS = 7;

function fail(msg: string): never {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    fail(
      "Pass a target customer: an email (customer@example.com) or client=<whmcsClientId>.",
    );
  }

  console.log("=== WHMCS \"new service added\" verification (READ-ONLY) ===\n");

  // 1) Config: is WHMCS actually active in this environment?
  const settings = await storage.getWhmcsSettings();
  const baseUrl = normalizeBaseUrl(settings?.baseUrl ?? null);
  const hasCreds = hasWhmcsCredentials();
  const active = hasCreds && !!baseUrl && !!settings?.enabled;
  console.log("WHMCS config:");
  console.log(`  credentials present : ${hasCreds ? "yes" : "no"}`);
  console.log(`  base URL            : ${baseUrl ?? "(none)"}`);
  console.log(`  enabled flag        : ${settings?.enabled ? "yes" : "no"}`);
  console.log(`  => notifier active  : ${active ? "YES" : "NO"}\n`);
  if (!active) {
    fail(
      "WHMCS is not active here (missing creds / base URL / enabled). The notifier no-ops. " +
        "Run this on the VPS with prod env, and confirm Admin Portal -> WHMCS Billing is enabled.",
    );
  }

  // 2) Resolve the target linked customer.
  const all = await storage.getAllUsers();
  const linked = all.filter((u) => u.whmcsClientId != null);
  let user;
  if (arg.startsWith("client=")) {
    const cid = Number(arg.slice("client=".length));
    user = linked.find((u) => u.whmcsClientId === cid);
  } else {
    const email = arg.trim().toLowerCase();
    user = linked.find((u) => (u.email ?? "").toLowerCase() === email);
  }
  if (!user) {
    fail(
      `No LINKED customer found for "${arg}". The customer must have users.whmcs_client_id set ` +
        `(Admin Portal -> Users -> WHMCS link). Linked customers: ${linked.length}.`,
    );
  }
  console.log("Target customer:");
  console.log(`  id              : ${user.id}`);
  console.log(`  email           : ${user.email ?? "(none)"}`);
  console.log(`  whmcsClientId   : ${user.whmcsClientId}\n`);

  // 3) Load the customer's live WHMCS services (the real network hop).
  const list = await loadServicesList(user.whmcsClientId!);
  if (list.unreachable) {
    fail(
      "WHMCS was UNREACHABLE for this client (network blocked or API role lacks product-read perm). " +
        "The notifier skips this customer with no marker write and retries next pass. " +
        "On the VPS this should be reachable — check the API IP allowlist / role permissions.",
    );
  }
  const services = list.services as unknown as ServiceNotifyCandidate[];
  console.log(`WHMCS reachable. Services returned: ${services.length}`);
  for (const s of services) {
    console.log(
      `  - serviceId=${s.id} pid=${(s as any).pid ?? "?"} status=${s.status} ` +
        `due=${s.nextDueDate ?? "-"} name="${serviceLabel(s)}"`,
    );
  }
  console.log("");

  // 4) Persisted state behind the detection.
  const baselined = await storage.getWhmcsServiceBaselined(user.id);
  const markers = await storage.getWhmcsServiceNotifyState(user.id);
  const pending = await storage.getUnfulfilledWhmcsPendingOrders(user.id);
  const announcements = await storage.getUndismissedWhmcsServiceAnnouncements(user.id);
  const bell = await storage.getUserNotifications(user.id, 200, 0);
  const addedBell = bell.filter((n) => n.type === "whmcs_service_added");
  const readyBell = bell.filter((n) => n.type === "whmcs_service_ready");

  console.log("Persisted state:");
  console.log(`  customer baselined?            : ${baselined ? "YES" : "NO (next pass baselines silently)"}`);
  console.log(`  service markers (last-seen)    : ${Object.keys(markers).length}`);
  console.log(`  unfulfilled pending orders     : ${pending.length}` +
    (pending.length ? ` [pids: ${pending.map((p) => p.whmcsProductId).join(", ")}]` : ""));
  console.log(`  undismissed "added" popups     : ${announcements.length}` +
    (announcements.length ? ` [serviceIds: ${announcements.map((a) => a.whmcsServiceId).join(", ")}]` : ""));
  console.log(`  bell rows: added=${addedBell.length} ready=${readyBell.length}\n`);

  // 5) Predict the next pass.
  const today = new Date().toISOString().slice(0, 10);
  const plans = planServiceNotifications(services, markers, today, RENEW_SOON_DAYS);
  const firstSightings = plans.filter((p) => p.isBaseline);
  const pendingToActive = plans.filter(
    (p) => !p.isBaseline && p.status === "active" && p.prev?.lastSeenStatus === "pending",
  );

  console.log("Prediction for the NEXT notifier pass:");
  if (!baselined) {
    console.log(
      "  This customer is NOT yet baselined -> EVERY first-sighting is recorded SILENTLY " +
        "(no popup/bell/push), then the customer is marked baselined. This is the expected " +
        "behavior for a pre-existing customer's first poll.\n",
    );
  }

  for (const p of firstSightings) {
    const pid = (p.service as any).pid as number | undefined;
    const matchedOrder = pid != null && pending.some((o) => o.whmcsProductId === pid);
    if (!baselined) {
      console.log(`  serviceId=${p.service.id}: first sighting -> SILENT baseline (customer not baselined yet)`);
    } else {
      console.log(
        `  serviceId=${p.service.id}: first sighting on a baselined customer -> WOULD FIRE "added" ` +
          `(1 popup + 1 bell + push if opted-in).` +
          (matchedOrder
            ? ` Also matches a pending order (pid=${pid}) -> that order is CONSUMED so "ready" can't double-fire.`
            : ""),
      );
    }
  }

  for (const p of pendingToActive) {
    const pid = (p.service as any).pid as number | undefined;
    const matchedOrder = pid != null && pending.some((o) => o.whmcsProductId === pid);
    console.log(
      `  serviceId=${p.service.id}: pending->active transition -> ` +
        (matchedOrder
          ? `WOULD FIRE "ready" (store order path; matches pending pid=${pid}). NOT "added".`
          : `no matching pending order -> no "ready" (and not a first sighting, so no "added").`),
    );
  }

  if (firstSightings.length === 0 && pendingToActive.length === 0) {
    console.log("  Nothing new to announce: no first-sightings and no pending->active transitions.");
  }

  console.log(
    "\nNote: this predicts + reports server-side truth only. Push DELIVERY to a real device " +
      "still depends on the customer's opt-in for the \"new service added\" category and quiet hours, " +
      "and must be eyeballed on the device.\n",
  );

  console.log("Verification checklist:");
  console.log("  [ ] Run BEFORE the test order: confirm WHMCS reachable + the target service is absent.");
  console.log("  [ ] Place a DIRECT order in WHMCS for this client (outside the ServiceHub store).");
  console.log("  [ ] Wait for the next poll (<=5 min) or restart the app to force a pass.");
  console.log("  [ ] Re-run: confirm exactly ONE \"added\" popup + ONE bell row for the new serviceId.");
  console.log("  [ ] Confirm the device received exactly one push (if opted-in).");
  console.log("  [ ] Separately, a STORE order should produce a \"ready\" bell, NOT an \"added\" one.");
  console.log("  [ ] On a pre-existing customer's first poll, confirm pre-existing services stay SILENT.\n");

  process.exit(0);
}

main().catch((e) => {
  console.error("verify-service-added-notify failed:", e);
  process.exit(1);
});
