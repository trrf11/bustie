import { config } from '../config';
import { fetchDepartures, DepartureResult } from './ovapi';
import { recordDelay, replaceCachedDepartures, DbCachedDeparture } from '../db';
import { getAllTpcs } from './stop-mapping';

let departurePollBusy = false;
let departureBackoff: number = config.departurePollInterval;
const MAX_BACKOFF = 5 * 60 * 1000;

// Track which journeys we've already recorded delays for (to avoid duplicates)
const recordedJourneys = new Set<string>();

/**
 * Fetch departures for a TPC from OVapi and store in SQLite.
 * Exported so the departures route can trigger on-demand fetches for TPCs not yet cached.
 */
export async function fetchAndCacheDepartures(tpc: string): Promise<void> {
  const result = await fetchDepartures(tpc);
  storeDeparturesInDb(tpc, result);
}

function storeDeparturesInDb(tpc: string, result: DepartureResult): void {
  const rows: DbCachedDeparture[] = result.departures.map((d) => ({
    tpc,
    direction: d.lineDirection,
    journey_number: d.journeyNumber,
    scheduled_departure: d.scheduledDeparture,
    expected_departure: d.expectedDeparture,
    delay_minutes: d.delayMinutes,
    destination: d.destination,
    status: d.status,
  }));
  const stopInfo = result.stop
    ? { name: result.stop.name, latitude: result.stop.latitude, longitude: result.stop.longitude }
    : undefined;
  replaceCachedDepartures(tpc, rows, stopInfo);
}

async function pollDepartures(): Promise<void> {
  if (departurePollBusy) return;
  departurePollBusy = true;

  try {
    const allTpcs = getAllTpcs();

    for (const tpc of allTpcs) {
      try {
        const result = await fetchDepartures(tpc);
        storeDeparturesInDb(tpc, result);

        // Record delays for the leaderboard
        for (const dep of result.departures) {
          const key = `${dep.journeyNumber}-${dep.scheduledDeparture}`;
          if (recordedJourneys.has(key)) continue;

          if (dep.isDelayed && dep.delayMinutes >= 1) {
            recordDelay(
              dep.journeyNumber,
              dep.lineDirection,
              result.stop?.name || 'Unknown',
              tpc,
              dep.scheduledDeparture,
              dep.expectedDeparture,
              dep.delayMinutes,
              dep.destination
            );
            recordedJourneys.add(key);
          }
        }
      } catch (err) {
        console.error(`TPC ${tpc} poll failed:`, (err as Error).message);
      }
    }

    // Clean up old recorded journey keys (keep last 200)
    if (recordedJourneys.size > 200) {
      const entries = Array.from(recordedJourneys);
      entries.slice(0, entries.length - 200).forEach((k) => recordedJourneys.delete(k));
    }

    departureBackoff = config.departurePollInterval;
  } catch (err) {
    console.error('Departure poll failed:', (err as Error).message);
    departureBackoff = Math.min(departureBackoff * 2, MAX_BACKOFF);
  } finally {
    departurePollBusy = false;
  }
}

export function startDeparturePolling(): void {
  console.log(`Starting departure polling: every ${config.departurePollInterval / 1000}s`);

  function scheduleDeparturePoll() {
    pollDepartures().finally(() => {
      setTimeout(scheduleDeparturePoll, departureBackoff);
    });
  }

  scheduleDeparturePoll();
}
