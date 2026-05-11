import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPushPayload } from "./push-payload";

test("buildPushPayload: no notificationId → no actions, no notificationId field", () => {
  const out = buildPushPayload({ title: "Hi", body: "Hello", url: "/x", tag: "t1" });
  assert.equal(out.title, "Hi");
  assert.equal(out.body, "Hello");
  assert.equal(out.url, "/x");
  assert.equal(out.tag, "t1");
  assert.equal(out.actions, undefined);
  assert.equal(out.notificationId, undefined);
});

test("buildPushPayload: with notificationId → adds mark-read action and id", () => {
  const out = buildPushPayload(
    { title: "Hi", body: "Hello", url: "/x", tag: "t1" },
    { notificationId: "notif-abc" },
  );
  assert.equal(out.notificationId, "notif-abc");
  assert.deepEqual(out.actions, [{ action: "mark-read", title: "Mark as read" }]);
  // base fields preserved
  assert.equal(out.title, "Hi");
  assert.equal(out.url, "/x");
});

test("buildPushPayload: only one action attached (room for future actions)", () => {
  const out = buildPushPayload({ title: "T", body: "B" }, { notificationId: "x" });
  assert.equal(out.actions?.length, 1);
});

test("buildPushPayload: action title under platform truncation cap (~20 chars)", () => {
  const out = buildPushPayload({ title: "T", body: "B" }, { notificationId: "x" });
  assert.ok((out.actions?.[0].title.length ?? 99) <= 20, "Mark as read should fit");
});

test("buildPushPayload: empty / null notificationId is treated as no-action", () => {
  const a = buildPushPayload({ title: "T", body: "B" }, { notificationId: null });
  const b = buildPushPayload({ title: "T", body: "B" }, { notificationId: "" });
  assert.equal(a.actions, undefined);
  assert.equal(a.notificationId, undefined);
  assert.equal(b.actions, undefined);
  assert.equal(b.notificationId, undefined);
});

test("buildPushPayload: serialised JSON contains the action and id when provided", () => {
  const out = buildPushPayload({ title: "T", body: "B", url: "/u" }, { notificationId: "n1" });
  const parsed = JSON.parse(JSON.stringify(out));
  assert.equal(parsed.notificationId, "n1");
  assert.equal(parsed.actions[0].action, "mark-read");
  assert.equal(parsed.actions[0].title, "Mark as read");
});
