import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import type { ticketReminderAttempts } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Attempt = typeof ticketReminderAttempts.$inferSelect;

export function TicketReminderHistory({ ticketId }: { ticketId: string }) {
  const history = useQuery<Attempt[]>({
    queryKey: [`/api/admin/tickets/${ticketId}/reminder-history`],
    refetchInterval: 30_000,
    staleTime: 0,
  });
  return (
    <section className="space-y-2 border-b pb-4" aria-label="Inactivity reminder delivery history" data-testid="reminder-delivery-history">
      <h3 className="text-sm font-semibold">Inactivity reminders</h3>
      <p className="text-xs text-muted-foreground">
        Success means saved in the app or accepted by a provider, not read by the customer.
        Only rate-limit rejections retry, up to three attempts. Uncertain sends are never resent.
      </p>
      {history.isLoading ? <p className="text-sm">Loading delivery history…</p> : history.isError ? (
        <div role="alert" className="text-sm">
          Could not load delivery history.
          <Button variant="ghost" size="sm" onClick={() => void history.refetch()}>Try again</Button>
        </div>
      ) : !history.data?.length ? <p className="text-sm text-muted-foreground">No reminder attempts recorded.</p> : (
        <>
          <p className="text-xs text-muted-foreground">Most recent {history.data.length} attempts, across all public-activity cycles.</p>
          {history.data.map(attempt => {
            const superseded = history.data.some(other => other.channel === attempt.channel &&
              other.activityAt === attempt.activityAt && other.attempt > attempt.attempt);
            return (
            <div key={attempt.id} className="rounded-md border p-3 space-y-1 text-xs" data-testid={`reminder-attempt-${attempt.id}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{attempt.channel === "in_app" ? "In-app" : attempt.channel === "email" ? "Email" : "Push"} · Attempt {attempt.attempt}</span>
                <Badge variant={attempt.status === "failed" ? "destructive" : "secondary"}>
                  {attempt.status === "attempted" ? "Attempted · unconfirmed" : attempt.status === "succeeded" ? "Succeeded" : "Failed"}
                </Badge>
              </div>
              <p>{format(new Date(attempt.attemptedAt), "MMM d, yyyy h:mm:ss a")}</p>
              <p className="text-muted-foreground">Activity cycle: {format(new Date(attempt.activityAt), "MMM d, yyyy h:mm:ss a")}</p>
              <p>{attempt.detail}</p>
              {attempt.finishedAt && <p className="text-muted-foreground">Result recorded: {format(new Date(attempt.finishedAt), "MMM d, yyyy h:mm:ss a")}</p>}
              {superseded ? <p className="text-muted-foreground">A later attempt was recorded for this channel.</p> :
              attempt.retryable && attempt.retryAt ? <p className="text-muted-foreground">
                Retry eligible after {format(new Date(attempt.retryAt), "MMM d, h:mm a")}, only if still open, within its reminder window and in the same activity cycle.
              </p> : attempt.status === "failed" && <p className="text-muted-foreground">No further automatic retry.</p>}
            </div>
            );
          })}
        </>
      )}
    </section>
  );
}
