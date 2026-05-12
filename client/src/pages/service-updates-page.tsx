import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Trash2, Bell, ShieldAlert, X, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { formatDistanceToNow } from "date-fns";
import type { ServiceUpdate, Service } from "@shared/schema";
import { groupServiceUpdates, type ServiceUpdateGroup } from "@shared/group-service-updates";

type Group = ServiceUpdateGroup<ServiceUpdate>;

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const re = new RegExp(`(${escapeRegExp(query)})`, "gi");
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark
            key={i}
            className="bg-yellow-200 dark:bg-yellow-500/40 text-inherit rounded-sm px-0.5"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function FilterChip({
  active,
  onClick,
  children,
  testId,
  size = "default",
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId: string;
  size?: "default" | "sm";
}) {
  const sizeClasses = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1 text-xs";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className={`${sizeClasses} rounded-full border transition-colors tap-interactive ${
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-background text-muted-foreground border-border hover:bg-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

export default function ServiceUpdatesPage() {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [unlockedUpdates, setUnlockedUpdates] = useState<Set<string>>(new Set());
  const [pendingUnlock, setPendingUnlock] = useState<string | null>(null);
  const [pendingAdminDelete, setPendingAdminDelete] = useState<string | null>(null);
  const [serviceFilter, setServiceFilter] = useState<string>(() => {
    if (typeof window === "undefined") return "all";
    try {
      return window.localStorage.getItem("service-updates:service-filter") || "all";
    } catch {
      return "all";
    }
  });
  const [timeFilter, setTimeFilter] = useState<"today" | "7d" | "30d" | "all">(() => {
    if (typeof window === "undefined") return "all";
    try {
      const v = window.localStorage.getItem("service-updates:time-filter");
      return v === "today" || v === "7d" || v === "30d" || v === "all" ? v : "all";
    } catch {
      return "all";
    }
  });
  const [searchQuery, setSearchQuery] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.sessionStorage.getItem("service-updates:search") || "";
  });

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem("service-updates:search", searchQuery);
    }
  }, [searchQuery]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem("service-updates:service-filter", serviceFilter);
    } catch {}
  }, [serviceFilter]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem("service-updates:time-filter", timeFilter);
    } catch {}
  }, [timeFilter]);

  const markUpdatesRead = useCallback(() => {
    apiRequest("POST", "/api/content-notifications/mark-read", { category: "service-updates" })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/content-notifications/counts"] });
        queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    markUpdatesRead();
  }, [markUpdatesRead]);

  useEffect(() => {
    const onVisChange = () => {
      if (document.visibilityState === "visible") markUpdatesRead();
    };
    document.addEventListener("visibilitychange", onVisChange);
    return () => document.removeEventListener("visibilitychange", onVisChange);
  }, [markUpdatesRead]);

  const { data: updates, isLoading } = useQuery<ServiceUpdate[]>({
    queryKey: ["/api/service-updates"],
    enabled: !!user,
  });

  const { data: services } = useQuery<Service[]>({
    queryKey: ["/api/services"],
    enabled: !!user,
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ id, hideOnly }: { id: string; hideOnly?: boolean }) => {
      await apiRequest("DELETE", `/api/service-updates/${id}`, hideOnly ? { hideOnly: true } : undefined);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/service-updates"] });
      if (isAdmin) {
        toast({ title: variables.hideOnly ? "Service update hidden for you" : "Service update deleted for everyone" });
      } else {
        toast({ title: "Service update dismissed" });
      }
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const getServiceName = (serviceId: string) => {
    return services?.find(s => s.id === serviceId)?.name || "Unknown Service";
  };

  const isMatureHidden = (update: ServiceUpdate) => {
    return update.matureContent && !isAdmin && !unlockedUpdates.has(update.id);
  };

  const timeRangeMs = useMemo(() => {
    switch (timeFilter) {
      case "today": return 24 * 60 * 60 * 1000;
      case "7d": return 7 * 24 * 60 * 60 * 1000;
      case "30d": return 30 * 24 * 60 * 60 * 1000;
      default: return null;
    }
  }, [timeFilter]);

  const trimmedQueryRaw = searchQuery.trim();
  const trimmedQuery = trimmedQueryRaw.toLowerCase();

  const filteredUpdates = useMemo(() => {
    if (!updates) return [];
    const now = Date.now();
    return updates.filter(u => {
      if (serviceFilter !== "all" && u.serviceId !== serviceFilter) return false;
      if (timeRangeMs !== null) {
        const t = new Date(u.createdAt).getTime();
        if (now - t > timeRangeMs) return false;
      }
      if (trimmedQuery) {
        const title = (u.title || "").toLowerCase();
        const desc = (u.description || "").toLowerCase();
        if (!title.includes(trimmedQuery) && !desc.includes(trimmedQuery)) return false;
      }
      return true;
    });
  }, [updates, serviceFilter, timeRangeMs, trimmedQuery]);

  const availableServices = useMemo(() => {
    if (!services || !updates) return [];
    const ids = new Set(updates.map(u => u.serviceId));
    return services.filter(s => ids.has(s.id));
  }, [services, updates]);

  const groups = useMemo<Group[]>(() => groupServiceUpdates(filteredUpdates), [filteredUpdates]);

  const timeRangeLabels: Record<typeof timeFilter, string> = {
    today: "today",
    "7d": "in the last 7 days",
    "30d": "in the last 30 days",
    all: "",
  };

  const emptyMessage = (() => {
    if (!updates || updates.length === 0) return "No service updates yet";
    if (trimmedQuery) return `No updates matching '${searchQuery.trim()}'`;
    const svcLabel = serviceFilter === "all"
      ? "any service"
      : (services?.find(s => s.id === serviceFilter)?.name || "this service");
    const timeLabel = timeRangeLabels[timeFilter];
    if (serviceFilter === "all" && timeFilter === "all") return "No service updates yet";
    if (serviceFilter === "all") return `No updates ${timeLabel}`;
    if (timeFilter === "all") return `No updates from ${svcLabel}`;
    return `No updates from ${svcLabel} ${timeLabel}`;
  })();

  const toggleGroup = (group: Group) => {
    if (group.items.length === 1 && isMatureHidden(group.head) && !expandedGroups.has(group.key)) {
      setPendingUnlock(group.head.id);
      return;
    }
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(group.key)) next.delete(group.key);
      else next.add(group.key);
      return next;
    });
  };

  const handleDeleteClick = (e: React.MouseEvent, updateId: string) => {
    e.stopPropagation();
    if (isAdmin) {
      setPendingAdminDelete(updateId);
    } else {
      deleteMutation.mutate({ id: updateId });
    }
  };

  const handleRevealMature = (updateId: string) => {
    setUnlockedUpdates(prev => new Set(prev).add(updateId));
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold" data-testid="text-service-updates-title">Service Updates</h1>
        <div className="space-y-2 pl-5">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-service-updates-title">Service Updates</h1>
        <p className="text-sm text-muted-foreground mt-1">Latest service updates</p>
      </div>

      {(updates?.length ?? 0) > 0 && (
        <div className="space-y-2" data-testid="filters-service-updates">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search updates..."
              className="pl-8 pr-8 h-9"
              data-testid="input-search-updates"
              aria-label="Search service updates"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted-foreground hover:text-foreground tap-interactive"
                aria-label="Clear search"
                data-testid="button-clear-search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5" data-testid="filter-chips-services">
            <FilterChip
              active={serviceFilter === "all"}
              onClick={() => setServiceFilter("all")}
              testId="chip-service-all"
            >
              All services
            </FilterChip>
            {availableServices.map(s => (
              <FilterChip
                key={s.id}
                active={serviceFilter === s.id}
                onClick={() => setServiceFilter(s.id)}
                testId={`chip-service-${s.id}`}
              >
                {s.name}
              </FilterChip>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5" data-testid="filter-chips-time">
            {([
              { v: "today", label: "Today" },
              { v: "7d", label: "7 days" },
              { v: "30d", label: "30 days" },
              { v: "all", label: "All" },
            ] as const).map(opt => (
              <FilterChip
                key={opt.v}
                active={timeFilter === opt.v}
                onClick={() => setTimeFilter(opt.v)}
                testId={`chip-time-${opt.v}`}
                size="sm"
              >
                {opt.label}
              </FilterChip>
            ))}
          </div>
        </div>
      )}

      <AlertDialog open={!!pendingUnlock} onOpenChange={(open) => { if (!open) setPendingUnlock(null); }}>
        <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm" data-testid="dialog-mature-warning">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-amber-500 dark:text-amber-400" />
              Mature Content Warning
            </AlertDialogTitle>
            <AlertDialogDescription>
              This service update has been flagged as containing mature content. Would you like to continue and view it, or close and return later?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-mature-close">Close</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingUnlock) {
                  handleRevealMature(pendingUnlock);
                  // also expand the group containing this update
                  const grp = groups.find(g => g.items.some(i => i.id === pendingUnlock));
                  if (grp) {
                    setExpandedGroups(prev => new Set(prev).add(grp.key));
                  }
                  setPendingUnlock(null);
                }
              }}
              data-testid="button-mature-continue"
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!pendingAdminDelete} onOpenChange={(open) => { if (!open) setPendingAdminDelete(null); }}>
        <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm" data-testid="dialog-admin-delete">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Service Update</AlertDialogTitle>
            <AlertDialogDescription>
              Would you like to hide this update for yourself only, or permanently delete it for all customers?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel data-testid="button-admin-delete-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingAdminDelete) {
                  deleteMutation.mutate({ id: pendingAdminDelete, hideOnly: true });
                  setPendingAdminDelete(null);
                }
              }}
              className="bg-secondary text-secondary-foreground hover:bg-secondary/80"
              data-testid="button-admin-hide-me"
            >
              Hide for me only
            </AlertDialogAction>
            <AlertDialogAction
              onClick={() => {
                if (pendingAdminDelete) {
                  deleteMutation.mutate({ id: pendingAdminDelete });
                  setPendingAdminDelete(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/80"
              data-testid="button-admin-delete-all"
            >
              Delete for everyone
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {groups.length === 0 ? (
        <div className="flex items-center gap-3 py-6 text-muted-foreground">
          <Bell className="w-5 h-5 opacity-50" />
          <p className="text-sm" data-testid="text-no-updates">{emptyMessage}</p>
        </div>
      ) : (
        <div className="relative">
          <div className="absolute left-[11px] top-3 bottom-3 w-px bg-border" aria-hidden />
          <ul className="space-y-0.5">
            {groups.map(group => {
              const isExpanded = expandedGroups.has(group.key);
              const extraCount = group.items.length - 1;
              const headMature = group.head.matureContent;
              const showSingleDescription = isExpanded && group.items.length === 1 && !isMatureHidden(group.head);
              return (
                <li key={group.key}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleGroup(group)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleGroup(group); } }}
                    className="relative flex items-start gap-3 w-full pr-1 py-2 rounded-md hover:bg-muted/40 cursor-pointer transition-colors"
                    data-testid={`row-service-update-${group.head.id}`}
                  >
                    <span className="relative z-10 flex-shrink-0 mt-1.5 ml-1.5">
                      <span className="block w-2 h-2 rounded-full bg-muted-foreground/50 ring-[3px] ring-background" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-medium text-muted-foreground shrink-0 max-w-[40%] truncate" data-testid={`text-service-${group.head.id}`}>
                          {getServiceName(group.serviceId)}
                        </span>
                        {extraCount > 0 && (
                          <span
                            className="text-[10px] font-medium bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full shrink-0"
                            data-testid={`badge-group-count-${group.head.id}`}
                          >
                            +{extraCount} more
                          </span>
                        )}
                        <span className="text-muted-foreground/40 shrink-0">·</span>
                        <span className="text-sm truncate flex-1 min-w-0" data-testid={`text-update-title-${group.head.id}`}>
                          <HighlightedText text={group.head.title} query={trimmedQueryRaw} />
                        </span>
                        {headMature && (
                          <span title="Contains mature content" className="shrink-0" data-testid={`mature-marker-${group.head.id}`}>
                            <ShieldAlert className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground/70 shrink-0 hidden sm:inline">
                          {formatDistanceToNow(new Date(group.head.createdAt), { addSuffix: true })}
                        </span>
                        <button
                          onClick={(e) => handleDeleteClick(e, group.head.id)}
                          disabled={deleteMutation.isPending}
                          className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-destructive shrink-0 tap-interactive"
                          title={isAdmin ? "Delete update" : "Dismiss update"}
                          data-testid={`button-delete-update-${group.head.id}`}
                          aria-label={isAdmin ? "Delete update" : "Dismiss update"}
                        >
                          {isAdmin ? <Trash2 className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                      <div className="text-[11px] text-muted-foreground/70 mt-0.5 sm:hidden">
                        {formatDistanceToNow(new Date(group.head.createdAt), { addSuffix: true })}
                      </div>

                      {showSingleDescription && (
                        <div className="mt-2 mb-1" onClick={(e) => e.stopPropagation()}>
                          <p className="text-sm whitespace-pre-wrap text-foreground/90" data-testid={`text-update-desc-${group.head.id}`}>
                            <HighlightedText text={group.head.description} query={trimmedQueryRaw} />
                          </p>
                        </div>
                      )}

                      {isExpanded && group.items.length === 1 && isMatureHidden(group.head) && (
                        <div
                          className="mt-2 mb-1 flex items-center gap-2 text-sm text-muted-foreground"
                          onClick={(e) => { e.stopPropagation(); setPendingUnlock(group.head.id); }}
                          data-testid={`mature-overlay-${group.head.id}`}
                        >
                          <ShieldAlert className="w-4 h-4 text-amber-500 dark:text-amber-400" />
                          <span>Mature content — click to view</span>
                        </div>
                      )}

                      {isExpanded && group.items.length > 1 && (
                        <ul className="mt-2 space-y-2.5 border-l border-border/60 pl-3 ml-0.5" onClick={(e) => e.stopPropagation()}>
                          {group.items.map((item) => {
                            const itemMatureHidden = isMatureHidden(item);
                            return (
                              <li key={item.id} className="text-sm" data-testid={`subitem-update-${item.id}`}>
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-foreground/90 truncate flex-1 min-w-0">
                                    <HighlightedText text={item.title} query={trimmedQueryRaw} />
                                  </span>
                                  {item.matureContent && (
                                    <ShieldAlert className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400 shrink-0" />
                                  )}
                                  <span className="text-xs text-muted-foreground/70 shrink-0">
                                    {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                                  </span>
                                  <button
                                    onClick={(e) => handleDeleteClick(e, item.id)}
                                    disabled={deleteMutation.isPending}
                                    className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-destructive shrink-0 tap-interactive"
                                    title={isAdmin ? "Delete update" : "Dismiss update"}
                                    data-testid={`button-delete-subitem-${item.id}`}
                                    aria-label={isAdmin ? "Delete update" : "Dismiss update"}
                                  >
                                    {isAdmin ? <Trash2 className="w-3 h-3" /> : <X className="w-3 h-3" />}
                                  </button>
                                </div>
                                {itemMatureHidden ? (
                                  <button
                                    type="button"
                                    onClick={() => setPendingUnlock(item.id)}
                                    className="mt-1 flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
                                    data-testid={`mature-overlay-${item.id}`}
                                  >
                                    <ShieldAlert className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
                                    Mature content — click to view
                                  </button>
                                ) : (
                                  <p className="text-sm text-foreground/80 whitespace-pre-wrap mt-1" data-testid={`text-update-desc-${item.id}`}>
                                    <HighlightedText text={item.description} query={trimmedQueryRaw} />
                                  </p>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
