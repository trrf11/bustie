import { Router, Request, Response } from 'express';
import { config } from '../config';
import { fetchDepartures } from '../services/ovapi';
import { getCachedDepartures } from '../services/polling';

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
