import { after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { setupComponentTestTeardown } from "./helpers/component-test-teardown";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
const globals = globalThis as unknown as Record<string, unknown>;
globals.window = dom.window; globals.document = dom.window.document; globals.React = React;
globals.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
const { createRoot } = await import("react-dom/client");
const { QueryClientProvider } = await import("@tanstack/react-query");
const { queryClient } = await import("../client/src/lib/queryClient");
const { TicketReminderHistory } = await import("../client/src/components/ticket-reminder-history");
queryClient.setDefaultOptions({ queries: { ...queryClient.getDefaultOptions().queries, retry: false, gcTime: 0 } });
setupComponentTestTeardown({ queryClient, window: dom.window });
const originalFetch = globalThis.fetch;
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  queryClient.clear();
  document.body.innerHTML = "";
});
after(() => { globalThis.fetch = originalFetch; });
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); }); };

async function mount(data: unknown, status = 200) {
  globalThis.fetch = async request => {
    assert.equal(request, "/api/admin/tickets/ticket-1/reminder-history");
    return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  };
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(React.createElement(QueryClientProvider, { client: queryClient },
    React.createElement(TicketReminderHistory, { ticketId: "ticket-1" }))));
  await settle();
}

test("history shows channel outcomes, cycle, attempt count and cautious retry explanation", async () => {
  await mount(["succeeded", "failed", "attempted"].map((status, n) => ({
    id: `${n}`, channel: ["in_app", "email", "push"][n], attempt: n + 1, status,
    detail: ["In-app reminder saved.", "Rate limited.", "Outcome unknown."][n],
    activityAt: "2026-11-01T10:00:00Z", attemptedAt: "2026-11-08T09:00:00Z",
    finishedAt: status === "attempted" ? null : "2026-11-08T09:00:01Z",
    retryable: status === "failed", retryAt: status === "failed" ? "2026-11-08T09:05:00Z" : null,
  })));
  const text = document.body.textContent!;
  for (const expected of ["In-app", "Email", "Push", "Succeeded", "Failed", "Attempted · unconfirmed", "Attempt 3", "Activity cycle:", "Retry eligible after", "same activity cycle", "not read by the customer", "Outcome unknown."]) {
    assert.ok(text.includes(expected), expected);
  }
});

test("history has explicit empty and failed-load states with working reload", async () => {
  await mount({ message: "Offline" }, 500);
  assert.match(document.body.textContent!, /Could not load delivery history/);
  globalThis.fetch = async () => new Response("[]", { headers: { "content-type": "application/json" } });
  const button = [...document.querySelectorAll("button")].find(b => b.textContent === "Try again")!;
  await act(async () => button.click());
  await settle();
  assert.match(document.body.textContent!, /No reminder attempts recorded/);
});

test("a historical rate limit no longer advertises a retry after a successful later attempt", async () => {
  const record = { channel: "email", activityAt: "2026-11-01T10:00:00Z", attemptedAt: "2026-11-08T09:00:00Z", finishedAt: "2026-11-08T09:00:01Z" };
  await mount([
    { ...record, id: "success", attempt: 2, status: "succeeded", detail: "Accepted.", retryable: false, retryAt: null },
    { ...record, id: "rejected", attempt: 1, status: "failed", detail: "Rate limited.", retryable: true, retryAt: "2026-11-08T09:05:00Z" },
  ]);
  assert.match(document.body.textContent!, /A later attempt was recorded/);
  assert.doesNotMatch(document.body.textContent!, /Retry eligible after/);
});
