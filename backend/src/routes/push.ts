import { Router, Request, Response } from 'express';
import {
  savePushSubscription,
  deletePushSubscription,
  getPushSubscriptionsByClient,
  countPushSubscriptionsByClient,
  deletePushSubscriptionByEndpoint,
} from '../db';
import {
  isPushEnabled,
  getVapidPublicKey,
  sendPushNotification,
} from '../services/push';

export const pushRouter = Router();

// Rate limiter for test notifications: 2/min per IP
const testRateLimitMap = new Map<string, number[]>();
const TEST_RATE_LIMIT_MAX = 10;
const TEST_RATE_LIMIT_WINDOW = 60_000;

const MAX_SUBSCRIPTIONS_PER_CLIENT = 10;

function isTestRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = testRateLimitMap.get(ip) || [];
  const recent = timestamps.filter((t) => now - t < TEST_RATE_LIMIT_WINDOW);
  testRateLimitMap.set(ip, recent);

  if (recent.length >= TEST_RATE_LIMIT_MAX) return true;
  recent.push(now);
  return false;
}

// Exposed for testing
export function _resetTestRateLimits(): void {
  testRateLimitMap.clear();
}

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of testRateLimitMap) {
    const recent = timestamps.filter((t) => now - t < TEST_RATE_LIMIT_WINDOW);
    if (recent.length === 0) testRateLimitMap.delete(key);
    else testRateLimitMap.set(key, recent);
  }
}, 5 * 60_000);

// GET /api/push/vapid-key — returns public VAPID key
pushRouter.get('/vapid-key', (_req: Request, res: Response) => {
  if (!isPushEnabled()) {
    res.status(503).json({ error: 'Push notifications not configured' });
    return;
  }
  res.json({ vapidPublicKey: getVapidPublicKey() });
});

// POST /api/push/subscribe — store a push subscription
pushRouter.post('/subscribe', (req: Request, res: Response) => {
  if (!isPushEnabled()) {
    res.status(503).json({ error: 'Push notifications not configured' });
    return;
  }

  const { clientId, subscription } = req.body;

  if (!clientId || typeof clientId !== 'string' || clientId.length > 36) {
    res.status(400).json({ error: 'Valid clientId is required (max 36 chars)' });
    return;
  }

  if (!subscription?.endpoint || typeof subscription.endpoint !== 'string') {
    res.status(400).json({ error: 'subscription.endpoint is required' });
    return;
  }

  if (!subscription.endpoint.startsWith('https://')) {
    res.status(400).json({ error: 'subscription.endpoint must be HTTPS' });
    return;
  }

  if (subscription.endpoint.length > 500) {
    res.status(400).json({ error: 'subscription.endpoint too long' });
    return;
  }

  if (!subscription.keys?.p256dh || !subscription.keys?.auth) {
    res.status(400).json({ error: 'subscription.keys.p256dh and auth are required' });
    return;
  }

  // Cap subscriptions per client
  const count = countPushSubscriptionsByClient(clientId);
  if (count >= MAX_SUBSCRIPTIONS_PER_CLIENT) {
    res.status(429).json({ error: 'Too many subscriptions for this client' });
    return;
  }

  savePushSubscription(clientId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth);
  res.json({ ok: true });
});

// DELETE /api/push/subscribe — remove a push subscription
pushRouter.delete('/subscribe', (req: Request, res: Response) => {
  const { clientId, endpoint } = req.body;

  if (!clientId || typeof clientId !== 'string' || clientId.length > 36) {
    res.status(400).json({ error: 'Valid clientId is required' });
    return;
  }

  if (!endpoint || typeof endpoint !== 'string') {
    res.status(400).json({ error: 'endpoint is required' });
    return;
  }

  deletePushSubscription(clientId, endpoint);
  res.json({ ok: true });
});

// POST /api/push/test — send a test notification
pushRouter.post('/test', async (req: Request, res: Response) => {
  if (!isPushEnabled()) {
    res.status(503).json({ error: 'Push notifications not configured' });
    return;
  }

  const { clientId } = req.body;

  if (!clientId || typeof clientId !== 'string' || clientId.length > 36) {
    res.status(400).json({ error: 'Valid clientId is required' });
    return;
  }

  const ip = req.ip || 'unknown';
  if (isTestRateLimited(ip)) {
    res.status(429).json({ error: 'Too many test notifications. Try again later.' });
    return;
  }

  const subscriptions = getPushSubscriptionsByClient(clientId);

  let sent = 0;
  let expired = 0;

  for (const sub of subscriptions) {
    const success = await sendPushNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      {
        title: 'busties.nl',
        body: 'Notificaties werken! 🚌',
        url: '/',
      }
    );

    if (success) {
      sent++;
    } else {
      deletePushSubscriptionByEndpoint(sub.endpoint);
      expired++;
    }
  }

  res.json({ ok: true, sent, expired });
});
