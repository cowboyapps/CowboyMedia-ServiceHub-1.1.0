import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runWhmcsInvoiceNotifyPass,
  DUE_SOON_DAYS,
  type WhmcsInvoiceNotifierDeps,
  type InvoiceNotifierUser,
  type NotifierInvoice,
} from "../server/whmcs-invoice-notifier";
import type { InvoiceStage, InvoiceStageMap } from "../shared/whmcs-invoice-notify";

// Fixed "now" so stage thresholds are deterministic. DUE_SOON_DAYS is 3, so the
// due-soon window on 2026-06-11 is [2026-06-11 .. 2026-06-14].
const NOW = () => new Date("2026-06-11T12:00:00Z");

const mkUser = (over: Partial<InvoiceNotifierUser> = {}): InvoiceNotifierUser => ({
  id: "u1",
  email: "user@example.com",
  fullName: "Test User",
  whmcsClientId: 100,
  notificationPrefs: null,
  role: "customer",
  ...over,
});

const mkInvoice = (over: Partial<NotifierInvoice> = {}): NotifierInvoice => ({
  id: 1,
  status: "unpaid",
  dueDate: "2026-06-13", // due_soon
  invoiceNum: "1234",
  balance: "10.00",
  total: "10.00",
  currencyCode: "USD",
  payUrl: "https://cowboymedia.net/billing/viewinvoice.php?id=1",
  ...over,
});

interface Recorder {
  inApp: Array<{ userId: string; invoiceId: number; stage: InvoiceStage }>;
  pushes: Array<{ userId: string; invoiceId: number; stage: InvoiceStage; notificationId: string | null }>;
  emails: Array<{ userId: string; invoiceId: number; stage: InvoiceStage }>;
  recorded: Array<{ userId: string; invoiceId: number; stage: InvoiceStage }>;
  loads: Array<{ clientId: number }>;
}

function makeDeps(opts: {
  active?: boolean;
  baseUrl?: string | null;
  users?: InvoiceNotifierUser[];
  invoicesByClient?: Record<number, NotifierInvoice[]>;
  unreachableClients?: Set<number>;
  notifyState?: Record<string, InvoiceStageMap>;
  wantsPush?: boolean;
  wantsEmail?: boolean;
  prefsOn?: boolean;
  getConfigThrows?: boolean;
  getLinkedUsersThrows?: boolean;
  createInAppReturns?: string | null;
}): { deps: WhmcsInvoiceNotifierDeps; rec: Recorder; state: Record<string, InvoiceStageMap> } {
  const rec: Recorder = { inApp: [], pushes: [], emails: [], recorded: [], loads: [] };
  const state: Record<string, InvoiceStageMap> = JSON.parse(JSON.stringify(opts.notifyState ?? {}));
  const unreachable = opts.unreachableClients ?? new Set<number>();

  const deps: WhmcsInvoiceNotifierDeps = {
    now: NOW,
    getConfig: async () => {
      if (opts.getConfigThrows) throw new Error("config boom");
      return { active: opts.active ?? true, baseUrl: opts.baseUrl ?? "https://cowboymedia.net/billing" };
    },
    getLinkedUsers: async () => {
      if (opts.getLinkedUsersThrows) throw new Error("users boom");
      return opts.users ?? [];
    },
    loadInvoices: async (clientId) => {
      rec.loads.push({ clientId });
      if (unreachable.has(clientId)) return { invoices: [], unreachable: true };
      return { invoices: (opts.invoicesByClient ?? {})[clientId] ?? [], unreachable: false };
    },
    getNotifyState: async (userId) => state[userId] ?? {},
    recordNotified: async (userId, invoiceId, stage) => {
      rec.recorded.push({ userId, invoiceId, stage });
      state[userId] = { ...(state[userId] ?? {}), [String(invoiceId)]: stage };
    },
    createInApp: async (user, invoice, stage) => {
      rec.inApp.push({ userId: user.id, invoiceId: invoice.id, stage });
      return opts.createInAppReturns === undefined ? "notif-1" : opts.createInAppReturns;
    },
    sendPush: (user, invoice, stage, notificationId) =>
      rec.pushes.push({ userId: user.id, invoiceId: invoice.id, stage, notificationId }),
    sendEmail: (user, invoice, stage) => rec.emails.push({ userId: user.id, invoiceId: invoice.id, stage }),
    wantsPush: () => opts.wantsPush ?? true,
    wantsEmail: () => opts.wantsEmail ?? true,
    prefsOn: () => opts.prefsOn ?? true,
  };

  return { deps, rec, state };
}

