import React from "react";
import { CheckCircle2, AlertTriangle, ArrowRight, Ticket, Settings, Bell, ChevronRight, Activity } from "lucide-react";
import "../_group.css";
import "./Depth.css";

const services = [
  { name: "Game Servers", status: "Operational", color: "green" },
  { name: "Web Hosting", status: "Operational", color: "green" },
  { name: "VoIP", status: "Degraded", color: "yellow" },
  { name: "Databases", status: "Operational", color: "green" },
];

export default function Depth() {
  return (
    <div className="dark depth-container flex justify-center w-full">
      {/* Mobile container constraint */}
      <div className="w-full max-w-[390px] h-[844px] relative overflow-hidden flex flex-col pt-12 pb-6 px-4 gap-6 scroll-smooth overflow-y-auto">
        
        {/* Header */}
        <header className="flex justify-between items-center z-10">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center shadow-[0_0_15px_rgba(249,115,22,0.3)] border border-orange-300/30">
              <Activity className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold text-lg tracking-tight">CowboyMedia</span>
          </div>
          <div className="flex gap-3">
            <button className="w-10 h-10 rounded-full depth-card flex items-center justify-center text-gray-400 hover:text-white transition-colors">
              <Bell className="w-5 h-5" />
            </button>
            <button className="w-10 h-10 rounded-full depth-card flex items-center justify-center text-gray-400 hover:text-white transition-colors">
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Status Hero */}
        <section className="mt-2">
          <div className="depth-card depth-card-tint-yellow p-6 relative overflow-hidden">
            <div className="absolute -top-10 -right-10 w-32 h-32 bg-yellow-500/10 blur-3xl rounded-full"></div>
            
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <div className="relative flex items-center justify-center w-5 h-5">
                  <div className="absolute inset-0 rounded-full animate-status-glow status-yellow-glow blur-sm"></div>
                  <div className="w-3 h-3 rounded-full bg-yellow-400 relative z-10 border border-yellow-200"></div>
                </div>
                <h1 className="text-xl font-medium tracking-tight">Partial Outage</h1>
              </div>
              <p className="text-sm text-gray-400 leading-relaxed">
                We are currently experiencing degraded performance across our VoIP infrastructure. Engineering is investigating.
              </p>
            </div>
          </div>
        </section>

        {/* Services List */}
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider ml-1">System Status</h2>
          <div className="flex flex-col gap-2">
            {services.map((service) => (
              <div key={service.name} className={`depth-card p-4 flex items-center justify-between group ${service.color === 'yellow' ? 'depth-card-tint-yellow' : 'depth-card-tint-green'}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${service.color === 'yellow' ? 'status-yellow-glow' : 'status-green-glow'}`}></div>
                  <span className="font-medium text-[15px]">{service.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-sm ${service.color === 'yellow' ? 'text-yellow-400' : 'text-gray-400'}`}>
                    {service.status}
                  </span>
                  <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors" />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Tickets Section */}
        <section className="flex flex-col gap-3 mt-2">
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider ml-1">Your Tickets</h2>
          <div className="depth-card p-6 flex flex-col items-center justify-center gap-4 text-center">
            <div className="w-12 h-12 rounded-full bg-gray-800/50 border border-gray-700/50 flex items-center justify-center mb-1">
              <Ticket className="w-5 h-5 text-gray-500" />
            </div>
            <div>
              <h3 className="font-medium text-[15px] mb-1">No open tickets</h3>
              <p className="text-sm text-gray-400">You don't have any active support requests.</p>
            </div>
            <button className="depth-button px-6 py-2.5 mt-2 w-full flex items-center justify-center gap-2">
              Open a ticket
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </section>

        {/* Latest Updates */}
        <section className="mt-2 mb-8">
          <div className="news-strip p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Bell className="w-4 h-4 text-blue-400" />
              </div>
              <div className="flex flex-col">
                <span className="text-[13px] font-medium text-gray-200">New server regions added</span>
                <span className="text-[12px] text-gray-500">2 hours ago</span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-600" />
          </div>
        </section>

      </div>
    </div>
  );
}
