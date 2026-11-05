import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ArrowLeft, Play, Share2, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import * as Dialog from "@radix-ui/react-dialog";

export type TicketMedia = { ticketId: string; messageId: string; name: string; kind: "image" | "video" | "file"; contentType?: string };

function attachmentFilename(headers: Headers, fallback: string) {
  const disposition = headers.get("content-disposition") || "";
  const encoded = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  const plain = disposition.match(/filename\s*=\s*"([^"]+)"/i)?.[1] ?? disposition.match(/filename\s*=\s*([^;]+)/i)?.[1];
  try { return encoded ? decodeURIComponent(encoded.trim()) : plain?.trim() || fallback; }
  catch { return plain?.trim() || fallback; }
}

export function TicketAttachment({ media, onOpen }: { media: TicketMedia; onOpen: (media: TicketMedia) => void }) {
  const [failed, setFailed] = useState(false);
  const endpoint = `/api/tickets/${encodeURIComponent(media.ticketId)}/messages/${encodeURIComponent(media.messageId)}/attachment`;
  if (media.kind === "image") return (
    <button type="button" onClick={() => onOpen(media)} className="mt-2 block overflow-hidden rounded-xl border border-black/10 dark:border-white/10" data-testid={`ticket-attachment-${media.messageId}`}>
      {failed ? <span className="flex min-h-20 items-center px-4 text-xs opacity-70">Attachment unavailable — open to retry</span> :
        <img src={endpoint} alt={media.name || "Ticket attachment"} loading="lazy" onError={() => setFailed(true)} className="max-h-64 max-w-full object-contain bg-black/5" />}
    </button>
  );
  if (media.kind === "video") return (
    <button type="button" onClick={() => onOpen(media)} className="mt-2 flex min-h-20 w-full max-w-sm items-center gap-3 rounded-xl border border-border bg-background/55 px-3 py-2 text-left" data-testid={`ticket-attachment-${media.messageId}`}>
      <span className="flex h-11 w-14 shrink-0 items-center justify-center rounded-lg bg-foreground/10" aria-hidden="true"><Play className="h-5 w-5" /></span>
      <span className="min-w-0"><span className="block text-sm font-medium">Video attachment</span><span className="block truncate text-xs opacity-70">{media.name}</span></span>
    </button>
  );
  return <button type="button" onClick={() => onOpen(media)} className="mt-2 flex min-w-0 items-center gap-2 rounded-lg bg-background/50 p-2 text-left text-sm underline underline-offset-2" data-testid="file-attachment">
    <span aria-hidden="true">File</span><span className="min-w-0 flex-1 truncate">{media.name}</span><ArrowDownToLine className="h-4 w-4 shrink-0" />
  </button>;
}

