import { useState, useEffect, useCallback } from 'react';
import { useClientId } from './useClientId';

export type PushState = 'unsupported' | 'ios-not-installed' | 'ios-old-version' | 'ios-use-safari' | 'prompt' | 'denied' | 'subscribed' | 'loading';

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || ('standalone' in navigator && (navigator as unknown as { standalone: boolean }).standalone);
}

function getIosVersion(): { major: number; minor: number } | null {
  const match = navigator.userAgent.match(/iPhone OS (\d+)_(\d+)/);
  if (!match) return null;
  return { major: parseInt(match[1], 10), minor: parseInt(match[2], 10) };
}

function isIosSafari(): boolean {
  // Safari on iOS: no CriOS (Chrome), no FxiOS (Firefox), no EdgiOS (Edge)
  return isIos() && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray as Uint8Array<ArrayBuffer>;
}

export function usePushNotifications() {
  const clientId = useClientId();
  const [state, setState] = useState<PushState>('loading');
  const [testSending, setTestSending] = useState(false);

  useEffect(() => {
    if (isIos()) {
      if (!isIosSafari()) {
        setState('ios-use-safari');
        return;
      }
      const version = getIosVersion();
      if (version && (version.major < 16 || (version.major === 16 && version.minor < 4))) {
        setState('ios-old-version');
        return;
      }
      if (!isStandalone()) {
        setState('ios-not-installed');
        return;
      }
    }

    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('unsupported');
      return;
    }

    if (Notification.permission === 'denied') {
      setState('denied');
      return;
    }

    // Check if already subscribed
    navigator.serviceWorker.ready.then((registration) => {
      registration.pushManager.getSubscription().then((sub) => {
        setState(sub ? 'subscribed' : 'prompt');
      });
    });
  }, []);

  const subscribe = useCallback(async () => {
    setState('loading');
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'denied') {
        setState('denied');
        return;
      }
      if (permission !== 'granted') {
        setState('prompt');
        return;
      }

      // Fetch VAPID key
      const keyRes = await fetch('/api/push/vapid-key');
      if (!keyRes.ok) throw new Error('Could not fetch VAPID key');
      const { vapidPublicKey } = await keyRes.json();

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      const subJson = subscription.toJSON();

      // Send to backend
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId,
          subscription: {
            endpoint: subJson.endpoint,
            keys: {
              p256dh: subJson.keys?.p256dh,
              auth: subJson.keys?.auth,
            },
          },
        }),
      });

      if (!res.ok) throw new Error('Failed to save subscription');
      setState('subscribed');
    } catch (err) {
      console.error('Push subscribe failed:', err);
      setState('prompt');
    }
  }, [clientId]);

  const unsubscribe = useCallback(async () => {
    setState('loading');
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, endpoint }),
        });
      }
      setState('prompt');
    } catch (err) {
      console.error('Push unsubscribe failed:', err);
      setState('prompt');
    }
  }, [clientId]);

  const sendTest = useCallback(async () => {
    setTestSending(true);
    try {
      await fetch('/api/push/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      });
    } catch (err) {
      console.error('Test notification failed:', err);
    } finally {
      setTestSending(false);
    }
  }, [clientId]);

  return { state, subscribe, unsubscribe, sendTest, testSending };
}
