import Database from 'better-sqlite3';
import { config } from './config';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';

let db: Database.Database;

export function getDb(): Database.Database {
  return db;
}

export function initDb(): void {
  const dbDir = dirname(config.dbPath);
  if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });

  db = new Database(config.dbPath);

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

  console.log(`SQLite database initialized at ${config.dbPath} (WAL mode)`);
}

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
