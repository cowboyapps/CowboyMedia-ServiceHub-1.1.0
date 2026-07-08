import { test } from "node:test";
import assert from "node:assert/strict";
import { isHtmlContent, stripHtmlPreserveBreaks, htmlToPlainTextInline } from "../shared/html-text";

test("isHtmlContent detects rich content vs plain text", () => {
  assert.equal(isHtmlContent("<p>Hello</p>"), true);
  assert.equal(isHtmlContent("<strong>bold</strong> text"), true);
  assert.equal(isHtmlContent("plain text"), false);
  assert.equal(isHtmlContent("a < b and b > c"), false);
  assert.equal(isHtmlContent("5 <3 you"), false);
  assert.equal(isHtmlContent(""), false);
  assert.equal(isHtmlContent(undefined as unknown as string), false);
});

test("stripHtmlPreserveBreaks strips tags and keeps structure", () => {
  assert.equal(stripHtmlPreserveBreaks("<p>Hello <strong>world</strong></p>"), "Hello world");
  assert.equal(
    stripHtmlPreserveBreaks("<p>Line one</p><p>Line two</p>"),
    "Line one\n\nLine two"
  );
  assert.equal(stripHtmlPreserveBreaks("First<br>Second"), "First\nSecond");
  assert.equal(
    stripHtmlPreserveBreaks("<ul><li>Alpha</li><li>Beta</li></ul>"),
    "• Alpha\n\n• Beta"
  );
});

test("stripHtmlPreserveBreaks decodes entities and passes plain text through", () => {
  assert.equal(stripHtmlPreserveBreaks("<p>Fish &amp; chips &lt;3</p>"), "Fish & chips <3");
  assert.equal(stripHtmlPreserveBreaks("plain text stays"), "plain text stays");
  assert.equal(stripHtmlPreserveBreaks("<p>a&nbsp;b</p>"), "a b");
  assert.equal(stripHtmlPreserveBreaks(""), "");
  assert.equal(stripHtmlPreserveBreaks(null as unknown as string), "");
});

test("stripHtmlPreserveBreaks collapses excessive whitespace", () => {
  assert.equal(
    stripHtmlPreserveBreaks("<p>a</p><p></p><p></p><p>b</p>"),
    "a\n\nb"
  );
  assert.equal(stripHtmlPreserveBreaks("<p>  spaced   out  </p>"), "spaced out");
});

test("htmlToPlainTextInline collapses to a single line with separators", () => {
  assert.equal(
    htmlToPlainTextInline("<p>Line one</p><p>Line two</p>"),
    "Line one — Line two"
  );
  assert.equal(htmlToPlainTextInline("<p>Only one</p>"), "Only one");
  assert.equal(htmlToPlainTextInline("plain"), "plain");
});
