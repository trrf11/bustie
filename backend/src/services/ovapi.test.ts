import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchDepartures } from './ovapi';

// Fixture: realistic OVapi response for TPC 55230110
const ovApiFixture = {
  '55230110': {
    Passes: {
      'pass-1': {
        DataOwnerCode: 'CXX',
        LinePublicNumber: '80',
        LinePlanningNumber: 'N080',
        LineDirection: 1,
        DestinationName50: 'Amsterdam Elandsgracht',
        JourneyNumber: 201,
        TimingPointCode: '55230110',
        TimingPointName: 'Halfweg, Station Halfweg-Zwanenburg',
        TimingPointTown: 'Halfweg',
        Latitude: 52.3712,
        Longitude: 4.7216,
        TargetDepartureTime: '2026-02-10T14:15:00',
        ExpectedDepartureTime: '2026-02-10T14:20:00',
        TripStopStatus: 'DRIVING',
        TransportType: 'BUS',
        JourneyStopType: 'INTERMEDIATE',
        LastUpdateTimeStamp: '2026-02-10T14:10:00',
      },
      'pass-2': {
        DataOwnerCode: 'CXX',
        LinePublicNumber: '80',
        LinePlanningNumber: 'N080',
        LineDirection: 2,
        DestinationName50: 'Zandvoort Centrum',
        JourneyNumber: 202,
        TimingPointCode: '55230110',
        TimingPointName: 'Halfweg, Station Halfweg-Zwanenburg',
        TimingPointTown: 'Halfweg',
        Latitude: 52.3712,
        Longitude: 4.7216,
        TargetDepartureTime: '2026-02-10T14:30:00',
        ExpectedDepartureTime: '2026-02-10T14:30:00',
        TripStopStatus: 'PLANNED',
        TransportType: 'BUS',
        JourneyStopType: 'INTERMEDIATE',
        LastUpdateTimeStamp: '2026-02-10T14:10:00',
      },
      // Should be filtered out: different operator
      'pass-3': {
        DataOwnerCode: 'GVB',
        LinePublicNumber: '22',
        LinePlanningNumber: 'G022',
        LineDirection: 1,
        DestinationName50: 'Sloterdijk',
        JourneyNumber: 999,
        TimingPointCode: '55230110',
        TimingPointName: 'Halfweg, Station Halfweg-Zwanenburg',
        Latitude: 52.3712,
        Longitude: 4.7216,
        TargetDepartureTime: '2026-02-10T14:45:00',
        ExpectedDepartureTime: '2026-02-10T14:45:00',
        TripStopStatus: 'PLANNED',
        TransportType: 'BUS',
        LastUpdateTimeStamp: '2026-02-10T14:10:00',
      },
      // Should be filtered out: night bus N80
      'pass-4': {
        DataOwnerCode: 'CXX',
        LinePublicNumber: '80',
        LinePlanningNumber: 'N286',
        LineDirection: 1,
        DestinationName50: 'Amsterdam Elandsgracht',
        JourneyNumber: 888,
        TimingPointCode: '55230110',
        TimingPointName: 'Halfweg',
        Latitude: 52.3712,
        Longitude: 4.7216,
        TargetDepartureTime: '2026-02-10T01:00:00',
        ExpectedDepartureTime: '2026-02-10T01:00:00',
        TripStopStatus: 'PLANNED',
        TransportType: 'BUS',
        LastUpdateTimeStamp: '2026-02-10T00:50:00',
      },
    },
  },
};

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('fetchDepartures', () => {
  it('parses OVapi response and returns departures', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ovApiFixture,
    } as Response);

    const result = await fetchDepartures('55230110');

    expect(result.stop).toBeDefined();
    expect(result.stop?.name).toBe('Halfweg, Station Halfweg-Zwanenburg');
    expect(result.stop?.tpc).toBe('55230110');
    expect(result.departures).toHaveLength(2); // Only CXX bus 80, not GVB or N80
  });

  it('filters out non-CXX operators', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ovApiFixture,
    } as Response);

    const result = await fetchDepartures('55230110');

    const journeys = result.departures.map((d) => d.journeyNumber);
    expect(journeys).not.toContain(999); // GVB
  });

  it('filters out night bus N80', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ovApiFixture,
    } as Response);

    const result = await fetchDepartures('55230110');

    const journeys = result.departures.map((d) => d.journeyNumber);
    expect(journeys).not.toContain(888); // N286 night bus
  });

  it('calculates delay in minutes', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ovApiFixture,
    } as Response);

    const result = await fetchDepartures('55230110');

    const delayed = result.departures.find((d) => d.journeyNumber === 201);
    expect(delayed?.delayMinutes).toBe(5); // 14:20 - 14:15 = 5 min
    expect(delayed?.isDelayed).toBe(true);

    const onTime = result.departures.find((d) => d.journeyNumber === 202);
    expect(onTime?.delayMinutes).toBe(0);
    expect(onTime?.isDelayed).toBe(false);
  });

  it('sorts departures by expected departure time', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ovApiFixture,
    } as Response);

    const result = await fetchDepartures('55230110');

    const times = result.departures.map((d) => new Date(d.expectedDeparture).getTime());
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]);
    }
  });

  it('returns empty departures for unknown TPC', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ '55230110': null }),
    } as Response);

    const result = await fetchDepartures('55230110');

    expect(result.stop).toBeNull();
    expect(result.departures).toHaveLength(0);
  });

  it('throws on HTTP error', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: false,
      status: 429,
    } as Response);

    await expect(fetchDepartures('55230110')).rejects.toThrow('OVapi returned 429');
  });

  it('throws on network error', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new Error('Network error'));

    await expect(fetchDepartures('55230110')).rejects.toThrow('Network error');
  });

  it('handles response without Passes wrapper', async () => {
    // Some OVapi responses have passes directly at the TPC level
    const directFixture = {
      '55230110': {
        'pass-1': {
          DataOwnerCode: 'CXX',
          LinePublicNumber: '80',
          LinePlanningNumber: 'N080',
          LineDirection: 1,
          DestinationName50: 'Amsterdam Elandsgracht',
          JourneyNumber: 301,
          TimingPointCode: '55230110',
          TimingPointName: 'Halfweg',
          Latitude: 52.37,
          Longitude: 4.72,
          TargetDepartureTime: '2026-02-10T15:00:00',
          ExpectedDepartureTime: '2026-02-10T15:00:00',
          TripStopStatus: 'PLANNED',
          TransportType: 'BUS',
          LastUpdateTimeStamp: '2026-02-10T14:50:00',
        },
      },
    };

    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => directFixture,
    } as Response);

    const result = await fetchDepartures('55230110');

    expect(result.departures).toHaveLength(1);
    expect(result.departures[0].journeyNumber).toBe(301);
  });
});
