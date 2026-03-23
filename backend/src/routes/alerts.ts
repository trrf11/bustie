import { Router, Request, Response } from 'express';
import {
  saveAlert,
  deleteAlert,
  getAlertsByClient,
  countAlertsByClient,
} from '../db';

export const alertsRouter = Router();

const MAX_ALERTS_PER_CLIENT = 20;
const MAX_WALK_TIME = 45;
const TIME_RE = /^\d{2}:\d{2}$/;

function validateClientId(clientId: unknown): clientId is string {
  return typeof clientId === 'string' && clientId.length > 0 && clientId.length <= 36;
}

function validateDaysOfWeek(days: unknown): days is number[] {
  return Array.isArray(days)
    && days.length > 0
    && days.every((d) => Number.isInteger(d) && d >= 1 && d <= 7);
}

// GET /api/alerts?clientId=...
alertsRouter.get('/', (req: Request, res: Response) => {
  const clientId = req.query.clientId as string | undefined;
  if (!validateClientId(clientId)) {
    res.status(400).json({ error: 'Valid clientId is required' });
    return;
  }

  const alerts = getAlertsByClient(clientId);
  res.json({
    alerts: alerts.map((a) => ({
      tpc: a.tpc,
      direction: a.direction,
      stopName: a.stop_name,
      walkTimeMinutes: a.walk_time_minutes,
      timeWindowStart: a.time_window_start,
      timeWindowEnd: a.time_window_end,
      daysOfWeek: JSON.parse(a.days_of_week) as number[],
      enabled: a.enabled === 1,
    })),
  });
});

// PUT /api/alerts — upsert alert
alertsRouter.put('/', (req: Request, res: Response) => {
  const { clientId, tpc, direction, stopName, walkTimeMinutes, timeWindowStart, timeWindowEnd, daysOfWeek, enabled } = req.body;

  if (!validateClientId(clientId)) {
    res.status(400).json({ error: 'Valid clientId is required (max 36 chars)' });
    return;
  }

  if (!tpc || typeof tpc !== 'string') {
    res.status(400).json({ error: 'tpc is required' });
    return;
  }

  if (!Number.isInteger(direction) || (direction !== 1 && direction !== 2)) {
    res.status(400).json({ error: 'direction must be 1 or 2' });
    return;
  }

  if (!stopName || typeof stopName !== 'string') {
    res.status(400).json({ error: 'stopName is required' });
    return;
  }

  if (!Number.isInteger(walkTimeMinutes) || walkTimeMinutes < 0 || walkTimeMinutes > MAX_WALK_TIME) {
    res.status(400).json({ error: `walkTimeMinutes must be 0-${MAX_WALK_TIME}` });
    return;
  }

  if (!TIME_RE.test(timeWindowStart) || !TIME_RE.test(timeWindowEnd)) {
    res.status(400).json({ error: 'timeWindowStart and timeWindowEnd must be HH:MM format' });
    return;
  }

  if (!validateDaysOfWeek(daysOfWeek)) {
    res.status(400).json({ error: 'daysOfWeek must be a non-empty array of integers 1-7' });
    return;
  }

  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'enabled must be a boolean' });
    return;
  }

  // Check alert cap (only for new alerts, not updates)
  const existing = getAlertsByClient(clientId);
  const isUpdate = existing.some((a) => a.tpc === tpc && a.direction === direction);
  if (!isUpdate && existing.length >= MAX_ALERTS_PER_CLIENT) {
    res.status(429).json({ error: 'Too many alerts for this client' });
    return;
  }

  saveAlert(clientId, tpc, direction, stopName, walkTimeMinutes, timeWindowStart, timeWindowEnd, daysOfWeek, enabled);
  res.json({ ok: true });
});

// DELETE /api/alerts
alertsRouter.delete('/', (req: Request, res: Response) => {
  const { clientId, tpc, direction } = req.body;

  if (!validateClientId(clientId)) {
    res.status(400).json({ error: 'Valid clientId is required' });
    return;
  }

  if (!tpc || typeof tpc !== 'string') {
    res.status(400).json({ error: 'tpc is required' });
    return;
  }

  if (!Number.isInteger(direction) || (direction !== 1 && direction !== 2)) {
    res.status(400).json({ error: 'direction must be 1 or 2' });
    return;
  }

  deleteAlert(clientId, tpc, direction);
  res.json({ ok: true });
});
