import { after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import type { Ticket } from "../shared/schema";
import { setupComponentTestTeardown } from "./helpers/component-test-teardown";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
const w = dom.window;
const g = globalThis as unknown as Record<string, unknown>;
g.window = w; g.document = w.document; g.React = React; g.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(globalThis, "navigator", { value: w.navigator, configurable: true });
for (const key of ["HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLButtonElement", "Element", "Node", "Document", "DocumentFragment", "Event", "CustomEvent", "MouseEvent", "MutationObserver"]) {
  g[key] = (w as unknown as Record<string, unknown>)[key];
}
const { createRoot } = await import("react-dom/client");
const { QueryClientProvider } = await import("@tanstack/react-query");
const { queryClient } = await import("../client/src/lib/queryClient");
const { TicketAutoCloseHold } = await import("../client/src/components/ticket/auto-close-hold");
queryClient.setDefaultOptions({ queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } });
setupComponentTestTeardown({ queryClient });
const originalFetch = globalThis.fetch;
let root: ReturnType<typeof createRoot> | undefined;
let patches: unknown[] = [];
let failSave = false;
const base = { id: "hold-ticket", status: "open", autoCloseHoldReason: null, autoCloseHoldUntil: null, autoCloseHoldBy: null, autoCloseHoldAt: null } as Ticket;
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); };
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = undefined;
  queryClient.clear();
  document.body.innerHTML = "";
});
after(() => { globalThis.fetch = originalFetch; dom.window.close(); });
async function mount(ticket = base, isAdmin = true) {
  patches = []; failSave = false;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    patches.push(body);
    return new Response(JSON.stringify(failSave ? { message: "Access changed. Please refresh." } : ticket), { status: failSave ? 403 : 200, headers: { "content-type": "application/json" } });
  };
  const container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  await act(async () => { root!.render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(TicketAutoCloseHold, { ticket, isAdmin }))); });
  await settle();
}
const selector = (name: string) => `[data-testid="${name}"]`;
async function click(name: string) {
  const element = document.querySelector<HTMLElement>(selector(name)); assert.ok(element, name);
  await act(async () => { element.click(); }); await settle();
}
async function fill(name: string, value: string) {
  const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector(name)); assert.ok(element);
  const proto = element.tagName === "TEXTAREA" ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
    element.dispatchEvent(new w.Event("input", { bubbles: true }));
  });
}
test("admin requires a reason, saves indefinite hold and explains expiry/removal consequences", async () => {
  await mount();
  await click("button-add-auto-close-hold");
  assert.match(document.body.textContent!, /original inactivity clock/);
  assert.match(document.body.textContent!, /Manual closure and the global auto-close setting are unchanged/);
  await click("button-save-auto-close-hold");
  assert.equal(patches.length, 0);
  assert.match(document.querySelector('[role="alert"]')!.textContent!, /Enter a reason/);
  await fill("input-auto-close-hold-reason", "  Awaiting provider  ");
  await click("button-save-auto-close-hold");
  assert.deepEqual(patches, [{ enabled: true, reason: "Awaiting provider", expiresAt: null }]);
});
test("admin can set a future expiry but cannot set a past expiry", async () => {
  await mount(); await click("button-add-auto-close-hold");
  await fill("input-auto-close-hold-reason", "Investigating");
  await fill("input-auto-close-hold-expiry", "2020-01-01T12:00");
  await click("button-save-auto-close-hold");
  assert.equal(patches.length, 0);
  assert.match(document.querySelector('[role="alert"]')!.textContent!, /future/);
  await fill("input-auto-close-hold-expiry", "2099-06-01T12:00");
  await click("button-save-auto-close-hold");
  assert.deepEqual(patches, [{ enabled: true, reason: "Investigating", expiresAt: new Date("2099-06-01T12:00").toISOString() }]);
});
test("active hold shows reason, can be edited and removed", async () => {
  await mount({ ...base, autoCloseHoldReason: "Provider wait" });
  assert.match(document.body.textContent!, /Auto-close paused/);
  assert.match(document.body.textContent!, /Provider wait/);
  await click("button-edit-auto-close-hold");
  await fill("input-auto-close-hold-reason", "Escalated");
  await click("button-save-auto-close-hold");
  assert.deepEqual(patches[0], { enabled: true, reason: "Escalated", expiresAt: null });
  await click("button-remove-auto-close-hold");
  assert.deepEqual(patches[1], { enabled: false });
});
test("failed saves preserve draft and show actionable errors", async () => {
  await mount(); await click("button-add-auto-close-hold");
  await fill("input-auto-close-hold-reason", "Keep this reason");
  failSave = true;
  await click("button-save-auto-close-hold");
  assert.match(document.querySelector('[role="alert"]')!.textContent!, /Access changed/);
  assert.equal((document.querySelector(selector("input-auto-close-hold-reason")) as HTMLTextAreaElement).value, "Keep this reason");
});
test("expired hold offers renewal; customers see indicator without management controls", async () => {
  await mount({ ...base, autoCloseHoldReason: "Old hold", autoCloseHoldUntil: new Date("2020-01-01") });
  assert.match(document.body.textContent!, /Hold expired/);
  assert.match(document.body.textContent!, /Renew hold/);
});
test("customers see active hold only and cannot change it", async () => {
  await mount({ ...base, autoCloseHoldReason: "Provider wait" }, false);
  assert.match(document.body.textContent!, /Auto-close paused/);
  assert.equal(document.querySelector("button"), null);
});
test("ordinary customer tickets have no empty hold panel", async () => {
  await mount(base, false);
  assert.equal(document.querySelector("section"), null);
});
test("closed tickets have no hold controls", async () => {
  await mount({ ...base, status: "closed", autoCloseHoldReason: "Provider wait" });
  assert.equal(document.querySelector("section"), null);
});
