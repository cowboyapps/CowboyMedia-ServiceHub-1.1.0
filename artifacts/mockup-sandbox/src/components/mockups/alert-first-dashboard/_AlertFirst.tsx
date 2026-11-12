import { Activity, AlertTriangle, ArrowRight, Bell, Check, ChevronRight, Clock3, Gift, LifeBuoy, MessageSquare, Newspaper, RefreshCw, ShieldAlert, Ticket } from "lucide-react";
import { showPreviewDetail } from "./_fixtures";
import "./_AlertFirst.css";

export type DashboardExample = "incident" | "healthy" | "monitoring" | "resolved" | "loading" | "unavailable" | "stale" | "multiple" | "empty" | "long";

type ServiceItem = { name: string; status: "Operational" | "Affected" | "Monitoring" };
type DashboardContent = {
  mode: DashboardExample;
  label: string;
  title: string;
  incidentTitle?: string;
  services: ServiceItem[];
  updateTitle: string;
  update: string;
  updatedAt: string;
  supportSubject: string;
};

const incident: DashboardContent = {
  mode: "incident", label: "Active service issue",
  title: "CowboyPRIME on-demand titles are temporarily unavailable",
  incidentTitle: "Some on-demand titles are temporarily unavailable",
  services: [{ name: "CowboyPRIME", status: "Affected" }, { name: "CowboyONE", status: "Operational" }],
  updateTitle: "Latest provider update",
  update: "The provider is restoring titles to the on-demand library. Some programs may take a little longer to reappear.",
  updatedAt: "Updated 8:42 PM · 4 min ago",
  supportSubject: "Device setup · Reply received",
};
const healthy: DashboardContent = {
  mode: "healthy", label: "Service status",
  title: "Your services are running normally",
  services: [{ name: "CowboyPRIME", status: "Operational" }, { name: "CowboyONE", status: "Operational" }],
  updateTitle: "Recent service update",
  update: "CowboyPRIME's on-demand library has returned to normal after a provider-side interruption.",
  updatedAt: "Checked today at 8:42 PM",
  supportSubject: "Device setup · Reply received",
};
const samples: Record<DashboardExample, DashboardContent> = {
  incident,
  healthy,
  monitoring: { ...healthy, mode: "monitoring", title: "Services are back; we're keeping watch", services: [{ name: "CowboyPRIME", status: "Monitoring" }, { name: "CowboyONE", status: "Operational" }], updateTitle: "Monitoring in progress", update: "On-demand titles are available again. Our team is watching playback and library updates for any recurrence.", updatedAt: "Monitoring since 8:38 PM" },
  resolved: { ...healthy, mode: "resolved", title: "No active service issues", updateTitle: "Recently resolved · CowboyPRIME", update: "The provider has restored the affected on-demand titles. If a title is still missing, refresh your playlist and try again.", updatedAt: "Resolved today at 8:38 PM" },
  loading: { ...incident, mode: "loading", title: "Checking your service status", updateTitle: "Status is being refreshed", update: "We’re checking for the latest service information. This does not mean everything is working normally.", updatedAt: "Last confirmed update: 8:38 PM" },
  unavailable: { ...incident, mode: "unavailable", title: "Service status is temporarily unavailable", updateTitle: "We can’t confirm current status", update: "Please try again shortly or contact support if you’re having trouble. We won’t show an all-clear until status is confirmed.", updatedAt: "Last confirmed update: 8:27 PM" },
  stale: { ...healthy, mode: "stale", title: "Service status needs refreshing", updateTitle: "Last check is out of date", update: "The last confirmed status is no longer current. Check again before assuming your services are working normally.", updatedAt: "Last confirmed yesterday at 8:42 PM" },
  multiple: { ...incident, mode: "multiple", title: "CowboyPRIME playback is unavailable", incidentTitle: "CowboyPRIME playback is unavailable", services: [{ name: "CowboyPRIME", status: "Affected" }, { name: "CowboyONE", status: "Monitoring" }], update: "The provider is investigating a playback interruption. A separate CowboyONE maintenance incident is being monitored.", updatedAt: "Updated 8:42 PM · 4 min ago" },
  empty: { ...healthy, mode: "empty", title: "Choose services to follow", services: [], updateTitle: "No service updates to show", update: "Follow the services you use to see current health and important changes here.", updatedAt: "No services selected" },
  long: { ...incident, mode: "long", title: "CowboyPRIME on-demand titles are temporarily unavailable for some customers using older receiver software", services: [{ name: "CowboyPRIME", status: "Affected" }, { name: "CowboyONE", status: "Operational" }, { name: "CowboyGO mobile streaming", status: "Operational" }, { name: "CowboyTV Everywhere", status: "Operational" }], update: "The provider has confirmed that older receiver software is taking longer to sync with the restored on-demand catalog. Titles will return as each receiver completes its refresh. No action is required; keep your device connected.", updatedAt: "Updated today at 8:42 PM" },
};

function detail(title: string, body: string) { showPreviewDetail(title, body); }
function statusClass(status: ServiceItem["status"]) { return status === "Operational" ? "ok" : status === "Affected" ? "warn" : "neutral"; }

