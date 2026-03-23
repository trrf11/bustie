import Database from 'better-sqlite3';
import { config } from './config';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

let db: Database.Database;

export function getDb(): Database.Database {
  return db;
}

export function initDb(customPath?: string): void {
  const dbPath = customPath || config.dbPath;
  const dbDir = dirname(dbPath);
  if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });

  db = new Database(dbPath);

  // Enable WAL mode for concurrent read/write
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');

  // Create delay records table
  db.exec(`
    CREATE TABLE IF NOT EXISTS delay_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      journey_number INTEGER NOT NULL,
      line_direction INTEGER NOT NULL,
      stop_name TEXT NOT NULL,
      tpc TEXT NOT NULL,
      scheduled_time TEXT NOT NULL,
      expected_time TEXT NOT NULL,
      delay_minutes REAL NOT NULL,
      destination TEXT NOT NULL,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Index for querying by date range
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_delay_records_recorded_at
    ON delay_records(recorded_at)
  `);

  // Purge records older than 30 days
  db.exec(`
    DELETE FROM delay_records
    WHERE recorded_at < datetime('now', '-30 days')
  `);

  // Create vehicles table (latest snapshot — one row per active bus)
  db.exec(`
    CREATE TABLE IF NOT EXISTS vehicles (
      vehicle_id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL,
      direction INTEGER,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      delay_seconds INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      speed REAL NOT NULL DEFAULT 0,
      distance_along_route REAL NOT NULL DEFAULT 0,
      current_status TEXT NOT NULL DEFAULT '',
      stop_id TEXT NOT NULL DEFAULT ''
    )
  `);

  // Migrate existing vehicles table: add projection columns if missing
  const cols = db.prepare("PRAGMA table_info(vehicles)").all() as Array<{ name: string }>;
  const colNames = new Set(cols.map((c) => c.name));
  if (!colNames.has('speed')) db.exec("ALTER TABLE vehicles ADD COLUMN speed REAL NOT NULL DEFAULT 0");
  if (!colNames.has('distance_along_route')) db.exec("ALTER TABLE vehicles ADD COLUMN distance_along_route REAL NOT NULL DEFAULT 0");
  if (!colNames.has('current_status')) db.exec("ALTER TABLE vehicles ADD COLUMN current_status TEXT NOT NULL DEFAULT ''");
  if (!colNames.has('stop_id')) db.exec("ALTER TABLE vehicles ADD COLUMN stop_id TEXT NOT NULL DEFAULT ''");

  // Create stop_times table (latest trip update snapshot)
  db.exec(`
    CREATE TABLE IF NOT EXISTS stop_times (
      trip_id TEXT NOT NULL,
      stop_id TEXT NOT NULL,
      stop_sequence INTEGER NOT NULL,
      direction INTEGER,
      arrival_time INTEGER,
      arrival_delay INTEGER NOT NULL DEFAULT 0,
      departure_time INTEGER,
      departure_delay INTEGER NOT NULL DEFAULT 0,
      departed INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (trip_id, stop_id)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_stop_times_stop_id
    ON stop_times(stop_id)
  `);

  // Create poll_log table (for debugging)
  db.exec(`
    CREATE TABLE IF NOT EXISTS poll_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      poll_type TEXT NOT NULL,
      status TEXT NOT NULL,
      vehicle_count INTEGER,
      error_message TEXT,
      polled_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Purge old poll_log entries (older than 7 days)
  db.exec(`
    DELETE FROM poll_log
    WHERE polled_at < datetime('now', '-7 days')
  `);

  // Create checkins table (one check-in per client, keyed by vehicle+trip)
  db.exec(`
    CREATE TABLE IF NOT EXISTS checkins (
      client_id TEXT PRIMARY KEY,
      vehicle_id TEXT NOT NULL,
      trip_id TEXT NOT NULL,
      checked_in_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_checkins_vehicle_trip
    ON checkins(vehicle_id, trip_id)
  `);

  // Purge stale check-ins older than 2 hours
  db.exec(`
    DELETE FROM checkins
    WHERE checked_in_at < datetime('now', '-2 hours')
  `);

  // Create push subscriptions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_push_sub_client
    ON push_subscriptions(client_id)
  `);

  // Purge push subscriptions older than 90 days
  db.exec(`
    DELETE FROM push_subscriptions
    WHERE created_at < datetime('now', '-90 days')
  `);

  // Create departure alerts table (one per client per stop+direction)
  db.exec(`
    CREATE TABLE IF NOT EXISTS departure_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL,
      tpc TEXT NOT NULL,
      direction INTEGER NOT NULL,
      stop_name TEXT NOT NULL,
      walk_time_minutes INTEGER NOT NULL DEFAULT 0,
      time_window_start TEXT NOT NULL,
      time_window_end TEXT NOT NULL,
      days_of_week TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(client_id, tpc, direction)
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_departure_alerts_client
    ON departure_alerts(client_id)
  `);

  // Create sent_notifications dedup table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sent_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL,
      trip_id TEXT NOT NULL,
      stop_id TEXT NOT NULL,
      sent_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(client_id, trip_id, stop_id)
    )
  `);

  // Purge sent_notifications older than 24h
  db.exec(`
    DELETE FROM sent_notifications
    WHERE sent_at < datetime('now', '-24 hours')
  `);

  // Purge orphaned alerts (no push subscription and older than 30 days)
  db.exec(`
    DELETE FROM departure_alerts
    WHERE created_at < datetime('now', '-30 days')
      AND client_id NOT IN (SELECT DISTINCT client_id FROM push_subscriptions)
  `);

  // Create cached departures table (OVapi departure data, updated by polling)
  db.exec(`
    CREATE TABLE IF NOT EXISTS cached_departures (
      tpc TEXT NOT NULL,
      direction INTEGER NOT NULL,
      journey_number INTEGER NOT NULL,
      scheduled_departure TEXT NOT NULL,
      expected_departure TEXT NOT NULL,
      delay_minutes INTEGER NOT NULL DEFAULT 0,
      destination TEXT NOT NULL,
      status TEXT NOT NULL,
      PRIMARY KEY (tpc, direction, journey_number, scheduled_departure)
    )
  `);

  // Cache metadata: tracks when each TPC was last polled + stop info
  db.exec(`
    CREATE TABLE IF NOT EXISTS cached_stops (
      tpc TEXT PRIMARY KEY,
      stop_name TEXT,
      latitude REAL,
      longitude REAL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  console.log(`SQLite database initialized at ${dbPath} (WAL mode)`);
}

