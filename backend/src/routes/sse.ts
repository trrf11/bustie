import { Router, Request, Response } from 'express';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { getVehiclesFromDb, getCheckinCounts } from '../db';
import { getRouteData, getPrimaryShapes, getShapeAndCumDistForTrip } from '../services/gtfs-static';
import { vehicleEventBus } from '../events';
import { projectVehicle } from '../services/projection';

// Read app version once at startup
const APP_VERSION = (() => {
  // Docker: root-package.json is copied alongside the app at /app/root-package.json
  const dockerPath = resolve(__dirname, '../../root-package.json');
  // Local dev: root package.json is 3 levels up from backend/dist/routes/
  const localPath = resolve(__dirname, '../../../package.json');
  const path = existsSync(dockerPath) ? dockerPath : localPath;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')).version as string;
  } catch {
    return 'unknown';
  }
})();

export const sseRouter = Router();

const MAX_CONNECTIONS_PER_IP = 5;
const MAX_TOTAL_CONNECTIONS = 100;

const connectionsPerIp = new Map<string, number>();
let totalConnections = 0;

function buildVehiclesPayload() {
  const dbVehicles = getVehiclesFromDb();
  const checkinCounts = getCheckinCounts();
  return dbVehicles.map((v) => {
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
  const ip = req.ip || 'unknown';

  // Check global connection limit
  if (totalConnections >= MAX_TOTAL_CONNECTIONS) {
    res.status(503).json({ error: 'Server at capacity. Try again later.' });
    return;
  }

  // Check per-IP connection limit
  const currentIpConns = connectionsPerIp.get(ip) || 0;
  if (currentIpConns >= MAX_CONNECTIONS_PER_IP) {
    res.status(429).json({ error: 'Too many connections. Close other tabs and retry.' });
    return;
  }

  // Track connection
  connectionsPerIp.set(ip, currentIpConns + 1);
  totalConnections++;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-store, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Disable Nagle's algorithm so small SSE writes (like checkin counts)
  // are pushed to the client immediately instead of being buffered.
  req.socket.setNoDelay(true);

  // Flush proxy buffers: reverse proxies (Nginx Proxy Manager, Cloudflare)
  // often buffer the first 4-8 KB before flushing. Sending 2 KB of SSE
  // comment padding forces the buffer to fill and flush promptly.
  res.write(`:${' '.repeat(2048)}\n`);

  // Send initial payload with vehicles + route data
  const initPayload = {
    vehicles: buildVehiclesPayload(),
    route: buildRoutePayload(),
    stale: false,
    timestamp: new Date().toISOString(),
    version: APP_VERSION,
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

  // Push lightweight checkin count updates instantly
  const onCheckinUpdate = () => {
    const counts = getCheckinCounts();
    res.write(`event: checkins\ndata: ${JSON.stringify({ counts })}\n\n`);
  };

  vehicleEventBus.on('checkins:updated', onCheckinUpdate);

  // Heartbeat every 25s to keep connection alive through Nginx
  const heartbeat = setInterval(() => {
    res.write(':heartbeat\n\n');
  }, 25_000);

  // Cleanup on client disconnect
  req.on('close', () => {
    vehicleEventBus.off('vehicles:updated', onUpdate);
    vehicleEventBus.off('checkins:updated', onCheckinUpdate);
    clearInterval(heartbeat);

    const remaining = (connectionsPerIp.get(ip) || 1) - 1;
    if (remaining <= 0) {
      connectionsPerIp.delete(ip);
    } else {
      connectionsPerIp.set(ip, remaining);
    }
    totalConnections--;
  });
});
