import { after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { setupComponentTestTeardown } from "./helpers/component-test-teardown";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
const w = dom.window;
const g = globalThis as unknown as Record<string, unknown>;
g.window = w; g.document = w.document; g.React = React; g.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(globalThis, "navigator", { value: w.navigator, configurable: true });
for (const key of ["HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLButtonElement", "Element", "Node", "Document", "DocumentFragment", "Event", "CustomEvent", "MouseEvent", "FocusEvent", "KeyboardEvent", "MutationObserver", "NodeFilter"]) {
  g[key] = (w as unknown as Record<string, unknown>)[key];
}
g.getComputedStyle = w.getComputedStyle.bind(w);
g.requestAnimationFrame = (fn: FrameRequestCallback) => setTimeout(fn, 0);
g.cancelAnimationFrame = clearTimeout;

const { createRoot } = await import("react-dom/client");
const { QueryClientProvider } = await import("@tanstack/react-query");
const { queryClient } = await import("../client/src/lib/queryClient");
const { TicketAutoCloseSettingsPanel } = await import("../client/src/components/ticket-auto-close-settings");
const { DEFAULT_TICKET_AUTO_CLOSE_MESSAGE } = await import("../shared/ticket-auto-close");
queryClient.setDefaultOptions({ queries: { retry: false, gcTime: 0 }, mutations: { gcTime: 0 } });
setupComponentTestTeardown({ queryClient });
const originalFetch = globalThis.fetch;
let root: ReturnType<typeof createRoot> | undefined;
let patches: Record<string, unknown>[] = [];
let failLoad = false;
let failSave = false;

afterEach(async () => {
  await act(async () => { root?.unmount(); });
  root = undefined;
  queryClient.clear();
  document.body.innerHTML = "";
});
after(() => { globalThis.fetch = originalFetch; dom.window.close(); });

const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); };
async function mount() {
  patches = []; failLoad = false; failSave = false;
  globalThis.fetch = async (_url, options) => {
    if (options?.method === "PATCH") {
      const body = JSON.parse(String(options.body));
      patches.push(body);
      return new Response(JSON.stringify(failSave ? { message: "Try again later" } : body), { status: failSave ? 500 : 200, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify(failLoad ? { message: "Offline" } : { enabled: false, days: 7, message: DEFAULT_TICKET_AUTO_CLOSE_MESSAGE }), { status: failLoad ? 500 : 200, headers: { "content-type": "application/json" } });
  };
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => { root!.render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(TicketAutoCloseSettingsPanel))); });
  await settle();
}
async function click(selector: string) {
  const element = document.querySelector<HTMLElement>(selector);
  assert.ok(element, `missing ${selector}`);
  await act(async () => { element.click(); });
  await settle();
}
async function fill(selector: string, value: string) {
  const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  assert.ok(element);
  const proto = element.tagName === "TEXTAREA" ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
    element.dispatchEvent(new w.Event("input", { bubbles: true }));
    element.dispatchEvent(new w.Event("change", { bubbles: true }));
  });
}
const save = '[data-testid="button-save-ticket-auto-close"]';

test("admin form loads defaults, shows permanent automated label, validates days and saves only after confirmation", async () => {
  await mount();
  assert.equal((document.querySelector("#ticket-auto-close-days") as HTMLInputElement).value, "7");
  assert.ok(document.querySelector('[aria-label="Preview of the automated customer message"] strong')?.textContent?.includes("Automated Message:"));
  assert.equal((document.querySelector(save) as HTMLButtonElement).disabled, true);
  await fill("#ticket-auto-close-days", "0");
  assert.equal((document.querySelector(save) as HTMLButtonElement).disabled, true);
  await fill("#ticket-auto-close-days", "3");
  await fill("#ticket-auto-close-message", "Please start a new ticket if you need help.");
  await click('[data-testid="switch-ticket-auto-close-enabled"]');
  await click(save);
  assert.equal(patches.length, 0);
  assert.match(document.body.textContent!, /existing open tickets/i);
  await click('[data-testid="button-confirm-ticket-auto-close"]');
  assert.deepEqual(patches, [{ enabled: true, days: 3, message: "Please start a new ticket if you need help." }]);
});

test("failed save preserves the admin's edited message", async () => {
  await mount();
  await fill("#ticket-auto-close-message", "Keep this draft");
  failSave = true;
  await click(save);
  assert.equal((document.querySelector("#ticket-auto-close-message") as HTMLTextAreaElement).value, "Keep this draft");
  assert.match(document.body.textContent!, /weren.t saved/);
  assert.equal(patches.length, 1);
});
