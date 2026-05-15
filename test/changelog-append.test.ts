import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendBulletToBody,
  countBulletsInBody,
  isBulletHeading,
} from "../shared/changelog-append";

test("appendBulletToBody: empty body — creates the heading and the list", () => {
  const out = appendBulletToBody("", "New", "Public status page");
  assert.equal(out, "<h3>New</h3><ul><li>Public status page</li></ul>");
});

test("appendBulletToBody: existing heading — appends to the same <ul>", () => {
  const seed = "<h3>New</h3><ul><li>First thing</li></ul>";
  const out = appendBulletToBody(seed, "New", "Second thing");
  assert.equal(
    out,
    "<h3>New</h3><ul><li>First thing</li><li>Second thing</li></ul>",
  );
});

test("appendBulletToBody: different heading — appends a new section after the existing one", () => {
  const seed = "<h3>New</h3><ul><li>Status page</li></ul>";
  const out = appendBulletToBody(seed, "Fixed", "Email confirm link");
  assert.equal(
    out,
    "<h3>New</h3><ul><li>Status page</li></ul><h3>Fixed</h3><ul><li>Email confirm link</li></ul>",
  );
});

test("appendBulletToBody: heading match is case-insensitive on the heading word", () => {
  // The heading argument is the canonical capitalization, but a body that
  // came from a hand-edited entry might use a different case. Match either.
  const seed = "<h3>NEW</h3><ul><li>Old item</li></ul>";
  const out = appendBulletToBody(seed, "New", "fresh item");
  assert.match(out, /<li>Old item<\/li><li>fresh item<\/li>/);
});

test("appendBulletToBody: HTML in the bullet text is escaped, not injected", () => {
  const out = appendBulletToBody(
    "",
    "Fixed",
    "<script>alert(1)</script> & <b>bold</b>",
  );
  assert.ok(!out.includes("<script>"));
  assert.ok(out.includes("&lt;script&gt;"));
  assert.ok(out.includes("&amp;"));
  assert.ok(out.includes("&lt;b&gt;bold&lt;/b&gt;"));
});

test("appendBulletToBody: trims surrounding whitespace from the bullet", () => {
  const out = appendBulletToBody("", "Improved", "   trimmed   ");
  assert.equal(out, "<h3>Improved</h3><ul><li>trimmed</li></ul>");
});

test("appendBulletToBody: empty bullet is a no-op", () => {
  assert.equal(appendBulletToBody("", "New", ""), "");
  assert.equal(appendBulletToBody("", "New", "   "), "");
  const seed = "<h3>New</h3><ul><li>x</li></ul>";
  assert.equal(appendBulletToBody(seed, "New", ""), seed);
});

test("appendBulletToBody: tolerates extra whitespace inside the existing <ul>", () => {
  // Sanitizers and rich-text editors can leave newlines between tags.
  const seed = "<h3>New</h3>\n<ul>\n  <li>One</li>\n</ul>";
  const out = appendBulletToBody(seed, "New", "Two");
  assert.match(out, /<li>One<\/li><li>Two<\/li><\/ul>/);
});

test("appendBulletToBody: preserves prose above the section", () => {
  const seed = "<p>Intro paragraph.</p><h3>New</h3><ul><li>One</li></ul>";
  const out = appendBulletToBody(seed, "New", "Two");
  assert.ok(out.startsWith("<p>Intro paragraph.</p>"));
  assert.ok(out.includes("<li>One</li><li>Two</li>"));
});

test("countBulletsInBody: counts <li> opens regardless of attributes", () => {
  assert.equal(countBulletsInBody(""), 0);
  assert.equal(countBulletsInBody(null), 0);
  assert.equal(countBulletsInBody(undefined), 0);
  assert.equal(countBulletsInBody("<ul><li>a</li><li>b</li></ul>"), 2);
  assert.equal(
    countBulletsInBody('<ul><li class="x">a</li><li>b</li><li>c</li></ul>'),
    3,
  );
});

test("isBulletHeading: accepts only New/Improved/Fixed", () => {
  assert.equal(isBulletHeading("New"), true);
  assert.equal(isBulletHeading("Improved"), true);
  assert.equal(isBulletHeading("Fixed"), true);
  assert.equal(isBulletHeading("new"), false);
  assert.equal(isBulletHeading("Other"), false);
  assert.equal(isBulletHeading(null), false);
  assert.equal(isBulletHeading(42), false);
});
