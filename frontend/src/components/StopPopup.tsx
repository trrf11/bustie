import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import type { DeparturesResponse, SavedTrip } from '../types';

interface StopPopupProps {
  stopName: string;
  tpc: string | null;
  direction: number;
  savedTrips: SavedTrip[];
  onSave: () => void;
  onRemove: () => void;
}

function stripCity(name: string): string {
  const idx = name.indexOf(', ');
  return idx >= 0 ? name.substring(idx + 2) : name;
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

function scheduledTime(expected: string, delayMin: number): string {
  const d = new Date(expected);
  d.setMinutes(d.getMinutes() - delayMin);
  return formatTime(d.toISOString());
}

export function StopPopup({ stopName, tpc, direction, savedTrips, onSave }: StopPopupProps) {
  const [upcomingDeps, setUpcomingDeps] = useState<{
    expected: string;
    leaveBy: string | null;
    delayed: boolean;
    delayMin: number;
  }[]>([]);
  const [loading, setLoading] = useState(true);
  const [, setTick] = useState(0);
  const [selectedDepIndex, setSelectedDepIndex] = useState(0);
  const calloutRef = useRef<HTMLDivElement>(null);
  const timeItemRefs = useRef<(HTMLSpanElement | null)[]>([]);

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
        const upcoming = data.departures
          .filter((d) => d.source === 'realtime' || new Date(d.expectedDeparture).getTime() > now)
          .slice(0, 3)
          .map((d) => ({
            expected: d.expectedDeparture,
            leaveBy: d.leaveBy,
            delayed: d.isDelayed,
            delayMin: d.delayMinutes,
          }));
        setUpcomingDeps(upcoming);
      } catch {
        if (!cancelled) setUpcomingDeps([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchNext();
    const interval = setInterval(fetchNext, 30_000);

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') fetchNext();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [tpc, direction, walkTime]);

  // Re-render countdown every 15s
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(interval);
  }, []);

  // Reset selection when departures refresh
  useEffect(() => {
    setSelectedDepIndex(0);
  }, [upcomingDeps]);

  // Position the chevron under the selected time item
  const setTimeItemRef = useCallback((index: number) => (el: HTMLSpanElement | null) => {
    timeItemRefs.current[index] = el;
  }, []);

  useLayoutEffect(() => {
    const callout = calloutRef.current;
    const item = timeItemRefs.current[selectedDepIndex];
    if (!callout || !item) return;
    const calloutRect = callout.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const center = itemRect.left + itemRect.width / 2 - calloutRect.left;
    callout.style.setProperty('--chevron-left', `${center}px`);
  }, [selectedDepIndex, upcomingDeps]);

  const directionLabel = direction === 1 ? 'Richting Amsterdam' : 'Richting Zandvoort';
  const firstDep = upcomingDeps[0] ?? null;
  const selectedDep = upcomingDeps[selectedDepIndex] ?? firstDep;

  return (
    <div className="stop-popup">
      <div className="stop-popup-header">
        <div className="stop-popup-header-left">
          <strong className="stop-popup-name">{stripCity(stopName)}</strong>
          <span className="stop-popup-direction">{directionLabel}</span>
        </div>
        {!loading && firstDep && (
          <span className={`stop-popup-badge${firstDep.delayed ? ' stop-popup-badge--delayed' : ''}`}>
            {formatMinutesUntil(firstDep.expected)}
          </span>
        )}
      </div>

      <div className="stop-popup-divider" />

      {loading ? (
        <span className="stop-popup-loading">Laden...</span>
      ) : upcomingDeps.length > 0 ? (
        <>
          <div className="stop-popup-times">
            {upcomingDeps.map((dep, i) => (
              <span
                key={i}
                ref={setTimeItemRef(i)}
                className={`stop-popup-time-item${dep.delayed ? ' stop-popup-time-delayed' : ''}${walkTime > 0 ? ' stop-popup-time-selectable' : ''}${walkTime > 0 && i === selectedDepIndex ? ' stop-popup-time-selected' : ''}`}
                onClick={walkTime > 0 ? () => setSelectedDepIndex(i) : undefined}
              >
                {dep.delayed && <span className="time-scheduled">{scheduledTime(dep.expected, dep.delayMin)}</span>}
                <span className={dep.delayed ? 'time-actual' : ''}>{formatTime(dep.expected)}</span>
              </span>
            ))}
          </div>

          {selectedDep?.leaveBy ? (
            <div className="stop-popup-callout" ref={calloutRef}>
              <div className="stop-popup-callout-chevron" />
              <span className="stop-popup-leaveby">
                🚶 Vertrek om {formatTime(selectedDep.leaveBy)}
              </span>
            </div>
          ) : null}
        </>
      ) : (
        <span className="stop-popup-none">Geen vertrek gepland</span>
      )}

      {!isSaved && (
        <button
          className="stop-popup-action"
          onClick={(e) => { e.stopPropagation(); onSave(); }}
        >
          Toevoegen aan mijn haltes
        </button>
      )}
    </div>
  );
}
