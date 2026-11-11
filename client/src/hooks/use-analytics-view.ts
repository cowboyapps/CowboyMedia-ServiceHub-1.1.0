import { useEffect, useRef } from "react";
import { trackEvent, type AnalyticsData, type AnalyticsEvent } from "@/lib/analytics";

/** One event per successfully loaded item per visit; background refreshes are not new views. */
export function useAnalyticsView(event: AnalyticsEvent, localKey: string | null | undefined, data?: AnalyticsData) {
  const last = useRef<string>();
  useEffect(() => {
    if (!localKey) { last.current = undefined; return; }
    const key = `${event}:${localKey}`;
    if (last.current === key) return;
    last.current = key;
    trackEvent(event, data);
  }, [event, localKey, data]);
}
