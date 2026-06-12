import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderNotification,
  interpolateNotification,
  tidyNotification,
  getNotificationTemplateDef,
  NOTIFICATION_TEMPLATE_DEFS,
} from "./notification-templates";

test("defaults render byte-identical to the canonical copy", () => {
  assert.deepEqual(
    renderNotification("whmcs.service.renewal", { service: "Web Hosting", when: "renews today" }),
    { title: "Service renews soon", body: "Your service Web Hosting renews today." },
  );
  assert.deepEqual(
    renderNotification("whmcs.service.suspended", { service: "Web Hosting" }),
    { title: "Service suspended", body: "Your service Web Hosting has been suspended." },
  );
  assert.deepEqual(
    renderNotification("whmcs.service.unsuspended", { service: "Web Hosting" }),
    { title: "Service reactivated", body: "Your service Web Hosting is active again." },
  );
  assert.deepEqual(
    renderNotification("whmcs.ticket.reply", { subject: "Billing question" }),
    { title: "New Billing Ticket Reply", body: "Reply on: Billing question" },
  );
});

test("invoice body tidies away an empty amount", () => {
  assert.deepEqual(
    renderNotification("whmcs.invoice.due_soon", { invoice: "#1234", amount: "10.00 USD", when: "is due in 3 days" }),
    { title: "Invoice due soon", body: "Invoice #1234 (10.00 USD) is due in 3 days." },
  );
  assert.deepEqual(
    renderNotification("whmcs.invoice.overdue", { invoice: "#1234", amount: "", when: "is overdue" }),
    { title: "Invoice overdue", body: "Invoice #1234 is overdue." },
  );
});

test("an enabled override wins over the default", () => {
  const out = renderNotification(
    "whmcs.service.suspended",
    { service: "Web Hosting" },
    { title: "Heads up", body: "{service} is paused — pay to restore.", enabled: true },
  );
  assert.deepEqual(out, { title: "Heads up", body: "Web Hosting is paused — pay to restore." });
});

test("a disabled override falls back to the default wording", () => {
  const out = renderNotification(
    "whmcs.service.suspended",
    { service: "Web Hosting" },
    { title: "Heads up", body: "Custom body", enabled: false },
  );
  assert.deepEqual(out, { title: "Service suspended", body: "Your service Web Hosting has been suspended." });
});

test("a blank override field falls back per-field to the default", () => {
  const out = renderNotification(
    "whmcs.service.suspended",
    { service: "Web Hosting" },
    { title: "", body: "Custom: {service}", enabled: true },
  );
  assert.deepEqual(out, { title: "Service suspended", body: "Custom: Web Hosting" });
});

test("interpolate leaves unknown tokens untouched", () => {
  assert.equal(interpolateNotification("{a} and {b}", { a: "X" }), "X and {b}");
});

test("tidy drops empty parens and trims space before punctuation", () => {
  assert.equal(tidyNotification("Invoice #1 ( )  is overdue ."), "Invoice #1 is overdue.");
});

test("every def is retrievable and unique by key", () => {
  const keys = NOTIFICATION_TEMPLATE_DEFS.map((d) => d.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const def of NOTIFICATION_TEMPLATE_DEFS) {
    assert.equal(getNotificationTemplateDef(def.key), def);
  }
});
