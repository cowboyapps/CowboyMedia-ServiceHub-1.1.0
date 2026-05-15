import { test } from "node:test";
import assert from "node:assert/strict";
import { selectVersionWelcome } from "../shared/version-welcome";

test("selectVersionWelcome: returns null when no published entries exist", () => {
  assert.equal(selectVersionWelcome(null, null), null);
  assert.equal(selectVersionWelcome(null, "5.0"), null);
});

test("selectVersionWelcome: returns null when user already saw the latest", () => {
  assert.equal(
    selectVersionWelcome({ version: "5.1", title: "x" }, "5.1"),
    null,
  );
});

test("selectVersionWelcome: surfaces latest when user has never seen any version", () => {
  const r = selectVersionWelcome({ version: "5.1", title: "Notes" }, null);
  assert.deepEqual(r, { version: "5.1", title: "Notes" });
});

test("selectVersionWelcome: surfaces latest when user's lastSeen is older — not every skipped version", () => {
  // The user skipped 3.0 and 4.0; only 5.1 (the latest published) is offered.
  const r = selectVersionWelcome({ version: "5.1", title: "" }, "2.0");
  assert.deepEqual(r, { version: "5.1", title: "" });
});

test("selectVersionWelcome: empty-string lastSeen behaves like null", () => {
  const r = selectVersionWelcome({ version: "5.1", title: "" }, "");
  assert.deepEqual(r, { version: "5.1", title: "" });
});

test("selectVersionWelcome: missing title coerces to empty string", () => {
  const r = selectVersionWelcome({ version: "5.1", title: undefined as any }, null);
  assert.deepEqual(r, { version: "5.1", title: "" });
});
