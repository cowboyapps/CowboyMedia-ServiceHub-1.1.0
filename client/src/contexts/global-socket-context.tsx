import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import {
  useReconnectingWebSocket,
  type ReconnectingWebSocketStatus,
} from "@/hooks/use-reconnecting-websocket";

type Listener = (event: MessageEvent) => void;

export interface GlobalSocketContextValue {
  status: ReconnectingWebSocketStatus;
  sendMessage: (data: unknown) => boolean;
  subscribe: (listener: Listener) => () => void;
}

const GlobalSocketContext = createContext<GlobalSocketContextValue | null>(null);

interface GlobalSocketProviderProps {
  userId: string;
  children: ReactNode;
}

export function GlobalSocketProvider({ userId, children }: GlobalSocketProviderProps) {
  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Set<Listener>>(new Set());

  const status = useReconnectingWebSocket({
    path: "/ws",
    wsRef,
    reconnectDelayMs: 3000,
    deps: [userId],
    onOpen: (sock) => {
      try {
        sock.send(
          JSON.stringify({ type: "current_page", page: window.location.pathname }),
        );
      } catch {}
    },
    onMessage: (event) => {
      listenersRef.current.forEach((fn) => {
        try {
          fn(event);
        } catch {}
      });
    },
  });

  const sendMessage = useCallback((data: unknown): boolean => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(typeof data === "string" ? data : JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  }, []);

  const subscribe = useCallback((listener: Listener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const value = useMemo<GlobalSocketContextValue>(
    () => ({ status, sendMessage, subscribe }),
    [status, sendMessage, subscribe],
  );

  return (
    <GlobalSocketContext.Provider value={value}>
      {children}
    </GlobalSocketContext.Provider>
  );
}

export function useGlobalSocket(): GlobalSocketContextValue {
  const ctx = useContext(GlobalSocketContext);
  if (!ctx) {
    throw new Error("useGlobalSocket must be used inside <GlobalSocketProvider>");
  }
  return ctx;
}

export function useOptionalGlobalSocket(): GlobalSocketContextValue | null {
  return useContext(GlobalSocketContext);
}
