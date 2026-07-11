import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useReconnectingWebSocket } from "@/hooks/use-reconnecting-websocket";
import { queryClient } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Mail } from "lucide-react";
import { useModalSlot } from "@/lib/modal-queue";

export function PrivateMessagePopupInner({ userId }: { userId: string }) {
  const [popupMessage, setPopupMessage] = useState<{ subject: string; body: string } | null>(null);

  useReconnectingWebSocket({
    path: "/ws",
    deps: [userId],
    onMessage: (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "private_message" && data.recipientId === userId) {
          setPopupMessage({ subject: data.subject, body: "You have a new private message. Open your Message Center to read it." });
          queryClient.invalidateQueries({ queryKey: ["/api/private-messages"] });
          queryClient.invalidateQueries({ queryKey: ["/api/private-messages/unread-count"] });
        }
        if (data.type === "thread_message" && data.message) {
          queryClient.invalidateQueries({ queryKey: ["/api/message-threads"] });
          queryClient.invalidateQueries({ queryKey: ["/api/message-threads/unread-count"] });
        }
      } catch {}
    },
  });

  // Lowest onboarding-band priority: a real-time message must never stack on
  // top of the tour, setup reminder, or any welcome dialog. It stays queued
  // (state preserved) and presents once the higher surfaces release.
  const isMine = useModalSlot("private-message", 40, !!popupMessage);

  if (!popupMessage || !isMine) return null;
  return <PrivateMessageDialog popupMessage={popupMessage} setPopupMessage={setPopupMessage} />;
}

export function PrivateMessagePopup() {
  const { user } = useAuth();
  if (!user || user.role === "admin" || user.role === "master_admin") return null;
  return <PrivateMessagePopupInner userId={user.id} />;
}

function PrivateMessageDialog({ popupMessage, setPopupMessage }: { popupMessage: { subject: string; body: string }; setPopupMessage: (v: null) => void }) {
  if (!popupMessage) return null;

  return (
    <Dialog open={!!popupMessage} onOpenChange={(open) => { if (!open) setPopupMessage(null); }}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md" data-testid="dialog-private-message-popup">
        <DialogHeader>
          <div className="flex justify-center mb-2">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Mail className="w-6 h-6 text-primary" />
            </div>
          </div>
          <DialogTitle className="text-center text-lg" data-testid="text-popup-subject">New Message: {popupMessage.subject}</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground whitespace-pre-wrap text-center" data-testid="text-popup-body">
          {popupMessage.body}
        </div>
        <DialogFooter className="flex flex-col gap-2 sm:flex-col">
          <Button className="w-full" data-testid="button-popup-view-messages" onClick={() => { setPopupMessage(null); window.location.href = "/messages"; }}>
            View Messages
          </Button>
          <Button variant="outline" className="w-full" data-testid="button-popup-dismiss" onClick={() => setPopupMessage(null)}>
            Dismiss
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
