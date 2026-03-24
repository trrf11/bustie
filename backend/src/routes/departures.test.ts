import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

vi.mock('../db', () => ({
  getAllCachedDeparturesForTpc: vi.fn(),
  getCachedStop: vi.fn(),
}));

import { getAllCachedDeparturesForTpc, getCachedStop } from '../db';

const app = createApp();

const cachedDep1 = {
  tpc: '55230110',
  direction: 1,
  journey_number: 101,
  scheduled_departure: '2026-02-10T14:00:00',
  expected_departure: '2026-02-10T14:05:00',
  delay_minutes: 5,
  destination: 'Amsterdam Elandsgracht',
  status: 'DRIVING',
};

const cachedDep2 = {
  ...cachedDep1,
  direction: 2,
  journey_number: 102,
  destination: 'Zandvoort Centrum',
};

const cachedStop = {
  tpc: '55230110',
  stop_name: 'Halfweg, Station Halfweg-Zwanenburg',
  latitude: 52.37,
  longitude: 4.72,
  updated_at: new Date().toISOString(),
};

beforeEach(() => {
  vi.mocked(getAllCachedDeparturesForTpc).mockReset();
  vi.mocked(getCachedStop).mockReset();
});

describe('GET /api/departures', () => {
  it('returns cached departures filtered by direction', async () => {
    vi.mocked(getCachedStop).mockReturnValue(cachedStop);
    vi.mocked(getAllCachedDeparturesForTpc).mockReturnValue([cachedDep1, cachedDep2]);

    const res = await request(app).get('/api/departures?tpc=55230110&direction=1');

    expect(res.status).toBe(200);
    expect(res.body.departures).toHaveLength(1);
    expect(res.body.departures[0].journeyNumber).toBe(101);
    expect(res.body.stale).toBe(false);
  });

  it('returns empty departures when stop not yet cached', async () => {
    vi.mocked(getCachedStop).mockReturnValue(null);
    vi.mocked(getAllCachedDeparturesForTpc).mockReturnValue([]);

    const res = await request(app).get('/api/departures?tpc=55230110&direction=1');

    expect(res.status).toBe(200);
    expect(res.body.departures).toHaveLength(0);
    expect(res.body.stale).toBe(true);
  });

  it('filters departures by direction', async () => {
    vi.mocked(getCachedStop).mockReturnValue(cachedStop);
    vi.mocked(getAllCachedDeparturesForTpc).mockReturnValue([cachedDep1, cachedDep2]);

    const res1 = await request(app).get('/api/departures?direction=1');
    expect(res1.body.departures).toHaveLength(1);
    expect(res1.body.departures[0].lineDirection).toBe(1);

    const res2 = await request(app).get('/api/departures?direction=2');
    expect(res2.body.departures).toHaveLength(1);
    expect(res2.body.departures[0].lineDirection).toBe(2);
  });

  it('calculates leaveBy when walkTime is provided', async () => {
    vi.mocked(getCachedStop).mockReturnValue(cachedStop);
    vi.mocked(getAllCachedDeparturesForTpc).mockReturnValue([cachedDep1]);

    const res = await request(app).get('/api/departures?direction=1&walkTime=10');

    expect(res.status).toBe(200);
    expect(res.body.walkTimeMinutes).toBe(10);
    expect(res.body.departures[0].leaveBy).toBeTruthy();
    expect(res.body.departures[0].leaveBy).not.toContain('Z');
  });

  it('sets leaveBy to null when walkTime is 0', async () => {
    vi.mocked(getCachedStop).mockReturnValue(cachedStop);
    vi.mocked(getAllCachedDeparturesForTpc).mockReturnValue([cachedDep1]);

    const res = await request(app).get('/api/departures?direction=1&walkTime=0');
    expect(res.body.departures[0].leaveBy).toBeNull();
  });

  it('marks data as stale when older than 2 minutes', async () => {
    const staleStop = { ...cachedStop, updated_at: new Date(Date.now() - 3 * 60_000).toISOString() };
    vi.mocked(getCachedStop).mockReturnValue(staleStop);
    vi.mocked(getAllCachedDeparturesForTpc).mockReturnValue([cachedDep1]);

    const res = await request(app).get('/api/departures?direction=1');
    expect(res.body.stale).toBe(true);
  });

  it('uses default tpc and direction when not specified', async () => {
    vi.mocked(getCachedStop).mockReturnValue(cachedStop);
    vi.mocked(getAllCachedDeparturesForTpc).mockReturnValue([cachedDep1]);

    const res = await request(app).get('/api/departures');

    expect(res.status).toBe(200);
    expect(res.body.direction).toBe(1);
  });
});
