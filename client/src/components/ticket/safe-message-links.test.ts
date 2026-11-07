import { test } from "node:test";
import assert from "node:assert/strict";
import { splitMessageLinks } from "./safe-message-links";

test("ticket link labels stay compact while preserving complete safe destinations and punctuation", () => {
  const message = "See https://example.test/a/very/long/path?q=one%20two#details, then\nhttp://help.test/reset.";
  const parts = splitMessageLinks(message);
  const links = parts.filter((part) => part.type === "link");
  assert.equal(links.length, 2);
  assert.deepEqual(links.map((part) => part.type === "link" && part.href), [
    "https://example.test/a/very/long/path?q=one%20two#details",
    "http://help.test/reset",
  ]);
  assert.equal(parts.filter((part) => part.type === "text").map((part) => part.value).join(""), "See , then\n.");
  assert.deepEqual(links.map(part => part.type === "link" && part.label), [
    "https://example.test/a/very/long/path?q=one%20two#details",
    "http://help.test/reset",
  ]);
});

test("visible labels retain HTTP/HTTPS and explicit ports, including root URLs", () => {
  const parts = splitMessageLinks("http://stream.test:8080 https://secure.test:8443/ http://help.test/?q=reset#steps");
  assert.deepEqual(parts.filter(part => part.type === "link").map(part => part.label), [
    "http://stream.test:8080", "https://secure.test:8443", "http://help.test/?q=reset#steps",
  ]);
});

test("unsafe schemes and plain text remain inert text", () => {
  const parts = splitMessageLinks("javascript:alert(1) ftp://files.test/a and words");
  assert.deepEqual(parts, [{ type: "text", value: "javascript:alert(1) ftp://files.test/a and words" }]);
});

test("balanced URL parentheses and query terminators are not silently removed", () => {
  const parts = splitMessageLinks("https://example.test/wiki/Help_(guide) https://example.test/?value=why?");
  assert.deepEqual(parts.filter(part => part.type === "link").map(part => part.href), [
    "https://example.test/wiki/Help_(guide)", "https://example.test/?value=why?",
  ]);
});

test("known relative ServiceHub paths are deliberate internal links, unrelated paths remain prose", () => {
  const parts = splitMessageLinks("Open /tickets/abc-123?tab=history or read /knowledge/password-reset; skip /arbitrary/file.");
  const links = parts.filter((part) => part.type === "link");
  assert.deepEqual(links.map((part) => part.type === "link" ? [part.href, part.internal] : null), [
    ["/tickets/abc-123?tab=history", true],
    ["/knowledge/password-reset", true],
  ]);
  assert.ok(parts.some((part) => part.type === "text" && part.value.includes("/arbitrary/file")));
});
