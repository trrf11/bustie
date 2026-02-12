import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { StopPopup } from './StopPopup';
import type { VehiclesResponse, StopInfo, SavedTrip } from '../types';
import type { DirectionFilterValue } from './DirectionFilter';
import 'leaflet/dist/leaflet.css';

// Bus marker icons — bus80.png faces LEFT by default (towards Zandvoort).
// Direction 1 (→ Amsterdam) needs the flipped (right-facing) version.
// Direction 2 (→ Zandvoort) uses the original (left-facing) image.
// Uses L.DivIcon so the <img> is a child element — Leaflet's inline transform on the
// wrapper div won't overwrite our scaleX(-1) on the img.
const busIconToAmsterdam = new L.DivIcon({
  className: 'bus-marker bus-marker-animated',
  html: '<img src="/bus80.png" class="bus-marker-img bus-marker-img-flipped">',
  iconSize: [40, 40],
  iconAnchor: [20, 20],
  popupAnchor: [0, -20],
});

const busIconToZandvoort = new L.DivIcon({
  className: 'bus-marker bus-marker-animated',
  html: '<img src="/bus80.png" class="bus-marker-img">',
  iconSize: [40, 40],
  iconAnchor: [20, 20],
  popupAnchor: [0, -20],
});

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

interface BusMapProps {
  data: VehiclesResponse | null;
  directionFilter: DirectionFilterValue;
  savedTrips: SavedTrip[];
  tpcMap: Record<string, string>;
  onSaveStop: (stop: StopInfo, direction: number) => void;
}

function FitBounds({ data }: { data: VehiclesResponse | null }) {
  const map = useMap();

  useEffect(() => {
    if (!data) return;

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
      map.fitBounds(allPoints, { padding: [30, 30] });
    }
  }, [map, data?.route.direction1.shape.length]);

  return null;
}

export function BusMap({ data, directionFilter, savedTrips, tpcMap, onSaveStop }: BusMapProps) {
  const dir1Active = directionFilter === 'all' || directionFilter === 1;
  const dir2Active = directionFilter === 'all' || directionFilter === 2;

  const filteredVehicles = useMemo(() => {
    if (!data) return [];
    if (directionFilter === 'all') return data.vehicles;
    return data.vehicles.filter((v) => v.direction === directionFilter);
  }, [data, directionFilter]);

  function getTpc(stop: StopInfo, direction: number): string | null {
    return tpcMap[`${direction}:${stop.name}`] || null;
  }

  return (
    <MapContainer
      center={DEFAULT_CENTER}
      zoom={DEFAULT_ZOOM}
      className="bus-map"
      zoomControl={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <FitBounds data={data} />

      {/* Route polylines — hidden when direction inactive */}
      {dir1Active && data?.route.direction1.shape && data.route.direction1.shape.length > 0 && (
        <Polyline
          positions={data.route.direction1.shape}
          color="#006772"
          weight={4}
          opacity={0.7}
        />
      )}
      {dir2Active && data?.route.direction2.shape && data.route.direction2.shape.length > 0 && (
        <Polyline
          positions={data.route.direction2.shape}
          color="#dc2626"
          weight={4}
          opacity={0.7}
        />
      )}

      {/* Stop markers - Direction 1 */}
      {dir1Active && data?.route.direction1.stops.map((stop) => (
        <Marker
          key={`d1-${stop.stopId}`}
          position={[stop.latitude, stop.longitude]}
          icon={stopIcon}
        >
          <Popup>
            <StopPopup
              stopName={stop.name}
              tpc={getTpc(stop, 1)}
              direction={1}
              savedTrips={savedTrips}
              onSave={() => onSaveStop(stop, 1)}
            />
          </Popup>
        </Marker>
      ))}

      {/* Stop markers - Direction 2 */}
      {dir2Active && data?.route.direction2.stops.map((stop) => (
        <Marker
          key={`d2-${stop.stopId}`}
          position={[stop.latitude, stop.longitude]}
          icon={stopIcon}
        >
          <Popup>
            <StopPopup
              stopName={stop.name}
              tpc={getTpc(stop, 2)}
              direction={2}
              savedTrips={savedTrips}
              onSave={() => onSaveStop(stop, 2)}
            />
          </Popup>
        </Marker>
      ))}

      {/* Bus vehicle markers */}
      {filteredVehicles.map((vehicle) => (
        <Marker
          key={vehicle.vehicleId}
          position={[vehicle.latitude, vehicle.longitude]}
          icon={vehicle.direction === 1 ? busIconToAmsterdam : busIconToZandvoort}
        >
          <Popup>
            <strong>Bus 80</strong> #{vehicle.vehicleId}
            <br />
            {vehicle.direction === 1 ? 'Richting Amsterdam' : vehicle.direction === 2 ? 'Richting Zandvoort' : 'Onbekende richting'}
            <br />
            {vehicle.delaySeconds > 0
              ? `${Math.round(vehicle.delaySeconds / 60)} min vertraging`
              : 'Op tijd'}
            <br />
            <small>{vehicle.currentStatus}</small>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
