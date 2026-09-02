import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { onForegroundPushMessage } from '@/lib/push';

/**
 * Surfaces Web Push / FCM messages that arrive while the app is open as toast
 * notifications, so a seller is alerted without reloading the page. Background
 * messages (tab closed) are shown by the service worker in public/sw.js.
 */
export function PushForegroundListener() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const un = await onForegroundPushMessage((payload) => {
          const title = payload.title ?? 'New notification';
          const url = payload.url;
          toast({
            tone: 'info',
            title,
            description: payload.body,
            action: url ? { label: 'Open', onClick: () => navigate(url) } : undefined,
            duration: 7000,
          });
        });
        if (cancelled && un) un();
        else unsubscribe = un;
      } catch {
        /* FCM not configured / unsupported — in-app notifications still work. */
      }
    })();
    return () => { cancelled = true; unsubscribe?.(); };
  }, [user, toast, navigate]);

  return null;
}
