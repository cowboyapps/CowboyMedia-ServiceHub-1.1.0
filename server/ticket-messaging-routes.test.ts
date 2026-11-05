import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import type { Ticket, TicketMessage, User } from "@shared/schema";
import { createTicketMessagingHandlers, type TicketMessagingDeps } from "./ticket-messaging-routes";

function fixture() {
  let actor: User | undefined = { id: "owner", role: "customer" } as User;
  const ticket = { id: "ticket", customerId: "owner", status: "closed" } as Ticket;
  let message: TicketMessage | undefined = {
    id: "message", ticketId: "ticket", senderId: "admin", isInternal: false, imageUrl: "/uploads/demo.mp4",
  } as TicketMessage;
  let allowed = true;
  let mutationResult = true;
  let broadcastFails = false;
  let uploadReads = 0;
  const mutations: unknown[] = [];
  const reads: unknown[] = [];
  const events: unknown[] = [];
  const deps: TicketMessagingDeps = {
    getUser: async () => actor, getTicket: async () => ticket, getMessage: async () => message,
    canAccess: async () => allowed,
    recipients: async () => ["owner", "admin"],
    setReaction: async (...args) => { mutations.push(args); return mutationResult; },
    reactions: async () => ({ message: [{ emoji: "👍", count: 1, reacted: true }] }),
    markRead: async (...args) => { reads.push(args); return mutationResult; },
    getUpload: async filename => {
      uploadReads++;
      return { filename, mimetype: "video/mp4", data: Buffer.from("0123456789").toString("base64") };
    },
    broadcast: (ids, event) => { if (broadcastFails) throw Error("socket"); events.push({ ids, event }); },
  };
  const handlers = createTicketMessagingHandlers(deps);
  async function request(kind: keyof typeof handlers, body: unknown = {}, options: { session?: boolean; range?: string; download?: boolean } = {}) {
    const req = {
      session: { userId: options.session === false ? undefined : actor?.id },
      params: { id: ticket.id, messageId: "message" },
      headers: { range: options.range }, query: { download: options.download ? "1" : undefined }, body,
    } as unknown as Request;
    let data: unknown;
    let status = 200;
    const headers: Record<string, string> = {};
    const res = {
      status(n: number) { status = n; return this; },
      set(key: string | Record<string, string>, value?: string) {
        if (typeof key === "string") headers[key] = value!;
        else Object.assign(headers, key);
        return this;
      },
      json(value: unknown) { data = value; return this; },
      send(value: unknown) { data = value; return this; },
      end() { return this; },
    } as unknown as Response;
    await handlers[kind](req, res);
    return { status, data, headers };
  }
  return {
    ticket, request, mutations, reads, events, get uploadReads() { return uploadReads; },
    actor: (value: User | undefined) => { actor = value; },
    allowed: (value: boolean) => { allowed = value; },
    message: (value: Partial<TicketMessage> | undefined) => { message = value ? { ...message!, ...value } : undefined; },
    result: (value: boolean) => { mutationResult = value; },
    failBroadcast: () => { broadcastFails = true; },
  };
}

test("closed-ticket reaction authenticates actor, supports idempotent set/clear, broadcasts only identifiers", async () => {
  const f = fixture();
  assert.equal((await f.request("reaction", { emoji: "👍", userId: "forged" })).status, 200);
  assert.deepEqual(f.mutations[0], ["ticket", "message", "owner", "👍"]);
  assert.deepEqual(f.events[0], { ids: ["owner", "admin"], event: {
    type: "ticket_reactions_updated", ticketId: "ticket", messageId: "message",
  } });
  assert.equal((await f.request("reaction", { emoji: null })).status, 200);
  assert.deepEqual(f.mutations[1], ["ticket", "message", "owner", null]);
  f.failBroadcast();
  assert.equal((await f.request("reaction", { emoji: "❤️" })).status, 200, "socket failure cannot undo a committed set");
});

test("unauthorized, unrelated-ticket, internal, deleted, and invalid-emoji reactions are rejected", async () => {
  const f = fixture();
  assert.equal((await f.request("reaction", { emoji: "👍" }, { session: false })).status, 401);
  f.allowed(false);
  assert.equal((await f.request("reaction", { emoji: "👍" })).status, 403);
  f.allowed(true);
  for (const emoji of [undefined, {}, "not-emoji", ""]) {
    assert.equal((await f.request("reaction", { emoji })).status, 400);
  }
  f.message({ ticketId: "other" });
  assert.equal((await f.request("reaction", { emoji: "👍" })).status, 404);
  f.message({ ticketId: "ticket", isInternal: true });
  assert.equal((await f.request("reaction", { emoji: "👍" })).status, 404);
  f.message({ isInternal: false }); f.result(false);
  assert.equal((await f.request("reaction", { emoji: "👍" })).status, 404, "delete winning the transaction race is not resurrected");
  assert.equal(f.events.length, 0);
});

test("read receipts accept bounded visible IDs only and scope broadcasts", async () => {
  const f = fixture();
  const result = await f.request("read", { messageIds: ["one", "one", "two"] });
  assert.equal(result.status, 200);
  assert.deepEqual(f.reads[0], [f.ticket, { id: "owner", role: "customer" }, ["one", "two"]]);
  assert.deepEqual(f.events[0], { ids: ["owner", "admin"], event: {
    type: "ticket_messages_read", ticketId: "ticket", readBy: "owner",
  } });
  for (const messageIds of [null, "one", [5], ["x".repeat(101)], Array(101).fill("one")]) {
    assert.equal((await f.request("read", { messageIds })).status, 400);
  }
  f.result(false);
  assert.deepEqual((await f.request("read", { messageIds: [] })).data, { changed: false });
  assert.equal(f.events.length, 1);
});

test("media attachment is authorized, revocable/no-store and supports seek ranges and downloads", async () => {
  const f = fixture();
  const full = await f.request("attachment", {}, { download: true });
  assert.equal(full.status, 200);
  assert.equal(full.headers["Cache-Control"], "no-store");
  assert.equal(full.headers["Content-Disposition"], 'attachment; filename="demo.mp4"');
  assert.equal((full.data as Buffer).toString(), "0123456789");
  const range = await f.request("attachment", {}, { range: "bytes=2-5" });
  assert.equal(range.status, 206);
  assert.equal(range.headers["Content-Range"], "bytes 2-5/10");
  assert.equal((range.data as Buffer).toString(), "2345");
  assert.equal((await f.request("attachment", {}, { range: "bytes=-3" })).status, 206);
  for (const bad of ["bytes=20-", "bytes=-0", "bytes=-", "bytes=0-1,4-6", "bad"]) {
    assert.equal((await f.request("attachment", {}, { range: bad })).status, 416, bad);
  }
  f.allowed(false);
  const before = f.uploadReads;
  assert.equal((await f.request("attachment")).status, 403);
  assert.equal(f.uploadReads, before);
  f.allowed(true); f.message(undefined);
  assert.equal((await f.request("attachment")).status, 404);
});

test("attachment cannot proxy external URLs or expose internal or other-ticket media", async () => {
  const f = fixture();
  for (const imageUrl of ["https://example.test/file.mp4", "/api/private", "/uploads/file.png?x=1"]) {
    f.message({ imageUrl });
    assert.equal((await f.request("attachment")).status, 404);
  }
  f.message({ imageUrl: "/uploads/file.png", isInternal: true });
  assert.equal((await f.request("attachment")).status, 404);
  f.message({ isInternal: false, ticketId: "other" });
  assert.equal((await f.request("attachment")).status, 404);
  assert.equal(f.uploadReads, 0);
});
