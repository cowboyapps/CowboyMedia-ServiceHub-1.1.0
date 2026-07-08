// Pure helper for community-chat unread detection.
//
// The message list from the API is capped (default limit 50), so "new
// messages arrived" can NOT be detected by comparing list lengths — once the
// room is at the cap, new arrivals push old ones out and the length stays
// constant. Detection must key off message IDs instead.

/**
 * Returns the IDs of messages present in `messages` but not in `prevIds`,
 * in list order. Returns [] on first load (empty `prevIds`) so initial
 * history never counts as unread.
 */
export function computeNewArrivals(
  prevIds: ReadonlySet<string>,
  messages: ReadonlyArray<{ id: string }> | undefined,
): string[] {
  if (!messages || prevIds.size === 0) return [];
  return messages.filter((m) => !prevIds.has(m.id)).map((m) => m.id);
}
