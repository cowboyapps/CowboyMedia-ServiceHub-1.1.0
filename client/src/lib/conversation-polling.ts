/** Sockets deliver live changes; polling remains an authoritative safety net. */
export function conversationPollInterval(socket: { readyState: number } | null): number {
  return socket?.readyState === 1 ? 30_000 : 5_000;
}
