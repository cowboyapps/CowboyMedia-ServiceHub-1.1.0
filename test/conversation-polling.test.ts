import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { conversationPollInterval } from "../client/src/lib/conversation-polling";

const dom = new JSDOM("<!doctype html><body></body>");
Object.assign(globalThis, { window: dom.window, document: dom.window.document, navigator: dom.window.navigator });
const { QueryClient, QueryObserver, focusManager } = await import("@tanstack/react-query");
after(() => { dom.window.close(); });

test("healthy conversations retain a safety poll; missing/connecting/closed sockets use fast recovery", () => {
  assert.equal(conversationPollInterval({ readyState: 1 }), 30_000);
  for (const socket of [null, { readyState: 0 }, { readyState: 2 }, { readyState: 3 }]) {
    assert.equal(conversationPollInterval(socket), 5_000);
  }
});

test("60-second foreground query replay reduces history reads without delaying socket invalidations", async () => {
  const originalSet = globalThis.setInterval, originalClear = globalThis.clearInterval;
  let now = 0, id = 0;
  const timers = new Map<number, { fn: () => void; delay: number; at: number }>();
  globalThis.setInterval = ((fn: () => void, delay: number) => {
    timers.set(++id, { fn, delay, at: now + delay });
    return id;
  }) as unknown as typeof setInterval;
  globalThis.clearInterval = ((timer: number) => { timers.delete(timer); }) as unknown as typeof clearInterval;
  focusManager.setFocused(true);
  const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  async function replay(interval: number) {
    now = 0;
    timers.clear();
    let requests = 0;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const key = ["fixture-history"];
    const observer = new QueryObserver(client, {
      queryKey: key, queryFn: async () => { requests++; return requests; },
      refetchInterval: interval,
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      await settle();
      const initial = requests;
      while (true) {
        const next = [...timers.values()].reduce<number>((min, t) => Math.min(min, t.at), Infinity);
        if (next > 60_000) break;
        now = next;
        const due = [...timers.values()].filter(t => t.at === now);
        for (const timer of due) { timer.at += timer.delay; timer.fn(); }
        await settle();
      }
      const polls = requests - initial;
      await client.invalidateQueries({ queryKey: key });
      assert.equal(requests, initial + polls + 1, "socket changes fetch immediately, not on the next poll");
      focusManager.setFocused(false);
      for (const timer of [...timers.values()]) timer.fn();
      await settle();
      assert.equal(requests, initial + polls + 1, "hidden app does not poll");
      focusManager.setFocused(true);
      return polls;
    } finally { unsubscribe(); client.clear(); }
  }
  try {
    const before = await replay(5_000);
    const healthy = await replay(conversationPollInterval({ readyState: 1 }));
    const disconnected = await replay(conversationPollInterval(null));
    assert.equal(before, 12);
    assert.equal(healthy, 2);
    assert.equal(disconnected, 12);
    console.log("HISTORY_REQUEST_REPLAY", JSON.stringify({ seconds: 60, before, healthy, disconnected }));
  } finally {
    globalThis.setInterval = originalSet;
    globalThis.clearInterval = originalClear;
    focusManager.setFocused(undefined);
  }
});

test("navigation observes the centrally polled badges without creating more recurring timers", () => {
  for (const name of ["bottom-nav", "app-sidebar"]) {
    const source = readFileSync(`client/src/components/${name}.tsx`, "utf8");
    for (const key of ["ticket-notifications/unread-count", "message-threads/unread-count", "report-notifications/unread-count", "content-notifications/counts"]) {
      const block = source.split(`queryKey: ["/api/${key}"]`)[1]?.split("});")[0];
      assert.ok(block, `${name} still observes ${key}`);
      assert.ok(!block.includes("refetchInterval"), `${name} does not poll ${key} independently`);
    }
  }
  const owner = readFileSync("client/src/hooks/use-app-badge.ts", "utf8");
  assert.equal((owner.match(/refetchInterval: 15000/g) ?? []).length, 4);
});
