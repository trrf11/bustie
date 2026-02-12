/**
 * Extracts bus 80 route data from the GTFS static feed.
 * Downloads gtfs-nl.zip, parses agency/routes/trips/shapes/stops,
 * filters for Connexxion bus 80, and outputs route.json.
 *
 * Usage: npx tsx scripts/extract-gtfs.ts
 */

import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { pipeline } from 'stream/promises';
import { createInterface } from 'readline';
import { Readable } from 'stream';

const GTFS_URL = 'http://gtfs.ovapi.nl/nl/gtfs-nl.zip';
const OUTPUT_DIR = resolve(__dirname, '../backend/src/data');
const OUTPUT_FILE = join(OUTPUT_DIR, 'route.json');
const TMP_DIR = resolve(__dirname, '../.tmp');

interface RouteData {
  metadata: {
    extractedAt: string;
    gtfsLastModified: string;
    gtfsEtag: string;
  };
  routeIds: string[];
  tripIds: string[];
  shapes: Record<string, Array<[number, number]>>; // shapeId -> [[lat, lng], ...]
  tripShapeMap: Record<string, string>; // tripId -> shapeId
  tripDirectionMap: Record<string, number>; // tripId -> direction_id
  stops: Record<
    string,
    {
      direction1: Array<{
        stopId: string;
        name: string;
        latitude: number;
        longitude: number;
        sequence: number;
      }>;
      direction2: Array<{
        stopId: string;
        name: string;
        latitude: number;
        longitude: number;
        sequence: number;
      }>;
    }
  >;
}

function parseCsv(content: string): Array<Record<string, string>> {
  const lines = content.split('\n').filter((l) => l.trim());
  if (lines.length === 0) return [];

  // Remove BOM if present
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

async function downloadGtfs(): Promise<{ lastModified: string; etag: string }> {
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });

  const zipPath = join(TMP_DIR, 'gtfs-nl.zip');

  console.log('Checking GTFS feed headers...');
  const headRes = await fetch(GTFS_URL, { method: 'HEAD' });
  const lastModified = headRes.headers.get('last-modified') || '';
  const etag = headRes.headers.get('etag') || '';

  console.log(`  Last-Modified: ${lastModified}`);
  console.log(`  ETag: ${etag}`);

  // Check if we already have this version
  const metaPath = join(TMP_DIR, 'gtfs-meta.json');
  if (existsSync(metaPath) && existsSync(zipPath)) {
    const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
    if (meta.etag === etag && meta.lastModified === lastModified) {
      console.log('  GTFS feed unchanged, using cached zip.');
      return { lastModified, etag };
    }
  }

  console.log('Downloading GTFS feed (~234MB)...');
  const res = await fetch(GTFS_URL);
  if (!res.ok || !res.body) throw new Error(`Failed to download GTFS: ${res.status}`);

  const fileStream = createWriteStream(zipPath);
  await pipeline(Readable.fromWeb(res.body as any), fileStream);

  writeFileSync(metaPath, JSON.stringify({ lastModified, etag }));
  console.log('  Download complete.');

  return { lastModified, etag };
}

async function extractFile(zipPath: string, filename: string): Promise<string> {
  // Use the unzip command since Node doesn't have a great built-in zip reader
  const { execSync } = await import('child_process');
  const outPath = join(TMP_DIR, filename);

  try {
    execSync(`unzip -o -j "${zipPath}" "${filename}" -d "${TMP_DIR}"`, {
      stdio: 'pipe',
    });
  } catch {
    throw new Error(`Failed to extract ${filename} from zip`);
  }

  return readFileSync(outPath, 'utf-8');
}

/**
 * Stream-parse a large CSV file, calling the callback for each row.
 * Extracts the file from the zip first, then streams it line by line.
 */
