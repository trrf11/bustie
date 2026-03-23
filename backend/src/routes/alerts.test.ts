import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

vi.mock('../db', () => ({
  saveAlert: vi.fn(),
  deleteAlert: vi.fn(),
  getAlertsByClient: vi.fn(),
  countAlertsByClient: vi.fn(),
}));

vi.mock('../services/push', () => ({
  isPushEnabled: vi.fn().mockReturnValue(true),
  getVapidPublicKey: vi.fn().mockReturnValue('test-key'),
  sendPushNotification: vi.fn(),
}));

import { saveAlert, deleteAlert, getAlertsByClient, countAlertsByClient } from '../db';

const app = createApp();

const validAlert = {
  clientId: 'client-123',
  tpc: '55230110',
  direction: 1,
  stopName: 'Halfweg, Station Halfweg-Zwanenbrg',
  walkTimeMinutes: 10,
  timeWindowStart: '07:00',
  timeWindowEnd: '09:00',
  daysOfWeek: [1, 2, 3, 4, 5],
  enabled: true,
};

beforeEach(() => {
  vi.mocked(getAlertsByClient).mockReturnValue([]);
  vi.mocked(countAlertsByClient).mockReturnValue(0);
  vi.mocked(saveAlert).mockReset();
  vi.mocked(deleteAlert).mockReset();
});

describe('GET /api/alerts', () => {
  it('returns alerts for a client', async () => {
    vi.mocked(getAlertsByClient).mockReturnValue([{
      id: 1,
      client_id: 'client-123',
      tpc: '55230110',
      direction: 1,
      stop_name: 'Halfweg, Station Halfweg-Zwanenbrg',
      walk_time_minutes: 10,
      time_window_start: '07:00',
      time_window_end: '09:00',
      days_of_week: '[1,2,3,4,5]',
      enabled: 1,
      created_at: '2026-01-01',
    }]);

    const res = await request(app).get('/api/alerts?clientId=client-123');
    expect(res.status).toBe(200);
    expect(res.body.alerts).toHaveLength(1);
    expect(res.body.alerts[0]).toEqual({
      tpc: '55230110',
      direction: 1,
      stopName: 'Halfweg, Station Halfweg-Zwanenbrg',
      walkTimeMinutes: 10,
      timeWindowStart: '07:00',
      timeWindowEnd: '09:00',
      daysOfWeek: [1, 2, 3, 4, 5],
      enabled: true,
    });
  });

  it('returns 400 without clientId', async () => {
    const res = await request(app).get('/api/alerts');
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/alerts', () => {
  it('creates a new alert', async () => {
    const res = await request(app).put('/api/alerts').send(validAlert);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(saveAlert).toHaveBeenCalledWith(
      'client-123', '55230110', 1, 'Halfweg, Station Halfweg-Zwanenbrg',
      10, '07:00', '09:00', [1, 2, 3, 4, 5], true
    );
  });

  it('allows update even at alert cap', async () => {
    vi.mocked(getAlertsByClient).mockReturnValue(
      Array.from({ length: 20 }, (_, i) => ({
        id: i + 1,
        client_id: 'client-123',
        tpc: i === 0 ? '55230110' : `tpc-${i}`,
        direction: 1,
        stop_name: 'Test',
        walk_time_minutes: 0,
        time_window_start: '06:00',
        time_window_end: '22:00',
        days_of_week: '[1,2,3,4,5]',
        enabled: 1,
        created_at: '2026-01-01',
      }))
    );

    const res = await request(app).put('/api/alerts').send(validAlert);
    expect(res.status).toBe(200);
  });

  it('returns 429 when creating new alert beyond cap', async () => {
    vi.mocked(getAlertsByClient).mockReturnValue(
      Array.from({ length: 20 }, (_, i) => ({
        id: i + 1,
        client_id: 'client-123',
        tpc: `tpc-${i}`,
        direction: 1,
        stop_name: 'Test',
        walk_time_minutes: 0,
        time_window_start: '06:00',
        time_window_end: '22:00',
        days_of_week: '[1,2,3,4,5]',
        enabled: 1,
        created_at: '2026-01-01',
      }))
    );

    const res = await request(app).put('/api/alerts').send({
      ...validAlert,
      tpc: 'new-tpc',
    });
    expect(res.status).toBe(429);
  });

  it('returns 400 for missing clientId', async () => {
    const { clientId: _, ...noClient } = validAlert;
    const res = await request(app).put('/api/alerts').send(noClient);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid direction', async () => {
    const res = await request(app).put('/api/alerts').send({ ...validAlert, direction: 3 });
    expect(res.status).toBe(400);
  });

  it('returns 400 for walkTimeMinutes > 45', async () => {
    const res = await request(app).put('/api/alerts').send({ ...validAlert, walkTimeMinutes: 46 });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid time format', async () => {
    const res = await request(app).put('/api/alerts').send({ ...validAlert, timeWindowStart: '7:00' });
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty daysOfWeek', async () => {
    const res = await request(app).put('/api/alerts').send({ ...validAlert, daysOfWeek: [] });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid day number', async () => {
    const res = await request(app).put('/api/alerts').send({ ...validAlert, daysOfWeek: [0, 8] });
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-boolean enabled', async () => {
    const res = await request(app).put('/api/alerts').send({ ...validAlert, enabled: 1 });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/alerts', () => {
  it('deletes an alert', async () => {
    const res = await request(app).delete('/api/alerts').send({
      clientId: 'client-123',
      tpc: '55230110',
      direction: 1,
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(deleteAlert).toHaveBeenCalledWith('client-123', '55230110', 1);
  });

  it('returns 400 without clientId', async () => {
    const res = await request(app).delete('/api/alerts').send({ tpc: '55230110', direction: 1 });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid direction', async () => {
    const res = await request(app).delete('/api/alerts').send({
      clientId: 'client-123',
      tpc: '55230110',
      direction: 0,
    });
    expect(res.status).toBe(400);
  });
});
