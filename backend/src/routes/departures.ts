import { Router, Request, Response } from 'express';
import { config } from '../config';
import { getAllCachedDeparturesForTpc, getCachedStop } from '../db';

export const departuresRouter = Router();

departuresRouter.get('/', (req: Request, res: Response) => {
  const tpc = (req.query.tpc as string) || config.defaultTpc;
  const direction = parseInt((req.query.direction as string) || String(config.defaultDirection), 10);
  const walkTime = parseInt((req.query.walkTime as string) || '0', 10);

  try {
    const cachedStop = getCachedStop(tpc);

    const allDepartures = getAllCachedDeparturesForTpc(tpc);
    const filteredDepartures = allDepartures.filter((d) => d.direction === direction);

    // Check staleness: data older than 2 minutes is stale
    const stale = cachedStop
      ? (Date.now() - new Date(cachedStop.updated_at).getTime()) > 2 * 60_000
      : true;

    // Build stop info for response
    const stop = cachedStop?.stop_name
      ? { name: cachedStop.stop_name, tpc, latitude: cachedStop.latitude ?? 0, longitude: cachedStop.longitude ?? 0 }
      : null;

    // Map to response format
    const departures = filteredDepartures.map((d) => {
      const leaveBy = walkTime > 0
        ? computeLeaveBy(d.expected_departure, walkTime)
        : null;

      return {
        journeyNumber: d.journey_number,
        scheduledDeparture: d.scheduled_departure,
        expectedDeparture: d.expected_departure,
        delayMinutes: d.delay_minutes,
        status: d.status,
        isDelayed: d.delay_minutes >= 1,
        destination: d.destination,
        lineDirection: d.direction,
        leaveBy,
        source: 'scheduled',
      };
    });

    const destination = departures[0]?.destination || (direction === 1 ? 'Amsterdam Elandsgracht' : 'Zandvoort Centrum');

    res.json({
      stop,
      direction,
      destination,
      walkTimeMinutes: walkTime,
      departures,
      stale,
      timestamp: cachedStop?.updated_at || new Date().toISOString(),
    });
  } catch (err) {
    console.error('Departures error:', err);
    res.status(500).json({ error: 'Failed to fetch departures' });
  }
});

function computeLeaveBy(expectedDeparture: string, walkTimeMinutes: number): string {
  const expectedMs = new Date(expectedDeparture).getTime();
  const leaveByMs = expectedMs - walkTimeMinutes * 60_000;
  const lb = new Date(leaveByMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${lb.getFullYear()}-${pad(lb.getMonth() + 1)}-${pad(lb.getDate())}T${pad(lb.getHours())}:${pad(lb.getMinutes())}:${pad(lb.getSeconds())}`;
}