test("no-op when WHMCS is inactive: no loads, no sends, no markers", async () => {
  const { deps, rec } = makeDeps({ active: false, users: [mkUser()], invoicesByClient: { 100: [mkInvoice()] } });
  const result = await runWhmcsInvoiceNotifyPass(deps);
  assert.equal(result.active, false);
  assert.equal(result.usersScanned, 0);
  assert.equal(result.invoicesNotified, 0);
  assert.equal(rec.loads.length, 0);
  assert.equal(rec.pushes.length, 0);
  assert.equal(rec.recorded.length, 0);
});

test("getConfig throwing is swallowed and reported inactive (no sends)", async () => {
  const { deps, rec } = makeDeps({ getConfigThrows: true, users: [mkUser()], invoicesByClient: { 100: [mkInvoice()] } });
  const result = await runWhmcsInvoiceNotifyPass(deps);
  assert.equal(result.active, false);
  assert.equal(rec.loads.length, 0);
  assert.equal(rec.pushes.length, 0);
});

test("getLinkedUsers throwing yields active pass with nothing scanned", async () => {
  const { deps, rec } = makeDeps({ getLinkedUsersThrows: true });
  const result = await runWhmcsInvoiceNotifyPass(deps);
  assert.equal(result.active, true);
  assert.equal(result.usersScanned, 0);
  assert.equal(rec.loads.length, 0);
});

test("skips users with no linked client id (not scanned, not loaded)", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "nolink", whmcsClientId: null }), mkUser({ id: "linked", whmcsClientId: 100 })],
    invoicesByClient: { 100: [mkInvoice()] },
  });
  const result = await runWhmcsInvoiceNotifyPass(deps);
  assert.equal(result.usersScanned, 1);
  assert.deepEqual(rec.loads, [{ clientId: 100 }]);
  assert.deepEqual(rec.recorded.map((r) => r.userId), ["linked"]);
});

test("unreachable WHMCS for a user → no marker (degrades cleanly while GetInvoices perm missing)", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    invoicesByClient: { 100: [mkInvoice()] },
    unreachableClients: new Set([100]),
  });
  const result = await runWhmcsInvoiceNotifyPass(deps);
  assert.equal(result.usersScanned, 1);
  assert.equal(result.invoicesNotified, 0);
  assert.equal(rec.pushes.length, 0);
  assert.equal(rec.emails.length, 0);
  assert.equal(rec.inApp.length, 0);
  assert.equal(rec.recorded.length, 0);
});

test("a due-soon invoice fires push AND email, then records a due_soon marker", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    invoicesByClient: { 100: [mkInvoice({ id: 7, dueDate: "2026-06-13" })] },
  });
  const result = await runWhmcsInvoiceNotifyPass(deps);
  assert.equal(result.invoicesNotified, 1);
  assert.deepEqual(rec.inApp, [{ userId: "u1", invoiceId: 7, stage: "due_soon" }]);
  assert.deepEqual(rec.pushes, [{ userId: "u1", invoiceId: 7, stage: "due_soon", notificationId: "notif-1" }]);
  assert.deepEqual(rec.emails, [{ userId: "u1", invoiceId: 7, stage: "due_soon" }]);
  assert.deepEqual(rec.recorded, [{ userId: "u1", invoiceId: 7, stage: "due_soon" }]);
});

