import { useState, useEffect } from 'react';
import type { ConnectionStatus } from '../hooks/useVehicles';

interface UpdatePillProps {
  lastUpdate: number;
  connectionStatus: ConnectionStatus;
}

export function UpdatePill({ lastUpdate, connectionStatus }: UpdatePillProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

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
  const isPolling = connectionStatus === 'polling';

  let label: string;
  if (elapsed < 5) {
    label = 'Zojuist bijgewerkt';
  } else if (elapsed < 60) {
    label = `${elapsed}s geleden`;
  } else {
    label = `${Math.floor(elapsed / 60)}m geleden`;
  }

  if (isPolling) {
    label += ' (polling)';
  }

  return <div className="update-pill">{label}</div>;
}
