import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverPageImport } from "../client/src/lib/page-load-recovery";

test("a notification route reload is guarded across page loads and keeps its exact destination", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const destination = "/tickets/ticket-42?message=reply-7#latest";
  let reloads = 0;
  const deps = { storage, destination, online: true, reload: () => { reloads++; }, now: 100_000 };
  assert.equal(recoverPageImport(deps), true);
  assert.equal(reloads, 1);
  assert.ok(values.has(`servicehub-page-recovery:${destination}`), "guard belongs to the exact ticket address");
  assert.equal(recoverPageImport({ ...deps, now: 100_001 }), false, "guard survives a new callback/page instance");
  assert.equal(reloads, 1);
  assert.equal(recoverPageImport({ ...deps, now: 160_001 }), true, "a later deploy can recover again");
});

test("offline or blocked session storage never triggers an automatic reload loop", () => {
  let reloads = 0;
  const storage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  const deps = { storage, destination: "/tickets/example", online: false, reload: () => { reloads++; } };
  assert.equal(recoverPageImport(deps), false);
  assert.equal(recoverPageImport({ ...deps, online: true }), false);
  assert.equal(reloads, 0);
});
