import { memo, useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle, useCallback } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { StopPopup } from './StopPopup';
import type { VehiclesResponse, StopInfo, SavedTrip } from '../types';
import type { DirectionFilterValue } from './DirectionFilter';
import 'leaflet/dist/leaflet.css';

// Bus marker icons — bus80.png faces LEFT by default (towards Zandvoort).
// Direction 1 (→ Amsterdam) needs the flipped (right-facing) version.
// Direction 2 (→ Zandvoort) uses the original (left-facing) image.
// Icons are sized dynamically based on zoom level.
const BASE_ZOOM = 12;
const BASE_ICON_SIZE = 40;
const MIN_ICON_SIZE = 32;
const MAX_ICON_SIZE = 56;

function getBusIconSize(zoom: number): number {
  // Scale gently: ~4px per zoom level
  const size = BASE_ICON_SIZE + (zoom - BASE_ZOOM) * 4;
  return Math.max(MIN_ICON_SIZE, Math.min(MAX_ICON_SIZE, size));
}

function createBusIcon(direction: number, size: number): L.DivIcon {
  const flipped = direction === 1;
  return new L.DivIcon({
    className: 'bus-marker',
    html: `<img src="/bus80.png" class="bus-marker-img${flipped ? ' bus-marker-img-flipped' : ''}">`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

// Stop marker icon — 14px dot with generous tap area
const stopIcon = new L.DivIcon({
  className: 'stop-marker',
  html: `<div class="stop-icon"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
  popupAnchor: [0, -8],
});

// Center of the bus 80 route (roughly between Haarlem and Amsterdam)
const DEFAULT_CENTER: [number, number] = [52.375, 4.7];
const DEFAULT_ZOOM = 12;

export interface BusMapHandle {
  flyToStop: (stopName: string, direction: number) => void;
}

interface BusMapProps {
  data: VehiclesResponse | null;
  directionFilter: DirectionFilterValue;
  savedTrips: SavedTrip[];
  tpcMap: Record<string, string>;
  onSaveStop: (stop: StopInfo, direction: number) => void;
  onRemoveStop: (tpc: string, direction: number) => void;
}

function FitBounds({ data }: { data: VehiclesResponse | null }) {
  const map = useMap();
  const hasFitted = useRef(false);

  useEffect(() => {
    if (!data || hasFitted.current) return;

    const allPoints: [number, number][] = [];

    // Add vehicle positions
    data.vehicles.forEach((v) => allPoints.push([v.latitude, v.longitude]));

    // Add route shape points for bounds
    if (data.route.direction1.shape.length > 0) {
      allPoints.push(data.route.direction1.shape[0]);
      allPoints.push(data.route.direction1.shape[data.route.direction1.shape.length - 1]);
    }
    if (data.route.direction2.shape.length > 0) {
      allPoints.push(data.route.direction2.shape[0]);
      allPoints.push(data.route.direction2.shape[data.route.direction2.shape.length - 1]);
    }

    if (allPoints.length > 1) {
      // On mobile, the bottom sheet covers ~45% of the viewport.
      // Add extra bottom padding so the map content centers above the sheet.
      const isMobile = window.innerWidth < 768;
      const bottomPad = isMobile ? Math.round(window.innerHeight * 0.45) : 30;
      map.fitBounds(allPoints, { paddingTopLeft: [30, 30], paddingBottomRight: [30, bottomPad] });
      hasFitted.current = true;
    }
  }, [map, data]);

  return null;
}

/**
 * Animated bus marker — smoothly interpolates position updates via
 * Leaflet's setLatLng() + requestAnimationFrame. This avoids CSS
 * transitions on the marker wrapper (which break during zoom because
 * Leaflet uses the same CSS transform for repositioning).
 */
const EASE_DURATION = 1000; // ms

function AnimatedBusMarker({ vehicle, icon }: { vehicle: VehiclesResponse['vehicles'][0]; icon: L.DivIcon }) {
  const markerRef = useRef<L.Marker | null>(null);
  const animRef = useRef<number | null>(null);

  useEffect(() => {
    const marker = markerRef.current;
    if (!marker) return;

    const target = L.latLng(vehicle.latitude, vehicle.longitude);
    const start = marker.getLatLng();

    // Skip animation if marker hasn't moved (or first render)
    if (start.lat === target.lat && start.lng === target.lng) return;

    // Cancel any running animation
    if (animRef.current) cancelAnimationFrame(animRef.current);

    // Capture non-null reference for the animation closure
    const m = marker;
    const startTime = performance.now();

    function animate(now: number) {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / EASE_DURATION, 1);
      // Ease-in-out cubic
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

      const lat = start.lat + (target.lat - start.lat) * ease;
      const lng = start.lng + (target.lng - start.lng) * ease;
      m.setLatLng([lat, lng]);

      if (t < 1) {
        animRef.current = requestAnimationFrame(animate);
      }
    }

    animRef.current = requestAnimationFrame(animate);

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [vehicle.latitude, vehicle.longitude]);

  return (
    <Marker
      ref={markerRef}
      position={[vehicle.latitude, vehicle.longitude]}
      icon={icon}
    >
      <Popup>
        {vehicle.direction === 1 ? 'Richting Amsterdam' : vehicle.direction === 2 ? 'Richting Zandvoort' : 'Onbekende richting'}
        <br />
        {vehicle.delaySeconds > 0
          ? <span className="bus-popup-delayed">{Math.round(vehicle.delaySeconds / 60)} min vertraagd</span>
          : <span className="bus-popup-ontime">Op tijd</span>}
      </Popup>
    </Marker>
  );
}

/**
 * Isolated bus vehicle markers — only this component re-renders on zoom
 * changes, keeping Polylines and stop Markers stable during pinch-zoom.
 * Listens to `zoomend` (fires once after gesture) instead of `zoom`
 * (fires every frame) to avoid fighting Leaflet's internal animation.
 */
function BusVehicleMarkers({ vehicles }: { vehicles: VehiclesResponse['vehicles'] }) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());

  useMapEvents({
    zoomend() {
      setZoom(map.getZoom());
    },
  });

  const busIcons = useMemo(() => {
    const size = getBusIconSize(zoom);
    return {
      toAmsterdam: createBusIcon(1, size),
      toZandvoort: createBusIcon(2, size),
    };
  }, [zoom]);

  return (
    <>
      {vehicles.map((vehicle) => (
        <AnimatedBusMarker
          key={vehicle.vehicleId}
          vehicle={vehicle}
          icon={vehicle.direction === 1 ? busIcons.toAmsterdam : busIcons.toZandvoort}
        />
      ))}
    </>
  );
}

/** Captures the Leaflet map instance into a ref so it can be used imperatively from outside. */
function MapInstanceCapture({ mapRef }: { mapRef: React.MutableRefObject<L.Map | null> }) {
  const map = useMap();
  mapRef.current = map;
  return null;
}

/**
 * Stop markers for one direction — memoized so they never re-render when
 * only vehicle data changes. This prevents open popups from being closed
 * by the 15-second vehicle poll cycle.
 */
const StopMarkerLayer = memo(function StopMarkerLayer({
  stops,
  direction,
  savedTrips,
  tpcMap,
  onSaveStop,
  onRemoveStop,
  stopMarkerRefs,
}: {
  stops: StopInfo[];
  direction: number;
  savedTrips: SavedTrip[];
  tpcMap: Record<string, string>;
  onSaveStop: (stop: StopInfo, direction: number) => void;
  onRemoveStop: (tpc: string, direction: number) => void;
  stopMarkerRefs: React.MutableRefObject<Map<string, L.Marker>>;
}) {
  // Stable ref callbacks — created once per stop, reused across renders
  const refCallbacks = useRef(new Map<string, (m: L.Marker | null) => void>());

  function getRefCallback(key: string) {
    let cb = refCallbacks.current.get(key);
    if (!cb) {
      cb = (m: L.Marker | null) => {
        if (m) stopMarkerRefs.current.set(key, m);
        else stopMarkerRefs.current.delete(key);
      };
      refCallbacks.current.set(key, cb);
    }
    return cb;
  }

  function getTpc(stop: StopInfo): string | null {
    return tpcMap[`${direction}:${stop.name}`] || null;
  }

  return (
    <>
      {stops.map((stop) => (
        <Marker
          key={`d${direction}-${stop.stopId}`}
          position={[stop.latitude, stop.longitude]}
          icon={stopIcon}
          ref={getRefCallback(`${direction}:${stop.stopId}`)}
        >
          <Popup>
            <StopPopup
              stopName={stop.name}
              tpc={getTpc(stop)}
              direction={direction}
              savedTrips={savedTrips}
              onSave={() => onSaveStop(stop, direction)}
              onRemove={() => { const t = getTpc(stop); if (t) onRemoveStop(t, direction); }}
            />
          </Popup>
        </Marker>
      ))}
    </>
  );
});

function MapContent({ data, directionFilter, savedTrips, tpcMap, onSaveStop, onRemoveStop, mapRef, stopMarkerRefs }: BusMapProps & {
  mapRef: React.MutableRefObject<L.Map | null>;
  stopMarkerRefs: React.MutableRefObject<Map<string, L.Marker>>;
}) {
  const dir1Active = directionFilter === 'all' || directionFilter === 1;
  const dir2Active = directionFilter === 'all' || directionFilter === 2;

  // Route data is static across polls — stabilise references so stop
  // markers don't re-render when only vehicles change.
  const dir1Stops = useMemo(
    () => data?.route.direction1.stops ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data?.route.direction1.stops?.length],
  );
  const dir2Stops = useMemo(
    () => data?.route.direction2.stops ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data?.route.direction2.stops?.length],
  );
  const dir1Shape = useMemo(
    () => data?.route.direction1.shape ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data?.route.direction1.shape?.length],
  );
  const dir2Shape = useMemo(
    () => data?.route.direction2.shape ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data?.route.direction2.shape?.length],
  );

  const filteredVehicles = useMemo(() => {
    if (!data) return [];
    if (directionFilter === 'all') return data.vehicles;
    return data.vehicles.filter((v) => v.direction === directionFilter);
  }, [data, directionFilter]);

  return (
    <>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <FitBounds data={data} />
      <MapInstanceCapture mapRef={mapRef} />

      {/* Route polylines — hidden when direction inactive */}
      {dir1Active && dir1Shape.length > 0 && (
        <Polyline positions={dir1Shape} color="#006772" weight={4} opacity={0.7} />
      )}
      {dir2Active && dir2Shape.length > 0 && (
        <Polyline positions={dir2Shape} color="#dc2626" weight={4} opacity={0.7} />
      )}

      {/* Stop markers — memoized per direction to survive vehicle polls */}
      {dir1Active && (
        <StopMarkerLayer
          stops={dir1Stops}
          direction={1}
          savedTrips={savedTrips}
          tpcMap={tpcMap}
          onSaveStop={onSaveStop}
          onRemoveStop={onRemoveStop}
          stopMarkerRefs={stopMarkerRefs}
        />
      )}
      {dir2Active && (
        <StopMarkerLayer
          stops={dir2Stops}
          direction={2}
          savedTrips={savedTrips}
          tpcMap={tpcMap}
          onSaveStop={onSaveStop}
          onRemoveStop={onRemoveStop}
          stopMarkerRefs={stopMarkerRefs}
        />
      )}

      {/* Bus vehicle markers — isolated to prevent zoom jitter */}
      <BusVehicleMarkers vehicles={filteredVehicles} />
    </>
  );
}

export const BusMap = forwardRef<BusMapHandle, BusMapProps>(
  function BusMap(props, ref) {
    const mapRef = useRef<L.Map | null>(null);
    const stopMarkerRefs = useRef<Map<string, L.Marker>>(new Map());
    const dataRef = useRef(props.data);
    dataRef.current = props.data;

    const flyToStop = useCallback((stopName: string, direction: number) => {
      const map = mapRef.current;
      const data = dataRef.current;
      if (!map || !data) return;

      const dirData = direction === 1 ? data.route.direction1 : data.route.direction2;
      const stop = dirData.stops.find((s) => s.name === stopName);
      if (!stop) return;

      map.flyTo([stop.latitude, stop.longitude], 13.5, { duration: 0.8 });

      // Open popup after fly animation completes
      const key = `${direction}:${stop.stopId}`;
      setTimeout(() => {
        const marker = stopMarkerRefs.current.get(key);
        if (marker) marker.openPopup();
      }, 900);
    }, []);

    useImperativeHandle(ref, () => ({ flyToStop }), [flyToStop]);

    return (
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        className="bus-map"
        zoomControl={false}
      >
        <MapContent {...props} mapRef={mapRef} stopMarkerRefs={stopMarkerRefs} />
      </MapContainer>
    );
  }
);
