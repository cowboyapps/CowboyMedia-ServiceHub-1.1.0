import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

test("attachment navigation cannot enter the shell cache or survive deletion/offline revisit", async () => {
  const handlers = new Map<string, (event: unknown) => void>();
  const entries = new Map<string, Response>();
  const cache = {
    keys: async () => [...entries.keys()].map((url) => new Request(url)),
    match: async (request: Request | string) => entries.get(typeof request === "string" ? request : request.url),
    delete: async (request: Request) => entries.delete(request.url),
    put: async (request: Request | string, response: Response) => {
      entries.set(typeof request === "string" ? new URL(request, "https://app.test").href : request.url, response);
    },
  };
  let offline = false;
  let deleted = false;
  const attachmentUrl = "https://app.test/uploads/private.png";
  const attachment = () => {
    const response = new Response("private file bytes", { headers: { "Content-Type": "image/png" } });
    Object.defineProperty(response, "url", { value: attachmentUrl });
    return response;
  };
  const context = {
    self: {
      location: { origin: "https://app.test" },
      addEventListener: (name: string, cb: (event: unknown) => void) => handlers.set(name, cb),
      clients: { claim: async () => {} },
    },
    caches: {
      keys: async () => ["servicehub-shell-dev"],
      open: async () => cache,
      delete: async () => true,
      match: cache.match,
    },
    fetch: async (_request: Request, options?: RequestInit) => {
      if (_request.url === attachmentUrl) assert.equal(options?.cache, "no-store");
      if (offline) throw new Error("offline");
      return deleted ? new Response("gone", { status: 404 }) : attachment();
    },
    URL, Response, Request, Promise, console,
    // Avoid keeping the test process alive for navigation's losing timeout.
    setTimeout: (cb: () => void, delay: number) => setTimeout(cb, delay).unref(),
  };
  vm.createContext(context);
  vm.runInContext(readFileSync("client/public/sw.js", "utf8"), context);
  const navigate = async () => {
    let response!: Promise<Response>;
    handlers.get("fetch")!({
      request: { url: attachmentUrl, method: "GET", mode: "navigate", headers: new Headers() },
      respondWith: (value: Promise<Response>) => { response = value; },
    });
    return response;
  };
  assert.equal(await (await navigate()).text(), "private file bytes");
  assert.equal(entries.size, 0, "attachment was never cached under /");
  deleted = true;
  assert.equal((await navigate()).status, 404);
  // Simulate a legacy worker's poisoned shell-cache entry.
  entries.set("https://app.test/", attachment());
  offline = true;
  assert.equal((await navigate()).status, 503, "offline attachment navigation fails closed even before purge");
  let activation!: Promise<void>;
  handlers.get("activate")!({ waitUntil: (value: Promise<void>) => { activation = value; } });
  await activation;
  assert.equal(entries.size, 0, "activation removes legacy attachment stored under /");
  offline = false;
  deleted = false;
  const helpers = context as typeof context & { handleNavigation(request: Request): Promise<Response> };
  const documentRequest = new Request("https://app.test/tickets/test");
  await helpers.handleNavigation(documentRequest);
  assert.equal(entries.size, 0, "non-HTML responses cannot replace the offline shell");
  entries.set("/", attachment());
  offline = true;
  assert.equal((await helpers.handleNavigation(documentRequest)).status, 503, "offline shell fallback rejects legacy non-document bytes");
});
