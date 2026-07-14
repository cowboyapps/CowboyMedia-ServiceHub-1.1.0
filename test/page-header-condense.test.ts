import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).navigator = dom.window.navigator;
(globalThis as any).React = React;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

type IOCallback = (entries: Array<{ isIntersecting: boolean }>) => void;
let lastObserver: { callback: IOCallback; root: Element | null; observed: Element[] } | null = null;

class MockIntersectionObserver {
  callback: IOCallback;
  root: Element | null;
  constructor(cb: IOCallback, options?: { root?: Element | null }) {
    this.callback = cb;
    this.root = options?.root ?? null;
    lastObserver = { callback: cb, root: this.root, observed: [] };
  }
  observe(el: Element) {
    lastObserver!.observed.push(el);
  }
  disconnect() {}
}
(globalThis as any).IntersectionObserver = MockIntersectionObserver;
(dom.window as any).IntersectionObserver = MockIntersectionObserver;

const { PageHeader } = await import("../client/src/components/page-header");

let container: HTMLDivElement;
let scroller: HTMLDivElement;
let root: Root;

beforeEach(() => {
  lastObserver = null;
  scroller = document.createElement("div");
  scroller.id = "app-scroll-container";
  container = document.createElement("div");
  scroller.appendChild(container);
  document.body.appendChild(scroller);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  scroller.remove();
});

test("observer is anchored to the app scroll container, not the viewport", async () => {
  await act(async () => {
    root.render(React.createElement(PageHeader, { title: "Settings", testId: "text-settings-title" }));
  });
  assert.ok(lastObserver, "IntersectionObserver should be created");
  assert.equal(lastObserver!.root, scroller, "observer root must be #app-scroll-container");
  assert.equal(lastObserver!.observed.length, 1, "large title block should be observed");
});

test("compact bar condenses when the large title leaves the scroller and expands when it returns", async () => {
  await act(async () => {
    root.render(React.createElement(PageHeader, { title: "Service Alerts" }));
  });
  const bar = () => container.querySelector('[aria-hidden]') as HTMLElement;
  assert.equal(bar().getAttribute("aria-hidden"), "true", "compact bar hidden initially");
  assert.match(bar().className, /opacity-0/);

  await act(async () => {
    lastObserver!.callback([{ isIntersecting: false }]);
  });
  assert.equal(bar().getAttribute("aria-hidden"), "false", "compact bar shown once title scrolled out");
  assert.match(bar().className, /opacity-100/);

  await act(async () => {
    lastObserver!.callback([{ isIntersecting: true }]);
  });
  assert.equal(bar().getAttribute("aria-hidden"), "true", "compact bar hides again at top");
  assert.match(bar().className, /opacity-0/);
});
