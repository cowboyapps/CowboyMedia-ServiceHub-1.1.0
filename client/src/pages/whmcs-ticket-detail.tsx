import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { WhmcsTicketThread, type WhmcsTicketDetail } from "@/components/whmcs-tickets";

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

  const { data, isLoading, isError } = useQuery<TicketDetailResponse>({
    queryKey: ["/api/whmcs-tickets", id],
    enabled: !!id,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  const replyMutation = useMutation({
    mutationFn: async (message: string) => {
      return apiRequest("POST", `/api/whmcs-tickets/${id}/reply`, { message });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whmcs-tickets", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/whmcs-tickets"] });
      toast({ title: "Reply sent" });
    },
    onError: (e: Error) => {
      toast({ title: "Couldn't send reply", description: e.message, variant: "destructive" });
    },
  });

  return (
    <div className="max-w-3xl mx-auto" data-testid="page-whmcs-ticket-detail">
      <WhmcsTicketThread
        ticket={data?.ticket}
        isLoading={isLoading}
        isError={isError}
        context="customer"
        onReply={(message) => replyMutation.mutate(message)}
        replyPending={replyMutation.isPending}
        onBack={() => setLocation("/tickets")}
      />
    </div>
  );
}
