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
      updated_at TEXT NOT NULL
    )
  `);

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
}

export function replaceVehicles(vehicles: DbVehicle[]): void {
  const transaction = db.transaction(() => {
    db.exec('DELETE FROM vehicles');
    const stmt = db.prepare(`
      INSERT INTO vehicles (vehicle_id, trip_id, direction, latitude, longitude, delay_seconds, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const v of vehicles) {
      stmt.run(v.vehicle_id, v.trip_id, v.direction, v.latitude, v.longitude, v.delay_seconds, v.updated_at);
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
