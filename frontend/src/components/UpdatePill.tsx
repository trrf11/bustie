import { useState, useEffect } from 'react';
import type { ConnectionStatus } from '../hooks/useVehicles';

interface UpdatePillProps {
  lastUpdate: number;
  connectionStatus: ConnectionStatus;
}

export function UpdatePill({ lastUpdate, connectionStatus }: UpdatePillProps) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (connectionStatus === 'connecting') {
    return <div className="update-pill update-pill--warn">Verbinden...</div>;
  }

  if (connectionStatus === 'reconnecting') {
    return <div className="update-pill update-pill--warn">Opnieuw verbinden...</div>;
  }

  const elapsed = lastUpdate > 0 ? Math.floor((Date.now() - lastUpdate) / 1000) : 0;
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
