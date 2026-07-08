import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
(globalThis as Record<string, unknown>).DOMParser = dom.window.DOMParser;
(globalThis as Record<string, unknown>).NodeFilter = dom.window.NodeFilter;

const { highlightHtml } = await import("../client/src/lib/highlight-html");

test("returns input unchanged when query is empty", () => {
  const html = "<p>Hello <strong>world</strong></p>";
  assert.equal(highlightHtml(html, ""), html);
});

test("wraps matches inside text nodes with <mark>", () => {
  const out = highlightHtml("<p>Server maintenance tonight</p>", "maintenance");
  assert.match(out, /<mark[^>]*>maintenance<\/mark>/);
  assert.match(out, /^<p>Server /);
});

test("never corrupts tags or attributes when query matches tag/attr text", () => {
  const html = '<p><a href="https://strong.example">strong link</a></p>';
  const out = highlightHtml(html, "strong");
  // The href must stay intact — only the text node gets marked.
  assert.match(out, /href="https:\/\/strong\.example"/);
  assert.match(out, /<mark[^>]*>strong<\/mark> link/);
});

test("highlights matches spanning multiple occurrences and is case-insensitive", () => {
  const out = highlightHtml("<p>Update UPDATE update</p>", "update");
  const marks = out.match(/<mark/g) || [];
  assert.equal(marks.length, 3);
});

test("highlights inside nested formatting without touching structure", () => {
  const out = highlightHtml("<ul><li><strong>Fixed</strong> login bug</li></ul>", "login");
  assert.match(out, /<ul><li><strong>Fixed<\/strong> <mark[^>]*>login<\/mark> bug<\/li><\/ul>/);
});

test("query with regex special characters is treated literally", () => {
  const out = highlightHtml("<p>Cost is $5 (approx)</p>", "$5 (approx)");
  assert.match(out, /<mark[^>]*>\$5 \(approx\)<\/mark>/);
});
