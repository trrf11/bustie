/**
 * GTFS static data extraction service.
 * Downloads the NL GTFS zip, parses bus 80 route/trip/shape/stop data,
 * and writes route.json atomically. Used for automatic refresh when
 * trip/route IDs rotate in the upstream feed.
 */

import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
} from 'fs';
import { join, dirname, resolve } from 'path';
import { pipeline } from 'stream/promises';
import { createInterface } from 'readline';
import { execSync } from 'child_process';
import { Readable } from 'stream';
import { config } from '../config';
import { loadRouteData, RouteData } from './gtfs-static';
import { invalidateStopIdCache } from './stop-mapping';

const LOG_PREFIX = '[gtfs-extract]';

// Prevent concurrent refresh attempts
let refreshInProgress = false;

// Resolve paths relative to config.dbPath parent (the data volume)
function getTmpDir(): string {
  return join(dirname(config.dbPath), '.gtfs-tmp');
}

function getOutputPath(): string {
  return resolve(__dirname, '../data/route.json');
}

// --- CSV parsing (copied from scripts/extract-gtfs.ts) ---

function parseCsv(content: string): Array<Record<string, string>> {
  const lines = content.split('\n').filter((l) => l.trim());
  if (lines.length === 0) return [];

  const headerLine = lines[0].replace(/^\uFEFF/, '');
  const headers = headerLine.split(',').map((h) => h.trim().replace(/"/g, ''));
  const rows: Array<Record<string, string>> = [];

  for (let i = 1; i < lines.length; i++) {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (const char of lines[i]) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());

    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || '';
    });
    rows.push(row);
  }

  return rows;
}

function extractFile(zipPath: string, filename: string, tmpDir: string): string {
  const outPath = join(tmpDir, filename);
  try {
    execSync(`unzip -o -j "${zipPath}" "${filename}" -d "${tmpDir}"`, {
      stdio: 'pipe',
    });
  } catch {
    throw new Error(`Failed to extract ${filename} from zip`);
  }
  return readFileSync(outPath, 'utf-8');
}

