import { test } from "node:test";
import assert from "node:assert/strict";
import {
  composeAlertCreated,
  composeAlertUpdate,
  composeAlertResolved,
  composeServiceUpdate,
  composeNews,
  composeDiscordTest,
  type DiscordPayload,
} from "./discord";

const DISCORD_MAX_BODY_LEN = 2000;
const MAX_TITLE_LEN = 256;
const MAX_FIELD_VALUE = 1024;
const MAX_FOOTER_LEN = 2048;

function long(n: number, char = "x"): string {
  return char.repeat(n);
}

function longParagraphs(totalLen: number): string {
  const para = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ";
  let s = "";
  while (s.length < totalLen) s += para;
  return s.slice(0, totalLen);
}

function assertEmbedWithinLimits(payload: DiscordPayload, label: string) {
  assert.ok(payload.embeds, `${label}: expected embeds to be defined`);
  for (const embed of payload.embeds) {
    if (embed.title !== undefined) {
      assert.ok(
        embed.title.length <= MAX_TITLE_LEN,
        `${label}: title length ${embed.title.length} exceeds ${MAX_TITLE_LEN}`,
      );
    }
    if (embed.description !== undefined) {
      assert.ok(
        embed.description.length <= DISCORD_MAX_BODY_LEN,
        `${label}: description length ${embed.description.length} exceeds ${DISCORD_MAX_BODY_LEN}`,
      );
    }
    if (embed.footer?.text !== undefined) {
      assert.ok(
        embed.footer.text.length <= MAX_FOOTER_LEN,
        `${label}: footer length ${embed.footer.text.length} exceeds ${MAX_FOOTER_LEN}`,
      );
    }
    for (const f of embed.fields ?? []) {
      assert.ok(
        f.name.length <= 256,
        `${label}: field name length ${f.name.length} exceeds 256`,
      );
      assert.ok(
        f.value.length <= MAX_FIELD_VALUE,
        `${label}: field value length ${f.value.length} exceeds ${MAX_FIELD_VALUE}`,
      );
    }
  }
}

test("composeDiscordTest stays within Discord limits", () => {
  assertEmbedWithinLimits(composeDiscordTest(), "test");
});

test("composeAlertCreated: short input passes through unchanged", () => {
  const payload = composeAlertCreated({
    serviceName: "API",
    impact: "outage",
    title: "Login is down",
    description: "We are investigating a login outage.",
    alertId: "abc",
    baseUrl: "https://example.com",
  });
  assertEmbedWithinLimits(payload, "alert created (short)");
  const e = payload.embeds![0]!;
  assert.equal(e.description, "We are investigating a login outage.");
  assert.match(e.title!, /Login is down/);
  assert.equal(e.url, "https://example.com/alerts/abc");
});

test("composeAlertCreated: HTML description is stripped to plain text", () => {
  const payload = composeAlertCreated({
    serviceName: "API",
    impact: "outage",
    title: "Login is down",
    description: "<p>We are <strong>investigating</strong>.</p><p>More soon.</p>",
    alertId: "abc",
    baseUrl: "https://example.com",
  });
  const e = payload.embeds![0]!;
  assert.equal(e.description, "We are investigating.\n\nMore soon.");
});

test("composeAlertUpdate: HTML message is stripped to plain text", () => {
  const payload = composeAlertUpdate({
    serviceName: "API",
    title: "Login is down",
    status: "monitoring",
    message: "<p>Fix deployed &amp; monitoring.</p>",
    impact: "degraded",
    alertId: "abc",
    baseUrl: "https://example.com",
  });
  assert.equal(payload.embeds![0]!.description, "Fix deployed & monitoring.");
});

test("composeAlertCreated: oversized inputs are clamped under all limits", () => {
  const payload = composeAlertCreated({
    serviceName: long(500, "S"),
    impact: "outage",
    severity: long(2000, "v"),
    title: long(1000, "T"),
    description: long(5000, "d"),
    alertId: "abc",
    baseUrl: "https://example.com",
  });
  assertEmbedWithinLimits(payload, "alert created (long)");
});

test("composeAlertUpdate: short input passes through unchanged", () => {
  const payload = composeAlertUpdate({
    serviceName: "API",
    title: "Login is down",
    status: "investigating",
    message: "Still investigating the cause.",
    impact: "degraded",
    alertId: "abc",
    baseUrl: "https://example.com",
  });
  assertEmbedWithinLimits(payload, "alert update (short)");
  const e = payload.embeds![0]!;
  assert.equal(e.description, "Still investigating the cause.");
  assert.match(e.title!, /Login is down/);
  assert.equal(e.url, "https://example.com/alerts/abc");
});

