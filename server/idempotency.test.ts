import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  createIdempotencyMiddleware,
  isValidIdempotencyKey,
  __resetIdempotencyStore,
} from "./idempotency";

// Tests for the money-write idempotency layer (Task #591). The guard makes a
// repeated order/store-order/upgrade/cancel request carrying the SAME
// `Idempotency-Key` safe: the underlying WHMCS write runs at most once, and a
// timeout-driven retry replays the first response instead of charging again.
//
// We mount the production middleware in front of a tiny fake handler that
// mimics the real route shape: it bumps a write counter and sets
// `res.locals.whmcsWriteAttempted = true` only when it actually "writes", so we
// can assert the write runs exactly once across retries.

interface HandlerOpts {
  // What the fake handler does when it runs.
  behaviour: (writeCount: { n: number }, req: express.Request, res: express.Response) => void;
}

function makeApp(opts: HandlerOpts) {
  const writeCount = { n: 0 };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = { userId: (req.headers["x-user"] as string) || "u1" };
    next();
  });
  app.post("/act", createIdempotencyMiddleware({ ttlMs: 60_000 }), (req, res) => {
    opts.behaviour(writeCount, req, res);
  });
  return { app, writeCount };
}

async function call(
  app: express.Express,
  body: unknown,
  headers: Record<string, string> = {},
) {
  const { default: http } = await import("node:http");
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/act`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, body: json as any };
  } finally {
    server.close();
  }
}

// A handler that "places an order": writes, then returns a success with a fresh
// invoice id each time it runs (so we can detect a second real run).
const orderHandler: HandlerOpts = {
  behaviour: (writeCount, _req, res) => {
    res.locals.whmcsWriteAttempted = true;
    writeCount.n += 1;
    res.json({ ok: true, invoiceId: 1000 + writeCount.n });
  },
};

test("a repeated request with the same key replays the first response, write runs once", async () => {
  __resetIdempotencyStore();
  const { app, writeCount } = makeApp(orderHandler);
  const key = "abcd1234efgh5678";

  const first = await call(app, { pid: 1 }, { "Idempotency-Key": key });
  assert.equal(first.status, 200);
  assert.equal(first.body.invoiceId, 1001);

  // Same key again (the timeout-retry): the WHMCS write must NOT run a second
  // time, and the exact first response is replayed.
  const second = await call(app, { pid: 1 }, { "Idempotency-Key": key });
  assert.equal(second.status, 200);
  assert.equal(second.body.invoiceId, 1001, "must replay the original invoice, not mint a new one");
  assert.equal(writeCount.n, 1, "the order must be placed exactly once");
});

test("a different key runs the write again (a genuinely new submission)", async () => {
  __resetIdempotencyStore();
  const { app, writeCount } = makeApp(orderHandler);

  await call(app, { pid: 1 }, { "Idempotency-Key": "key-one-aaaaaa" });
  const second = await call(app, { pid: 1 }, { "Idempotency-Key": "key-two-bbbbbb" });
  assert.equal(second.body.invoiceId, 1002);
  assert.equal(writeCount.n, 2);
});

test("no key at all preserves the old behaviour (every request runs)", async () => {
  __resetIdempotencyStore();
  const { app, writeCount } = makeApp(orderHandler);

  await call(app, { pid: 1 });
  await call(app, { pid: 1 });
  assert.equal(writeCount.n, 2, "without a key there is no dedupe");
});

test("the same key from a DIFFERENT user is not deduped (scoped per user)", async () => {
  __resetIdempotencyStore();
  const { app, writeCount } = makeApp(orderHandler);
  const key = "shared-key-cccccc";

  const a = await call(app, { pid: 1 }, { "Idempotency-Key": key, "x-user": "alice" });
  const b = await call(app, { pid: 1 }, { "Idempotency-Key": key, "x-user": "bob" });
  assert.equal(a.body.invoiceId, 1001);
  assert.equal(b.body.invoiceId, 1002, "bob's order must run despite reusing alice's key");
  assert.equal(writeCount.n, 2);
});

test("a pre-write rejection is NOT persisted — a corrected retry with the same key runs", async () => {
  __resetIdempotencyStore();
  // First call rejects before the write (no whmcsWriteAttempted flag); second
  // call (same key) is allowed to proceed and write.
  let attempt = 0;
  const { app, writeCount } = makeApp({
    behaviour: (writeCount, _req, res) => {
      attempt += 1;
      if (attempt === 1) {
        // Pre-write validation failure: flag NOT set.
        res.status(400).json({ ok: false, message: "bad input" });
        return;
      }
      res.locals.whmcsWriteAttempted = true;
      writeCount.n += 1;
      res.json({ ok: true, invoiceId: 2001 });
    },
  });
  const key = "retry-after-fix-dddddd";

  const first = await call(app, { pid: 0 }, { "Idempotency-Key": key });
  assert.equal(first.status, 400);

  const second = await call(app, { pid: 1 }, { "Idempotency-Key": key });
  assert.equal(second.status, 200, "the corrected resubmit must be allowed to run");
  assert.equal(second.body.invoiceId, 2001);
  assert.equal(writeCount.n, 1);
});

test("a write-attempted failure IS persisted — a retry replays it, never re-charging", async () => {
  __resetIdempotencyStore();
  // The write was attempted but WHMCS errored/timed out. We don't know if a
  // charge landed, so a same-key retry must replay the failure, NOT re-submit.
  let runs = 0;
  const { app } = makeApp({
    behaviour: (_writeCount, _req, res) => {
      runs += 1;
      res.locals.whmcsWriteAttempted = true;
      res.status(502).json({ ok: false, message: "billing unreachable" });
    },
  });
  const key = "attempted-then-failed-eeeeee";

  const first = await call(app, { pid: 1 }, { "Idempotency-Key": key });
  assert.equal(first.status, 502);
  const second = await call(app, { pid: 1 }, { "Idempotency-Key": key });
  assert.equal(second.status, 502);
  assert.equal(runs, 1, "must not re-run a write that may already have charged");
});

test("a concurrent duplicate (still in flight) gets 409, not a second run", async () => {
  __resetIdempotencyStore();
  // Gate the first handler so it stays in flight while the duplicate arrives.
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let runs = 0;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).session = { userId: "u1" }; next(); });
  app.post("/act", createIdempotencyMiddleware({ ttlMs: 60_000 }), async (_req, res) => {
    runs += 1;
    await gate;
    res.locals.whmcsWriteAttempted = true;
    res.json({ ok: true, invoiceId: 3001 });
  });

  const { default: http } = await import("node:http");
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const key = "in-flight-ffffff";
  try {
    const firstP = fetch(`http://127.0.0.1:${port}/act`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ pid: 1 }),
    });
    // Give the first request time to claim the key and reach the gate.
    await new Promise((r) => setTimeout(r, 50));
    const second = await fetch(`http://127.0.0.1:${port}/act`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ pid: 1 }),
    });
    assert.equal(second.status, 409, "an in-flight duplicate must be refused");
    release();
    const first = await firstP;
    assert.equal(first.status, 200);
    assert.equal(runs, 1, "the handler body must run only once");
  } finally {
    release();
    server.close();
  }
});

