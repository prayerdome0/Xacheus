import { useEffect, useState } from 'react';
import { Link, Outlet, useNavigate, useParams } from 'react-router-dom';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Badge, Button, EmptyState, Input, Modal, Notice, Select, Textarea } from '@/components/ui/Primitives';
import { Avatar, BusinessAvatar, StatusBadge, Tabs } from '@/components/ui';
import { AvatarUploader } from '@/components/ui/ImageUploader';
import { useAuth } from '@/context/AuthContext';
import { useBusiness } from '@/context/BusinessContext';
import { useToast } from '@/context/ToastContext';
import { supabase } from '@/lib/supabase';
import { createPaymentLink } from '@/lib/api';
import { cloudinaryUpload } from '@/lib/cloudinary';
import { useQuery } from '@/hooks/useQuery';
import { formatMoney, toNum } from '@/lib/currency';
import { formatDate, formatDateTime, relativeTime } from '@/lib/dates';
import { displayName } from '@/lib/format';
import { normalisePhone } from '@/lib/slug';
import { whatsappUrl } from '@/lib/share';
import { BUCKETS } from '@/lib/supabase';
import { BRAND, COUNTRY_LABELS, ORDER_STATUS_LABELS } from '@/lib/constants';
import type {
  Address, Customer, DataRequest, Order, OrderItem, Product, UUID, WishlistItem,
} from '@/types';

/**
 * Buyer account centre: profile, orders, wishlist, addresses, reviews,
 * notifications, security and the data-privacy controls the spec requires
 * (export my data, delete my account) backed by the data_requests table.
 */

const TABS: { key: string; label: string; icon: IconName }[] = [
  { key: '', label: 'Overview', icon: 'dashboard' },
  { key: 'orders', label: 'My orders', icon: 'receipt' },
  { key: 'wishlist', label: 'Wishlist', icon: 'heart' },
  { key: 'addresses', label: 'Addresses', icon: 'pin' },
  { key: 'reviews', label: 'My reviews', icon: 'star' },
  { key: 'messages', label: 'Messages', icon: 'mail' },
  { key: 'settings', label: 'Settings & security', icon: 'settings' },
];

