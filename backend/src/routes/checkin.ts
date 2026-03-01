import { Router, Request, Response } from 'express';
import { checkIn, checkOut, getCheckinCounts, getClientCheckin } from '../db';
import { vehicleEventBus } from '../events';

export const checkinRouter = Router();

// In-memory rate limiter: max 6 POST/DELETE per client per minute
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_MAX = 6;
const RATE_LIMIT_WINDOW = 30_000;

function isRateLimited(clientId: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(clientId) || [];
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW);
  rateLimitMap.set(clientId, recent);

  if (recent.length >= RATE_LIMIT_MAX) return true;

  recent.push(now);
  return false;
}

// POST /api/checkin — check in to a bus
checkinRouter.post('/', (req: Request, res: Response) => {
  const { clientId, vehicleId, tripId } = req.body;

  if (!clientId || !vehicleId || !tripId) {
    res.status(400).json({ error: 'clientId, vehicleId, and tripId are required' });
    return;
  }

  if (typeof clientId !== 'string' || clientId.length > 36) {
    res.status(400).json({ error: 'Invalid clientId' });
    return;
  }

  if (isRateLimited(clientId)) {
    res.status(429).json({ error: 'Too many requests. Try again later.' });
    return;
  }

  checkIn(clientId, vehicleId, tripId);
  vehicleEventBus.emit('checkins:updated');

  res.json({ ok: true });
});

// DELETE /api/checkin — check out
checkinRouter.delete('/', (req: Request, res: Response) => {
  const { clientId } = req.body;

  if (!clientId || typeof clientId !== 'string' || clientId.length > 36) {
    res.status(400).json({ error: 'Valid clientId is required' });
    return;
  }

  if (isRateLimited(clientId)) {
    res.status(429).json({ error: 'Too many requests. Try again later.' });
    return;
  }

  checkOut(clientId);
  vehicleEventBus.emit('checkins:updated');

  res.json({ ok: true });
});

// GET /api/checkin?clientId=xxx — get current check-in status
checkinRouter.get('/', (req: Request, res: Response) => {
  const clientId = req.query.clientId as string;

  if (!clientId || clientId.length > 36) {
    res.status(400).json({ error: 'Valid clientId query param is required' });
    return;
  }

  const current = getClientCheckin(clientId);
  const counts = getCheckinCounts();

  res.json({ checkin: current, counts });
});
