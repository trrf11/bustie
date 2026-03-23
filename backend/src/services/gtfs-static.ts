import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { polylineCumulativeDistances } from '../utils/geo';

export interface StopInfo {
  stopId: string;
  name: string;
  latitude: number;
  longitude: number;
  sequence: number;
}

export interface RouteData {
  metadata: {
    extractedAt: string;
    gtfsLastModified: string;
    gtfsEtag: string;
  };
  routeIds: string[];
  tripIds: string[];
  shapes: Record<string, Array<[number, number]>>;
  tripShapeMap: Record<string, string>;
  tripDirectionMap: Record<string, number>;
  stops: Record<
    string,
    {
      direction1: StopInfo[];
      direction2: StopInfo[];
    }
  >;
}

// In-memory route data
let routeData: RouteData | null = null;

// Cached cumulative distances per shape (computed lazily, cleared on reload)
const cumDistCache = new Map<string, number[]>();

// Cached primary shape ID per direction (0-indexed: dir 0 = direction1, dir 1 = direction2)
let primaryShapeIds: { dir0: string | null; dir1: string | null } = { dir0: null, dir1: null };

// Fast lookup sets for GTFS-RT filtering
let routeIdSet: Set<string> = new Set();
let tripIdSet: Set<string> = new Set();

export function getRouteData(): RouteData | null {
  return routeData;
}

export function isKnownRouteId(routeId: string): boolean {
  return routeIdSet.has(routeId);
}

export function isKnownTripId(tripId: string): boolean {
  return tripIdSet.has(tripId);
}

export function getShapeForTrip(tripId: string): Array<[number, number]> | null {
  if (!routeData) return null;
  const shapeId = routeData.tripShapeMap[tripId];
  if (!shapeId) return null;
  return routeData.shapes[shapeId] || null;
}

/** Get cached cumulative distances for a shape. Computes lazily on first access. */
export function getShapeCumulativeDistances(shapeId: string): number[] | null {
  if (!routeData) return null;
  const shape = routeData.shapes[shapeId];
  if (!shape) return null;

  let cached = cumDistCache.get(shapeId);
  if (!cached) {
    cached = polylineCumulativeDistances(shape);
    cumDistCache.set(shapeId, cached);
  }
  return cached;
}

/** Get shape + cumulative distances for a trip. Falls back to primary shape for the direction. */
export function getShapeAndCumDistForTrip(tripId: string, direction?: number | null): { shape: Array<[number, number]>; cumDist: number[] } | null {
  if (!routeData) return null;

  // Try trip-specific shape first
  let shapeId: string | null = routeData.tripShapeMap[tripId] ?? null;

  // Fall back to primary shape for the direction (handles rotated trip IDs)
  if (!shapeId && direction != null) {
    // direction uses display values 1/2, map to GTFS 0/1
    shapeId = direction === 1 ? primaryShapeIds.dir0 : primaryShapeIds.dir1;
  }

  if (!shapeId) return null;
  const shape = routeData.shapes[shapeId];
  if (!shape) return null;
  const cumDist = getShapeCumulativeDistances(shapeId);
  if (!cumDist) return null;
  return { shape, cumDist };
}

export function getDirectionForTrip(tripId: string): number | null {
  if (!routeData) return null;
  const dir = routeData.tripDirectionMap[tripId];
  return dir !== undefined ? dir : null;
}

/**
 * Get the primary shape for each direction (the shape with the most points,
 * which is typically the full route).
 */
export function getPrimaryShapes(): { direction1: Array<[number, number]>; direction2: Array<[number, number]> } {
  const result = { direction1: [] as Array<[number, number]>, direction2: [] as Array<[number, number]> };
  if (!routeData) return result;

  // Group shapes by direction
  const shapesByDir: Record<number, string[]> = { 0: [], 1: [] };
  for (const [tripId, shapeId] of Object.entries(routeData.tripShapeMap)) {
    const dir = routeData.tripDirectionMap[tripId] ?? 0;
    if (!shapesByDir[dir].includes(shapeId)) {
      shapesByDir[dir].push(shapeId);
    }
  }

  // Pick the longest shape per direction
  for (const dir of [0, 1]) {
    let longestShape: Array<[number, number]> = [];
    let longestShapeId: string | null = null;
    for (const shapeId of shapesByDir[dir]) {
      const shape = routeData.shapes[shapeId];
      if (shape && shape.length > longestShape.length) {
        longestShape = shape;
        longestShapeId = shapeId;
      }
    }
    if (dir === 0) { result.direction1 = longestShape; primaryShapeIds.dir0 = longestShapeId; }
    else { result.direction2 = longestShape; primaryShapeIds.dir1 = longestShapeId; }
  }

  return result;
}

export async function loadRouteData(): Promise<void> {
  const dataPath = resolve(__dirname, '../data/route.json');

  if (!existsSync(dataPath)) {
    console.warn('route.json not found. Run `npm run extract-gtfs` first.');
    console.warn('Vehicle position filtering will not work until route data is available.');
    return;
  }

  const raw = readFileSync(dataPath, 'utf-8');
  routeData = JSON.parse(raw);

  if (routeData) {
    routeIdSet = new Set(routeData.routeIds);
    tripIdSet = new Set(routeData.tripIds);
    cumDistCache.clear();

    // Eagerly compute primary shape IDs so the collector can use them on first poll
    getPrimaryShapes();

    console.log(`Loaded route data (extracted: ${routeData.metadata.extractedAt})`);
    console.log(`  Route IDs: ${routeData.routeIds.join(', ')}`);
    console.log(`  Trip IDs: ${routeData.tripIds.length}`);
    console.log(`  Shapes: ${Object.keys(routeData.shapes).length}`);
  }
}
