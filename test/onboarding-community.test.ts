import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("the welcome tour introduces Community Chat and points phones to More", () => {
  const source = readFileSync("client/src/components/onboarding-tour.tsx", "utf8");
  const step = source.match(/key: "community",([\s\S]*?)\n  },/)?.[1];
  assert.ok(step);
  assert.match(step, /title: "Community Chat"/);
  assert.match(step, /other subscribers/);
  assert.match(step, /ask questions/);
  assert.match(step, /help each other/);
  assert.match(step, /account-specific issues.*support ticket/);
  assert.match(step, /nav-community-chat/);
  assert.match(step, /button-bottom-nav-more/);
  assert.match(source, /onboardingTourCompletedAt/, "existing completion/replay policy is preserved");
});
