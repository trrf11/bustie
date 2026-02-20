import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

// Mock dependencies
vi.mock('../db', () => ({
  getVehiclesFromDb: vi.fn(),
}));
vi.mock('../services/gtfs-static', () => ({
  getRouteData: vi.fn(),
  getPrimaryShapes: vi.fn(),
}));

import { getVehiclesFromDb } from '../db';
import { getRouteData, getPrimaryShapes } from '../services/gtfs-static';

const app = createApp();

const mockDbVehicle = {
  vehicle_id: 'CXX-4001',
  trip_id: 'trip-123',
  direction: 1,
  latitude: 52.38,
  longitude: 4.65,
  delay_seconds: 120,
  updated_at: '2026-02-10T14:00:00.000Z',
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
  vi.mocked(getVehiclesFromDb).mockReset();
  vi.mocked(getRouteData).mockReset();
  vi.mocked(getPrimaryShapes).mockReset();

  vi.mocked(getVehiclesFromDb).mockReturnValue([mockDbVehicle]);
  vi.mocked(getRouteData).mockReturnValue(mockRouteData as any);
  vi.mocked(getPrimaryShapes).mockReturnValue(mockShapes);
});

describe('GET /api/vehicles', () => {
  it('returns vehicles from DB with correct field mapping', async () => {
    const res = await request(app).get('/api/vehicles');

    expect(res.status).toBe(200);
    expect(res.body.vehicles).toHaveLength(1);
    expect(res.body.vehicles[0].direction).toBe(1);
    expect(res.body.vehicles[0].vehicleId).toBe('CXX-4001');
    expect(res.body.vehicles[0].delaySeconds).toBe(120);
  });

  it('returns direction 2 when stored as 2', async () => {
    vi.mocked(getVehiclesFromDb).mockReturnValue([{ ...mockDbVehicle, direction: 2 }]);

    const res = await request(app).get('/api/vehicles');

    expect(res.body.vehicles[0].direction).toBe(2);
  });

  it('returns null direction when stored as null', async () => {
    vi.mocked(getVehiclesFromDb).mockReturnValue([{ ...mockDbVehicle, direction: null }]);

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

  it('returns empty vehicles list when no buses active', async () => {
    vi.mocked(getVehiclesFromDb).mockReturnValue([]);

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
