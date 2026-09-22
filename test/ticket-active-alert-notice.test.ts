import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActiveAlertNoticeContent } from "../client/src/components/ticket/active-alert-notice";

(globalThis as unknown as { React: typeof React }).React = React;

const alerts = [
  { id: "live", title: "Live TV outage", status: "investigating", serviceIds: ["tv"] },
  { id: "movie", title: "Movies recovering", status: "monitoring", serviceIds: ["movies"] },
  { id: "general", title: "General incident", status: "identified", serviceIds: [] },
  { id: "old", title: "Resolved incident", status: "resolved", serviceIds: ["tv"] },
];
const render = (serviceId?: string, items = alerts) =>
  renderToStaticMarkup(React.createElement(ActiveAlertNoticeContent, { alerts: items, serviceId }));

test("shows all unresolved alerts before a service is selected", () => {
  const html = render();
  assert.match(html, /Live TV outage/);
  assert.match(html, /Movies recovering/);
  assert.match(html, /General incident/);
  assert.doesNotMatch(html, /Resolved incident/);
});

test("selected service filters unrelated alerts but retains general alerts", () => {
  const html = render("tv");
  assert.match(html, /Live TV outage/);
  assert.match(html, /General incident/);
  assert.doesNotMatch(html, /Movies recovering|Resolved incident/);
  const changed = render("movies");
  assert.match(changed, /Movies recovering/);
  assert.doesNotMatch(changed, /Live TV outage/);
});

test("no notice for empty, resolved, or unrelated-only alerts", () => {
  assert.equal(render(undefined, []), "");
  assert.equal(render(undefined, [alerts[3]]), "");
  assert.equal(render("other", [alerts[0]]), "");
});

test("direct alert links preserve the form and do not require acknowledgement", () => {
  const html = render("tv");
  assert.match(html, /href="\/alerts\/live"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /You can still submit the form below/);
  assert.doesNotMatch(html, /type="submit"| disabled[=> ]|type="checkbox"/);
});