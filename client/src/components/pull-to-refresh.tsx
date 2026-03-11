import { useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from "react";
import { RefreshCw } from "lucide-react";
import { hapticMedium } from "@/lib/haptics";

interface PullToRefreshProps {
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

export const PullToRefresh = forwardRef<HTMLDivElement, PullToRefreshProps>(
  function PullToRefresh({ children, className, disabled }, ref) {
    const [pulling, setPulling] = useState(false);
    const [pullDistance, setPullDistance] = useState(0);
    const [refreshing, setRefreshing] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const startYRef = useRef(0);
    const pullingRef = useRef(false);

    useImperativeHandle(ref, () => containerRef.current!, []);

    const threshold = 80;
    const maxPull = 120;

    const handleTouchStart = useCallback((e: TouchEvent) => {
      const container = containerRef.current;
      if (!container || refreshing) return;
      if (container.scrollTop <= 0) {
        startYRef.current = e.touches[0].clientY;
        pullingRef.current = true;
      }
    }, [refreshing]);

    const handleTouchMove = useCallback((e: TouchEvent) => {
      if (!pullingRef.current || refreshing) return;
      const container = containerRef.current;
      if (!container) return;

      if (container.scrollTop > 0) {
        pullingRef.current = false;
        setPulling(false);
        setPullDistance(0);
        return;
      }

      const currentY = e.touches[0].clientY;
      const diff = currentY - startYRef.current;

      if (diff > 0) {
        e.preventDefault();
        const distance = Math.min(diff * 0.5, maxPull);
        setPullDistance(distance);
        setPulling(true);
      }
    }, [refreshing]);

    const handleTouchEnd = useCallback(() => {
      if (!pullingRef.current) return;
      pullingRef.current = false;

      if (pullDistance >= threshold && !refreshing) {
        hapticMedium();
        setRefreshing(true);
        setPullDistance(threshold);
        window.location.reload();
      } else {
        setPulling(false);
        setPullDistance(0);
      }
    }, [pullDistance, refreshing]);

    useEffect(() => {
      if (disabled) return;
      const container = containerRef.current;
      if (!container) return;

      container.addEventListener("touchstart", handleTouchStart, { passive: true });
      container.addEventListener("touchmove", handleTouchMove, { passive: false });
      container.addEventListener("touchend", handleTouchEnd, { passive: true });

      return () => {
        container.removeEventListener("touchstart", handleTouchStart);
        container.removeEventListener("touchmove", handleTouchMove);
        container.removeEventListener("touchend", handleTouchEnd);
      };
    }, [disabled, handleTouchStart, handleTouchMove, handleTouchEnd]);

    if (disabled) {
      return <div ref={ref} className={className}>{children}</div>;
    }

    const rotation = Math.min((pullDistance / threshold) * 360, 360);
    const opacity = Math.min(pullDistance / (threshold * 0.5), 1);
    const scale = Math.min(pullDistance / threshold, 1);

    return (
      <div ref={containerRef} className={className} style={{ position: "relative" }}>
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
            transform: `translateY(${pullDistance - 40}px)`,
            transition: pulling ? "none" : "transform 0.3s ease",
            zIndex: 100,
            pointerEvents: "none",
          }}
        >
          <div
            style={{
              opacity,
              transform: `scale(${scale}) rotate(${rotation}deg)`,
              transition: pulling ? "none" : "all 0.3s ease",
            }}
          >
            <RefreshCw
              className={`w-6 h-6 text-muted-foreground ${refreshing ? "animate-spin" : ""}`}
            />
          </div>
        </div>
        <div
          style={{
            transform: `translateY(${pullDistance > 0 ? pullDistance : 0}px)`,
            transition: pulling ? "none" : "transform 0.3s ease",
          }}
        >
          {children}
        </div>
      </div>
    );
  }
);
