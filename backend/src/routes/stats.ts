import { Router, Request, Response } from 'express';
import { getDelayStats } from '../db';

export const statsRouter = Router();

statsRouter.get('/delays', (req: Request, res: Response) => {
  const period = (req.query.period as string) || 'week';

  if (!['today', 'week', 'month'].includes(period)) {
    res.status(400).json({ error: 'Invalid period. Use: today, week, month' });
    return;
  }

  try {
    const stats = getDelayStats(period as 'today' | 'week' | 'month');
    res.json(stats);
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Failed to fetch delay stats' });
  }
});
