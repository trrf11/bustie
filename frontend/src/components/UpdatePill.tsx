import { useState, useEffect } from 'react';

interface UpdatePillProps {
  lastUpdate: number;
  intervalMs: number;
}

export function UpdatePill({ lastUpdate, intervalMs }: UpdatePillProps) {
  const intervalSecs = Math.ceil(intervalMs / 1000);
  const [tick, setTick] = useState(0);
  const [prevLastUpdate, setPrevLastUpdate] = useState(lastUpdate);

  // React 19 pattern: adjust state during render when props change
  if (lastUpdate !== prevLastUpdate) {
    setPrevLastUpdate(lastUpdate);
    setTick(0);
  }

  useEffect(() => {
    const id = setInterval(() => {
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = Math.max(0, intervalSecs - tick);

  return (
    <div className="update-pill">
      {remaining > 0 ? `Update in ${remaining}s` : 'Updating...'}
    </div>
  );
}
