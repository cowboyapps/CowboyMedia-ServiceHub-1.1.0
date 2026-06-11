import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runWhmcsTicketNotifyPass,
  type WhmcsNotifierDeps,
  type NotifierUser,
  type NotifierTicket,
} from "../server/whmcs-ticket-notifier";
import type { SeenMap } from "../shared/whmcs-unread";

// A fixed "now" so the recency cutoff is deterministic. RECENCY_WINDOW_DAYS is 3,
// so the cutoff (in shared/whmcs-notify.ts) is 2026-06-08.
const NOW = () => new Date("2026-06-11T12:00:00Z");

const mkUser = (over: Partial<NotifierUser> = {}): NotifierUser => ({
  id: "u1",
  email: "user@example.com",
  fullName: "Test User",
  whmcsClientId: 100,
  notificationPrefs: null,
  role: "customer",
  ...over,
});

const mkTicket = (over: Partial<NotifierTicket> = {}): NotifierTicket => ({
  id: 1,
  statusKey: "answered",
  lastReply: "2026-06-10",
  subject: "Invoice question",
  ...over,
});

interface Recorder {
  pushes: Array<{ userId: string; ticketId: number }>;
  emails: Array<{ userId: string; ticketId: number }>;
  recorded: Array<{ userId: string; ticketId: number; date: string }>;
  loads: Array<{ clientId: number }>;
}

/**
 * Build a fully-faked deps object with sensible defaults. State maps let
 * `recordNotified` feed back into `getNotifyState` so multi-pass dedupe works.
 */
function makeDeps(opts: {
  active?: boolean;
  baseUrl?: string | null;
  users?: NotifierUser[];
  ticketsByClient?: Record<number, NotifierTicket[]>;
  unreachableClients?: Set<number>;
  notifyState?: Record<string, SeenMap>;
  wantsPush?: boolean;
  wantsEmail?: boolean;
  getConfigThrows?: boolean;
  getLinkedUsersThrows?: boolean;
}): { deps: WhmcsNotifierDeps; rec: Recorder; state: Record<string, SeenMap> } {
  const rec: Recorder = { pushes: [], emails: [], recorded: [], loads: [] };
  const state: Record<string, SeenMap> = JSON.parse(JSON.stringify(opts.notifyState ?? {}));
  const unreachable = opts.unreachableClients ?? new Set<number>();

  const deps: WhmcsNotifierDeps = {
    now: NOW,
    getConfig: async () => {
      if (opts.getConfigThrows) throw new Error("config boom");
      return { active: opts.active ?? true, baseUrl: opts.baseUrl ?? "https://cowboyhub.app" };
    },
    getLinkedUsers: async () => {
      if (opts.getLinkedUsersThrows) throw new Error("users boom");
      return opts.users ?? [];
    },
    loadTickets: async (clientId) => {
      rec.loads.push({ clientId });
      if (unreachable.has(clientId)) return { tickets: [], unreachable: true };
      return { tickets: (opts.ticketsByClient ?? {})[clientId] ?? [], unreachable: false };
    },
    getNotifyState: async (userId) => state[userId] ?? {},
    recordNotified: async (userId, ticketId, date) => {
      rec.recorded.push({ userId, ticketId, date });
      state[userId] = { ...(state[userId] ?? {}), [String(ticketId)]: date };
    },
    sendPush: (user, ticket) => rec.pushes.push({ userId: user.id, ticketId: ticket.id }),
    sendEmail: (user, ticket) => rec.emails.push({ userId: user.id, ticketId: ticket.id }),
    wantsPush: () => opts.wantsPush ?? true,
    wantsEmail: () => opts.wantsEmail ?? true,
  };

  return { deps, rec, state };
}