async function streamCsvFromZip(
  zipPath: string,
  filename: string,
  tmpDir: string,
  onRow: (row: Record<string, string>) => void
): Promise<void> {
  const outPath = join(tmpDir, filename);
  try {
    execSync(`unzip -o -j "${zipPath}" "${filename}" -d "${tmpDir}"`, {
      stdio: 'pipe',
    });
  } catch {
    throw new Error(`Failed to extract ${filename} from zip`);
  }

  return new Promise((resolve, reject) => {
    const rl = createInterface({
      input: createReadStream(outPath, { encoding: 'utf-8' }),
      crlfDelay: Infinity,
    });

    let headers: string[] | null = null;

    rl.on('line', (line) => {
      if (!line.trim()) return;

      if (!headers) {
        headers = line
          .replace(/^\uFEFF/, '')
          .split(',')
          .map((h) => h.trim().replace(/"/g, ''));
        return;
      }

      const values: string[] = [];
      let current = '';
      let inQuotes = false;

      for (const char of line) {
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          values.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.trim());

      const row: Record<string, string> = {};
      headers.forEach((h, idx) => {
        row[h] = values[idx] || '';
      });

      onRow(row);
    });

    rl.on('close', () => resolve());
    rl.on('error', reject);
  });
}

// --- Public API ---

/**
 * HEAD-only check: has the GTFS feed changed since our last download?
 * Compares ETag from the server against the ETag stored in route.json metadata.
 */
export async function checkGtfsFeedChanged(): Promise<{
  changed: boolean;
  etag: string;
  lastModified: string;
}> {
  const res = await fetch(config.gtfsStaticUrl, {
    method: 'HEAD',
    headers: { 'User-Agent': config.userAgent },
  });

  const etag = res.headers.get('etag') || '';
  const lastModified = res.headers.get('last-modified') || '';

  // Compare against current route.json metadata
  const outputPath = getOutputPath();
  if (existsSync(outputPath)) {
    try {
      const raw = readFileSync(outputPath, 'utf-8');
      const data = JSON.parse(raw) as RouteData;
      if (data.metadata?.gtfsEtag === etag) {
        return { changed: false, etag, lastModified };
      }
    } catch {
      // Corrupt route.json — treat as changed
    }
  }

  return { changed: true, etag, lastModified };
}

/**
 * Full refresh pipeline: download zip (if ETag changed), extract CSVs,
 * parse bus 80 data, write route.json atomically, and reload in-memory data.
 * Returns true if route.json was updated, false if skipped (unchanged or error).
 */
export async function refreshGtfsData(): Promise<boolean> {
  if (refreshInProgress) {
    console.log(`${LOG_PREFIX} Refresh already in progress, skipping`);
    return false;
  }

  refreshInProgress = true;
  try {
    return await doRefresh();
  } catch (err) {
    console.error(`${LOG_PREFIX} Refresh failed:`, (err as Error).message);
    return false;
  } finally {
    refreshInProgress = false;
  }
}

async function doRefresh(): Promise<boolean> {
  const tmpDir = getTmpDir();
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

  const zipPath = join(tmpDir, 'gtfs-nl.zip');

  // Check if feed has changed
  console.log(`${LOG_PREFIX} Checking GTFS feed headers...`);
  const headRes = await fetch(config.gtfsStaticUrl, {
    method: 'HEAD',
    headers: { 'User-Agent': config.userAgent },
  });
  const lastModified = headRes.headers.get('last-modified') || '';
  const etag = headRes.headers.get('etag') || '';

  // Check cached zip metadata
  const metaPath = join(tmpDir, 'gtfs-meta.json');
  if (existsSync(metaPath) && existsSync(zipPath)) {
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    if (meta.etag === etag && meta.lastModified === lastModified) {
      // Zip hasn't changed but route.json might be missing/corrupt — check
      const outputPath = getOutputPath();
      if (existsSync(outputPath)) {
        try {
          const data = JSON.parse(readFileSync(outputPath, 'utf-8')) as RouteData;
          if (data.metadata?.gtfsEtag === etag) {
            console.log(`${LOG_PREFIX} Feed unchanged, skipping refresh`);
            return false;
          }
        } catch {
          // Corrupt route.json, re-extract from cached zip
        }
      }
      console.log(`${LOG_PREFIX} Using cached zip, re-extracting route.json...`);
    } else {
      // Feed changed, download new zip
      await downloadZip(zipPath);
      writeFileSync(metaPath, JSON.stringify({ lastModified, etag }));
    }
  } else {
    // No cached zip, download
    await downloadZip(zipPath);
    writeFileSync(metaPath, JSON.stringify({ lastModified, etag }));
  }

  // Parse the GTFS data
  const routeData = await parseGtfsData(zipPath, tmpDir, lastModified, etag);
  if (!routeData) return false;

  // Write atomically: write to .tmp then rename
  const outputPath = getOutputPath();
  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const tmpOutputPath = outputPath + '.tmp';
  writeFileSync(tmpOutputPath, JSON.stringify(routeData, null, 2));
  renameSync(tmpOutputPath, outputPath);

  console.log(
    `${LOG_PREFIX} Wrote route.json (${routeData.tripIds.length} trips, ${Object.keys(routeData.shapes).length} shapes)`
  );

  // Reload in-memory data
  await loadRouteData();
  invalidateStopIdCache();

  console.log(`${LOG_PREFIX} Route data reloaded successfully`);
  return true;
}

async function downloadZip(zipPath: string): Promise<void> {
  console.log(`${LOG_PREFIX} Downloading GTFS feed...`);
  const res = await fetch(config.gtfsStaticUrl, {
    headers: { 'User-Agent': config.userAgent },
  });
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download GTFS: ${res.status}`);
  }

  const fileStream = createWriteStream(zipPath);
  await pipeline(Readable.fromWeb(res.body as any), fileStream);
  console.log(`${LOG_PREFIX} Download complete`);
}

async function parseGtfsData(
  zipPath: string,
  tmpDir: string,
  lastModified: string,
  etag: string
): Promise<RouteData | null> {
  // Step 1: Find Connexxion agency
  console.log(`${LOG_PREFIX} Parsing agency.txt...`);
  const agencyData = parseCsv(extractFile(zipPath, 'agency.txt', tmpDir));
  const connexxionAgency = agencyData.find(
    (a) =>
      a.agency_name?.toLowerCase().includes('connexxion') ||
      a.agency_id?.toUpperCase() === 'CXX'
  );
  if (!connexxionAgency) {
    console.error(`${LOG_PREFIX} Could not find Connexxion agency`);
    return null;
  }

  // Step 2: Find bus 80 routes
  console.log(`${LOG_PREFIX} Parsing routes.txt...`);
  const routesData = parseCsv(extractFile(zipPath, 'routes.txt', tmpDir));
  const bus80Routes = routesData.filter(
    (r) =>
      r.agency_id === connexxionAgency.agency_id &&
      r.route_short_name === '80' &&
      r.route_type === '3'
  );
  if (bus80Routes.length === 0) {
    console.error(`${LOG_PREFIX} Could not find bus 80 routes`);
    return null;
  }
  const routeIds = bus80Routes.map((r) => r.route_id);
  console.log(`${LOG_PREFIX} Found ${bus80Routes.length} route(s): ${routeIds.join(', ')}`);

  // Step 3: Find all trips
  console.log(`${LOG_PREFIX} Parsing trips.txt...`);
  const tripsData = parseCsv(extractFile(zipPath, 'trips.txt', tmpDir));
  const bus80Trips = tripsData.filter((t) => routeIds.includes(t.route_id));
  console.log(`${LOG_PREFIX} Found ${bus80Trips.length} trips`);

  const tripIds = bus80Trips.map((t) => t.trip_id);
  const tripShapeMap: Record<string, string> = {};
  const tripDirectionMap: Record<string, number> = {};
  const shapeIds = new Set<string>();

  for (const trip of bus80Trips) {
    tripShapeMap[trip.trip_id] = trip.shape_id;
    tripDirectionMap[trip.trip_id] = parseInt(trip.direction_id || '0', 10);
    if (trip.shape_id) shapeIds.add(trip.shape_id);
  }

  // Step 4: Extract shapes
  console.log(`${LOG_PREFIX} Parsing shapes.txt...`);
  const shapesData = parseCsv(extractFile(zipPath, 'shapes.txt', tmpDir));
  const shapesWithSeq: Record<string, Array<{ lat: number; lng: number; seq: number }>> = {};

  for (const row of shapesData) {
    if (!shapeIds.has(row.shape_id)) continue;
    if (!shapesWithSeq[row.shape_id]) shapesWithSeq[row.shape_id] = [];
    shapesWithSeq[row.shape_id].push({
      lat: parseFloat(row.shape_pt_lat),
      lng: parseFloat(row.shape_pt_lon),
      seq: parseInt(row.shape_pt_sequence, 10),
    });
  }

  const sortedShapes: Record<string, Array<[number, number]>> = {};
  for (const [shapeId, points] of Object.entries(shapesWithSeq)) {
    points.sort((a, b) => a.seq - b.seq);
    sortedShapes[shapeId] = points.map((p) => [p.lat, p.lng]);
  }
  console.log(`${LOG_PREFIX} Extracted ${Object.keys(sortedShapes).length} shapes`);

  // Step 5: Extract stops via stop_times.txt
  console.log(`${LOG_PREFIX} Parsing stop_times.txt (pass 1: counting)...`);
  const tripIdSet = new Set(tripIds);
  const stopCountPerTrip: Record<string, number> = {};

  await streamCsvFromZip(zipPath, 'stop_times.txt', tmpDir, (row) => {
    if (!tripIdSet.has(row.trip_id)) return;
    stopCountPerTrip[row.trip_id] = (stopCountPerTrip[row.trip_id] || 0) + 1;
  });

  // Pick representative trip per direction (most stops)
  const tripsByDirection: Record<number, string> = {};
  for (const trip of bus80Trips) {
    const dir = parseInt(trip.direction_id || '0', 10);
    const count = stopCountPerTrip[trip.trip_id] || 0;
    const existingTripId = tripsByDirection[dir];
    if (!existingTripId || count > (stopCountPerTrip[existingTripId] || 0)) {
      tripsByDirection[dir] = trip.trip_id;
    }
  }

  const representativeTripIds = new Set(Object.values(tripsByDirection));
  const stopIdsNeeded = new Set<string>();
  const stopSequences: Record<string, Array<{ stopId: string; sequence: number }>> = {
    direction1: [],
    direction2: [],
  };

  const repTripDirMap: Record<string, string> = {};
  for (const [dirStr, tripId] of Object.entries(tripsByDirection)) {
    const dir = parseInt(dirStr, 10);
    repTripDirMap[tripId] = dir === 0 ? 'direction1' : 'direction2';
  }

  console.log(`${LOG_PREFIX} Parsing stop_times.txt (pass 2: stop sequences)...`);
  await streamCsvFromZip(zipPath, 'stop_times.txt', tmpDir, (row) => {
    if (!representativeTripIds.has(row.trip_id)) return;
    const dirKey = repTripDirMap[row.trip_id];
    if (!dirKey) return;
    stopIdsNeeded.add(row.stop_id);
    stopSequences[dirKey].push({
      stopId: row.stop_id,
      sequence: parseInt(row.stop_sequence, 10),
    });
  });

  stopSequences.direction1.sort((a, b) => a.sequence - b.sequence);
  stopSequences.direction2.sort((a, b) => a.sequence - b.sequence);

  // Step 6: Get stop details
  console.log(`${LOG_PREFIX} Parsing stops.txt...`);
  const stopsData = parseCsv(extractFile(zipPath, 'stops.txt', tmpDir));
  const stopMap: Record<string, { name: string; lat: number; lng: number }> = {};

  for (const stop of stopsData) {
    if (stopIdsNeeded.has(stop.stop_id)) {
      stopMap[stop.stop_id] = {
        name: stop.stop_name,
        lat: parseFloat(stop.stop_lat),
        lng: parseFloat(stop.stop_lon),
      };
    }
  }

  const stops: RouteData['stops'] = { route: { direction1: [], direction2: [] } };
  for (const dirKey of ['direction1', 'direction2'] as const) {
    stops.route[dirKey] = stopSequences[dirKey].map((ss) => {
      const stop = stopMap[ss.stopId];
      return {
        stopId: ss.stopId,
        name: stop?.name || 'Unknown',
        latitude: stop?.lat || 0,
        longitude: stop?.lng || 0,
        sequence: ss.sequence,
      };
    });
  }

  return {
    metadata: {
      extractedAt: new Date().toISOString(),
      gtfsLastModified: lastModified,
      gtfsEtag: etag,
    },
    routeIds,
    tripIds,
    shapes: sortedShapes,
    tripShapeMap,
    tripDirectionMap,
    stops,
  };
}
