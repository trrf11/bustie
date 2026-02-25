import { config } from '../config';
import { fetchVehiclePositions } from './gtfs-rt';
import { fetchTripUpdates } from './gtfs-rt';
import { getDirectionForTrip } from './gtfs-static';
import { replaceVehicles, replaceStopTimes, logPoll, DbVehicle, DbStopTime } from '../db';
import { checkGtfsFeedChanged, refreshGtfsData } from './gtfs-extract';
import { vehicleEventBus } from '../events';

const MAX_BACKOFF = 5 * 60 * 1000; // 5 minutes

let vehicleBackoff: number = config.vehiclePollInterval;
let tripUpdateBackoff: number = config.vehiclePollInterval;
let vehiclePollBusy = false;
let tripUpdatePollBusy = false;

// Staleness detection state
let consecutiveEmptyPolls = 0;
let gtfsRefreshInProgress = false;

// Change detection: only emit SSE when data actually differs
let lastVehicleFingerprint = '';

async function pollAndStoreVehicles(): Promise<void> {
  if (vehiclePollBusy) return;
  vehiclePollBusy = true;

  try {
    const positions = await fetchVehiclePositions();

    const vehicles: DbVehicle[] = positions.map((v) => {
      // Map GTFS directionId (0/1) to display direction (1/2)
      const rtDirection = v.directionId;
      const staticDirection = getDirectionForTrip(v.tripId);
      const rawDirection = rtDirection !== null ? rtDirection : staticDirection;
      const direction = rawDirection !== null ? (rawDirection === 0 ? 1 : 2) : null;

      return {
        vehicle_id: v.vehicleId,
        trip_id: v.tripId,
        direction,
        latitude: v.latitude,
        longitude: v.longitude,
        delay_seconds: v.delaySeconds,
        updated_at: v.timestamp,
      };
    });

    replaceVehicles(vehicles);

    // Only push SSE when positions actually changed
    const fingerprint = vehicles
      .map((v) => `${v.vehicle_id}:${v.latitude}:${v.longitude}:${v.delay_seconds}`)
      .sort()
      .join('|');
    if (fingerprint !== lastVehicleFingerprint) {
      lastVehicleFingerprint = fingerprint;
      vehicleEventBus.emit('vehicles:updated');
    }

    logPoll('vehicles', 'ok', vehicles.length);
    console.log(`Collected ${vehicles.length} vehicles`);
    vehicleBackoff = config.vehiclePollInterval;

    // Staleness detection: track consecutive zero-vehicle polls during operating hours
    if (vehicles.length === 0 && isDuringOperatingHours()) {
      consecutiveEmptyPolls++;
      console.log(
        `[staleness] Empty poll ${consecutiveEmptyPolls}/${config.stalenessThreshold} during operating hours`
      );
      if (consecutiveEmptyPolls >= config.stalenessThreshold) {
        consecutiveEmptyPolls = 0;
        triggerGtfsRefresh('staleness');
      }
    } else if (vehicles.length > 0) {
      consecutiveEmptyPolls = 0;
    }
  } catch (err) {
    const message = (err as Error).message;
    console.error('Vehicle poll failed:', message);
    logPoll('vehicles', 'error', undefined, message);
    vehicleBackoff = Math.min(vehicleBackoff * 2, MAX_BACKOFF);
  } finally {
    vehiclePollBusy = false;
  }
}

