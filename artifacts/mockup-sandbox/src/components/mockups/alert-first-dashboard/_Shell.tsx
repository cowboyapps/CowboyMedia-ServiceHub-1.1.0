import { useEffect, useRef, useState, type ReactNode } from "react";
import { Activity, AlertTriangle, Bell, Home, Menu, MessageSquare, Newspaper, Search, X } from "lucide-react";
import { showPreviewDetail } from "./_fixtures";
import "./_group.css";

/** Static extraction of the app's phone header and customer navigation. */
export function PreviewShell({ children, label }: { children: ReactNode; label: string }) {
  const [detail, setDetail] = useState<{ title: string; body: string } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const listener = (event: Event) => setDetail((event as CustomEvent).detail);
    window.addEventListener("dashboard-preview-detail", listener);
    return () => window.removeEventListener("dashboard-preview-detail", listener);
  }, []);
  useEffect(() => { if (detail && !dialog.current?.open) dialog.current?.showModal(); }, [detail]);
  const tabs = [
    { title: "Services", icon: Activity }, { title: "Tickets", icon: MessageSquare },
    { title: "Alerts", icon: AlertTriangle }, { title: "News", icon: Newspaper }, { title: "More", icon: Menu },
  ];
  return <div className="dark sh-preview">
    <div className="sticky top-0 z-30">
      <div className="border-b border-border bg-background px-3 py-1.5 text-center text-[10px] tracking-wide text-muted-foreground">{label}</div>
      <header className="relative flex min-h-[3rem] items-center border-b border-border bg-muted px-3 py-2.5">
        <button aria-label="Dashboard" className="z-10 flex items-center gap-1.5 rounded-lg border border-border bg-background/60 px-2.5 py-1.5" onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" })}><Home className="h-4 w-4 text-primary" /><span className="text-xs font-semibold max-[360px]:hidden">Dashboard</span></button>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <img src="/__mockup/images/servicehub-preview-logo.png" className="h-9 max-w-[42%] object-contain" alt="CowboyMedia ServiceHub" />
        </div>
        <div className="z-10 ml-auto flex gap-1">
          <button aria-label="Search" className="flex h-9 w-9 items-center justify-center text-muted-foreground" onClick={() => showPreviewDetail("Search", "Search would help you find services, help articles and downloads in the live app.")}><Search className="h-4 w-4" /></button>
          <button aria-label="Notifications" className="flex h-9 w-9 items-center justify-center text-muted-foreground" onClick={() => showPreviewDetail("Notifications", "Example: your support ticket has a new reply.")}><Bell className="h-[18px] w-[18px]" /></button>
        </div>
      </header>
    </div>
    <main className="p-3 pb-24">{children}</main>
    <nav aria-label="Main navigation" className="fixed bottom-0 inset-x-0 z-40 flex justify-around border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur">
      {tabs.map(({ title, icon: Icon }) => <button key={title} className="flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 text-muted-foreground" onClick={() => showPreviewDetail(title, `This opens ${title.toLowerCase()} in the live app. Navigation remains at the bottom on phones.`)}><Icon className="h-5 w-5" /><span className="text-[10px]">{title}</span></button>)}
    </nav>
    <dialog ref={dialog} aria-label={detail?.title ?? "Preview details"} onClose={() => setDetail(null)} className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-md overflow-auto rounded-xl border border-border bg-card p-5 text-card-foreground backdrop:bg-black/70">
      <div className="mb-3 flex items-start justify-between gap-3"><h2 className="font-semibold">{detail?.title}</h2><button aria-label="Close details" className="p-1" onClick={() => dialog.current?.close()}><X className="h-5 w-5" /></button></div>
      <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{detail?.body}</p>
      <p className="mt-4 text-[10px] text-muted-foreground">Sample data · no changes to the live app</p>
    </dialog>
  </div>;
}
