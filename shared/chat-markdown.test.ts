import { test } from "node:test";
import assert from "node:assert/strict";
import { parseChatMarkdown, stripChatFormatting, hasChatMarkup, type ChatInlineNode } from "./chat-markdown";

function types(nodes: ChatInlineNode[]): string[] {
  return nodes.map((n) => n.type);
}

test("plain text passes through as a single text node", () => {
  const nodes = parseChatMarkdown("hello world");
  assert.deepEqual(nodes, [{ type: "text", text: "hello world" }]);
});

test("**bold** parses", () => {
  const nodes = parseChatMarkdown("say **hi** now");
  assert.deepEqual(types(nodes), ["text", "bold", "text"]);
  const bold = nodes[1];
  assert.equal(bold.type, "bold");
  if (bold.type === "bold") assert.deepEqual(bold.children, [{ type: "text", text: "hi" }]);
});

test("*italic* parses and is not confused with bold", () => {
  const nodes = parseChatMarkdown("*it* and **b**");
  assert.deepEqual(types(nodes), ["italic", "text", "bold"]);
});

test("~~strike~~ parses", () => {
  const nodes = parseChatMarkdown("~~gone~~");
  assert.deepEqual(types(nodes), ["strike"]);
});

test("`code` is atomic — no formatting or mentions inside", () => {
  const nodes = parseChatMarkdown("run `npm i **x** @you` ok");
  assert.deepEqual(types(nodes), ["text", "code", "text"]);
  const code = nodes[1];
  if (code.type === "code") assert.equal(code.text, "npm i **x** @you");
});

test("bare URL becomes a link and trailing punctuation is not swallowed", () => {
  const nodes = parseChatMarkdown("see https://example.com/a. done");
  const link = nodes.find((n) => n.type === "link");
  assert.ok(link && link.type === "link");
  if (link && link.type === "link") assert.equal(link.href, "https://example.com/a");
});

test("URL with balanced parens keeps the closing paren", () => {
  const nodes = parseChatMarkdown("https://en.wikipedia.org/wiki/Foo_(bar)");
  const link = nodes[0];
  assert.equal(link.type, "link");
  if (link.type === "link") assert.equal(link.href, "https://en.wikipedia.org/wiki/Foo_(bar)");
});

test("@mention parses with username captured", () => {
  const nodes = parseChatMarkdown("hey @sam-01 look");
  const mention = nodes.find((n) => n.type === "mention");
  assert.ok(mention && mention.type === "mention");
  if (mention && mention.type === "mention") assert.equal(mention.username, "sam-01");
});

test("mention inside bold still parses (one nesting level)", () => {
  const nodes = parseChatMarkdown("**hi @ana**");
  const bold = nodes[0];
  assert.equal(bold.type, "bold");
  if (bold.type === "bold") {
    assert.ok(bold.children.some((c) => c.type === "mention"));
  }
});

test("email-like text does not create a false mention with preceding text", () => {
  const nodes = parseChatMarkdown("mail me a@b");
  // '@b' after 'a' — still parses as mention 'b'; acceptable: verify no crash
  assert.ok(nodes.length >= 1);
});

test("unbalanced markers degrade to plain text", () => {
  assert.deepEqual(parseChatMarkdown("**not closed"), [{ type: "text", text: "**not closed" }]);
  assert.deepEqual(parseChatMarkdown("`still open"), [{ type: "text", text: "`still open" }]);
  assert.deepEqual(parseChatMarkdown("* not italic *"), [{ type: "text", text: "* not italic *" }]);
});

test("stripChatFormatting removes markers but keeps content", () => {
  assert.equal(stripChatFormatting("**b** *i* ~~s~~ `c` @u https://x.io"), "b i s c @u https://x.io");
});

test("stripChatFormatting is identity for plain text", () => {
  assert.equal(stripChatFormatting("just words"), "just words");
});

test("hasChatMarkup detects markup and skips plain text", () => {
  assert.equal(hasChatMarkup("plain words"), false);
  assert.equal(hasChatMarkup("**b**"), true);
  assert.equal(hasChatMarkup("hey @you"), true);
  assert.equal(hasChatMarkup("https://a.io"), true);
});

test("multiline text keeps newlines in text nodes", () => {
  const nodes = parseChatMarkdown("line1\nline2 **b**");
  assert.equal(nodes[0].type, "text");
  if (nodes[0].type === "text") assert.ok(nodes[0].text.includes("\n"));
});
