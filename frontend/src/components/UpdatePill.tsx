import { useState, useEffect, useRef } from 'react';
import type { ConnectionStatus } from '../hooks/useVehicles';

interface UpdatePillProps {
  lastUpdate: number;
  connectionStatus: ConnectionStatus;
  onOpenAbout?: () => void;
}

export function UpdatePill({ lastUpdate, connectionStatus, onOpenAbout }: UpdatePillProps) {
  const [now, setNow] = useState(() => Date.now());
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Close tooltip on outside tap
  useEffect(() => {
    if (!showTooltip) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) {
        setShowTooltip(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [showTooltip]);

  // Only show "Verbinden..." if we have no data yet.
  // Once REST has delivered initial data (lastUpdate > 0), show the update time
  // even while SSE is still being established (proxy buffering can delay it).
  if (connectionStatus === 'connecting' && lastUpdate === 0) {
    return <div className="update-pill update-pill--warn">Verbinden...</div>;
  }

  if (connectionStatus === 'reconnecting' && lastUpdate === 0) {
    return <div className="update-pill update-pill--warn">Opnieuw verbinden...</div>;
  }

  const elapsed = lastUpdate > 0 ? Math.floor((now - lastUpdate) / 1000) : 0;
  let label: string;
  if (elapsed < 5) {
    label = 'Zojuist bijgewerkt';
  } else if (elapsed < 60) {
    label = `${elapsed}s geleden`;
  } else {
    label = `${Math.floor(elapsed / 60)}m geleden`;
  }

  return (
    <div className="update-pill-wrap" ref={tooltipRef}>
      <div
        className="update-pill"
        onClick={() => setShowTooltip((v) => !v)}
      >
        {label}
      </div>
      {showTooltip && (
        <div className="update-pill-tooltip">
          <p>Posities worden elke ~60s opgehaald via openbaar vervoerdata (GTFS). Tussendoor schatten we de positie op basis van snelheid en route.</p>
          {onOpenAbout && (
            <button
              className="update-pill-tooltip-link"
              onClick={() => { setShowTooltip(false); onOpenAbout(); }}
            >
              Meer info &rarr;
            </button>
          )}
        </div>
      )}
    </div>
  );
}
