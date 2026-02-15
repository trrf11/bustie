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
export interface StopTimeUpdate {
  stopId: string;
  stopSequence: number;
  arrivalTime: number | null;  // Unix timestamp
  arrivalDelay: number;        // seconds
  departureTime: number | null;
  departureDelay: number;
}

export interface TripUpdate {
  tripId: string;
  routeId: string;
  directionId: number | null;
  stopTimeUpdates: StopTimeUpdate[];
}

/**
 * Fetch and decode GTFS-RT trip updates, filtering for bus 80.
 */
export async function fetchTripUpdates(): Promise<TripUpdate[]> {
  await ensureProtoLoaded();
  if (!FeedMessage) throw new Error('Protobuf not loaded');

  const res = await fetch(config.gtfsRtTripUpdatesUrl, {
    headers: {
      'User-Agent': config.userAgent,
      'Accept-Encoding': 'gzip',
    },
  });

  if (!res.ok) {
    throw new Error(`GTFS-RT trip updates returned ${res.status}`);
  }

  const buffer = await res.arrayBuffer();
  const feed = FeedMessage.decode(new Uint8Array(buffer)) as any;

  const tripUpdates: TripUpdate[] = [];

  for (const entity of feed.entity || []) {
    const tu = entity.tripUpdate;
    if (!tu) continue;

    const trip = tu.trip;
    if (!trip) continue;

    const routeId = trip.routeId || '';
    const tripId = trip.tripId || '';

    // Filter for bus 80
    if (!isKnownRouteId(routeId) && !isKnownTripId(tripId)) continue;

    const directionId = typeof trip.directionId === 'number' ? trip.directionId : null;

    const stopTimeUpdates: StopTimeUpdate[] = [];
    for (const stu of tu.stopTimeUpdate || []) {
      const stopId = stu.stopId || '';
      if (!stopId) continue;

      const arrival = stu.arrival;
      const departure = stu.departure;

      stopTimeUpdates.push({
        stopId,
        stopSequence: stu.stopSequence ?? 0,
        arrivalTime: arrival?.time ? toNumber(arrival.time) : null,
        arrivalDelay: arrival?.delay ?? 0,
        departureTime: departure?.time ? toNumber(departure.time) : null,
        departureDelay: departure?.delay ?? 0,
      });
    }

    if (stopTimeUpdates.length > 0) {
      tripUpdates.push({
        tripId,
        routeId,
        directionId,
        stopTimeUpdates,
      });
    }
  }

  return tripUpdates;
}

function toNumber(val: any): number {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') return parseInt(val, 10);
  // protobuf Long object
  if (val && typeof val.toNumber === 'function') return val.toNumber();
  return 0;
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
