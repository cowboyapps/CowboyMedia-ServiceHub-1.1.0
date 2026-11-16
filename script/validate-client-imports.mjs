// Evaluate production ESM chunks without signing in or calling application APIs.
// Run with: node --experimental-vm-modules script/validate-client-imports.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { JSDOM } from "jsdom";

export async function validateClientImports(publicDirectory) {
  const html = await readFile(path.join(publicDirectory, "index.html"), "utf8");
  const entry = html.match(/<script\b[^>]*\bsrc="([^"]+\.js)"/)?.[1];
  assert.ok(entry, "Production HTML must reference a JavaScript entry");
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
    url: "https://client-import-check.invalid/", pretendToBeVisual: true,
  });
  const window = dom.window;
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  // Do not mount the app or run background effects. This checks module
  // initialization, not UI rendering, authentication or any application data.
  window.setTimeout = window.setInterval = () => 0;
  class Observer { observe() {} unobserve() {} disconnect() {} }
  const context = vm.createContext({
    window, self: window, document: window.document, navigator: window.navigator,
    localStorage: window.localStorage, sessionStorage: window.sessionStorage,
    location: window.location, history: window.history,
    console, URL: window.URL, Request, Response, Headers, AbortController,
    TextEncoder, TextDecoder, performance, queueMicrotask: () => {},
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
    getComputedStyle: window.getComputedStyle.bind(window),
    MutationObserver: window.MutationObserver, HTMLElement: window.HTMLElement,
    Element: window.Element, Node: window.Node, ResizeObserver: Observer, IntersectionObserver: Observer,
    fetch: async () => { throw new Error("Production import checks must not make API calls"); },
  });
  const modules = new Map();
  const reads = new Map();
  const sources = new Map();
  async function load(url) {
    const filename = path.resolve(publicDirectory, "." + url.pathname);
    assert.ok(filename.startsWith(path.resolve(publicDirectory) + path.sep), "Import must remain in the build");
    if (modules.has(filename)) return modules.get(filename);
    if (reads.has(filename)) return reads.get(filename);
    const pending = (async () => {
      const source = await readFile(filename, "utf8");
      sources.set(url.href, source);
      const module = new vm.SourceTextModule(source, {
        context, identifier: url.href,
        initializeImportMeta(meta) { meta.url = url.href; },
        importModuleDynamically: async (specifier, parent) => evaluate(new URL(specifier, parent.identifier)),
      });
      modules.set(filename, module);
      return module;
    })();
    reads.set(filename, pending);
    return pending;
  }
  async function evaluate(url) {
    const module = await load(url);
    if (module.status === "unlinked") {
      await module.link((specifier, parent) => load(new URL(specifier, parent.identifier)));
    }
    if (module.status === "linked") await module.evaluate();
    if (module.status === "errored") throw module.error;
    return module;
  }
  try {
    const entryUrl = new URL(entry, window.location.origin);
    await evaluate(entryUrl);
    // Match real startup order: initialize the shell BEFORE opening a lazy page.
    // Each route gets evaluated even when another page already initialized its
    // shared dependencies.
    const source = sources.get(entryUrl.href);
    const routes = [...new Set([...source.matchAll(/import\(["']([^"']+\.js)["']\)/g)].map(match => match[1]))];
    assert.ok(routes.some(route => route.includes("admin-portal-")), "Check must exercise the Admin Portal");
    assert.ok(routes.some(route => route.includes("ticket-detail-")), "Check must exercise ticket notifications");
    // Reproduce a fresh app opening Admin first, before another lazy page can
    // accidentally initialize a circular dependency and mask the failure.
    routes.sort((a, b) => Number(!a.includes("admin-portal-")) - Number(!b.includes("admin-portal-")));
    for (const route of routes) {
      try {
        await evaluate(new URL(route, entryUrl));
      } catch (error) {
        throw new Error(`Production page import failed: ${route}`, { cause: error });
      }
    }
    return routes.length;
  } finally {
    window.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try {
    const count = await validateClientImports(path.resolve(process.argv[2] || "dist/public"));
    console.log(`Production page imports passed (${count} lazy pages).`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
