import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldUseMobileLayout } from "../client/src/hooks/use-mobile";

test("coarse-pointer phones stay in bottom-navigation layout across rotation", () => {
  assert.equal(shouldUseMobileLayout(412, 412, 915, true), true);
  assert.equal(shouldUseMobileLayout(915, 412, 915, true), true);
  assert.equal(shouldUseMobileLayout(844, 844, 390, true), true);
});
test("keyboard height cannot turn a tablet or desktop into a landscape phone", () => {
  assert.equal(shouldUseMobileLayout(1024, 768, 1024, true), false);
  assert.equal(shouldUseMobileLayout(960, 600, 960, true), false);
  assert.equal(shouldUseMobileLayout(1200, 1920, 1080, false), false);
  assert.equal(shouldUseMobileLayout(1200, 1920, 1080, true), false);
  assert.equal(shouldUseMobileLayout(844, 0, 0, true), false, "missing physical screen metadata is not a phone signal");
  assert.equal(shouldUseMobileLayout(650, 1920, 1080, false), true, "existing narrow-window behavior is unchanged");
});
