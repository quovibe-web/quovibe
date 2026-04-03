import { useEffect, useRef, useState } from 'react';

interface LazySectionProps {
  children: React.ReactNode;
  minHeight?: number;
  rootMargin?: string;
}

export function LazySection({ children, minHeight = 300, rootMargin = '200px' }: LazySectionProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [rootMargin]);

  return (
    <div ref={ref}>
      {isVisible ? (
        <div className="qv-fade-in">{children}</div>
      ) : (
        <div style={{ minHeight }} />
      )}
    </div>
  );
}
