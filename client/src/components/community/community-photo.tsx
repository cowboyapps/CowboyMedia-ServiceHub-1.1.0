import { useState } from "react";
import { X, Download, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

export function CommunityPhoto({ src, alt = "Photo shared in community chat", messageId }: { src: string; alt?: string; messageId: string }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch(src, { credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) throw new Error("Photo unavailable");
      const blobUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" } as Record<string, string>)[blob.type] ?? "img";
      anchor.download = `community-photo-${messageId}.${extension}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch {
      toast({ title: "Couldn’t save photo", description: "Please try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button type="button" onClick={() => { setLoaded(false); setOpen(true); }} aria-label="Open shared photo"
        className="mt-1 block max-w-full overflow-hidden rounded-xl border border-border/70 bg-background/50 text-left motion-reduce:transition-none"
        data-testid={`img-community-msg-${messageId}`}>
        {failed ? (
          <span className="flex min-h-20 items-center gap-2 px-4 text-xs text-muted-foreground">
            Photo unavailable <span className="underline">Open to retry</span>
          </span>
        ) : (
          <img key={attempt} src={src} alt={alt} loading="lazy" onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className="max-h-[300px] max-w-full object-contain transition-opacity"
            style={{ opacity: loaded ? 1 : 0.55 }} />
        )}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="fixed inset-0 z-50 flex h-[100dvh] w-full max-w-none translate-x-0 translate-y-0 flex-col rounded-none border-0 bg-[#17212b] p-0 text-[#f4f7fa] [&>button:last-child]:hidden sm:left-1/2 sm:top-1/2 sm:h-[min(92dvh,900px)] sm:w-[min(94vw,1100px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl"
          aria-describedby={undefined} data-testid={`community-photo-viewer-${messageId}`}>
          <DialogTitle className="sr-only">Community photo preview</DialogTitle>
          <header className="flex shrink-0 items-center justify-end gap-2 px-3 pt-[max(.75rem,env(safe-area-inset-top))] pb-2 sm:pt-3">
            <Button variant="ghost" size="icon" aria-label="Save image" onClick={save} disabled={saving}
              className="text-[#f4f7fa] hover:bg-white/10 hover:text-[#f4f7fa]"
              data-testid={`button-save-community-photo-${messageId}`}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" aria-label="Close image preview" onClick={() => setOpen(false)}
              className="text-[#f4f7fa] hover:bg-white/10 hover:text-[#f4f7fa]"
              data-testid={`button-close-community-photo-${messageId}`}><X className="h-4 w-4" /></Button>
          </header>
          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto px-3 pb-[max(.75rem,env(safe-area-inset-bottom))]">
            {!loaded && !failed && <div className="absolute flex items-center gap-2 text-sm text-[#f4f7fa]/70" role="status">
              <Loader2 className="h-5 w-5 animate-spin" />Loading image
            </div>}
            {failed ? (
              <div className="text-center">
              <p className="mb-3 text-sm text-[#f4f7fa]/75">This image couldn’t be loaded.</p>
                <Button variant="secondary" onClick={() => { setFailed(false); setLoaded(false); setAttempt((n) => n + 1); }}>
                  <RotateCw className="mr-2 h-4 w-4" />Try again
                </Button>
              </div>
            ) : (
              <img key={attempt} src={src} alt={alt} onLoad={() => setLoaded(true)} onError={() => setFailed(true)}
                className="max-h-full max-w-full select-none object-contain" />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
