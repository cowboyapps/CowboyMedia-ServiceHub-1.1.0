import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Activity, Bell, RotateCw, Search } from "lucide-react";
import type { ServiceAlert, ServiceUpdate } from "@shared/schema";
import { htmlToPlainTextInline } from "@shared/html-text";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { ServiceReference } from "@/lib/service-reference-links";
export type { ServiceReference } from "@/lib/service-reference-links";

export function ServiceReferencePickerDialog({
  open,
  kind,
  onOpenChange,
  onSelect,
  onCloseAutoFocus,
}: {
  open: boolean;
  kind: ServiceReference["kind"];
  onOpenChange: (open: boolean) => void;
  onSelect: (reference: ServiceReference) => void;
  onCloseAutoFocus?: () => void;
}) {
  const [search, setSearch] = useState("");
  const alertsQuery = useQuery<ServiceAlert[]>({
    queryKey: ["/api/alerts"],
    enabled: open && kind === "alert",
    staleTime: 30_000,
  });
  const updatesQuery = useQuery<ServiceUpdate[]>({
    queryKey: ["/api/service-updates"],
    enabled: open && kind === "update",
    staleTime: 30_000,
  });
  const query = kind === "alert" ? alertsQuery : updatesQuery;

  const filteredAlerts = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return [...(alertsQuery.data ?? [])]
      .sort((a, b) => {
        const aResolved = a.status.toLocaleLowerCase() === "resolved";
        const bResolved = b.status.toLocaleLowerCase() === "resolved";
        if (aResolved !== bResolved) return aResolved ? 1 : -1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      })
      .filter(alert =>
        !term ||
        alert.title.toLocaleLowerCase().includes(term) ||
        htmlToPlainTextInline(alert.description).toLocaleLowerCase().includes(term),
      );
  }, [alertsQuery.data, search]);

  const filteredUpdates = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return [...(updatesQuery.data ?? [])]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .filter(update =>
        !term ||
        update.title.toLocaleLowerCase().includes(term) ||
        htmlToPlainTextInline(update.description).toLocaleLowerCase().includes(term),
      );
  }, [updatesQuery.data, search]);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const items = kind === "alert" ? filteredAlerts : filteredUpdates;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[min(80dvh,42rem)] min-h-0 w-[calc(100vw-2rem)] flex-col overflow-hidden sm:max-w-lg"
        data-testid="service-reference-picker-dialog"
        onCloseAutoFocus={event => {
          if (!onCloseAutoFocus) return;
          event.preventDefault();
          onCloseAutoFocus();
        }}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>{kind === "alert" ? "Link a service alert" : "Link a service update"}</DialogTitle>
          <DialogDescription>
            Choose a published {kind === "alert" ? "alert" : "update"} to add its title and link to your message draft.
          </DialogDescription>
        </DialogHeader>

        <div className="relative shrink-0">
          <Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={search}
            onChange={event => setSearch(event.target.value)}
            className="pl-9"
            placeholder={`Search ${kind === "alert" ? "alerts" : "updates"}...`}
            aria-label={`Search service ${kind === "alert" ? "alerts" : "updates"}`}
            data-testid="input-service-reference-search"
          />
        </div>

        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain -mx-2 px-2"
          tabIndex={0}
          aria-label={kind === "alert" ? "Service alerts" : "Service updates"}
          aria-live="polite"
        >
          {query.isLoading ? (
            <div className="space-y-2 py-2" aria-label={`Loading ${kind === "alert" ? "service alerts" : "service updates"}`}>
              {[0, 1, 2].map(item => (
                <div key={item} className="space-y-2 rounded-md border p-3">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              ))}
            </div>
          ) : query.isError ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center" role="alert">
              <p className="text-sm text-muted-foreground">
                {kind === "alert" ? "Service alerts" : "Service updates"} couldn’t load. Check your connection and try again.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void query.refetch()}
                disabled={query.isFetching}
                data-testid="button-service-reference-retry"
              >
                <RotateCw aria-hidden="true" className={`mr-1.5 h-3.5 w-3.5 ${query.isFetching ? "animate-spin" : ""}`} />
                {query.isFetching ? "Trying again..." : "Try again"}
              </Button>
            </div>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground" data-testid="text-service-reference-empty">
              {search.trim()
                ? `No ${kind === "alert" ? "service alerts" : "service updates"} match “${search.trim()}”.`
                : `No published ${kind === "alert" ? "service alerts" : "service updates"} are available.`}
            </p>
          ) : (
            <div className="space-y-1 py-1">
              {kind === "alert"
                ? filteredAlerts.map(alert => (
                  <button
                    key={alert.id}
                    type="button"
                    onClick={() => onSelect({ kind: "alert", id: alert.id, title: alert.title })}
                    className="flex w-full items-start gap-2.5 rounded-md border border-border/70 p-3 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    data-testid={`button-service-alert-pick-${alert.id}`}
                  >
                    <Bell aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{alert.title}</span>
                      <span className="mt-1 block line-clamp-2 text-xs text-muted-foreground">
                        {htmlToPlainTextInline(alert.description)}
                      </span>
                      <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                        <span className="rounded-full bg-accent px-2 py-0.5 font-medium text-foreground">Service alert</span>
                        <span>{alert.status}</span>
                        <span aria-hidden="true">·</span>
                        <time dateTime={new Date(alert.createdAt).toISOString()}>{format(new Date(alert.createdAt), "MMM d, yyyy")}</time>
                      </span>
                    </span>
                  </button>
                ))
                : filteredUpdates.map(update => (
                  <button
                    key={update.id}
                    type="button"
                    onClick={() => onSelect({ kind: "update", id: update.id, title: update.title })}
                    className="flex w-full items-start gap-2.5 rounded-md border border-border/70 p-3 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    data-testid={`button-service-update-pick-${update.id}`}
                  >
                    <Activity aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{update.title}</span>
                      <span className="mt-1 block line-clamp-2 text-xs text-muted-foreground">
                        {htmlToPlainTextInline(update.description)}
                      </span>
                      <span className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="rounded-full bg-accent px-2 py-0.5 font-medium text-foreground">Service update</span>
                        <time dateTime={new Date(update.createdAt).toISOString()}>{format(new Date(update.createdAt), "MMM d, yyyy")}</time>
                      </span>
                    </span>
                  </button>
                ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
