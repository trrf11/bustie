import { useState, useEffect } from 'react';

interface UpdatePillProps {
  lastUpdate: number;
  intervalMs: number;
}

export function UpdatePill({ lastUpdate, intervalMs }: UpdatePillProps) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const elapsed = now - lastUpdate;
  const remaining = Math.max(0, Math.ceil((intervalMs - elapsed) / 1000));

  return (
    <div className="update-pill">
      {remaining > 0 ? `Update in ${remaining}s` : 'Updating...'}
    </div>
  );
}
