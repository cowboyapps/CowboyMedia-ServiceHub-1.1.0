import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// Unit test for the sender-side message receipt label that drives the
// "Sent" → "Delivered" → "Read" status shown under a customer's / admin's own
// thread messages. messages-page.tsx pulls in radix UI + browser-only deps at
// import time, so we mount a minimal jsdom environment first (mirrors
// test/messages-admin-gating.test.ts) before importing the pure helper.
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/",
});
const { window } = dom;

type GlobalShim = Record<string, unknown>;
const g = globalThis as unknown as GlobalShim;
const w = window as unknown as GlobalShim;

g.window = window;
g.document = window.document;
g.navigator = window.navigator;
g.getComputedStyle = window.getComputedStyle.bind(window);

const BROWSER_GLOBALS = [
  "HTMLElement", "HTMLTextAreaElement", "HTMLInputElement", "HTMLButtonElement",
  "HTMLSelectElement", "HTMLAnchorElement", "HTMLDivElement",
  "Element", "Node", "Document", "DocumentFragment", "ShadowRoot",
  "Event", "CustomEvent", "MouseEvent", "PointerEvent", "FocusEvent",
  "KeyboardEvent", "InputEvent", "NodeFilter", "DOMException",
] as const;
for (const key of BROWSER_GLOBALS) {
  if (w[key] !== undefined) {
    g[key] = w[key];
  }
}

class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
g.ResizeObserver = ResizeObserverStub;
w.ResizeObserver = ResizeObserverStub;

const matchMediaImpl = (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent() { return false; },
});
g.matchMedia = matchMediaImpl;
w.matchMedia = matchMediaImpl;

const { messageReceiptLabel } = await import("../client/src/pages/messages-page");

const T = new Date("2026-01-01T00:00:00.000Z");

test("messageReceiptLabel: a freshly sent message reads 'Sent'", () => {
  assert.equal(messageReceiptLabel({ deliveredAt: null, readAt: null }), "Sent");
});

test("messageReceiptLabel: a delivered-but-unread message reads 'Delivered'", () => {
  assert.equal(messageReceiptLabel({ deliveredAt: T, readAt: null }), "Delivered");
});

test("messageReceiptLabel: a read message reads 'Read'", () => {
  assert.equal(messageReceiptLabel({ deliveredAt: T, readAt: T }), "Read");
});

test("messageReceiptLabel: readAt wins even if deliveredAt was never set", () => {
  // Reading implies delivery; a thread opened directly can set readAt without
  // a prior delivery flip, and it must still show 'Read', never 'Sent'.
  assert.equal(messageReceiptLabel({ deliveredAt: null, readAt: T }), "Read");
});
