import { useEffect, useRef, useState, type MutableRefObject } from "react";

export type ReconnectingWebSocketStatus = "connecting" | "open" | "closed";

export interface ReconnectingWebSocketOptions {
  /**
   * Path on the same origin to connect to (e.g. `/ws`).
   * The protocol is auto-derived from `window.location.protocol`.
   */
  path: string;
  /**
   * Re-open delay in ms after the socket closes unexpectedly.
   * Defaults to 2000ms — matches the original ticket-detail behavior.
   */
  reconnectDelayMs?: number;
  /**
   * Optional external ref that mirrors the active socket so other handlers
   * in the host component (e.g. a "user changed" effect that re-sends
   * `viewing_ticket`) can reach in and use it.
   */
  wsRef?: MutableRefObject<WebSocket | null>;
  /** Called every time a fresh socket opens (initial + after every reconnect). */
  onOpen?: (ws: WebSocket) => void;
  /** Forwarded straight to `ws.onmessage`. */
  onMessage?: (event: MessageEvent) => void;
  /**
   * Called when the document becomes visible AND the socket is already OPEN.
   * Use this to re-send presence/subscription frames after a tab regains focus.
   * (When the socket is CLOSED on visibility change the hook reconnects
   *  immediately — no callback needed for that path.)
   */
  onVisible?: (ws: WebSocket) => void;
  /**
   * Called once during cleanup, *before* the socket is closed, when the
   * current socket is OPEN. Use this to send a final "leaving" frame.
   */
  onBeforeUnmount?: (ws: WebSocket) => void;
  /**
   * Optional effect deps. The socket is torn down and reconnected when any
   * of these change. Defaults to `[]` (mount/unmount only).
   */
  deps?: unknown[];
  /**
   * If the document was hidden for at least this long, an apparently-OPEN
   * (or still-CONNECTING) socket is treated as a potential "zombie" on the
   * next visibilitychange → "visible" and is force-replaced with a fresh
   * connection. iOS PWAs silently kill sockets when the app is suspended,
   * but on resume `readyState` often still reads OPEN — no close event ever
   * fires, so without this the page keeps "listening" on a dead pipe.
   * Callers re-establish presence/subscriptions in `onOpen`, which fires on
   * the replacement socket. Short hides (quick tab switches) below the
   * threshold keep the socket and use the `onVisible` path instead.
   * Defaults to 5000ms.
   */
  staleAfterHiddenMs?: number;
}

/**
 * Auto-reconnecting WebSocket lifecycle hook.
 *
 * Behaviour (mirrors the original ticket-detail.tsx WS effect that this
 * extracts so it can be unit-tested in isolation):
 *  - Opens a socket on mount.
 *  - On `onclose`, schedules a reconnect after `reconnectDelayMs`.
 *  - On `onerror`, closes the socket (which triggers the reconnect path).
 *  - On `visibilitychange` → "visible": if the socket is OPEN, calls
 *    `onVisible(ws)`. If it's CLOSED (or null), reconnects immediately
 *    without waiting for the 2s timer.
 *  - On unmount: cancels any pending reconnect, fires `onBeforeUnmount(ws)`
 *    if OPEN, then closes the socket.
 *
 * All callbacks are read through refs so they can change between renders
 * without resetting the socket. The socket is only torn down/recreated
 * when `deps` change.
 */
export function useReconnectingWebSocket(
  opts: ReconnectingWebSocketOptions,
): ReconnectingWebSocketStatus {
  const {
    path,
    reconnectDelayMs = 2000,
    wsRef: externalWsRef,
    deps = [],
    staleAfterHiddenMs = 5000,
  } = opts;

  const [status, setStatus] = useState<ReconnectingWebSocketStatus>("connecting");

  const onOpenRef = useRef(opts.onOpen);
  const onMessageRef = useRef(opts.onMessage);
  const onVisibleRef = useRef(opts.onVisible);
  const onBeforeUnmountRef = useRef(opts.onBeforeUnmount);
  onOpenRef.current = opts.onOpen;
  onMessageRef.current = opts.onMessage;
  onVisibleRef.current = opts.onVisible;
  onBeforeUnmountRef.current = opts.onBeforeUnmount;

  useEffect(() => {
    let disposed = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function setActiveSocket(next: WebSocket | null) {
      ws = next;
      if (externalWsRef) externalWsRef.current = next;
    }

    function connect() {
      if (disposed) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const next = new WebSocket(`${protocol}//${window.location.host}${path}`);
      setActiveSocket(next);

      next.onopen = () => {
        setStatus("open");
        onOpenRef.current?.(next);
      };

      next.onmessage = (event) => {
        onMessageRef.current?.(event);
      };

      next.onclose = () => {
        if (externalWsRef && externalWsRef.current === next) {
          externalWsRef.current = null;
        }
        if (ws === next) ws = null;
        if (!disposed) {
          setStatus("closed");
          reconnectTimer = setTimeout(connect, reconnectDelayMs);
        }
      };

      next.onerror = () => {
        next.close();
      };
    }

    connect();

    // Silently discard the current socket (no `onclose` → no 2s backoff, no
    // "closed" status flap) and dial a fresh one. Used on resume when the
    // existing socket can't be trusted (iOS zombie: reads OPEN but the pipe
    // is dead) or is stuck CONNECTING from before the app was suspended.
    function forceReconnect() {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      const current = ws;
      setActiveSocket(null);
      if (current) {
        current.onopen = null;
        current.onmessage = null;
        current.onclose = null;
        current.onerror = null;
        try {
          current.close();
        } catch {
          /* already dead — that's the point */
        }
      }
      connect();
    }

    let hiddenAt: number | null = null;

    const handleVisibility = () => {
      if (document.visibilityState !== "visible") {
        hiddenAt = Date.now();
        return;
      }
      const hiddenFor = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      const current = ws;
      if (current && current.readyState === WebSocket.OPEN) {
        if (hiddenFor >= staleAfterHiddenMs) {
          // Long-hidden "OPEN" socket may be a zombie — replace it. The new
          // socket's onOpen re-establishes presence/subscriptions.
          forceReconnect();
        } else {
          onVisibleRef.current?.(current);
        }
      } else if (current && current.readyState === WebSocket.CONNECTING) {
        // A connect attempt that started before the app was suspended can
        // hang forever; abandon it and re-dial.
        if (hiddenFor >= staleAfterHiddenMs) forceReconnect();
      } else {
        // CLOSED or no socket — reconnect immediately, skipping the backoff.
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
        connect();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      const current = ws;
      if (current && current.readyState === WebSocket.OPEN) {
        try {
          onBeforeUnmountRef.current?.(current);
        } catch {
          /* swallow — cleanup must not throw */
        }
      }
      current?.close();
      if (externalWsRef && externalWsRef.current === current) {
        externalWsRef.current = null;
      }
      ws = null;
    };
    // Keep: callbacks are read through refs (onVisibleRef/onBeforeUnmountRef
    // etc.) so they intentionally aren't deps; caller-supplied reconnect
    // triggers come in via the `...deps` spread, which ESLint can't verify.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, reconnectDelayMs, staleAfterHiddenMs, ...deps]);

  return status;
}
