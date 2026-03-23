import webpush from 'web-push';
import { pushConfig } from '../config';

let pushEnabled = false;

export function isPushEnabled(): boolean {
  return pushEnabled;
}

export function initPush(): boolean {
  const { vapidPublicKey, vapidPrivateKey, vapidSubject } = pushConfig;

  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    console.warn('VAPID keys not configured — push notifications disabled');
    return false;
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  pushEnabled = true;
  console.log('Web Push initialized with VAPID');
  return true;
}

export function getVapidPublicKey(): string {
  return pushConfig.vapidPublicKey;
}

export interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

/**
 * Send a push notification. Returns true on success, false if the
 * subscription is expired/invalid (caller should clean up).
 */
export async function sendPushNotification(
  subscription: PushSubscription,
  payload: object
): Promise<boolean> {
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: subscription.keys,
      },
      JSON.stringify(payload)
    );
    return true;
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 404 || statusCode === 410) {
      return false;
    }
    console.error('Push notification failed:', (err as Error).message);
    return false;
  }
}
