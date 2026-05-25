import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { requireAgentToken } from "./agent-auth";

function makeApp() {
  const app = express();
  app.get("/protected", requireAgentToken("TEST_AGENT_TOKEN"), (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

async function hit(app: express.Express, headers: Record<string, string> = {}) {
  const server = app.listen(0);
  try {
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no addr");
    const url = `http://127.0.0.1:${addr.port}/protected`;
    const r = await fetch(url, { headers });
    const body = await r.json().catch(() => null);
    return { status: r.status, body };
  } finally {
    server.close();
  }
}

test("requireAgentToken: 503 when env var is unset (fail-closed)", async () => {
  delete process.env.TEST_AGENT_TOKEN;
  const r = await hit(makeApp());
  assert.equal(r.status, 503);
  assert.match(r.body?.message ?? "", /TEST_AGENT_TOKEN/);
});

test("requireAgentToken: 401 when Authorization header is missing", async () => {
  process.env.TEST_AGENT_TOKEN = "secret-value";
  try {
    const r = await hit(makeApp());
    assert.equal(r.status, 401);
    assert.match(r.body?.message ?? "", /Bearer/);
  } finally {
    delete process.env.TEST_AGENT_TOKEN;
  }
});

test("requireAgentToken: 401 when token does not match", async () => {
  process.env.TEST_AGENT_TOKEN = "secret-value";
  try {
    const r = await hit(makeApp(), { Authorization: "Bearer wrong-value" });
    assert.equal(r.status, 401);
  } finally {
    delete process.env.TEST_AGENT_TOKEN;
  }
});

test("requireAgentToken: 401 when token is the right length but wrong bytes", async () => {
  // Guards the constant-time comparison branch — same length, different content.
  process.env.TEST_AGENT_TOKEN = "abcdefghij";
  try {
    const r = await hit(makeApp(), { Authorization: "Bearer 0123456789" });
    assert.equal(r.status, 401);
  } finally {
    delete process.env.TEST_AGENT_TOKEN;
  }
});

test("requireAgentToken: 200 with correct token + extra-spaces tolerance", async () => {
  process.env.TEST_AGENT_TOKEN = "the-right-secret";
  try {
    const r1 = await hit(makeApp(), { Authorization: "Bearer the-right-secret" });
    assert.equal(r1.status, 200);
    assert.deepEqual(r1.body, { ok: true });
    const r2 = await hit(makeApp(), { Authorization: "Bearer   the-right-secret" });
    assert.equal(r2.status, 200);
  } finally {
    delete process.env.TEST_AGENT_TOKEN;
  }
});
