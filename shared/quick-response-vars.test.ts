import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyQuickResponseVariables,
  nextRecentList,
  QUICK_RESPONSE_VARIABLES,
  recordQuickResponseInsertion,
} from "./quick-response-vars";

test("substitutes known variables", () => {
  const out = applyQuickResponseVariables(
    "Hi {{customer_name}}, regarding {{ticket_subject}} — {{admin_name}}",
    { customer_name: "Alice", ticket_subject: "Login bug", admin_name: "Bob" },
  );
  assert.equal(out, "Hi Alice, regarding Login bug — Bob");
});

test("handles whitespace inside placeholder", () => {
  const out = applyQuickResponseVariables("Hello {{  customer_name  }}", {
    customer_name: "Eve",
  });
  assert.equal(out, "Hello Eve");
});

test("leaves missing variables as placeholder", () => {
  const out = applyQuickResponseVariables("Hi {{customer_name}}", {});
  assert.equal(out, "Hi {{customer_name}}");
});

test("treats null/undefined as missing (keeps placeholder, not empty string)", () => {
  const out = applyQuickResponseVariables("Hi {{customer_name}} - {{admin_name}}", {
    customer_name: null,
    admin_name: undefined,
  });
  assert.equal(out, "Hi {{customer_name}} - {{admin_name}}");
});

test("treats blank/whitespace-only values as missing", () => {
  const out = applyQuickResponseVariables("Hi {{customer_name}}", { customer_name: "   " });
  assert.equal(out, "Hi {{customer_name}}");
});

test("trims surrounding whitespace from values", () => {
  const out = applyQuickResponseVariables("Hi {{customer_name}}", { customer_name: "  Pat  " });
  assert.equal(out, "Hi Pat");
});

test("ignores unknown variable keys", () => {
  const out = applyQuickResponseVariables("Hi {{evil}} {{customer_name}}", {
    customer_name: "X",
  });
  assert.equal(out, "Hi {{evil}} X");
});

test("handles repeated placeholders", () => {
  const out = applyQuickResponseVariables(
    "{{customer_name}} / {{customer_name}}",
    { customer_name: "Sam" },
  );
  assert.equal(out, "Sam / Sam");
});

test("returns empty string for empty template", () => {
  assert.equal(applyQuickResponseVariables("", { customer_name: "X" }), "");
});

test("does not crash on numeric/non-string values", () => {
  const out = applyQuickResponseVariables("Hi {{customer_name}}", {
    customer_name: 42 as unknown as string,
  });
  assert.equal(out, "Hi 42");
});

test("nextRecentList prepends, dedupes, and caps", () => {
  assert.deepEqual(nextRecentList([], "a"), ["a"]);
  assert.deepEqual(nextRecentList(["b", "c"], "a"), ["a", "b", "c"]);
  assert.deepEqual(nextRecentList(["a", "b"], "a"), ["a", "b"]);
  assert.deepEqual(nextRecentList(["b", "c", "a"], "a"), ["a", "b", "c"]);
  assert.deepEqual(nextRecentList(["b", "c", "d", "e", "f"], "a"), ["a", "b", "c", "d", "e"]);
});

test("recordQuickResponseInsertion: does NOT bump or update recent when insertion is cancelled", () => {
  let bumped: string | null = null;
  let savedRecent: string[] | null = null;
  let closed = false;
  recordQuickResponseInsertion({
    inserted: false,
    id: "qr-1",
    recent: ["x"],
    bumpUsage: (id) => { bumped = id; },
    saveRecent: (next) => { savedRecent = next; },
    closePicker: () => { closed = true; },
  });
  assert.equal(bumped, null);
  assert.equal(savedRecent, null);
  assert.equal(closed, false);
});

test("recordQuickResponseInsertion: bumps usage, updates recent, closes picker on success", () => {
  let bumped: string | null = null;
  let savedRecent: string[] | null = null;
  let closed = false;
  recordQuickResponseInsertion({
    inserted: true,
    id: "qr-1",
    recent: ["b", "c"],
    bumpUsage: (id) => { bumped = id; },
    saveRecent: (next) => { savedRecent = next; },
    closePicker: () => { closed = true; },
  });
  assert.equal(bumped, "qr-1");
  assert.deepEqual(savedRecent, ["qr-1", "b", "c"]);
  assert.equal(closed, true);
});

test("variable list contains the documented placeholders", () => {
  assert.deepEqual([...QUICK_RESPONSE_VARIABLES].sort(), [
    "admin_name",
    "customer_name",
    "ticket_subject",
  ]);
});
