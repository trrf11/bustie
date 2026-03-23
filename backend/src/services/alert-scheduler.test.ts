import { describe, it, expect, vi, beforeEach } from 'vitest';
import { _runSchedulerCycle, getAmsterdamDayOfWeek, getAmsterdamHHMM, isInTimeWindow } from './alert-scheduler';

vi.mock('../db', () => ({
  getAllEnabledAlerts: vi.fn(),
  getCachedDeparturesForTpc: vi.fn(),
  getPushSubscriptionsByClient: vi.fn(),
  markNotificationSent: vi.fn(),
  deletePushSubscriptionByEndpoint: vi.fn(),
  purgeStaleSentNotifications: vi.fn(),
  purgeOrphanedAlerts: vi.fn(),
}));

vi.mock('./push', () => ({
  sendPushNotification: vi.fn(),
}));

import {
  getAllEnabledAlerts,
  getCachedDeparturesForTpc,
  getPushSubscriptionsByClient,
  markNotificationSent,
  deletePushSubscriptionByEndpoint,
} from '../db';
import { sendPushNotification } from './push';

function makeAlert(overrides: Partial<ReturnType<typeof getAllEnabledAlerts>[0]> = {}) {
  const now = new Date();
  const currentDay = getAmsterdamDayOfWeek(now);
  return {
    id: 1,
    client_id: 'client-1',
    tpc: '55230110',
    direction: 1,
    stop_name: 'Test Stop',
    walk_time_minutes: 0,
    time_window_start: '00:00',
    time_window_end: '23:59',
    days_of_week: JSON.stringify([currentDay]),
    enabled: 1,
    created_at: '2026-01-01',
    ...overrides,
  };
}

function makeCachedDep(minutesFromNow: number, overrides: Record<string, unknown> = {}) {
  const now = new Date();
  const expected = new Date(now.getTime() + minutesFromNow * 60_000);
  const scheduled = new Date(expected.getTime());
  return {
    tpc: '55230110',
    direction: 1,
    journey_number: 101,
    scheduled_departure: scheduled.toISOString(),
    expected_departure: expected.toISOString(),
    delay_minutes: 0,
    destination: 'Amsterdam Elandsgracht',
    status: 'DRIVING',
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getAllEnabledAlerts).mockReturnValue([]);
  vi.mocked(getCachedDeparturesForTpc).mockReturnValue([]);
  vi.mocked(sendPushNotification).mockResolvedValue(true);
  vi.mocked(markNotificationSent).mockReturnValue(true);
});

describe('isInTimeWindow', () => {
  it('normal window: inside', () => {
    expect(isInTimeWindow('08:00', '07:00', '09:00')).toBe(true);
  });

  it('normal window: outside', () => {
    expect(isInTimeWindow('10:00', '07:00', '09:00')).toBe(false);
  });

  it('normal window: at start boundary', () => {
    expect(isInTimeWindow('07:00', '07:00', '09:00')).toBe(true);
  });

  it('normal window: at end boundary', () => {
    expect(isInTimeWindow('09:00', '07:00', '09:00')).toBe(true);
  });

  it('overnight window: late evening', () => {
    expect(isInTimeWindow('23:00', '22:00', '02:00')).toBe(true);
  });

  it('overnight window: early morning', () => {
    expect(isInTimeWindow('01:00', '22:00', '02:00')).toBe(true);
  });

  it('overnight window: midday outside', () => {
    expect(isInTimeWindow('12:00', '22:00', '02:00')).toBe(false);
  });

  it('same start and end covers full day', () => {
    expect(isInTimeWindow('15:00', '06:00', '06:00')).toBe(true);
  });
});

describe('getAmsterdamDayOfWeek', () => {
  it('returns correct day for known date', () => {
    const date = new Date('2026-03-05T12:00:00Z');
    expect(getAmsterdamDayOfWeek(date)).toBe(4);
  });
});

describe('getAmsterdamHHMM', () => {
  it('formats date string to Amsterdam HH:MM', () => {
    expect(getAmsterdamHHMM('2026-03-05T07:30:00Z')).toBe('08:30');
  });
});