test("a client abort mid-write does NOT free the key — a retry never re-runs the write", async () => {
  __resetIdempotencyStore();
  // The real double-charge risk: the client's 30s timeout aborts the socket
  // WHILE the WHMCS write is in flight. Node keeps the handler running, so the
  // write may still land. A same-key retry must NOT execute the handler again.
  let runs = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).session = { userId: "u1" }; next(); });
  app.post("/act", createIdempotencyMiddleware({ ttlMs: 60_000 }), async (_req, res) => {
    runs += 1;
    // Mimic a real handler: flag the write as attempted, then block as if WHMCS
    // is slow. The client will abort during this window.
    res.locals.whmcsWriteAttempted = true;
    await gate;
    res.json({ ok: true, invoiceId: 9001 });
  });

  const { default: http } = await import("node:http");
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const url = `http://127.0.0.1:${port}/act`;
  const key = "abort-mid-write-gggggg";

  try {
    // First attempt: abort it (simulating the client's timeout) while the write
    // is gated/in-flight.
    const ac = new AbortController();
    const firstP = fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ pid: 1 }),
      signal: ac.signal,
    }).catch((e) => ({ aborted: true, e }));
    await new Promise((r) => setTimeout(r, 50)); // let the handler claim + enter the gate
    ac.abort();
    await firstP; // the client side is done (aborted); the handler keeps running

    // A retry arrives while the original handler is still mid-write: it must be
    // refused (409), NOT executed again.
    await new Promise((r) => setTimeout(r, 30));
    const retryWhileInFlight = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ pid: 1 }),
    });
    assert.equal(retryWhileInFlight.status, 409, "retry during the in-flight write must be refused");
    assert.equal(runs, 1, "the handler must NOT run a second time");

    // Let the original (still-running) write finish. It finalizes the entry.
    release();
    await new Promise((r) => setTimeout(r, 50));

    // A later retry now replays the original result instead of re-charging.
    const retryAfter = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ pid: 1 }),
    });
    const body = await retryAfter.json();
    assert.equal(retryAfter.status, 200);
    assert.equal(body.invoiceId, 9001, "the retry replays the original write's response");
    assert.equal(runs, 1, "still exactly one real execution after everything settles");
  } finally {
    release();
    server.close();
  }
});

