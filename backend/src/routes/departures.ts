import { Router, Request, Response } from 'express';
import { config } from '../config';
import { fetchDepartures } from '../services/ovapi';
import { getCachedDepartures, getArrivalsForStop } from '../services/polling';
import { lookupStopId } from '../services/stop-mapping';

export const departuresRouter = Router();

departuresRouter.get('/', async (req: Request, res: Response) => {
  const tpc = (req.query.tpc as string) || config.defaultTpc;
  const direction = parseInt((req.query.direction as string) || String(config.defaultDirection), 10);
  const walkTime = parseInt((req.query.walkTime as string) || '0', 10);

  try {
    // Try cached data first for the default stop
    let result = getCachedDepartures(tpc)?.data;
    let stale = getCachedDepartures(tpc)?.stale || false;

    // If not cached (non-default stop), fetch directly
    if (!result) {
      result = await fetchDepartures(tpc);
      stale = false;
    }

    // Filter by direction
    const filteredDepartures = result.departures.filter((d) => d.lineDirection === direction);

    // Look up GTFS stopId and get real-time arrivals
    const gtfsStopId = lookupStopId(tpc, direction);
    const realtimeArrivals = gtfsStopId ? getArrivalsForStop(gtfsStopId) : [];

    // Merge real-time arrival times into OVapi departures.
    // Match by comparing scheduled times: GTFS-RT scheduled = arrivalTime - delay,
    // converted to local Amsterdam time string for comparison with OVapi's local times.
    const matchedTripIds = new Set<string>();

    for (const dep of filteredDepartures) {
      const scheduledLocal = dep.scheduledDeparture; // e.g. "2026-02-15T18:35:00"

      // Find the closest real-time arrival by comparing scheduled times
      let bestMatch: { tripId: string; arrivalTime: number; delay: number } | null = null;
      let bestDiff = Infinity;

      for (const rt of realtimeArrivals) {
        // Compute GTFS scheduled time = arrival time minus delay
        const rtScheduledUnix = (rt.arrivalTime - rt.delay) * 1000;
        // Convert to Amsterdam local time string for comparison
        const rtScheduledLocal = toLocalTimeString(rtScheduledUnix);
        // Compare as strings (both are "YYYY-MM-DDTHH:MM:SS" in Amsterdam time)
        const diff = Math.abs(new Date(rtScheduledLocal).getTime() - new Date(scheduledLocal).getTime());
        if (diff < 10 * 60 * 1000 && diff < bestDiff) {
          bestDiff = diff;
          bestMatch = rt;
        }
      }

      if (bestMatch) {
        dep.expectedDeparture = toLocalTimeString(bestMatch.arrivalTime * 1000);
        dep.delayMinutes = Math.round(bestMatch.delay / 60);
        dep.isDelayed = dep.delayMinutes >= 1;
        (dep as any).source = 'realtime';
        matchedTripIds.add(bestMatch.tripId);
      } else {
        (dep as any).source = 'scheduled';
      }
    }

    // Inject GTFS-RT arrivals that OVapi has already dropped.
    // These are buses still approaching but whose scheduled time has passed,
    // so OVapi no longer returns them. GTFS-RT still shows them as not departed.
    const defaultDestination = direction === 1 ? 'Amsterdam Elandsgracht' : 'Zandvoort Centrum';
    for (const rt of realtimeArrivals) {
      if (matchedTripIds.has(rt.tripId)) continue;

      const expectedLocal = toLocalTimeString(rt.arrivalTime * 1000);
      const scheduledLocal = toLocalTimeString((rt.arrivalTime - rt.delay) * 1000);

      filteredDepartures.push({
        journeyNumber: 0,
        scheduledDeparture: scheduledLocal,
        expectedDeparture: expectedLocal,
        delayMinutes: Math.round(rt.delay / 60),
        status: 'DRIVING',
        isDelayed: rt.delay >= 60,
        destination: defaultDestination,
        lineDirection: direction,
        source: 'realtime',
      } as any);
    }

    // Re-sort after injecting GTFS-RT-only departures
    filteredDepartures.sort(
      (a, b) => new Date(a.expectedDeparture).getTime() - new Date(b.expectedDeparture).getTime()
    );

    // Calculate leaveBy times.
    // OVapi times are local CET/CEST strings without timezone indicator (e.g. "2026-02-10T15:21:00").
    // We must output leaveBy in the same local format (no 'Z' suffix) so the frontend
    // interprets it consistently via new Date() + toLocaleTimeString().
    // Using .toISOString() would force UTC and shift the time by 1-2 hours.
    const departures = filteredDepartures.map((d) => {
      if (walkTime <= 0) return { ...d, leaveBy: null };

      const expectedMs = new Date(d.expectedDeparture).getTime();
      const leaveByMs = expectedMs - walkTime * 60 * 1000;
      const lb = new Date(leaveByMs);
      const pad = (n: number) => String(n).padStart(2, '0');
      const leaveBy = `${lb.getFullYear()}-${pad(lb.getMonth() + 1)}-${pad(lb.getDate())}T${pad(lb.getHours())}:${pad(lb.getMinutes())}:${pad(lb.getSeconds())}`;
      return { ...d, leaveBy };
    });

    // Find destination name from first departure
    const destination = departures[0]?.destination || (direction === 1 ? 'Amsterdam Elandsgracht' : 'Zandvoort Centrum');

    res.json({
      stop: result.stop,
      direction,
      destination,
      walkTimeMinutes: walkTime,
      departures,
      stale,
      timestamp: result.timestamp,
    });
  } catch (err) {
    console.error('Departures error:', err);
    res.status(500).json({ error: 'Failed to fetch departures' });
  }
});

/**
 * Convert a Unix timestamp (ms) to a local Amsterdam time string: "YYYY-MM-DDTHH:MM:SS".
 * This matches OVapi's format (local CET/CEST without timezone indicator).
 */
function toLocalTimeString(unixMs: number): string {
  const d = new Date(unixMs);
  // Use sv-SE locale for ISO-like formatting in the target timezone
  const parts = d.toLocaleString('sv-SE', { timeZone: 'Europe/Amsterdam' });
  // sv-SE gives "YYYY-MM-DD HH:MM:SS" — replace space with T
  return parts.replace(' ', 'T');
}
