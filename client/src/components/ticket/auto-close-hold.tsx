import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CalendarClock, Clock3, PauseCircle, X } from "lucide-react";
import type { Ticket } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

type HoldPayload =
  | { enabled: true; reason: string; expiresAt: string | null }
  | { enabled: false };

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTime(value: Date | string | null | undefined): string | null {
  const date = asDate(value);
  if (!date) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function toLocalDateTime(value: Date | string | null | undefined): string {
  const date = asDate(value);
  if (!date) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.replace(/^\d{3}:\s*/, "").trim();
    try {
      const parsed = JSON.parse(message);
      return parsed.message || parsed.error || message;
    } catch {
      return message || "The hold could not be updated. Please try again.";
    }
  }
  return "The hold could not be updated. Please try again.";
}

export function TicketAutoCloseHold({
  ticket,
  isAdmin,
}: {
  ticket: Ticket;
  isAdmin: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const holdTicket = ticket;
  const reason = holdTicket.autoCloseHoldReason?.trim() || "";
  const until = asDate(holdTicket.autoCloseHoldUntil);
  const hasHold = Boolean(reason);
  const isOpen = ticket.status === "open";
  const [now, setNow] = useState(Date.now);
  const expiryTime = until?.getTime();
  useEffect(() => {
    setNow(Date.now());
    if (!expiryTime) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiryTime]);
  const isExpired = Boolean(until && until.getTime() <= now);
  const isActive = hasHold && (!until || !isExpired);

  const [editing, setEditing] = useState(false);
  const [draftReason, setDraftReason] = useState(reason);
  const [draftExpiry, setDraftExpiry] = useState(toLocalDateTime(holdTicket.autoCloseHoldUntil));
  const [validationError, setValidationError] = useState("");
  const [serverError, setServerError] = useState("");

  const mutation = useMutation({
    mutationFn: async (payload: HoldPayload) => {
      const response = await apiRequest("PATCH", `/api/tickets/${ticket.id}/auto-close-hold`, payload);
      return (await response.json()) as Ticket;
    },
    onSuccess: async (_updatedTicket, payload) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/tickets", ticket.id] }),
        queryClient.invalidateQueries({ queryKey: ["/api/tickets"] }),
      ]);
      setServerError("");
      setValidationError("");
      setEditing(false);
      if (payload.enabled) {
        toast({ title: hasHold ? "Auto-close hold updated" : "Auto-close hold added" });
      } else {
        toast({ title: "Auto-close hold removed" });
      }
    },
    onError: (error) => {
      const message = getErrorMessage(error);
      setServerError(message);
      toast({
        title: "Could not update auto-close hold",
        description: message,
        variant: "destructive",
      });
    },
  });

  if (!isOpen || (!isAdmin && !isActive)) return null;

  const canManage = isAdmin;
  const startEditing = () => {
    setDraftReason(reason);
    setDraftExpiry(toLocalDateTime(holdTicket.autoCloseHoldUntil));
    setValidationError("");
    setServerError("");
    setEditing(true);
  };

  const submit = () => {
    const trimmedReason = draftReason.trim();
    if (!trimmedReason) {
      setValidationError("Enter a reason for this hold.");
      return;
    }
    if (trimmedReason.length > 2000) {
      setValidationError("The reason must be 2,000 characters or fewer.");
      return;
    }
    let expiresAt: string | null = null;
    if (draftExpiry) {
      const expiryDate = new Date(draftExpiry);
      if (Number.isNaN(expiryDate.getTime()) || expiryDate.getTime() <= Date.now()) {
        setValidationError("Choose an expiry time in the future.");
        return;
      }
      expiresAt = expiryDate.toISOString();
    }
    setValidationError("");
    setServerError("");
    mutation.mutate({ enabled: true, reason: trimmedReason, expiresAt });
  };

  const removeHold = () => {
    setServerError("");
    setValidationError("");
    mutation.mutate({ enabled: false });
  };

  const statusLabel = isExpired ? "Hold expired" : "Auto-close paused";

  return (
    <section
      className={`mb-3 rounded-lg border p-3 sm:p-4 ${
        isActive
          ? "border-amber-500/30 bg-amber-50/70 dark:bg-amber-950/20"
          : "border-border bg-card"
      }`}
      aria-label="Ticket auto-close hold"
      data-testid="ticket-auto-close-hold"
    >
      {hasHold && (isActive || (canManage && isExpired)) && !editing && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="flex min-w-0 flex-1 gap-2.5">
            <span
              className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${
                isExpired
                  ? "bg-muted text-muted-foreground"
                  : "bg-amber-500/15 text-amber-800 dark:text-amber-300"
              }`}
              aria-hidden="true"
            >
              {isExpired ? <Clock3 className="h-4 w-4" /> : <PauseCircle className="h-4 w-4" />}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold">{statusLabel}</p>
                {isExpired && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    Expired
                  </span>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground/90">{reason}</p>
              {until && (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CalendarClock className="h-3.5 w-3.5" />
                  {isExpired ? "Expired" : "Expires"} {formatDateTime(until)}
                </p>
              )}
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                When the hold expires or is removed, the original inactivity clock resumes and the ticket may close immediately.
                Manual closure is unaffected. The global auto-close setting is unchanged.
              </p>
            </div>
          </div>
          {canManage && (
            <div className="flex flex-shrink-0 gap-2 sm:justify-end">
              <Button type="button" size="sm" variant="outline" onClick={startEditing} disabled={mutation.isPending} data-testid="button-edit-auto-close-hold">
                {isExpired ? "Renew hold" : "Edit hold"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={removeHold}
                disabled={mutation.isPending}
                data-testid="button-remove-auto-close-hold"
              >
                <X className="mr-1 h-3.5 w-3.5" />
                Remove
              </Button>
            </div>
          )}
        </div>
      )}

      {!hasHold && canManage && !editing && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock3 className="h-4 w-4" />
            <span>Auto-close follows the ticket’s normal inactivity clock.</span>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={startEditing} data-testid="button-add-auto-close-hold">
            <PauseCircle className="mr-1.5 h-4 w-4" />
            Pause auto-close
          </Button>
        </div>
      )}

      {editing && canManage && (
        <div className="space-y-3">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-800 dark:text-amber-300">
              <PauseCircle className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-semibold">{hasHold ? "Update auto-close hold" : "Pause ticket auto-close"}</h3>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                The hold pauses automatic closure only. Expiry or removal resumes the original inactivity clock, and the ticket may close immediately. Manual closure and the global auto-close setting are unchanged.
              </p>
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`hold-reason-${ticket.id}`} className="text-sm font-medium">Reason</label>
            <Textarea
              id={`hold-reason-${ticket.id}`}
              value={draftReason}
              onChange={(event) => {
                setDraftReason(event.target.value);
                setValidationError("");
                setServerError("");
              }}
              maxLength={2000}
              rows={3}
              placeholder="Why should automatic closure be paused?"
              disabled={mutation.isPending}
              aria-invalid={Boolean(validationError && !draftReason.trim())}
              data-testid="input-auto-close-hold-reason"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Required · 1–2,000 characters</span>
              <span>{draftReason.length}/2,000</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`hold-expiry-${ticket.id}`} className="text-sm font-medium">Expiry <span className="font-normal text-muted-foreground">(optional)</span></label>
            <Input
              id={`hold-expiry-${ticket.id}`}
              type="datetime-local"
              value={draftExpiry}
              onChange={(event) => {
                setDraftExpiry(event.target.value);
                setValidationError("");
                setServerError("");
              }}
              disabled={mutation.isPending}
              data-testid="input-auto-close-hold-expiry"
            />
            <p className="text-xs text-muted-foreground">Leave blank for a hold with no scheduled expiry. Any expiry must be in the future.</p>
          </div>
          {(validationError || serverError) && (
            <p role="alert" className="flex items-start gap-1.5 text-sm text-destructive" data-testid="text-auto-close-hold-error">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{validationError || serverError}</span>
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(false);
                setValidationError("");
                setServerError("");
              }}
              disabled={mutation.isPending}
              data-testid="button-cancel-auto-close-hold"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={submit}
              disabled={mutation.isPending}
              data-testid="button-save-auto-close-hold"
            >
              {mutation.isPending ? "Saving…" : hasHold ? "Save changes" : "Pause auto-close"}
            </Button>
          </div>
        </div>
      )}

      {!canManage && hasHold && isActive && (
        <p className="sr-only">Automatic ticket closure is paused.</p>
      )}
      {!editing && serverError && (
        <p role="alert" className="mt-2 text-sm text-destructive">{serverError}</p>
      )}
    </section>
  );
}
