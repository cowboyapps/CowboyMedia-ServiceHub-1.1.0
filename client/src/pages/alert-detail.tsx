import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { format } from "date-fns";
import { ArrowLeft, AlertTriangle, CheckCircle, Clock, Info, Edit, FileText } from "lucide-react";
import { ClickableImage } from "@/components/image-lightbox";
import { RichTextEditor } from "@/components/rich-text-editor";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import DOMPurify from "dompurify";
import type { ServiceAlert, AlertUpdate, Service } from "@shared/schema";

const POSTMORTEM_ALLOWED_TAGS = ["p", "br", "strong", "em", "u", "span", "img", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "a"];
const POSTMORTEM_ALLOWED_ATTR = ["style", "src", "alt", "width", "height", "href", "target"];

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "resolved":
      return <CheckCircle className="w-4 h-4 text-status-online animate-status-glow" />;
    case "investigating":
      return <AlertTriangle className="w-4 h-4 text-status-away" />;
    case "identified":
      return <Info className="w-4 h-4 text-primary" />;
    default:
      return <Clock className="w-4 h-4 text-muted-foreground" />;
  }
}

export default function AlertDetail() {
  const params = useParams<{ id: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState("");

  const isAdmin = user?.role === "admin" || user?.role === "master_admin";

  const { data: alert, isLoading } = useQuery<ServiceAlert>({
    queryKey: ["/api/alerts", params.id],
  });

  const { data: updates, isLoading: updatesLoading } = useQuery<AlertUpdate[]>({
    queryKey: ["/api/alerts", params.id, "updates"],
  });

  const { data: services } = useQuery<Service[]>({
    queryKey: ["/api/services"],
  });

  const serviceName = services?.find((s) => s.id === alert?.serviceId)?.name;

  const postmortemMutation = useMutation({
    mutationFn: async (postmortemHtml: string) => {
      await apiRequest("PATCH", `/api/admin/alerts/${params.id}/postmortem`, { postmortemHtml });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/alerts", params.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/alerts"] });
      setEditOpen(false);
      toast({ title: alert?.postmortemPublishedAt ? "Postmortem updated" : "Postmortem published" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40" />
        <Skeleton className="h-60" />
      </div>
    );
  }

  if (!alert) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Alert not found</p>
        <Link href="/alerts">
          <Button variant="ghost" className="mt-2">Back to Alerts</Button>
        </Link>
      </div>
    );
  }

  const hasPostmortem = !!alert.postmortemHtml && !!alert.postmortemPublishedAt;

  const openEditor = () => {
    setDraft(alert.postmortemHtml || "");
    setEditOpen(true);
  };

  return (
    <div className="space-y-6">
      <Link href="/alerts">
        <Button variant="ghost" size="sm" data-testid="button-back-alerts">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Alerts
        </Button>
      </Link>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="space-y-1">
              <CardTitle className="text-xl" data-testid="text-alert-title">{alert.title}</CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  variant={alert.severity === "critical" ? "destructive" : alert.severity === "warning" ? "default" : "secondary"}
                  className="text-xs capitalize"
                >
                  {alert.severity}
                </Badge>
                <Badge variant={alert.status === "resolved" ? "secondary" : "default"} className="text-xs capitalize">
                  {alert.status}
                </Badge>
                {serviceName && <Badge variant="secondary" className="text-xs">{serviceName}</Badge>}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm whitespace-pre-wrap" data-testid="text-alert-description">{alert.description}</p>
          {alert.imageUrl && (
            <ClickableImage src={alert.imageUrl} alt="Alert attachment" className="max-h-48 rounded-md" />
          )}
          <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Created: {format(new Date(alert.createdAt), "MMM d, yyyy 'at' h:mm a")}
            </span>
            {alert.resolvedAt && (
              <span className="flex items-center gap-1">
                <CheckCircle className="w-3 h-3" />
                Resolved: {format(new Date(alert.resolvedAt), "MMM d, yyyy 'at' h:mm a")}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Updates Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {updatesLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
            </div>
          ) : !updates || updates.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No updates posted yet</p>
          ) : (
            <div className="relative space-y-0">
              <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />
              {updates.map((update) => (
                <div key={update.id} className="relative pl-7 pb-6 last:pb-0" data-testid={`alert-update-${update.id}`}>
                  <div className="absolute left-0 top-1 z-10 bg-background p-0.5 rounded-full">
                    <StatusIcon status={update.status} />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs capitalize">{update.status}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(update.createdAt), "MMM d, h:mm a")}
                      </span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{update.message}</p>
                    {update.imageUrl && (
                      <ClickableImage src={update.imageUrl} alt="Update attachment" className="max-h-32 rounded-md mt-1" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {(hasPostmortem || isAdmin) && (
        <Card data-testid="card-postmortem">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="w-4 h-4" /> Postmortem
            </CardTitle>
            {isAdmin && (
              <Button size="sm" variant="ghost" onClick={openEditor} data-testid="button-edit-postmortem">
                <Edit className="w-3.5 h-3.5 mr-1" /> {hasPostmortem ? "Edit" : "Add"}
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {hasPostmortem ? (
              <>
                <div
                  className="prose prose-sm dark:prose-invert max-w-none break-words"
                  data-testid="text-postmortem-body"
                  dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize(alert.postmortemHtml!, {
                      ALLOWED_TAGS: POSTMORTEM_ALLOWED_TAGS,
                      ALLOWED_ATTR: POSTMORTEM_ALLOWED_ATTR,
                    }),
                  }}
                />
                {alert.postmortemPublishedAt && (
                  <p className="text-xs text-muted-foreground mt-3">
                    Published {format(new Date(alert.postmortemPublishedAt), "MMM d, yyyy 'at' h:mm a")}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-postmortem-empty">
                No postmortem published yet.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{hasPostmortem ? "Edit Postmortem" : "Publish Postmortem"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              {hasPostmortem
                ? "Updates are not re-broadcast. Only the first publish notifies original recipients."
                : "Publishing notifies every customer who was notified about the original incident, plus Telegram (if enabled)."}
            </p>
            <RichTextEditor value={draft} onChange={setDraft} placeholder="What happened, why, and what changes prevent recurrence..." testIdPrefix="rich-postmortem" />
          </div>
          <DialogFooter className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => setEditOpen(false)} data-testid="button-cancel-postmortem">Cancel</Button>
            <Button
              onClick={() => postmortemMutation.mutate(draft)}
              disabled={postmortemMutation.isPending || !draft.replace(/<[^>]*>/g, "").trim()}
              data-testid="button-save-postmortem"
            >
              {postmortemMutation.isPending ? "Saving..." : hasPostmortem ? "Save Changes" : "Publish & Notify"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
