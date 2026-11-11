/** Public invalidations identify the resource only; ticket contents require an authorized API read. */
export function ticketInvalidationEvent(type: "ticket_updated" | "new_ticket", ticketId: string) {
  return { type, ticket: { id: ticketId } };
}
