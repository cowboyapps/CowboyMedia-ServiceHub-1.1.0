import React, { useEffect, useState } from "react";
import { CheckCircle2, ChevronRight, Activity, Plus, FileText, Bell, Server, Database, Phone, Globe } from "lucide-react";
import "../_group.css";
import "./Alive.css";

const Sparkline = ({ data, color }: { data: number[], color: string }) => {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data.map((d, i) => `${(i / (data.length - 1)) * 40},${10 - ((d - min) / range) * 10}`).join(" ");
  return (
    <svg width="40" height="12" viewBox="0 -2 40 14" className="overflow-visible opacity-70">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

export default function Alive() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="dark flex justify-center items-center min-h-screen bg-[#000000] p-4 text-foreground font-sans">
      <div className="w-[390px] h-[844px] bg-[#09090b] rounded-[40px] overflow-hidden shadow-2xl relative flex flex-col ring-1 ring-white/10">
        
        {/* Header */}
        <header className="px-6 pt-12 pb-4 flex justify-between items-center z-10">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-500 to-orange-700 flex items-center justify-center shadow-lg shadow-orange-500/20">
              <span className="font-bold text-white text-sm">CM</span>
            </div>
            <span className="font-semibold text-white tracking-tight">CowboyMedia</span>
          </div>
          <button className="w-10 h-10 rounded-full glass-panel flex items-center justify-center hover:bg-white/5 transition-colors">
            <Bell size={18} className="text-white/70" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto pb-20 px-4 space-y-6 hide-scrollbar relative z-0">
          
          {/* Status Hero */}
          <div className={`relative overflow-hidden rounded-3xl glass-panel p-6 transition-all duration-700 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
            <div className="absolute inset-0 animate-hero-sweep z-0"></div>
            <div className="relative z-10 flex flex-col items-center text-center">
              <div className="relative mb-4">
                <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
                  <div className="w-8 h-8 rounded-full bg-green-500 animate-status-glow flex items-center justify-center relative">
                    <div className="absolute inset-0 rounded-full bg-green-500 animate-status-pulse"></div>
                    <CheckCircle2 size={16} className="text-black relative z-10" />
                  </div>
                </div>
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">All systems operational</h2>
              <p className="text-sm text-white/50">Updated 2 mins ago</p>
            </div>
          </div>

          {/* Services List */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-white/40 px-2 tracking-wide uppercase">Services</h3>
            
            <div className={`glass-panel rounded-2xl p-4 flex items-center justify-between transition-all duration-500 stagger-item stagger-1 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-blue-400">
                  <Server size={20} />
                </div>
                <div>
                  <div className="text-white font-medium">Game Servers</div>
                  <div className="text-xs text-green-400 flex items-center gap-1 mt-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400"></span> Operational
                  </div>
                </div>
              </div>
              <Sparkline data={[8,9,8,10,9,9,10,9]} color="#4ade80" />
            </div>

            <div className={`glass-panel rounded-2xl p-4 flex items-center justify-between transition-all duration-500 stagger-item stagger-2 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center text-orange-400">
                  <Database size={20} />
                </div>
                <div>
                  <div className="text-white font-medium">Databases</div>
                  <div className="text-xs text-orange-400 flex items-center gap-1 mt-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse"></span> Degraded
                  </div>
                </div>
              </div>
              <Sparkline data={[10,9,10,8,4,5,6,5]} color="#fb923c" />
            </div>

            <div className={`glass-panel rounded-2xl p-4 flex items-center justify-between transition-all duration-500 stagger-item stagger-3 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-purple-400">
                  <Globe size={20} />
                </div>
                <div>
                  <div className="text-white font-medium">Web Hosting</div>
                  <div className="text-xs text-green-400 flex items-center gap-1 mt-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400"></span> Operational
                  </div>
                </div>
              </div>
              <Sparkline data={[9,10,9,9,10,10,9,10]} color="#4ade80" />
            </div>

            {/* Skeleton Loading Card Example */}
            <div className={`glass-panel rounded-2xl p-4 flex items-center justify-between transition-all duration-500 stagger-item stagger-4 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
              <div className="flex items-center gap-3 w-full">
                <div className="w-10 h-10 rounded-xl skeleton-shimmer"></div>
                <div className="space-y-2 flex-1">
                  <div className="h-4 w-24 rounded skeleton-shimmer"></div>
                  <div className="h-3 w-16 rounded skeleton-shimmer"></div>
                </div>
              </div>
            </div>
          </div>

          {/* Tickets Section */}
          <div className={`space-y-3 transition-all duration-500 stagger-item stagger-5 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
            <h3 className="text-sm font-medium text-white/40 px-2 tracking-wide uppercase">Your Tickets</h3>
            
            <div className="glass-panel rounded-3xl p-6 flex flex-col items-center text-center relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2"></div>
              
              <div className="w-16 h-16 mb-4 relative flex items-center justify-center">
                <div className="absolute inset-0 bg-blue-500/20 rounded-full scale-150 blur-xl opacity-50"></div>
                <svg className="w-12 h-12 text-blue-400 relative z-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                  <polyline points="22 4 12 14.01 9 11.01" className="animate-draw-check"></polyline>
                </svg>
              </div>
              
              <h4 className="text-white font-medium mb-1">All clear!</h4>
              <p className="text-sm text-white/50 mb-6">You don't have any open tickets right now.</p>
              
              <button className="w-full bg-blue-600 hover:bg-blue-500 text-white rounded-xl py-3.5 font-medium flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-lg shadow-blue-500/25">
                <Plus size={18} /> Open a ticket
              </button>
            </div>
          </div>
          
          {/* News Strip */}
          <div className={`flex items-center gap-3 glass-panel rounded-xl p-3 px-4 transition-all duration-500 stagger-item stagger-6 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
            <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></div>
            <div className="text-sm text-white/70 flex-1 truncate">New feature: Advanced DDoS protection enabled on all Game Servers</div>
            <ChevronRight size={16} className="text-white/30" />
          </div>

        </div>

      </div>
    </div>
  );
}