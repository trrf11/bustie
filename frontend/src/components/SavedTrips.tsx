import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import type { SavedTrip, DeparturesResponse } from '../types';
import type { AlertConfig } from '../hooks/useAlerts';
import type { PushState } from '../hooks/usePushNotifications';

interface SavedTripsProps {
  trips: SavedTrip[];
  onRemove: (id: string) => void;
  onUpdateWalkTime: (id: string, walkTimeMinutes: number) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onSelectStop?: (trip: SavedTrip) => void;
  pushState: PushState;
  getAlertForStop: (tpc: string, direction: number) => AlertConfig | undefined;
  onSaveAlert: (alert: AlertConfig) => Promise<void>;
  onDeleteAlert: (tpc: string, direction: number) => Promise<void>;
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

const DAY_LABELS = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'];
const DEFAULT_DAYS = [1, 2, 3, 4, 5];
const MAX_WALK_TIME = 45;

function SavedTripCard({ trip, index, onRemove, onUpdateWalkTime, onSelect, dragHandleProps, pushState, alert, onSaveAlert, onDeleteAlert }: {
  trip: SavedTrip;
  index: number;
  onRemove: () => void;
  onUpdateWalkTime: (walkTime: number) => void;
  onSelect?: () => void;
  dragHandleProps: {
    onPointerDown: (e: React.PointerEvent) => void;
    onTouchStart: (e: React.TouchEvent) => void;
  };
  pushState: PushState;
  alert: AlertConfig | undefined;
  onSaveAlert: (alert: AlertConfig) => Promise<void>;
  onDeleteAlert: (tpc: string, direction: number) => Promise<void>;
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
  const [showAlertConfig, setShowAlertConfig] = useState(false);
  const [selectedDepIndex, setSelectedDepIndex] = useState(0);
  const calloutRef = useRef<HTMLDivElement>(null);
  const timeItemRefs = useRef<(HTMLSpanElement | null)[]>([]);

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

  function handlePresetSelect(minutes: number) {
    onUpdateWalkTime(minutes);
    setShowWalkTimePicker(false);
    setShowCustomInput(false);
  }

  function handleCustomSubmit() {
    const val = parseInt(customWalkTime, 10);
    if (!isNaN(val) && val >= 0 && val <= MAX_WALK_TIME) {
      // Dismiss keyboard before updating state to prevent viewport corruption
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      onUpdateWalkTime(val);
      setShowWalkTimePicker(false);
      setShowCustomInput(false);
    }
  }

  const firstDep = upcomingDeps[0] ?? null;
  const selectedDep = upcomingDeps[selectedDepIndex] ?? firstDep;
  const walkTime = trip.walkTimeMinutes;

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
              {pushState === 'subscribed' && (
                <button
                  className={`saved-trip-bell${alert?.enabled ? ' saved-trip-bell--active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!alert) {
                      onSaveAlert({
                        tpc: trip.tpc,
                        direction: trip.direction,
                        stopName: trip.stopName,
                        walkTimeMinutes: trip.walkTimeMinutes,
                        timeWindowStart: '06:00',
                        timeWindowEnd: '22:00',
                        daysOfWeek: DEFAULT_DAYS,
                        enabled: true,
                      });
                      setShowAlertConfig(true);
                    } else {
                      setShowAlertConfig(!showAlertConfig);
                    }
                  }}
                  title="Notificatie"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill={alert?.enabled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                </button>
              )}
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
              <div className="saved-trip-times">
                {upcomingDeps.map((dep, i) => (
                  <span
                    key={i}
                    ref={setTimeItemRef(i)}
                    className={`saved-trip-time-item${dep.delayed ? ' saved-trip-time-delayed' : ''}${walkTime > 0 ? ' saved-trip-time-selectable' : ''}${walkTime > 0 && i === selectedDepIndex ? ' saved-trip-time-selected' : ''}`}
                    onClick={walkTime > 0 ? (e) => { e.stopPropagation(); setSelectedDepIndex(i); } : undefined}
                  >
                    {dep.delayed && <span className="time-scheduled">{scheduledTime(dep.expected, dep.delayMin)}</span>}
                    <span className={dep.delayed ? 'time-actual' : ''}>{formatTime(dep.expected)}</span>
                  </span>
                ))}
              </div>
              {selectedDep?.leaveBy ? (
                <div className="saved-trip-callout" ref={calloutRef}>
                  <div className="saved-trip-callout-chevron" />
                  <div className="saved-trip-leaveby-row">
                    <span className="saved-trip-leaveby">
                      🚶 Vertrek om {formatTime(selectedDep.leaveBy)}
                    </span>
                    <button
                      className="saved-trip-walktime"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowWalkTimePicker(!showWalkTimePicker);
                        setShowCustomInput(false);
                      }}
                    >
                      {`Looptijd: ${trip.walkTimeMinutes} min`}
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <span className="saved-trip-none">Geen vertrek</span>
          )}

          {/* Walk time button — centered, only when no walk time set */}
          {!firstDep?.leaveBy && (
            <>
            <div className="saved-trip-divider" />
            <button
              className="saved-trip-walktime"
              onClick={(e) => {
                e.stopPropagation();
                setShowWalkTimePicker(!showWalkTimePicker);
                setShowCustomInput(false);
              }}
            >
              Looptijd toevoegen
            </button>
            </>
          )}

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
                    max={MAX_WALK_TIME}
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

          {showAlertConfig && alert && (
            <div className="alert-config" data-vaul-no-drag onClick={(e) => e.stopPropagation()}>
              <div className="alert-config-row">
                <label className="alert-toggle-label">
                  <input
                    type="checkbox"
                    checked={alert.enabled}
                    onChange={() => onSaveAlert({ ...alert, enabled: !alert.enabled })}
                  />
                  <span>Meldingen {alert.enabled ? 'aan' : 'uit'}</span>
                </label>
              </div>

              <div className="alert-config-row">
                <span className="alert-config-label">Tijdvenster</span>
                <div className="alert-time-inputs">
                  <input
                    type="time"
                    value={alert.timeWindowStart}
                    onChange={(e) => {
                      const start = e.target.value;
                      const end = start > alert.timeWindowEnd ? start : alert.timeWindowEnd;
                      onSaveAlert({ ...alert, timeWindowStart: start, timeWindowEnd: end });
                    }}
                  />
                  <span>—</span>
                  <input
                    type="time"
                    value={alert.timeWindowEnd}
                    onChange={(e) => {
                      const end = e.target.value;
                      const start = end < alert.timeWindowStart ? end : alert.timeWindowStart;
                      onSaveAlert({ ...alert, timeWindowStart: start, timeWindowEnd: end });
                    }}
                  />
                </div>
              </div>

              <div className="alert-config-row">
                <div className="alert-day-chips">
                  {DAY_LABELS.map((label, i) => {
                    const day = i + 1;
                    const active = alert.daysOfWeek.includes(day);
                    return (
                      <button
                        key={day}
                        className={`alert-day-chip${active ? ' alert-day-chip--active' : ''}`}
                        onClick={() => {
                          const newDays = active
                            ? alert.daysOfWeek.filter((d) => d !== day)
                            : [...alert.daysOfWeek, day].sort();
                          if (newDays.length > 0) {
                            onSaveAlert({ ...alert, daysOfWeek: newDays });
                          }
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="alert-config-row alert-config-info">
                Melding {trip.walkTimeMinutes > 0 ? trip.walkTimeMinutes + 1 : 5} min voor vertrek
              </div>

              <button
                className="alert-config-delete"
                onClick={() => {
                  onDeleteAlert(trip.tpc, trip.direction);
                  setShowAlertConfig(false);
                }}
              >
                Melding verwijderen
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function SavedTrips({ trips, onRemove, onUpdateWalkTime, onReorder, onSelectStop, pushState, getAlertForStop, onSaveAlert, onDeleteAlert }: SavedTripsProps) {
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
              pushState={pushState}
              alert={getAlertForStop(trip.tpc, trip.direction)}
              onSaveAlert={onSaveAlert}
              onDeleteAlert={onDeleteAlert}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
