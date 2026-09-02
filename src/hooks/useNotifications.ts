import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useBusiness } from '@/context/BusinessContext';

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  icon: string | null;
  action_url: string | null;
  entity_type: string | null;
  entity_id: string | null;
  priority: string;
  is_read: boolean;
  read_at: string | null;
  business_id: string | null;
  created_at: string;
}

/**
 * Notification centre with realtime delivery.
 *
 * Subscribes to inserts on public.notifications so an order, payment, low-stock
 * alert or AI proposal appears without the user refreshing.
 */
export function useNotifications(scope: 'all' | 'business' | 'personal' = 'all', limit = 40) {
  const { user } = useAuth();
  const { activeBusiness } = useBusiness();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user) { setItems([]); return; }
    setLoading(true);
    try {
      let q = supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_archived', false)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (scope === 'business' && activeBusiness) q = q.eq('business_id', activeBusiness.id);
      if (scope === 'personal') q = q.is('business_id', null);

      const { data, error } = await q;
      if (!error) setItems((data ?? []) as AppNotification[]);
    } finally {
      setLoading(false);
    }
  }, [user, activeBusiness, scope, limit]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`notifications-${user.id}-${scope}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        (payload) => {
          const row = payload.new as AppNotification;
          setItems((prev) => [row, ...prev.filter((n) => n.id !== row.id)].slice(0, limit));
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        (payload) => {
          const row = payload.new as AppNotification;
          setItems((prev) => prev.map((n) => (n.id === row.id ? row : n)));
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [user, scope, limit]);

  const markRead = useCallback(async (id: string) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true, read_at: new Date().toISOString() } : n)));
    await supabase.from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', id);
  }, []);

  const markAllRead = useCallback(async () => {
    if (!user) return;
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true, read_at: n.read_at ?? new Date().toISOString() })));
    let q = supabase.from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('is_read', false);
    if (scope === 'business' && activeBusiness) q = q.eq('business_id', activeBusiness.id);
    await q;
  }, [user, activeBusiness, scope]);

  const archive = useCallback(async (id: string) => {
    setItems((prev) => prev.filter((n) => n.id !== id));
    await supabase.from('notifications').update({ is_archived: true }).eq('id', id);
  }, []);

  const unread = items.filter((n) => !n.is_read).length;

  return { items, unread, loading, refresh: load, markRead, markAllRead, archive };
}
