import { Router, Request, Response } from 'express';
import { getVehiclesFromDb, getCheckinCounts } from '../db';
import { getRouteData, getPrimaryShapes, getShapeAndCumDistForTrip } from '../services/gtfs-static';
import { projectVehicle } from '../services/projection';

export const vehiclesRouter = Router();

vehiclesRouter.get('/', (_req: Request, res: Response) => {
  const dbVehicles = getVehiclesFromDb();
  const routeData = getRouteData();
  const checkinCounts = getCheckinCounts();

  const vehicles = dbVehicles.map((v) => {
    const shapeData = getShapeAndCumDistForTrip(v.trip_id, v.direction);
    const projected = shapeData
      ? projectVehicle(v, shapeData.shape, shapeData.cumDist)
      : { latitude: v.latitude, longitude: v.longitude, distanceAlongRoute: v.distance_along_route };

    return {
      vehicleId: v.vehicle_id,
      tripId: v.trip_id,
      latitude: projected.latitude,
      longitude: projected.longitude,
      direction: v.direction,
      delaySeconds: v.delay_seconds,
      currentStatus: v.current_status,
      stopId: v.stop_id,
      timestamp: v.updated_at,
      checkinCount: checkinCounts[v.vehicle_id] || 0,
      speed: v.speed,
      distanceAlongRoute: projected.distanceAlongRoute,
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
    stale: false,
    timestamp: new Date().toISOString(),
  });
});
