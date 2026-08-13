import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import {
  createWhmcsLinkReminderHandler,
  LINK_REMINDER_THROTTLE_MS,
  type LinkReminderRouteDeps,
  type LinkReminderCandidate,
} from "./whmcs-link-reminder-route";

// Route-level tests for the admin "nudge unlinked customers" action:
//   POST /api/admin/whmcs/link-reminder
//
// Exercises the PRODUCTION handler factory from
// server/whmcs-link-reminder-route.ts (wired into routes.ts behind
// requireAdmin), not a copy.
//
// Contracts under test:
//   1. Only unlinked customers who have NOT dismissed the prompt are nudged by
//      default; includeDismissed: true widens to dismissed customers too.
//   2. Throttle — a customer reminded within the last 7 days is skipped and
//      never re-delivered to; one reminded longer ago IS re-delivered.
//   3. The throttle marker is stamped ONLY when a channel actually delivered:
//      a customer with both channels off is counted skippedNoChannel and NOT
//      marked.
//   4. Channel routing follows prefs: in-app only, email only, or both. A
//      customer with email pref on but no address on file gets no email.
//   5. Per-customer delivery failure skips that customer without aborting the
//      sweep or stamping their marker.
//   6. Unconfigured/disabled WHMCS → 409, nothing listed or delivered.
//   7. Locked response shape { ok, notified, skippedThrottled,
//      skippedNoChannel, totalCandidates }.

const NOW = Date.UTC(2026, 6, 22, 12, 0, 0);

function makeRes() {
  const out: { status: number; body: any } = { status: 200, body: undefined };
  const res = {
    status(code: number) { out.status = code; return res; },
    json(body: unknown) { out.body = body; return res; },
  } as unknown as Response;
  return { res, out };
}

function makeReq(body?: unknown) {
  return { body: body ?? {}, session: { userId: "admin-1" } } as unknown as Request;
}

interface HarnessOpts {
  customers?: LinkReminderCandidate[];
  configured?: boolean;
  enabled?: boolean;
  wantsInApp?: (u: LinkReminderCandidate) => boolean;
  wantsEmail?: (u: LinkReminderCandidate) => boolean;
  createInAppError?: (u: LinkReminderCandidate) => boolean;
}

function makeHarness(opts: HarnessOpts = {}) {
  const inApp: string[] = [];
  const emails: string[] = [];
  const marked: Array<{ id: string; at: Date }> = [];
  let listed = false;
  const deps: LinkReminderRouteDeps = {
    getLinkConfig: async () => ({ configured: opts.configured ?? true, enabled: opts.enabled ?? true }),
    listUnlinkedCustomers: async () => { listed = true; return opts.customers ?? []; },
    wantsInApp: opts.wantsInApp ?? (() => true),
    wantsEmail: opts.wantsEmail ?? (() => true),
    createInApp: async (u) => {
      if (opts.createInAppError?.(u)) throw new Error("bell down");
      inApp.push(u.id);
    },
    sendEmail: (u) => { emails.push(u.id); },
    markReminded: async (id, at) => { marked.push({ id, at }); },
    now: () => NOW,
  };
  return { deps, inApp, emails, marked, listed: () => listed };
}

function customer(id: string, extra: Partial<LinkReminderCandidate> = {}): LinkReminderCandidate {
  return { id, email: `${id}@example.com`, fullName: id, ...extra };
}

test("default: nudges only never-dismissed unlinked customers; locked shape", async () => {
  const h = makeHarness({
    customers: [
      customer("fresh"),
      customer("dismissed", { whmcsLinkPromptDismissedAt: new Date(NOW - 1000) }),
    ],
  });
  const { res, out } = makeRes();
  await createWhmcsLinkReminderHandler(h.deps)(makeReq(), res);
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { ok: true, notified: 1, skippedThrottled: 0, skippedNoChannel: 0, totalCandidates: 1 });
  assert.deepEqual(Object.keys(out.body).sort(), ["notified", "ok", "skippedNoChannel", "skippedThrottled", "totalCandidates"]);
  assert.deepEqual(h.inApp, ["fresh"]);
  assert.deepEqual(h.emails, ["fresh"]);
  assert.deepEqual(h.marked.map((m) => m.id), ["fresh"]);
});

