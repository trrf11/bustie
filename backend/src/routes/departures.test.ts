import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

// Mock dependencies
vi.mock('../services/polling', () => ({
  getCachedDepartures: vi.fn(),
}));
vi.mock('../services/ovapi', () => ({
  fetchDepartures: vi.fn(),
}));
vi.mock('../db', () => ({
  getArrivalsForStopFromDb: vi.fn().mockReturnValue([]),
}));
vi.mock('../services/stop-mapping', () => ({
  lookupStopId: vi.fn().mockReturnValue(null),
}));

import { getCachedDepartures } from '../services/polling';
import { fetchDepartures } from '../services/ovapi';

const app = createApp();

const baseDeparture = {
  journeyNumber: 101,
  scheduledDeparture: '2026-02-10T14:00:00',
  expectedDeparture: '2026-02-10T14:05:00',
  delayMinutes: 5,
  status: 'DRIVING',
  isDelayed: true,
  destination: 'Amsterdam Elandsgracht',
  lineDirection: 1,
};

const mockDepartureResult = {
  stop: { name: 'Halfweg, Station Halfweg-Zwanenburg', tpc: '55230110', latitude: 52.37, longitude: 4.72 },
  departures: [
    baseDeparture,
    { ...baseDeparture, journeyNumber: 102, lineDirection: 2, destination: 'Zandvoort Centrum' },
  ],
  timestamp: '2026-02-10T14:00:00.000Z',
};

beforeEach(() => {
  vi.mocked(getCachedDepartures).mockReset();
  vi.mocked(fetchDepartures).mockReset();
});

describe('GET /api/departures', () => {
  it('uses cached data when available', async () => {
    vi.mocked(getCachedDepartures).mockReturnValue({
      data: mockDepartureResult,
      timestamp: mockDepartureResult.timestamp,
      stale: false,
    });

    const res = await request(app).get('/api/departures?tpc=55230110&direction=1');

    expect(res.status).toBe(200);
    expect(res.body.departures).toHaveLength(1); // only direction 1
    expect(res.body.departures[0].journeyNumber).toBe(101);
    expect(res.body.stale).toBe(false);
    expect(fetchDepartures).not.toHaveBeenCalled();
  });

  it('falls back to fetch when no cache exists', async () => {
    vi.mocked(getCachedDepartures).mockReturnValue(null);
    vi.mocked(fetchDepartures).mockResolvedValue(mockDepartureResult);

    const res = await request(app).get('/api/departures?tpc=55230110&direction=1');

    expect(res.status).toBe(200);
    expect(fetchDepartures).toHaveBeenCalledWith('55230110');
    expect(res.body.stale).toBe(false);
  });

  it('filters departures by direction', async () => {
    vi.mocked(getCachedDepartures).mockReturnValue({
      data: mockDepartureResult,
      timestamp: mockDepartureResult.timestamp,
      stale: false,
    });

    const res1 = await request(app).get('/api/departures?direction=1');
    expect(res1.body.departures).toHaveLength(1);
    expect(res1.body.departures[0].lineDirection).toBe(1);

    const res2 = await request(app).get('/api/departures?direction=2');
    expect(res2.body.departures).toHaveLength(1);
    expect(res2.body.departures[0].lineDirection).toBe(2);
  });

  it('calculates leaveBy when walkTime is provided', async () => {
    vi.mocked(getCachedDepartures).mockReturnValue({
      data: mockDepartureResult,
      timestamp: mockDepartureResult.timestamp,
      stale: false,
    });

    const res = await request(app).get('/api/departures?direction=1&walkTime=10');

    expect(res.status).toBe(200);
    expect(res.body.walkTimeMinutes).toBe(10);
    expect(res.body.departures[0].leaveBy).toBeTruthy();
    // leaveBy should be 10 minutes before expectedDeparture
    expect(res.body.departures[0].leaveBy).not.toContain('Z'); // No UTC suffix
  });

  it('sets leaveBy to null when walkTime is 0', async () => {
    vi.mocked(getCachedDepartures).mockReturnValue({
      data: mockDepartureResult,
      timestamp: mockDepartureResult.timestamp,
      stale: false,
    });

    const res = await request(app).get('/api/departures?direction=1&walkTime=0');

    expect(res.body.departures[0].leaveBy).toBeNull();
  });

  it('returns stale flag from cache', async () => {
    vi.mocked(getCachedDepartures).mockReturnValue({
      data: mockDepartureResult,
      timestamp: mockDepartureResult.timestamp,
      stale: true,
    });

    const res = await request(app).get('/api/departures?direction=1');

    expect(res.body.stale).toBe(true);
  });

  it('returns 500 on fetch error', async () => {
    vi.mocked(getCachedDepartures).mockReturnValue(null);
    vi.mocked(fetchDepartures).mockRejectedValue(new Error('OVapi error'));

    const res = await request(app).get('/api/departures?direction=1');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Failed to fetch departures');
  });

  it('uses default tpc and direction when not specified', async () => {
    vi.mocked(getCachedDepartures).mockReturnValue({
      data: mockDepartureResult,
      timestamp: mockDepartureResult.timestamp,
      stale: false,
    });

    const res = await request(app).get('/api/departures');

    expect(res.status).toBe(200);
    // Default direction is 1 from config
    expect(res.body.direction).toBe(1);
  });
});
