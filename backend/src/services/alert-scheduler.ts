import {
  getAllEnabledAlerts,
  getCachedDeparturesForTpc,
  getPushSubscriptionsByClient,
  markNotificationSent,
  deletePushSubscriptionByEndpoint,
  purgeStaleSentNotifications,
  purgeOrphanedAlerts,
} from '../db';
import { sendPushNotification } from './push';

const TZ = 'Europe/Amsterdam';
const SCHEDULER_INTERVAL = 30_000;

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let purgeTimer: ReturnType<typeof setInterval> | null = null;

function getAmsterdamDayOfWeek(now: Date): number {
  // 1=Mon..7=Sun (ISO 8601)
  const dayStr = now.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short' });
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return map[dayStr] ?? 1;
}

function getAmsterdamHHMM(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
}

function isInTimeWindow(time: string, start: string, end: string): boolean {
  if (start === end) return true;
  if (start < end) {
    return time >= start && time <= end;
  }
  // Overnight window: e.g. 22:00 - 02:00
  return time >= start || time <= end;
}

async function runSchedulerCycle(): Promise<void> {
  const now = Date.now();
  const currentDay = getAmsterdamDayOfWeek(new Date(now));
  const nowHHMM = new Date(now).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });

  const alerts = getAllEnabledAlerts();
  if (alerts.length === 0) return;

  console.log(`[alerts] Checking ${alerts.length} alert(s) | day=${currentDay} time=${nowHHMM}`);

  for (const alert of alerts) {
    const daysOfWeek: number[] = JSON.parse(alert.days_of_week);
    if (!daysOfWeek.includes(currentDay)) continue;

    const leadMinutes = alert.walk_time_minutes > 0 ? alert.walk_time_minutes + 1 : 5;
    const leadMs = leadMinutes * 60_000;

    const departures = getCachedDeparturesForTpc(alert.tpc, alert.direction);

    if (departures.length === 0) {
      console.log(`[alerts] ${alert.stop_name}: no cached departures for tpc=${alert.tpc} dir=${alert.direction}`);
      continue;
    }

    for (const dep of departures) {
      const depTime = getAmsterdamHHMM(dep.expected_departure);
      if (!isInTimeWindow(depTime, alert.time_window_start, alert.time_window_end)) continue;

      const expectedMs = new Date(dep.expected_departure).getTime();
      const timeUntilDep = expectedMs - now;

      // Skip if bus already left (>60s ago) or too far away (beyond lead time)
      if (timeUntilDep < -60_000) continue;
      if (timeUntilDep > leadMs) continue;

      // Dedup by journey number + scheduled time
      const dedupKey = `${dep.journey_number}-${dep.scheduled_departure}`;
      if (!markNotificationSent(alert.client_id, dedupKey, alert.tpc)) continue;

      // Send notification
      const subscriptions = getPushSubscriptionsByClient(alert.client_id);
      const minutesAway = Math.max(1, Math.round(timeUntilDep / 60_000));
      const delayText = dep.delay_minutes > 0 ? ` (+${dep.delay_minutes} min vertraging)` : '';

      const payload = {
        title: `Bus 80 over ${minutesAway} min`,
        body: `${depTime} bij ${alert.stop_name}${delayText}`,
        url: '/',
      };

      console.log(`[alerts] SENDING to ${alert.stop_name}: ${payload.title} — ${payload.body} (${subscriptions.length} sub(s))`);

      for (const sub of subscriptions) {
        const success = await sendPushNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
        if (!success) {
          console.log(`[alerts] Subscription expired, removing: ${sub.endpoint.substring(0, 60)}...`);
          deletePushSubscriptionByEndpoint(sub.endpoint);
        }
      }
    }
  }
}

export function startAlertScheduler(): void {
  console.log('Alert scheduler started (30s interval)');

  // Run immediately, then every 30s
  runSchedulerCycle().catch((err) => {
    console.error('Alert scheduler cycle failed:', (err as Error).message);
  });

  schedulerTimer = setInterval(() => {
    runSchedulerCycle().catch((err) => {
      console.error('Alert scheduler cycle failed:', (err as Error).message);
    });
  }, SCHEDULER_INTERVAL);

  // Purge stale sent_notifications every 10 min
  purgeTimer = setInterval(() => {
    purgeStaleSentNotifications();
  }, 10 * 60_000);

  // Purge orphaned alerts daily
  setInterval(() => {
    purgeOrphanedAlerts();
  }, 24 * 60 * 60_000);
}

export function stopAlertScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
  if (purgeTimer) {
    clearInterval(purgeTimer);
    purgeTimer = null;
  }
}

// Exported for testing
export { runSchedulerCycle as _runSchedulerCycle, getAmsterdamDayOfWeek, getAmsterdamHHMM, isInTimeWindow };
