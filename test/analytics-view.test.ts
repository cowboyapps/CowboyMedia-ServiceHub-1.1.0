import { after, test } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { useAnalyticsView } from "../client/src/hooks/use-analytics-view";

const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost" });
const g = globalThis as unknown as Record<string, unknown>;
g.React = React; g.window = dom.window; g.document = dom.window.document; g.IS_REACT_ACT_ENVIRONMENT = true;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
const { createRoot } = await import("react-dom/client");
const root = createRoot(document.getElementById("root")!);
const calls: unknown[][] = [];
window.umami = { track: (...args) => { calls.push(args); } };
function View({ id }: { id?: string }) {
  useAnalyticsView("service_alert_viewed", id);
  return null;
}
async function render(id?: string) {
  await act(async () => { root.render(React.createElement(React.StrictMode, null, React.createElement(View, { id }))); });
}
after(async () => { await act(async () => root.unmount()); dom.window.close(); });

test("views wait for successful data, ignore background refreshes and StrictMode replay, but count another visit", async () => {
  await render();
  assert.equal(calls.length, 0);
  await render("local-alert-id");
  await render("local-alert-id");
  assert.equal(calls.length, 1);
  await render("another-local-id");
  assert.equal(calls.length, 2);
  await render();
  await render("another-local-id");
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0], ["service_alert_viewed", {}]);
  assert.ok(!JSON.stringify(calls).includes("local"));
});
