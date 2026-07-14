import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alertSeverityLabel,
  alertSeverityMeta,
  normalizeAlertSeverity,
  severityMeta,
  unknownSeverityMeta,
} from "../client/src/lib/status-meta";

test("alertSeverityLabel: known severities keep canonical labels", () => {
  assert.equal(alertSeverityLabel("critical"), "Critical");
  assert.equal(alertSeverityLabel("warning"), "Warning");
  assert.equal(alertSeverityLabel("info"), "Info");
  // Legacy rows may carry odd casing of a known severity.
  assert.equal(alertSeverityLabel("Critical"), "Critical");
  assert.equal(alertSeverityLabel("WARNING"), "Warning");
});

test("alertSeverityLabel: legacy aliases resolve to canonical labels", () => {
  assert.equal(alertSeverityLabel("sev_1"), "Critical");
  assert.equal(alertSeverityLabel("SEV-1"), "Critical");
  assert.equal(alertSeverityLabel("sev1"), "Critical");
  assert.equal(alertSeverityLabel("P1"), "Critical");
  assert.equal(alertSeverityLabel("MAJOR"), "Critical");
  assert.equal(alertSeverityLabel("sev_2"), "Warning");
  assert.equal(alertSeverityLabel("minor"), "Warning");
  assert.equal(alertSeverityLabel("p2"), "Warning");
  assert.equal(alertSeverityLabel("sev 3"), "Info");
  assert.equal(alertSeverityLabel("low"), "Info");
});

test("alertSeverityLabel: unknown values render Title Case, never raw", () => {
  assert.equal(alertSeverityLabel("high-priority"), "High Priority");
  assert.equal(alertSeverityLabel("weird   spacing"), "Weird Spacing");
  assert.equal(alertSeverityLabel("blocker"), "Blocker");
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

test("alertSeverityMeta: legacy aliases get the real urgency styling", () => {
  assert.deepEqual(alertSeverityMeta("sev_1"), severityMeta.critical);
  assert.deepEqual(alertSeverityMeta("SEV-1"), severityMeta.critical);
  assert.deepEqual(alertSeverityMeta("p1"), severityMeta.critical);
  assert.deepEqual(alertSeverityMeta("MAJOR"), severityMeta.critical);
  assert.deepEqual(alertSeverityMeta("sev_2"), severityMeta.warning);
  assert.deepEqual(alertSeverityMeta("minor"), severityMeta.warning);
  assert.deepEqual(alertSeverityMeta("sev 3"), severityMeta.info);
  assert.deepEqual(alertSeverityMeta("low"), severityMeta.info);
});

test("normalizeAlertSeverity: canonical, alias, and unknown handling", () => {
  assert.equal(normalizeAlertSeverity("critical"), "critical");
  assert.equal(normalizeAlertSeverity(" Warning "), "warning");
  assert.equal(normalizeAlertSeverity("sev-1"), "critical");
  assert.equal(normalizeAlertSeverity("urgent"), "critical");
  assert.equal(normalizeAlertSeverity("blocker"), null);
  assert.equal(normalizeAlertSeverity(""), null);
  assert.equal(normalizeAlertSeverity(null), null);
  assert.equal(normalizeAlertSeverity(undefined), null);
});

test("alertSeverityMeta: unknown severities render neutral, never info blue", () => {
  for (const raw of ["high-priority", "blocker", "weird   spacing"]) {
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