test("an overdue invoice fires with the overdue stage", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    invoicesByClient: { 100: [mkInvoice({ id: 7, dueDate: "2026-06-01" })] },
  });
  await runWhmcsInvoiceNotifyPass(deps);
  assert.deepEqual(rec.pushes, [{ userId: "u1", invoiceId: 7, stage: "overdue", notificationId: "notif-1" }]);
  assert.deepEqual(rec.recorded, [{ userId: "u1", invoiceId: 7, stage: "overdue" }]);
});

test("paid invoice never notifies", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    invoicesByClient: { 100: [mkInvoice({ id: 7, status: "paid", dueDate: "2026-06-01" })] },
  });
  const result = await runWhmcsInvoiceNotifyPass(deps);
  assert.equal(result.invoicesNotified, 0);
  assert.equal(rec.pushes.length, 0);
  assert.equal(rec.recorded.length, 0);
});

test("channel gating: push-off + email-on sends only email, still creates bell row + marker", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    invoicesByClient: { 100: [mkInvoice({ id: 7 })] },
    wantsPush: false,
    wantsEmail: true,
  });
  const result = await runWhmcsInvoiceNotifyPass(deps);
  assert.equal(result.invoicesNotified, 1);
  assert.equal(rec.pushes.length, 0);
  assert.deepEqual(rec.inApp, [{ userId: "u1", invoiceId: 7, stage: "due_soon" }]);
  assert.deepEqual(rec.emails, [{ userId: "u1", invoiceId: 7, stage: "due_soon" }]);
  assert.equal(rec.recorded.length, 1);
});

test("email gated off when user has no email address, even if wantsEmail=true", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100, email: null })],
    invoicesByClient: { 100: [mkInvoice({ id: 7 })] },
    wantsPush: false,
    wantsEmail: true,
    prefsOn: false, // no deliverable channel + prefs off → marker still recorded
  });
  const result = await runWhmcsInvoiceNotifyPass(deps);
  assert.equal(result.invoicesNotified, 0);
  assert.equal(rec.emails.length, 0);
  assert.equal(rec.inApp.length, 0);
  assert.equal(rec.recorded.length, 1);
});

test("both channels off (prefs off): no bell row, but marker still recorded (no replay later)", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    invoicesByClient: { 100: [mkInvoice({ id: 7 })] },
    wantsPush: false,
    wantsEmail: false,
    prefsOn: false,
  });
  const result = await runWhmcsInvoiceNotifyPass(deps);
  assert.equal(result.invoicesNotified, 0);
  assert.equal(rec.inApp.length, 0);
  assert.deepEqual(rec.recorded, [{ userId: "u1", invoiceId: 7, stage: "due_soon" }]);
});

test("quiet hours: prefs ON but suppressed → no delivery AND no marker (retries next pass)", async () => {
  const { deps, rec, state } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    invoicesByClient: { 100: [mkInvoice({ id: 7 })] },
    wantsPush: false, // suppressed by quiet hours
    wantsEmail: false,
    prefsOn: true, // ...but the customer DOES want this category
  });
  const result = await runWhmcsInvoiceNotifyPass(deps);
  assert.equal(result.invoicesNotified, 0);
  assert.equal(rec.pushes.length, 0);
  assert.equal(rec.emails.length, 0);
  assert.equal(rec.inApp.length, 0);
  assert.equal(rec.recorded.length, 0); // marker SKIPPED so it retries
  assert.equal(state["u1"], undefined);
});