// --- Vehicles table ---

export interface DbVehicle {
  vehicle_id: string;
  trip_id: string;
  direction: number | null;
  latitude: number;
  longitude: number;
  delay_seconds: number;
  updated_at: string;
  speed: number;
  distance_along_route: number;
  current_status: string;
  stop_id: string;
}

export function replaceVehicles(vehicles: DbVehicle[]): void {
  const transaction = db.transaction(() => {
    db.exec('DELETE FROM vehicles');
    const stmt = db.prepare(`
      INSERT INTO vehicles (vehicle_id, trip_id, direction, latitude, longitude, delay_seconds, updated_at, speed, distance_along_route, current_status, stop_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const v of vehicles) {
      stmt.run(v.vehicle_id, v.trip_id, v.direction, v.latitude, v.longitude, v.delay_seconds, v.updated_at, v.speed, v.distance_along_route, v.current_status, v.stop_id);
    }
  });
  transaction();
}

export function getVehiclesFromDb(): DbVehicle[] {
  return db.prepare('SELECT * FROM vehicles').all() as DbVehicle[];
}

// --- Stop times table ---

export interface DbStopTime {
  trip_id: string;
  stop_id: string;
  stop_sequence: number;
  direction: number | null;
  arrival_time: number | null;
  arrival_delay: number;
  departure_time: number | null;
  departure_delay: number;
  departed: number; // 0 or 1
}

export function replaceStopTimes(stopTimes: DbStopTime[]): void {
  const transaction = db.transaction(() => {
    db.exec('DELETE FROM stop_times');
    const stmt = db.prepare(`
      INSERT INTO stop_times (trip_id, stop_id, stop_sequence, direction, arrival_time, arrival_delay, departure_time, departure_delay, departed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const st of stopTimes) {
      stmt.run(st.trip_id, st.stop_id, st.stop_sequence, st.direction, st.arrival_time, st.arrival_delay, st.departure_time, st.departure_delay, st.departed);
    }
  });
  transaction();
}

export interface DbArrival {
  tripId: string;
  arrivalTime: number;
  delay: number;
  departed: boolean;
}

export function getArrivalsForStopFromDb(stopId: string): DbArrival[] {
  const rows = db.prepare(
    'SELECT trip_id, arrival_time, arrival_delay, departed FROM stop_times WHERE stop_id = ? AND departed = 0 ORDER BY arrival_time'
  ).all(stopId) as Array<{ trip_id: string; arrival_time: number | null; arrival_delay: number; departed: number }>;

  return rows
    .filter((r) => r.arrival_time !== null)
    .map((r) => ({
      tripId: r.trip_id,
      arrivalTime: r.arrival_time!,
      delay: r.arrival_delay,
      departed: r.departed === 1,
    }));
}

// --- Poll log ---

export function logPoll(pollType: string, status: string, vehicleCount?: number, errorMessage?: string): void {
  db.prepare(
    'INSERT INTO poll_log (poll_type, status, vehicle_count, error_message) VALUES (?, ?, ?, ?)'
  ).run(pollType, status, vehicleCount ?? null, errorMessage ?? null);
}

// --- Delay recording (existing) ---

export function recordDelay(
  journeyNumber: number,
  lineDirection: number,
  stopName: string,
  tpc: string,
  scheduledTime: string,
  expectedTime: string,
  delayMinutes: number,
  destination: string
): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO delay_records
    (journey_number, line_direction, stop_name, tpc, scheduled_time, expected_time, delay_minutes, destination)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(journeyNumber, lineDirection, stopName, tpc, scheduledTime, expectedTime, delayMinutes, destination);
}

