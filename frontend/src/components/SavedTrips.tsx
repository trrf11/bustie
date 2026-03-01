import { useState, useEffect, useRef, useCallback } from 'react';
import type { SavedTrip, DeparturesResponse } from '../types';

interface SavedTripsProps {
  trips: SavedTrip[];
  onRemove: (id: string) => void;
  onUpdateWalkTime: (id: string, walkTimeMinutes: number) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onSelectStop?: (trip: SavedTrip) => void;
}

const WALK_TIME_PRESETS = [5, 10, 15];

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

function SavedTripCard({ trip, index, onRemove, onUpdateWalkTime, onSelect, dragHandleProps }: {
  trip: SavedTrip;
  index: number;
  onRemove: () => void;
  onUpdateWalkTime: (walkTime: number) => void;
  onSelect?: () => void;
  dragHandleProps: {
    onPointerDown: (e: React.PointerEvent) => void;
    onTouchStart: (e: React.TouchEvent) => void;
  };
}) {
  const [upcomingDeps, setUpcomingDeps] = useState<{
    expected: string;
    delayed: boolean;
    delayMin: number;
    leaveBy: string | null;
  }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showWalkTimePicker, setShowWalkTimePicker] = useState(false);
  const [customWalkTime, setCustomWalkTime] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchNext() {
      try {
        const params = new URLSearchParams({
          tpc: trip.tpc,
          direction: String(trip.direction),
          walkTime: String(trip.walkTimeMinutes),
        });
        const res = await fetch(`/api/departures?${params}`);
        if (!res.ok) throw new Error();
        const data: DeparturesResponse = await res.json();

        if (cancelled) return;

        const now = Date.now();
        const upcoming = data.departures
          .filter((d) => d.source === 'realtime' || new Date(d.expectedDeparture).getTime() > now)
          .slice(0, 5)
          .map((d) => ({
            expected: d.expectedDeparture,
            delayed: d.isDelayed,
            delayMin: d.delayMinutes,
            leaveBy: d.leaveBy,
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
  }, [trip.tpc, trip.direction, trip.walkTimeMinutes]);

  // Re-render countdown every 15s
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(interval);
  }, []);

  function handlePresetSelect(minutes: number) {
    onUpdateWalkTime(minutes);
    setShowWalkTimePicker(false);
    setShowCustomInput(false);
  }

  function handleCustomSubmit() {
    const val = parseInt(customWalkTime, 10);
    if (!isNaN(val) && val >= 0 && val <= 60) {
      // Dismiss keyboard before updating state to prevent viewport corruption
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      onUpdateWalkTime(val);
      setShowWalkTimePicker(false);
      setShowCustomInput(false);
    }
  }

  const firstDep = upcomingDeps[0] ?? null;

  return (
    <div className="saved-trip-card" data-index={index} onClick={onSelect} style={{ cursor: onSelect ? 'pointer' : undefined }}>
      <div className="saved-trip-row">
        <div
          className="drag-handle"
          data-vaul-no-drag
          {...dragHandleProps}
          onClick={(e) => e.stopPropagation()}
        >
          <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
            <circle cx="2" cy="2" r="1.5" />
            <circle cx="8" cy="2" r="1.5" />
            <circle cx="2" cy="8" r="1.5" />
            <circle cx="8" cy="8" r="1.5" />
            <circle cx="2" cy="14" r="1.5" />
            <circle cx="8" cy="14" r="1.5" />
          </svg>
        </div>

        <div className="saved-trip-content">
          {/* Header: stop name + badge + remove */}
          <div className="saved-trip-header">
            <div className="saved-trip-header-left">
              <div className="saved-trip-stop">{stripCity(trip.stopName)}</div>
              <span className="saved-trip-direction">{trip.directionLabel}</span>
            </div>
            <div className="saved-trip-header-right">
              {!loading && firstDep && (
                <span className={`saved-trip-badge${firstDep.delayed ? ' saved-trip-badge--delayed' : ''}`}>
                  {formatMinutesUntil(firstDep.expected)}
                </span>
              )}
              <button
                className="saved-trip-remove"
                onClick={(e) => { e.stopPropagation(); onRemove(); }}
                title="Verwijderen"
              >
                &times;
              </button>
            </div>
          </div>

          <div className="saved-trip-divider" />

          {/* Departure times row */}
          {loading ? (
            <span className="saved-trip-loading">Laden...</span>
          ) : upcomingDeps.length > 0 ? (
            <>
              {firstDep.leaveBy ? (
                <>
                  <span className="saved-trip-leaveby">
                    🚶 Vertrek om <strong>{formatTime(firstDep.leaveBy)}</strong>
                  </span>
                  <div className="saved-trip-divider" />
                </>
              ) : null}
              <div className="saved-trip-times">
                {upcomingDeps.map((dep, i) => (
                  <span key={i} className={`saved-trip-time-item${dep.delayed ? ' saved-trip-time-delayed' : ''}`}>
                    {dep.delayed && <span className="time-scheduled">{scheduledTime(dep.expected, dep.delayMin)}</span>}
                    <span className={dep.delayed ? 'time-actual' : ''}>{formatTime(dep.expected)}</span>
                  </span>
                ))}
              </div>
            </>
          ) : (
            <span className="saved-trip-none">Geen vertrek</span>
          )}

          {/* Walk time button — centered */}
          <button
            className="saved-trip-walktime"
            onClick={(e) => {
              e.stopPropagation();
              setShowWalkTimePicker(!showWalkTimePicker);
              setShowCustomInput(false);
            }}
          >
            {trip.walkTimeMinutes > 0 ? `Looptijd: ${trip.walkTimeMinutes} min` : 'Looptijd toevoegen'}
          </button>

          {/* Walk time quick-pick chips */}
          {showWalkTimePicker && (
            <div className="walktime-picker" data-vaul-no-drag onClick={(e) => e.stopPropagation()}>
              <div className="walktime-chips">
                {WALK_TIME_PRESETS.map((min) => (
                  <button
                    key={min}
                    className={`walktime-chip${trip.walkTimeMinutes === min && !showCustomInput ? ' walktime-chip-active' : ''}`}
                    onClick={() => handlePresetSelect(min)}
                  >
                    {min}
                  </button>
                ))}
                <button
                  className={`walktime-chip walktime-chip-other${showCustomInput ? ' walktime-chip-active' : ''}`}
                  onClick={() => {
                    setShowCustomInput(true);
                    setCustomWalkTime('');
                  }}
                >
                  Anders
                </button>
                {trip.walkTimeMinutes > 0 && (
                  <button
                    className="walktime-chip walktime-chip-remove walktime-chip-remove-right"
                    onClick={() => handlePresetSelect(0)}
                  >
                    &times;
                  </button>
                )}
              </div>
              {showCustomInput && (
                <div className="walktime-custom">
                  <input
                    type="number"
                    min="0"
                    max="60"
                    placeholder="min"
                    value={customWalkTime}
                    onChange={(e) => setCustomWalkTime(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleCustomSubmit(); }}
                    autoFocus
                    className="walktime-custom-input"
                  />
                  <button className="walktime-custom-ok" onClick={handleCustomSubmit}>OK</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function SavedTrips({ trips, onRemove, onUpdateWalkTime, onReorder, onSelectStop }: SavedTripsProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const cardRects = useRef<DOMRect[]>([]);

  const startDrag = useCallback((index: number, clientY: number) => {
    setDragIndex(index);
    setOverIndex(index);
    dragStartY.current = clientY;

    // Snapshot card positions
    if (listRef.current) {
      const cards = listRef.current.querySelectorAll('.saved-trip-card');
      cardRects.current = Array.from(cards).map((c) => c.getBoundingClientRect());
    }
  }, []);

  const handlePointerDown = useCallback((index: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    startDrag(index, e.clientY);
  }, [startDrag]);

  const handleTouchStart = useCallback((index: number) => (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      startDrag(index, e.touches[0].clientY);
    }
  }, [startDrag]);

  useEffect(() => {
    if (dragIndex === null) return;

    function onMove(clientY: number) {
      const rects = cardRects.current;
      for (let i = 0; i < rects.length; i++) {
        const mid = rects[i].top + rects[i].height / 2;
        if (clientY < mid) {
          setOverIndex(i);
          return;
        }
      }
      setOverIndex(rects.length - 1);
    }

    function onPointerMove(e: PointerEvent) {
      e.preventDefault();
      onMove(e.clientY);
    }

    function onTouchMove(e: TouchEvent) {
      if (e.touches.length === 1) {
        e.preventDefault();
        onMove(e.touches[0].clientY);
      }
    }

    function onEnd() {
      if (dragIndex !== null && overIndex !== null && dragIndex !== overIndex) {
        onReorder(dragIndex, overIndex);
      }
      setDragIndex(null);
      setOverIndex(null);
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [dragIndex, overIndex, onReorder]);

  if (trips.length === 0) {
    return (
      <div className="saved-trips-empty">
        <p>Tik op een halte op de kaart om vertrektijden te zien.</p>
        <p className="saved-trips-hint">Je kunt haltes opslaan voor snelle toegang.</p>
      </div>
    );
  }

  return (
    <div className="saved-trips">
      <h3 className="saved-trips-title">Mijn haltes</h3>
      <div className="saved-trips-list" ref={listRef}>
        {trips.map((trip, i) => (
          <div
            key={trip.id}
            className={`saved-trip-wrapper${dragIndex === i ? ' dragging' : ''}${overIndex === i && dragIndex !== null && dragIndex !== i ? ' drag-over' : ''}`}
          >
            <SavedTripCard
              trip={trip}
              index={i}
              onRemove={() => onRemove(trip.id)}
              onUpdateWalkTime={(wt) => onUpdateWalkTime(trip.id, wt)}
              onSelect={onSelectStop ? () => onSelectStop(trip) : undefined}
              dragHandleProps={{
                onPointerDown: handlePointerDown(i),
                onTouchStart: handleTouchStart(i),
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
