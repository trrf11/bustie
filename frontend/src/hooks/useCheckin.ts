import { useState, useEffect, useCallback } from 'react';
import { useClientId } from './useClientId';

interface CheckinState {
  vehicleId: string;
  tripId: string;
}

export type CheckinCounts = Record<string, number>;

export function useCheckin() {
  const clientId = useClientId();
  const [checkin, setCheckin] = useState<CheckinState | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetch initial check-in state on mount
  useEffect(() => {
    fetch(`/api/checkin?clientId=${encodeURIComponent(clientId)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.checkin) {
          setCheckin({ vehicleId: data.checkin.vehicleId, tripId: data.checkin.tripId });
        }
      })
      .catch(() => {
        // ignore — not critical
      });
  }, [clientId]);

  const doCheckin = useCallback(
    async (vehicleId: string, tripId: string): Promise<CheckinCounts | null> => {
      setLoading(true);
      try {
        const res = await fetch('/api/checkin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, vehicleId, tripId }),
        });
        if (res.ok) {
          const data = await res.json();
          setCheckin({ vehicleId, tripId });
          return data.counts ?? null;
        }
        return null;
      } finally {
        setLoading(false);
      }
    },
    [clientId],
  );

  const doCheckout = useCallback(async (): Promise<CheckinCounts | null> => {
    setLoading(true);
    try {
      const res = await fetch('/api/checkin', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      });
      if (res.ok) {
        const data = await res.json();
        setCheckin(null);
        return data.counts ?? null;
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  const isCheckedInto = useCallback(
    (vehicleId: string, tripId: string) => {
      return checkin?.vehicleId === vehicleId && checkin?.tripId === tripId;
    },
    [checkin],
  );

  return { checkin, loading, doCheckin, doCheckout, isCheckedInto };
}
