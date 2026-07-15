import { Gift, ChevronRight, X } from "lucide-react";
import { useState } from "react";

const BLUE = "hsl(217 91% 52%)";
const BG = "hsl(0 0% 9%)";
const CARD = "hsl(0 0% 11%)";
const BORDER = "hsl(0 0% 18%)";
const FG = "hsl(0 0% 98%)";
const MUTED = "hsl(0 0% 65%)";

export function AccentBar() {
  const [open, setOpen] = useState(true);
  return (
    <div className="min-h-screen p-4 font-sans" style={{ background: BG }}>
      <div className="mx-auto max-w-3xl space-y-3">
        <div className="flex items-center justify-between pb-1">
          <div>
            <h1 className="text-xl font-bold" style={{ color: FG }}>
              Dashboard
            </h1>
            <p className="text-sm" style={{ color: MUTED }}>
              Welcome back, John
            </p>
          </div>
        </div>

        {open && (
          <div
            className="relative flex cursor-pointer items-center gap-3 overflow-hidden rounded-lg border px-4 py-3 shadow-sm transition hover:brightness-110"
            style={{ background: CARD, borderColor: BORDER }}
            role="button"
          >
            <div className="absolute inset-y-0 left-0 w-1" style={{ background: BLUE }} />
            <Gift className="ml-1 shrink-0" style={{ color: BLUE, width: 18, height: 18 }} />
            <div className="min-w-0 flex-1">
              <p className="text-sm" style={{ color: FG }}>
                <span className="font-semibold">You have a new promotion available!</span>{" "}
                <span style={{ color: MUTED }}>Tap to see the details.</span>
              </p>
            </div>
            <ChevronRight className="shrink-0" style={{ color: MUTED, width: 16, height: 16 }} />
            <button
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
              }}
              className="shrink-0 rounded p-1 transition hover:bg-white/10"
              style={{ color: MUTED }}
              aria-label="Dismiss"
            >
              <X style={{ width: 15, height: 15 }} />
            </button>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border p-4" style={{ background: CARD, borderColor: BORDER }}>
            <p className="text-xs font-medium" style={{ color: MUTED }}>
              Service Status
            </p>
            <p className="mt-1 text-sm font-semibold text-emerald-500">All systems operational</p>
          </div>
          <div className="rounded-lg border p-4" style={{ background: CARD, borderColor: BORDER }}>
            <p className="text-xs font-medium" style={{ color: MUTED }}>
              Open Tickets
            </p>
            <p className="mt-1 text-sm font-semibold" style={{ color: FG }}>
              2 awaiting reply
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
