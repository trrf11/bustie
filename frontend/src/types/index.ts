export interface StopInfo {
  stopId: string;
  name: string;
  latitude: number;
  longitude: number;
  sequence: number;
}

export interface Vehicle {
  vehicleId: string;
  tripId: string;
  latitude: number;
  longitude: number;
  direction: number | null;
  delaySeconds: number;
  currentStatus: string;
  stopId: string;
  timestamp: string;
}

export interface RouteDirection {
  name: string;
  stops: StopInfo[];
  shape: Array<[number, number]>;
}

export interface VehiclesResponse {
  vehicles: Vehicle[];
  route: {
    direction1: RouteDirection;
    direction2: RouteDirection;
  };
  stale: boolean;
  timestamp: string;
}

export interface Departure {
  journeyNumber: number;
  scheduledDeparture: string;
  expectedDeparture: string;
  delayMinutes: number;
  leaveBy: string | null;
  status: string;
  isDelayed: boolean;
  destination: string;
  lineDirection: number;
}

export interface DeparturesResponse {
  stop: {
    name: string;
    tpc: string;
    latitude: number;
    longitude: number;
  } | null;
  direction: number;
  destination: string;
  walkTimeMinutes: number;
  departures: Departure[];
  stale: boolean;
  timestamp: string;
}

export interface SavedTrip {
  id: string;
  stopName: string;
  tpc: string;
  direction: number;
  directionLabel: string;
  walkTimeMinutes: number;
}

export interface DelayRecord {
  date: string;
  journeyNumber: number;
  stop: string;
  scheduledTime: string;
  actualTime: string;
  delayMinutes: number;
  direction: number;
}

export interface DelayStatsResponse {
  period: string;
  worstDelays: DelayRecord[];
  averageDelayMinutes: number;
  onTimePercentage: number;
  totalTripsTracked: number;
}
