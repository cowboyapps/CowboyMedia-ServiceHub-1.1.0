import { PageHeader } from "@/components/page-header";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Download, ExternalLink, FileDown, Copy, Check, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { QueryErrorState } from "@/components/query-error-state";
import type { Download as DownloadType } from "@shared/schema";

function SectionIcon({ icon: Icon, tone }: { icon: any; tone: string }) {
  return (
    <span className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${tone}`}>
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
}

export default function DownloadsPage() {
  const { toast } = useToast();
  const [selectedDownload, setSelectedDownload] = useState<DownloadType | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: downloads, isLoading, isError, error, refetch, isFetching } = useQuery<DownloadType[]>({
    queryKey: ["/api/downloads"],
  });

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: "Copied to clipboard" });
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Downloads" subtitle="Browse available downloads" testId="text-downloads-title" />

      <section className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold flex items-center gap-3">
            <SectionIcon icon={Download} tone="bg-primary/10 text-primary" />
            Available files
          </h2>
        </div>
        
        {isLoading ? (
          <div className="divide-y divide-border">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4">
                <Skeleton className="h-12 w-12 rounded-md" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="p-6">
            <QueryErrorState
              error={error}
              onRetry={() => refetch()}
              isRetrying={isFetching}
              resourceName="downloads"
              data-testid="error-downloads"
            />
          </div>
        ) : !downloads || downloads.length === 0 ? (
          <div className="text-center py-12 px-4">
            <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
              <FileDown className="w-6 h-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">No Downloads Available</p>
            <p className="text-xs text-muted-foreground mt-1">Check back later for new downloads</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {downloads.map((dl) => (
              <li key={dl.id} className="stagger-item">
                <div
                  className="flex items-center gap-4 px-5 py-4 hover-elevate tap-interactive cursor-pointer"
                  onClick={() => { setSelectedDownload(dl); setCopied(false); }}
                  data-testid={`card-download-${dl.id}`}
                >
                  {dl.imageUrl ? (
                    <img src={dl.imageUrl} alt={dl.title} loading="lazy" decoding="async" width={48} height={48} className="w-12 h-12 rounded-md object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Download className="w-6 h-6 text-primary" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-sm truncate" data-testid={`text-download-title-${dl.id}`}>{dl.title}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{dl.description}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={!!selectedDownload} onOpenChange={(open) => { if (!open) setSelectedDownload(null); }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md" data-testid="dialog-download-detail">
          {selectedDownload && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3">
                  {selectedDownload.imageUrl ? (
                    <img src={selectedDownload.imageUrl} alt={selectedDownload.title} loading="lazy" decoding="async" width={56} height={56} className="w-14 h-14 rounded-md object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-14 h-14 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Download className="w-6 h-6 text-primary" />
                    </div>
                  )}
                  <DialogTitle className="text-left" data-testid="text-dialog-download-title">{selectedDownload.title}</DialogTitle>
                </div>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-sm text-foreground" data-testid="text-dialog-download-desc">{selectedDownload.description}</p>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Downloader Code</label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-muted px-3 py-2 rounded-md text-sm font-mono break-all" data-testid="text-downloader-code">
                      {selectedDownload.downloaderCode}
                    </code>
                    <Button
                      size="icon"
                      variant="outline"
                      className="shrink-0"
                      onClick={() => handleCopyCode(selectedDownload.downloaderCode)}
                      data-testid="button-copy-code"
                    >
                      {copied ? <Check className="w-4 h-4 text-status-online" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
              </div>
              <DialogFooter className="flex flex-col gap-2 sm:flex-col">
                <Button
                  className="w-full gap-2"
                  onClick={() => window.open(selectedDownload.downloadUrl, "_blank")}
                  data-testid="button-download"
                >
                  <ExternalLink className="w-4 h-4" />
                  Download
                </Button>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => setSelectedDownload(null)}
                  data-testid="button-close-download"
                >
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
