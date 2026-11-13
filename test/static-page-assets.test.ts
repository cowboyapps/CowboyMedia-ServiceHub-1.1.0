import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { serveStatic } from "../server/static";

test("missing page bundles return uncached 404 while direct ticket routes still receive fresh HTML", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "servicehub-static-"));
  const app = express();
  const server = createServer(app);
  try {
    await mkdir(path.join(directory, "assets"));
    await writeFile(path.join(directory, "index.html"), "<!doctype html><title>ServiceHub</title>");
    await writeFile(path.join(directory, "assets/ticket-detail-AbCdEf12.js"), "export default {}");
    serveStatic(app, directory);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}`;
    const missing = await fetch(`${base}/assets/ticket-detail-Obsolete.js`);
    assert.equal(missing.status, 404);
    assert.match(missing.headers.get("Content-Type")!, /text\/plain/);
    assert.equal(missing.headers.get("Cache-Control"), "no-store");
    assert.doesNotMatch(await missing.text(), /<!doctype html>/i);
    for (const route of ["/", "/index.html", "/tickets/ticket-42?message=reply-7"]) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      assert.match(await response.text(), /ServiceHub/);
    }
    const bundle = await fetch(`${base}/assets/ticket-detail-AbCdEf12.js`);
    assert.equal(bundle.status, 200);
    assert.match(bundle.headers.get("Content-Type")!, /javascript/);
    assert.equal(await bundle.text(), "export default {}");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