test("composeAlertUpdate: oversized inputs are clamped under all limits", () => {
  const payload = composeAlertUpdate({
    serviceName: long(500, "S"),
    title: long(1000, "T"),
    status: "investigating",
    message: long(5000, "m"),
    impact: "degraded",
    alertId: "abc",
    baseUrl: "https://example.com",
  });
  assertEmbedWithinLimits(payload, "alert update (long)");
});

test("composeAlertUpdate: resolved status uses correct label and stays in limits", () => {
  const payload = composeAlertUpdate({
    serviceName: long(500, "S"),
    title: long(1000, "T"),
    status: "resolved",
    message: long(5000, "m"),
    alertId: "abc",
    baseUrl: "https://example.com",
  });
  assertEmbedWithinLimits(payload, "alert update resolved (long)");
  assert.match(payload.embeds![0]!.title!, /Resolved/);
});

test("composeAlertResolved: short input passes through unchanged", () => {
  const payload = composeAlertResolved({
    serviceName: "API",
    title: "Login is down",
    resolveMessage: "Issue resolved by rolling back the deploy.",
    alertId: "abc",
    baseUrl: "https://example.com",
  });
  assertEmbedWithinLimits(payload, "alert resolved (short)");
  const e = payload.embeds![0]!;
  assert.equal(e.description, "Issue resolved by rolling back the deploy.");
  assert.match(e.title!, /Resolved/);
  assert.equal(e.url, "https://example.com/alerts/abc");
});

test("composeAlertResolved: oversized inputs are clamped under all limits", () => {
  const payload = composeAlertResolved({
    serviceName: long(500, "S"),
    title: long(1000, "T"),
    resolveMessage: long(5000, "r"),
    alertId: "abc",
    baseUrl: "https://example.com",
  });
  assertEmbedWithinLimits(payload, "alert resolved (long)");
});

test("composeServiceUpdate: short input passes through unchanged", () => {
  const payload = composeServiceUpdate({
    serviceName: "API",
    title: "New region available",
    description: "We've launched a new EU region.",
    baseUrl: "https://example.com",
  });
  assertEmbedWithinLimits(payload, "service update (short)");
  const e = payload.embeds![0]!;
  assert.equal(e.description, "We've launched a new EU region.");
  assert.match(e.title!, /New region available/);
  assert.equal(e.url, "https://example.com/service-updates");
});

test("composeServiceUpdate: oversized inputs are clamped under all limits", () => {
  const payload = composeServiceUpdate({
    serviceName: long(500, "S"),
    title: long(1000, "T"),
    description: long(5000, "d"),
    baseUrl: "https://example.com",
  });
  assertEmbedWithinLimits(payload, "service update (long)");
});

test("composeNews: short content returns single payload within limits", () => {
  const payloads = composeNews({
    title: "Maintenance Tonight",
    content: "<p>We will perform maintenance at 2am UTC.</p>",
    newsId: "n1",
    baseUrl: "https://example.com",
  });
  assert.equal(payloads.length, 1);
  for (const p of payloads) assertEmbedWithinLimits(p, "news (short)");
});

test("composeNews: very long content is split into multiple payloads, each within limits", () => {
  const html = `<p>${longParagraphs(10000)}</p>`;
  const payloads = composeNews({
    title: long(1000, "T"),
    content: html,
    newsId: "n1",
    baseUrl: "https://example.com",
  });
  assert.ok(payloads.length > 1, "expected splitting into multiple payloads");
  for (const p of payloads) assertEmbedWithinLimits(p, "news (long)");
  assert.match(payloads[0]!.embeds![0]!.title!, /^📰 /);
  assert.match(payloads[1]!.embeds![0]!.title!, /continued/);
});

test("composeAlertCreated: rejects unsafe URLs (non-http(s)) by omitting them", () => {
  const payload = composeAlertCreated({
    serviceName: "API",
    impact: "outage",
    title: "x",
    description: "y",
    alertId: "abc",
    baseUrl: "javascript:alert(1)",
  });
  assert.equal(payload.embeds![0]!.url, undefined);
});

test("compose helpers tolerate empty strings without throwing", () => {
  assertEmbedWithinLimits(
    composeAlertCreated({ serviceName: "", impact: "", title: "", description: "" }),
    "alert created (empty)",
  );
  assertEmbedWithinLimits(
    composeAlertUpdate({ serviceName: "", title: "", status: "", message: "" }),
    "alert update (empty)",
  );
  assertEmbedWithinLimits(
    composeAlertResolved({ serviceName: "", title: "", resolveMessage: "" }),
    "alert resolved (empty)",
  );
  assertEmbedWithinLimits(
    composeServiceUpdate({ serviceName: "", title: "", description: "" }),
    "service update (empty)",
  );
  for (const p of composeNews({ title: "", content: "" })) {
    assertEmbedWithinLimits(p, "news (empty)");
  }
});
