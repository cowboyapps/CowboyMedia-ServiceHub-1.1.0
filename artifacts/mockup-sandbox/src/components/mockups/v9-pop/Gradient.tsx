import React from 'react';
import { 
  CheckCircle2, 
  AlertTriangle, 
  Server, 
  Globe, 
  Phone, 
  Database,
  Ticket,
  ChevronRight,
  Bell,
  Menu,
  Activity,
  Plus
} from 'lucide-react';
import '../_group.css';
import './Gradient.css';

const services = [
  { id: 'web', name: 'Web Hosting', status: 'operational', icon: Globe },
  { id: 'voip', name: 'VoIP', status: 'degraded', icon: Phone },
  { id: 'games', name: 'Game Servers', status: 'operational', icon: Server },
  { id: 'db', name: 'Databases', status: 'operational', icon: Database },
];

export default function Gradient() {
  return (
    <div className="dark flex justify-center items-center min-h-screen bg-neutral-900 p-4 font-sans text-neutral-100">
      {/* Mobile Device Container */}
      <div className="w-[390px] h-[844px] gradient-dashboard bg-[#0f0d0c] rounded-[40px] shadow-2xl overflow-hidden relative flex flex-col border-[8px] border-neutral-800">
        
        {/* App Header */}
        <header className="px-6 pt-12 pb-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/20">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg tracking-tight">ServiceHub</span>
          </div>
          <div className="flex gap-4 items-center">
            <button className="text-neutral-400 hover:text-white transition-colors relative">
              <Bell className="w-6 h-6" />
              <span className="absolute top-0 right-0 w-2 h-2 bg-orange-500 rounded-full"></span>
            </button>
            <button className="text-neutral-400 hover:text-white transition-colors">
              <Menu className="w-6 h-6" />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto pb-8 scrollbar-hide z-10 flex flex-col gap-6">
          
          {/* Status Hero */}
          <section className="px-4">
            <div className="gradient-bg-hero rounded-3xl p-6 flex flex-col items-center text-center border border-neutral-800/50 bg-[#171514]">
              <div className="gradient-dot-wrapper mb-4">
                <div className="gradient-dot"></div>
              </div>
              <h1 className="text-2xl font-bold mb-2">Systems Degraded</h1>
              <p className="text-neutral-400 text-sm max-w-[260px]">
                VoIP services are experiencing higher than normal latency. We are investigating.
              </p>
            </div>
          </section>

          {/* Latest Updates Strip */}
          <section className="px-4">
            <div className="news-strip rounded-2xl p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-orange-500 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-medium text-orange-50 text-shadow-sm">Update: VoIP Latency</h3>
                <p className="text-xs text-orange-200/70 mt-1">Investigating routing issues in NA-East region. Next update in 15m.</p>
              </div>
            </div>
          </section>

          {/* Services List */}
          <section className="px-4 flex flex-col gap-3">
            <h2 className="text-lg font-semibold px-2">Services</h2>
            <div className="flex flex-col gap-3">
              {services.map((service) => {
                const Icon = service.icon;
                const isOp = service.status === 'operational';
                const cardClass = isOp ? 'service-card-operational' : 'service-card-degraded';
                
                return (
                  <div key={service.id} className={`${cardClass} rounded-2xl p-4 flex items-center justify-between transition-transform active:scale-[0.98]`}>
                    <div className="flex items-center gap-4">
                      <div className={`p-2.5 rounded-xl ${isOp ? 'bg-green-500/10 text-green-500' : 'bg-amber-500/10 text-amber-500'}`}>
                        <Icon className="w-6 h-6" />
                      </div>
                      <div>
                        <h3 className="font-medium text-base text-neutral-100">{service.name}</h3>
                        <div className="flex items-center gap-1.5 mt-1">
                          {isOp ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                              <span className="text-xs text-green-500 font-medium tracking-wide uppercase">Operational</span>
                            </>
                          ) : (
                            <>
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                              <span className="text-xs text-amber-500 font-medium tracking-wide uppercase">Degraded</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-neutral-600" />
                  </div>
                );
              })}
            </div>
          </section>

          {/* Tickets Section */}
          <section className="px-4">
            <h2 className="text-lg font-semibold px-2 mb-3">Your Tickets</h2>
            <div className="glass-panel rounded-3xl p-8 flex flex-col items-center text-center">
              <div className="w-16 h-16 rounded-full bg-neutral-800/50 flex items-center justify-center mb-4 border border-neutral-700/50">
                <Ticket className="w-8 h-8 text-neutral-500" />
              </div>
              <h3 className="text-lg font-medium mb-2">No open tickets</h3>
              <p className="text-neutral-400 text-sm mb-6 max-w-[220px]">
                You don't have any open tickets. Everything looks good!
              </p>
              <button className="gradient-btn px-6 py-3 rounded-full font-medium flex items-center gap-2 w-full justify-center text-[15px]">
                <Plus className="w-5 h-5" />
                Open a ticket
              </button>
            </div>
          </section>

        </main>
        
        {/* Navigation Indicator Bar */}
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-32 h-1 bg-neutral-600 rounded-full z-20"></div>
      </div>
    </div>
  );
}
