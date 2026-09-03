import { getFirebaseDb } from './firebase';
import { collection, addDoc, getDocs, query, where, limit } from 'firebase/firestore';
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

    return NOTIFICATION_TYPES.map((item) => {
      const existing = byType.get(item.type);
      return existing ? { ...existing, type: item.type } : defaultPreference(item.type);
    });
  } catch {
    return NOTIFICATION_TYPES.map((item) => defaultPreference(item.type));
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

/* ── Notification creation (Firestore) ────────────────────────────────────── */

import { addRow, fetchList, nowIso, type DbWhere } from './db';

export interface AppNotificationInput {
  user_id: string;
  business_id?: string | null;
  type: NotificationType | string;
  title: string;
  body?: string | null;
  icon?: string | null;
  action_url?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  priority?: 'low' | 'normal' | 'high';
}

/** Create one in-app notification document. */
export async function createAppNotification(input: AppNotificationInput): Promise<string> {
  const id = await addRow<{ id: string }>('notifications', {
    user_id: input.user_id,
    business_id: input.business_id ?? null,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    icon: input.icon ?? null,
    action_url: input.action_url ?? null,
    entity_type: input.entity_type ?? null,
    entity_id: input.entity_id ?? null,
    priority: input.priority ?? 'normal',
    is_read: false,
    is_archived: false,
    read_at: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  });
  return id.id;
}

/** Notify the active members of a business (owners/administrators/staff) —
 *  used by order, payment, message and document events so sellers see them in
 *  the bell, exactly like the database triggers used to. */
export async function notifyBusinessMembers(
  businessId: string,
  input: Omit<AppNotificationInput, 'user_id' | 'business_id'> & { business_id?: string | null },
  opts: { exceptUserId?: string | null; roles?: string[] } = {},
): Promise<number> {
  if (!businessId) return 0;
  const roles = opts.roles ?? ['owner', 'administrator', 'manager', 'sales', 'staff', 'member'];
  const members = await fetchList<{ id: string; user_id: string; role: string; status: string }>(
    'business_members',
    {
      where: [
        ['business_id', '==', businessId] as DbWhere,
        ['status', '==', 'active'] as DbWhere,
      ],
      limit: 50,
    },
  );
  let created = 0;
  await Promise.all(
    members
      .filter((m) => roles.includes(m.role) && m.user_id !== opts.exceptUserId)
      .map(async (m) => {
        try {
          await createAppNotification({
            user_id: m.user_id,
            business_id: businessId,
            ...input,
          });
          created += 1;
        } catch {
          /* best effort per recipient */
        }
      }),
  );
  return created;
}

/** Notify a single buyer/user account. */
export async function notifyUser(
  userId: string | null | undefined,
  input: Omit<AppNotificationInput, 'user_id' | 'business_id'>,
  businessId: string | null = null,
): Promise<boolean> {
  if (!userId) return false;
  try {
    await createAppNotification({ user_id: userId, business_id: businessId, ...input });
    return true;
  } catch {
    return false;
  }
}
