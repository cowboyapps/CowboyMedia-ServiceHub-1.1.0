// The Admin Portal is a separate PWA at /admin (Task: admin app split).
// The customer shell must not advertise it: no sidebar entry, no bottom-nav
// overflow item, no command-palette quick action pointing into /admin.
// These are source-level guards so a reintroduced link fails fast in CI
// without needing a full jsdom render of the shell.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const COMPONENTS = path.resolve(import.meta.dirname, "../client/src/components");

// Matches an /admin URL literal used as a link target (url: "/admin",
// href="/admin", navigate("/admin"), including deep links like
// "/admin?tab=..."). Prose in comments doesn't quote the path, so this
// stays quiet on explanatory comments.
const ADMIN_LINK = /["'`]\/admin(?:[/?#][^"'`]*)?["'`]/;

for (const file of ["app-sidebar.tsx", "bottom-nav.tsx"]) {
  test(`${file} contains no /admin link target`, () => {
    const src = readFileSync(path.join(COMPONENTS, file), "utf8");
    const match = src.match(ADMIN_LINK);
    assert.equal(
      match,
      null,
      `customer shell component ${file} must not link into the admin app (found ${match?.[0]})`,
    );
  });
}

test("command-palette quick actions contain no /admin link target", async () => {
  // The palette legitimately references the "/admin" prefix once, in
  // filterRecentsForRole (defensively dropping stale admin recents), so a
  // whole-file scan would false-positive; assert on the data instead.
  const src = readFileSync(path.join(COMPONENTS, "command-palette.tsx"), "utf8");
  const quickActionsBlock = src.match(/QUICK_ACTIONS[^=]*=\s*\[[\s\S]*?\];/)?.[0];
  assert.ok(quickActionsBlock, "expected to find the QUICK_ACTIONS array literal");
  assert.equal(
    ADMIN_LINK.test(quickActionsBlock),
    false,
    "customer command palette must not offer quick actions into the admin app",
  );
});
