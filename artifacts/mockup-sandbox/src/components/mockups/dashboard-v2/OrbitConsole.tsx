import { useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Gift,
  LifeBuoy,
  MessageSquare,
  Newspaper,
  ShieldCheck,
  Wrench,
  X,
} from "lucide-react";
import { activeAlerts, news, services, tickets, userName } from "./_data";
import "./orbit-console.css";

type PreviewState = "incident" | "monitoring" | "healthy";

const serviceUpdates = [
  { id: "u1", title: "Backup retention options are now available", service: "Backup Vault", time: "Today, 9:20 AM" },
  { id: "u2", title: "Planned network maintenance completed", service: "DNS & Domains", time: "Yesterday, 4:45 PM" },
];

const severityCopy: Record<string, string> = {
  critical: "Major outage",
  warning: "Service disruption",
  info: "Scheduled maintenance",
};

const pulseStates: Record<string, number[]> = {
  "Cowboy Cloud Hosting": Array(24).fill(1),
  "Email Platform": [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  "DNS & Domains": Array(24).fill(1),
  "Backup Vault": Array(24).fill(1),
  "VPN Gateway": [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
  "Media Streaming": Array(24).fill(1),
};

export function OrbitConsole() {
  const [previewState, setPreviewState] = useState<PreviewState>("incident");
  const [expandedAlert, setExpandedAlert] = useState<string | null>(null);
  const [showAllAlerts, setShowAllAlerts] = useState(false);
  const [expandedTicket, setExpandedTicket] = useState<string | null>(null);
  const [expandedUpdate, setExpandedUpdate] = useState<string | null>(null);
  const [showAllServices, setShowAllServices] = useState(false);
  const [notice, setNotice] = useState("");

  const shownAlerts = previewState === "healthy"
    ? []
    : previewState === "monitoring"
      ? [activeAlerts[0]]
      : activeAlerts;

  const getServiceStatus = (name: string, status: string) => {
    if (previewState === "healthy" || previewState === "monitoring") return "operational";
    return status;
  };

  const serviceCount = services.filter((service) => service.subscribed).length;
  const healthTitle = previewState === "incident" ? "Service disruption" : previewState === "monitoring" ? "Monitoring" : "All services operational";
  const healthDescription = previewState === "incident"
    ? "An active issue is affecting a subscribed service."
    : previewState === "monitoring"
      ? "A recent fix is in place; teams are watching for recurrence."
      : "No active service incidents in this sample.";

  const selectState = (state: PreviewState) => {
    setPreviewState(state);
    setExpandedAlert(null);
    setShowAllAlerts(false);
    setNotice(`Preview scenario changed to ${state}.`);
  };

  return (
    <main className="oc-shell">
      <div className="oc-page">
        <header className="oc-header">
          <div className="oc-brand" aria-label="ServiceHub by CowboyMedia">
            <span className="oc-brand-mark">SH</span>
            <span className="oc-brand-name">ServiceHub</span>
            <span className="oc-brand-by">by CowboyMedia</span>
          </div>
          <div className="oc-preview-label"><span /> PREVIEW DATA</div>
        </header>

        <section className="oc-intro">
          <div>
            <p className="oc-eyebrow">CUSTOMER SERVICE OVERVIEW <span>·</span> SAMPLE ACCOUNT</p>
            <h1>Good morning, {userName}.</h1>
          </div>
          <div className="oc-scenario" aria-label="Switch sample dashboard state">
            <span>Sample state</span>
            {(["incident", "monitoring", "healthy"] as PreviewState[]).map((state) => (
              <button
                key={state}
                className={previewState === state ? "selected" : ""}
                onClick={() => selectState(state)}
                aria-pressed={previewState === state}
              >
                {state === "healthy" ? "Healthy" : state === "incident" ? "Incident" : "Monitoring"}
              </button>
            ))}
          </div>
        </section>

        <section className={`oc-status-hero ${previewState}`} aria-live="polite">
          <div className="oc-status-symbol">
            {previewState === "healthy" ? <ShieldCheck size={21} /> : previewState === "monitoring" ? <Activity size={21} /> : <CircleAlert size={21} />}
          </div>
          <div className="oc-status-copy">
            <div className="oc-status-title-row">
              <span className="oc-overline">CURRENT STATUS</span>
              <span className={`oc-state-pill ${previewState}`}>{healthTitle}</span>
            </div>
            <h2>{healthDescription}</h2>
            {previewState === "incident" && (
              <p>Delayed outbound email delivery <span>·</span> Email Platform <span>·</span> Started 42 min ago</p>
            )}
            {previewState === "monitoring" && (
              <p>Delayed outbound email delivery <span>·</span> fix in place, being monitored</p>
            )}
          </div>
          <div className="oc-hero-count">
            <b>{shownAlerts.length}</b>
            <span>{shownAlerts.length === 1 ? "active alert" : "active alerts"}</span>
          </div>
        </section>

        <div className="oc-layout">
          <div className="oc-main-column">
            <section className="oc-alert-section" aria-labelledby="alerts-heading">
              <div className="oc-section-head">
                <div>
                  <p className="oc-kicker">01 / NEEDS ATTENTION</p>
                  <h2 id="alerts-heading">Current alerts <span>{shownAlerts.length}</span></h2>
                </div>
                <span className="oc-section-context">Status and latest update</span>
              </div>

              {shownAlerts.length > 0 ? (
                <div id="mobile-alert-list" className={`oc-alert-list${showAllAlerts ? " show-all-mobile" : ""}`}>
                  {shownAlerts.map((alert, index) => {
                    const isMonitoring = previewState === "monitoring";
                    const isExpanded = expandedAlert === alert.id;
                    const severity = isMonitoring ? "monitoring" : alert.severity;
                    return (
                      <article className={`oc-alert-card ${severity}`} key={alert.id}>
                        <div className="oc-alert-leading">
                          {isMonitoring ? <Activity size={18} /> : alert.severity === "info" ? <Wrench size={18} /> : <CircleAlert size={18} />}
                        </div>
                        <div className="oc-alert-content">
                          <div className="oc-alert-meta">
                            <span className={`oc-severity ${severity}`}>{isMonitoring ? "Monitoring" : severityCopy[alert.severity]}</span>
                            <span className="oc-alert-time"><Clock3 size={12} /> Started {alert.startedAgo}</span>
                          </div>
                          <h3>{alert.title}</h3>
                          <p className="oc-affected"><span>AFFECTED</span>{alert.serviceNames.join(", ")}</p>
                          <p className="oc-latest"><b>Latest update</b>{isMonitoring ? "A fix is in place. The team is monitoring service recovery." : alert.latestUpdate}</p>
                          {isExpanded && (
                            <div className="oc-alert-detail">
                              <b>Preview alert details</b>
                              <span>
                                {isMonitoring
                                  ? "Service is operational after a recent change. We are watching delivery metrics for stability."
                                  : `${alert.title} began ${alert.startedAgo}. ${alert.latestUpdate}`}
                              </span>
                              <small>Sample content · no live status connection</small>
                            </div>
                          )}
                        </div>
                        <div className="oc-alert-action">
                          <button onClick={() => setExpandedAlert(isExpanded ? null : alert.id)} aria-expanded={isExpanded}>
                            {isExpanded ? "Close details" : "View alert"} {isExpanded ? <X size={14} /> : <ArrowUpRight size={14} />}
                          </button>
                        </div>
                        {index === 0 && <span className="oc-alert-priority" aria-hidden="true" />}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="oc-empty-state">
                  <span className="oc-empty-icon"><Check size={17} /></span>
                  <div><b>No active alerts in this sample</b><span>This is a preview state, not a live service check.</span></div>
                </div>
              )}
              {shownAlerts.length > 1 && (
                <button
                  className="oc-mobile-view-all"
                  type="button"
                  onClick={() => setShowAllAlerts(!showAllAlerts)}
                  aria-expanded={showAllAlerts}
                  aria-controls="mobile-alert-list"
                >
                  {showAllAlerts ? "Show fewer alerts" : `View all ${shownAlerts.length} alerts`}
                  <ChevronDown size={16} className={showAllAlerts ? "turned" : ""} />
                </button>
              )}
            </section>

            <section className="oc-services" aria-labelledby="services-heading">
              <div className="oc-section-head">
                <div>
                  <p className="oc-kicker">02 / SERVICE HEALTH</p>
                  <h2 id="services-heading">Your services <span>{serviceCount}</span></h2>
                </div>
                <button className="oc-text-button" onClick={() => setShowAllServices(!showAllServices)} aria-expanded={showAllServices}>
                  {showAllServices ? "Show subscribed" : "View all services"} <ChevronDown size={14} className={showAllServices ? "turned" : ""} />
                </button>
              </div>
              <div className="oc-service-table">
                {(showAllServices ? services : services.filter((service) => service.subscribed)).map((service) => {
                  const status = getServiceStatus(service.name, service.status);
                  const pulse = pulseStates[service.name] ?? Array(24).fill(1);
                  return (
                    <div className="oc-service-row" key={service.id}>
                      <span className={`oc-service-dot ${status}`} />
                      <div className="oc-service-name">
                        <b>{service.name}</b>
                        {!service.subscribed && <small>Not followed</small>}
                      </div>
                      <div className="oc-spark" aria-label="Sample service history">
                        {pulse.map((up, i) => <i key={i} className={status !== "operational" && !up ? "down" : ""} />)}
                      </div>
                      <span className={`oc-service-state ${status}`}>{status === "operational" ? "Operational" : status === "degraded" ? "Degraded" : status === "outage" ? "Outage" : "Maintenance"}</span>
                    </div>
                  );
                })}
              </div>
              <div className="oc-service-foot"><span><i className="normal" /> Operational</span><span><i className="attention" /> Attention needed</span><span>Sample service data</span></div>
            </section>
          </div>

          <aside className="oc-side-column">
            <section className="oc-support-panel">
              <div className="oc-section-head">
                <div><p className="oc-kicker">03 / CUSTOMER CARE</p><h2>Support tickets <span>2 open</span></h2></div>
                <span className="oc-heading-icon"><LifeBuoy size={17} /></span>
              </div>
              <div className="oc-ticket-list">
                {tickets.filter((ticket) => ticket.status !== "resolved").map((ticket) => {
                  const isExpanded = expandedTicket === ticket.id;
                  return (
                    <div className={`oc-ticket ${isExpanded ? "expanded" : ""}`} key={ticket.id}>
                      <button className="oc-ticket-button" onClick={() => setExpandedTicket(isExpanded ? null : ticket.id)} aria-expanded={isExpanded}>
                        <span className={`oc-ticket-message ${ticket.lastMessageFrom === "support" ? "answered" : ""}`}><MessageSquare size={15} /></span>
                        <span className="oc-ticket-copy"><b>{ticket.subject}</b><small>{ticket.lastActivity} <i>·</i> {ticket.lastMessageFrom === "support" ? "Support replied" : "Awaiting support"}</small></span>
                        <span className={`oc-ticket-status ${ticket.status}`}>{ticket.status === "waiting" ? "Waiting" : "Open"}</span>
                        <ChevronRight size={15} className="oc-ticket-chevron" />
                      </button>
                      {isExpanded && <div className="oc-ticket-detail">Ticket preview <b>#{ticket.id.toUpperCase()}</b> · {ticket.lastMessageFrom === "support" ? "A support reply is ready to review." : "The support team will follow up here."}</div>}
                    </div>
                  );
                })}
              </div>
              <button className="oc-panel-link" onClick={() => setNotice("Ticket list preview selected.")}>View support inbox <ArrowUpRight size={14} /></button>
            </section>

            <section className="oc-updates-panel">
              <div className="oc-section-head">
                <div><p className="oc-kicker">04 / RECENT ACTIVITY</p><h2>Service updates</h2></div>
                <span className="oc-heading-icon amber"><Bell size={17} /></span>
              </div>
              <div className="oc-update-list">
                {serviceUpdates.map((update) => {
                  const isExpanded = expandedUpdate === update.id;
                  return (
                    <button className="oc-update-row" key={update.id} onClick={() => setExpandedUpdate(isExpanded ? null : update.id)} aria-expanded={isExpanded}>
                      <span className="oc-update-dot" />
                      <span className="oc-update-copy"><b>{update.title}</b><small>{update.service} <i>·</i> {update.time}</small>{isExpanded && <em>Preview update details for {update.service}. This sample is for layout review only.</em>}</span>
                      <ChevronRight size={15} className={isExpanded ? "turned" : ""} />
                    </button>
                  );
                })}
              </div>
              <button className="oc-panel-link" onClick={() => setNotice("Service updates preview selected.")}>View all updates <ArrowUpRight size={14} /></button>
            </section>
          </aside>
        </div>

        <section className="oc-latest-section">
          <div className="oc-section-head">
            <div><p className="oc-kicker">05 / MORE FROM COWBOYMEDIA</p><h2>News &amp; offers</h2></div>
            <span className="oc-section-context">Updates and promotions</span>
          </div>
          <div className="oc-bottom-grid">
            <div className="oc-news-panel">
              <div className="oc-subsection-title"><Newspaper size={15} /><b>Latest news</b></div>
              {news.slice(0, 2).map((story) => (
                <button className="oc-news-row" key={story.id} onClick={() => setNotice(`News preview: ${story.title}`)}>
                  <span className="oc-news-date">{story.date}</span><span><b>{story.title}</b><small>{story.excerpt}</small></span><ChevronRight size={14} />
                </button>
              ))}
            </div>
            <div className="oc-promo-panel">
              <div className="oc-promo-icon"><Gift size={17} /></div>
              <div><p>ACCOUNT OFFER</p><b>A promotion is available</b><span>Review the offer included with your account.</span></div>
              <button onClick={() => setNotice("Promotion preview selected.")} aria-label="View promotion"><ArrowUpRight size={16} /></button>
            </div>
          </div>
        </section>

        <footer className="oc-footer">
          <span>ServiceHub <i>·</i> CowboyMedia customer support</span>
          <span>Preview content only <i>·</i> Not connected to live services</span>
        </footer>
        {notice && <div className="oc-toast" role="status"><Check size={14} />{notice}<button onClick={() => setNotice("")} aria-label="Dismiss message"><X size={14} /></button></div>}
      </div>
    </main>
  );
}
