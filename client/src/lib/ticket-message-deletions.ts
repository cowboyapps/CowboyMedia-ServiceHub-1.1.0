import { queryClient, getQueryFn } from "./queryClient";

// IDs only, never deleted bodies. Retain through route changes so a delayed
// POST/GET/socket frame cannot put a deleted bubble back into the conversation.
const deleted = new Map<string, Set<string>>();
export function withoutDeletedTicketMessages<T extends { id: string }>(ticketId: string, messages: T[]): T[] {
  const ids = deleted.get(ticketId);
  return ids ? messages.filter((message) => !ids.has(message.id)) : messages;
}
export async function applyTicketMessageDeletion(ticketId: string, messageId: string) {
  let ids = deleted.get(ticketId);
  if (!ids) deleted.set(ticketId, ids = new Set());
  ids.add(messageId);
  const queryKey = ["/api/tickets", ticketId, "messages"];
  await queryClient.cancelQueries({ queryKey, exact: true });
  queryClient.setQueryData<{ id: string }[]>(queryKey, (messages) =>
    messages ? withoutDeletedTicketMessages(ticketId, messages) : messages);
  void queryClient.invalidateQueries({ queryKey });
}

export const ticketMessagesQueryFn: ReturnType<typeof getQueryFn> = async (context) => {
  const messages = await getQueryFn<{ id: string }[]>({ on401: "throw" })(context);
  return withoutDeletedTicketMessages(String(context.queryKey[1]), messages);
};