describe('runSchedulerCycle', () => {
  it('does nothing when no alerts', async () => {
    await _runSchedulerCycle();
    expect(getCachedDeparturesForTpc).not.toHaveBeenCalled();
  });

  it('skips alerts for wrong day of week', async () => {
    const currentDay = getAmsterdamDayOfWeek(new Date());
    const wrongDay = currentDay === 7 ? 1 : currentDay + 1;

    vi.mocked(getAllEnabledAlerts).mockReturnValue([
      makeAlert({ days_of_week: JSON.stringify([wrongDay]) }),
    ]);

    await _runSchedulerCycle();
    expect(markNotificationSent).not.toHaveBeenCalled();
  });

  it('sends notification when departure is within lead time', async () => {
    vi.mocked(getAllEnabledAlerts).mockReturnValue([makeAlert()]);
    vi.mocked(getCachedDeparturesForTpc).mockReturnValue([makeCachedDep(3)]);
    vi.mocked(getPushSubscriptionsByClient).mockReturnValue([{
      id: 1, client_id: 'client-1', endpoint: 'https://push.example.com/sub1',
      p256dh: 'key1', auth: 'auth1', created_at: '2026-01-01',
    }]);

    await _runSchedulerCycle();

    expect(markNotificationSent).toHaveBeenCalled();
    expect(sendPushNotification).toHaveBeenCalledWith(
      { endpoint: 'https://push.example.com/sub1', keys: { p256dh: 'key1', auth: 'auth1' } },
      expect.objectContaining({
        title: 'Bus 80 over 3 min',
        body: expect.stringContaining('bij Test Stop'),
      })
    );
  });

  it('does not notify when departure is beyond lead time', async () => {
    vi.mocked(getAllEnabledAlerts).mockReturnValue([makeAlert()]);
    vi.mocked(getCachedDeparturesForTpc).mockReturnValue([makeCachedDep(10)]);

    await _runSchedulerCycle();
    expect(markNotificationSent).not.toHaveBeenCalled();
  });

  it('uses walkTime + 1 as lead time', async () => {
    vi.mocked(getAllEnabledAlerts).mockReturnValue([makeAlert({ walk_time_minutes: 10 })]);
    vi.mocked(getCachedDeparturesForTpc).mockReturnValue([makeCachedDep(8)]);
    vi.mocked(getPushSubscriptionsByClient).mockReturnValue([{
      id: 1, client_id: 'client-1', endpoint: 'https://push.example.com/sub1',
      p256dh: 'key1', auth: 'auth1', created_at: '2026-01-01',
    }]);

    await _runSchedulerCycle();

    expect(sendPushNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ title: 'Bus 80 over 8 min' })
    );
  });

  it('skips when dedup returns false', async () => {
    vi.mocked(getAllEnabledAlerts).mockReturnValue([makeAlert()]);
    vi.mocked(getCachedDeparturesForTpc).mockReturnValue([makeCachedDep(3)]);
    vi.mocked(markNotificationSent).mockReturnValue(false);

    await _runSchedulerCycle();
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it('cleans up expired subscriptions on send failure', async () => {
    vi.mocked(getAllEnabledAlerts).mockReturnValue([makeAlert()]);
    vi.mocked(getCachedDeparturesForTpc).mockReturnValue([makeCachedDep(3)]);
    vi.mocked(getPushSubscriptionsByClient).mockReturnValue([{
      id: 1, client_id: 'client-1', endpoint: 'https://push.example.com/expired',
      p256dh: 'key1', auth: 'auth1', created_at: '2026-01-01',
    }]);
    vi.mocked(sendPushNotification).mockResolvedValue(false);

    await _runSchedulerCycle();
    expect(deletePushSubscriptionByEndpoint).toHaveBeenCalledWith('https://push.example.com/expired');
  });

  it('includes delay info in notification body', async () => {
    vi.mocked(getAllEnabledAlerts).mockReturnValue([makeAlert()]);
    vi.mocked(getCachedDeparturesForTpc).mockReturnValue([makeCachedDep(3, { delay_minutes: 3 })]);
    vi.mocked(getPushSubscriptionsByClient).mockReturnValue([{
      id: 1, client_id: 'client-1', endpoint: 'https://push.example.com/sub1',
      p256dh: 'key1', auth: 'auth1', created_at: '2026-01-01',
    }]);

    await _runSchedulerCycle();

    expect(sendPushNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        body: expect.stringContaining('(+3 min vertraging)'),
      })
    );
  });

  it('filters departures outside time window', async () => {
    vi.mocked(getAllEnabledAlerts).mockReturnValue([
      makeAlert({ time_window_start: '03:00', time_window_end: '03:01' }),
    ]);
    vi.mocked(getCachedDeparturesForTpc).mockReturnValue([makeCachedDep(3)]);

    await _runSchedulerCycle();
    expect(markNotificationSent).not.toHaveBeenCalled();
  });

  it('reads from cached_departures with correct tpc and direction', async () => {
    vi.mocked(getAllEnabledAlerts).mockReturnValue([makeAlert({ tpc: '30003130', direction: 2 })]);
    vi.mocked(getCachedDeparturesForTpc).mockReturnValue([]);

    await _runSchedulerCycle();
    expect(getCachedDeparturesForTpc).toHaveBeenCalledWith('30003130', 2);
  });
});
