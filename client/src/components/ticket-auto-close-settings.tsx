import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Clock3, RotateCcw } from "lucide-react";
import {
  DEFAULT_TICKET_AUTO_CLOSE_MESSAGE,
  ticketAutoCloseSettingsSchema,
  type TicketAutoCloseSettings,
} from "@shared/ticket-auto-close";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

const SETTINGS_QUERY_KEY = ["/api/admin/ticket-auto-close"];
const DEFAULT_SETTINGS: TicketAutoCloseSettings = {
  enabled: false,
  days: 7,
  message: DEFAULT_TICKET_AUTO_CLOSE_MESSAGE,
};

export function TicketAutoCloseSettingsPanel() {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(DEFAULT_SETTINGS.enabled);
  const [days, setDays] = useState(String(DEFAULT_SETTINGS.days));
  const [message, setMessage] = useState(DEFAULT_SETTINGS.message);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const pendingSaveRef = useRef<TicketAutoCloseSettings | null>(null);
  const initializedRef = useRef(false);

  const settingsQuery = useQuery<TicketAutoCloseSettings>({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/admin/ticket-auto-close");
      if (!response.ok) {
        throw new Error((await response.text()) || "Could not load ticket auto-close settings.");
      }
      const result = ticketAutoCloseSettingsSchema.safeParse(await response.json());
      if (!result.success) throw new Error("The server returned invalid ticket auto-close settings.");
      return result.data;
    },
  });

  useEffect(() => {
    if (settingsQuery.data && !initializedRef.current) {
      setEnabled(settingsQuery.data.enabled);
      setDays(String(settingsQuery.data.days));
      setMessage(settingsQuery.data.message);
      initializedRef.current = true;
    }
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async (payload: TicketAutoCloseSettings) => {
      const response = await apiRequest("PATCH", "/api/admin/ticket-auto-close", payload);
      if (!response.ok) {
        throw new Error((await response.text()) || "Could not save ticket auto-close settings.");
      }
      const result = ticketAutoCloseSettingsSchema.safeParse(await response.json());
      if (!result.success) throw new Error("The server returned invalid settings after saving.");
      return result.data;
    },
    onSuccess: (saved) => {
      setEnabled(saved.enabled);
      setDays(String(saved.days));
      setMessage(saved.message);
      queryClient.setQueryData(SETTINGS_QUERY_KEY, saved);
      toast({ title: "Ticket auto-close settings saved" });
    },
    onError: (error: Error) => {
      toast({
        title: "Couldn't save settings",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    },
    onSettled: () => {
      pendingSaveRef.current = null;
      setConfirmOpen(false);
    },
  });

  const parsedDays = days.trim() === "" ? NaN : Number(days);
  const payloadResult = ticketAutoCloseSettingsSchema.safeParse({
    enabled,
    days: parsedDays,
    message,
  });
  const currentPayload = payloadResult.success ? payloadResult.data : null;
  const savedSettings = settingsQuery.data;
  const isDirty = !!currentPayload && !!savedSettings && (
    currentPayload.enabled !== savedSettings.enabled ||
    currentPayload.days !== savedSettings.days ||
    currentPayload.message !== savedSettings.message
  );
  const isLoading = settingsQuery.isLoading;
  const isLocked = isLoading || settingsQuery.isError || saveMutation.isPending || confirmOpen;
  const hasInvalidDays = !Number.isInteger(parsedDays) || parsedDays < 1 || parsedDays > 365;
  const hasInvalidMessage = !message.trim() || message.length > 2000;
  const canSave = !!savedSettings && !!currentPayload && isDirty && !isLocked;

  const submitSave = () => {
    if (!currentPayload || !savedSettings || !canSave) return;
    if (currentPayload.enabled) {
      pendingSaveRef.current = currentPayload;
      setConfirmOpen(true);
      return;
    }
    saveMutation.mutate(currentPayload);
  };

  const confirmSave = () => {
    const payload = pendingSaveRef.current;
    if (payload) saveMutation.mutate(payload);
  };

  return (
    <section className="max-w-2xl overflow-hidden rounded-xl border border-card-border bg-card" aria-labelledby="ticket-auto-close-heading">
      <div className="flex items-center gap-3 border-b border-border px-5 py-4">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-orange-500/10 text-orange-600 dark:text-orange-400" aria-hidden="true">
          <Clock3 className="h-[18px] w-[18px]" />
        </span>
        <div>
          <h2 id="ticket-auto-close-heading" className="text-sm font-semibold">Ticket auto-close</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Close inactive open tickets on a predictable schedule.</p>
        </div>
      </div>

      <div className="space-y-6 p-5">
        {isLoading ? (
          <div className="space-y-3" aria-label="Loading ticket auto-close settings">
            <Skeleton className="h-20 w-full rounded-md" />
            <Skeleton className="h-24 w-full rounded-md" />
            <Skeleton className="h-36 w-full rounded-md" />
          </div>
        ) : settingsQuery.isError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4" role="alert">
            <p className="text-sm font-medium text-destructive">Settings couldn’t be loaded.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              No defaults have been applied. Your settings are unavailable until the server responds.
            </p>
            <Button className="mt-3" variant="outline" size="sm" onClick={() => settingsQuery.refetch()}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Retry loading
            </Button>
          </div>
        ) : savedSettings && (
          <>
            <div className="flex items-center justify-between gap-4 rounded-md border p-4">
              <div className="pr-2">
                <p className="text-sm font-medium">Enable inactivity closure</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Automatically close open tickets after the selected period without a public customer or agent reply.
                </p>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                disabled={isLocked}
                aria-label="Enable ticket auto-close"
                data-testid="switch-ticket-auto-close-enabled"
              />
            </div>

            {enabled && (
              <div className="flex gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
                <p className="leading-relaxed text-muted-foreground">
                  Enabling this policy also applies to existing open tickets. Tickets that are already inactive may close within the next five minutes.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="ticket-auto-close-days">Close after</Label>
              <div className="flex max-w-sm items-center gap-3">
                <Input
                  id="ticket-auto-close-days"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={365}
                  step={1}
                  value={days}
                  onChange={(event) => setDays(event.target.value)}
                  disabled={isLocked}
                  aria-invalid={hasInvalidDays}
                  className="w-28"
                  data-testid="input-ticket-auto-close-days"
                />
                <span className="text-sm text-muted-foreground">days of inactivity</span>
              </div>
              <p className="text-xs text-muted-foreground">Choose a whole number from 1 to 365.</p>
              {hasInvalidDays && (
                <p className="text-xs text-destructive" role="alert">Enter a whole number between 1 and 365.</p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="ticket-auto-close-message">Customer message</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  onClick={() => setMessage(DEFAULT_TICKET_AUTO_CLOSE_MESSAGE)}
                  disabled={isLocked || message === DEFAULT_TICKET_AUTO_CLOSE_MESSAGE}
                  data-testid="button-reset-ticket-auto-close-message"
                >
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                  Reset to default
                </Button>
              </div>
              <Textarea
                id="ticket-auto-close-message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                maxLength={2000}
                rows={4}
                disabled={isLocked}
                aria-describedby="ticket-auto-close-message-help ticket-auto-close-message-count"
                aria-invalid={hasInvalidMessage}
                data-testid="textarea-ticket-auto-close-message"
              />
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p id="ticket-auto-close-message-help" className="max-w-lg text-xs leading-relaxed text-muted-foreground">
                  This plain-text message is shown to the customer when the ticket closes. The system adds the bold “Automated Message:” label automatically.
                </p>
                <p id="ticket-auto-close-message-count" className="text-xs tabular-nums text-muted-foreground">
                  {message.length}/2000
                </p>
              </div>
              {hasInvalidMessage && (
                <p className="text-xs text-destructive" role="alert">
                  Enter a message of up to 2,000 characters.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Message preview</p>
              <div className="min-h-16 rounded-md border bg-muted/30 p-4 text-sm leading-relaxed whitespace-pre-wrap break-words" aria-label="Preview of the automated customer message">
                <strong>Automated Message:</strong>
                {message.trim() ? <>{" "}{message}</> : <span className="text-muted-foreground"> Your message will appear here.</span>}
              </div>
            </div>

            <div className="rounded-md bg-muted/40 px-4 py-3">
              <p className="text-xs font-medium">What counts as activity?</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                A public reply or attachment from either side restarts the timer. Internal notes, read receipts, reactions, and edits do not.
              </p>
            </div>

            {saveMutation.isError && (
              <div className="flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between" role="alert">
                <div>
                  <p className="text-sm font-medium text-destructive">Settings weren’t saved.</p>
                  <p className="mt-1 text-sm text-muted-foreground">{saveMutation.error.message || "Your edits are still here. Retry when ready."}</p>
                </div>
                <Button variant="outline" size="sm" onClick={submitSave} disabled={!canSave}>
                  Retry save
                </Button>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
              <Button onClick={submitSave} disabled={!canSave} data-testid="button-save-ticket-auto-close">
                {saveMutation.isPending ? "Saving..." : "Save Settings"}
              </Button>
              {!isDirty && (
                <span className="text-xs text-muted-foreground">Your settings are up to date.</span>
              )}
            </div>
          </>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => {
        if (!open && !saveMutation.isPending) {
          pendingSaveRef.current = null;
          setConfirmOpen(false);
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply this policy to existing tickets?</AlertDialogTitle>
            <AlertDialogDescription>
              This policy change will apply to all open tickets, not only new ones. Existing tickets that have already been inactive for the selected period may close within the next five minutes. Continue only if you’re ready to apply the change now.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saveMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => {
              event.preventDefault();
              confirmSave();
            }} disabled={saveMutation.isPending} data-testid="button-confirm-ticket-auto-close">
              {saveMutation.isPending ? "Saving..." : "Apply and save"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
