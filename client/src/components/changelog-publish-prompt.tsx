import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { queryClient } from "@/lib/queryClient";
import { apiRequest, TimeoutError } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Rocket } from "lucide-react";
import { APP_VERSION } from "@shared/version";
import { useModalSlot } from "@/lib/modal-queue";
import DOMPurify from "dompurify";

// After a version change, the collected notes are stamped with the new
// APP_VERSION and flipped to "awaiting_publish" — nothing is customer-visible
// until a master admin clicks Publish, which simply makes the entry live on
// the What's New page (no popup, no notification — the header version badge
// shows a subtle dot instead). This prompt nudges them to preview + publish
// the moment they open the app after such a change. Dismissable (per version, via localStorage) so
// it doesn't nag once acknowledged. Master admin only.
type PendingPublish = { version: string; title: string; bodyHtml: string } | null;

function dismissKey(userId: string, version: string): string {
  return `changelog-publish-prompt:${userId}:${version}`;
}

export function ChangelogPublishPrompt() {
  const { user, isMasterAdmin } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const { data: pending } = useQuery<PendingPublish>({
    queryKey: ["/api/admin/changelog/pending-publish"],
    enabled: !!user && isMasterAdmin,
    staleTime: 0,
  });

  useEffect(() => {
    setOpen(false);
    setShowPreview(false);
  }, [user?.id]);

  useEffect(() => {
    if (!user || !isMasterAdmin || !pending) return;
    let dismissed: string | null = null;
    try {
      dismissed = window.localStorage.getItem(dismissKey(user.id, pending.version));
    } catch {
      // localStorage may throw in private mode — treat as not-dismissed.
    }
    if (dismissed) return;
    setOpen(true);
  }, [user, isMasterAdmin, pending]);

  const sanitized = useMemo(
    () => (pending ? DOMPurify.sanitize(pending.bodyHtml, { ADD_ATTR: ["id"] }) : ""),
    [pending],
  );

  const publishMutation = useMutation({
    mutationFn: async (version: string) =>
      apiRequest("POST", `/api/admin/changelog/${version}/publish`, undefined, { timeoutMs: 15_000 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/changelog"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/changelog/pending-publish"] });
      setOpen(false);
      toast({ title: "Published", description: "The release notes are now live on the What's New page. No popups or notifications were sent." });
    },
    onError: (e: any) =>
      e instanceof TimeoutError
        ? toast({ title: "Publish timed out", description: "Couldn't reach the server. Please try again.", variant: "destructive" })
        : toast({ title: "Publish failed", description: e?.message ?? "", variant: "destructive" }),
  });

  const dismiss = () => {
    if (user && pending) {
      try {
        window.localStorage.setItem(dismissKey(user.id, pending.version), "1");
      } catch {
        // best-effort
      }
    }
    setOpen(false);
  };

  const isMine = useModalSlot("changelog-publish-prompt", 70, open && !!pending && isMasterAdmin);

  if (!user || !isMasterAdmin || !open || !isMine || !pending) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) dismiss(); }}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-changelog-publish-prompt">
        <DialogHeader>
          <div className="flex justify-center mb-2">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
              <Rocket className="w-7 h-7 text-primary" />
            </div>
          </div>
          <DialogTitle className="text-center text-xl" data-testid="text-changelog-publish-prompt-title">
            v{pending.version} is ready to publish
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground text-center">
          The release notes for v{pending.version} are staged. Publishing makes them live on the What's New page — customers aren't interrupted; the header version badge quietly shows a dot until they take a look.
        </p>

        {showPreview && (
          <div className="rounded-md border p-4 mt-2" data-testid="changelog-publish-prompt-preview">
            <h2 className="text-lg font-bold">Version {pending.version}</h2>
            {pending.title && <p className="text-sm text-muted-foreground mt-1">{pending.title}</p>}
            <div
              className="prose prose-sm max-w-none dark:prose-invert mt-3"
              dangerouslySetInnerHTML={{ __html: sanitized }}
            />
          </div>
        )}

        <DialogFooter className="flex flex-col gap-2 sm:flex-col">
          <Button
            className="w-full"
            onClick={() => publishMutation.mutate(pending.version)}
            disabled={publishMutation.isPending}
            data-testid="button-changelog-publish-prompt-publish"
          >
            Publish v{pending.version} now
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setShowPreview((v) => !v)}
            data-testid="button-changelog-publish-prompt-preview"
          >
            {showPreview ? "Hide preview" : "Preview"}
          </Button>
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => { dismiss(); navigate("/admin"); }}
            data-testid="button-changelog-publish-prompt-edit"
          >
            Review in Admin Portal
          </Button>
          <Button
            variant="ghost"
            className="w-full text-muted-foreground"
            onClick={dismiss}
            data-testid="button-changelog-publish-prompt-dismiss"
          >
            Later
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