test("no-op when WHMCS is inactive: no loads, no sends, no markers", async () => {
  const { deps, rec } = makeDeps({
    active: false,
    users: [mkUser()],
    ticketsByClient: { 100: [mkTicket()] },
  });
  const result = await runWhmcsTicketNotifyPass(deps);
  assert.equal(result.active, false);
  assert.equal(result.usersScanned, 0);
  assert.equal(result.ticketsNotified, 0);
  assert.equal(rec.loads.length, 0);
  assert.equal(rec.pushes.length, 0);
  assert.equal(rec.emails.length, 0);
  assert.equal(rec.recorded.length, 0);
});

test("getConfig throwing is swallowed and reported inactive (no sends)", async () => {
  const { deps, rec } = makeDeps({
    getConfigThrows: true,
    users: [mkUser()],
    ticketsByClient: { 100: [mkTicket()] },
  });
  const result = await runWhmcsTicketNotifyPass(deps);
  assert.equal(result.active, false);
  assert.equal(rec.loads.length, 0);
  assert.equal(rec.pushes.length, 0);
});

test("getLinkedUsers throwing yields active pass with nothing scanned", async () => {
  const { deps, rec } = makeDeps({ getLinkedUsersThrows: true });
  const result = await runWhmcsTicketNotifyPass(deps);
  assert.equal(result.active, true);
  assert.equal(result.usersScanned, 0);
  assert.equal(rec.loads.length, 0);
});

test("skips users with no linked client id (not scanned, not loaded)", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "nolink", whmcsClientId: null }), mkUser({ id: "linked", whmcsClientId: 100 })],
    ticketsByClient: { 100: [mkTicket()] },
  });
  const result = await runWhmcsTicketNotifyPass(deps);
  assert.equal(result.usersScanned, 1);
  assert.deepEqual(rec.loads, [{ clientId: 100 }]);
  assert.deepEqual(rec.recorded.map((r) => r.userId), ["linked"]);
});

test("unreachable WHMCS for a user → no marker written (retries next pass)", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    ticketsByClient: { 100: [mkTicket()] },
    unreachableClients: new Set([100]),
  });
  const result = await runWhmcsTicketNotifyPass(deps);
  assert.equal(result.usersScanned, 1);
  assert.equal(result.ticketsNotified, 0);
  assert.equal(rec.pushes.length, 0);
  assert.equal(rec.emails.length, 0);
  assert.equal(rec.recorded.length, 0);
});

test("a qualifying reply fires push AND email, then records a marker", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    ticketsByClient: { 100: [mkTicket({ id: 7, lastReply: "2026-06-10" })] },
    wantsPush: true,
    wantsEmail: true,
  });
  const result = await runWhmcsTicketNotifyPass(deps);
  assert.equal(result.ticketsNotified, 1);
  assert.deepEqual(rec.pushes, [{ userId: "u1", ticketId: 7 }]);
  assert.deepEqual(rec.emails, [{ userId: "u1", ticketId: 7 }]);
  assert.deepEqual(rec.recorded, [{ userId: "u1", ticketId: 7, date: "2026-06-10" }]);
});

test("channel gating: push-off + email-on sends only email, still records marker", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    ticketsByClient: { 100: [mkTicket({ id: 7 })] },
    wantsPush: false,
    wantsEmail: true,
  });
  const result = await runWhmcsTicketNotifyPass(deps);
  assert.equal(result.ticketsNotified, 1);
  assert.equal(rec.pushes.length, 0);
  assert.deepEqual(rec.emails, [{ userId: "u1", ticketId: 7 }]);
  assert.equal(rec.recorded.length, 1);
});

test("email gated off when user has no email address, even if wantsEmail=true", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100, email: null })],
    ticketsByClient: { 100: [mkTicket({ id: 7 })] },
    wantsPush: false,
    wantsEmail: true,
  });
  const result = await runWhmcsTicketNotifyPass(deps);
  assert.equal(result.ticketsNotified, 0);
  assert.equal(rec.emails.length, 0);
  assert.equal(rec.recorded.length, 1); // marker still recorded so it won't replay
});

