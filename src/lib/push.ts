import { vapidPublicKey } from './env';

/**
 * Web Push / Firebase Cloud Messaging helpers — Phase 6.
 *
 * Phase 1 only stores the public VAPID key. The module is intentionally lazy:
 * `firebase/messaging` is only imported when a browser calls the helper, so the
 * core auth/profile bundle does not pay for the Web Push SDK.
 *
 * Security note: `vapidPublicKey` is public. The matching VAPID private key
 * lives in the Firebase console / Cloud Functions and must never be in the repo.
 */

export function getVapidPublicKey(): string {
  return vapidPublicKey;
}

export async function isWebPushSupported(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  const { isSupported } = await import('firebase/messaging');
  return isSupported();
}

export async function getFirebaseMessaging() {
  const { getMessaging } = await import('firebase/messaging');
  const { getFirebaseApp } = await import('./firebase');
  return getMessaging(getFirebaseApp());
}

/** Request permission and return a device token. Used by the Phase 6 flow. */
export async function requestNotificationToken(): Promise<string | null> {
  const supported = await isWebPushSupported();
  if (!supported || !vapidPublicKey) return null;
  const { getToken } = await import('firebase/messaging');
  const messaging = await getFirebaseMessaging();
  try {
    return await getToken(messaging, { vapidKey: vapidPublicKey });
  } catch {
    return null;
  }
}
