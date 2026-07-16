import { Fragment } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronRight,
  Gift,
  Home,
  Menu,
  MessageSquare,
  Newspaper,
  Search,
  X,
} from "lucide-react";
import "../_group.css";

export function TopBanner() {
  const tabs = [
    { label: "Services", icon: Activity },
    { label: "Tickets", icon: MessageSquare },
    { label: "Alerts", icon: AlertTriangle },
    { label: "News", icon: Newspaper },
    { label: "More", icon: Menu },
  ];

  return (
    <div className="dark h-screen w-full overflow-hidden font-sans antialiased">
      <div className="flex h-full flex-col bg-background text-foreground">
        <header className="relative flex min-h-[3rem] flex-shrink-0 items-center border-b border-sidebar-border bg-sidebar px-3 py-2.5 text-sidebar-foreground">
          <div className="z-10">
            <span className="flex items-center gap-1.5 rounded-lg bg-sidebar-primary px-2.5 py-1.5">
              <Home className="h-4 w-4 text-sidebar-primary-foreground" />
              <span className="text-xs font-semibold text-sidebar-primary-foreground">
                Dashboard
              </span>
            </span>
          </div>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <img
              src="/__mockup/images/new-logo.png"
              alt="CowboyMedia ServiceHub"
              className="block h-16 max-w-[55%] object-contain"
            />
          </div>
          <div className="z-10 ml-auto flex items-center gap-1">
            <button className="flex h-9 items-center gap-2 rounded-md px-2 text-sidebar-foreground/70">
              <Search className="h-4 w-4" />
            </button>
            <button className="relative flex h-9 items-center rounded-md px-2 text-sidebar-foreground/70">
              <Bell className="h-4 w-4" />
              <span className="absolute right-0.5 top-1 h-2 w-2 rounded-full bg-sidebar-primary" />
            </button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-auto p-4 pb-20">
          <h1 className="text-3xl font-bold">Welcome, System Admin</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Here's an overview of your services and recent activity
          </p>

          <div className="mt-5 rounded-xl border border-green-700/50 bg-green-950/40 p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-green-900/60">
                <CheckCircle2 className="h-5 w-5 text-green-400" />
              </span>
              <div className="flex-1">
                <p className="font-semibold text-green-400">All services are running smoothly</p>
                <p className="mt-0.5 text-xs text-green-200/70">
                  Every service you're subscribed to is operational. 0 active alerts · tap …
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-green-400" />
            </div>
          </div>

          <div className="mt-3 flex items-center gap-3 rounded-xl border-l-4 border-blue-500 bg-card p-4">
            <Gift className="h-5 w-5 text-muted-foreground" />
            <p className="flex-1 text-sm">
              <span className="font-semibold">You have a new promotion available!</span> Tap to see the details.
            </p>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
            <X className="h-4 w-4 text-muted-foreground" />
          </div>

          <div className="mt-4 rounded-xl border border-card-border bg-card p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-900/40">
                <CheckCircle2 className="h-5 w-5 text-green-400" />
              </span>
              <p className="font-semibold">Your services</p>
            </div>
            <div className="mt-3 divide-y divide-border">
              {["Email Service", "CDN Network"].map((s) => (
                <div key={s} className="flex items-center gap-2 py-3">
                  <span className="h-2 w-2 rounded-full bg-green-500" />
                  <span className="flex-1 text-sm font-medium">{s}</span>
                  <span className="rounded-full bg-green-950/60 px-2 py-0.5 text-xs text-green-400">
                    Operational
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              ))}
            </div>
          </div>
        </main>

        <nav className="flex-shrink-0 border-t border-sidebar-border bg-sidebar">
          <div className="flex h-14 items-center justify-around">
            {tabs.map((tab, index) => {
              const Icon = tab.icon;
              return (
                <Fragment key={tab.label}>
                  <button className="flex h-full flex-1 flex-col items-center justify-center gap-0.5 text-sidebar-foreground/60">
                    <Icon className="h-5 w-5" />
                    <span className="text-[10px] font-medium">{tab.label}</span>
                  </button>
                  {index < tabs.length - 1 && (
                    <div className="h-[60%] w-px flex-shrink-0 self-center bg-sidebar-foreground/10" />
                  )}
                </Fragment>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