test("both channels off still records the marker (no replay later) and counts nothing", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    ticketsByClient: { 100: [mkTicket({ id: 7 })] },
    wantsPush: false,
    wantsEmail: false,
  });
  const result = await runWhmcsTicketNotifyPass(deps);
  assert.equal(result.ticketsNotified, 0);
  assert.equal(rec.pushes.length, 0);
  assert.equal(rec.emails.length, 0);
  assert.deepEqual(rec.recorded, [{ userId: "u1", ticketId: 7, date: "2026-06-10" }]);
});

test("dedupe across two consecutive passes: second pass sends nothing", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    ticketsByClient: { 100: [mkTicket({ id: 7, lastReply: "2026-06-10" })] },
  });

  const first = await runWhmcsTicketNotifyPass(deps);
  assert.equal(first.ticketsNotified, 1);
  assert.equal(rec.pushes.length, 1);
  assert.equal(rec.recorded.length, 1);

  const second = await runWhmcsTicketNotifyPass(deps);
  assert.equal(second.ticketsNotified, 0);
  assert.equal(rec.pushes.length, 1); // unchanged
  assert.equal(rec.emails.length, 1); // unchanged
  assert.equal(rec.recorded.length, 1); // unchanged
});

test("a newer staff reply after a prior pass re-notifies", async () => {
  const tickets = { 100: [mkTicket({ id: 7, lastReply: "2026-06-09" })] };
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    ticketsByClient: tickets,
  });

  await runWhmcsTicketNotifyPass(deps);
  assert.equal(rec.pushes.length, 1);

  // Staff replies again on a later day.
  tickets[100][0].lastReply = "2026-06-10";
  await runWhmcsTicketNotifyPass(deps);
  assert.equal(rec.pushes.length, 2);
  assert.deepEqual(rec.recorded.map((r) => r.date), ["2026-06-09", "2026-06-10"]);
});

test("recency guard: an old answered ticket (before cutoff) is not notified on first pass", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    ticketsByClient: { 100: [mkTicket({ id: 7, lastReply: "2026-06-01" })] },
  });
  const result = await runWhmcsTicketNotifyPass(deps);
  assert.equal(result.ticketsNotified, 0);
  assert.equal(rec.pushes.length, 0);
  assert.equal(rec.recorded.length, 0);
});

test("a throw for one user does not abort the pass for the rest", async () => {
  const { deps, rec, state } = makeDeps({
    users: [mkUser({ id: "boom", whmcsClientId: 100 }), mkUser({ id: "ok", whmcsClientId: 200 })],
    ticketsByClient: { 200: [mkTicket({ id: 9 })] },
  });
  // Make getNotifyState explode for the first user only.
  const realGetState = deps.getNotifyState;
  deps.getNotifyState = async (userId) => {
    if (userId === "boom") throw new Error("state boom");
    return realGetState(userId);
  };

  const result = await runWhmcsTicketNotifyPass(deps);
  assert.equal(result.usersScanned, 2);
  assert.equal(result.ticketsNotified, 1);
  assert.deepEqual(rec.recorded, [{ userId: "ok", ticketId: 9, date: "2026-06-10" }]);
  assert.deepEqual(rec.pushes, [{ userId: "ok", ticketId: 9 }]);
  // First user wrote nothing.
  assert.equal(state["boom"], undefined);
});

test("multiple users each handled independently in one pass", async () => {
  const { deps, rec } = makeDeps({
    users: [
      mkUser({ id: "a", whmcsClientId: 100 }),
      mkUser({ id: "b", whmcsClientId: 200 }),
    ],
    ticketsByClient: {
      100: [mkTicket({ id: 1 })],
      200: [mkTicket({ id: 2 }), mkTicket({ id: 3, lastReply: "2026-06-01" })], // 3 too old
    },
  });
  const result = await runWhmcsTicketNotifyPass(deps);
  assert.equal(result.usersScanned, 2);
  assert.equal(result.ticketsNotified, 2);
  assert.deepEqual(rec.recorded.map((r) => `${r.userId}:${r.ticketId}`).sort(), ["a:1", "b:2"]);
});
