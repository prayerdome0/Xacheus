import { getFirebaseDb, type AppUser } from './firebase';
import { collection, addDoc, getDocs, query, where, orderBy, limit, updateDoc, doc, deleteDoc, getDoc } from 'firebase/firestore';
import type { NotificationType, UUID } from '@/types';

export const NOTIFICATION_TYPES: { type: NotificationType; label: string; description: string; icon: string }[] = [
  { type: 'order', label: 'Orders', description: 'New orders, status changes and returns.', icon: 'cart' },
  { type: 'payment', label: 'Payments', description: 'Payments received or confirmed.', icon: 'wallet' },
  { type: 'message', label: 'Messages', description: 'New buyer or seller messages.', icon: 'mail' },
  { type: 'invoice', label: 'Invoices & quotations', description: 'Invoices, quotations and receipts.', icon: 'invoice' },
  { type: 'stock', label: 'Stock alerts', description: 'Low stock and inventory movements.', icon: 'box' },
  { type: 'review', label: 'Reviews', description: 'New customer reviews and ratings.', icon: 'star' },
  { type: 'customer', label: 'Customers & suppliers', description: 'New customer or supplier activity.', icon: 'users' },
  { type: 'document', label: 'Documents', description: 'Documents shared or viewed.', icon: 'file' },
  { type: 'system', label: 'System & AI', description: 'AI action proposals and system notices.', icon: 'sparkles' },
  { type: 'promotion', label: 'Promotions', description: 'Marketing campaigns and promotions.', icon: 'megaphone' },
  { type: 'security', label: 'Security', description: 'Sign-ins, verification and security events.', icon: 'shield' },
];

export interface NotificationPreference {
  type: NotificationType;
  in_app: boolean;
  email: boolean;
  sms: boolean;
  whatsapp: boolean;
  push: boolean;
  quiet_hours: { start: string; end: string; tz?: string } | null;
}

export function defaultPreference(type: NotificationType): NotificationPreference {
  return {
    type,
    in_app: true,
    email: true,
    push: true,
    sms: false,
    whatsapp: false,
    quiet_hours: null,
  };
}

export async function loadNotificationPreferences(userId: UUID): Promise<NotificationPreference[]> {
  try {
    const ref = collection(getFirebaseDb(), 'notification_preferences');
    const q = query(ref, where('user_id', '==', userId), where('business_id', '==', null));
    const snap = await getDocs(q);
    const rows: Partial<NotificationPreference & { type: string }>[] = [];
    snap.forEach((d) => rows.push(d.data() as Partial<NotificationPreference & { type: string }>));

    const byType = new Map<string, NotificationPreference>();
    rows.forEach((r) => {
      if (r.type) {
        byType.set(r.type, {
          type: r.type as NotificationType,
          in_app: r.in_app ?? true,
          email: r.email ?? true,
          push: r.push ?? true,
          sms: r.sms ?? false,
          whatsapp: r.whatsapp ?? false,
          quiet_hours: r.quiet_hours ?? null,
        });
      }
    });

    return NOTIFICATION_TYPES.map((t) => {
      const existing = byType.get(t.type);
      return existing ? { ...existing, type: t.type } : defaultPreference(t.type);
    });
  } catch {
    return NOTIFICATION_TYPES.map(defaultPreference);
  }
}

export async function saveNotificationPreference(userId: UUID, pref: NotificationPreference): Promise<void> {
  try {
    await addDoc(collection(getFirebaseDb(), 'notification_preferences'), {
      user_id: userId,
      business_id: null,
      type: pref.type,
      in_app: pref.in_app,
      email: pref.email,
      sms: pref.sms,
      whatsapp: pref.whatsapp,
      push: pref.push,
      quiet_hours: pref.quiet_hours,
      updated_at: new Date().toISOString(),
    });
  } catch {
    // Best-effort persistence; preferences fall back to defaults in memory.
  }
}

export async function hasRegisteredPushToken(userId: UUID): Promise<boolean> {
  try {
    const ref = collection(getFirebaseDb(), 'push_tokens');
    const q = query(ref, where('user_id', '==', userId), where('is_active', '==', true), limit(1));
    const snap = await getDocs(q);
    return !snap.empty;
  } catch {
    return false;
  }
}
