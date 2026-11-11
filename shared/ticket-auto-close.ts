import { z } from "zod";

export const DEFAULT_TICKET_AUTO_CLOSE_MESSAGE = "Ticket closed due to inactivity - You may open a new ticket should the need arise.";
export const ticketAutoCloseSettingsSchema = z.object({
  enabled: z.boolean(),
  days: z.number().int().min(1).max(365),
  message: z.string().trim().min(1).max(2000),
  reminderEnabled: z.boolean().default(false),
  reminderHoursBefore: z.number().int().min(1).max(8759).default(12),
}).strict().superRefine((settings, ctx) => {
  if (settings.reminderEnabled && settings.reminderHoursBefore >= settings.days * 24) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["reminderHoursBefore"], message: "The reminder must be at least 1 hour before closure and shorter than the inactivity period." });
  }
});
export type TicketAutoCloseSettings = z.infer<typeof ticketAutoCloseSettingsSchema>;

export function automatedClosureMessage(message: string): string {
  const body = message.replace(/^\s*Automated Message\s*:\s*/i, "").trim();
  return `Automated Message: ${body}`;
}
