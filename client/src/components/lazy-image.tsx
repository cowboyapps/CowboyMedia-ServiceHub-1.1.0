import { useState, useEffect, useRef } from "react";

interface LazyImageProps {
  src: string;
  alt: string;
  className?: string;
  placeholderClassName?: string;
  onError?: (e: React.SyntheticEvent<HTMLImageElement>) => void;
}

export function LazyImage({ src, alt, className = "", placeholderClassName, onError }: LazyImageProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    if (typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div
        className={`absolute inset-0 rounded-md animate-shimmer transition-opacity duration-300 ${isLoaded ? "opacity-0" : "opacity-100"} ${placeholderClassName || ""}`}
      />
      {isVisible && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          className={`${className} transition-opacity duration-300 ${isLoaded ? "opacity-100" : "opacity-0"}`}
          onLoad={() => setIsLoaded(true)}
          onError={(e) => {
            setIsLoaded(true);
            onError?.(e);
          }}
        />
      )}
    </div>
  );
}
