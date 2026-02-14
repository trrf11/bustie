import { useState, useEffect } from 'react';

const MOBILE_BREAKPOINT = 768;

/**
 * Returns true when the viewport is below the desktop breakpoint (768px).
 * Matches the existing `@media (min-width: 768px)` desktop breakpoint in App.css.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < MOBILE_BREAKPOINT : true
  );

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);

    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return isMobile;
}
