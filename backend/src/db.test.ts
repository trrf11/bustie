import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { initDb, getDb, recordDelay, getDelayStats } from './db';

let testDbPath: string;

beforeEach(() => {
  const testDir = join(tmpdir(), 'bus80-test-' + Date.now());
  mkdirSync(testDir, { recursive: true });
  testDbPath = join(testDir, 'test.db');
  initDb(testDbPath);
});

afterEach(() => {
  const db = getDb();
  if (db) db.close();
  // Clean up test db files
  for (const suffix of ['', '-wal', '-shm']) {
    const p = testDbPath + suffix;
    if (existsSync(p)) unlinkSync(p);
  }
});

describe('initDb', () => {
  it('creates the database and delay_records table', () => {
    const db = getDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='delay_records'")
      .all();

    expect(tables).toHaveLength(1);
  });

  it('creates the recorded_at index', () => {
    const db = getDb();
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_delay_records_recorded_at'")
      .all();

    expect(indexes).toHaveLength(1);
  });
});

describe('recordDelay', () => {
  it('inserts a delay record', () => {
    recordDelay(101, 1, 'Haarlem Centrum', '55000150', '2026-02-10T14:00:00', '2026-02-10T14:08:00', 8, 'Amsterdam');

    const db = getDb();
    const rows = db.prepare('SELECT * FROM delay_records').all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].journey_number).toBe(101);
    expect(rows[0].delay_minutes).toBe(8);
    expect(rows[0].stop_name).toBe('Haarlem Centrum');
  });

  it('inserts multiple records', () => {
    recordDelay(101, 1, 'Stop A', 'tpc1', '2026-02-10T14:00:00', '2026-02-10T14:05:00', 5, 'Amsterdam');
    recordDelay(102, 2, 'Stop B', 'tpc2', '2026-02-10T14:30:00', '2026-02-10T14:42:00', 12, 'Zandvoort');

    const db = getDb();
    const rows = db.prepare('SELECT * FROM delay_records').all();
    expect(rows).toHaveLength(2);
  });
});

describe('getDelayStats', () => {
  it('returns stats for today period', () => {
    recordDelay(101, 1, 'Stop A', 'tpc1', '2026-02-10T14:00:00', '2026-02-10T14:05:00', 5, 'Amsterdam');
    recordDelay(102, 1, 'Stop B', 'tpc2', '2026-02-10T14:30:00', '2026-02-10T14:30:00', 0, 'Amsterdam');

    const stats = getDelayStats('today');

    expect(stats.period).toBe('today');
    expect(stats.totalTripsTracked).toBe(2);
    expect(stats.worstDelays).toBeDefined();
    expect(Array.isArray(stats.worstDelays)).toBe(true);
  });

  it('returns stats for week period', () => {
    recordDelay(101, 1, 'Stop A', 'tpc1', '2026-02-10T14:00:00', '2026-02-10T14:10:00', 10, 'Amsterdam');

    const stats = getDelayStats('week');

    expect(stats.period).toBe('week');
    expect(stats.totalTripsTracked).toBe(1);
    expect(stats.worstDelays).toHaveLength(1);
    expect(stats.worstDelays[0].delayMinutes).toBe(10);
  });

  it('returns stats for month period', () => {
    const stats = getDelayStats('month');

    expect(stats.period).toBe('month');
    expect(stats.totalTripsTracked).toBe(0);
    expect(stats.averageDelayMinutes).toBe(0);
  });

  it('calculates on-time percentage correctly', () => {
    // 3 on-time (< 1 min delay), 1 delayed
    recordDelay(101, 1, 'S', 't', '2026-02-10T14:00:00', '2026-02-10T14:00:00', 0, 'A');
    recordDelay(102, 1, 'S', 't', '2026-02-10T14:10:00', '2026-02-10T14:10:00', 0, 'A');
    recordDelay(103, 1, 'S', 't', '2026-02-10T14:20:00', '2026-02-10T14:20:30', 0.5, 'A');
    recordDelay(104, 1, 'S', 't', '2026-02-10T14:30:00', '2026-02-10T14:35:00', 5, 'A');

    const stats = getDelayStats('today');

    expect(stats.onTimePercentage).toBe(75); // 3 of 4 under 1 minute
  });

  it('calculates average delay correctly', () => {
    recordDelay(101, 1, 'S', 't', '2026-02-10T14:00:00', '2026-02-10T14:04:00', 4, 'A');
    recordDelay(102, 1, 'S', 't', '2026-02-10T14:10:00', '2026-02-10T14:16:00', 6, 'A');

    const stats = getDelayStats('today');

    expect(stats.averageDelayMinutes).toBe(5); // (4+6)/2
  });

  it('orders worst delays by delay_minutes descending', () => {
    recordDelay(101, 1, 'S', 't', '2026-02-10T14:00:00', '2026-02-10T14:02:00', 2, 'A');
    recordDelay(102, 1, 'S', 't', '2026-02-10T14:10:00', '2026-02-10T14:20:00', 10, 'A');
    recordDelay(103, 1, 'S', 't', '2026-02-10T14:20:00', '2026-02-10T14:25:00', 5, 'A');

    const stats = getDelayStats('today');

    expect(stats.worstDelays[0].delayMinutes).toBe(10);
    expect(stats.worstDelays[1].delayMinutes).toBe(5);
    expect(stats.worstDelays[2].delayMinutes).toBe(2);
  });

  it('limits worst delays to 10', () => {
    for (let i = 0; i < 15; i++) {
      recordDelay(100 + i, 1, 'S', 't', `2026-02-10T14:${String(i).padStart(2, '0')}:00`, `2026-02-10T14:${String(i).padStart(2, '0')}:00`, i, 'A');
    }

    const stats = getDelayStats('today');

    expect(stats.worstDelays.length).toBeLessThanOrEqual(10);
  });
});
