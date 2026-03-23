import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

vi.mock('../db', () => ({
  savePushSubscription: vi.fn(),
  deletePushSubscription: vi.fn(),
  deletePushSubscriptionByEndpoint: vi.fn(),
  getPushSubscriptionsByClient: vi.fn(),
  countPushSubscriptionsByClient: vi.fn(),
}));

vi.mock('../services/push', () => ({
  isPushEnabled: vi.fn(),
  getVapidPublicKey: vi.fn(),
  sendPushNotification: vi.fn(),
}));

import {
  savePushSubscription,
  deletePushSubscription,
  deletePushSubscriptionByEndpoint,
  getPushSubscriptionsByClient,
  countPushSubscriptionsByClient,
} from '../db';
import { isPushEnabled, getVapidPublicKey, sendPushNotification } from '../services/push';
import { _resetTestRateLimits } from './push';

const app = createApp();

const validSubscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
  keys: {
    p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8p8REfWJI',
    auth: 'tBHItJI5svbpC7Dr5oEBnA',
  },
};

beforeEach(() => {
  _resetTestRateLimits();
  vi.mocked(isPushEnabled).mockReturnValue(true);
  vi.mocked(getVapidPublicKey).mockReturnValue('test-vapid-public-key');
  vi.mocked(countPushSubscriptionsByClient).mockReturnValue(0);
  vi.mocked(getPushSubscriptionsByClient).mockReturnValue([]);
  vi.mocked(sendPushNotification).mockResolvedValue(true);
  vi.mocked(savePushSubscription).mockReset();
  vi.mocked(deletePushSubscription).mockReset();
  vi.mocked(deletePushSubscriptionByEndpoint).mockReset();
});

describe('GET /api/push/vapid-key', () => {
  it('returns 200 with vapidPublicKey when push is enabled', async () => {
    const res = await request(app).get('/api/push/vapid-key');
    expect(res.status).toBe(200);
    expect(res.body.vapidPublicKey).toBe('test-vapid-public-key');
  });

  it('returns 503 when push is not configured', async () => {
    vi.mocked(isPushEnabled).mockReturnValue(false);
    const res = await request(app).get('/api/push/vapid-key');
    expect(res.status).toBe(503);
  });
});

describe('POST /api/push/subscribe', () => {
  it('returns 200 and saves subscription', async () => {
    const res = await request(app)
      .post('/api/push/subscribe')
      .send({ clientId: 'client-123', subscription: validSubscription });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(savePushSubscription).toHaveBeenCalledWith(
      'client-123',
      validSubscription.endpoint,
      validSubscription.keys.p256dh,
      validSubscription.keys.auth
    );
  });

  it('returns 400 when clientId missing', async () => {
    const res = await request(app)
      .post('/api/push/subscribe')
      .send({ subscription: validSubscription });
    expect(res.status).toBe(400);
  });

  it('returns 400 when clientId exceeds 36 chars', async () => {
    const res = await request(app)
      .post('/api/push/subscribe')
      .send({ clientId: 'a'.repeat(37), subscription: validSubscription });
    expect(res.status).toBe(400);
  });

  it('returns 400 when endpoint missing', async () => {
    const res = await request(app)
      .post('/api/push/subscribe')
      .send({ clientId: 'client-123', subscription: { keys: validSubscription.keys } });
    expect(res.status).toBe(400);
  });

  it('returns 400 when endpoint is not HTTPS', async () => {
    const res = await request(app)
      .post('/api/push/subscribe')
      .send({
        clientId: 'client-123',
        subscription: { ...validSubscription, endpoint: 'http://example.com' },
      });
    expect(res.status).toBe(400);
  });

  it('returns 400 when keys missing', async () => {
    const res = await request(app)
      .post('/api/push/subscribe')
      .send({
        clientId: 'client-123',
        subscription: { endpoint: validSubscription.endpoint, keys: {} },
      });
    expect(res.status).toBe(400);
  });

  it('returns 429 when subscription cap exceeded', async () => {
    vi.mocked(countPushSubscriptionsByClient).mockReturnValue(10);

    const res = await request(app)
      .post('/api/push/subscribe')
      .send({ clientId: 'client-123', subscription: validSubscription });
    expect(res.status).toBe(429);
  });
});

describe('DELETE /api/push/subscribe', () => {
  it('returns 200 and deletes subscription', async () => {
    const res = await request(app)
      .delete('/api/push/subscribe')
      .send({ clientId: 'client-123', endpoint: validSubscription.endpoint });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(deletePushSubscription).toHaveBeenCalledWith('client-123', validSubscription.endpoint);
  });

  it('returns 400 when clientId missing', async () => {
    const res = await request(app)
      .delete('/api/push/subscribe')
      .send({ endpoint: validSubscription.endpoint });
    expect(res.status).toBe(400);
  });

  it('returns 400 when endpoint missing', async () => {
    const res = await request(app)
      .delete('/api/push/subscribe')
      .send({ clientId: 'client-123' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/push/test', () => {
  it('returns 200 with sent count on success', async () => {
    vi.mocked(getPushSubscriptionsByClient).mockReturnValue([
      {
        id: 1,
        client_id: 'client-123',
        endpoint: validSubscription.endpoint,
        p256dh: validSubscription.keys.p256dh,
        auth: validSubscription.keys.auth,
        created_at: '2026-01-01',
      },
    ]);

    const res = await request(app)
      .post('/api/push/test')
      .send({ clientId: 'client-123' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, sent: 1, expired: 0 });
  });

  it('cleans up expired subscriptions', async () => {
    vi.mocked(getPushSubscriptionsByClient).mockReturnValue([
      {
        id: 1,
        client_id: 'client-123',
        endpoint: validSubscription.endpoint,
        p256dh: validSubscription.keys.p256dh,
        auth: validSubscription.keys.auth,
        created_at: '2026-01-01',
      },
    ]);
    vi.mocked(sendPushNotification).mockResolvedValue(false);

    const res = await request(app)
      .post('/api/push/test')
      .send({ clientId: 'client-123' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, sent: 0, expired: 1 });
    expect(deletePushSubscriptionByEndpoint).toHaveBeenCalledWith(validSubscription.endpoint);
  });

  it('returns 200 with zero counts when no subscriptions', async () => {
    const res = await request(app)
      .post('/api/push/test')
      .send({ clientId: 'client-123' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, sent: 0, expired: 0 });
  });

  it('returns 400 when clientId missing', async () => {
    const res = await request(app)
      .post('/api/push/test')
      .send({});
    expect(res.status).toBe(400);
  });
});
