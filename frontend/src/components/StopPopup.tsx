import { useState, useEffect } from 'react';
import type { DeparturesResponse, SavedTrip } from '../types';

interface StopPopupProps {
  stopName: string;
  tpc: string | null;
  direction: number;
  savedTrips: SavedTrip[];
  onSave: () => void;
  onRemove: () => void;
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

function formatMinutesUntil(isoString: string): string {
  const diff = Math.round((new Date(isoString).getTime() - Date.now()) / 60000);
  if (diff <= 0) return 'nu';
  if (diff === 1) return '1 min';
  return `${diff} min`;
}

export function StopPopup({ stopName, tpc, direction, savedTrips, onSave, onRemove }: StopPopupProps) {
  const [nextDep, setNextDep] = useState<{
    expected: string;
    leaveBy: string | null;
    delayed: boolean;
    delayMin: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [, setTick] = useState(0);

  const isSaved = savedTrips.some((t) => t.tpc === tpc && t.direction === direction);
  const savedTrip = savedTrips.find((t) => t.tpc === tpc && t.direction === direction);
  const walkTime = savedTrip?.walkTimeMinutes ?? 0;

  useEffect(() => {
    if (!tpc) return;
    let cancelled = false;
    const currentTpc = tpc;

    async function fetchNext() {
      try {
        const params = new URLSearchParams({
          tpc: currentTpc,
          direction: String(direction),
          walkTime: String(walkTime),
        });
        const res = await fetch(`/api/departures?${params}`);
        if (!res.ok) throw new Error();
        const data: DeparturesResponse = await res.json();

        if (cancelled) return;

        const now = Date.now();
        const upcoming = data.departures.find(
          (d) => new Date(d.expectedDeparture).getTime() > now
        );

        if (upcoming) {
          setNextDep({
            expected: upcoming.expectedDeparture,
            leaveBy: upcoming.leaveBy,
            delayed: upcoming.isDelayed,
            delayMin: upcoming.delayMinutes,
          });
        } else {
          setNextDep(null);
        }
      } catch {
        if (!cancelled) setNextDep(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchNext();
    const interval = setInterval(fetchNext, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [tpc, direction, walkTime]);

  // Re-render countdown every 15s
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(interval);
  }, []);

  const directionLabel = direction === 1 ? 'Richting Amsterdam' : 'Richting Zandvoort';

  return (
    <div className="stop-popup">
      <div className="stop-popup-header">
        <strong className="stop-popup-name">{stopName}</strong>
        <button
          className={`stop-popup-save${isSaved ? ' stop-popup-saved' : ''}`}
          onClick={(e) => { e.stopPropagation(); if (isSaved) { onRemove(); } else { onSave(); } }}
          title={isSaved ? 'Halte verwijderen' : 'Halte opslaan'}
        >
          {isSaved ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
          )}
        </button>
      </div>
      <span className="stop-popup-direction">{directionLabel}</span>

      {loading ? (
        <span className="stop-popup-loading">Laden...</span>
      ) : nextDep ? (
        <div className="stop-popup-departure">
          <span className="stop-popup-countdown">
            Volgende bus over <strong>{formatMinutesUntil(nextDep.expected)}</strong>
          </span>
          {nextDep.delayed && (
            <span className="delay-badge">+{nextDep.delayMin} min</span>
          )}
          {nextDep.leaveBy ? (
            <span className="stop-popup-leaveby">
              Vertrek om <strong>{formatTime(nextDep.leaveBy)}</strong>
            </span>
          ) : (
            <span className="stop-popup-time">
              <strong>{formatTime(nextDep.expected)}</strong>
            </span>
          )}
        </div>
      ) : (
        <span className="stop-popup-none">Geen vertrek gepland</span>
      )}
    </div>
  );
}