test("quiet hours then delivery: a suppressed pass re-delivers on the next pass", async () => {
  const invoices = { 100: [mkInvoice({ id: 7 })] };
  // First pass: quiet hours suppress it (prefs on, channels report off).
  let suppressed = true;
  const { deps, rec } = makeDeps({ users: [mkUser({ id: "u1", whmcsClientId: 100 })], invoicesByClient: invoices });
  deps.wantsPush = () => !suppressed;
  deps.wantsEmail = () => !suppressed;
  deps.prefsOn = () => true;

  await runWhmcsInvoiceNotifyPass(deps);
  assert.equal(rec.pushes.length, 0);
  assert.equal(rec.recorded.length, 0);

  // Quiet hours end; next pass delivers and records.
  suppressed = false;
  await runWhmcsInvoiceNotifyPass(deps);
  assert.equal(rec.pushes.length, 1);
  assert.deepEqual(rec.recorded, [{ userId: "u1", invoiceId: 7, stage: "due_soon" }]);
});

test("push reuses created bell row id; falls back to its own row when createInApp fails", async () => {
  const reuse = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    invoicesByClient: { 100: [mkInvoice({ id: 7 })] },
    wantsEmail: false,
  });
  await runWhmcsInvoiceNotifyPass(reuse.deps);
  assert.equal(reuse.rec.pushes[0].notificationId, "notif-1");

  const fallback = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    invoicesByClient: { 100: [mkInvoice({ id: 7 })] },
    wantsEmail: false,
    createInAppReturns: null,
  });
  await runWhmcsInvoiceNotifyPass(fallback.deps);
  assert.equal(fallback.rec.pushes[0].notificationId, null);
});

test("dedupe across two passes: second pass sends nothing", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    invoicesByClient: { 100: [mkInvoice({ id: 7, dueDate: "2026-06-13" })] },
  });
  const first = await runWhmcsInvoiceNotifyPass(deps);
  assert.equal(first.invoicesNotified, 1);
  const second = await runWhmcsInvoiceNotifyPass(deps);
  assert.equal(second.invoicesNotified, 0);
  assert.equal(rec.pushes.length, 1);
  assert.equal(rec.recorded.length, 1);
});

test("escalation: due_soon then overdue re-notifies once at the new stage", async () => {
  const invoices = { 100: [mkInvoice({ id: 7, dueDate: "2026-06-13" })] }; // due_soon
  const { deps, rec } = makeDeps({ users: [mkUser({ id: "u1", whmcsClientId: 100 })], invoicesByClient: invoices });

  await runWhmcsInvoiceNotifyPass(deps);
  assert.deepEqual(rec.pushes.map((p) => p.stage), ["due_soon"]);

  // Time passes; the same invoice is now overdue.
  invoices[100][0].dueDate = "2026-06-01";
  await runWhmcsInvoiceNotifyPass(deps);
  assert.deepEqual(rec.pushes.map((p) => p.stage), ["due_soon", "overdue"]);
  assert.deepEqual(rec.recorded.map((r) => r.stage), ["due_soon", "overdue"]);
});

test("a throw for one user does not abort the pass for the rest", async () => {
  const { deps, rec, state } = makeDeps({
    users: [mkUser({ id: "boom", whmcsClientId: 100 }), mkUser({ id: "ok", whmcsClientId: 200 })],
    invoicesByClient: { 200: [mkInvoice({ id: 9 })] },
  });
  const realGetState = deps.getNotifyState;
  deps.getNotifyState = async (userId) => {
    if (userId === "boom") throw new Error("state boom");
    return realGetState(userId);
  };
  const result = await runWhmcsInvoiceNotifyPass(deps);
  assert.equal(result.usersScanned, 2);
  assert.equal(result.invoicesNotified, 1);
  assert.deepEqual(rec.recorded, [{ userId: "ok", invoiceId: 9, stage: "due_soon" }]);
  assert.equal(state["boom"], undefined);
});

test("DUE_SOON_DAYS window boundary: invoice due exactly today+DUE_SOON_DAYS still fires", async () => {
  const dueDate = "2026-06-14"; // today + 3
  assert.equal(DUE_SOON_DAYS, 3);
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    invoicesByClient: { 100: [mkInvoice({ id: 7, dueDate })] },
  });
  await runWhmcsInvoiceNotifyPass(deps);
  assert.deepEqual(rec.pushes.map((p) => p.stage), ["due_soon"]);
});
