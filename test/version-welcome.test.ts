import { test } from "node:test";
import assert from "node:assert/strict";
import { renderChangelogToHtml } from "../shared/changelog-render";
import { APP_VERSION, versionAnchor, shouldShowVersionWelcome } from "../shared/version";

test("shouldShowVersionWelcome: never seen → show", () => {
  assert.equal(shouldShowVersionWelcome(null, "5.1"), true);
  assert.equal(shouldShowVersionWelcome(undefined, "5.1"), true);
  assert.equal(shouldShowVersionWelcome("", "5.1"), true);
});

test("shouldShowVersionWelcome: same version → hide", () => {
  assert.equal(shouldShowVersionWelcome("5.1", "5.1"), false);
});

test("shouldShowVersionWelcome: any other version (older / newer / arbitrary) → show", () => {
  assert.equal(shouldShowVersionWelcome("5.0", "5.1"), true);
  assert.equal(shouldShowVersionWelcome("6.0", "5.1"), true);
  assert.equal(shouldShowVersionWelcome("5.1-hotfix", "5.1"), true);
  assert.equal(shouldShowVersionWelcome("foo", "5.1"), true);
});

test("versionAnchor produces dot-free DOM ids", () => {
  assert.equal(versionAnchor("5.1"), "version-5-1");
  assert.equal(versionAnchor("6.0-beta"), "version-6-0-beta");
});

test("APP_VERSION is a non-empty string", () => {
  assert.equal(typeof APP_VERSION, "string");
  assert.ok(APP_VERSION.length > 0);
});

test("renderChangelogToHtml emits a heading anchor for the current version", () => {
  const md = `# Changelog\n\n## Version ${APP_VERSION} — Today\n\n- something new\n`;
  const html = renderChangelogToHtml(md);
  assert.ok(html.includes(`id="${versionAnchor(APP_VERSION)}"`), html);
  assert.ok(html.includes("<li>something new</li>"));
});

test("renderChangelogToHtml renders separators, bullets, bold, and headings", () => {
  const md = [
    "## Version 1.0 — Jan",
    "",
    "### Section",
    "- **Bold thing** matters",
    "- plain item",
    "",
    "---",
    "",
    "## Version 0.9 — Dec",
    "- old item",
  ].join("\n");
  const html = renderChangelogToHtml(md);
  assert.ok(html.includes("<h2"));
  assert.ok(html.includes("<h3"));
  assert.ok(html.includes("<ul"));
  assert.ok(html.includes("<strong>Bold thing</strong>"));
  assert.ok(html.includes("<hr"));
  assert.ok(html.includes('id="version-1-0"'));
  assert.ok(html.includes('id="version-0-9"'));
});

test("renderChangelogToHtml escapes raw HTML in markdown content", () => {
  const html = renderChangelogToHtml("- danger <script>alert(1)</script>");
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
});