export function AttachmentViewer({ media, onClose }: { media: TicketMedia | null; onClose: () => void }) {
  const { toast } = useToast();
  const [src, setSrc] = useState("");
  const [scale, setScale] = useState(1);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const transfers = useRef(new Set<AbortController>());
  const [transferring, setTransferring] = useState(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const translateRef = useRef({ x: 0, y: 0 });
  const [translation, setTranslation] = useState({ x: 0, y: 0 });

  useEffect(() => {
    if (!media) return;
    let active = true;
    setSrc("");
    setLoadError(null);
    setScale(1);
    setTranslation({ x: 0, y: 0 });
    translateRef.current = { x: 0, y: 0 };
    startRef.current = null;
    setTransferring(false);
    const controller = new AbortController();
    if (media.kind === "video") {
      setSrc(`/api/tickets/${encodeURIComponent(media.ticketId)}/messages/${encodeURIComponent(media.messageId)}/attachment`);
      return () => {
        active = false;
        controller.abort();
      };
    }
    fetch(`/api/tickets/${encodeURIComponent(media.ticketId)}/messages/${encodeURIComponent(media.messageId)}/attachment`, {
      method: media.kind === "file" ? "HEAD" : "GET",
      credentials: "include", cache: "no-store", signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("Could not load this attachment.");
      if (media.kind === "file") {
        if (active) setSrc(response.url || "verified-file");
        return;
      }
      const blob = await response.blob();
      if (active) setSrc(URL.createObjectURL(blob));
    }).catch((error: Error) => {
      if (active && error.name !== "AbortError") {
        setLoadError(error.message);
        toast({ title: "Attachment unavailable", description: error.message, variant: "destructive" });
      }
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [media, loadAttempt, toast]);

  useEffect(() => {
    if (!src) return;
    const video = videoRef.current;
    return () => {
      if (video) {
        video.pause();
        video.removeAttribute("src");
        video.load();
      }
      if (src.startsWith("blob:")) URL.revokeObjectURL(src);
    };
  }, [src]);

  const close = useCallback(() => {
    if (closingRef.current) return;
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.removeAttribute("src");
      videoRef.current.load();
    }
    closingRef.current = true;
    if (history.state?.ticketMediaViewer) history.back();
    else onCloseRef.current();
  }, []);

  useEffect(() => {
    if (!media) return;
    closingRef.current = false;
    const activeTransfers = transfers.current;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", keydown);
    const state = history.state && typeof history.state === "object" ? history.state : {};
    history.pushState({ ...state, ticketMediaViewer: true }, "");
    const pop = () => {
      closingRef.current = true;
      onCloseRef.current();
    };
    window.addEventListener("popstate", pop);
    return () => {
      document.removeEventListener("keydown", keydown);
      window.removeEventListener("popstate", pop);
      for (const controller of activeTransfers) controller.abort();
      activeTransfers.clear();
      if (!closingRef.current && history.state?.ticketMediaViewer) {
        // Remove our history entry on server-driven deletion too. Leaving a
        // duplicate ticket entry makes Back look broken on the next visit.
        history.back();
      }
    };
  }, [media, close]);

  if (!media) return null;
  const endpoint = `/api/tickets/${encodeURIComponent(media.ticketId)}/messages/${encodeURIComponent(media.messageId)}/attachment`;
  const download = async () => {
    const controller = new AbortController();
    transfers.current.add(controller);
    setTransferring(true);
    try {
      const response = await fetch(`${endpoint}?download=1`, { credentials: "include", cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Saving this file failed. Please try again.");
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = attachmentFilename(response.headers, media.name || "ticket-attachment");
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      toast({ title: "Download requested", description: "If your browser doesn't save it, try Share." });
    } catch (error) {
      if (controller.signal.aborted) return;
      toast({ title: "Couldn’t save attachment", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
    } finally { transfers.current.delete(controller); if (!controller.signal.aborted) setTransferring(false); }
  };
  const share = async () => {
    const controller = new AbortController();
    transfers.current.add(controller);
    setTransferring(true);
    try {
      if (!navigator.share) throw new Error("Sharing isn’t supported here. Use Save instead.");
      const response = await fetch(endpoint, { credentials: "include", cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Attachment unavailable.");
      const file = new File([await response.blob()], attachmentFilename(response.headers, media.name || "ticket-attachment"), { type: response.headers.get("content-type") || "application/octet-stream" });
      if (controller.signal.aborted) return;
      if (navigator.canShare && !navigator.canShare({ files: [file] })) throw new Error("File sharing isn’t supported here. Use Save instead.");
      await navigator.share({ files: [file], title: media.name });
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) return;
      toast({ title: "Couldn’t share attachment", description: error instanceof Error ? error.message : "Use Save instead.", variant: "destructive" });
    } finally { transfers.current.delete(controller); if (!controller.signal.aborted) setTransferring(false); }
  };
  return (
    <Dialog.Root open onOpenChange={open => { if (!open) close(); }}>
    <Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-[99] bg-black" />
    <Dialog.Content aria-describedby={undefined}
      onOpenAutoFocus={() => { returnFocusRef.current = document.activeElement as HTMLElement | null; }}
      onCloseAutoFocus={event => {
        event.preventDefault();
        const opener = returnFocusRef.current;
        if (opener?.isConnected) opener.focus({ preventScroll: true });
        else document.querySelector<HTMLElement>('[data-testid="input-message"]')?.focus({ preventScroll: true });
      }}
      onEscapeKeyDown={event => { event.preventDefault(); close(); }}
      className="fixed inset-0 z-[100] flex min-h-0 flex-col bg-[#111315] text-white outline-none" data-testid="ticket-media-viewer">
      <Dialog.Title className="sr-only">Attachment viewer</Dialog.Title>
      <header className="flex shrink-0 items-center gap-2 px-3 pt-[max(.75rem,env(safe-area-inset-top))] pb-3">
        <Button variant="ghost" size="icon" aria-label="Back to ticket" onClick={close} data-testid="button-close-ticket-viewer"><ArrowLeft /></Button>
        <span className="min-w-0 flex-1 truncate text-sm">{media.name}</span>
        <Button variant="ghost" size="icon" aria-label="Share attachment" disabled={transferring} onClick={share}><Share2 /></Button>
        <Button variant="ghost" size="icon" aria-label="Save attachment" disabled={transferring} onClick={download} data-testid="button-save-ticket-attachment"><ArrowDownToLine /></Button>
      </header>
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden" onPointerDown={(event) => {
        if (media.kind !== "image" || scale <= 1) return;
        startRef.current = { x: event.clientX - translateRef.current.x, y: event.clientY - translateRef.current.y };
        event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerMove={(event) => {
        if (!startRef.current) return;
        const next = { x: event.clientX - startRef.current.x, y: event.clientY - startRef.current.y };
        translateRef.current = next;
        setTranslation(next);
      }} onPointerUp={() => { startRef.current = null; }} onPointerCancel={() => { startRef.current = null; }}>
        {loadError ? <div className="max-w-sm px-6 text-center"><p className="mb-3 text-sm text-white/75">{loadError}</p><Button variant="secondary" onClick={() => setLoadAttempt((value) => value + 1)}>Try again</Button></div> : !src ? <div className="h-8 w-8 animate-pulse rounded-full bg-white/20" aria-label="Loading attachment" /> : media.kind === "video" ? (
          <video key={loadAttempt} ref={videoRef} src={src} controls playsInline onError={() => setLoadError("This video could not be loaded.")} className="max-h-full max-w-full" data-testid="video-ticket-viewer" />
        ) : media.kind === "image" ? (
          <img src={src} draggable={false} alt={media.name || "Ticket attachment"} onError={() => setLoadError("This image could not be loaded.")} onDoubleClick={() => {
            if (scale > 1) { setScale(1); setTranslation({ x: 0, y: 0 }); translateRef.current = { x: 0, y: 0 }; }
            else setScale(2);
          }} className="max-h-full max-w-full select-none object-contain touch-none" style={{ transform: `translate(${translation.x}px, ${translation.y}px) scale(${scale})`, cursor: scale > 1 ? "grab" : "zoom-in" }} />
        ) : (
          <div className="px-6 text-center"><p className="mb-4 text-sm text-white/70">Preview is not available for this file.</p><Button disabled={transferring} onClick={download}>Save attachment</Button></div>
        )}
      </div>
      {media.kind === "image" && <div className="flex justify-center gap-2 pb-[max(.75rem,env(safe-area-inset-bottom))]"><Button variant="ghost" size="icon" aria-label="Zoom out" onClick={() => {
        const next = Math.max(1, scale - .25);
        setScale(next);
        if (next === 1) { setTranslation({ x: 0, y: 0 }); translateRef.current = { x: 0, y: 0 }; }
      }}><ZoomOut /></Button><span className="self-center text-xs tabular-nums">{Math.round(scale * 100)}%</span><Button variant="ghost" size="icon" aria-label="Zoom in" onClick={() => setScale(Math.min(4, scale + .25))}><ZoomIn /></Button></div>}
      {media.kind !== "image" && <div className="pb-[max(.75rem,env(safe-area-inset-bottom))]" />}
    </Dialog.Content>
    </Dialog.Portal>
    </Dialog.Root>
  );
}