async function streamCsvFromZip(
  zipPath: string,
  filename: string,
  onRow: (row: Record<string, string>) => void
): Promise<void> {
  const { execSync } = await import('child_process');
  const outPath = join(TMP_DIR, filename);

  try {
    execSync(`unzip -o -j "${zipPath}" "${filename}" -d "${TMP_DIR}"`, {
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
    let lineCount = 0;

    rl.on('line', (line) => {
      if (!line.trim()) return;

      if (!headers) {
        headers = line.replace(/^\uFEFF/, '').split(',').map((h) => h.trim().replace(/"/g, ''));
        return;
      }

      lineCount++;
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

    rl.on('close', () => {
      console.log(`    Processed ${lineCount} rows`);
      resolve();
    });

    rl.on('error', reject);
  });
}

async function main() {
  console.log('=== Bus 80 GTFS Data Extractor ===\n');

  const { lastModified, etag } = await downloadGtfs();
  const zipPath = join(TMP_DIR, 'gtfs-nl.zip');

  // Step 1: Find Connexxion agency_id
  console.log('\nParsing agency.txt...');
  const agencyData = parseCsv(await extractFile(zipPath, 'agency.txt'));
  const connexxionAgency = agencyData.find(
    (a) =>
      a.agency_name?.toLowerCase().includes('connexxion') ||
      a.agency_id?.toUpperCase() === 'CXX'
  );

  if (!connexxionAgency) {
    console.error('Could not find Connexxion agency. Available agencies:');
    agencyData.forEach((a) => console.error(`  ${a.agency_id}: ${a.agency_name}`));
    process.exit(1);
  }
  console.log(`  Found Connexxion: agency_id=${connexxionAgency.agency_id}`);

  // Step 2: Find bus 80 route_id(s)
  console.log('\nParsing routes.txt...');
  const routesData = parseCsv(await extractFile(zipPath, 'routes.txt'));
  const bus80Routes = routesData.filter(
    (r) =>
      r.agency_id === connexxionAgency.agency_id &&
      r.route_short_name === '80' &&
      r.route_type === '3' // 3 = bus
  );

  if (bus80Routes.length === 0) {
    console.error('Could not find bus 80 routes. Searching for similar:');
    routesData
      .filter((r) => r.agency_id === connexxionAgency.agency_id && r.route_short_name?.includes('80'))
      .forEach((r) => console.error(`  ${r.route_id}: ${r.route_short_name} - ${r.route_long_name}`));
    process.exit(1);
  }

  const routeIds = bus80Routes.map((r) => r.route_id);
  console.log(`  Found ${bus80Routes.length} route(s): ${routeIds.join(', ')}`);
  bus80Routes.forEach((r) => console.log(`    ${r.route_id}: ${r.route_long_name}`));

  // Step 3: Find all trips for these routes
  console.log('\nParsing trips.txt...');
  const tripsData = parseCsv(await extractFile(zipPath, 'trips.txt'));
  const bus80Trips = tripsData.filter((t) => routeIds.includes(t.route_id));

  console.log(`  Found ${bus80Trips.length} trips for bus 80`);

  const tripIds = bus80Trips.map((t) => t.trip_id);
  const tripShapeMap: Record<string, string> = {};
  const tripDirectionMap: Record<string, number> = {};
  const shapeIds = new Set<string>();

  for (const trip of bus80Trips) {
    tripShapeMap[trip.trip_id] = trip.shape_id;
    tripDirectionMap[trip.trip_id] = parseInt(trip.direction_id || '0', 10);
    if (trip.shape_id) shapeIds.add(trip.shape_id);
  }

  console.log(`  Unique shapes: ${shapeIds.size}`);

  // Step 4: Extract shapes
  console.log('\nParsing shapes.txt (this may take a moment)...');
  const shapesData = parseCsv(await extractFile(zipPath, 'shapes.txt'));
  const shapes: Record<string, Array<[number, number]>> = {};

  for (const row of shapesData) {
    if (!shapeIds.has(row.shape_id)) continue;
    if (!shapes[row.shape_id]) shapes[row.shape_id] = [];
    shapes[row.shape_id].push([
      parseFloat(row.shape_pt_lat),
      parseFloat(row.shape_pt_lon),
    ]);
  }

  // Sort each shape by sequence
  // (shapes.txt rows should already be ordered, but let's sort explicitly using the raw data)
  // We need to re-parse with sequence info
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

  console.log(`  Extracted ${Object.keys(sortedShapes).length} shapes`);

  // Step 5: Extract stops for bus 80 trips (via stop_times.txt)
  // This file is too large to load into memory, so we stream it
  console.log('\nParsing stop_times.txt (streaming - this is the largest file)...');

  // Find the representative trip per direction with the MOST stops (= full route variant).
  // First pass: count stops per trip (only for bus 80 trips)
  const tripIdSet = new Set(tripIds);
  const stopCountPerTrip: Record<string, number> = {};

  console.log('  First pass: counting stops per trip...');
  await streamCsvFromZip(zipPath, 'stop_times.txt', (row) => {
    if (!tripIdSet.has(row.trip_id)) return;
    stopCountPerTrip[row.trip_id] = (stopCountPerTrip[row.trip_id] || 0) + 1;
  });

  // Pick the trip with the most stops per direction
  const tripsByDirection: Record<number, string> = {};
  for (const trip of bus80Trips) {
    const dir = parseInt(trip.direction_id || '0', 10);
    const count = stopCountPerTrip[trip.trip_id] || 0;
    const existingTripId = tripsByDirection[dir];
    if (!existingTripId || count > (stopCountPerTrip[existingTripId] || 0)) {
      tripsByDirection[dir] = trip.trip_id;
    }
  }

  for (const [dir, tripId] of Object.entries(tripsByDirection)) {
    console.log(`  Direction ${dir} representative trip: ${tripId} (${stopCountPerTrip[tripId]} stops)`);
  }

  const representativeTripIds = new Set(Object.values(tripsByDirection));
  const stopIdsNeeded = new Set<string>();
  const stopSequences: Record<string, Array<{ stopId: string; sequence: number }>> = {
    direction1: [],
    direction2: [],
  };

  // Build a fast lookup for trip direction
  const repTripDirMap: Record<string, string> = {};
  for (const [dirStr, tripId] of Object.entries(tripsByDirection)) {
    const dir = parseInt(dirStr, 10);
    repTripDirMap[tripId] = dir === 0 ? 'direction1' : 'direction2';
  }

  // Second pass: extract stop sequences for representative trips
  console.log('  Second pass: extracting stop sequences...');
  await streamCsvFromZip(zipPath, 'stop_times.txt', (row) => {
    if (!representativeTripIds.has(row.trip_id)) return;

    const dirKey = repTripDirMap[row.trip_id];
    if (!dirKey) return;

    stopIdsNeeded.add(row.stop_id);
    stopSequences[dirKey].push({
      stopId: row.stop_id,
      sequence: parseInt(row.stop_sequence, 10),
    });
  });

  // Sort by sequence
  stopSequences.direction1.sort((a, b) => a.sequence - b.sequence);
  stopSequences.direction2.sort((a, b) => a.sequence - b.sequence);

  console.log(`  Stop IDs needed: ${stopIdsNeeded.size}`);

  // Step 6: Get stop details
  console.log('\nParsing stops.txt...');
  const stopsData = parseCsv(await extractFile(zipPath, 'stops.txt'));
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

  // Build final stops structure
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

  // Build output
  const routeData: RouteData = {
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

  // Write output
  if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
  writeFileSync(OUTPUT_FILE, JSON.stringify(routeData, null, 2));

  const fileSizeMb = (Buffer.byteLength(JSON.stringify(routeData)) / 1024 / 1024).toFixed(2);
  console.log(`\nWrote ${OUTPUT_FILE} (${fileSizeMb} MB)`);
  console.log(`  Route IDs: ${routeIds.length}`);
  console.log(`  Trip IDs: ${tripIds.length}`);
  console.log(`  Shapes: ${Object.keys(sortedShapes).length}`);
  console.log(`  Direction 1 stops: ${stops.route.direction1.length}`);
  console.log(`  Direction 2 stops: ${stops.route.direction2.length}`);
  console.log('\nDone!');
}

main().catch((err) => {
  console.error('Extract failed:', err);
  process.exit(1);
});