test("includeDismissed: true widens to dismissed customers", async () => {
  const h = makeHarness({
    customers: [
      customer("fresh"),
      customer("dismissed", { whmcsLinkPromptDismissedAt: new Date(NOW - 1000) }),
    ],
  });
  const { res, out } = makeRes();
  await createWhmcsLinkReminderHandler(h.deps)(makeReq({ includeDismissed: true }), res);
  assert.equal(out.body.notified, 2);
  assert.equal(out.body.totalCandidates, 2);
  assert.deepEqual(h.inApp.sort(), ["dismissed", "fresh"]);
});

test("throttle: reminded within 7 days is skipped; older than 7 days re-delivers", async () => {
  const h = makeHarness({
    customers: [
      customer("recent", { whmcsLinkReminderLastSentAt: new Date(NOW - LINK_REMINDER_THROTTLE_MS + 60_000) }),
      customer("stale", { whmcsLinkReminderLastSentAt: new Date(NOW - LINK_REMINDER_THROTTLE_MS - 60_000) }),
    ],
  });
  const { res, out } = makeRes();
  await createWhmcsLinkReminderHandler(h.deps)(makeReq(), res);
  assert.deepEqual(out.body, { ok: true, notified: 1, skippedThrottled: 1, skippedNoChannel: 0, totalCandidates: 2 });
  assert.deepEqual(h.inApp, ["stale"]);
  assert.deepEqual(h.marked.map((m) => m.id), ["stale"]);
});

test("marker stamped with the sweep clock", async () => {
  const h = makeHarness({ customers: [customer("a")] });
  const { res } = makeRes();
  await createWhmcsLinkReminderHandler(h.deps)(makeReq(), res);
  assert.equal(h.marked[0].at.getTime(), NOW);
});

test("both channels off: counted skippedNoChannel and NOT marked", async () => {
  const h = makeHarness({
    customers: [customer("optout"), customer("reachable")],
    wantsInApp: (u) => u.id !== "optout",
    wantsEmail: (u) => u.id !== "optout",
  });
  const { res, out } = makeRes();
  await createWhmcsLinkReminderHandler(h.deps)(makeReq(), res);
  assert.deepEqual(out.body, { ok: true, notified: 1, skippedThrottled: 0, skippedNoChannel: 1, totalCandidates: 2 });
  assert.deepEqual(h.marked.map((m) => m.id), ["reachable"]);
});

test("channel routing: in-app only / email only / email pref without address", async () => {
  const h = makeHarness({
    customers: [
      customer("bell-only"),
      customer("mail-only"),
      customer("no-address", { email: null }),
    ],
    wantsInApp: (u) => u.id !== "mail-only",
    wantsEmail: (u) => u.id !== "bell-only",
  });
  const { res, out } = makeRes();
  await createWhmcsLinkReminderHandler(h.deps)(makeReq(), res);
  // no-address still gets the bell card (in-app pref on), just no email.
  assert.deepEqual(h.inApp.sort(), ["bell-only", "no-address"]);
  assert.deepEqual(h.emails, ["mail-only"]);
  assert.equal(out.body.notified, 3);
});

test("per-customer delivery failure: skipped without marker, sweep continues", async () => {
  const h = makeHarness({
    customers: [customer("boom"), customer("ok")],
    createInAppError: (u) => u.id === "boom",
  });
  const { res, out } = makeRes();
  await createWhmcsLinkReminderHandler(h.deps)(makeReq(), res);
  assert.equal(out.status, 200);
  assert.equal(out.body.notified, 1);
  assert.deepEqual(h.marked.map((m) => m.id), ["ok"]);
});

test("unconfigured WHMCS: 409 and the customer list is never loaded", async () => {
  const h = makeHarness({ configured: false });
  const { res, out } = makeRes();
  await createWhmcsLinkReminderHandler(h.deps)(makeReq(), res);
  assert.equal(out.status, 409);
  assert.equal(out.body.ok, false);
  assert.equal(h.listed(), false);
});

test("configured but disabled: 409", async () => {
  const h = makeHarness({ enabled: false });
  const { res, out } = makeRes();
  await createWhmcsLinkReminderHandler(h.deps)(makeReq(), res);
  assert.equal(out.status, 409);
});

test("listing failure surfaces as 500", async () => {
  const h = makeHarness({});
  h.deps.listUnlinkedCustomers = async () => { throw new Error("db down"); };
  const { res, out } = makeRes();
  await createWhmcsLinkReminderHandler(h.deps)(makeReq(), res);
  assert.equal(out.status, 500);
  assert.deepEqual(out.body, { ok: false, message: "db down" });
});
