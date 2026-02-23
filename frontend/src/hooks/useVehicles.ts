import { useState, useEffect, useCallback } from 'react';
import type { VehiclesResponse } from '../types';

const POLL_INTERVAL = 60_000;

export function useVehicles() {
  const [data, setData] = useState<VehiclesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastFetchTime, setLastFetchTime] = useState(Date.now());

  const fetchVehicles = useCallback(async () => {
    try {
      const res = await fetch('/api/vehicles');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: VehiclesResponse = await res.json();
      setData(json);
      setError(null);
      setLastFetchTime(Date.now());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVehicles();
    const interval = setInterval(fetchVehicles, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchVehicles]);

  return { data, error, loading, lastFetchTime, pollInterval: POLL_INTERVAL };
}
