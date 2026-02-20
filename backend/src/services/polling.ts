import { config } from '../config';
import { fetchDepartures, DepartureResult } from './ovapi';
import { recordDelay } from '../db';

// Cached departures (OVapi REST — on-demand, low-frequency)
let cachedDepartures: Map<string, { data: DepartureResult; timestamp: string; stale: boolean }> =
  new Map();

let departurePollBusy = false;
let departureBackoff: number = config.departurePollInterval;
const MAX_BACKOFF = 5 * 60 * 1000;

// Track which journeys we've already recorded delays for (to avoid duplicates)
const recordedJourneys = new Set<string>();

export function getCachedDepartures(tpc: string) {
  return cachedDepartures.get(tpc) || null;
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

    departureBackoff = config.departurePollInterval;
  } catch (err) {
    console.error('Departure poll failed:', (err as Error).message);
    const existing = cachedDepartures.get(config.defaultTpc);
    if (existing) existing.stale = true;
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
