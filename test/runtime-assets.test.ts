import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const trackedFiles = new Set(
  execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  }).split("\0").filter(Boolean),
);
const assetReferences = new Map<string, Set<string>>();

// Keep this directory in sync with Vite's @assets alias. Test the Git index,
// not just disk presence: upload files can exist locally but be absent in a
// fresh deployment checkout.
for (const source of trackedFiles) {
  if (!source.startsWith("client/") || !/\.(?:tsx?|css|html)$/.test(source)) continue;
  const contents = readFileSync(path.join(root, source), "utf8");
  for (const match of contents.matchAll(/["']@assets\/([^"']+)["']/g)) {
    const asset = path.posix.join("attached_assets", match[1]);
    const sources = assetReferences.get(asset) ?? new Set<string>();
    sources.add(source);
    assetReferences.set(asset, sources);
  }
}

for (const [asset, sources] of assetReferences) {
  test(`runtime asset is present and tracked: ${asset}`, () => {
    const context = `Required by ${[...sources].join(", ")}`;
    assert.ok(existsSync(path.join(root, asset)), `${asset} is missing. ${context}`);
    assert.ok(
      trackedFiles.has(asset),
      `${asset} exists locally but is missing from Git; fresh checkouts cannot build. ${context}`,
    );
  });
}
