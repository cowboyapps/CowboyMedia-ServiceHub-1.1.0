import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyQuickResponseVariables,
  findUnfilledPlaceholders,
  findUnknownPlaceholders,
  nextRecentList,
  QUICK_RESPONSE_VARIABLES,
  quickResponseHasMissingVariables,
  recordQuickResponseInsertion,
  tokenizeQuickResponseTemplate,
  walkPlaceholderOverlay,
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

test("tokenize: splits template into text/filled/missing/unknown segments", () => {
  const segs = tokenizeQuickResponseTemplate(
    "Hi {{customer_name}}, re {{ticket_subject}} - {{admin_name}} {{evil}}",
    { customer_name: "Alice", admin_name: "" },
  );
  assert.deepEqual(segs, [
    { kind: "text", value: "Hi " },
    { kind: "filled", variable: "customer_name", value: "Alice" },
    { kind: "text", value: ", re " },
    { kind: "missing", variable: "ticket_subject", raw: "{{ticket_subject}}" },
    { kind: "text", value: " - " },
    { kind: "missing", variable: "admin_name", raw: "{{admin_name}}" },
    { kind: "text", value: " " },
    { kind: "unknown", raw: "{{evil}}" },
  ]);
});

test("tokenize: empty template yields no segments", () => {
  assert.deepEqual(tokenizeQuickResponseTemplate("", {}), []);
});

test("tokenize: pure text template yields a single text segment", () => {
  assert.deepEqual(tokenizeQuickResponseTemplate("hello world", {}), [
    { kind: "text", value: "hello world" },
  ]);
});

test("tokenize: blank/whitespace-only context value is treated as missing", () => {
  const segs = tokenizeQuickResponseTemplate("Hi {{customer_name}}", {
    customer_name: "   ",
  });
  assert.deepEqual(segs, [
    { kind: "text", value: "Hi " },
    { kind: "missing", variable: "customer_name", raw: "{{customer_name}}" },
  ]);
});

test("tokenize: handles whitespace inside placeholder braces", () => {
  const segs = tokenizeQuickResponseTemplate("Hi {{  customer_name  }}!", {
    customer_name: "Pat",
  });
  assert.deepEqual(segs, [
    { kind: "text", value: "Hi " },
    { kind: "filled", variable: "customer_name", value: "Pat" },
    { kind: "text", value: "!" },
  ]);
});

test("tokenize: is safe to call repeatedly (PLACEHOLDER_RE state reset)", () => {
  const tpl = "Hi {{customer_name}}";
  const ctx = { customer_name: "Sam" };
  const a = tokenizeQuickResponseTemplate(tpl, ctx);
  const b = tokenizeQuickResponseTemplate(tpl, ctx);
  assert.deepEqual(a, b);
});

test("quickResponseHasMissingVariables: true when context is missing a placeholder", () => {
  assert.equal(
    quickResponseHasMissingVariables("Hi {{customer_name}} - {{admin_name}}", {
      customer_name: "X",
    }),
    true,
  );
});

test("quickResponseHasMissingVariables: false when all placeholders are filled", () => {
  assert.equal(
    quickResponseHasMissingVariables("Hi {{customer_name}}", { customer_name: "X" }),
    false,
  );
});

test("quickResponseHasMissingVariables: false for templates with no placeholders", () => {
  assert.equal(quickResponseHasMissingVariables("static text", {}), false);
});

test("findUnfilledPlaceholders: returns missing known variables and unknown tokens", () => {
  const out = findUnfilledPlaceholders(
    "Hi {{customer_name}}, re {{ticket_subject}} - {{admin_name}} {{evil}}",
    { customer_name: "Alice", admin_name: "" },
  );
  assert.deepEqual(out, [
    "{{ticket_subject}}",
    "{{admin_name}}",
    "{{evil}}",
  ]);
});

test("findUnfilledPlaceholders: empty array when message has no placeholders", () => {
  assert.deepEqual(findUnfilledPlaceholders("plain text", {}), []);
});

test("findUnfilledPlaceholders: empty array when all placeholders are filled", () => {
  assert.deepEqual(
    findUnfilledPlaceholders("Hi {{customer_name}}", { customer_name: "Pat" }),
    [],
  );
});

test("findUnfilledPlaceholders: blank context value counts as unfilled", () => {
  assert.deepEqual(
    findUnfilledPlaceholders("Hi {{customer_name}}", { customer_name: "   " }),
    ["{{customer_name}}"],
  );
});

test("findUnfilledPlaceholders: empty input yields empty list", () => {
  assert.deepEqual(findUnfilledPlaceholders("", { customer_name: "X" }), []);
});

