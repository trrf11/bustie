import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

// Mock dependencies
vi.mock('../services/polling', () => ({
  getCachedVehicles: vi.fn(),
}));
vi.mock('../services/gtfs-static', () => ({
  getRouteData: vi.fn(),
  getDirectionForTrip: vi.fn(),
  getPrimaryShapes: vi.fn(),
}));

import { getCachedVehicles } from '../services/polling';
import { getRouteData, getDirectionForTrip, getPrimaryShapes } from '../services/gtfs-static';

const app = createApp();

const mockVehicle = {
  vehicleId: 'CXX-4001',
  tripId: 'trip-123',
  routeId: 'route-80',
  directionId: 0,
  latitude: 52.38,
  longitude: 4.65,
  delaySeconds: 120,
  currentStatus: 'IN_TRANSIT_TO',
  stopId: 'stop-1',
  timestamp: '2026-02-10T14:00:00.000Z',
};

const mockShapes = {
  direction1: [[52.37, 4.63], [52.38, 4.70]] as Array<[number, number]>,
  direction2: [[52.38, 4.70], [52.37, 4.63]] as Array<[number, number]>,
};

const mockRouteData = {
  stops: {
    route: {
      direction1: [{ stopId: 's1', name: 'Stop A', latitude: 52.37, longitude: 4.63, sequence: 1 }],
      direction2: [{ stopId: 's2', name: 'Stop B', latitude: 52.38, longitude: 4.70, sequence: 1 }],
    },
  },
};

beforeEach(() => {
  vi.mocked(getCachedVehicles).mockReset();
  vi.mocked(getRouteData).mockReset();
  vi.mocked(getDirectionForTrip).mockReset();
  vi.mocked(getPrimaryShapes).mockReset();

  vi.mocked(getCachedVehicles).mockReturnValue({
    data: [mockVehicle],
    timestamp: '2026-02-10T14:00:00.000Z',
    stale: false,
  });
  vi.mocked(getRouteData).mockReturnValue(mockRouteData as any);
  vi.mocked(getDirectionForTrip).mockReturnValue(0);
  vi.mocked(getPrimaryShapes).mockReturnValue(mockShapes);
});

describe('GET /api/vehicles', () => {
  it('returns vehicles with direction mapped from GTFS 0/1 to display 1/2', async () => {
    const res = await request(app).get('/api/vehicles');

    expect(res.status).toBe(200);
    expect(res.body.vehicles).toHaveLength(1);
    // GTFS direction 0 → display direction 1
    expect(res.body.vehicles[0].direction).toBe(1);
    expect(res.body.vehicles[0].vehicleId).toBe('CXX-4001');
  });

  it('maps GTFS direction 1 to display direction 2', async () => {
    vi.mocked(getCachedVehicles).mockReturnValue({
      data: [{ ...mockVehicle, directionId: 1 }],
      timestamp: '2026-02-10T14:00:00.000Z',
      stale: false,
    });

    const res = await request(app).get('/api/vehicles');

    expect(res.body.vehicles[0].direction).toBe(2);
  });

  it('falls back to static direction when RT direction is null', async () => {
    vi.mocked(getCachedVehicles).mockReturnValue({
      data: [{ ...mockVehicle, directionId: null }],
      timestamp: '2026-02-10T14:00:00.000Z',
      stale: false,
    });
    vi.mocked(getDirectionForTrip).mockReturnValue(1);

    const res = await request(app).get('/api/vehicles');

    expect(res.body.vehicles[0].direction).toBe(2); // static dir 1 → display 2
    expect(getDirectionForTrip).toHaveBeenCalledWith('trip-123');
  });

  it('sets direction to null when neither RT nor static available', async () => {
    vi.mocked(getCachedVehicles).mockReturnValue({
      data: [{ ...mockVehicle, directionId: null }],
      timestamp: '2026-02-10T14:00:00.000Z',
      stale: false,
    });
    vi.mocked(getDirectionForTrip).mockReturnValue(null);

    const res = await request(app).get('/api/vehicles');

    expect(res.body.vehicles[0].direction).toBeNull();
  });

  it('includes route shapes and stops', async () => {
    const res = await request(app).get('/api/vehicles');

    expect(res.body.route.direction1.shape).toEqual(mockShapes.direction1);
    expect(res.body.route.direction2.shape).toEqual(mockShapes.direction2);
    expect(res.body.route.direction1.stops).toHaveLength(1);
    expect(res.body.route.direction2.stops).toHaveLength(1);
  });

  it('includes stale flag', async () => {
    vi.mocked(getCachedVehicles).mockReturnValue({
      data: [mockVehicle],
      timestamp: '2026-02-10T14:00:00.000Z',
      stale: true,
    });

    const res = await request(app).get('/api/vehicles');

    expect(res.body.stale).toBe(true);
  });

  it('returns empty vehicles list when no buses active', async () => {
    vi.mocked(getCachedVehicles).mockReturnValue({
      data: [],
      timestamp: '2026-02-10T14:00:00.000Z',
      stale: false,
    });

    const res = await request(app).get('/api/vehicles');

    expect(res.body.vehicles).toHaveLength(0);
    expect(res.body.route).toBeDefined();
  });

  it('handles missing route data gracefully', async () => {
    vi.mocked(getRouteData).mockReturnValue(null);

    const res = await request(app).get('/api/vehicles');

    expect(res.status).toBe(200);
    expect(res.body.route.direction1.stops).toEqual([]);
    expect(res.body.route.direction2.stops).toEqual([]);
  });
});