export interface DelayStats {
  period: string;
  worstDelays: Array<{
    date: string;
    journeyNumber: number;
    stop: string;
    scheduledTime: string;
    actualTime: string;
    delayMinutes: number;
    direction: number;
  }>;
  averageDelayMinutes: number;
  onTimePercentage: number;
  totalTripsTracked: number;
}

// --- Checkins table ---

export function checkIn(clientId: string, vehicleId: string, tripId: string): void {
  db.prepare(`
    INSERT OR REPLACE INTO checkins (client_id, vehicle_id, trip_id, checked_in_at)
    VALUES (?, ?, ?, datetime('now'))
  `).run(clientId, vehicleId, tripId);
}

export function checkOut(clientId: string): void {
  db.prepare('DELETE FROM checkins WHERE client_id = ?').run(clientId);
}

export function getCheckinCounts(): Record<string, number> {
  const rows = db.prepare(`
    SELECT v.vehicle_id, COUNT(c.client_id) as count
    FROM vehicles v
    JOIN checkins c ON c.vehicle_id = v.vehicle_id AND c.trip_id = v.trip_id
    GROUP BY v.vehicle_id
  `).all() as Array<{ vehicle_id: string; count: number }>;

  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.vehicle_id] = row.count;
  }
  return counts;
}

export function getClientCheckin(clientId: string): { vehicleId: string; tripId: string } | null {
  const row = db.prepare(
    'SELECT vehicle_id, trip_id FROM checkins WHERE client_id = ?'
  ).get(clientId) as { vehicle_id: string; trip_id: string } | undefined;

  if (!row) return null;
  return { vehicleId: row.vehicle_id, tripId: row.trip_id };
}

export function purgeCheckinsWithMismatchedTrips(): number {
  const result = db.prepare(`
    DELETE FROM checkins
    WHERE EXISTS (
      SELECT 1 FROM vehicles v
      WHERE v.vehicle_id = checkins.vehicle_id
        AND v.trip_id != checkins.trip_id
    )
  `).run();
  return result.changes;
}

export function purgeStaleCheckins(): void {
  const result = db.prepare(
    "DELETE FROM checkins WHERE checked_in_at < datetime('now', '-2 hours')"
  ).run();
  if (result.changes > 0) {
    console.log(`Purged ${result.changes} stale check-in(s)`);
  }
}

// --- Push subscriptions table ---

export interface DbPushSubscription {
  id: number;
  client_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
}

