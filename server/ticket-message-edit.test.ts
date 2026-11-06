import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import type { Ticket, TicketMessage, User } from "@shared/schema";
import { createTicketMessageEditHandler } from "./ticket-message-edit";

function fixture() {
  let actor = { id: "admin", role: "admin" } as User;
  let ticket: Ticket | undefined = { id: "ticket", customerId: "owner", status: "closed" } as Ticket;
  let message: TicketMessage | undefined = {
    id: "message", ticketId: "ticket", senderId: "admin", message: "Original",
    imageUrl: "/uploads/photo.png", isInternal: false, createdAt: new Date(0), kbArticleSlug: null,
  } as TicketMessage;
  let allowed = true, race = false, failSave = false, failBroadcast = false;
  const saves: string[] = [];
  const events: Array<{ ids: string[]; event: { message: TicketMessage; isInternal: boolean } }> = [];
  const handler = createTicketMessageEditHandler({
    getUser: async () => actor,
    getTicket: async () => ticket,
    getMessage: async () => message,
    canManage: async () => allowed,
    recipients: async (_ticket, internal) => internal ? ["admin"] : ["admin", "owner"],
    save: async (_ticket, _id, _actor, text) => {
      if (failSave) throw new Error("database failed");
      if (!message || race) return undefined;
      saves.push(text);
      message = { ...message, message: text };
      return message;
    },
    broadcast: (ids, event) => {
      if (failBroadcast) throw new Error("socket failed");
      events.push({ ids, event });
    },
  });
  return {
    saves, events,
    actor: (value: Partial<User>) => { actor = { ...actor, ...value }; },
    message: (value: Partial<TicketMessage>) => { message = { ...message!, ...value }; },
    remove: () => { message = undefined; },
    noTicket: () => { ticket = undefined; },
    deny: () => { allowed = false; },
    race: () => { race = true; },
    failSave: () => { failSave = true; },
    failBroadcast: () => { failBroadcast = true; },
    async run(body: unknown = { message: " Updated ", originalMessage: "Original" }, authenticated = true) {
      let status = 200;
      let result: any;
      const res = { status(code: number) { status = code; return this; }, json(value: unknown) { result = value; return this; } } as unknown as Response;
      await handler({ session: { userId: authenticated ? actor.id : undefined }, params: { id: "ticket", messageId: "message" }, body } as unknown as Request, res);
      return { status, result };
    },
  };
}

test("admin edits an old sent reply on a closed ticket and customer receives the edit, not another message", async () => {
  const f = fixture();
  const response = await f.run();
  assert.equal(response.status, 200);
  assert.equal(response.result.message, "Updated");
  assert.equal(response.result.id, "message");
  assert.equal(response.result.imageUrl, "/uploads/photo.png");
  assert.deepEqual(f.saves, ["Updated"]);
  assert.deepEqual(f.events[0].ids, ["admin", "owner"]);
  assert.equal(f.events[0].event.isInternal, false);
});

test("authentication, admin role, ticket access, and message authorship are enforced", async () => {
  const cases: Array<[number, (f: ReturnType<typeof fixture>) => void, boolean?]> = [
    [401, () => {}, false],
    [403, f => f.actor({ role: "customer" })],
    [403, f => f.deny()],
    [403, f => f.message({ senderId: "owner" })],
    [403, f => { f.actor({ role: "master_admin" }); f.message({ senderId: "other-admin" }); }],
    [404, f => f.message({ ticketId: "different-ticket" })],
    [404, f => f.remove()],
    [404, f => f.noTicket()],
  ];
  for (const [expected, setup, authenticated] of cases) {
    const f = fixture();
    setup(f);
    assert.equal((await f.run(undefined, authenticated)).status, expected);
    assert.equal(f.saves.length, 0);
    assert.equal(f.events.length, 0);
  }
});

test("empty text-only replies and malformed edits are rejected, while attachment captions may be removed", async () => {
  for (const body of [{}, { message: 123 }, { message: "new", originalMessage: 3 }, { message: " " }]) {
    const f = fixture();
    f.message({ imageUrl: null });
    assert.equal((await f.run(body)).status, 400);
    assert.equal(f.saves.length, 0);
  }
  const f = fixture();
  assert.equal((await f.run({ message: "", originalMessage: "Original" })).status, 200);
  assert.equal(f.saves[0], "");
});

test("a stale edit is rejected before writing, and a concurrent edit is not overwritten", async () => {
  const stale = fixture();
  assert.equal((await stale.run({ message: "replacement", originalMessage: "outdated" })).status, 409);
  assert.equal(stale.saves.length, 0);
  const racing = fixture();
  racing.race();
  assert.equal((await racing.run()).status, 409);
  assert.equal(racing.events.length, 0);
});

test("internal notes keep their five-minute rule and never send an edit to the customer", async () => {
  const expired = fixture();
  expired.message({ isInternal: true });
  assert.equal((await expired.run()).status, 403);
  const fresh = fixture();
  fresh.message({ isInternal: true, createdAt: new Date() });
  assert.equal((await fresh.run()).status, 200);
  assert.deepEqual(fresh.events[0].ids, ["admin"]);
  assert.equal(fresh.events[0].event.isInternal, true);
});

test("database failures do not broadcast, while a missed socket after commit does not report a failed save", async () => {
  const failed = fixture();
  failed.failSave();
  assert.equal((await failed.run()).status, 500);
  assert.equal(failed.events.length, 0);
  const saved = fixture();
  saved.failBroadcast();
  assert.equal((await saved.run()).status, 200);
  assert.equal(saved.saves.length, 1);
});
