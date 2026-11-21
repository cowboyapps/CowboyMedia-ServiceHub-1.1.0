import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { createCommunityDiscoveryHandlers, literalSearchPattern, type CommunityDiscoveryDeps } from "../server/community-chat-discovery";
import type { CommunityMessage } from "../shared/schema";

const message: CommunityMessage = {
  newsArticleId: null,
  id: "message-one", userId: "customer", chatUsername: "Subscriber", content: "Welcome to our community",
  imageUrl: null, kbArticleSlug: null, pollId: null, replyToId: null,
  createdAt: new Date("2026-01-01"), editedAt: null,
};

async function fixture(run: (request: (method: string, url: string, user?: string, body?: unknown) => Promise<Response>, state: {
  pin: CommunityMessage | null; audits: string[]; broadcasts: string[]; searches: Array<[string, number]>; fail: boolean;
}) => Promise<void>) {
  const state = { pin: null as CommunityMessage | null, audits: [] as string[], broadcasts: [] as string[], searches: [] as Array<[string, number]>, fail: false };
  const deps: CommunityDiscoveryDeps = {
    getUser: async id => ({ id, role: id === "customer" ? "customer" : id === "staff" ? "staff" : id === "master" ? "master_admin" : "admin", chatBanned: id === "banned" }),
    search: async (query, limit) => { state.searches.push([query, limit]); if (state.fail) throw new Error("sensitive database detail"); return { messages: [message], truncated: false }; },
    getPin: async () => state.pin,
    setPin: async id => { if (id !== message.id) return null; state.pin = message; return message; },
    clearPin: async () => { state.pin = null; },
    broadcast: event => { state.broadcasts.push(event.type); },
    audit: action => { state.audits.push(action); },
    reportError: () => {},
  };
  const handlers = createCommunityDiscoveryHandlers(deps);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { Object.defineProperty(req, "session", { value: { userId: req.headers["x-user-id"] } }); next(); });
  app.get("/search", handlers.search);
  app.get("/pin", handlers.getPin);
  app.put("/pin", handlers.setPin);
  app.delete("/pin", handlers.clearPin);
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await run((method, url, user, body) => fetch(`http://127.0.0.1:${address.port}${url}`, {
      method, headers: { ...(user ? { "x-user-id": user } : {}), "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), state);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

test("search and pin endpoints require an authenticated session", async () => {
  await fixture(async request => {
    for (const [method, url] of [["GET", "/search?q=welcome"], ["GET", "/pin"], ["PUT", "/pin"], ["DELETE", "/pin"]]) {
      assert.equal((await request(method, url)).status, 401);
    }
  });
});

test("bounded search returns existing community messages without HTTP caching", async () => {
  await fixture(async (request, state) => {
    const response = await request("GET", "/search?q=%20welcome%20&limit=12", "customer");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(state.searches, [["welcome", 12]]);
    assert.equal((await response.json()).messages[0].id, message.id);
    for (const query of ["q=a", `q=${"x".repeat(121)}`, "q[]=welcome", "q=hi&limit=0", "q=hi&limit=51", "q=hi&limit=1.2", "q=hi&limit=5&limit=8"]) {
      assert.equal((await request("GET", "/search?" + query, "customer")).status, 400, query);
    }
    assert.equal(state.searches.length, 1);
  });
});

test("search treats SQL wildcard characters as literal text", () => {
  assert.equal(literalSearchPattern("100%_done\\here"), "%100\\%\\_done\\\\here%");
  assert.equal(literalSearchPattern("subscriber's tips"), "%subscriber's tips%");
});

test("customers, staff and banned admins cannot change the community pin", async () => {
  await fixture(async (request, state) => {
    for (const user of ["customer", "staff", "banned"]) {
      assert.equal((await request("PUT", "/pin", user, { messageId: message.id })).status, 403);
      assert.equal((await request("DELETE", "/pin", user)).status, 403);
    }
    assert.equal(state.pin, null);
    assert.deepEqual(state.audits, []);
    assert.deepEqual(state.broadcasts, []);
  });
});

test("admin pins persist for subscribers, unpin broadcasts, and missing messages fail explicitly", async () => {
  await fixture(async (request, state) => {
    assert.deepEqual(await (await request("GET", "/pin", "customer")).json(), { message: null });
    assert.equal((await request("PUT", "/pin", "admin", { messageId: message.id })).status, 200);
    const response = await request("GET", "/pin", "customer");
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal((await response.json()).message.id, message.id);
    assert.equal((await request("PUT", "/pin", "master", { messageId: "deleted" })).status, 404);
    assert.equal((await request("PUT", "/pin", "admin", { messageId: [] })).status, 400);
    assert.equal((await request("DELETE", "/pin", "master")).status, 200);
    assert.equal(state.pin, null);
    assert.deepEqual(state.audits, ["community_message_pinned", "community_message_unpinned"]);
    assert.deepEqual(state.broadcasts, ["community_pin_changed", "community_pin_changed"]);
  });
});

test("storage errors return a recoverable error without leaking database details", async () => {
  await fixture(async (request, state) => {
    state.fail = true;
    const response = await request("GET", "/search?q=welcome", "customer");
    assert.equal(response.status, 500);
    assert.doesNotMatch(await response.text(), /sensitive database detail/);
  });
});
