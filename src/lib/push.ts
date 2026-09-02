import { vapidPublicKey } from './env';
import { supabase } from './supabase';
import type { UUID } from '@/types';

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

/** Convert the base64url VAPID public key into the Uint8Array PushManager wants. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const base64WithPadding = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64WithPadding);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

/** The browser's push permission state, or 'unsupported'. */
export async function getPushPermission(): Promise<NotificationPermission | 'unsupported'> {
  const supported = await isWebPushSupported();
  if (!supported) return 'unsupported';
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/**
 * Subscribe this browser to Web Push and persist the device token. Returns
 * `true` on success. Rejects are surfaced so the caller can show guidance.
 */
export async function subscribeToWebPush(userId: UUID): Promise<boolean> {
  const supported = await isWebPushSupported();
  if (!supported) throw new Error('Web Push is not supported on this browser.');
  if (typeof Notification === 'undefined') throw new Error('Notifications are not available here.');
  if (Notification.permission === 'denied') throw new Error('Notifications are blocked. Enable them in your browser settings.');
  if (Notification.permission !== 'granted') {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Permission was not granted.');
  }

  const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });

  // Prefer the raw Web Push subscription (works with the VAPID key directly).
  let endpoint: string | null = null;
  let subscription: Record<string, unknown> | null = null;
  try {
    const push = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as unknown as BufferSource,
    });
    subscription = push.toJSON() as Record<string, unknown>;
    endpoint = push.endpoint ?? null;
  } catch {
    /* PushManager unavailable — fall through to FCM token only. */
  }

  // Also acquire the FCM registration token for Cloud Functions fan-out.
  let token: string | null = null;
  try {
    token = await requestNotificationToken();
  } catch {
    /* no FCM token — keep going */
  }

  if (!token && !endpoint) throw new Error('Could not obtain a push token.');
  return saveWebPushToken(userId, token ?? '', endpoint, subscription);
}

/** Persist the browser's push token / subscription to `push_tokens`. */
export async function saveWebPushToken(
  userId: UUID,
  token: string,
  endpoint: string | null,
  subscription?: Record<string, unknown> | null,
): Promise<boolean> {
  const { error } = await supabase.rpc('register_push_token', {
    p_user_id: userId,
    p_token: token,
    p_endpoint: endpoint,
    p_subscription: subscription ?? null,
    p_platform: 'web',
    p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
  });
  if (error) throw new Error(error.message);
  return true;
}

/** Deactivate this browser's push token (called when the user turns push off). */
export async function unsubscribeFromWebPush(userId: UUID): Promise<void> {
  try {
    // Drop the active PushManager subscription if present.
    const registration = await navigator.serviceWorker.getRegistration();
    const sub = await registration?.pushManager?.getSubscription();
    await sub?.unsubscribe();
  } catch {
    /* best-effort */
  }
  const { error } = await supabase.rpc('unregister_push_token', { p_user_id: userId });
  if (error) throw new Error(error.message);
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

/** Hold the foreground-message handler so it can be wired once by the app. */
export async function onForegroundPushMessage(callback: (payload: { title?: string; body?: string; url?: string }) => void): Promise<() => void> {
  const { onMessage } = await import('firebase/messaging');
  const messaging = await getFirebaseMessaging();
  const unsubscribe = onMessage(messaging, (payload) => {
    const data = payload.data ?? {};
    const n = payload.notification ?? {};
    callback({
      title: typeof n.title === 'string' ? n.title : typeof data.title === 'string' ? data.title : undefined,
      body: typeof n.body === 'string' ? n.body : typeof data.body === 'string' ? data.body : undefined,
      url: typeof data.url === 'string' ? data.url : undefined,
    });
  });
  return unsubscribe;
}

/** The FCM registration token, or null if not configured. */
export async function getRegistrationToken(): Promise<string | null> {
  return requestNotificationToken();
}
