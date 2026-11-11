import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download as DownloadIcon, RefreshCw, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Download } from "@shared/schema";

export type DownloadRef = {
  id: string;
  title: string;
};

export function DownloadPickerDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (download: DownloadRef) => void;
}) {
  const [search, setSearch] = useState("");
  const { data: downloads, isLoading, isError, refetch } = useQuery<Download[]>({
    queryKey: ["/api/downloads"],
    enabled: open,
    staleTime: 0,
  });

  const filtered = useMemo(() => {
    const items = downloads ?? [];
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter((download) =>
      download.title.toLowerCase().includes(query) ||
      download.description.toLowerCase().includes(query) ||
      download.downloaderCode.toLowerCase().includes(query),
    );
  }, [downloads, search]);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[min(80dvh,42rem)] min-h-0 w-[calc(100vw-2rem)] flex-col overflow-hidden sm:max-w-lg"
        data-testid="download-picker-dialog"
      >
        <DialogHeader>
          <DialogTitle>Share a download</DialogTitle>
          <DialogDescription>
            Select an existing download to add its link to your draft. It won’t be sent until you send the message.
          </DialogDescription>
        </DialogHeader>

        <div className="relative shrink-0">
          <Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search downloads..."
            className="pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            data-testid="download-picker-search"
            autoFocus
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain -mx-2 px-2" aria-live="polite">
          {isLoading ? (
            <div className="space-y-2 py-2" aria-label="Loading downloads">
              {[0, 1, 2].map((item) => (
                <div key={item} className="animate-pulse rounded-md border p-3">
                  <div className="h-4 w-2/3 rounded bg-muted" />
                  <div className="mt-2 h-3 w-full rounded bg-muted" />
                  <div className="mt-1 h-3 w-1/3 rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm text-muted-foreground">Downloads couldn’t be loaded. Check your connection and try again.</p>
              <button
                type="button"
                onClick={() => void refetch()}
                className="inline-flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm font-medium hover-elevate tap-interactive"
                data-testid="download-picker-retry"
              >
                <RefreshCw aria-hidden="true" className="h-4 w-4" />
                Try again
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <p
              className="py-8 text-center text-sm text-muted-foreground"
              data-testid="download-picker-empty"
            >
              {search.trim()
                ? `No downloads match “${search.trim()}”.`
                : "No downloads are available to share yet."}
            </p>
          ) : (
            <div className="space-y-1 py-1">
              {filtered.map((download) => (
                <button
                  key={download.id}
                  type="button"
                  onClick={() => onSelect({ id: download.id, title: download.title })}
                  className="w-full rounded-md border p-2.5 text-left hover-elevate tap-interactive"
                  data-testid={`download-picker-item-${download.id}`}
                >
                  <span className="flex items-start gap-2">
                    <DownloadIcon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{download.title}</span>
                      <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">
                        {download.description}
                      </span>
                      {download.downloaderCode && (
                        <span className="mt-1 block font-mono text-[10px] text-muted-foreground">
                          Code: {download.downloaderCode}
                        </span>
                      )}
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
