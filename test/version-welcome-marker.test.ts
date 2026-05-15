import { test } from "node:test";
import assert from "node:assert/strict";
import {
  versionWelcomeMarkerKey,
  shouldSuppressFromMarker,
} from "../shared/version-welcome-marker";

test("versionWelcomeMarkerKey: namespaces by user id", () => {
  assert.equal(versionWelcomeMarkerKey("u-1"), "vw-seen:u-1");
  assert.equal(versionWelcomeMarkerKey("u-2"), "vw-seen:u-2");
  assert.notEqual(
    versionWelcomeMarkerKey("u-1"),
    versionWelcomeMarkerKey("u-2"),
  );
});

test("shouldSuppressFromMarker: no marker → do not suppress", () => {
  assert.equal(shouldSuppressFromMarker(null, "5.1"), false);
  assert.equal(shouldSuppressFromMarker(undefined, "5.1"), false);
  assert.equal(shouldSuppressFromMarker("", "5.1"), false);
});

test("shouldSuppressFromMarker: marker matches offered version → suppress", () => {
  assert.equal(shouldSuppressFromMarker("5.1", "5.1"), true);
});

test("shouldSuppressFromMarker: marker is for an older version → do not suppress", () => {
  // The user dismissed v5.0 last time; the server is now offering v5.1.
  // We must show the popup for v5.1.
  assert.equal(shouldSuppressFromMarker("5.0", "5.1"), false);
});

test("shouldSuppressFromMarker: marker is for a newer/arbitrary value → do not suppress", () => {
  assert.equal(shouldSuppressFromMarker("6.0", "5.1"), false);
  assert.equal(shouldSuppressFromMarker("garbage", "5.1"), false);
});
