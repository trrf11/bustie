import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock gtfs-static before importing gtfs-rt
vi.mock('./gtfs-static', () => ({
  isKnownRouteId: vi.fn(),
  isKnownTripId: vi.fn(),
}));

// Create the mock decode fn we'll control from tests
const mockDecode = vi.fn();

// Mock protobufjs — the module uses `import protobuf from 'protobufjs'`
// then calls `protobuf.load(...)` which returns a Root with `lookupType()`
vi.mock('protobufjs', () => ({
  default: {
    load: vi.fn().mockResolvedValue({
      lookupType: vi.fn().mockReturnValue({
        decode: mockDecode,
      }),
    }),
  },
}));

import { isKnownRouteId, isKnownTripId } from './gtfs-static';

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn();
  mockDecode.mockReset();
  vi.mocked(isKnownRouteId).mockReturnValue(false);
  vi.mocked(isKnownTripId).mockReturnValue(false);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function createFeedEntity(overrides: Record<string, any> = {}) {
  return {
    vehicle: {
      trip: {
        routeId: 'CXX:N080:80',
        tripId: 'trip-100',
        directionId: 0,
      },
      position: {
        latitude: 52.38,
        longitude: 4.65,
      },
      vehicle: {
        id: 'CXX-4001',
        label: 'Bus 4001',
      },
      currentStatus: 2, // IN_TRANSIT_TO
      stopId: 'stop-42',
      timestamp: 1707566400, // Unix seconds
      '.transit_realtime.ovapiVehiclePosition': {
        delay: 90,
      },
      ...overrides,
    },
  };
}

// We need to dynamically import after mocks are set up
let fetchVehiclePositions: typeof import('./gtfs-rt').fetchVehiclePositions;

beforeEach(async () => {
  // Re-import to get fresh module with mocks applied
  const mod = await import('./gtfs-rt');
  fetchVehiclePositions = mod.fetchVehiclePositions;
});

describe('fetchVehiclePositions', () => {
  it('decodes protobuf feed and returns filtered vehicles', async () => {
    vi.mocked(isKnownRouteId).mockReturnValue(true);

    const entity = createFeedEntity();
    mockDecode.mockReturnValue({ entity: [entity] });

    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as Response);

    const vehicles = await fetchVehiclePositions();

    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].vehicleId).toBe('CXX-4001');
    expect(vehicles[0].routeId).toBe('CXX:N080:80');
    expect(vehicles[0].directionId).toBe(0);
    expect(vehicles[0].latitude).toBe(52.38);
    expect(vehicles[0].longitude).toBe(4.65);
  });

  it('extracts OVapi delay extension', async () => {
    vi.mocked(isKnownRouteId).mockReturnValue(true);

    const entity = createFeedEntity();
    mockDecode.mockReturnValue({ entity: [entity] });

    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as Response);

    const vehicles = await fetchVehiclePositions();

    expect(vehicles[0].delaySeconds).toBe(90);
  });

  it('sets delaySeconds to 0 when extension is missing', async () => {
    vi.mocked(isKnownRouteId).mockReturnValue(true);

    const entity = createFeedEntity({
      '.transit_realtime.ovapiVehiclePosition': undefined,
    });
    mockDecode.mockReturnValue({ entity: [entity] });

    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as Response);

    const vehicles = await fetchVehiclePositions();

    expect(vehicles[0].delaySeconds).toBe(0);
  });

  it('filters out non-bus-80 entities', async () => {
    vi.mocked(isKnownRouteId).mockImplementation((id) => id === 'CXX:N080:80');
    vi.mocked(isKnownTripId).mockReturnValue(false);

    const bus80 = createFeedEntity();
    const otherBus = createFeedEntity({
      trip: { routeId: 'GVB:22', tripId: 'trip-other', directionId: 0 },
    });

    mockDecode.mockReturnValue({ entity: [bus80, otherBus] });

    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as Response);

    const vehicles = await fetchVehiclePositions();

    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].routeId).toBe('CXX:N080:80');
  });

  it('includes vehicle if tripId is known (fallback)', async () => {
    vi.mocked(isKnownRouteId).mockReturnValue(false);
    vi.mocked(isKnownTripId).mockImplementation((id) => id === 'trip-100');

    const entity = createFeedEntity();
    mockDecode.mockReturnValue({ entity: [entity] });

    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as Response);

    const vehicles = await fetchVehiclePositions();

    expect(vehicles).toHaveLength(1);
  });

  it('maps currentStatus enum to string', async () => {
    vi.mocked(isKnownRouteId).mockReturnValue(true);

    for (const [statusNum, expected] of [
      [0, 'INCOMING_AT'],
      [1, 'STOPPED_AT'],
      [2, 'IN_TRANSIT_TO'],
    ] as const) {
      const entity = createFeedEntity({ currentStatus: statusNum });
      mockDecode.mockReturnValue({ entity: [entity] });

      vi.mocked(globalThis.fetch).mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(0),
      } as Response);

      const vehicles = await fetchVehiclePositions();
      expect(vehicles[0].currentStatus).toBe(expected);
    }
  });

  it('skips entities without position', async () => {
    vi.mocked(isKnownRouteId).mockReturnValue(true);

    const entity = createFeedEntity({ position: null });
    mockDecode.mockReturnValue({ entity: [entity] });

    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as Response);

    const vehicles = await fetchVehiclePositions();

    expect(vehicles).toHaveLength(0);
  });

  it('skips entities without trip', async () => {
    const entity = { vehicle: { position: { latitude: 52, longitude: 4 } } };
    mockDecode.mockReturnValue({ entity: [entity] });

    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as Response);

    const vehicles = await fetchVehiclePositions();

    expect(vehicles).toHaveLength(0);
  });

  it('throws on HTTP error', async () => {
    mockDecode.mockReturnValue({ entity: [] });

    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    await expect(fetchVehiclePositions()).rejects.toThrow('GTFS-RT returned 500');
  });

  it('handles empty feed', async () => {
    vi.mocked(isKnownRouteId).mockReturnValue(true);
    mockDecode.mockReturnValue({ entity: [] });

    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as Response);

    const vehicles = await fetchVehiclePositions();

    expect(vehicles).toHaveLength(0);
  });
});
