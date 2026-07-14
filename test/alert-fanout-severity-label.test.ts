import { test } from "node:test";
import assert from "node:assert/strict";
import { composeAlertCreated as composeTelegramAlertCreated } from "../server/telegram";
import { composeAlertCreated as composeDiscordAlertCreated } from "../server/discord";

// Server-sent notification channels (Telegram / Discord) must render the same
// canonical severity wording as the web UI badge: legacy severities like
// "sev_1" or "major" show as "Critical", not the raw string.

const base = {
  serviceNames: ["API"],
  impact: "outage",
  title: "Something broke",
  description: "<p>Details here</p>",
};

test("telegram alert created renders legacy severities canonically", () => {
  assert.match(composeTelegramAlertCreated({ ...base, severity: "sev_1" }), /<b>Severity:<\/b> Critical/);
  assert.match(composeTelegramAlertCreated({ ...base, severity: "MAJOR" }), /<b>Severity:<\/b> Critical/);
  assert.match(composeTelegramAlertCreated({ ...base, severity: "p2" }), /<b>Severity:<\/b> Warning/);
  assert.match(composeTelegramAlertCreated({ ...base, severity: "low" }), /<b>Severity:<\/b> Info/);
  assert.match(composeTelegramAlertCreated({ ...base, severity: "critical" }), /<b>Severity:<\/b> Critical/);
  // Unknown severities render readable Title Case, never raw underscores.
  assert.match(composeTelegramAlertCreated({ ...base, severity: "weird_thing" }), /<b>Severity:<\/b> Weird Thing/);
  // Absent severity omits the line entirely.
  assert.doesNotMatch(composeTelegramAlertCreated({ ...base }), /Severity/);
});

function discordSeverityField(payload: ReturnType<typeof composeDiscordAlertCreated>): string | undefined {
  return payload.embeds?.[0]?.fields?.find((f: { name: string }) => f.name === "Severity")?.value;
}

test("discord alert created renders legacy severities canonically", () => {
  assert.equal(discordSeverityField(composeDiscordAlertCreated({ ...base, severity: "sev_1" })), "Critical");
  assert.equal(discordSeverityField(composeDiscordAlertCreated({ ...base, severity: "SEV-2" })), "Warning");
  assert.equal(discordSeverityField(composeDiscordAlertCreated({ ...base, severity: "notice" })), "Info");
  assert.equal(discordSeverityField(composeDiscordAlertCreated({ ...base, severity: "warning" })), "Warning");
  assert.equal(discordSeverityField(composeDiscordAlertCreated({ ...base, severity: "weird_thing" })), "Weird Thing");
  assert.equal(discordSeverityField(composeDiscordAlertCreated({ ...base })), undefined);
});
