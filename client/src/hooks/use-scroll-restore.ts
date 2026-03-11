import { useEffect, useRef } from "react";
import { useLocation } from "wouter";

const scrollPositions = new Map<string, number>();

export function useScrollRestore(scrollRef: React.RefObject<HTMLElement | null>) {
  const [location] = useLocation();
  const prevLocationRef = useRef(location);

  useEffect(() => {
    if (prevLocationRef.current !== location && scrollRef.current) {
      scrollPositions.set(prevLocationRef.current, scrollRef.current.scrollTop);
    }
    prevLocationRef.current = location;
  }, [location, scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const saved = scrollPositions.get(location);
    if (saved !== undefined) {
      requestAnimationFrame(() => {
        el.scrollTop = saved;
      });
    } else {
      el.scrollTop = 0;
    }
  }, [location, scrollRef]);
}
