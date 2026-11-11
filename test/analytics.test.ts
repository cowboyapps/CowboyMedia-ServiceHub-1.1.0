import { after, test } from "node:test";
import assert from "node:assert/strict";
import { trackEvent, trackOutcome, type AnalyticsData } from "../client/src/lib/analytics";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
function browser(umami?: Window["umami"]) {
  Object.defineProperty(globalThis, "window", { value: { umami }, configurable: true, writable: true });
}
after(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

test("server rendering and missing tracker are safe no-ops", () => {
  Reflect.deleteProperty(globalThis, "window");
  assert.doesNotThrow(() => trackEvent("service_alert_viewed"));
  assert.doesNotThrow(() => trackOutcome("support_message_sent", "server-id"));
  browser();
  assert.doesNotThrow(() => trackEvent("knowledge_article_viewed"));
});

test("only fixed categorical properties are sent; free text, identifiers and malformed values are discarded", () => {
  const calls: unknown[][] = [];
  browser({ track: (...args) => { calls.push(args); } });
  trackEvent("support_message_sent", {
    actor_type: "customer", has_attachment: true, internal: false,
    message: "Sensitive message", ticket_id: "private-id", filename: "private-file.mp4",
    email: "private@example.test", url: "/tickets/private-id",
  } as AnalyticsData);
  assert.deepEqual(calls, [["support_message_sent", { actor_type: "customer", has_attachment: true, internal: false }]]);
  trackEvent("private_message_sent", { actor_type: "private@example.test", attachment_kind: "private.mp4", has_attachment: "text", message_channel: "private content" } as unknown as AnalyticsData);
  assert.deepEqual(calls[1], ["private_message_sent", {}]);
});

test("synchronous and asynchronous tracker failures never escape", async () => {
  browser({ track: () => { throw new Error("tracker offline"); } });
  assert.doesNotThrow(() => trackEvent("support_ticket_created"));
  assert.doesNotThrow(() => trackOutcome("support_ticket_created", "success-id"));
  browser({ track: async () => { throw new Error("async tracker offline"); } });
  trackEvent("attachment_download_requested", { attachment_kind: "video" });
  await new Promise(resolve => setTimeout(resolve, 0));
});

test("successful retries count once, local deduplication identifiers are never transmitted", () => {
  const calls: unknown[][] = [];
  browser({ track: (...args) => { calls.push(args); } });
  trackOutcome("private_message_sent", "sensitive-local-id", { has_attachment: true });
  trackOutcome("private_message_sent", "sensitive-local-id", { has_attachment: true });
  trackOutcome("private_message_sent", undefined);
  assert.deepEqual(calls, [["private_message_sent", { has_attachment: true }]]);
  assert.ok(!JSON.stringify(calls).includes("sensitive-local-id"));
});

test("no tracker means no replay queue; bounded deduplication cannot grow indefinitely", () => {
  browser();
  trackOutcome("support_message_sent", "not-queued");
  let count = 0;
  browser({ track: () => { count++; } });
  trackOutcome("support_message_sent", "not-queued");
  assert.equal(count, 1);
  for (let i = 0; i < 501; i++) trackOutcome("support_message_sent", `bounded-${i}`);
  trackOutcome("support_message_sent", "not-queued");
  assert.equal(count, 503, "oldest in-memory key is evicted");
});
