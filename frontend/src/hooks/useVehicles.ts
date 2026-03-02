import { useState, useEffect, useCallback, useRef } from 'react';
import type { VehiclesResponse } from '../types';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'polling';

const POLL_INTERVAL = 60_000;
const MAX_RAPID_FAILURES = 3;
const RAPID_FAILURE_WINDOW = 5_000;
const STALE_THRESHOLD = 45_000;
const SSE_INIT_TIMEOUT = 10_000;

export function useVehicles() {
  const [data, setData] = useState<VehiclesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdateTime, setLastUpdateTime] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [updateAvailable, setUpdateAvailable] = useState(false);

  const routeRef = useRef<VehiclesResponse['route'] | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const failTimesRef = useRef<number[]>([]);
  const pollingRef = useRef(false);

  // Polling fallback
  const fetchVehicles = useCallback(async () => {
    try {
      const res = await fetch('/api/vehicles');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: VehiclesResponse = await res.json();
      setData(json);
      routeRef.current = json.route;
      setError(null);
      setLastUpdateTime(Date.now());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    setConnectionStatus('polling');
    fetchVehicles();
    const interval = setInterval(fetchVehicles, POLL_INTERVAL);
    return () => {
      clearInterval(interval);
      pollingRef.current = false;
    };
  }, [fetchVehicles]);

  const connectSSE = useCallback(() => {
    // Clean up any existing connection
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    failTimesRef.current = [];

    const es = new EventSource('/api/vehicles/stream');
    esRef.current = es;
    setConnectionStatus('connecting');

    // If the init event doesn't arrive in time (proxy buffering), fall back to polling
    const initTimeout = setTimeout(() => {
      if (esRef.current === es) {
        console.warn('SSE init timeout — falling back to polling');
        es.close();
        esRef.current = null;
        startPolling();
      }
    }, SSE_INIT_TIMEOUT);

    es.addEventListener('init', (e: MessageEvent) => {
      clearTimeout(initTimeout);
      try {
        const payload = JSON.parse(e.data) as VehiclesResponse;
        setData(payload);
        routeRef.current = payload.route;
        setError(null);
        setLastUpdateTime(Date.now());
        setLoading(false);
        setConnectionStatus('connected');
        failTimesRef.current = [];

        if (
          payload.version &&
          __APP_VERSION__ !== 'dev' &&
          payload.version !== __APP_VERSION__
        ) {
          setUpdateAvailable(true);
        }
      } catch {
        // ignore parse errors
      }
    });

    es.addEventListener('vehicles', (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data) as { vehicles: VehiclesResponse['vehicles']; stale: boolean; timestamp: string };
        if (routeRef.current) {
          setData({
            vehicles: payload.vehicles,
            route: routeRef.current,
            stale: payload.stale,
            timestamp: payload.timestamp,
          });
        }
        setError(null);
        setLastUpdateTime(Date.now());
        setConnectionStatus('connected');
      } catch {
        // ignore parse errors
      }
    });

    // Lightweight checkin count updates — merge into existing vehicle data
    es.addEventListener('checkins', (e: MessageEvent) => {
      try {
        const { counts } = JSON.parse(e.data) as { counts: Record<string, number> };
        setData((prev) => {
          if (!prev) return prev;
          // Bail out if no counts actually changed — avoids re-render cascade
          const changed = prev.vehicles.some((v) => (counts[v.vehicleId] || 0) !== v.checkinCount);
          if (!changed) return prev;
          return {
            ...prev,
            vehicles: prev.vehicles.map((v) => ({
              ...v,
              checkinCount: counts[v.vehicleId] || 0,
            })),
          };
        });
      } catch {
        // ignore parse errors
      }
    });

    es.onerror = () => {
      clearTimeout(initTimeout);
      const now = Date.now();
      failTimesRef.current.push(now);

      // Keep only recent failures
      failTimesRef.current = failTimesRef.current.filter((t) => now - t < RAPID_FAILURE_WINDOW);

      if (failTimesRef.current.length >= MAX_RAPID_FAILURES) {
        // Too many rapid failures — fall back to polling
        es.close();
        esRef.current = null;
        startPolling();
      } else {
        // EventSource will auto-reconnect
        setConnectionStatus('reconnecting');
      }
    };

    return es;
  }, [startPolling]);

  useEffect(() => {
    // Fetch initial data immediately via REST — SSE init can be delayed by
    // proxy buffering (Cloudflare, Nginx). This ensures the map renders
    // right away while the SSE connection is being established.
    fetchVehicles();

    connectSSE();

    // Mobile recovery: refresh data when page becomes visible after sleeping
    function onVisibilityChange() {
      if (document.visibilityState !== 'visible') return;

      const timeSinceUpdate = Date.now() - (lastUpdateTime || 0);
      if (timeSinceUpdate > STALE_THRESHOLD) {
        // Fetch REST immediately so stale data is replaced right away
        fetchVehicles();
        // Reconnect SSE for ongoing live updates
        connectSSE();
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectSSE]);

  // Apply authoritative checkin counts from an API response so the
  // badge updates immediately without waiting for the SSE round-trip.
  const setCheckinCounts = useCallback((counts: Record<string, number>) => {
    setData((prev) => {
      if (!prev) return prev;
      const changed = prev.vehicles.some((v) => (counts[v.vehicleId] || 0) !== v.checkinCount);
      if (!changed) return prev;
      return {
        ...prev,
        vehicles: prev.vehicles.map((v) => ({
          ...v,
          checkinCount: counts[v.vehicleId] || 0,
        })),
      };
    });
  }, []);

  return { data, error, loading, lastUpdateTime, connectionStatus, setCheckinCounts, updateAvailable };
}
