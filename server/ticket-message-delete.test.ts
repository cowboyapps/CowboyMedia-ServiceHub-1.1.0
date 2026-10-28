import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import type { Ticket, TicketMessage, User } from "@shared/schema";
import { createTicketMessageDeleteHandler, type TicketMessageDeleteDeps } from "./ticket-message-delete";

function fixture() {
  let actor = { id: "admin", role: "admin" } as User;
  const ticket = { id: "ticket", customerId: "owner", status: "closed" } as Ticket;
  let msg: TicketMessage | undefined = {
    id: "message", ticketId: ticket.id, senderId: "owner", message: "secret",
    imageUrl: "/uploads/attachment.png", isInternal: false, createdAt: new Date(),
  } as TicketMessage;
  const events: unknown[] = [];
  const cleanups: unknown[] = [];
  let commits = 0;
  let manage = true;
  let fail = false;
  const deps: TicketMessageDeleteDeps = {
    getUser: async () => actor, getTicket: async () => ticket, getMessage: async () => msg,
    canManage: async () => manage,
    recipients: async (_ticket, internal) => internal ? ["admin"] : ["admin", "owner"],
    remove: async () => {
      if (fail) throw new Error("database down");
      const removed = msg;
      msg = undefined;
      if (removed) commits++;
      return removed;
    },
    cleanup: async (url) => { cleanups.push(url); },
    broadcast: (ids, event) => { assert.equal(msg, undefined); events.push({ ids, event }); },
  };
  const request = async (messageId = "message") => {
    let status = 200;
    let body: unknown;
    const res = { status: (value: number) => { status = value; return res; }, json: (value: unknown) => { body = value; return res; } };
    await createTicketMessageDeleteHandler(deps)(
      { session: { userId: actor.id }, params: { id: ticket.id, messageId } } as unknown as Request,
      res as unknown as Response,
    );
    return { status, body };
  };
  return { request, deps, events, cleanups, get commits() { return commits; },
    setActor: (value: User) => { actor = value; }, setMessage: (value: Partial<TicketMessage>) => { msg = { ...msg!, ...value }; },
    deny: () => { manage = false; }, fail: () => { fail = true; } };
}

for (const senderId of ["admin", "owner", "other-admin"]) {
  test(`deletes ${senderId} reply on a closed ticket, broadcasts IDs only, and retries safely`, async () => {
    const f = fixture();
    f.setMessage({ senderId });
    assert.equal((await f.request()).status, 200);
    assert.deepEqual(f.events, [{ ids: ["admin", "owner"], event: { type: "ticket_message_deleted", ticketId: "ticket", messageId: "message" } }]);
    assert.deepEqual(f.cleanups, ["/uploads/attachment.png"]);
    assert.equal((await f.request()).status, 200);
    assert.equal(f.commits, 1);
  });
}
test("customer and missing-management permission cannot delete", async () => {
  for (const role of ["customer", "admin"]) {
    const f = fixture();
    f.setActor({ id: role, role } as User);
    f.deny();
    assert.equal((await f.request()).status, 403);
    assert.equal(f.commits, 0);
    assert.deepEqual(f.events, []);
  }
});
test("cross-ticket message IDs are rejected", async () => {
  const f = fixture();
  f.setMessage({ ticketId: "someone-else" });
  assert.equal((await f.request()).status, 404);
  assert.equal(f.commits, 0);
});
test("internal-note author/time restrictions and private events are preserved", async () => {
  const f = fixture();
  f.setMessage({ isInternal: true });
  assert.equal((await f.request()).status, 403);
  f.setMessage({ senderId: "admin", createdAt: new Date(0) });
  assert.equal((await f.request()).status, 403);
  f.setMessage({ createdAt: new Date() });
  assert.equal((await f.request()).status, 200);
  assert.deepEqual((f.events[0] as { ids: string[] }).ids, ["admin"]);
});
test("commit failure leaves message; post-commit cleanup/socket failures do not report false failure", async () => {
  const f = fixture();
  f.fail();
  assert.equal((await f.request()).status, 500);
  assert.equal(f.commits, 0);
  assert.deepEqual(f.events, []);
  const g = fixture();
  g.deps.cleanup = async () => { throw new Error("cleanup"); };
  g.deps.broadcast = () => { throw new Error("socket"); };
  assert.equal((await g.request()).status, 200);
  assert.equal(g.commits, 1);
});
