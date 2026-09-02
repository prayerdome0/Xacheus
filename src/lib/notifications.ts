import { supabase } from './supabase';
import type { NotificationType, UUID } from '@/types';

/** Notification types a user can toggle channels for. */
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

/** A user's channel preference for one notification type. */
export interface NotificationPreference {
  type: NotificationType;
  in_app: boolean;
  email: boolean;
  sms: boolean;
  whatsapp: boolean;
  push: boolean;
  quiet_hours: { start: string; end: string; tz?: string } | null;
}

/** Defaults — matches the `notification_preferences` table columns. */
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

/** Load the user's notification preferences and merge with defaults. */
export async function loadNotificationPreferences(userId: UUID): Promise<NotificationPreference[]> {
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('user_id', userId)
    .is('business_id', null);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<Partial<NotificationPreference> & { type: string }>;
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
}

/** Persist a single notification preference via the security-definer RPC. */
export async function saveNotificationPreference(userId: UUID, pref: NotificationPreference): Promise<void> {
  const { error } = await supabase.rpc('set_notification_preference', {
    p_user_id: userId,
    p_type: pref.type,
    p_business_id: null,
    p_in_app: pref.in_app,
    p_email: pref.email,
    p_sms: pref.sms,
    p_whatsapp: pref.whatsapp,
    p_push: pref.push,
    p_quiet_hours: pref.quiet_hours,
  });
  if (error) throw new Error(error.message);
}

/** Does this browser already have a registered push token? */
export async function hasRegisteredPushToken(userId: UUID): Promise<boolean> {
  const { data, error } = await supabase
    .from('push_tokens')
    .select('id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .limit(1);
  if (error) return false;
  return Boolean(data && data.length > 0);
}
