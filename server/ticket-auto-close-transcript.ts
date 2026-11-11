import type { Ticket, TicketMessage } from "@shared/schema";

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const text = (value: string) => escape(value).replace(/\r?\n/g, "<br>");

/** Only existing public messages are eligible, exactly as with a manual close. */
export function automaticClosureTranscript(ticket: Ticket, messages: TicketMessage[], names: Map<string, string>) {
  return {
    ticket_subject: ticket.subject,
    ticket_description: ticket.description,
    opened_date: ticket.createdAt.toISOString(),
    closed_date: ticket.closedAt?.toISOString() ?? "",
    closed_by: "Automated inactivity closure",
    resolution_summary: `<h3>Automated Closure — Inactivity</h3><p>${text(ticket.resolutionNote ?? "")}</p>`,
    conversation: messages.filter(message => !message.isInternal).map(message => {
      const body = text(message.message).replace(/^Automated Message:/, "<strong>Automated Message:</strong>");
      // Keep only app-owned attachment paths; never interpolate arbitrary stored URLs.
      const attachment = message.imageUrl?.startsWith("/uploads/")
        ? `<p><a href="${escape(message.imageUrl)}">View Attachment</a></p>` : "";
      return `<div><p><strong>${escape(names.get(message.senderId) ?? "Support")}</strong> — ${message.createdAt.toISOString()}</p><p>${body}</p>${attachment}</div>`;
    }).join(""),
  };
}
