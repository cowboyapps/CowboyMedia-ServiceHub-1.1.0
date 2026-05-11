import { test } from "node:test";
import assert from "node:assert/strict";
import { parseUserAgent, deviceLabel, createPresenceMap } from "./sessions";

test("parseUserAgent: identifies common iPhone Safari", () => {
  const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  const { device, browser } = parseUserAgent(ua);
  assert.equal(device, "iPhone");
  assert.equal(browser, "Safari");
});

test("parseUserAgent: identifies Chrome on Windows", () => {
  const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";
  const { device, browser } = parseUserAgent(ua);
  assert.equal(device, "Windows");
  assert.equal(browser, "Chrome");
});

test("parseUserAgent: identifies Edge over Chrome", () => {
  const ua = "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0";
  const { browser } = parseUserAgent(ua);
  assert.equal(browser, "Edge");
});

test("parseUserAgent: identifies Firefox on Linux", () => {
  const ua = "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0";
  const { device, browser } = parseUserAgent(ua);
  assert.equal(device, "Linux");
  assert.equal(browser, "Firefox");
});

test("parseUserAgent: identifies Android phone", () => {
  const ua = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36";
  const { device, browser } = parseUserAgent(ua);
  assert.equal(device, "Android Phone");
  assert.equal(browser, "Chrome");
});

test("parseUserAgent: handles missing UA", () => {
  assert.deepEqual(parseUserAgent(null), { device: "Unknown", browser: "Unknown" });
  assert.deepEqual(parseUserAgent(undefined), { device: "Unknown", browser: "Unknown" });
  assert.deepEqual(parseUserAgent(""), { device: "Unknown", browser: "Unknown" });
});

test("deviceLabel: combines browser and device", () => {
  assert.equal(deviceLabel("Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36"), "Chrome on Windows");
});

// ---------- Presence map ----------

function makeWs(): any {
  return { id: Math.random() } as any;
}

test("presenceMap: dedupes multi-tab connections", () => {
  let t = 1000;
  const pm = createPresenceMap(() => t);
  const a1 = makeWs(); const a2 = makeWs(); const b1 = makeWs();
  pm.add(a1, "user-A");
  t = 1100;
  pm.add(a2, "user-A");
  t = 1200;
  pm.add(b1, "user-B");

  const snap = pm.snapshot();
  assert.equal(snap.length, 2);
  const a = snap.find(s => s.userId === "user-A")!;
  assert.equal(a.tabs, 2);
  assert.equal(a.connectedAt, 1000);
  const b = snap.find(s => s.userId === "user-B")!;
  assert.equal(b.tabs, 1);
});

test("presenceMap: remove drops user when last tab closes", () => {
  const pm = createPresenceMap();
  const a1 = makeWs(); const a2 = makeWs();
  pm.add(a1, "u");
  pm.add(a2, "u");
  assert.equal(pm.hasUser("u"), true);

  const r1 = pm.remove(a1);
  assert.deepEqual(r1, { userId: "u", remaining: 1 });
  assert.equal(pm.hasUser("u"), true);

  const r2 = pm.remove(a2);
  assert.deepEqual(r2, { userId: "u", remaining: 0 });
  assert.equal(pm.hasUser("u"), false);
  assert.equal(pm.snapshot().length, 0);
});

test("presenceMap: remove on unknown ws returns null", () => {
  const pm = createPresenceMap();
  assert.equal(pm.remove(makeWs()), null);
});

test("presenceMap: setPage updates current page and activity", () => {
  let t = 1000;
  const pm = createPresenceMap(() => t);
  const ws = makeWs();
  pm.add(ws, "u");
  t = 5000;
  pm.setPage(ws, "/admin");
  const snap = pm.snapshot();
  assert.equal(snap[0].page, "/admin");
  assert.equal(snap[0].lastActivityAt, 5000);
});

test("presenceMap: snapshot picks most-recent page across tabs", () => {
  let t = 1000;
  const pm = createPresenceMap(() => t);
  const a = makeWs(); const b = makeWs();
  pm.add(a, "u");
  pm.add(b, "u");
  t = 2000; pm.setPage(a, "/page-old");
  t = 3000; pm.setPage(b, "/page-new");
  const snap = pm.snapshot();
  assert.equal(snap[0].page, "/page-new");
  assert.equal(snap[0].lastActivityAt, 3000);
});

test("presenceMap: getUserId returns the user for a ws", () => {
  const pm = createPresenceMap();
  const ws = makeWs();
  pm.add(ws, "u");
  assert.equal(pm.getUserId(ws), "u");
  pm.remove(ws);
  assert.equal(pm.getUserId(ws), undefined);
});
