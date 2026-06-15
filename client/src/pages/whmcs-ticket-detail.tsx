import { useEffect } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { serverActionErrorMessage } from "@/lib/server-error";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { markTicketSeen } from "@/lib/whmcs-unread";
import { latestReplyDate } from "@shared/whmcs-unread";
import { WhmcsTicketThread, type WhmcsTicketDetail, type WhmcsAttachment } from "@/components/whmcs-tickets";

interface TicketDetailResponse {
  ticket: WhmcsTicketDetail;
}

// Customer-facing single WHMCS (billing & account support) ticket thread.
// Read-on-demand mirror — never stored. Replies post back to WHMCS as the
// client; the thread refetches after a successful reply so the new message
// shows immediately.
export default function WhmcsTicketDetailPage() {
  const params = useParams();
  const id = params.id;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();

  const { data, isLoading, isError } = useQuery<TicketDetailResponse>({
    queryKey: ["/api/whmcs-tickets", id],
    enabled: !!id,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  // Opening (and re-viewing) the thread clears its "new reply" flag: record the
  // latest reply date so the list badge stops counting this ticket until staff
  // reply again on a later day.
  useEffect(() => {
    if (data?.ticket) {
      markTicketSeen(user?.id ?? null, data.ticket.id, latestReplyDate(data.ticket.messages));
    }
  }, [data?.ticket, user?.id]);

  const replyMutation = useMutation({
    mutationFn: async ({ message, files }: { message: string; files: File[] }) => {
      const form = new FormData();
      form.append("message", message);
      for (const f of files) form.append("attachments", f);
      const res = await fetch(`/api/whmcs-tickets/${id}/reply`, {
        method: "POST",
        body: form,
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { message?: string }));
        throw new Error(body.message || `Reply failed (${res.status})`);
      }
      return res.json().catch(() => ({}));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whmcs-tickets", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/whmcs-tickets"] });
      toast({ title: "Reply sent" });
    },
    onError: (e: Error) => {
      toast({ title: "Couldn't send reply", description: serverActionErrorMessage(e, "Couldn't send your reply. Please try again."), variant: "destructive" });
    },
  });

  const buildAttachmentUrl = (a: WhmcsAttachment) =>
    `/api/whmcs-tickets/${id}/attachments?type=${encodeURIComponent(a.type)}&relatedid=${encodeURIComponent(
      String(a.relatedId),
    )}&index=${encodeURIComponent(String(a.index))}`;

  return (
    <div className="max-w-3xl mx-auto" data-testid="page-whmcs-ticket-detail">
      <WhmcsTicketThread
        ticket={data?.ticket}
        isLoading={isLoading}
        isError={isError}
        context="customer"
        onReply={(message, files) => replyMutation.mutate({ message, files })}
        replyPending={replyMutation.isPending}
        onBack={() => setLocation("/tickets")}
        buildAttachmentUrl={buildAttachmentUrl}
      />
    </div>
  );
}
