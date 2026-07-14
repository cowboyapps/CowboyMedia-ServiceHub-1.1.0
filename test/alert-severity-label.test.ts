import { test } from "node:test";
import assert from "node:assert/strict";
import { alertSeverityLabel } from "../client/src/lib/status-meta";

test("alertSeverityLabel: known severities keep canonical labels", () => {
  assert.equal(alertSeverityLabel("critical"), "Critical");
  assert.equal(alertSeverityLabel("warning"), "Warning");
  assert.equal(alertSeverityLabel("info"), "Info");
  // Legacy rows may carry odd casing of a known severity.
  assert.equal(alertSeverityLabel("Critical"), "Critical");
  assert.equal(alertSeverityLabel("WARNING"), "Warning");
});

test("alertSeverityLabel: unknown values render Title Case, never raw", () => {
  assert.equal(alertSeverityLabel("sev_1"), "Sev 1");
  assert.equal(alertSeverityLabel("high-priority"), "High Priority");
  assert.equal(alertSeverityLabel("MAJOR"), "Major");
  assert.equal(alertSeverityLabel("weird   spacing"), "Weird Spacing");
});

test("alertSeverityLabel: blank/null values fall back to Info", () => {
  assert.equal(alertSeverityLabel(""), "Info");
  assert.equal(alertSeverityLabel("   "), "Info");
  assert.equal(alertSeverityLabel(null), "Info");
  assert.equal(alertSeverityLabel(undefined), "Info");
});
