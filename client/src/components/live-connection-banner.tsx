import * as React from "react";
import { useEffect, useState } from "react";
import { Wifi, WifiOff } from "lucide-react";
import type { ReconnectingWebSocketStatus } from "@/hooks/use-reconnecting-websocket";

interface LiveConnectionBannerProps {
  status: ReconnectingWebSocketStatus;
  className?: string;
}

/**
 * Shared "Reconnecting… / Live again" banner for any screen that relies on
 * a live WebSocket. Surfaces a small amber banner after the socket has been
 * down for >3s, then briefly flashes a green "Live again" confirmation when
 * it reopens. Same colours/copy/testids across every screen so customers
 * and admins get a single consistent cue when live updates pause.
 */
export function LiveConnectionBanner({
  status,
  className = "",
}: LiveConnectionBannerProps) {
  const [state, setState] = useState<"reconnecting" | "recovered" | null>(null);

  useEffect(() => {
    if (status === "closed") {
      const t = setTimeout(() => setState("reconnecting"), 3000);
      return () => clearTimeout(t);
    }
    if (status === "open") {
      setState((prev) => (prev === "reconnecting" ? "recovered" : prev));
    }
  }, [status]);

  useEffect(() => {
    if (state !== "recovered") return;
    const t = setTimeout(() => setState(null), 2000);
    return () => clearTimeout(t);
  }, [state]);

  if (!state) return null;

  return (
    <div
      className={`flex-shrink-0 px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 ${
        state === "reconnecting"
          ? "bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-900"
          : "bg-green-50 dark:bg-green-950/30 text-green-800 dark:text-green-300 border border-green-200 dark:border-green-900"
      } ${className}`}
      data-testid={
        state === "reconnecting"
          ? "banner-connection-reconnecting"
          : "banner-connection-recovered"
      }
      role="status"
      aria-live="polite"
    >
      {state === "reconnecting" ? (
        <>
          <WifiOff className="w-3.5 h-3.5" />
          Reconnecting…
        </>
      ) : (
        <>
          <Wifi className="w-3.5 h-3.5" />
          Live again
        </>
      )}
    </div>
  );
}
