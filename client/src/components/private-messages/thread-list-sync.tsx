import { useReconnectingWebSocket } from "@/hooks/use-reconnecting-websocket";
import { queryClient } from "@/lib/queryClient";

/** Keep list previews fresh too, not only an already-open conversation. */
export function ThreadListSync() {
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["/api/message-threads"] });
    void queryClient.invalidateQueries({ queryKey: ["/api/message-threads/unread-count"] });
  };
  useReconnectingWebSocket({
    path: "/ws",
    onOpen: refresh,
    onVisible: refresh,
    onMessage: event => {
      try {
        const data = JSON.parse(event.data);
        if (typeof data.type !== "string" || !data.type.startsWith("thread_")) return;
        if (data.type === "thread_message_deleted" && typeof data.threadId === "string" && typeof data.messageId === "string") {
          queryClient.setQueryData<Array<{ id: string }>>(["/api/message-threads", data.threadId, "messages"],
            old => old?.filter(message => message.id !== data.messageId));
        }
        refresh();
      } catch { /* Malformed frames never replace authoritative list data. */ }
    },
  });
  return null;
}
