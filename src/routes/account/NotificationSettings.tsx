import { useEffect, useState } from 'react';
import { Button, Card, Notice, Skeleton, Switch } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import {
  NOTIFICATION_TYPES,
  defaultPreference,
  hasRegisteredPushToken,
  loadNotificationPreferences,
  saveNotificationPreference,
  type NotificationPreference,
} from '@/lib/notifications';
import {
  getPushPermission,
  isWebPushSupported,
  subscribeToWebPush,
  unsubscribeFromWebPush,
} from '@/lib/push';

/** Notification channels and delivery — the Phase 6 notifications settings page. */

export default function NotificationSettingsPage() {
  const { user } = useAuth();
  const { success, error: toastError } = useToast();
  const [prefs, setPrefs] = useState<NotificationPreference[] | null>(null);
  const [saving, setSaving] = useState<NotificationPreference['type'] | null>(null);
  const [pushSupport, setPushSupport] = useState<'unknown' | 'supported' | 'unsupported'>('unknown');
  const [pushPermission, setPushPermission] = useState<string>('unsupported');
  const [registered, setRegistered] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);

  const load = async () => {
    if (!user) return;
    try { setPrefs(await loadNotificationPreferences(user.id)); }
    catch (e) { toastError('Could not load preferences', e instanceof Error ? e.message : undefined); }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user?.id]);

  useEffect(() => {
    void (async () => {
      const supported = await isWebPushSupported();
      setPushSupport(supported ? 'supported' : 'unsupported');
      if (supported) setPushPermission(await getPushPermission());
      if (user) setRegistered(await hasRegisteredPushToken(user.id));
    })().catch(() => {});
  }, [user]);

  const toggle = async (pref: NotificationPreference) => {
    if (!user) return;
    setSaving(pref.type);
    setPrefs((p) => (p ?? []).map((x) => (x.type === pref.type ? pref : x)));
    try {
      await saveNotificationPreference(user.id, pref);
      success('Preference saved', NOTIFICATION_TYPES.find((t) => t.type === pref.type)?.label);
    } catch (e) {
      toastError('Could not save preference', e instanceof Error ? e.message : undefined);
    } finally {
      setSaving(null);
    }
  };

  const enablePush = async () => {
    if (!user) return;
    setPushBusy(true);
    try {
      await subscribeToWebPush(user.id);
      setPushPermission('granted');
      setRegistered(true);
      success('Browser notifications on', 'This device will now receive push notifications.');
    } catch (e) {
      toastError('Could not enable push', e instanceof Error ? e.message : undefined);
    } finally {
      setPushBusy(false);
    }
  };

  const disablePush = async () => {
    if (!user) return;
    setPushBusy(true);
    try {
      await unsubscribeFromWebPush(user.id);
      setRegistered(false);
      success('Browser notifications off');
    } catch (e) {
      toastError('Could not disable push', e instanceof Error ? e.message : undefined);
    } finally {
      setPushBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-xl font-extrabold sm:text-2xl">Notification settings</h1>
        <p className="text-sm text-ink-500">Choose how Seedwel Hub reaches you for each type of update.</p>
      </div>

      {/* Web Push */}
      <Card className="sh-card-flat p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-extrabold text-ink-950">Browser push</h2>
            <p className="mt-0.5 max-w-md text-xs text-ink-500">
              Get a notification on this device even when you are not on the page. Works in Chrome, Edge or Firefox.
            </p>
          </div>
          {pushSupport === 'unsupported' ? (
            <Button variant="outline" size="sm" icon="bell" disabled>Not supported on this browser</Button>
          ) : registered && pushPermission === 'granted' ? (
            <Button variant="outline" size="sm" icon="close" loading={pushBusy} onClick={() => void disablePush()}>Turn off</Button>
          ) : (
            <Button size="sm" icon="bell" loading={pushBusy} onClick={() => void enablePush()}>Enable</Button>
          )}
        </div>
        {pushSupport === 'supported' && pushPermission === 'denied' && (
          <div className="mt-3"><Notice tone="warning" title="Notifications are blocked">
            You have blocked notifications for this site. Use your browser's site settings to allow them, then reload.
          </Notice></div>
        )}
        {pushSupport === 'unsupported' && (
          <div className="mt-3"><Notice tone="info" title="Push is not available">
            This browser does not support Web Push. In-app and email alerts still work.
          </Notice></div>
        )}
      </Card>

      {/* Per-type channels */}
      <Card className="sh-card-flat overflow-hidden">
        <div className="border-b border-ink-100 px-5 py-3">
          <h2 className="text-sm font-extrabold text-ink-950">Delivery channels</h2>
          <p className="text-xs text-ink-500">In-app notifications are always available. Toggle email and push per type.</p>
        </div>
        {prefs === null ? (
          <div className="space-y-2 p-5">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div>
        ) : (
          <ul className="divide-y divide-ink-100">
            {NOTIFICATION_TYPES.map((def) => {
              const p = prefs.find((x) => x.type === def.type) ?? defaultPreference(def.type);
              return (
                <li key={def.type} className="px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-base" aria-hidden>📨</span>
                      <div>
                        <p className="text-sm font-bold">{def.label}</p>
                        <p className="text-xs text-ink-500">{def.description}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-4">
                      <Switch label="In-app" checked={p.in_app} disabled={saving === p.type}
                        onChange={(v) => void toggle({ ...p, in_app: v })} />
                      <Switch label="Email" checked={p.email} disabled={saving === p.type}
                        onChange={(v) => void toggle({ ...p, email: v })} />
                      <Switch label="Push" checked={p.push} disabled={saving === p.type || pushSupport !== 'supported'}
                        onChange={(v) => void toggle({ ...p, push: v })} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