export function AlertFirst({ example }: { example: DashboardExample }) {
  const data = samples[example];
  const unavailable = example === "unavailable";
  const loading = example === "loading";
  const uncertain = unavailable || loading || example === "stale";
  const active = example === "incident" || example === "long" || example === "multiple";
  return <div className="af-page">
    <div className="af-greeting">
      <div><div className="af-kicker">Your ServiceHub</div><h1>Good evening, Sam</h1><p>A quick look at your services</p></div>
      <span className="af-sample">SAMPLE DATA</span>
    </div>

    {loading ? <section className="af-incident af-uncertain" aria-label="Loading service status">
      <div className="af-incident-head"><span className="af-state-icon"><RefreshCw size={16} /></span><span className="af-state-title">Checking status</span></div>
      <div style={{ padding: "0 13px 12px", display: "grid", gap: 8 }}><div className="af-skeleton" /><div className="af-skeleton" style={{ width: "72%" }} /><div className="af-skeleton" style={{ width: "88%" }} /></div>
      <div className="af-content">Status information is loading. No all-clear is shown while we check.</div>
    </section> : <section className={`af-incident ${uncertain || example === "empty" ? "af-uncertain" : example === "multiple" ? "af-critical" : example === "healthy" || example === "resolved" ? "af-calm" : example === "monitoring" ? "af-watch" : ""}`} aria-label={active ? "Active service incident" : "Service health"}>
      <div className="af-incident-head">
        <span className="af-state-icon">{active || uncertain ? <AlertTriangle size={16} /> : example === "monitoring" ? <Activity size={16} /> : example === "empty" ? <Activity size={16} /> : <Check size={17} />}</span>
        <span className="af-state-title">{unavailable ? "Status unavailable" : example === "stale" ? "Status out of date" : example === "multiple" ? "Highest priority · Playback outage" : example === "monitoring" ? "Monitoring after a fix" : active ? "Active service issue" : example === "resolved" ? "Recently resolved" : example === "empty" ? "Services not selected" : "Service health"}</span>
      </div>
      <h2>{active ? example === "long" ? data.title : data.incidentTitle : data.title}</h2>
      <p className="af-subtitle">{example === "multiple" ? "2 active incidents · Most urgent shown first" : active ? "CowboyPRIME on-demand titles · identified 15 minutes ago" : uncertain ? "Current status hasn’t been confirmed." : example === "monitoring" ? "A fix is in place; our team is watching for recurrence." : example === "resolved" ? "There are no active service issues." : example === "empty" ? "Pick the services you use to personalize this view." : data.updatedAt}</p>
      {active && <div className="af-affected">
        <span className="af-affected-label">Affected service</span>
        {(data.services.filter(service => service.status === "Affected")).slice(0, 3).map(service => <span className="af-chip" key={service.name}>{service.name}</span>)}
        {data.services.filter(service => service.status === "Affected").length > 3 && <span className="af-chip">+{data.services.filter(service => service.status === "Affected").length - 3} more</span>}
      </div>}
      {active && <div className="af-update">
        <div className="af-update-top"><strong>{data.updateTitle}</strong><time>{data.updatedAt}</time></div>
        <p>{data.update}</p>
      </div>}
      <div className="af-actions">
        <button className="af-button" onClick={() => detail(active ? "CowboyPRIME service alert" : data.updateTitle, `${data.title}\n\nServices: ${data.services.map(service => `${service.name} — ${uncertain ? "Unknown (not currently verified)" : service.status}`).join(", ") || "No services selected"}.\n\n${data.update}\n\n${data.updatedAt}. This is example information for the ServiceHub preview.`)}>
          {active ? "View alert" : uncertain ? "View status details" : "View service details"} <ArrowRight size={15} />
        </button>
        {active && <button className="af-button secondary" onClick={() => detail("Get help with this alert", "If your on-demand titles are still missing, refresh your CowboyPRIME playlist. You can contact support and include the affected title and device model.")}>Get help</button>}
      </div>
    </section>}

    {example === "multiple" && <button className="af-row" onClick={() => detail("All active incidents (2)", "1. CowboyPRIME playback outage · Investigating · Highest priority\nSome customers cannot start playback. The provider is investigating.\n\n2. CowboyONE scheduled maintenance · Monitoring\nThe maintenance fix is in place. Our team is checking for recurrence.\n\nUpdated 8:42 PM · Sample data.")}><span className="af-row-title">View all 2 active incidents<span className="af-row-meta">Also: CowboyONE maintenance · Monitoring</span></span><ChevronRight size={16} /></button>}
    {uncertain && <div className="af-state" role="status">
        <ShieldAlert size={17} color="hsl(var(--status-away, 38 92% 50%))" />
      <div><strong>{loading ? "Status check in progress" : "We can’t verify service health right now"}</strong><p>{data.updatedAt}. Please check again later; this is not an all-clear.</p></div>
    </div>}

    <section className="af-card">
      <div className="af-section-head"><h2 className="af-section-heading"><Activity size={15} />Your services</h2><button className="af-small-link" onClick={() => detail("All followed services", data.services.length ? data.services.map(s => `${s.name}: ${uncertain ? "Unknown (not currently verified)" : s.status}`).join("\n") : "You are not following any services yet. Choose services in Settings to see their health here.")}>See all</button></div>
      {data.services.length ? data.services.map(service => {
        const rowStatus = uncertain ? "Unknown" : service.status;
        const rowClass = uncertain ? "neutral" : statusClass(service.status);
        return <button className="af-row" key={service.name} onClick={() => detail(service.name, `${rowStatus}. ${uncertain ? "Current health could not be confirmed. See the status notice above." : service.name === "CowboyPRIME" && active ? "Some on-demand titles are temporarily unavailable. The provider is restoring the library." : "Service status details, alerts and history would appear here in ServiceHub."}`)}>
        <span className={`af-dot ${uncertain ? "unknown" : service.status === "Monitoring" ? "watch" : service.status === "Affected" ? "warn" : ""}`} /><span className="af-row-title">{service.name}</span><span className={`af-pill ${rowClass}`}>{rowStatus}</span><ChevronRight size={15} color="hsl(var(--muted-foreground))" />
        </button>;
      }) : <div className="af-content">No services selected yet. <button className="af-small-link" onClick={() => detail("Follow services", "Choose the services you use in Settings. Their status and updates will appear here.")}>Choose services</button></div>}
    </section>

    <section className="af-card">
      <div className="af-section-head"><h2 className="af-section-heading"><LifeBuoy size={15} />Support</h2><button className="af-small-link" onClick={() => detail("Support", "Browse help topics, review your support requests or open a new ticket. This preview does not send a real request.")}>Get help</button></div>
      <button className="af-row" onClick={() => detail("Support request: Device setup", "Ticket #SH-2048 · Open\n\nOur support team replied: To finish setup, connect your receiver to the internet, then open Settings → Network. Reply in the ticket if you need more help.")}>
        <span className="af-support-icon"><MessageSquare size={16} /></span><span className="af-support-copy">{data.supportSubject}<small>Ticket SH-2048 · Updated 18 min ago</small></span><span className="af-pill neutral">Open</span><ChevronRight size={15} color="hsl(var(--muted-foreground))" />
      </button>
      <div className="af-support"><span className="af-support-icon"><Ticket size={16} /></span><span className="af-support-copy">Need a hand?<small>Browse help or start a support request.</small></span><button className="af-small-link" onClick={() => detail("Contact support", "Choose a help topic or open a ticket with our support team. In this preview, no ticket is submitted.")}>Contact</button></div>
    </section>

    <section className="af-card">
      <div className="af-section-head"><h2 className="af-section-heading"><Bell size={15} />Recent service updates</h2><button className="af-small-link" onClick={() => detail("Recent service updates", `${data.updateTitle}\n${data.update}\n\n${data.updatedAt}\n\nService updates are provider or team posts, separate from active incident alerts.`)}>View all</button></div>
      <button className="af-row" onClick={() => detail(data.updateTitle, `${data.update}\n\n${data.updatedAt}\n\nThis is a recent service update, distinct from the active alert above.`)}>
        <span className="af-dot info" /><span className="af-row-title">{data.updateTitle}<span className="af-row-meta">{active ? "CowboyPRIME · Provider update · 4 min ago" : "CowboyPRIME · Service update · Today"}</span><span className="af-update-excerpt">{data.update}</span></span><ChevronRight size={15} color="hsl(var(--muted-foreground))" />
      </button>
    </section>

    <section className="af-card">
      <div className="af-section-head"><h2 className="af-section-heading"><Newspaper size={15} />News</h2><button className="af-small-link" onClick={() => detail("ServiceHub news", "Read company news and helpful announcements. These stories are informational and do not indicate service health.")}>View all</button></div>
      <button className="af-row" onClick={() => detail("A simpler way to get help", "Your ServiceHub home brings service health, customer support and helpful updates together. Find downloads and setup guides whenever you need them.")}>
        <span className="af-row-title">A simpler way to get help<span className="af-row-meta">ServiceHub guide · Yesterday</span></span><ChevronRight size={15} color="hsl(var(--muted-foreground))" />
      </button>
    </section>

    <section className="af-card">
      <div className="af-section-head"><h2 className="af-section-heading"><Gift size={15} />Customer offers</h2><button className="af-small-link" onClick={() => detail("Customer offers", "See available offers for your CowboyMedia services. Offer eligibility and terms are shown in the live app.")}>See offers</button></div>
      <button className="af-row" onClick={() => detail("A thank-you offer", "A sample customer offer: save on an eligible add-on this month. See offer terms and availability in ServiceHub.")}>
        <span className="af-row-title">A thank-you offer<span className="af-row-meta">For CowboyMedia customers · Terms apply</span></span><ChevronRight size={15} color="hsl(var(--muted-foreground))" />
      </button>
    </section>
    <div className="af-footer"><Clock3 size={10} style={{ verticalAlign: "-1px", marginRight: 4 }} />{data.updatedAt} · Sample data only</div>
  </div>;
}