export default function AccountLayout() {
  const { user, profile, signOut } = useAuth();
  const { businesses } = useBusiness();
  const navigate = useNavigate();
  const params = useParams();
  const tab = params['*'] ?? '';

  if (!user) return null;

  return (
    <div className="space-y-4">
      <div className="sh-card flex flex-wrap items-center gap-4 p-4">
        <Avatar src={profile?.avatar_url} name={displayName(profile)} size={64} />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-extrabold sm:text-xl">{displayName(profile)}</h1>
          <p className="truncate text-sm text-ink-500">{profile?.email}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {(profile?.roles ?? ['buyer']).map((r) => (
              <Badge key={r} tone={r === 'buyer' ? 'neutral' : 'brand'}>{r.replace(/_/g, ' ')}</Badge>
            ))}
            {profile?.phone && <Badge tone="neutral" icon="phone">{profile.phone}</Badge>}
            {profile?.two_factor_enabled && <Badge tone="green" icon="shield">2FA on</Badge>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {businesses.length > 0 && (
            <Link to="/business"><Button size="sm" icon="store">My Business</Button></Link>
          )}
          <Button size="sm" variant="outline" icon="logout" onClick={async () => { await signOut(); navigate('/'); }}>
            Sign out
          </Button>
        </div>
      </div>

      <Tabs
        tabs={TABS.map((t) => ({ key: t.key, label: t.label, icon: t.icon }))}
        active={tab}
        onChange={(k) => navigate(k ? `/account/${k}` : '/account')}
      />

      <Outlet />
    </div>
  );
}

/* ── Overview ──────────────────────────────────────────────────────────────── */

export function AccountOverview() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  const orders = useQuery<Order>(
    () => user ? supabase.from('orders').select('id,order_number,status,payment_status,total,currency,placed_at,business:businesses(name,slug,logo_url,verification_status)')
      .eq('buyer_user_id', user.id).order('placed_at', { ascending: false }).limit(5) : null,
    [user?.id],
  );

  const wishlist = useQuery<{ id: UUID }>(
    () => user ? supabase.from('wishlist_items').select('id').eq('user_id', user.id) : null,
    [user?.id],
  );

  const unread = useQuery<{ id: UUID }>(
    () => user ? supabase.from('notifications').select('id').eq('user_id', user.id).eq('is_read', false).limit(1) : null,
    [user?.id],
  );

  const stats = [
    { label: 'Orders', value: orders.data.length ? `${orders.data.length}+` : '0', icon: 'receipt' as IconName, to: '/account/orders' },
    { label: 'Saved items', value: String(wishlist.data.length), icon: 'heart' as IconName, to: '/account/wishlist' },
    { label: 'Unread alerts', value: String(unread.data.length), icon: 'bell' as IconName, to: '/notifications' },
    { label: 'Addresses', value: '—', icon: 'pin' as IconName, to: '/account/addresses' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Link key={s.label} to={s.to} className="sh-card-flat flex items-center gap-3 p-3.5 hover:shadow-card">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
              <Icon name={s.icon} size={19} />
            </span>
            <span className="min-w-0">
              <span className="sh-label block">{s.label}</span>
              <span className="block text-lg font-extrabold leading-tight">{s.value}</span>
            </span>
          </Link>
        ))}
      </div>

      {profile && !profile.phone_verified_at && (
        <Notice tone="warning" title="Verify your phone number" icon="phone" action={
          <Button size="sm" variant="outline" onClick={() => navigate('/account/settings')}>Add & verify</Button>
        }>
          Sellers use your number for delivery updates and order confirmations on WhatsApp.
        </Notice>
      )}

      <section className="sh-card-flat p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-extrabold">Recent orders</h2>
          <Link to="/account/orders"><Button variant="ghost" size="sm" iconRight="chevronRight">All orders</Button></Link>
        </div>

        {orders.loading ? (
          <div className="space-y-2 pt-3">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="sh-skeleton h-14 rounded-xl" />)}
          </div>
        ) : orders.error ? (
          <div className="pt-3"><Notice tone="danger">{orders.error}</Notice></div>
        ) : orders.data.length === 0 ? (
          <EmptyState icon="receipt" title="No orders yet"
            description="When you buy from a seller on Seedwel Hub, the order and its receipts appear here."
            action={<Link to="/search"><Button size="sm" icon="search">Start shopping</Button></Link>} />
        ) : (
          <ul className="mt-3 divide-y divide-ink-100">
            {orders.data.map((o) => (
              <li key={o.id}>
                <Link to={`/orders/${o.id}`} className="flex items-center gap-3 py-2.5 hover:bg-ink-50">
                  <BusinessAvatar business={o.business} size={36} showVerified={false} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{o.business?.name ?? 'Order'}</p>
                    <p className="text-xs text-ink-500">{o.order_number} · {formatDate(o.placed_at)}</p>
                  </div>
                  <StatusBadge status={o.status} />
                  <p className="sh-money shrink-0 text-sm font-extrabold">{formatMoney(o.total, o.currency)}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ── Orders ────────────────────────────────────────────────────────────────── */

export function MyOrdersPage() {
  const { user } = useAuth();
  const [status, setStatus] = useState<string>('');
  const [q, setQ] = useState('');

  const orders = useQuery<Order>(
    () => {
      if (!user) return null;
      let query = supabase.from('orders')
        .select('*, items:order_items(id,name,quantity,unit_price,image_url,product_id), business:businesses(name,slug,logo_url,phone,whatsapp,verification_status)')
        .eq('buyer_user_id', user.id)
        .order('placed_at', { ascending: false })
        .limit(100);
      if (status) query = query.eq('status', status);
      if (q.trim()) query = query.ilike('order_number', `%${q.trim()}%`);
      return query;
    },
    [user?.id, status, q],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[10rem] flex-1">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by order number" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto" placeholder="All statuses"
          options={Object.entries(ORDER_STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
      </div>

      {orders.error && <Notice tone="danger">{orders.error}</Notice>}

      {orders.loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="sh-skeleton h-24 rounded-2xl" />)}
        </div>
      ) : orders.data.length === 0 ? (
        <EmptyState icon="receipt" title={status || q ? 'No orders match' : 'No orders yet'}
          description="Your orders, their status history, invoices and receipts all live here."
          action={<Link to="/search"><Button size="sm" icon="search">Browse products</Button></Link>} />
      ) : (
        <ul className="space-y-3">
          {orders.data.map((o) => (
            <OrderCard key={o.id} order={o} />
          ))}
        </ul>
      )}
    </div>
  );
}

function OrderCard({ order }: { order: Order & { items?: OrderItem[]; business?: { name: string; slug: string; logo_url: string | null; phone?: string | null; whatsapp?: string | null } } }) {
  const items = order.items ?? [];
  const currency = order.currency;
  return (
    <li className="sh-card-flat overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-100 bg-ink-50/60 px-3.5 py-2.5">
        <BusinessAvatar business={order.business} size={32} showVerified={false} />
        <Link to={`/store/${order.business?.slug ?? ''}`} className="min-w-0">
          <p className="truncate text-sm font-bold hover:text-brand-700">{order.business?.name ?? 'Seller'}</p>
        </Link>
        <span className="text-xs text-ink-500">{order.order_number}</span>
        <span className="text-xs text-ink-400">{formatDate(order.placed_at)}</span>
        <span className="ml-auto flex items-center gap-2">
          <StatusBadge status={order.status} />
          <StatusBadge status={order.payment_status} />
        </span>
      </div>

      <div className="flex gap-3 p-3.5">
        <div className="flex -space-x-3">
          {items.slice(0, 4).map((it) => it.image_url ? (
            <img key={it.id} src={it.image_url} alt="" className="h-12 w-12 rounded-xl border-2 border-white object-cover" />
          ) : (
            <span key={it.id} className="flex h-12 w-12 items-center justify-center rounded-xl border-2 border-white bg-ink-100 text-lg">📦</span>
          ))}
          {items.length > 4 && (
            <span className="flex h-12 w-12 items-center justify-center rounded-xl border-2 border-white bg-ink-200 text-xs font-bold">
              +{items.length - 4}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm text-ink-700">
            {items.map((i) => `${i.quantity} × ${i.name}`).join(', ') || 'Order placed'}
          </p>
          <p className="mt-1 text-xs text-ink-500">
            {order.delivery_method === 'delivery' ? '🚚 Delivery' : '🏪 Collection'}
            {order.shipping_city ? ` · ${order.shipping_city}` : ''}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="sh-money text-base font-extrabold">{formatMoney(order.total, currency)}</p>
          {toNum(order.balance_due ?? 0) > 0 && (
            <p className="text-[11px] font-bold text-red-600">Balance {formatMoney(order.balance_due, currency)}</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-ink-100 px-3.5 py-2.5">
        <Link to={`/orders/${order.id}`}><Button size="sm" variant="outline" icon="eye">View order</Button></Link>
        {order.business?.whatsapp && (
          <a href={whatsappUrl(order.business.whatsapp, `Hi, about my order ${order.order_number} on ${BRAND.name}:`)}
            target="_blank" rel="noreferrer" className="sh-btn sh-btn-sm sh-btn-outline">
            <Icon name="whatsapp" size={14} /> Message seller
          </a>
        )}
        {['pending', 'confirmed', 'processing'].includes(order.status) && (
          <CancelOrderButton order={order} />
        )}
        <Link to={`/orders/${order.id}?review=1`} className="ml-auto">
          <Button size="sm" variant="ghost" icon="star">Review items</Button>
        </Link>
      </div>
    </li>
  );
}

function CancelOrderButton({ order }: { order: Order }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const { success, error: toastError } = useToast();

  const cancel = async () => {
    setBusy(true);
    const { error } = await supabase.from('orders')
      .update({ status: 'cancelled', cancel_reason: reason.trim() || 'Cancelled by buyer', cancelled_at: new Date().toISOString() })
      .eq('id', order.id);
    setBusy(false);
    if (error) { toastError('Could not cancel the order', error.message); return; }
    success('Order cancelled', `${order.order_number} — stock has been returned to the seller.`);
    setOpen(false);
    window.location.reload();
  };

  return (
    <>
      <Button size="sm" variant="ghost" className="text-red-600" icon="close" onClick={() => setOpen(true)}>
        Cancel
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Cancel order ${order.order_number}`} size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Keep order</Button>
            <Button variant="danger" size="sm" loading={busy} onClick={() => void cancel()}>Cancel order</Button>
          </>
        }>
        <div className="space-y-3">
          <Notice tone="warning" title="This cannot be undone">
            The seller is notified immediately and any reserved stock is released back to inventory.
            If you already paid, request a refund from the order page instead.
          </Notice>
          <Textarea label="Reason (optional)" rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Found a better price, ordered by mistake, delivery too slow…" />
        </div>
      </Modal>
    </>
  );
}

/* ── Order detail (buyer view) ─────────────────────────────────────────────── */

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { error: toastError } = useToast();
  const [order, setOrder] = useState<(Order & { items: OrderItem[]; business?: Record<string, unknown> }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    (async () => {
      setLoading(true);
      const { data, error: e } = await supabase.from('orders')
        .select('*, items:order_items(*), business:businesses(*), invoices(id,invoice_number,status,total,balance_due,share_token), payments(id,payment_number,amount,method,received_at,status), receipts(id,receipt_number,amount)')
        .eq('id', id)
        .maybeSingle();
      if (!alive) return;
      if (e) setError(e.message);
      else if (!data) setError('That order does not exist or is not on your account.');
      else setOrder(data as never);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [id]);

  if (loading) return <div className="sh-skeleton h-64 w-full rounded-2xl" />;
  if (error || !order) {
    return (
      <div className="mx-auto max-w-lg py-6">
        <EmptyState icon="receipt" title="Order not available" description={error ?? undefined}
          action={<Link to="/orders"><Button size="sm" variant="outline">Back to my orders</Button></Link>} />
      </div>
    );
  }

  const currency = order.currency;
  const history = (order.status_history ?? []) as { status: string; at: string; by?: string }[];
  const business = order.business as Record<string, unknown> | undefined;
  const businessId = (business?.id as UUID | undefined) ?? null;
  const [payBusy, setPayBusy] = useState(false);

  /** "I've Made Payment" — create (or reuse) a payment link for this order and
   *  route the buyer to the page where they declare amount, method, reference
   *  and proof. The seller confirms it on the Payments screen before money is
   *  recorded. */
  const payNow = async () => {
    if (!businessId) return;
    setPayBusy(true);
    try {
      const res = await createPaymentLink({
        business_id: businessId,
        amount: toNum(toNum(order.balance_due) > 0 ? order.balance_due : order.total),
        currency,
        order_id: order.id,
        customer_name: order.shipping_name ?? order.customer?.name ?? undefined,
        allow_custom_amount: true,
        label: `Order ${order.order_number}`,
      });
      navigate(`/pay/${res.code}`);
    } catch (e) {
      toastError('Could not start payment', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setPayBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="sh-card-flat flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-extrabold">Order {order.order_number}</h1>
          <p className="text-sm text-ink-500">
            Placed {formatDateTime(order.placed_at)} · {order.channel.replace(/_/g, ' ')}
          </p>
        </div>
        <StatusBadge status={order.status} />
        <StatusBadge status={order.payment_status} />
        <Button variant="outline" size="sm" icon="arrowLeft" onClick={() => navigate('/orders')}>My orders</Button>
      </div>

      {toNum(order.balance_due) > 0 && (
        <div className="flex flex-col items-start justify-between gap-2 rounded-2xl border border-brand-200 bg-brand-50 p-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm font-extrabold text-brand-800">Payment still due</p>
            <p className="text-xs text-brand-700">{formatMoney(order.balance_due, currency)} — review your order, then tap “I’ve Made Payment”.</p>
          </div>
          <Button icon="wallet" loading={payBusy} onClick={() => void payNow()}>I’ve Made Payment</Button>
        </div>
      )}

      {/* Status timeline */}
      {history.length > 0 && (
        <section className="sh-card-flat p-4">
          <h2 className="text-sm font-extrabold">Progress</h2>
          <ol className="mt-3 space-y-3">
            {history.map((h, i) => (
              <li key={`${h.status}-${i}`} className="flex gap-3">
                <span className="relative flex flex-col items-center">
                  <span className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold ${
                    i === history.length - 1 ? 'bg-brand-600 text-white' : 'bg-ink-200 text-ink-600'
                  }`}>{i + 1}</span>
                  {i < history.length - 1 && <span className="mt-1 w-px flex-1 bg-ink-200" />}
                </span>
                <div className="min-w-0 flex-1 pb-1">
                  <p className="text-sm font-bold capitalize">{(ORDER_STATUS_LABELS[h.status] ?? h.status).replace(/_/g, ' ')}</p>
                  <p className="text-xs text-ink-500">{formatDateTime(h.at)}{h.by ? ` · ${h.by}` : ''}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="sh-card-flat overflow-hidden">
          <h2 className="border-b border-ink-100 px-4 py-3 text-sm font-extrabold">
            Items ({order.items?.length ?? 0})
          </h2>
          <ul className="divide-y divide-ink-100">
            {(order.items ?? []).map((it) => (
              <li key={it.id} className="flex gap-3 p-3.5">
                {it.image_url
                  ? <img src={it.image_url} alt="" className="h-16 w-16 shrink-0 rounded-xl border border-ink-200 object-cover" />
                  : <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-ink-100 text-xl">📦</span>}
                <div className="min-w-0 flex-1">
                  {it.product_id
                    ? <Link to={`/product/${it.product_id}`} className="text-sm font-bold hover:text-brand-700">{it.name}</Link>
                    : <p className="text-sm font-bold">{it.name}</p>}
                  <p className="text-xs text-ink-500">
                    {it.quantity} × {formatMoney(it.unit_price, currency)} per {it.unit}
                    {it.is_wholesale ? ' · wholesale' : ''}
                  </p>
                  {it.sku && <p className="text-[11px] text-ink-400">SKU {it.sku}</p>}
                </div>
                <p className="sh-money shrink-0 text-sm font-extrabold">{formatMoney(it.line_total ?? toNum(it.unit_price) * it.quantity, currency)}</p>
              </li>
            ))}
          </ul>
          <dl className="space-y-1.5 border-t border-ink-100 bg-ink-50/50 p-4 text-sm">
            <Line label="Subtotal" value={formatMoney(order.subtotal, currency)} />
            {toNum(order.discount_total) > 0 && <Line label="Discounts" value={`− ${formatMoney(order.discount_total, currency)}`} tone="text-emerald-600" />}
            {toNum(order.tax_total) > 0 && <Line label="Tax" value={formatMoney(order.tax_total, currency)} />}
            {toNum(order.delivery_fee) > 0 && <Line label="Delivery" value={formatMoney(order.delivery_fee, currency)} />}
            {toNum(order.tip_amount) > 0 && <Line label="Tip" value={formatMoney(order.tip_amount, currency)} />}
            <div className="flex items-center justify-between border-t border-ink-200 pt-2">
              <dt className="text-base font-extrabold">Total</dt>
              <dd className="sh-money text-lg font-extrabold">{formatMoney(order.total, currency)}</dd>
            </div>
            {toNum(order.balance_due) > 0 && (
              <div className="flex items-center justify-between text-red-600">
                <dt className="font-bold">Still to pay</dt>
                <dd className="sh-money font-extrabold">{formatMoney(order.balance_due, currency)}</dd>
              </div>
            )}
          </dl>
        </section>

        <aside className="space-y-3">
          {order.shipping_name && (
            <div className="sh-card-flat p-4">
              <h3 className="text-sm font-extrabold">{order.delivery_method === 'delivery' ? 'Delivery to' : 'Collection for'}</h3>
              <p className="mt-1.5 text-sm font-semibold">{order.shipping_name}</p>
              <p className="text-sm text-ink-600">{order.shipping_phone}</p>
              <p className="mt-1 text-sm text-ink-600">
                {[order.shipping_line1, order.shipping_line2, order.shipping_city, order.shipping_region].filter(Boolean).join(', ')}
              </p>
              {order.delivery_notes && <p className="mt-2 rounded-xl bg-ink-50 p-2.5 text-xs text-ink-600">{order.delivery_notes}</p>}
            </div>
          )}

          {(order as unknown as { invoices?: { id: UUID; invoice_number: string; status: string; total: number; balance_due: number; share_token?: string | null }[] })?.invoices?.map((inv) => (
            <div key={inv.id} className="sh-card-flat p-4">
              <h3 className="text-sm font-extrabold">Invoice {inv.invoice_number}</h3>
              <div className="mt-1.5 flex items-center justify-between text-sm">
                <StatusBadge status={inv.status} />
                <span className="sh-money font-bold">{formatMoney(inv.total, currency)}</span>
              </div>
              {toNum(inv.balance_due) > 0 && (
                <p className="mt-1 text-xs font-bold text-red-600">Balance {formatMoney(inv.balance_due, currency)}</p>
              )}
              <div className="mt-3 grid gap-2">
                {inv.share_token && (
                  <Link to={`/doc/invoice/${inv.share_token}`}>
                    <Button size="sm" block variant="outline" icon="eye">View invoice</Button>
                  </Link>
                )}
                <Link to={`/pay/order/${order.id}`}>
                  <Button size="sm" block icon="wallet">Pay now</Button>
                </Link>
              </div>
            </div>
          ))}

          {((order as unknown as { payments?: { id: UUID; payment_number: string; amount: number; method: string; received_at: string }[] })?.payments?.length ?? 0) > 0 && (
            <div className="sh-card-flat p-4">
              <h3 className="text-sm font-extrabold">Payments</h3>
              <ul className="mt-2 space-y-1.5 text-sm">
                {(order as unknown as { payments: { id: UUID; payment_number: string; amount: number; method: string; received_at: string }[] }).payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-bold">{p.payment_number}</span>
                      <span className="block text-[11px] text-ink-500 capitalize">{p.method.replace(/_/g, ' ')} · {formatDate(p.received_at)}</span>
                    </span>
                    <span className="sh-money shrink-0 font-bold text-emerald-700">{formatMoney(p.amount, currency)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Line({ label, value, tone = 'text-ink-900' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-600">{label}</dt>
      <dd className={`sh-money font-bold ${tone}`}>{value}</dd>
    </div>
  );
}

/* ── Wishlist ──────────────────────────────────────────────────────────────── */

export function WishlistPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<(WishlistItem & { product?: Product })[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase.from('wishlist_items')
      .select('*, product:products(*, business:businesses(id,name,slug,logo_url,city,country_code,verification_status,rating_avg,badges))')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    setItems((data ?? []) as never);
    setLoading(false);
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user?.id]);

  const remove = async (id: UUID) => {
    await supabase.from('wishlist_items').delete().eq('id', id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  if (loading) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="sh-skeleton h-24 rounded-2xl" />)}</div>;

  if (items.length === 0) {
    return (
      <EmptyState icon="heart" title="Nothing saved yet"
        description="Tap the heart on any product to keep it here. Saved items follow your account across devices."
        action={<Link to="/search"><Button size="sm" icon="search">Find something</Button></Link>} />
    );
  }

  return (
    <ul className="space-y-2">
      {items.map((w) => {
        const p = w.product;
        return (
          <li key={w.id} className="sh-card-flat flex items-center gap-3 p-3">
            {p?.primary_image_url
              ? <img src={p.primary_image_url} alt="" className="h-16 w-16 shrink-0 rounded-xl border border-ink-200 object-cover" />
              : <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-ink-100 text-xl">📦</span>}
            <div className="min-w-0 flex-1">
              <Link to={`/product/${p?.slug ?? p?.id ?? ''}`} className="line-clamp-2 text-sm font-bold hover:text-brand-700">
                {p?.name ?? 'Item no longer available'}
              </Link>
              {p && (
                <>
                  <p className="sh-money mt-0.5 text-sm font-extrabold">{formatMoney(p.price, p.currency)}</p>
                  <p className="text-xs text-ink-500">{p.business?.name} · saved {relativeTime(w.created_at)}</p>
                </>
              )}
            </div>
            <div className="flex shrink-0 flex-col gap-1.5">
              {p && <Link to={`/product/${p.slug ?? p.id}`}><Button size="sm" variant="outline">View</Button></Link>}
              <Button size="sm" variant="ghost" icon="trash" className="text-red-600" onClick={() => void remove(w.id)}>
                Remove
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ── Addresses ─────────────────────────────────────────────────────────────── */

export function AddressesPage() {
  const { user } = useAuth();
  const { success, error: toastError } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Address | null>(null);
  const addresses = useQuery<Address>(
    () => user ? supabase.from('addresses').select('*').eq('user_id', user.id).order('is_default', { ascending: false }) : null,
    [user?.id],
  );

  const [form, setForm] = useState({
    label: 'Home', line1: '', line2: '', city: '', region: '', postal_code: '',
    country_code: 'ZM', phone: '', is_default: false,
  });

  const startNew = () => {
    setEditing(null);
    setForm({ label: 'Home', line1: '', line2: '', city: '', region: '', postal_code: '', country_code: 'ZM', phone: user?.phone ?? '', is_default: addresses.data.length === 0 });
    setOpen(true);
  };

  const startEdit = (a: Address) => {
    setEditing(a);
    setForm({
      label: a.label ?? 'Home', line1: a.line1 ?? '', line2: a.line2 ?? '', city: a.city ?? '',
      region: a.region ?? '', postal_code: a.postal_code ?? '', country_code: a.country_code ?? 'ZM',
      phone: a.phone ?? '', is_default: a.is_default,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!user) return;
    if (!form.line1.trim()) { toastError('Enter the street address'); return; }
    const payload = {
      user_id: user.id, label: form.label.trim() || 'Address', line1: form.line1.trim(),
      line2: form.line2.trim() || null, city: form.city.trim() || null, region: form.region.trim() || null,
      postal_code: form.postal_code.trim() || null, country_code: form.country_code,
      phone: form.phone ? normalisePhone(form.phone) : null, is_default: form.is_default,
    };
    const { error } = editing
      ? await supabase.from('addresses').update(payload).eq('id', editing.id)
      : await supabase.from('addresses').insert(payload);
    if (error) { toastError('Could not save the address', error.message); return; }
    success(editing ? 'Address updated' : 'Address saved');
    setOpen(false);
    void addresses.refresh();
  };

  const remove = async (a: Address) => {
    const { error } = await supabase.from('addresses').delete().eq('id', a.id);
    if (error) { toastError('Could not delete', error.message); return; }
    success('Address removed');
    void addresses.refresh();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-extrabold">Saved addresses</h2>
        <Button size="sm" icon="plus" onClick={startNew}>Add address</Button>
      </div>

      {addresses.error && <Notice tone="danger">{addresses.error}</Notice>}

      {addresses.data.length === 0 && !addresses.loading ? (
        <EmptyState icon="pin" title="No saved addresses"
          description="Save your home, work or a relative's address to check out faster."
          action={<Button size="sm" icon="plus" onClick={startNew}>Add your first address</Button>} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {addresses.data.map((a) => (
            <li key={a.id} className="sh-card-flat p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-bold">
                    {a.label}
                    {a.is_default && <Badge tone="brand">Default</Badge>}
                  </p>
                  <p className="mt-1 text-sm text-ink-600">
                    {[a.line1, a.line2, a.city, a.region, a.postal_code].filter(Boolean).join(', ')}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {COUNTRY_LABELS[a.country_code] ?? a.country_code}{a.phone ? ` · ${a.phone}` : ''}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="outline" icon="edit" onClick={() => startEdit(a)}>Edit</Button>
                <Button size="sm" variant="ghost" icon="trash" className="text-red-600" onClick={() => void remove(a)}>Delete</Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Edit address' : 'Add address'} size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={() => void save()}>{editing ? 'Save changes' : 'Save address'}</Button>
          </>
        }>
        <div className="space-y-3">
          <Input label="Label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })}
            placeholder="Home, Work, Mum's house" />
          <Input label="Address line 1" required value={form.line1} onChange={(e) => setForm({ ...form, line1: e.target.value })} />
          <Input label="Address line 2" value={form.line2} onChange={(e) => setForm({ ...form, line2: e.target.value })} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="City / town" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            <Input label="Province" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} />
            <Input label="Postal code" value={form.postal_code} onChange={(e) => setForm({ ...form, postal_code: e.target.value })} />
            <Select label="Country" value={form.country_code} onChange={(e) => setForm({ ...form, country_code: e.target.value })}
              options={Object.entries(COUNTRY_LABELS).map(([value, lab]) => ({ value, label: lab }))} />
          </div>
          <Input label="Phone for this address" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
              className="h-4 w-4 rounded border-ink-300 text-brand-600" />
            Use as my default address
          </label>
        </div>
      </Modal>
    </div>
  );
}

/* ── My reviews ────────────────────────────────────────────────────────────── */

export function MyReviewsPage() {
  const { user } = useAuth();
  const reviews = useQuery<{
    id: UUID; rating: number; title: string | null; body: string | null; created_at: string;
    product_id: UUID | null; is_verified_purchase: boolean; seller_reply: string | null;
    product?: Product | null;
  }>(
    () => user ? supabase.from('reviews')
      .select('*, product:products(id,name,slug,primary_image_url)')
      .eq('reviewer_id', user.id).order('created_at', { ascending: false }) : null,
    [user?.id],
  );

  if (reviews.loading) return <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="sh-skeleton h-20 rounded-2xl" />)}</div>;

  if (reviews.data.length === 0) {
    return (
      <EmptyState icon="star" title="You have not reviewed anything yet"
        description="Reviews help other buyers decide, and sellers with reviews get more orders."
        action={<Link to="/account/orders"><Button size="sm" icon="receipt">Review an order</Button></Link>} />
    );
  }

  return (
    <ul className="space-y-2">
      {reviews.data.map((r) => (
        <li key={r.id} className="sh-card-flat p-4">
          <div className="flex items-start gap-3">
            {r.product?.primary_image_url && (
              <img src={r.product.primary_image_url} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {r.product && (
                  <Link to={`/product/${r.product.slug ?? r.product.id}`} className="text-sm font-bold hover:text-brand-700">
                    {r.product.name}
                  </Link>
                )}
                <span className="text-accent-400">{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</span>
                {r.is_verified_purchase && <Badge tone="green" icon="check">Verified</Badge>}
                <span className="text-[11px] text-ink-400">{relativeTime(r.created_at)}</span>
              </div>
              {r.title && <p className="mt-1 text-sm font-semibold">{r.title}</p>}
              {r.body && <p className="mt-0.5 text-sm text-ink-600">{r.body}</p>}
              {r.seller_reply && (
                <div className="mt-2 rounded-xl bg-ink-50 p-2.5 text-[13px]">
                  <p className="font-bold text-ink-700">Seller reply</p>
                  <p className="mt-0.5 text-ink-600">{r.seller_reply}</p>
                </div>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ── Messages ──────────────────────────────────────────────────────────────── */

export function MyMessagesPage() {
  const { user } = useAuth();
  const [activeId, setActiveId] = useState<UUID | null>(null);
  const conversations = useQuery<{
    id: UUID; business_id: UUID; subject: string | null; status: string;
    last_message_preview: string | null; last_message_at: string; unread_user: number;
    business?: { name: string; slug: string; logo_url: string | null };
  }>(
    () => user ? supabase.from('conversations')
      .select('*, business:businesses(name,slug,logo_url)')
      .eq('participant_user_id', user.id).order('last_message_at', { ascending: false }) : null,
    [user?.id],
  );

  const messages = useQuery<{
    id: UUID; body: string; sender_type: string; sender_name: string; created_at: string; is_read: boolean;
  }>(
    () => activeId ? supabase.from('messages').select('*').eq('conversation_id', activeId)
      .is('deleted_at', null).order('created_at', { ascending: true }).limit(200) : null,
    [activeId],
  );

  const [draft, setDraft] = useState('');
  const [link, setLink] = useState('');
  const [sending, setSending] = useState(false);

  const send = async (attachment?: { type: 'image' | 'link'; url: string; name?: string }) => {
    if (!activeId || !user || (!draft.trim() && !attachment)) return;
    setSending(true);
    const name = displayName({ display_name: user.user_metadata?.display_name as string, full_name: user.user_metadata?.full_name as string, email: user.email });
    const { error } = await supabase.from('messages').insert({
      conversation_id: activeId, sender_id: user.id, sender_type: 'user', sender_name: name,
      body: attachment?.type === 'link' ? link.trim()
        : attachment?.type === 'image' ? (draft.trim() || 'Sent an image.')
        : draft.trim(),
      attachment: attachment ?? null,
      is_read: false,
    });
    setSending(false);
    if (!error) { setDraft(''); setLink(''); void messages.refresh(); void conversations.refresh(); }
  };

  return (
    <div className="grid gap-3 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <div className="sh-card-flat overflow-hidden">
        <h2 className="border-b border-ink-100 px-4 py-3 text-sm font-extrabold">Conversations</h2>
        {conversations.data.length === 0 ? (
          <p className="p-4 text-sm text-ink-500">
            No conversations yet. Message a seller from any store or product page.
          </p>
        ) : (
          <ul className="max-h-[70vh] divide-y divide-ink-100 overflow-y-auto">
            {conversations.data.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => setActiveId(c.id)}
                  className={`flex w-full items-start gap-2.5 px-3.5 py-3 text-left hover:bg-ink-50 ${
                    activeId === c.id ? 'bg-brand-50' : ''
                  }`}>
                  <BusinessAvatar business={c.business} size={34} showVerified={false} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-bold">{c.business?.name ?? 'Seller'}</span>
                      {c.unread_user > 0 && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />}
                    </span>
                    <span className="block truncate text-xs text-ink-500">{c.last_message_preview ?? c.subject ?? '—'}</span>
                    <span className="mt-0.5 block text-[11px] text-ink-400">{relativeTime(c.last_message_at)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="sh-card-flat flex min-h-[24rem] flex-col">
        {!activeId ? (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-ink-500">
            Select a conversation to read and reply.
          </div>
        ) : (
          <>
            <ul className="flex-1 space-y-2.5 overflow-y-auto p-4">
              {messages.data.map((m) => {
                const att = (m as { attachment?: { type?: string; url?: string; name?: string } | null }).attachment ?? null;
                const imgUrl = att?.type === 'image' ? att.url : null;
                return (
                  <li key={m.id} className={`flex ${m.sender_type === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm ${
                      m.sender_type === 'user' ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-800'
                    }`}>
                      {m.sender_type !== 'user' && <p className="text-[11px] font-bold opacity-70">{m.sender_name}</p>}
                      {imgUrl && <img src={imgUrl} alt={att?.name ?? 'attachment'} className="mb-1.5 max-h-52 rounded-lg object-cover" />}
                      <p className="whitespace-pre-line">{m.body}</p>
                      <p className={`mt-1 text-[10px] ${m.sender_type === 'user' ? 'text-white/60' : 'text-ink-400'}`}>
                        {formatDateTime(m.created_at)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="space-y-2 border-t border-ink-100 p-3">
              <div className="flex items-end gap-2">
                <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
                  placeholder="Write a reply…" className="flex-1" />
                <label className="shrink-0 cursor-pointer rounded-xl border border-ink-200 px-3 py-2 text-ink-600 hover:bg-ink-50">
                  <span aria-hidden>📎</span>
                  <input type="file" accept="image/*" className="hidden"
                    onChange={async (e) => {
                      const f = e.target.files?.[0] ?? null; e.target.value = '';
                      if (!f) return;
                      setSending(true);
                      try {
                        const up = await cloudinaryUpload(f);
                        await send({ type: 'image', url: up.url, name: up.name });
                      } catch { /* surfaced below */ }
                      finally { setSending(false); }
                    }} />
                </label>
                <Button icon="send" loading={sending} onClick={() => void send()} disabled={!draft.trim()}>Send</Button>
              </div>
              <div className="flex items-center gap-2">
                <Input placeholder="Paste a link to share (optional)" value={link} onChange={(e) => setLink(e.target.value)} className="flex-1" />
                <Button variant="outline" size="sm" icon="link" disabled={!link.trim() || sending} onClick={() => void send({ type: 'link', url: link.trim() })}>Share</Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Settings & security ───────────────────────────────────────────────────── */

export function AccountSettingsPage() {
  const { user, profile, updateProfile, updatePassword } = useAuth();
  const { success, error: toastError } = useToast();
  const [busy, setBusy] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [dataOpen, setDataOpen] = useState<null | 'export' | 'delete'>(null);

  const [form, setForm] = useState({
    full_name: profile?.full_name ?? '',
    display_name: profile?.display_name ?? '',
    phone: profile?.phone ?? '',
    phone_country_code: profile?.phone_country_code ?? '+260',
    country_code: profile?.country_code ?? 'ZM',
    city: profile?.city ?? '',
    headline: profile?.headline ?? '',
    avatar_url: profile?.avatar_url ?? '',
    marketing_opt_in: profile?.marketing_opt_in ?? true,
    language: profile?.language ?? 'en',
    currency: profile?.currency ?? 'ZMW',
  });

  useEffect(() => {
    if (!profile) return;
    setForm((f) => ({
      ...f,
      full_name: profile.full_name ?? '', display_name: profile.display_name ?? '',
      phone: profile.phone ?? '', phone_country_code: profile.phone_country_code ?? '+260',
      country_code: profile.country_code ?? 'ZM', city: profile.city ?? '',
      headline: profile.headline ?? '', avatar_url: profile.avatar_url ?? '',
      marketing_opt_in: profile.marketing_opt_in ?? true,
      language: profile.language ?? 'en', currency: profile.currency ?? 'ZMW',
    }));
  }, [profile]);

  const save = async () => {
    setBusy(true);
    const res = await updateProfile({
      full_name: form.full_name.trim(), display_name: form.display_name.trim() || null,
      phone: form.phone ? normalisePhone(form.phone, form.phone_country_code) : null,
      phone_country_code: form.phone_country_code, country_code: form.country_code,
      city: form.city.trim() || null, headline: form.headline.trim() || null,
      avatar_url: form.avatar_url || null, marketing_opt_in: form.marketing_opt_in,
      language: form.language, currency: form.currency,
    });
    setBusy(false);
    if (res.error) toastError('Could not save', res.error);
    else success('Profile updated');
  };

  const requestData = async (kind: 'export' | 'delete') => {
    if (!user) return;
    const { error } = await supabase.from('data_requests').insert({
      user_id: user.id, request_type: kind === 'export' ? 'export' : 'deletion',
      status: 'pending',
      notes: kind === 'export'
        ? 'Requested a copy of all personal data.'
        : 'Requested account deletion.',
    });
    if (error) { toastError('Could not submit the request', error.message); return; }
    success(kind === 'export' ? 'Export requested' : 'Deletion requested',
      'Our team will contact you at your registered email within 30 days.');
    setDataOpen(null);
  };

  if (!user) return null;

  return (
    <div className="space-y-4">
      <section className="sh-card-flat p-4">
        <h2 className="text-sm font-extrabold">Profile</h2>
        <div className="mt-3">
          <AvatarUploader
            bucket={BUCKETS.avatars} scope="users"
            value={form.avatar_url ? { url: form.avatar_url, path: form.avatar_url, name: 'avatar', size: 0 } : null}
            onChange={(img) => setForm({ ...form, avatar_url: img?.url ?? '' })}
            label="Profile photo"
          />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Input label="Full name" required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          <Input label="Display name" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })}
            hint="Shown on reviews and messages" />
          <Input label="Headline" value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })}
            placeholder="e.g. Furniture maker in Lusaka" />
          <Input label="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          <div className="grid grid-cols-[7rem_1fr] gap-2 sm:col-span-2">
            <Select label="Code" value={form.phone_country_code} onChange={(e) => setForm({ ...form, phone_country_code: e.target.value })}
              options={['+260', '+27', '+267', '+265', '+255', '+254', '+44', '+1'].map((c) => ({ value: c, label: c }))} />
            <Input label="Phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
              hint={profile?.phone_verified_at ? `Verified ${formatDate(profile.phone_verified_at)}` : 'Not verified yet'} />
          </div>
          <Select label="Country" value={form.country_code} onChange={(e) => setForm({ ...form, country_code: e.target.value })}
            options={Object.entries(COUNTRY_LABELS).map(([value, lab]) => ({ value, label: lab }))} />
          <Select label="Preferred currency" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}
            options={['ZMW', 'USD', 'ZAR', 'BWP', 'MWK', 'TZS', 'KES', 'GBP', 'EUR'].map((c) => ({ value: c, label: c }))} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button icon="check" loading={busy} onClick={() => void save()}>Save changes</Button>
        </div>
      </section>

      <section className="sh-card-flat divide-y divide-ink-100">
        <h2 className="px-4 py-3 text-sm font-extrabold">Security</h2>
        <SettingRow icon="lock" title="Password" text={`Signed in as ${user.email}`}
          action={<Button size="sm" variant="outline" onClick={() => setPwOpen(true)}>Change password</Button>} />
        <SettingRow icon="shield" title="Two-factor authentication"
          text={profile?.two_factor_enabled
            ? 'Enabled — a code is required in addition to your password.'
            : 'Add a second step so a stolen password is not enough to enter your account.'}
          action={
            <Button size="sm" variant={profile?.two_factor_enabled ? 'outline' : 'primary'}
              onClick={async () => {
                const res = await updateProfile({ two_factor_enabled: !profile?.two_factor_enabled });
                if (res.error) toastError('Could not change 2FA', res.error);
                else success(profile?.two_factor_enabled ? 'Two-factor turned off' : 'Two-factor turned on');
              }}>
              {profile?.two_factor_enabled ? 'Turn off' : 'Turn on'}
            </Button>
          } />
        <SettingRow icon="history" title="Active sessions"
          text="Sign out everywhere if you used a shared or public device."
          action={<Button size="sm" variant="outline" onClick={async () => {
            await supabase.auth.signOut({ scope: 'global' });
            success('Signed out of all sessions');
            window.location.href = '/';
          }}>Sign out everywhere</Button>} />
      </section>

      <section className="sh-card-flat divide-y divide-ink-100">
        <h2 className="px-4 py-3 text-sm font-extrabold">Privacy & data</h2>
        <SettingRow icon="mail" title="Marketing emails"
          text="Deals, new sellers near you and product tips. Order updates are always sent."
          action={
            <Button size="sm" variant="outline" onClick={async () => {
              await updateProfile({ marketing_opt_in: !form.marketing_opt_in });
              setForm({ ...form, marketing_opt_in: !form.marketing_opt_in });
            }}>
              {form.marketing_opt_in ? 'Unsubscribe' : 'Subscribe'}
            </Button>
          } />
        <SettingRow icon="download" title="Export my data"
          text="Get a copy of your profile, orders, reviews and messages."
          action={<Button size="sm" variant="outline" onClick={() => setDataOpen('export')}>Request export</Button>} />
        <SettingRow icon="trash" title="Delete my account"
          text="Permanent. Businesses you own must be transferred or closed first."
          action={<Button size="sm" variant="danger" onClick={() => setDataOpen('delete')}>Request deletion</Button>} />
      </section>

      <PasswordModal open={pwOpen} onClose={() => setPwOpen(false)} onSubmit={updatePassword} />

      <Modal open={dataOpen !== null} onClose={() => setDataOpen(null)} size="sm"
        title={dataOpen === 'delete' ? 'Delete your account' : 'Export your data'}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setDataOpen(null)}>Cancel</Button>
            <Button size="sm" variant={dataOpen === 'delete' ? 'danger' : 'primary'}
              onClick={() => dataOpen && void requestData(dataOpen)}>
              {dataOpen === 'delete' ? 'Submit deletion request' : 'Submit export request'}
            </Button>
          </>
        }>
        {dataOpen === 'delete' ? (
          <div className="space-y-3">
            <Notice tone="danger" title="This is permanent">
              Your profile, addresses, wishlist and reviews are removed. Orders and invoices are kept
              because sellers are legally required to retain tax records — they stay linked to an
              anonymised buyer reference.
            </Notice>
            <p className="text-sm text-ink-600">
              A deletion request is logged in <code className="rounded bg-ink-100 px-1 font-mono text-xs">data_requests</code> and
              processed by our team within 30 days. You will receive confirmation by email.
            </p>
          </div>
        ) : (
          <p className="text-sm text-ink-600">
            We will email you a machine-readable copy of everything Seedwel Hub holds about you:
            profile, addresses, orders, payments, reviews, messages and notifications.
          </p>
        )}
      </Modal>
    </div>
  );
}

function SettingRow({ icon, title, text, action }: { icon: IconName; title: string; text: string; action: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ink-100 text-ink-600">
        <Icon name={icon} size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">{title}</p>
        <p className="text-xs text-ink-500">{text}</p>
      </div>
      {action}
    </div>
  );
}

function PasswordModal({ open, onClose, onSubmit }: {
  open: boolean; onClose: () => void; onSubmit: (pw: string) => Promise<{ error: string | null }>;
}) {
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const { success, error: toastError } = useToast();

  const run = async () => {
    if (pw.length < 8) { toastError('Use at least 8 characters'); return; }
    if (pw !== confirm) { toastError('The two passwords do not match'); return; }
    setBusy(true);
    const res = await onSubmit(pw);
    setBusy(false);
    if (res.error) toastError('Could not change the password', res.error);
    else { success('Password changed'); setPw(''); setConfirm(''); onClose(); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Change password" size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" loading={busy} onClick={() => void run()}>Update password</Button>
        </>
      }>
      <div className="space-y-3">
        <Input label="New password" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        <Input label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
    </Modal>
  );
}

/* ── Notification centre (full page) ───────────────────────────────────────── */

export function NotificationsPage() {
  const { user } = useAuth();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [items, setItems] = useState<{
    id: UUID; type: string; title: string; body: string | null; icon: string | null;
    action_url: string | null; priority: string; is_read: boolean; created_at: string;
    business_id: UUID | null; business?: { name: string; slug: string } | null;
  }[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { success } = useToast();

  const load = async () => {
    if (!user) return;
    setLoading(true);
    let q = supabase.from('notifications')
      .select('*, business:businesses(name,slug)')
      .eq('user_id', user.id).eq('is_archived', false)
      .order('created_at', { ascending: false }).limit(100);
    if (filter === 'unread') q = q.eq('is_read', false);
    const { data } = await q;
    setItems((data ?? []) as never);
    setLoading(false);
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user?.id, filter]);

  const markAll = async () => {
    if (!user) return;
    await supabase.from('notifications').update({ is_read: true, read_at: new Date().toISOString() })
      .eq('user_id', user.id).eq('is_read', false);
    success('All notifications marked read');
    void load();
  };

  const open = async (n: (typeof items)[number]) => {
    await supabase.from('notifications').update({ is_read: true, read_at: new Date().toISOString() }).eq('id', n.id);
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
    if (n.action_url) navigate(n.action_url);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-extrabold sm:text-2xl">Notifications</h1>
          <p className="text-sm text-ink-500">Orders, payments, messages, stock alerts and AI proposals.</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" icon="check" onClick={() => void markAll()}>Mark all read</Button>
        </div>
      </div>

      <Tabs variant="segment" tabs={[{ key: 'all', label: 'All' }, { key: 'unread', label: 'Unread' }]}
        active={filter} onChange={(k) => setFilter(k as 'all' | 'unread')} />

      {loading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="sh-skeleton h-16 rounded-2xl" />)}</div>
      ) : items.length === 0 ? (
        <EmptyState icon="bell" title={filter === 'unread' ? 'Nothing unread' : 'No notifications yet'}
          description="You will be alerted when an order changes, a payment lands, stock runs low or a customer messages you." />
      ) : (
        <ul className="sh-card-flat divide-y divide-ink-100 overflow-hidden">
          {items.map((n) => (
            <li key={n.id}>
              <button type="button" onClick={() => void open(n)}
                className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-ink-50 ${n.is_read ? 'opacity-70' : ''}`}>
                <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                  n.priority === 'urgent' ? 'bg-red-100 text-red-700'
                    : n.priority === 'high' ? 'bg-amber-100 text-amber-700'
                    : 'bg-brand-50 text-brand-700'
                }`}>
                  <Icon name={iconForType(n.type)} size={17} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-bold">{n.title}</span>
                    {!n.is_read && <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />}
                    {n.business?.name && <Badge tone="neutral">{n.business.name}</Badge>}
                  </span>
                  {n.body && <span className="mt-0.5 block text-[13px] text-ink-600">{n.body}</span>}
                  <span className="mt-1 block text-[11px] text-ink-400">{relativeTime(n.created_at)}</span>
                </span>
                <Icon name="chevronRight" size={16} className="mt-2 shrink-0 text-ink-300" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function iconForType(type: string): IconName {
  const map: Record<string, IconName> = {
    order: 'cart', payment: 'wallet', invoice: 'invoice', quotation: 'quote', receipt: 'receipt',
    stock: 'box', low_stock: 'warning', customer: 'users', review: 'star', message: 'mail',
    ai: 'sparkles', system: 'info', verification: 'shield', marketing: 'megaphone',
    document: 'file', purchase: 'package', refund: 'refresh',
  };
  return map[type] ?? 'bell';
}

/** Buyer-facing orders list at /orders (bottom nav). */
export function OrdersPage() {
  return <MyOrdersPage />;
}

export type { Customer, DataRequest };
