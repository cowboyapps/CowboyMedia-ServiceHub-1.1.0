import { test } from "node:test";
import assert from "node:assert/strict";
import { NOTIFICATION_CATEGORIES, getNotificationCategory } from "../shared/notification-categories";
import {
  canMutateInternalNote,
  canPostInternalNote,
  filterMessagesForViewer,
  parseIsInternalFlag,
  INTERNAL_NOTE_EDIT_WINDOW_MS,
} from "./ticket-internal-notes";
import type { TicketMessage } from "../shared/schema";

// ---------- Notification category ----------

test("admin_internal_note category is registered for admins, push only", () => {
  const cat = getNotificationCategory("admin_internal_note");
  assert.ok(cat);
  assert.deepEqual(cat!.channels, ["push"]);
  assert.deepEqual(cat!.roles, ["admin"]);
});

test("admin_internal_note appears in NOTIFICATION_CATEGORIES list", () => {
  assert.ok(NOTIFICATION_CATEGORIES.some((c) => c.key === "admin_internal_note"));
});

// ---------- Storage filter ----------

function msg(partial: Partial<TicketMessage>): TicketMessage {
  return {
    id: partial.id || "m",
    ticketId: partial.ticketId || "t",
    senderId: partial.senderId || "u",
    message: partial.message ?? "hello",
    imageUrl: partial.imageUrl ?? null,
    readAt: partial.readAt ?? null,
    isInternal: partial.isInternal ?? false,
    kbArticleSlug: partial.kbArticleSlug ?? null,
    createdAt: partial.createdAt ?? new Date(),
  };
}

test("filterMessagesForViewer: customer never sees internal notes", () => {
  const all = [
    msg({ id: "a", isInternal: false }),
    msg({ id: "b", isInternal: true }),
    msg({ id: "c", isInternal: false }),
  ];
  const visible = filterMessagesForViewer(all, "customer");
  assert.deepEqual(visible.map((m) => m.id), ["a", "c"]);
});

test("filterMessagesForViewer: admin sees all messages", () => {
  const all = [
    msg({ id: "a", isInternal: false }),
    msg({ id: "b", isInternal: true }),
  ];
  assert.equal(filterMessagesForViewer(all, "admin").length, 2);
  assert.equal(filterMessagesForViewer(all, "master_admin").length, 2);
});

test("filterMessagesForViewer: unknown / null role treated as non-admin", () => {
  const all = [msg({ id: "a", isInternal: true }), msg({ id: "b", isInternal: false })];
  assert.deepEqual(filterMessagesForViewer(all, null).map((m) => m.id), ["b"]);
  assert.deepEqual(filterMessagesForViewer(all, "user").map((m) => m.id), ["b"]);
});

// ---------- API auth: who can post an internal note ----------

test("canPostInternalNote: only admin/master_admin", () => {
  assert.equal(canPostInternalNote("admin"), true);
  assert.equal(canPostInternalNote("master_admin"), true);
  assert.equal(canPostInternalNote("customer"), false);
  assert.equal(canPostInternalNote("user"), false);
  assert.equal(canPostInternalNote(undefined), false);
});

test("parseIsInternalFlag: accepts bool true and string 'true' only", () => {
  assert.equal(parseIsInternalFlag(true), true);
  assert.equal(parseIsInternalFlag("true"), true);
  assert.equal(parseIsInternalFlag("false"), false);
  assert.equal(parseIsInternalFlag(false), false);
  assert.equal(parseIsInternalFlag(undefined), false);
  assert.equal(parseIsInternalFlag("1"), false);
});

// ---------- Edit / delete window enforcement ----------

const ticketId = "ticket-1";
const actor = { id: "admin-1", role: "admin" };
const now = new Date("2026-01-01T00:05:00Z");
const fresh = new Date("2026-01-01T00:03:00Z"); // 2 minutes ago
const stale = new Date("2025-12-31T23:59:00Z"); // 6 minutes ago — past window

test("canMutateInternalNote: admin can edit own fresh internal note", () => {
  const m = msg({ id: "n1", ticketId, senderId: actor.id, isInternal: true, createdAt: fresh });
  assert.deepEqual(canMutateInternalNote(m, ticketId, actor, now), { ok: true });
});

test("canMutateInternalNote: rejects after 5-minute window", () => {
  const m = msg({ id: "n1", ticketId, senderId: actor.id, isInternal: true, createdAt: stale });
  const r = canMutateInternalNote(m, ticketId, actor, now);
  assert.equal(r.ok, false);
  assert.equal((r as any).status, 403);
});

test("canMutateInternalNote: rejects edits by another admin", () => {
  const m = msg({ id: "n1", ticketId, senderId: "other-admin", isInternal: true, createdAt: fresh });
  const r = canMutateInternalNote(m, ticketId, actor, now);
  assert.equal(r.ok, false);
  assert.equal((r as any).status, 403);
});

test("canMutateInternalNote: rejects non-admin actors", () => {
  const m = msg({ id: "n1", ticketId, senderId: "u1", isInternal: true, createdAt: fresh });
  const r = canMutateInternalNote(m, ticketId, { id: "u1", role: "customer" }, now);
  assert.equal(r.ok, false);
  assert.equal((r as any).status, 403);
});

test("canMutateInternalNote: rejects mutation of non-internal messages", () => {
  const m = msg({ id: "n1", ticketId, senderId: actor.id, isInternal: false, createdAt: fresh });
  const r = canMutateInternalNote(m, ticketId, actor, now);
  assert.equal(r.ok, false);
  assert.equal((r as any).status, 400);
});

test("canMutateInternalNote: 404 when message missing or wrong ticket", () => {
  assert.equal(canMutateInternalNote(null, ticketId, actor, now).ok, false);
  const m = msg({ id: "n1", ticketId: "other", senderId: actor.id, isInternal: true, createdAt: fresh });
  const r = canMutateInternalNote(m, ticketId, actor, now);
  assert.equal((r as any).status, 404);
});

test("INTERNAL_NOTE_EDIT_WINDOW_MS is 5 minutes", () => {
  assert.equal(INTERNAL_NOTE_EDIT_WINDOW_MS, 5 * 60 * 1000);
});
