import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Badge, Button } from '@/components/ui/Primitives';
import { useNotifications, type AppNotification } from '@/hooks/useNotifications';
import { relativeTime } from '@/lib/dates';
import { useEscape } from '@/hooks/useUi';

/** Notification centre bell with unread count, list and mark-all-read. */

const TYPE_ICON: Record<string, IconName> = {
  order: 'cart', payment: 'wallet', invoice: 'invoice', quotation: 'quote',
  stock: 'box', low_stock: 'warning', customer: 'users', review: 'star',
  message: 'mail', ai: 'sparkles', system: 'info', verification: 'shield',
  marketing: 'megaphone', document: 'file', purchase: 'package', refund: 'refresh',
};

function iconFor(n: AppNotification): IconName {
  return TYPE_ICON[n.type] ?? TYPE_ICON[n.icon ?? ''] ?? 'bell';
}

function toneFor(n: AppNotification): string {
  if (n.priority === 'urgent') return 'bg-red-100 text-red-700';
  if (n.priority === 'high') return 'bg-amber-100 text-amber-700';
  if (['payment', 'order', 'review'].includes(n.type)) return 'bg-emerald-100 text-emerald-700';
  if (['low_stock', 'stock'].includes(n.type)) return 'bg-accent-50 text-accent-700';
  if (n.type === 'ai') return 'bg-brand-100 text-brand-700';
  return 'bg-ink-100 text-ink-600';
}

export function NotificationBell({ scope = 'all', compact = false }: {
  scope?: 'all' | 'business' | 'personal';
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { items, unread, markRead, markAllRead, archive, loading } = useNotifications(scope, 30);
  useEscape(open, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const openItem = (n: AppNotification) => {
    void markRead(n.id);
    setOpen(false);
    if (n.action_url) navigate(n.action_url);
    else if (n.entity_type && n.entity_id) navigate(entityRoute(n.entity_type, n.entity_id));
    else navigate('/notifications');
  };

  return (
    <div className="relative" ref={wrap}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
        className={`relative rounded-xl p-2.5 text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900 ${compact ? 'p-2' : ''}`}
      >
        <Icon name="bell" size={compact ? 18 : 20} />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white ring-2 ring-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(92vw,24rem)] overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-pop animate-rise">
          <header className="flex items-center justify-between gap-2 border-b border-ink-200 px-3.5 py-2.5">
            <h2 className="text-sm font-bold">Notifications</h2>
            {unread > 0 && (
              <button type="button" onClick={() => void markAllRead()}
                className="text-xs font-semibold text-brand-700 hover:underline">
                Mark all read
              </button>
            )}
          </header>

          <ul className="max-h-[60vh] divide-y divide-ink-100 overflow-y-auto">
            {loading && items.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-ink-500">Loading…</li>
            )}
            {!loading && items.length === 0 && (
              <li className="flex flex-col items-center px-4 py-10 text-center">
                <span className="mb-2 flex h-11 w-11 items-center justify-center rounded-2xl bg-ink-100 text-ink-400">
                  <Icon name="bell" size={20} />
                </span>
                <p className="text-sm font-semibold text-ink-700">You are all caught up</p>
                <p className="mt-0.5 text-xs text-ink-500">
                  Orders, payments, low stock and messages will appear here.
                </p>
              </li>
            )}

            {items.map((n) => (
              <li key={n.id} className={`group relative ${n.is_read ? 'opacity-70' : ''}`}>
                <button type="button" onClick={() => openItem(n)}
                  className="flex w-full items-start gap-2.5 px-3.5 py-3 text-left hover:bg-ink-50">
                  <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${toneFor(n)}`}>
                    <Icon name={iconFor(n)} size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-bold text-ink-900">{n.title}</span>
                      {!n.is_read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />}
                    </span>
                    {n.body && <span className="mt-0.5 line-clamp-2 block text-xs text-ink-600">{n.body}</span>}
                    <span className="mt-1 block text-[11px] text-ink-400">{relativeTime(n.created_at)}</span>
                  </span>
                </button>
                <button type="button" onClick={() => void archive(n.id)} aria-label="Dismiss"
                  className="absolute right-2 top-2 rounded-lg p-1 text-ink-300 opacity-0 transition-opacity hover:bg-ink-100 hover:text-ink-600 group-hover:opacity-100">
                  <Icon name="close" size={13} />
                </button>
              </li>
            ))}
          </ul>

          <footer className="space-y-1 border-t border-ink-200 bg-ink-50/60 p-2.5">
            <Button variant="ghost" size="sm" block onClick={() => { setOpen(false); navigate('/notifications'); }}
              iconRight="chevronRight">
              View all notifications
            </Button>
            <Button variant="ghost" size="sm" block onClick={() => { setOpen(false); navigate('/account/notifications-settings'); }}
              iconRight="chevronRight">
              Notification settings
            </Button>
          </footer>
        </div>
      )}

      {unread > 0 && !open && (
        <Badge tone="red" className="sr-only">{unread} unread</Badge>
      )}
    </div>
  );
}

function entityRoute(entity: string, id: string): string {
  const map: Record<string, string> = {
    order: '/orders', product: '/products', business: '/store',
    invoice: '/business/invoices', quotation: '/business/quotations',
    receipt: '/business/receipts', payment: '/business/payments',
    customer: '/business/customers', supplier: '/business/suppliers',
    expense: '/business/expenses', purchase_order: '/business/purchases',
    document: '/business/documents', conversation: '/business/messages',
    ai_action: '/business/ai', review: '/business/reviews',
    return: '/business/returns', stock_transfer: '/business/inventory/transfers',
  };
  const base = map[entity] ?? '/notifications';
  return ['store', 'product'].includes(entity) ? `${base}/${id}` : base;
}