test("findUnknownPlaceholders: returns only unknown tokens, dedup'd, in first-seen order", () => {
  assert.deepEqual(
    findUnknownPlaceholders(
      "Hi {{customername}} aka {{customer_name}}, see {{evil}} and {{customername}} again",
    ),
    ["{{customername}}", "{{evil}}"],
  );
});

test("findUnknownPlaceholders: empty when only known variables are used", () => {
  assert.deepEqual(
    findUnknownPlaceholders("Hi {{customer_name}}, re {{ticket_subject}} - {{admin_name}}"),
    [],
  );
});

test("findUnknownPlaceholders: empty for plain text or empty string", () => {
  assert.deepEqual(findUnknownPlaceholders("plain text"), []);
  assert.deepEqual(findUnknownPlaceholders(""), []);
});

test("findUnknownPlaceholders: ignores whitespace inside braces when matching known vars", () => {
  assert.deepEqual(
    findUnknownPlaceholders("Hi {{  customer_name  }} and {{  oops  }}"),
    ["{{  oops  }}"],
  );
});

test("walkPlaceholderOverlay: tracks start/end offsets for every token kind", () => {
  const text = "Hi {{customer_name}}, re {{ticket_subject}} - {{admin_name}} {{evil}}";
  const parts = walkPlaceholderOverlay(text, { customer_name: "Alice", admin_name: "" });
  assert.deepEqual(parts, [
    { kind: "text", value: "Hi " },
    { kind: "filled-token", raw: "{{customer_name}}", variable: "customer_name", value: "Alice", start: 3, end: 20 },
    { kind: "text", value: ", re " },
    { kind: "missing-token", raw: "{{ticket_subject}}", variable: "ticket_subject", start: 25, end: 43, currentValue: "" },
    { kind: "text", value: " - " },
    { kind: "missing-token", raw: "{{admin_name}}", variable: "admin_name", start: 46, end: 60, currentValue: "" },
    { kind: "text", value: " " },
    { kind: "unknown-token", raw: "{{evil}}", start: 61, end: 69 },
  ]);
  // Offsets must point at the literal token text inside the source string.
  for (const p of parts) {
    if (p.kind === "filled-token" || p.kind === "missing-token" || p.kind === "unknown-token") {
      assert.equal(text.slice(p.start, p.end), p.raw);
    }
  }
});

test("walkPlaceholderOverlay: empty text yields no parts", () => {
  assert.deepEqual(walkPlaceholderOverlay("", {}), []);
});

test("walkPlaceholderOverlay: text without placeholders yields a single text part", () => {
  assert.deepEqual(walkPlaceholderOverlay("plain text", {}), [
    { kind: "text", value: "plain text" },
  ]);
});

test("walkPlaceholderOverlay: blank/whitespace context value classifies token as missing", () => {
  const parts = walkPlaceholderOverlay("Hi {{customer_name}}", { customer_name: "   " });
  assert.deepEqual(parts, [
    { kind: "text", value: "Hi " },
    { kind: "missing-token", raw: "{{customer_name}}", variable: "customer_name", start: 3, end: 20, currentValue: "" },
  ]);
});

test("walkPlaceholderOverlay: handles whitespace inside placeholder braces and trims value", () => {
  const parts = walkPlaceholderOverlay("Hi {{  customer_name  }}!", { customer_name: "  Pat  " });
  assert.deepEqual(parts, [
    { kind: "text", value: "Hi " },
    { kind: "filled-token", raw: "{{  customer_name  }}", variable: "customer_name", value: "Pat", start: 3, end: 24 },
    { kind: "text", value: "!" },
  ]);
});

test("walkPlaceholderOverlay: adjacent placeholders produce no spurious empty text parts", () => {
  const parts = walkPlaceholderOverlay("{{customer_name}}{{evil}}", { customer_name: "" });
  assert.deepEqual(parts, [
    { kind: "missing-token", raw: "{{customer_name}}", variable: "customer_name", start: 0, end: 17, currentValue: "" },
    { kind: "unknown-token", raw: "{{evil}}", start: 17, end: 25 },
  ]);
});

test("walkPlaceholderOverlay: repeated calls return identical results (regex state reset)", () => {
  const text = "Hi {{customer_name}} {{evil}}";
  const ctx = { customer_name: "Sam" };
  assert.deepEqual(walkPlaceholderOverlay(text, ctx), walkPlaceholderOverlay(text, ctx));
});

test("variable list contains the documented placeholders", () => {
  assert.deepEqual([...QUICK_RESPONSE_VARIABLES].sort(), [
    "admin_name",
    "customer_name",
    "ticket_subject",
  ]);
});
