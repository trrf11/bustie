import { Router, Request, Response } from 'express';
import { getCachedVehicles } from '../services/polling';
import { getRouteData, getDirectionForTrip, getPrimaryShapes } from '../services/gtfs-static';

export const vehiclesRouter = Router();

vehiclesRouter.get('/', (_req: Request, res: Response) => {
  const cached = getCachedVehicles();
  const routeData = getRouteData();

  // Enrich vehicles with direction info
  const vehicles = cached.data.map((v) => {
    // Use direction from GTFS-RT feed directly, fallback to static lookup
    const rtDirection = v.directionId;
    const staticDirection = getDirectionForTrip(v.tripId);
    const rawDirection = rtDirection !== null ? rtDirection : staticDirection;

    return {
      vehicleId: v.vehicleId,
      tripId: v.tripId,
      latitude: v.latitude,
      longitude: v.longitude,
      direction: rawDirection !== null ? (rawDirection === 0 ? 1 : 2) : null, // Map GTFS 0/1 to display 1/2
      delaySeconds: v.delaySeconds,
      currentStatus: v.currentStatus,
      stopId: v.stopId,
      timestamp: v.timestamp,
    };
  });

  // Get route shapes and stops
  const shapes = getPrimaryShapes();
  const stops = routeData?.stops?.route || { direction1: [], direction2: [] };

  res.json({
    vehicles,
    route: {
      direction1: {
        name: 'Zandvoort → Amsterdam',
        stops: stops.direction1,
        shape: shapes.direction1,
      },
      direction2: {
        name: 'Amsterdam → Zandvoort',
        stops: stops.direction2,
        shape: shapes.direction2,
      },
    },
    stale: cached.stale,
    timestamp: cached.timestamp,
  });
});
