import { useState, useEffect, useRef, useCallback } from 'react';
import type { SavedTrip, DeparturesResponse } from '../types';

interface SavedTripsProps {
  trips: SavedTrip[];
  onRemove: (id: string) => void;
  onUpdateWalkTime: (id: string, walkTimeMinutes: number) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

const WALK_TIME_PRESETS = [1, 2, 5, 10, 15];

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

function SavedTripCard({ trip, index, onRemove, onUpdateWalkTime, dragHandleProps }: {
  trip: SavedTrip;
  index: number;
  onRemove: () => void;
  onUpdateWalkTime: (walkTime: number) => void;
  dragHandleProps: {
    onPointerDown: (e: React.PointerEvent) => void;
    onTouchStart: (e: React.TouchEvent) => void;
  };
}) {
  const [nextDep, setNextDep] = useState<{
    expected: string;
    delayed: boolean;
    delayMin: number;
    leaveBy: string | null;
  } | null>(null);
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
        const upcoming = data.departures.find(
          (d) => new Date(d.expectedDeparture).getTime() > now
        );

        if (upcoming) {
          setNextDep({
            expected: upcoming.expectedDeparture,
            delayed: upcoming.isDelayed,
            delayMin: upcoming.delayMinutes,
            leaveBy: upcoming.leaveBy,
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
      onUpdateWalkTime(val);
      setShowWalkTimePicker(false);
      setShowCustomInput(false);
    }
  }

  return (
    <div className="saved-trip-card" data-index={index}>
      <div className="saved-trip-row">
        <div
          className="drag-handle"
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
          {/* Top row: stop name + remove button */}
          <div className="saved-trip-header">
            <div className="saved-trip-stop">{trip.stopName}</div>
            <button
              className="saved-trip-remove"
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              title="Verwijderen"
            >
              &times;
            </button>
          </div>

          {/* Meta row: direction tag + countdown */}
          <div className="saved-trip-meta">
            <span className={`saved-trip-direction ${trip.direction === 1 ? 'dir-amsterdam' : 'dir-zandvoort'}`}>
              {trip.directionLabel}
            </span>
            {loading ? (
              <span className="saved-trip-countdown">Laden...</span>
            ) : nextDep ? (
              <span className="saved-trip-countdown">
                Volgende bus over <strong>{formatMinutesUntil(nextDep.expected)}</strong>
                {nextDep.delayed && <span className="delay-badge">+{nextDep.delayMin} min</span>}
              </span>
            ) : (
              <span className="saved-trip-countdown">Geen vertrek</span>
            )}
          </div>

          {/* Walk time + vertrek om grouped together */}
          {nextDep && nextDep.leaveBy ? (
            <div className="saved-trip-walkgroup">
              <button
                className="saved-trip-walktime"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowWalkTimePicker(!showWalkTimePicker);
                  setShowCustomInput(false);
                }}
              >
                🚶 {trip.walkTimeMinutes} min
              </button>
              <span className="saved-trip-leaveby">
                Vertrek om <strong>{formatTime(nextDep.leaveBy)}</strong>
              </span>
            </div>
          ) : (
            <div className="saved-trip-walkgroup">
              <button
                className="saved-trip-walktime"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowWalkTimePicker(!showWalkTimePicker);
                  setShowCustomInput(false);
                }}
              >
                {trip.walkTimeMinutes > 0 ? `🚶 ${trip.walkTimeMinutes} min` : '🚶 Looptijd'}
              </button>
            </div>
          )}

          {/* Walk time quick-pick chips */}
          {showWalkTimePicker && (
            <div className="walktime-picker" onClick={(e) => e.stopPropagation()}>
              <div className="walktime-chips">
                {WALK_TIME_PRESETS.map((min) => (
                  <button
                    key={min}
                    className={`walktime-chip${trip.walkTimeMinutes === min ? ' walktime-chip-active' : ''}`}
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
                  Andere
                </button>
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
              <span className="walktime-label">minuten looptijd</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function SavedTrips({ trips, onRemove, onUpdateWalkTime, onReorder }: SavedTripsProps) {
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
    window.addEventListener('touchmove', onTouchMove, { passive: true });
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
