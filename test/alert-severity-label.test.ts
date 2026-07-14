import { test } from "node:test";
import assert from "node:assert/strict";
import { alertSeverityLabel, alertSeverityMeta, severityMeta, unknownSeverityMeta } from "../client/src/lib/status-meta";

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

test("alertSeverityMeta: known severities map to their own styling (any casing)", () => {
  assert.deepEqual(alertSeverityMeta("critical"), severityMeta.critical);
  assert.deepEqual(alertSeverityMeta("WARNING"), severityMeta.warning);
  assert.deepEqual(alertSeverityMeta(" Info "), severityMeta.info);
});

test("alertSeverityMeta: unknown severities render neutral, never info blue", () => {
  for (const raw of ["sev_1", "high-priority", "MAJOR"]) {
    const meta = alertSeverityMeta(raw);
    assert.deepEqual(meta, unknownSeverityMeta);
    assert.ok(!meta.pill.includes("primary"), `${raw} must not use the info (primary) pill`);
  }
});

test("alertSeverityMeta: blank/null falls back to info (matches label fallback)", () => {
  assert.deepEqual(alertSeverityMeta(""), severityMeta.info);
  assert.deepEqual(alertSeverityMeta("   "), severityMeta.info);
  assert.deepEqual(alertSeverityMeta(null), severityMeta.info);
  assert.deepEqual(alertSeverityMeta(undefined), severityMeta.info);
});
