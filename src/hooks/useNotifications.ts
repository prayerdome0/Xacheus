import { useCallback, useEffect, useState } from 'react';
import { getFirebaseDb } from '@/lib/firebase';
import { collection, getDocs, query, where, orderBy, limit, updateDoc, doc } from 'firebase/firestore';
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

export function useNotifications(scope: 'all' | 'business' | 'personal' = 'all', limitCount = 40) {
  const { user } = useAuth();
  const { activeBusiness } = useBusiness();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user) { setItems([]); return; }
    setLoading(true);
    try {
      const ref = collection(getFirebaseDb(), 'notifications');
      const conditions = [
        where('user_id', '==', user.id),
        where('is_archived', '==', false),
        orderBy('created_at', 'desc'),
        limit(limitCount),
      ];
      if (scope === 'business' && activeBusiness) {
        conditions.splice(2, 0, where('business_id', '==', activeBusiness.id));
      } else if (scope === 'personal') {
        conditions.splice(2, 0, where('business_id', '==', null));
      }
      const q = query(ref, ...conditions);
      const snap = await getDocs(q);
      const rows: AppNotification[] = [];
      snap.forEach((d) => {
        const data = d.data();
        rows.push({
          id: d.id,
          type: data.type ?? '',
          title: data.title ?? '',
          body: data.body ?? null,
          icon: data.icon ?? null,
          action_url: data.action_url ?? null,
          entity_type: data.entity_type ?? null,
          entity_id: data.entity_id ?? null,
          priority: data.priority ?? 'normal',
          is_read: data.is_read ?? false,
          read_at: data.read_at ?? null,
          business_id: data.business_id ?? null,
          created_at: data.created_at ?? '',
        });
      });
      setItems(rows);
    } finally {
      setLoading(false);
    }
  }, [user, activeBusiness, scope, limitCount]);

  useEffect(() => { void load(); }, [load]);

  const markRead = useCallback(async (id: string) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true, read_at: new Date().toISOString() } : n)));
    try {
      await updateDoc(doc(getFirebaseDb(), 'notifications', id), {
        is_read: true,
        read_at: new Date().toISOString(),
      });
    } catch {
      // Best-effort update.
    }
  }, []);

  const markAllRead = useCallback(async () => {
    if (!user) return;
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true, read_at: n.read_at ?? new Date().toISOString() })));
    try {
      const ref = collection(getFirebaseDb(), 'notifications');
      let conditions = [
        where('user_id', '==', user.id),
        where('is_read', '==', false),
        where('is_archived', '==', false),
      ];
      if (scope === 'business' && activeBusiness) {
        conditions = conditions.map((c) => c);
      }
      const q = query(ref, ...conditions);
      const snap = await getDocs(q);
      const updates = snap.docs.map((d) =>
        updateDoc(doc(getFirebaseDb(), 'notifications', d.id), {
          is_read: true,
          read_at: new Date().toISOString(),
        })
      );
      await Promise.all(updates);
    } catch {
      // Best-effort.
    }
  }, [user, activeBusiness, scope]);

  const archive = useCallback(async (id: string) => {
    setItems((prev) => prev.filter((n) => n.id !== id));
    try {
      await updateDoc(doc(getFirebaseDb(), 'notifications', id), { is_archived: true });
    } catch {
      // Best-effort.
    }
  }, []);

  const unread = items.filter((n) => !n.is_read).length;

  return { items, unread, loading, refresh: load, markRead, markAllRead, archive };
}
