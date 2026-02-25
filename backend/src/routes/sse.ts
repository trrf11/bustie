import { Router, Request, Response } from 'express';
import { getVehiclesFromDb } from '../db';
import { getRouteData, getPrimaryShapes } from '../services/gtfs-static';
import { vehicleEventBus } from '../events';

export const sseRouter = Router();

function buildVehiclesPayload() {
  const dbVehicles = getVehiclesFromDb();
  return dbVehicles.map((v) => ({
    vehicleId: v.vehicle_id,
    tripId: v.trip_id,
    latitude: v.latitude,
    longitude: v.longitude,
    direction: v.direction,
    delaySeconds: v.delay_seconds,
    timestamp: v.updated_at,
  }));
}

function buildRoutePayload() {
  const routeData = getRouteData();
  const shapes = getPrimaryShapes();
  const stops = routeData?.stops?.route || { direction1: [], direction2: [] };

  return {
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
  };
}

sseRouter.get('/', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send initial payload with vehicles + route data
  const initPayload = {
    vehicles: buildVehiclesPayload(),
    route: buildRoutePayload(),
    stale: false,
    timestamp: new Date().toISOString(),
  };
  res.write(`event: init\ndata: ${JSON.stringify(initPayload)}\n\n`);

  // Push vehicle updates whenever the collector stores new data
  const onUpdate = () => {
    const payload = {
      vehicles: buildVehiclesPayload(),
      stale: false,
      timestamp: new Date().toISOString(),
    };
    res.write(`event: vehicles\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  vehicleEventBus.on('vehicles:updated', onUpdate);

  // Heartbeat every 25s to keep connection alive through Nginx
  const heartbeat = setInterval(() => {
    res.write(':heartbeat\n\n');
  }, 25_000);

  // Cleanup on client disconnect
  req.on('close', () => {
    vehicleEventBus.off('vehicles:updated', onUpdate);
    clearInterval(heartbeat);
  });
});
