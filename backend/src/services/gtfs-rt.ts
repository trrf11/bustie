import protobuf from 'protobufjs';
import { resolve } from 'path';
import { config } from '../config';
import { isKnownRouteId, isKnownTripId } from './gtfs-static';

export interface VehiclePosition {
  vehicleId: string;
  tripId: string;
  routeId: string;
  directionId: number | null;
  latitude: number;
  longitude: number;
  delaySeconds: number;
  currentStatus: string;
  stopId: string;
  timestamp: string;
}

let gtfsRoot: protobuf.Root | null = null;
let FeedMessage: protobuf.Type | null = null;

async function ensureProtoLoaded(): Promise<void> {
  if (gtfsRoot) return;

  gtfsRoot = await protobuf.load([
    resolve(__dirname, '../proto/gtfs-realtime.proto'),
    resolve(__dirname, '../proto/gtfs-realtime-OVapi.proto'),
  ]);
  FeedMessage = gtfsRoot.lookupType('transit_realtime.FeedMessage');
}

/**
 * Fetch and decode GTFS-RT vehicle positions, filtering for bus 80.
 */
export async function fetchVehiclePositions(): Promise<VehiclePosition[]> {
  await ensureProtoLoaded();
  if (!FeedMessage) throw new Error('Protobuf not loaded');

  const res = await fetch(config.gtfsRtVehiclePositionsUrl, {
    headers: {
      'User-Agent': config.userAgent,
      'Accept-Encoding': 'gzip',
    },
  });

  if (!res.ok) {
    throw new Error(`GTFS-RT returned ${res.status}`);
  }

  const buffer = await res.arrayBuffer();
  const feed = FeedMessage.decode(new Uint8Array(buffer)) as any;

  const vehicles: VehiclePosition[] = [];

  for (const entity of feed.entity || []) {
    const vp = entity.vehicle;
    if (!vp) continue;

    const trip = vp.trip;
    if (!trip) continue;

    const routeId = trip.routeId || '';
    const tripId = trip.tripId || '';
    const directionId = typeof trip.directionId === 'number' ? trip.directionId : null;

    // Filter for bus 80 using our dynamic lookup
    if (!isKnownRouteId(routeId) && !isKnownTripId(tripId)) continue;

    const position = vp.position;
    if (!position) continue;

    // Extract OVapi delay extension (field 1003)
    let delaySeconds = 0;
    const ovapiExt = vp['.transit_realtime.ovapiVehiclePosition'];
    if (ovapiExt && typeof ovapiExt.delay === 'number') {
      delaySeconds = ovapiExt.delay;
    }

    // Map currentStatus enum
    let statusStr = 'UNKNOWN';
    const status = vp.currentStatus;
    if (status === 0 || status === 'INCOMING_AT') statusStr = 'INCOMING_AT';
    else if (status === 1 || status === 'STOPPED_AT') statusStr = 'STOPPED_AT';
    else if (status === 2 || status === 'IN_TRANSIT_TO') statusStr = 'IN_TRANSIT_TO';

    const timestamp = vp.timestamp
      ? new Date(
          (typeof vp.timestamp === 'number' ? vp.timestamp : parseInt(vp.timestamp, 10)) * 1000
        ).toISOString()
      : new Date().toISOString();

    vehicles.push({
      vehicleId: vp.vehicle?.id || vp.vehicle?.label || 'unknown',
      tripId,
      routeId,
      directionId,
      latitude: position.latitude,
      longitude: position.longitude,
      delaySeconds,
      currentStatus: statusStr,
      stopId: vp.stopId || '',
      timestamp,
    });
  }

  return vehicles;
}
