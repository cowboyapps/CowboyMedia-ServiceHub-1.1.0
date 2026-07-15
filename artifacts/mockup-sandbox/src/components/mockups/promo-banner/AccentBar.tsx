import { Gift, ChevronRight, X } from "lucide-react";
import { useState } from "react";

const BLUE = "hsl(217 91% 45%)";

export function AccentBar() {
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
            className="relative flex cursor-pointer items-center gap-3 overflow-hidden rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:shadow"
            role="button"
          >
            <div className="absolute inset-y-0 left-0 w-1" style={{ background: BLUE }} />
            <Gift className="ml-1 shrink-0" style={{ color: BLUE, width: 18, height: 18 }} />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-slate-800">
                <span className="font-semibold">You have a new promotion available!</span>{" "}
                <span className="text-slate-500">Tap to see the details.</span>
              </p>
            </div>
            <ChevronRight className="shrink-0 text-slate-400" style={{ width: 16, height: 16 }} />
            <button
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
              }}
              className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
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
