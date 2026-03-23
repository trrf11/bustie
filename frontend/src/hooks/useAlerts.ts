import { useState, useEffect, useCallback } from 'react';
import { useClientId } from './useClientId';

export interface AlertConfig {
  tpc: string;
  direction: number;
  stopName: string;
  walkTimeMinutes: number;
  timeWindowStart: string;
  timeWindowEnd: string;
  daysOfWeek: number[];
  enabled: boolean;
}

export function useAlerts() {
  const clientId = useClientId();
  const [alerts, setAlerts] = useState<AlertConfig[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchAlerts() {
      try {
        const res = await fetch(`/api/alerts?clientId=${encodeURIComponent(clientId)}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (!cancelled) setAlerts(data.alerts);
      } catch {
        // Silently fail — alerts are non-critical
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchAlerts();
    return () => { cancelled = true; };
  }, [clientId]);

  const saveAlert = useCallback(async (alert: AlertConfig) => {
    // Optimistic update
    setAlerts((prev) => {
      const idx = prev.findIndex((a) => a.tpc === alert.tpc && a.direction === alert.direction);
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = alert;
        return updated;
      }
      return [...prev, alert];
    });

    try {
      const res = await fetch('/api/alerts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, ...alert }),
      });
      if (!res.ok) throw new Error();
    } catch {
      // Revert on failure
      const res = await fetch(`/api/alerts?clientId=${encodeURIComponent(clientId)}`);
      if (res.ok) {
        const data = await res.json();
        setAlerts(data.alerts);
      }
    }
  }, [clientId]);

  const deleteAlert = useCallback(async (tpc: string, direction: number) => {
    setAlerts((prev) => prev.filter((a) => !(a.tpc === tpc && a.direction === direction)));

    try {
      await fetch('/api/alerts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, tpc, direction }),
      });
    } catch {
      // Best effort
    }
  }, [clientId]);

  const toggleAlert = useCallback(async (tpc: string, direction: number) => {
    const existing = alerts.find((a) => a.tpc === tpc && a.direction === direction);
    if (existing) {
      await saveAlert({ ...existing, enabled: !existing.enabled });
    }
  }, [alerts, saveAlert]);

  const getAlertForStop = useCallback((tpc: string, direction: number): AlertConfig | undefined => {
    return alerts.find((a) => a.tpc === tpc && a.direction === direction);
  }, [alerts]);

  return { alerts, loading, saveAlert, deleteAlert, toggleAlert, getAlertForStop };
}
