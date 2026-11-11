import { z } from "zod";

export const DEFAULT_TICKET_AUTO_CLOSE_MESSAGE = "Ticket closed due to inactivity - You may open a new ticket should the need arise.";
export const ticketAutoCloseSettingsSchema = z.object({
  enabled: z.boolean(),
  days: z.number().int().min(1).max(365),
  message: z.string().trim().min(1).max(2000),
}).strict();
export type TicketAutoCloseSettings = z.infer<typeof ticketAutoCloseSettingsSchema>;

export function automatedClosureMessage(message: string): string {
  const body = message.replace(/^\s*Automated Message\s*:\s*/i, "").trim();
  return `Automated Message: ${body}`;
}
