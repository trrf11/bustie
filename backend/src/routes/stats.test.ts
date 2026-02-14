import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

// Mock the db module
vi.mock('../db', () => ({
  getDelayStats: vi.fn(),
}));

import { getDelayStats } from '../db';

const app = createApp();

const mockStats = {
  period: 'week',
  worstDelays: [
    {
      date: '2026-02-10',
      journeyNumber: 123,
      stop: 'Haarlem, Centrum/Houtplein',
      scheduledTime: '2026-02-10T14:00:00',
      actualTime: '2026-02-10T14:12:00',
      delayMinutes: 12,
      direction: 1,
    },
  ],
  averageDelayMinutes: 3.5,
  onTimePercentage: 72,
  totalTripsTracked: 150,
};

beforeEach(() => {
  vi.mocked(getDelayStats).mockReset();
});

describe('GET /api/stats/delays', () => {
  it('returns stats for default period (week)', async () => {
    vi.mocked(getDelayStats).mockReturnValue(mockStats);

    const res = await request(app).get('/api/stats/delays');

    expect(res.status).toBe(200);
    expect(res.body.period).toBe('week');
    expect(res.body.worstDelays).toHaveLength(1);
    expect(getDelayStats).toHaveBeenCalledWith('week');
  });

  it('accepts valid periods: today, week, month', async () => {
    vi.mocked(getDelayStats).mockReturnValue(mockStats);

    for (const period of ['today', 'week', 'month']) {
      const res = await request(app).get(`/api/stats/delays?period=${period}`);
      expect(res.status).toBe(200);
    }

    expect(getDelayStats).toHaveBeenCalledTimes(3);
  });

  it('returns 400 for invalid period', async () => {
    const res = await request(app).get('/api/stats/delays?period=year');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid period');
    expect(getDelayStats).not.toHaveBeenCalled();
  });

  it('returns 500 when db throws', async () => {
    vi.mocked(getDelayStats).mockImplementation(() => {
      throw new Error('DB error');
    });

    const res = await request(app).get('/api/stats/delays?period=today');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to fetch delay stats');
  });
});
