import { config } from '../config';

interface OvApiPass {
  DataOwnerCode: string;
  LinePublicNumber: string;
  LinePlanningNumber: string;
  LineDirection: number;
  DestinationName50: string;
  JourneyNumber: number;
  TimingPointCode: string;
  TimingPointName: string;
  TimingPointTown: string;
  Latitude: number;
  Longitude: number;
  TargetArrivalTime: string;
  TargetDepartureTime: string;
  ExpectedArrivalTime: string;
  ExpectedDepartureTime: string;
  TripStopStatus: string;
  LastUpdateTimeStamp: string;
  JourneyStopType: string;
  TransportType: string;
}

export interface Departure {
  journeyNumber: number;
  scheduledDeparture: string;
  expectedDeparture: string;
  delayMinutes: number;
  status: string;
  isDelayed: boolean;
  destination: string;
  lineDirection: number;
}

export interface StopInfo {
  name: string;
  tpc: string;
  latitude: number;
  longitude: number;
}

export interface DepartureResult {
  stop: StopInfo | null;
  departures: Departure[];
  timestamp: string;
}

/**
 * Fetch departures for a given TimingPointCode from OVapi REST API.
 * Filters for bus 80 (CXX, LinePublicNumber=80, not N80).
 */
export async function fetchDepartures(tpc: string): Promise<DepartureResult> {
  const url = `${config.ovpiBaseUrl}/tpc/${tpc}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': config.userAgent,
      'Accept-Encoding': 'gzip',
    },
  });

  if (!res.ok) {
    throw new Error(`OVapi returned ${res.status} for TPC ${tpc}`);
  }

  const data = (await res.json()) as Record<string, any>;
  const tpcData = data[tpc];
  if (!tpcData) {
    return { stop: null, departures: [], timestamp: new Date().toISOString() };
  }

  let stopInfo: StopInfo | null = null;
  const departures: Departure[] = [];

  const passes: Record<string, OvApiPass> = tpcData.Passes || tpcData;

  for (const [_passId, pass] of Object.entries(passes)) {
    if (!pass || typeof pass !== 'object' || !pass.DataOwnerCode) continue;

    // Filter: only CXX bus 80, not night bus
    if (pass.DataOwnerCode !== config.dataOwnerCode) continue;
    if (pass.LinePublicNumber !== config.linePublicNumber) continue;
    if (pass.LinePlanningNumber === 'N286') continue; // night bus N80
    if (pass.TransportType !== 'BUS') continue;

    // Extract stop info from first matching pass
    if (!stopInfo) {
      stopInfo = {
        name: pass.TimingPointName,
        tpc: pass.TimingPointCode || tpc,
        latitude: pass.Latitude,
        longitude: pass.Longitude,
      };
    }

    const scheduled = pass.TargetDepartureTime || pass.TargetArrivalTime;
    const expected = pass.ExpectedDepartureTime || pass.ExpectedArrivalTime;

    if (!scheduled) continue;

    const scheduledMs = new Date(scheduled).getTime();
    const expectedMs = expected ? new Date(expected).getTime() : scheduledMs;
    const delayMinutes = Math.round((expectedMs - scheduledMs) / 60000);

    departures.push({
      journeyNumber: pass.JourneyNumber,
      scheduledDeparture: scheduled,
      expectedDeparture: expected || scheduled,
      delayMinutes,
      status: pass.TripStopStatus,
      isDelayed: delayMinutes >= 1,
      destination: pass.DestinationName50,
      lineDirection: pass.LineDirection,
    });
  }

  // Sort by expected departure time
  departures.sort(
    (a, b) => new Date(a.expectedDeparture).getTime() - new Date(b.expectedDeparture).getTime()
  );

  return {
    stop: stopInfo,
    departures,
    timestamp: new Date().toISOString(),
  };
}