export function savePushSubscription(clientId: string, endpoint: string, p256dh: string, auth: string): void {
  db.prepare(`
    INSERT OR REPLACE INTO push_subscriptions (client_id, endpoint, p256dh, auth, created_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(clientId, endpoint, p256dh, auth);
}

export function deletePushSubscription(clientId: string, endpoint: string): void {
  db.prepare(
    'DELETE FROM push_subscriptions WHERE client_id = ? AND endpoint = ?'
  ).run(clientId, endpoint);
}

export function deletePushSubscriptionByEndpoint(endpoint: string): void {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

export function getPushSubscriptionsByClient(clientId: string): DbPushSubscription[] {
  return db.prepare(
    'SELECT * FROM push_subscriptions WHERE client_id = ?'
  ).all(clientId) as DbPushSubscription[];
}

export function countPushSubscriptionsByClient(clientId: string): number {
  const row = db.prepare(
    'SELECT COUNT(*) as count FROM push_subscriptions WHERE client_id = ?'
  ).get(clientId) as { count: number };
  return row.count;
}

// --- Departure alerts table ---

export interface DbDepartureAlert {
  id: number;
  client_id: string;
  tpc: string;
  direction: number;
  stop_name: string;
  walk_time_minutes: number;
  time_window_start: string;
  time_window_end: string;
  days_of_week: string;
  enabled: number;
  created_at: string;
}

export function saveAlert(
  clientId: string,
  tpc: string,
  direction: number,
  stopName: string,
  walkTimeMinutes: number,
  timeWindowStart: string,
  timeWindowEnd: string,
  daysOfWeek: number[],
  enabled: boolean
): void {
  db.prepare(`
    INSERT OR REPLACE INTO departure_alerts
    (client_id, tpc, direction, stop_name, walk_time_minutes, time_window_start, time_window_end, days_of_week, enabled, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(clientId, tpc, direction, stopName, walkTimeMinutes, timeWindowStart, timeWindowEnd, JSON.stringify(daysOfWeek), enabled ? 1 : 0);
}

export function deleteAlert(clientId: string, tpc: string, direction: number): void {
  db.prepare(
    'DELETE FROM departure_alerts WHERE client_id = ? AND tpc = ? AND direction = ?'
  ).run(clientId, tpc, direction);
}

export function getAlertsByClient(clientId: string): DbDepartureAlert[] {
  return db.prepare(
    'SELECT * FROM departure_alerts WHERE client_id = ?'
  ).all(clientId) as DbDepartureAlert[];
}

export function countAlertsByClient(clientId: string): number {
  const row = db.prepare(
    'SELECT COUNT(*) as count FROM departure_alerts WHERE client_id = ?'
  ).get(clientId) as { count: number };
  return row.count;
}

export function getAllEnabledAlerts(): DbDepartureAlert[] {
  return db.prepare(
    'SELECT * FROM departure_alerts WHERE enabled = 1'
  ).all() as DbDepartureAlert[];
}

export function markNotificationSent(clientId: string, tripId: string, stopId: string): boolean {
  try {
    db.prepare(
      'INSERT INTO sent_notifications (client_id, trip_id, stop_id) VALUES (?, ?, ?)'
    ).run(clientId, tripId, stopId);
    return true;
  } catch {
    return false;
  }
}

export function purgeStaleSentNotifications(): void {
  const result = db.prepare(
    "DELETE FROM sent_notifications WHERE sent_at < datetime('now', '-24 hours')"
  ).run();
  if (result.changes > 0) {
    console.log(`Purged ${result.changes} stale sent notification(s)`);
  }
}

export function purgeOrphanedAlerts(): void {
  const result = db.prepare(`
    DELETE FROM departure_alerts
    WHERE created_at < datetime('now', '-30 days')
      AND client_id NOT IN (SELECT DISTINCT client_id FROM push_subscriptions)
  `).run();
  if (result.changes > 0) {
    console.log(`Purged ${result.changes} orphaned alert(s)`);
  }
}

// --- Cached departures table ---

export interface DbCachedDeparture {
  tpc: string;
  direction: number;
  journey_number: number;
  scheduled_departure: string;
  expected_departure: string;
  delay_minutes: number;
  destination: string;
  status: string;
}

export interface DbCachedStop {
  tpc: string;
  stop_name: string | null;
  latitude: number | null;
  longitude: number | null;
  updated_at: string;
}

export function replaceCachedDepartures(
  tpc: string,
  departures: DbCachedDeparture[],
  stopInfo?: { name: string; latitude: number; longitude: number }
): void {
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM cached_departures WHERE tpc = ?').run(tpc);
    const stmt = db.prepare(`
      INSERT INTO cached_departures (tpc, direction, journey_number, scheduled_departure, expected_departure, delay_minutes, destination, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const d of departures) {
      stmt.run(d.tpc, d.direction, d.journey_number, d.scheduled_departure, d.expected_departure, d.delay_minutes, d.destination, d.status);
    }
    // Update stop metadata + timestamp
    db.prepare(`
      INSERT OR REPLACE INTO cached_stops (tpc, stop_name, latitude, longitude, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(tpc, stopInfo?.name ?? null, stopInfo?.latitude ?? null, stopInfo?.longitude ?? null);
  });
  transaction();
}

export function getCachedDeparturesForTpc(tpc: string, direction: number): DbCachedDeparture[] {
  return db.prepare(
    'SELECT * FROM cached_departures WHERE tpc = ? AND direction = ? ORDER BY expected_departure'
  ).all(tpc, direction) as DbCachedDeparture[];
}

export function getAllCachedDeparturesForTpc(tpc: string): DbCachedDeparture[] {
  return db.prepare(
    'SELECT * FROM cached_departures WHERE tpc = ? ORDER BY expected_departure'
  ).all(tpc) as DbCachedDeparture[];
}

export function getCachedStop(tpc: string): DbCachedStop | null {
  return db.prepare(
    'SELECT * FROM cached_stops WHERE tpc = ?'
  ).get(tpc) as DbCachedStop | null;
}

export function getAlertTpcs(): string[] {
  const rows = db.prepare(
    'SELECT DISTINCT tpc FROM departure_alerts WHERE enabled = 1'
  ).all() as Array<{ tpc: string }>;
  return rows.map((r) => r.tpc);
}

// --- Delay recording (existing) ---

export function getDelayStats(period: 'today' | 'week' | 'month'): DelayStats {
  let dateFilter: string;
  switch (period) {
    case 'today':
      dateFilter = "datetime('now', '-1 day')";
      break;
    case 'week':
      dateFilter = "datetime('now', '-7 days')";
      break;
    case 'month':
      dateFilter = "datetime('now', '-30 days')";
      break;
  }

  // Worst delays
  const worstDelays = db
    .prepare(
      `
    SELECT
      date(recorded_at) as date,
      journey_number,
      stop_name,
      scheduled_time,
      expected_time,
      delay_minutes,
      line_direction
    FROM delay_records
    WHERE recorded_at >= ${dateFilter}
    ORDER BY delay_minutes DESC
    LIMIT 10
  `
    )
    .all() as Array<{
    date: string;
    journey_number: number;
    stop_name: string;
    scheduled_time: string;
    expected_time: string;
    delay_minutes: number;
    line_direction: number;
  }>;

  // Average delay and on-time stats
  const stats = db
    .prepare(
      `
    SELECT
      AVG(delay_minutes) as avg_delay,
      COUNT(*) as total,
      SUM(CASE WHEN delay_minutes < 1 THEN 1 ELSE 0 END) as on_time
    FROM delay_records
    WHERE recorded_at >= ${dateFilter}
  `
    )
    .get() as { avg_delay: number | null; total: number; on_time: number };

  return {
    period,
    worstDelays: worstDelays.map((d) => ({
      date: d.date,
      journeyNumber: d.journey_number,
      stop: d.stop_name,
      scheduledTime: d.scheduled_time,
      actualTime: d.expected_time,
      delayMinutes: Math.round(d.delay_minutes * 10) / 10,
      direction: d.line_direction,
    })),
    averageDelayMinutes: Math.round((stats.avg_delay || 0) * 10) / 10,
    onTimePercentage: stats.total > 0 ? Math.round((stats.on_time / stats.total) * 100) : 0,
    totalTripsTracked: stats.total,
  };
}
