import { Router, Request, Response } from 'express';
import { getVehiclesFromDb } from '../db';
import { getRouteData, getPrimaryShapes } from '../services/gtfs-static';

export const vehiclesRouter = Router();

vehiclesRouter.get('/', (_req: Request, res: Response) => {
  const dbVehicles = getVehiclesFromDb();
  const routeData = getRouteData();

  const vehicles = dbVehicles.map((v) => ({
    vehicleId: v.vehicle_id,
    tripId: v.trip_id,
    latitude: v.latitude,
    longitude: v.longitude,
    direction: v.direction,
    delaySeconds: v.delay_seconds,
    timestamp: v.updated_at,
  }));

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
