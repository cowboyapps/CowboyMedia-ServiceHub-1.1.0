import { Megaphone, ArrowRight, X } from "lucide-react";
import { useState } from "react";

const BLUE = "hsl(217 91% 45%)";

export function SoftGradient() {
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
            className="relative flex items-center gap-3 rounded-lg border px-4 py-3 shadow-sm"
            style={{
              borderColor: "hsl(217 91% 45% / 0.25)",
              background:
                "linear-gradient(90deg, hsl(217 91% 45% / 0.08), hsl(217 91% 45% / 0.03))",
            }}
          >
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
              style={{ background: "hsl(217 91% 45% / 0.12)" }}
            >
              <Megaphone className="h-4.5 w-4.5" style={{ color: BLUE, width: 18, height: 18 }} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold" style={{ color: BLUE }}>
                You have a new promotion available!
              </p>
              <p className="text-xs text-slate-500">Save 20% with Summer Savings — ends July 31</p>
            </div>
            <button
              className="flex shrink-0 items-center gap-1 rounded-md px-3 py-1.5 text-xs font-semibold text-white"
              style={{ background: BLUE }}
            >
              Learn more <ArrowRight style={{ width: 13, height: 13 }} />
            </button>
            <button
              onClick={() => setOpen(false)}
              className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-200/60 hover:text-slate-600"
              aria-label="Dismiss"
            >
              <X style={{ width: 15, height: 15 }} />
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
