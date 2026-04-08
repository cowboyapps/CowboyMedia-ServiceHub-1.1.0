import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Trash2, Bell, Clock, ShieldAlert, X, ChevronDown, ChevronUp } from "lucide-react";
import type { ServiceUpdate, Service } from "@shared/schema";

export default function ServiceUpdatesPage() {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const [expandedUpdates, setExpandedUpdates] = useState<Set<string>>(new Set());
  const [unlockedUpdates, setUnlockedUpdates] = useState<Set<string>>(new Set());
  const [pendingUnlock, setPendingUnlock] = useState<string | null>(null);
  const [pendingAdminDelete, setPendingAdminDelete] = useState<string | null>(null);

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

  const formatDate = (date: string | Date) => {
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const isMatureHidden = (update: ServiceUpdate) => {
    return update.matureContent && !isAdmin && !unlockedUpdates.has(update.id);
  };

  const toggleExpand = (update: ServiceUpdate) => {
    if (isMatureHidden(update)) {
      setPendingUnlock(update.id);
      return;
    }
    setExpandedUpdates(prev => {
      const next = new Set(prev);
      if (next.has(update.id)) {
        next.delete(update.id);
      } else {
        next.add(update.id);
      }
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

  if (isLoading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold" data-testid="text-service-updates-title">Service Updates</h1>
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-service-updates-title">Service Updates</h1>
        <p className="text-sm text-muted-foreground mt-1">Latest service updates</p>
      </div>

      <AlertDialog open={!!pendingUnlock} onOpenChange={(open) => { if (!open) setPendingUnlock(null); }}>
        <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm" data-testid="dialog-mature-warning">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-destructive" />
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
                  setUnlockedUpdates(prev => new Set(prev).add(pendingUnlock));
                  setExpandedUpdates(prev => new Set(prev).add(pendingUnlock));
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

      {!updates || updates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Bell className="w-12 h-12 text-muted-foreground mb-3" />
            <p className="text-muted-foreground" data-testid="text-no-updates">No service updates yet</p>
          </CardContent>
        </Card>
      ) : (
        updates.map((update) => {
          const isExpanded = expandedUpdates.has(update.id);
          return (
            <Card
              key={update.id}
              className="cursor-pointer transition-colors hover:bg-muted/30"
              onClick={() => toggleExpand(update)}
              data-testid={`card-service-update-${update.id}`}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-lg flex items-center gap-2" data-testid={`text-update-title-${update.id}`}>
                      {update.title}
                      {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
                    </CardTitle>
                    <CardDescription className="flex items-center gap-2 mt-1 flex-wrap">
                      <Badge variant="outline" data-testid={`badge-service-${update.id}`}>{getServiceName(update.serviceId)}</Badge>
                      {update.matureContent && (
                        <Badge variant="destructive" className="text-xs" data-testid={`badge-mature-${update.id}`}>
                          <ShieldAlert className="w-3 h-3 mr-1" />
                          Mature
                        </Badge>
                      )}
                      <span className="flex items-center gap-1 text-xs">
                        <Clock className="w-3 h-3" />
                        {formatDate(update.createdAt)}
                      </span>
                    </CardDescription>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={(e) => handleDeleteClick(e, update.id)}
                    disabled={deleteMutation.isPending}
                    title={isAdmin ? "Delete update" : "Dismiss update"}
                    data-testid={`button-delete-update-${update.id}`}
                  >
                    {isAdmin ? <Trash2 className="w-4 h-4" /> : <X className="w-4 h-4" />}
                  </Button>
                </div>
              </CardHeader>
              {isExpanded && (
                <CardContent>
                  {isMatureHidden(update) ? (
                    <div
                      className="flex flex-col items-center justify-center py-4 px-3 border border-dashed rounded-md bg-muted/30"
                      data-testid={`mature-overlay-${update.id}`}
                    >
                      <ShieldAlert className="w-8 h-8 text-muted-foreground mb-2" />
                      <p className="text-sm font-medium text-muted-foreground">This update contains mature content</p>
                      <p className="text-xs text-muted-foreground mt-1">Click to view</p>
                    </div>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap" data-testid={`text-update-desc-${update.id}`}>{update.description}</p>
                  )}
                </CardContent>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}
