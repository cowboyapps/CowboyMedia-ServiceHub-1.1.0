import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createStaleDeployReloadHandler,
  recoverFromStaleDeploy,
} from "../client/src/lib/stale-deploy";

test("createStaleDeployReloadHandler reloads on first SW_RELOAD_REQUIRED", () => {
  let reloads = 0;
  let cleared = 0;
  const handler = createStaleDeployReloadHandler({
    reload: () => reloads++,
    clearSplash: () => cleared++,
  });
  handler({ data: { type: "SW_RELOAD_REQUIRED", reason: "asset-404" } });
  assert.equal(reloads, 1);
  assert.equal(cleared, 1);
});

test("createStaleDeployReloadHandler reloads exactly once even when fired repeatedly", () => {
  let reloads = 0;
  const handler = createStaleDeployReloadHandler({ reload: () => reloads++ });
  handler({ data: { type: "SW_RELOAD_REQUIRED", reason: "a" } });
  handler({ data: { type: "SW_RELOAD_REQUIRED", reason: "b" } });
  handler({ data: { type: "SW_RELOAD_REQUIRED", reason: "c" } });
  assert.equal(reloads, 1);
});

test("createStaleDeployReloadHandler ignores unrelated messages", () => {
  let reloads = 0;
  const handler = createStaleDeployReloadHandler({ reload: () => reloads++ });
  handler({ data: null });
  handler({ data: "string-message" });
  handler({ data: { type: "PONG" } });
  handler({ data: { type: "SW_OTHER" } });
  assert.equal(reloads, 0);
});

test("createStaleDeployReloadHandler still reloads when clearSplash throws", () => {
  let reloads = 0;
  const handler = createStaleDeployReloadHandler({
    reload: () => reloads++,
    clearSplash: () => {
      throw new Error("session storage blocked");
    },
  });
  handler({ data: { type: "SW_RELOAD_REQUIRED" } });
  assert.equal(reloads, 1);
});

test("recoverFromStaleDeploy unregisters service workers, clears caches, then reloads", async () => {
  const unregistered: number[] = [];
  const deletedKeys: string[] = [];
  let reloaded = 0;

  await recoverFromStaleDeploy({
    serviceWorker: {
      getRegistrations: async () => [
        { unregister: async () => { unregistered.push(1); return true; } },
        { unregister: async () => { unregistered.push(2); return true; } },
      ],
    },
    caches: {
      keys: async () => ["shell-v1", "assets-v1", "api-v1"],
      delete: async (k) => { deletedKeys.push(k); return true; },
    },
    reload: () => reloaded++,
  });

  assert.deepEqual(unregistered.sort(), [1, 2]);
  assert.deepEqual(deletedKeys.sort(), ["api-v1", "assets-v1", "shell-v1"]);
  assert.equal(reloaded, 1);
});

test("recoverFromStaleDeploy still reloads if unregister rejects", async () => {
  let reloaded = 0;
  let cachesDeleted = 0;
  await recoverFromStaleDeploy({
    serviceWorker: {
      getRegistrations: async () => [
        { unregister: async () => { throw new Error("nope"); } },
      ],
    },
    caches: {
      keys: async () => ["shell-v1"],
      delete: async () => { cachesDeleted++; return true; },
    },
    reload: () => reloaded++,
  });
  assert.equal(cachesDeleted, 1);
  assert.equal(reloaded, 1);
});

test("recoverFromStaleDeploy still reloads if everything throws", async () => {
  let reloaded = 0;
  await recoverFromStaleDeploy({
    serviceWorker: {
      getRegistrations: async () => { throw new Error("blocked"); },
    },
    caches: {
      keys: async () => { throw new Error("blocked"); },
      delete: async () => true,
    },
    reload: () => reloaded++,
  });
  assert.equal(reloaded, 1);
});

test("recoverFromStaleDeploy reloads even when SW + caches APIs are missing", async () => {
  let reloaded = 0;
  await recoverFromStaleDeploy({ reload: () => reloaded++ });
  assert.equal(reloaded, 1);
});
