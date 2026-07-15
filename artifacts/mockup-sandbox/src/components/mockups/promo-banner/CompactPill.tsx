import { Sparkles, X } from "lucide-react";
import { useState } from "react";

const BLUE = "hsl(217 91% 45%)";

export function CompactPill() {
  const [open, setOpen] = useState(true);
  return (
    <div className="min-h-screen bg-slate-50 p-4 font-sans">
      <div className="mx-auto max-w-3xl space-y-3">
        <div className="flex items-center justify-between pb-1">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Dashboard</h1>
            <p className="text-sm text-slate-500">Welcome back, John</p>
          </div>
        </div>

        {open && (
          <div
            className="flex items-center gap-2.5 rounded-full py-2 pl-3 pr-2"
            style={{ background: "hsl(217 91% 45% / 0.1)" }}
          >
            <Sparkles className="shrink-0" style={{ color: BLUE, width: 15, height: 15 }} />
            <p className="min-w-0 flex-1 truncate text-sm" style={{ color: "hsl(217 60% 30%)" }}>
              <span className="font-semibold" style={{ color: BLUE }}>
                New promotion available!
              </span>{" "}
              <a href="#" className="underline underline-offset-2" style={{ color: BLUE }}>
                Click here to learn more
              </a>
            </p>
            <button
              onClick={() => setOpen(false)}
              className="shrink-0 rounded-full p-1.5 hover:bg-white/60"
              style={{ color: "hsl(217 40% 45%)" }}
              aria-label="Dismiss"
            >
              <X style={{ width: 14, height: 14 }} />
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500">Service Status</p>
            <p className="mt-1 text-sm font-semibold text-emerald-600">All systems operational</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium text-slate-500">Open Tickets</p>
            <p className="mt-1 text-sm font-semibold text-slate-800">2 awaiting reply</p>
          </div>
        </div>
      </div>
    </div>
  );
}
