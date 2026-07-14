import { Fragment, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  Home,
  Menu,
  MessageSquare,
  Newspaper,
  Search,
} from "lucide-react";
import "../_group.css";

/**
 * ServiceHub customer app shell — faithful copy of the real mobile chrome
 * (charcoal header with orange Dashboard chip + centered logo, and the
 * 5-tab charcoal bottom nav). Wrap dashboard mockups in this so every
 * variant is compared inside identical app chrome.
 */
export function AppChrome({ children }: { children: ReactNode }) {
  const tabs = [
    { label: "Services", icon: Activity },
    { label: "Tickets", icon: MessageSquare, badge: 2 },
    { label: "Alerts", icon: AlertTriangle },
    { label: "News", icon: Newspaper },
    { label: "More", icon: Menu, badge: 1 },
  ];

  return (
    <div className="dark h-screen w-full overflow-hidden font-sans antialiased">
      <div className="flex h-full flex-col bg-background text-foreground">
        <header className="relative flex min-h-[3rem] flex-shrink-0 items-center border-b border-sidebar-border bg-sidebar px-3 py-2.5 text-sidebar-foreground">
          <div className="z-10">
            <span className="tap-interactive flex items-center gap-1.5 rounded-lg bg-sidebar-primary px-2.5 py-1.5">
              <Home className="h-4 w-4 text-sidebar-primary-foreground" />
              <span className="text-xs font-semibold text-sidebar-primary-foreground">
                Dashboard
              </span>
            </span>
          </div>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <img
              src="/__mockup/images/cowboy-logo-dark.png"
              alt="CowboyMedia"
              className="block h-16 max-w-full object-contain"
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

        <main className="min-h-0 flex-1 overflow-auto p-3 pb-20">{children}</main>

        <nav className="flex-shrink-0 border-t border-sidebar-border bg-sidebar">
          <div className="flex h-14 items-center justify-around">
            {tabs.map((tab, index) => {
              const Icon = tab.icon;
              return (
                <Fragment key={tab.label}>
                  <button className="relative flex h-full flex-1 flex-col items-center justify-center gap-0.5 text-sidebar-foreground/60">
                    <span className="relative">
                      <Icon className="h-5 w-5" />
                      {tab.badge ? (
                        <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-sidebar-primary px-1 text-[10px] font-bold text-sidebar-primary-foreground">
                          {tab.badge}
                        </span>
                      ) : null}
                    </span>
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
