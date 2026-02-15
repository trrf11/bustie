import { config } from '../config';
import { fetchDepartures, DepartureResult } from './ovapi';
import { fetchVehiclePositions, VehiclePosition, fetchTripUpdates, TripUpdate } from './gtfs-rt';
import { recordDelay } from '../db';

// Cached results
let cachedVehicles: { data: VehiclePosition[]; timestamp: string; stale: boolean } = {
  data: [],
  timestamp: new Date().toISOString(),
  stale: false,
};

let cachedDepartures: Map<string, { data: DepartureResult; timestamp: string; stale: boolean }> =
  new Map();

// Real-time arrival index: GTFS stopId → arrivals sorted by time
export interface RealtimeArrival {
  tripId: string;
  arrivalTime: number;  // Unix timestamp (seconds)
  delay: number;        // seconds
  departed: boolean;    // true if the bus has already passed this stop
}

let realtimeArrivals: Map<string, RealtimeArrival[]> = new Map();

// Skip-if-busy flags
let vehiclePollBusy = false;
let departurePollBusy = false;
let tripUpdatePollBusy = false;

// Backoff state
let vehicleBackoff: number = config.vehiclePollInterval;
let departureBackoff: number = config.departurePollInterval;
let tripUpdateBackoff: number = config.vehiclePollInterval;
const MAX_BACKOFF = 5 * 60 * 1000; // 5 minutes

// Track which journeys we've already recorded delays for (to avoid duplicates)
const recordedJourneys = new Set<string>();

export function getCachedVehicles() {
  return cachedVehicles;
}

export function getCachedDepartures(tpc: string) {
  return cachedDepartures.get(tpc) || null;
}

/**
 * Get real-time arrivals for a GTFS stopId.
 * Returns all arrivals that haven't departed yet (bus still approaching or at stop).
 */
export function getArrivalsForStop(stopId: string): RealtimeArrival[] {
  const arrivals = realtimeArrivals.get(stopId);
  if (!arrivals) return [];

  return arrivals.filter((a) => !a.departed);
}

async function pollVehicles(): Promise<void> {
  if (vehiclePollBusy) return;
  vehiclePollBusy = true;

  try {
    const vehicles = await fetchVehiclePositions();
    cachedVehicles = {
      data: vehicles,
      timestamp: new Date().toISOString(),
      stale: false,
    };
    vehicleBackoff = config.vehiclePollInterval; // Reset backoff on success
  } catch (err) {
    console.error('Vehicle poll failed:', (err as Error).message);
    cachedVehicles.stale = true;
    vehicleBackoff = Math.min(vehicleBackoff * 2, MAX_BACKOFF);
  } finally {
    vehiclePollBusy = false;
  }
}

async function pollDepartures(): Promise<void> {
  if (departurePollBusy) return;
  departurePollBusy = true;

  try {
    // Poll the default stop
    const result = await fetchDepartures(config.defaultTpc);
    cachedDepartures.set(config.defaultTpc, {
      data: result,
      timestamp: new Date().toISOString(),
      stale: false,
    });

    // Record delays for the leaderboard
    for (const dep of result.departures) {
      const key = `${dep.journeyNumber}-${dep.scheduledDeparture}`;
      if (recordedJourneys.has(key)) continue;

      if (dep.isDelayed && dep.delayMinutes >= 1) {
        recordDelay(
          dep.journeyNumber,
          dep.lineDirection,
          result.stop?.name || 'Unknown',
          config.defaultTpc,
          dep.scheduledDeparture,
          dep.expectedDeparture,
          dep.delayMinutes,
          dep.destination
        );
        recordedJourneys.add(key);
      }
    }

    // Clean up old recorded journey keys (keep last 200)
    if (recordedJourneys.size > 200) {
      const entries = Array.from(recordedJourneys);
      entries.slice(0, entries.length - 200).forEach((k) => recordedJourneys.delete(k));
    }

    departureBackoff = config.departurePollInterval; // Reset backoff
  } catch (err) {
    console.error('Departure poll failed:', (err as Error).message);
    const existing = cachedDepartures.get(config.defaultTpc);
    if (existing) existing.stale = true;
    departureBackoff = Math.min(departureBackoff * 2, MAX_BACKOFF);
  } finally {
    departurePollBusy = false;
  }
}

async function pollTripUpdates(): Promise<void> {
  if (tripUpdatePollBusy) return;
  tripUpdatePollBusy = true;

  try {
    const updates = await fetchTripUpdates();
    const now = Math.floor(Date.now() / 1000);

    // Build new arrival index
    const index = new Map<string, RealtimeArrival[]>();

    for (const tu of updates) {
      // Determine which stops the bus has already passed.
      // StopTimeUpdates are ordered by stop sequence. The bus's "next stop"
      // is the first one with an arrival time in the future. Everything before
      // that has been visited.
      const sortedStops = [...tu.stopTimeUpdates].sort(
        (a, b) => a.stopSequence - b.stopSequence
      );

      // Find the index of the first stop the bus hasn't reached yet.
      // A stop is considered "not reached" if its arrival time is in the future
      // or within a small grace window (bus might be dwelling at stop).
      const nextStopIdx = sortedStops.findIndex((stu) => {
        const time = stu.arrivalTime ?? stu.departureTime;
        // 60s grace: if arrival was <60s ago, bus may still be at the stop
        return time !== null && time > now - 60;
      });

      for (let i = 0; i < sortedStops.length; i++) {
        const stu = sortedStops[i];
        const time = stu.arrivalTime ?? stu.departureTime;
        if (!time) continue;

        // If nextStopIdx is -1, all stops are in the past (trip nearly done) → all departed.
        // Otherwise, stops before nextStopIdx have been passed.
        const departed = nextStopIdx === -1 || i < nextStopIdx;

        const arrival: RealtimeArrival = {
          tripId: tu.tripId,
          arrivalTime: time,
          delay: stu.arrivalDelay || stu.departureDelay,
          departed,
        };

        const existing = index.get(stu.stopId);
        if (existing) {
          existing.push(arrival);
        } else {
          index.set(stu.stopId, [arrival]);
        }
      }
    }

    // Sort each stop's arrivals by time
    for (const arrivals of index.values()) {
      arrivals.sort((a, b) => a.arrivalTime - b.arrivalTime);
    }

    realtimeArrivals = index;
    tripUpdateBackoff = config.vehiclePollInterval;
  } catch (err) {
    console.error('Trip update poll failed:', (err as Error).message);
    tripUpdateBackoff = Math.min(tripUpdateBackoff * 2, MAX_BACKOFF);
  } finally {
    tripUpdatePollBusy = false;
  }
}

export function startPolling(): void {
  console.log(
    `Starting polling: vehicles every ${config.vehiclePollInterval / 1000}s, departures every ${config.departurePollInterval / 1000}s`
  );

  // Recursive setTimeout so the backoff interval is actually respected
  function scheduleVehiclePoll() {
    pollVehicles().finally(() => {
      setTimeout(scheduleVehiclePoll, vehicleBackoff);
    });
  }

  function scheduleDeparturePoll() {
    pollDepartures().finally(() => {
      setTimeout(scheduleDeparturePoll, departureBackoff);
    });
  }

  function scheduleTripUpdatePoll() {
    pollTripUpdates().finally(() => {
      setTimeout(scheduleTripUpdatePoll, tripUpdateBackoff);
    });
  }

  scheduleVehiclePoll();
  scheduleDeparturePoll();
  scheduleTripUpdatePoll();
}
