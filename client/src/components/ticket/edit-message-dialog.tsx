import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { serverActionErrorMessage } from "@/lib/server-error";
import { useToast } from "@/hooks/use-toast";

export function EditTicketMessageDialog({ ticketId, message, onClose }: {
  ticketId: string;
  message: { id: string; message: string; imageUrl?: string | null; kbArticleSlug?: string | null };
  onClose: () => void;
}) {
  const [text, setText] = useState(message.message);
  const original = useRef(message.message);
  const [error, setError] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const save = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/tickets/${ticketId}/messages/${message.id}`, {
      message: text, originalMessage: original.current,
    }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/tickets", ticketId, "messages"] });
      onClose();
    },
    onError: (cause: Error) => {
      const description = serverActionErrorMessage(cause, "Couldn't save your changes. Please try again.");
      setError(description);
      toast({ title: "Couldn't edit message", description, variant: "destructive" });
    },
  });
  const canSave = text.trim() !== original.current &&
    (!!text.trim() || !!message.imageUrl || !!message.kbArticleSlug);
  return (
    <Dialog open onOpenChange={open => { if (!open && !save.isPending) onClose(); }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto" data-testid="dialog-edit-ticket-message"
        onCloseAutoFocus={event => {
          event.preventDefault();
          document.querySelector<HTMLButtonElement>(`[data-testid="button-message-actions-${message.id}"]`)?.focus({ preventScroll: true });
        }}>
        <DialogHeader>
          <DialogTitle>Edit message</DialogTitle>
          <DialogDescription>Your changes will be visible to the customer. Attachments stay unchanged.</DialogDescription>
        </DialogHeader>
        <form onSubmit={event => { event.preventDefault(); if (canSave && !save.isPending) { setError(""); save.mutate(); } }} className="space-y-4">
          <Textarea aria-label="Edit sent message" value={text} onChange={event => setText(event.target.value)}
            disabled={save.isPending} rows={5} className="max-h-[35dvh] min-h-20 resize-y"
            data-testid="input-edit-ticket-message" aria-invalid={!!error} aria-describedby={error ? "ticket-edit-error" : undefined} />
          {error && <p id="ticket-edit-error" role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose} data-testid="button-cancel-edit-ticket-message">Cancel</Button>
            <Button type="submit" disabled={!canSave || save.isPending} data-testid="button-save-edit-ticket-message">{save.isPending ? "Saving…" : "Save changes"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