async function pollAndStoreTripUpdates(): Promise<void> {
  if (tripUpdatePollBusy) return;
  tripUpdatePollBusy = true;

  try {
    const updates = await fetchTripUpdates();
    const now = Math.floor(Date.now() / 1000);

    const stopTimes: DbStopTime[] = [];

    for (const tu of updates) {
      const rawDir = tu.directionId;
      const direction = rawDir !== null ? (rawDir === 0 ? 1 : 2) : null;

      const sortedStops = [...tu.stopTimeUpdates].sort(
        (a, b) => a.stopSequence - b.stopSequence
      );

      const nextStopIdx = sortedStops.findIndex((stu) => {
        const time = stu.arrivalTime ?? stu.departureTime;
        return time !== null && time > now - 60;
      });

      for (let i = 0; i < sortedStops.length; i++) {
        const stu = sortedStops[i];
        const departed = nextStopIdx === -1 || i < nextStopIdx;

        stopTimes.push({
          trip_id: tu.tripId,
          stop_id: stu.stopId,
          stop_sequence: stu.stopSequence,
          direction,
          arrival_time: stu.arrivalTime,
          arrival_delay: stu.arrivalDelay,
          departure_time: stu.departureTime,
          departure_delay: stu.departureDelay,
          departed: departed ? 1 : 0,
        });
      }
    }

    replaceStopTimes(stopTimes);
    logPoll('trip_updates', 'ok', updates.length);
    console.log(`Collected ${updates.length} trip updates (${stopTimes.length} stop times)`);
    tripUpdateBackoff = config.vehiclePollInterval;
  } catch (err) {
    const message = (err as Error).message;
    console.error('Trip update poll failed:', message);
    logPoll('trip_updates', 'error', undefined, message);
    tripUpdateBackoff = Math.min(tripUpdateBackoff * 2, MAX_BACKOFF);
  } finally {
    tripUpdatePollBusy = false;
  }
}

/**
 * Check if current time is during bus operating hours (06:00–01:00 Amsterdam time).
 * Outside these hours, zero vehicles is expected and should not trigger a refresh.
 */
function isDuringOperatingHours(): boolean {
  const now = new Date();
  const amsterdamHour = parseInt(
    now.toLocaleString('en-US', { timeZone: 'Europe/Amsterdam', hour: 'numeric', hour12: false }),
    10
  );
  // Operating hours: 06:00 to 01:00 (next day)
  // Hour 1–5 = outside operating hours, 6–23 and 0 = operating hours
  return amsterdamHour >= 6 || amsterdamHour === 0;
}

/**
 * Fire-and-forget GTFS refresh with concurrency guard.
 */
function triggerGtfsRefresh(reason: string): void {
  if (gtfsRefreshInProgress) {
    console.log(`[gtfs-extract] Refresh already running, skipping (trigger: ${reason})`);
    return;
  }

  console.log(`[gtfs-extract] Triggering refresh (reason: ${reason})`);
  gtfsRefreshInProgress = true;

  refreshGtfsData()
    .then((updated) => {
      if (updated) {
        console.log(`[gtfs-extract] Refresh complete — route data updated`);
      } else {
        console.log(`[gtfs-extract] Refresh complete — no changes`);
      }
    })
    .catch((err) => {
      console.error(`[gtfs-extract] Refresh error:`, (err as Error).message);
    })
    .finally(() => {
      gtfsRefreshInProgress = false;
    });
}

export function startCollector(): void {
  console.log(
    `Starting collector: vehicles every ${config.vehiclePollInterval / 1000}s, trip updates every ${config.vehiclePollInterval / 1000}s`
  );

  function scheduleVehiclePoll() {
    pollAndStoreVehicles().finally(() => {
      setTimeout(scheduleVehiclePoll, vehicleBackoff);
    });
  }

  function scheduleTripUpdatePoll() {
    pollAndStoreTripUpdates().finally(() => {
      setTimeout(scheduleTripUpdatePoll, tripUpdateBackoff);
    });
  }

  // Initial delay to let the server start up
  setTimeout(scheduleVehiclePoll, 5000);
  setTimeout(scheduleTripUpdatePoll, 5000);

  // Proactive GTFS feed check every 24h
  setInterval(async () => {
    try {
      console.log('[gtfs-extract] Proactive ETag check...');
      const { changed } = await checkGtfsFeedChanged();
      if (changed) {
        triggerGtfsRefresh('proactive-etag-check');
      } else {
        console.log('[gtfs-extract] Feed unchanged');
      }
    } catch (err) {
      console.error('[gtfs-extract] Proactive check failed:', (err as Error).message);
    }
  }, config.gtfsUpdateCheckInterval);
}