test("an abort DURING pre-write validation still frees the key (no write happened)", async () => {
  __resetIdempotencyStore();
  // If the abort lands before the handler ever reaches the WHMCS write, nothing
  // dangerous happened — once the handler finishes its pre-write rejection the
  // key must be freed so a corrected resubmit with the same key can run.
  let runs = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).session = { userId: "u1" }; next(); });
  app.post("/act", createIdempotencyMiddleware({ ttlMs: 60_000 }), async (_req, res) => {
    runs += 1;
    // Slow PRE-write phase (e.g. loading the catalogue); flag NOT set yet.
    await gate;
    res.status(400).json({ ok: false, message: "bad input" });
  });

  const { default: http } = await import("node:http");
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const url = `http://127.0.0.1:${port}/act`;
  const key = "abort-pre-write-hhhhhh";

  try {
    const ac = new AbortController();
    const firstP = fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ pid: 1 }),
      signal: ac.signal,
    }).catch((e) => ({ aborted: true, e }));
    await new Promise((r) => setTimeout(r, 50));
    ac.abort();
    await firstP;

    // Let the original handler finish its pre-write rejection → key is freed.
    release();
    await new Promise((r) => setTimeout(r, 50));

    // A corrected resubmit with the SAME key must be allowed to run.
    const resubmit = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ pid: 1 }),
    });
    assert.equal(resubmit.status, 400);
    assert.equal(runs, 2, "the corrected resubmit runs because no write had happened");
  } finally {
    release();
    server.close();
  }
});

test("isValidIdempotencyKey accepts opaque UUIDs and rejects junk", () => {
  assert.equal(isValidIdempotencyKey("550e8400-e29b-41d4-a716-446655440000"), true);
  assert.equal(isValidIdempotencyKey("idem-abc_def.GHI-123"), true);
  assert.equal(isValidIdempotencyKey(""), false);
  assert.equal(isValidIdempotencyKey("short"), false); // < 8 chars
  assert.equal(isValidIdempotencyKey("has spaces in it"), false);
  assert.equal(isValidIdempotencyKey(undefined), false);
  assert.equal(isValidIdempotencyKey(12345678), false);
});
