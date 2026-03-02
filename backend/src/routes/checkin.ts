import { Router, Request, Response } from 'express';
import { checkIn, checkOut, getCheckinCounts, getClientCheckin } from '../db';
import { vehicleEventBus } from '../events';

export const checkinRouter = Router();

// In-memory rate limiter: max 6 POST/DELETE per client per 30 seconds
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_MAX = 6;
const RATE_LIMIT_WINDOW = 30_000;

// IP-based rate limiter: defense against clientId spoofing
const ipRateLimitMap = new Map<string, number[]>();
const IP_RATE_LIMIT_MAX = 20;
const IP_RATE_LIMIT_WINDOW = 60_000;

function isRateLimited(key: string, map: Map<string, number[]>, max: number, window: number): boolean {
  const now = Date.now();
  const timestamps = map.get(key) || [];
  const recent = timestamps.filter((t) => now - t < window);
  map.set(key, recent);

  if (recent.length >= max) return true;

  recent.push(now);
  return false;
}

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of rateLimitMap) {
    const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW);
    if (recent.length === 0) rateLimitMap.delete(key);
    else rateLimitMap.set(key, recent);
  }
  for (const [key, timestamps] of ipRateLimitMap) {
    const recent = timestamps.filter((t) => now - t < IP_RATE_LIMIT_WINDOW);
    if (recent.length === 0) ipRateLimitMap.delete(key);
    else ipRateLimitMap.set(key, recent);
  }
}, 5 * 60_000);

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

  // Check IP-based limit first (prevents Map growth from spoofed clientIds)
  const ip = req.ip || 'unknown';
  if (isRateLimited(ip, ipRateLimitMap, IP_RATE_LIMIT_MAX, IP_RATE_LIMIT_WINDOW)) {
    res.status(429).json({ error: 'Too many requests. Try again later.' });
    return;
  }

  if (isRateLimited(clientId, rateLimitMap, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW)) {
    res.status(429).json({ error: 'Too many requests. Try again later.' });
    return;
  }

  checkIn(clientId, vehicleId, tripId);
  vehicleEventBus.emit('checkins:updated');

  res.json({ ok: true, counts: getCheckinCounts() });
});

// DELETE /api/checkin — check out
checkinRouter.delete('/', (req: Request, res: Response) => {
  const { clientId } = req.body;

  if (!clientId || typeof clientId !== 'string' || clientId.length > 36) {
    res.status(400).json({ error: 'Valid clientId is required' });
    return;
  }

  const ip = req.ip || 'unknown';
  if (isRateLimited(ip, ipRateLimitMap, IP_RATE_LIMIT_MAX, IP_RATE_LIMIT_WINDOW)) {
    res.status(429).json({ error: 'Too many requests. Try again later.' });
    return;
  }

  if (isRateLimited(clientId, rateLimitMap, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW)) {
    res.status(429).json({ error: 'Too many requests. Try again later.' });
    return;
  }

  checkOut(clientId);
  vehicleEventBus.emit('checkins:updated');

  res.json({ ok: true, counts: getCheckinCounts() });
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
