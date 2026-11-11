import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageBody } from "../client/src/components/ticket/message-body";
import { automaticClosureTranscript } from "../server/ticket-auto-close-transcript";
import type { Ticket, TicketMessage } from "../shared/schema";

(globalThis as unknown as { React: typeof React }).React = React;

test("automated reply has a bold label, escapes message content and preserves visible link protocols", () => {
  const html = renderToStaticMarkup(React.createElement(MessageBody, {
    id: "closure", message: "Automated Message: Closed <script>alert(1)</script>. Visit https://example.com/help",
  }));
  assert.match(html, /<strong>Automated Message:<\/strong>/);
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("https://example.com/help"));
});

test("automatic closure transcript includes the reason and automation label, never internal notes or executable markup", () => {
  const now = new Date();
  const ticket = { subject: "Test", description: "Test", createdAt: now, closedAt: now, resolutionNote: "Automatically closed due to inactivity after 7 days" } as Ticket;
  const messages = [
    { senderId: "system", message: "Automated Message: <img onerror=bad>", createdAt: now, isInternal: false },
    { senderId: "admin", message: "INTERNAL PRIVATE", createdAt: now, isInternal: true },
  ] as TicketMessage[];
  const result = automaticClosureTranscript(ticket, messages, new Map([["system", "<script>"]]));
  assert.match(result.resolution_summary, /7 days/);
  assert.match(result.conversation, /<strong>Automated Message:<\/strong>/);
  assert.ok(!result.conversation.includes("INTERNAL PRIVATE"));
  assert.ok(!result.conversation.includes("<img"));
  assert.ok(!result.conversation.includes("<script>"));
  assert.equal(result.closed_by, "Automated inactivity closure");
});
