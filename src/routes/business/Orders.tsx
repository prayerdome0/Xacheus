import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import {
  Badge, Button, EmptyState, Input, Notice, Select, Skeleton, Textarea,
} from '@/components/ui/Primitives';
import {
  ActionSheet, DeniedPanel, MoneyInput, StatusBadge, Tabs, type ActionItem,
} from '@/components/ui';
import { PageHeader } from '@/components/layout/BusinessShell';
import {
  AssignDeliveryModal, CancelOrderModal, DocumentMeta, ORDER_FLOW, OrderTimeline,
  PartyCard, PaymentsList, RecordPaymentModal, ShareDocModal, TotalsBlock,
  nextOrderStatuses, useOrderStatus,
} from '@/components/business/Shared';
import { useBusiness } from '@/context/BusinessContext';
import { useToast } from '@/context/ToastContext';
import { db } from '@/lib/db';
import { createInvoiceFromOrder, createShareToken, fetchOrder } from '@/lib/api';
import { formatMoney, toNum } from '@/lib/currency';
import { formatDate, formatDateTime, relativeTime } from '@/lib/dates';
import { savePdf } from '@/lib/pdf';
import { downloadExcel } from '@/lib/csv';
import { whatsappUrl, smsUrl } from '@/lib/share';
import { missingPermissionMessage } from '@/lib/permissions';
import { ORDER_STATUS_FLOW, ORDER_STATUS_LABELS, PAGE_SIZE } from '@/lib/constants';
import type { Invoice, Order, OrderItem, UUID } from '@/types';

/**
 * Order management.
 *
 * The list is the seller's queue: what needs confirming, what is ready, what is
 * unpaid. The detail screen is where an order becomes money — confirm → prepare
 * → deliver → invoice → payment → receipt — with returns and cancellation
 * handled through the database so stock and the ledger always agree.
 */

type OrderRow = Order & {
  items?: OrderItem[];
  customer?: { id: UUID; name: string; phone: string | null; email: string | null } | null;
  invoices?: (Pick<Invoice, 'id' | 'invoice_number' | 'status' | 'total' | 'balance_due'> & { share_token?: string | null })[];
};

const CHANNEL_LABELS: Record<string, string> = {
  marketplace: 'Marketplace',
  pos: 'POS',
  store: 'Online store',
  wholesale: 'Wholesale',
  manual: 'Created by staff',
  api: 'API',
};

export default function OrdersPage() {
  const { activeBusiness, can } = useBusiness();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();
  const { change, busy: busyStatus } = useOrderStatus();

  const [rows, setRows] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionFor, setActionFor] = useState<OrderRow | null>(null);
  const [payFor, setPayFor] = useState<OrderRow | null>(null);
  const [deliverFor, setDeliverFor] = useState<Order | null>(null);
  const [cancelFor, setCancelFor] = useState<Order | null>(null);

  const status = params.get('status') ?? '';
  const payment = params.get('payment') ?? '';
  const channel = params.get('channel') ?? '';
  const q = params.get('q') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const page = Math.max(1, Number(params.get('page') ?? 1));

  const canFulfil = can('orders.fulfil') || can('orders.write');

  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => { if (!v) next.delete(k); else next.set(k, v); });
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  const load = useCallback(async () => {
    if (!activeBusiness) return;
    setLoading(true);
    setError(null);
    try {
      let query = db.from('orders')
        .select('*, customer:customers(id,name,phone,email), invoices:invoices(id,invoice_number,status,total,balance_due)',
          { count: 'exact' })
        .eq('business_id', activeBusiness.id)
        .order('placed_at', { ascending: false })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

      if (status === 'unpaid') query = query.in('payment_status', ['pending', 'processing']);
      else if (status === 'open') query = query.not('status', 'in', '(cancelled,returned,delivered)');
      else if (status) query = query.eq('status', status);
      if (payment) query = query.eq('payment_status', payment);
      if (channel) query = query.eq('channel', channel);
      if (from) query = query.gte('placed_at', `${from}T00:00:00`);
      if (to) query = query.lte('placed_at', `${to}T23:59:59`);
      if (q.trim()) {
        const term = q.trim().replace(/[,()%]/g, ' ');
        query = query.or(`order_number.ilike.%${term}%,reference.ilike.%${term}%,shipping_name.ilike.%${term}%,shipping_phone.ilike.%${term}%,notes.ilike.%${term}%`);
      }

      const { data, error: e, count } = await query;
      if (e) throw e;
      setRows((data ?? []) as OrderRow[]);
      setTotal(count ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^.*?exception:\s*/i, '') : 'Could not load orders.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [activeBusiness, status, payment, channel, q, from, to, page]);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    rows.forEach((o) => { c[o.status] = (c[o.status] ?? 0) + 1; });
    return c;
  }, [rows]);

  const exportOrders = () => {
    const data = rows.map((o) => ({
      order_number: o.order_number,
      placed_at: o.placed_at,
      status: o.status,
      payment_status: o.payment_status,
      channel: o.channel,
      customer: o.customer?.name ?? o.shipping_name ?? '',
      phone: o.customer?.phone ?? o.shipping_phone ?? '',
      city: o.shipping_city ?? '',
      subtotal: toNum(o.subtotal),
      discount: toNum(o.discount_total),
      tax: toNum(o.tax_total),
      delivery: toNum(o.delivery_fee),
      total: toNum(o.total),
      paid: toNum(o.amount_paid),
      balance: toNum(o.balance_due),
      currency: o.currency,
      served_by: o.served_by_name ?? '',
    }));
    downloadExcel('Orders', `seedwel-orders-${new Date().toISOString().slice(0, 10)}.xls`, data);
    success('Export ready', `${data.length} orders on this page exported.`);
  };

  const makeInvoice = async (o: OrderRow) => {
    try {
      const invoiceId = await createInvoiceFromOrder(o.id);
      success('Invoice created', `Order ${o.order_number} is now invoiced.`);
      navigate(`/business/invoices/${invoiceId}`);
    } catch (e) {
      toastError('Could not create the invoice',
        e instanceof Error ? e.message.replace(/^.*?exception:\s*/i, '') : undefined);
    }
  };

  if (!activeBusiness) return null;
  if (!can('orders.read')) return <DeniedPanel message={missingPermissionMessage('orders.read')} />;

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const revenueOnPage = rows.reduce((s, o) => s + (o.status === 'cancelled' ? 0 : toNum(o.total)), 0);
  const unpaidOnPage = rows.reduce((s, o) => s + toNum(o.balance_due), 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Orders"
        subtitle={`${total} order${total === 1 ? '' : 's'} · ${formatMoney(revenueOnPage, activeBusiness.base_currency)} on this page${
          unpaidOnPage > 0 ? ` · ${formatMoney(unpaidOnPage, activeBusiness.base_currency)} unpaid` : ''}`}
        icon="📦"
        actions={
          <>
            <Button size="sm" variant="outline" icon="download" onClick={exportOrders} disabled={rows.length === 0}>
              Export
            </Button>
            <Link to="/business/pos"><Button size="sm" icon="scan">New POS sale</Button></Link>
          </>
        }
      />

      {/* Queue tabs */}
      <Tabs
        tabs={[
          { key: '', label: 'All', badge: total },
          { key: 'open', label: 'Needs action', badge: counts.pending ?? 0 },
          ...ORDER_STATUS_FLOW.map((s) => ({ key: s, label: ORDER_STATUS_LABELS[s], badge: counts[s] ?? 0 })),
          { key: 'unpaid', label: 'Unpaid' },
          { key: 'cancelled', label: 'Cancelled', badge: counts.cancelled ?? 0 },
        ]}
        active={status}
        onChange={(k) => setParam({ status: k || null })}
      />

      <div className="sh-card-flat space-y-2 p-3">
        <div className="flex flex-wrap gap-2">
          <div className="min-w-[12rem] flex-1">
            <Input value={q} onChange={(e) => setParam({ q: e.target.value || null })}
              placeholder="Search order number, phone, name or reference" />
          </div>
          <Select value={payment} onChange={(e) => setParam({ payment: e.target.value || null })} className="w-auto"
            placeholder="Any payment status"
            options={[
              { value: 'pending', label: 'Not paid' },
              { value: 'processing', label: 'Part paid' },
              { value: 'completed', label: 'Paid' },
              { value: 'refunded', label: 'Refunded' },
            ]} />
          <Select value={channel} onChange={(e) => setParam({ channel: e.target.value || null })} className="w-auto"
            placeholder="Any channel"
            options={Object.entries(CHANNEL_LABELS).map(([value, label]) => ({ value, label }))} />
          <Input type="date" value={from} onChange={(e) => setParam({ from: e.target.value || null })}
            className="w-auto" aria-label="From date" />
          <Input type="date" value={to} onChange={(e) => setParam({ to: e.target.value || null })}
            className="w-auto" aria-label="To date" />
          {(q || status || payment || channel || from || to) && (
            <Button variant="ghost" size="sm" icon="close" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
              Clear
            </Button>
          )}
        </div>
      </div>

      {error && <Notice tone="danger" title="Could not load orders">{error}</Notice>}

      {/* Desktop table */}
      <div className="hidden lg:block">
        <div className="sh-card-flat overflow-hidden">
          <table className="sh-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Channel</th>
                <th className="text-right">Total</th>
                <th className="text-right">Balance</th>
                <th>Status</th>
                <th>Placed</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}><td colSpan={8}><Skeleton className="h-9 w-full" /></td></tr>
                ))
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="p-0">
                  <EmptyState icon="cart" title={q || status || payment || channel ? 'No orders match those filters' : 'No orders yet'}
                    description={q || status || payment || channel
                      ? 'Try widening the date range or clearing a filter.'
                      : 'Orders arrive from your online store, the POS and staff-created sales.'}
                    action={<Link to="/business/pos"><Button size="sm" icon="scan">Record a counter sale</Button></Link>} />
                </td></tr>
              ) : rows.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link to={`/business/orders/${o.id}`} className="font-mono text-[13px] font-bold hover:text-brand-700">
                      {o.order_number}
                    </Link>
                    <span className="block text-[11px] text-ink-500">
                      {o.is_wholesale ? 'Wholesale · ' : ''}{relativeTime(o.placed_at)}
                    </span>
                  </td>
                  <td>
                    <span className="block max-w-[14rem] truncate text-[13px] font-semibold">
                      {o.customer?.name ?? o.shipping_name ?? 'Walk-in'}
                    </span>
                    <span className="block truncate text-[11px] text-ink-500">
                      {o.customer?.phone ?? o.shipping_phone ?? '—'}{o.shipping_city ? ` · ${o.shipping_city}` : ''}
                    </span>
                  </td>
                  <td><Badge tone="neutral">{CHANNEL_LABELS[o.channel] ?? o.channel}</Badge></td>
                  <td className="sh-money text-right text-[13px] font-bold">{formatMoney(o.total, o.currency)}</td>
                  <td className="sh-money text-right text-[13px]">
                    {toNum(o.balance_due) > 0
                      ? <span className="font-bold text-red-600">{formatMoney(o.balance_due, o.currency)}</span>
                      : <span className="text-emerald-600">Paid</span>}
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      <StatusBadge status={o.status} />
                      <StatusBadge status={o.payment_status} />
                    </div>
                  </td>
                  <td className="whitespace-nowrap text-[11px] text-ink-500">{formatDate(o.placed_at)}</td>
                  <td>
                    <button type="button" onClick={() => setActionFor(o)}
                      className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                      aria-label={`Actions for order ${o.order_number}`}>
                      <Icon name="more" size={17} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile cards */}
      <ul className="space-y-2 lg:hidden">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <li key={i}><Skeleton className="h-24 w-full rounded-2xl" /></li>)
        ) : rows.length === 0 ? (
          <EmptyState icon="cart" title="No orders yet"
            action={<Link to="/business/pos"><Button size="sm" icon="scan">Record a counter sale</Button></Link>} />
        ) : rows.map((o) => (
          <li key={o.id} className="sh-card-flat p-3">
            <div className="flex items-start gap-2">
              <Link to={`/business/orders/${o.id}`} className="min-w-0 flex-1">
                <p className="font-mono text-[13px] font-bold">{o.order_number}</p>
                <p className="truncate text-xs text-ink-600">
                  {o.customer?.name ?? o.shipping_name ?? 'Walk-in'} · {relativeTime(o.placed_at)}
                </p>
              </Link>
              <button type="button" onClick={() => setActionFor(o)}
                className="shrink-0 rounded-lg p-1.5 text-ink-400 hover:bg-ink-100"
                aria-label={`Actions for order ${o.order_number}`}>
                <Icon name="more" size={17} />
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="sh-money text-sm font-extrabold">{formatMoney(o.total, o.currency)}</span>
              <StatusBadge status={o.status} />
              <StatusBadge status={o.payment_status} />
              <Badge tone="neutral">{CHANNEL_LABELS[o.channel] ?? o.channel}</Badge>
            </div>
            {canFulfil && nextOrderStatuses(o.status).length > 0 && o.status !== 'cancelled' && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {nextOrderStatuses(o.status).slice(0, 2).map((s) => (
                  <Button key={s} size="sm" variant="outline"
                    loading={busyStatus === s}
                    onClick={() => change(o, s).then(() => load()).catch(() => undefined)}>
                    {ORDER_STATUS_LABELS[s] ?? s}
                  </Button>
                ))}
                {toNum(o.balance_due) > 0 && can('payments.record') && (
                  <Button size="sm" icon="wallet" onClick={() => setPayFor(o)}>Take payment</Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" icon="chevronLeft" disabled={page <= 1}
            onClick={() => setParam({ page: String(page - 1) })}>Previous</Button>
          <span className="text-sm font-semibold text-ink-600">Page {page} of {pageCount}</span>
          <Button variant="outline" size="sm" iconRight="chevronRight" disabled={page >= pageCount}
            onClick={() => setParam({ page: String(page + 1) })}>Next</Button>
        </div>
      )}

      <ActionSheet open={Boolean(actionFor)} onClose={() => setActionFor(null)}
        title={actionFor ? `Order ${actionFor.order_number}` : undefined}
        items={buildOrderActions(actionFor, {
          canFulfil,
          canInvoice: can('invoices.write'),
          canPay: can('payments.record'),
          onOpen: (o) => navigate(`/business/orders/${o.id}`),
          onStatus: (o, s) => change(o, s).then(() => load()).catch(() => undefined),
          onPay: (o) => setPayFor(o),
          onDeliver: (o) => setDeliverFor(o),
          onInvoice: (o) => void makeInvoice(o),
          onCancel: (o) => setCancelFor(o),
          onCustomer: (o) => {
            if (o.customer?.id) navigate(`/business/customers/${o.customer.id}`);
            else navigate('/business/orders/' + o.id);
          },
        })} />

      <RecordPaymentModal open={Boolean(payFor)} onClose={() => setPayFor(null)}
        target={payFor ? {
          businessId: payFor.business_id,
          orderId: payFor.id,
          customerId: payFor.customer_id,
          customerName: payFor.customer?.name ?? payFor.shipping_name,
          currency: payFor.currency,
          balanceDue: toNum(payFor.balance_due),
          documentNumber: payFor.order_number,
        } : null}
        onDone={() => void load()} />

      <AssignDeliveryModal open={Boolean(deliverFor)} onClose={() => setDeliverFor(null)}
        order={deliverFor} onDone={() => void load()} />

      <CancelOrderModal open={Boolean(cancelFor)} onClose={() => setCancelFor(null)}
        order={cancelFor} onDone={() => void load()} />
    </div>
  );
}

function buildOrderActions(o: OrderRow | null, h: {
  canFulfil: boolean; canInvoice: boolean; canPay: boolean;
  onOpen: (o: OrderRow) => void;
  onStatus: (o: OrderRow, s: Order['status']) => void;
  onPay: (o: OrderRow) => void;
  onDeliver: (o: OrderRow) => void;
  onInvoice: (o: OrderRow) => void;
  onCancel: (o: OrderRow) => void;
  onCustomer: (o: OrderRow) => void;
}): ActionItem[] {
  if (!o) return [];
  const items: ActionItem[] = [
    { label: 'Open order', icon: <Icon name="eye" size={17} />, onSelect: () => h.onOpen(o) },
  ];
  if (h.canFulfil) {
    nextOrderStatuses(o.status).forEach((s) => {
      if (s === 'cancelled') return;
      items.push({
        label: `Mark ${ORDER_STATUS_LABELS[s] ?? s}`,
        icon: <Icon name="chevronRight" size={17} />,
        onSelect: () => h.onStatus(o, s),
      });
    });
    if (o.status !== 'cancelled' && o.status !== 'returned') {
      items.push({ label: 'Arrange delivery', icon: <Icon name="truck" size={17} />, onSelect: () => h.onDeliver(o) });
    }
  }
  if (h.canPay && toNum(o.balance_due) > 0 && o.status !== 'cancelled') {
    items.push({ label: 'Take payment', icon: <Icon name="wallet" size={17} />, onSelect: () => h.onPay(o) });
  }
  if (h.canInvoice && !(o.invoices?.length)) {
    items.push({ label: 'Create invoice', icon: <Icon name="invoice" size={17} />, onSelect: () => h.onInvoice(o) });
  }
  items.push({ label: 'Open customer', icon: <Icon name="users" size={17} />, onSelect: () => h.onCustomer(o) });
  if (h.canFulfil && o.status !== 'cancelled' && o.status !== 'delivered') {
    items.push({ label: 'Cancel order', icon: <Icon name="close" size={17} />, tone: 'danger', onSelect: () => h.onCancel(o) });
  }
  return items;
}

/* ── Order detail ──────────────────────────────────────────────────────────── */

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeBusiness, can } = useBusiness();
  const { success, error: toastError } = useToast();
  const { change, busy: busyStatus } = useOrderStatus();

  const [order, setOrder] = useState<OrderRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [returnOpen, setReturnOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const canSeeCost = can('reports.read');
  const canFulfil = can('orders.fulfil') || can('orders.write');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: e } = await db.from('orders').select('*').eq('id', id).maybeSingle();
      if (e) throw e;
      if (!data) { setError('That order does not exist or is not yours.'); setOrder(null); return; }
      // Invoices for this order live in their own collection; the document
      // carries items + customer snapshot, we attach the invoice summaries.
      const invs = await db.from('invoices')
        .select('id,invoice_number,status,total,balance_due,share_token')
        .eq('order_id', id).order('issue_date', { ascending: false }).limit(20)
        .then((r) => ((r.data ?? []) as Array<Record<string, unknown>>));
      setOrder({ ...data, invoices: invs } as unknown as OrderRow);
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^.*?exception:\s*/i, '') : 'Could not load the order.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const items = order?.items ?? [];
  const profit = items.reduce((s, i) => s + toNum(i.line_profit), 0);
  const currency = order?.currency ?? activeBusiness?.base_currency ?? 'ZMW';

  const makeInvoice = async () => {
    if (!order) return;
    setBusy('invoice');
    try {
      const invoiceId = await createInvoiceFromOrder(order.id);
      success('Invoice created', `${order.order_number} is now invoiced.`);
      navigate(`/business/invoices/${invoiceId}`);
    } catch (e) {
      toastError('Could not create the invoice',
        e instanceof Error ? e.message.replace(/^.*?exception:\s*/i, '') : undefined);
    } finally {
      setBusy(null);
    }
  };

  const print = async () => {
    if (!order || !activeBusiness) return;
    setBusy('print');
    try {
      const { buildOrderPdf: build } = await import('@/lib/pdf');
      const doc = await build({ order, items, business: activeBusiness });
      savePdf(doc, `${order.order_number}.pdf`);
    } catch (e) {
      toastError('Could not build the packing slip', e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(null);
    }
  };

  const share = async () => {
    if (!order || !activeBusiness) return;
    setBusy('share');
    try {
      // Orders are shared through their invoice or receipt — those are the
      // documents with a public, revocable link.
      const invoice = order.invoices?.[0];
      if (invoice) {
        const token = invoice.share_token ?? await createShareToken('invoice', invoice.id);
        setShareUrl(`/d/invoice/${token}`);
      } else {
        const { data } = await db.from('receipts')
          .select('id,share_token').eq('order_id', order.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
        const receipt = data as { id: UUID; share_token: string | null } | null;
        if (!receipt) {
          toastError('Nothing to share yet',
            'Create an invoice or take a payment first — those generate the shareable document.');
          return;
        }
        const token = receipt.share_token ?? await createShareToken('receipt', receipt.id);
        setShareUrl(`/d/receipt/${token}`);
      }
      setShareOpen(true);
    } catch (e) {
      toastError('Could not create a share link',
        e instanceof Error ? e.message.replace(/^.*?exception:\s*/i, '') : undefined);
    } finally {
      setBusy(null);
    }
  };

  const saveNote = async () => {
    if (!order || !note.trim()) return;
    setSavingNote(true);
    try {
      const stamped = `[${new Date().toLocaleString('en-ZM')}] ${note.trim()}`;
      const { error: e } = await db.from('orders')
        .update({ notes: order.notes ? `${order.notes}\n${stamped}` : stamped })
        .eq('id', order.id);
      if (e) throw e;
      success('Note added');
      setNote('');
      void load();
    } catch (e) {
      toastError('Could not save the note', e instanceof Error ? e.message : undefined);
    } finally {
      setSavingNote(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-72 w-full rounded-2xl" />
      </div>
    );
  }

  if (!order || !activeBusiness) {
    return <EmptyState icon="cart" title="Order not found" description={error ?? undefined}
      action={<Link to="/business/orders"><Button size="sm">Back to orders</Button></Link>} />;
  }

  const next = nextOrderStatuses(order.status);
  const invoice = order.invoices?.[0];
  const balance = toNum(order.balance_due);
  const phone = order.customer?.phone ?? order.shipping_phone;

  return (
    <div className="space-y-4">
      <PageHeader
        backTo="/business/orders"
        title={`Order ${order.order_number}`}
        subtitle={`${CHANNEL_LABELS[order.channel] ?? order.channel} · placed ${formatDateTime(order.placed_at)}${
          order.served_by_name ? ` · served by ${order.served_by_name}` : ''}`}
        icon="📦"
        actions={
          <>
            <Button size="sm" variant="outline" icon="print" loading={busy === 'print'} onClick={() => void print()}>
              Packing slip
            </Button>
            <Button size="sm" variant="outline" icon="share" loading={busy === 'share'} onClick={() => void share()}>
              Share
            </Button>
            {!invoice && can('invoices.write') && order.status !== 'cancelled' && (
              <Button size="sm" variant="outline" icon="invoice" loading={busy === 'invoice'} onClick={() => void makeInvoice()}>
                Create invoice
              </Button>
            )}
            {balance > 0 && can('payments.record') && order.status !== 'cancelled' && (
              <Button size="sm" icon="wallet" onClick={() => setPayOpen(true)}>
                Take payment
              </Button>
            )}
          </>
        }
      />

      {error && <Notice tone="danger">{error}</Notice>}

      {order.status === 'cancelled' && (
        <Notice tone="warning" title="This order was cancelled" icon="close">
          {order.cancellation_reason ?? 'No reason recorded.'}
          {order.cancelled_at ? ` · ${formatDate(order.cancelled_at)}` : ''}
        </Notice>
      )}

      {/* Status flow */}
      {canFulfil && order.status !== 'cancelled' && order.status !== 'returned' && (
        <div className="sh-card-flat p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {ORDER_STATUS_FLOW.map((s, i) => {
              const currentIdx = ORDER_STATUS_FLOW.indexOf(order.status as typeof s);
              const done = i < currentIdx;
              const current = i === currentIdx;
              return (
                <span key={s} className="flex items-center gap-1.5">
                  <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                    current ? 'bg-brand-600 text-white' : done ? 'bg-emerald-50 text-emerald-700' : 'bg-ink-100 text-ink-500'
                  }`}>
                    {done && <Icon name="check" size={11} />}
                    {ORDER_STATUS_LABELS[s]}
                  </span>
                  {i < ORDER_STATUS_FLOW.length - 1 && <Icon name="chevronRight" size={12} className="text-ink-300" />}
                </span>
              );
            })}
          </div>
          {next.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {next.filter((s) => s !== 'cancelled').map((s) => {
                const step = ORDER_FLOW.find((f) => f.status === s);
                return (
                  <Button key={s} size="sm" icon={step?.icon ?? 'check'} loading={busyStatus === s}
                    onClick={() => change(order, s).then(() => load()).catch(() => undefined)}>
                    {ORDER_STATUS_LABELS[s] ?? s}
                  </Button>
                );
              })}
              <Button size="sm" variant="outline" icon="truck" onClick={() => setDeliverOpen(true)}>
                Arrange delivery
              </Button>
              {order.status === 'delivered' && can('returns.write') && (
                <Button size="sm" variant="outline" icon="refresh" onClick={() => setReturnOpen(true)}>
                  Start a return
                </Button>
              )}
              <Button size="sm" variant="ghost" icon="close" className="text-red-600" onClick={() => setCancelOpen(true)}>
                Cancel order
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-4">
          {/* Items */}
          <div className="sh-card-flat overflow-hidden">
            <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
              <h2 className="text-sm font-extrabold">
                Items <span className="font-semibold text-ink-500">({items.length})</span>
              </h2>
              {canSeeCost && items.length > 0 && (
                <span className="text-xs font-semibold text-emerald-700">
                  Profit {formatMoney(profit, currency)}
                </span>
              )}
            </div>
            <ul className="divide-y divide-ink-100">
              {items.map((it) => (
                <li key={it.id} className="flex items-start gap-3 px-4 py-3">
                  {it.image_url
                    ? <img src={it.image_url} alt="" className="h-12 w-12 shrink-0 rounded-lg border border-ink-200 object-cover" />
                    : <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-ink-100">📦</span>}
                  <div className="min-w-0 flex-1">
                    {it.product_id ? (
                      <Link to={`/business/products/${it.product_id}`} className="text-[13px] font-bold hover:text-brand-700">
                        {it.name}
                      </Link>
                    ) : (
                      <p className="text-[13px] font-bold">{it.name}</p>
                    )}
                    <p className="text-[11px] text-ink-500">
                      {Math.round(toNum(it.quantity))} × {formatMoney(it.unit_price, currency)} {it.unit}
                      {it.sku ? ` · ${it.sku}` : ''}
                      {it.is_wholesale ? ' · wholesale' : ''}
                      {toNum(it.discount_amount) > 0 ? ` · discount ${formatMoney(it.discount_amount, currency)}` : ''}
                      {toNum(it.tax_amount) > 0 ? ` · tax ${formatMoney(it.tax_amount, currency)}` : ''}
                    </p>
                    {it.notes && <p className="mt-0.5 text-[11px] italic text-ink-500">{it.notes}</p>}
                    {it.quantity_returned > 0 && (
                      <Badge tone="amber">{Math.round(toNum(it.quantity_returned))} returned</Badge>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="sh-money text-sm font-extrabold">{formatMoney(it.line_total, currency)}</p>
                    {canSeeCost && (
                      <p className="sh-money text-[11px] text-emerald-700">
                        +{formatMoney(it.line_profit, currency)}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <div className="border-t border-ink-100 bg-ink-50/60 p-4">
              <div className="mx-auto max-w-xs">
                <TotalsBlock
                  currency={currency}
                  subtotal={toNum(order.subtotal)}
                  discount={toNum(order.discount_total)}
                  tax={toNum(order.tax_total)}
                  delivery={toNum(order.delivery_fee)}
                  tip={toNum(order.tip_amount)}
                  total={toNum(order.total)}
                  amountPaid={toNum(order.amount_paid)}
                />
              </div>
              {order.coupon_code && (
                <p className="mt-2 text-center text-[11px] font-semibold text-brand-700">
                  Coupon {order.coupon_code} applied
                </p>
              )}
            </div>
          </div>

          {/* Payments */}
          <div className="sh-card-flat p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-extrabold">Payments</h2>
              {balance > 0 && can('payments.record') && (
                <Button size="sm" icon="wallet" onClick={() => setPayOpen(true)}>
                  Take {formatMoney(balance, currency)}
                </Button>
              )}
            </div>
            <div className="mt-2">
              <PaymentsList orderId={order.id} currency={currency}
                emptyText={balance > 0 ? 'Nothing paid yet.' : 'No payments on this order.'} />
            </div>
          </div>

          {/* Notes + timeline */}
          <div className="sh-card-flat p-4">
            <h2 className="text-sm font-extrabold">History</h2>
            <div className="mt-3">
              <OrderTimeline order={order} />
            </div>
            {order.notes && (
              <p className="mt-3 whitespace-pre-line rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
                <span className="font-bold">Notes</span>{'\n'}{order.notes}
              </p>
            )}
            {can('orders.write') && (
              <div className="mt-3 flex gap-2">
                <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="Add an internal note (timestamped and kept in the audit log)" className="flex-1" />
                <Button size="sm" variant="outline" icon="send" loading={savingNote}
                  disabled={!note.trim()} onClick={() => void saveNote()}>Add</Button>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <aside className="space-y-3">
          <div className="sh-card-flat p-3">
            <p className="sh-label">Status</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <StatusBadge status={order.status} />
              <StatusBadge status={order.payment_status} />
              {order.is_wholesale && <Badge tone="blue">Wholesale</Badge>}
              {order.delivery_method !== 'pickup' && <Badge tone="neutral">{order.delivery_method}</Badge>}
            </div>
            <div className="mt-2">
              <DocumentMeta rows={[
                ['Placed', formatDateTime(order.placed_at)],
                ['Channel', CHANNEL_LABELS[order.channel] ?? order.channel],
                ['Served by', order.served_by_name ?? '—'],
                ['Reference', order.reference ?? ''],
                ['Items', Math.round(toNum(items.reduce((s, i) => s + i.quantity, 0)))],
                order.delivered_at ? ['Delivered', formatDate(order.delivered_at)] : ['', ''],
                invoice ? ['Invoice', invoice.invoice_number] : ['', ''],
              ]} />
            </div>
            {invoice && (
              <Link to={`/business/invoices/${invoice.id}`} className="mt-2 block">
                <Button size="sm" variant="outline" block icon="invoice">
                  Open {invoice.invoice_number} · <StatusBadge status={invoice.status} />
                </Button>
              </Link>
            )}
          </div>

          <PartyCard title="Customer" businessId={activeBusiness.id}
            party={order.customer
              ? { ...order.customer, outstanding_balance: 0 }
              : { name: order.shipping_name, phone: order.shipping_phone, city: order.shipping_city }} />

          {order.delivery_method !== 'pickup' && (
            <div className="sh-card-flat p-3">
              <p className="sh-label">Delivery</p>
              <p className="mt-1 text-sm font-bold">
                {order.shipping_name ?? order.customer?.name ?? 'Customer'}
              </p>
              <p className="mt-0.5 text-xs text-ink-600">
                {[order.shipping_line1, order.shipping_line2, order.shipping_city, order.shipping_region].filter(Boolean).join(', ')}
              </p>
              {phone && (
                <div className="mt-2 flex gap-1.5">
                  <a href={whatsappUrl(phone, `Hello ${order.shipping_name ?? ''}, about your order ${order.order_number} from ${activeBusiness.name}:`)}
                    target="_blank" rel="noreferrer" className="sh-btn sh-btn-outline sh-btn-sm">
                    <Icon name="whatsapp" size={14} /> WhatsApp
                  </a>
                  <a href={smsUrl(phone, `Order ${order.order_number}:`)} className="sh-btn sh-btn-outline sh-btn-sm">
                    <Icon name="phone" size={14} /> SMS
                  </a>
                </div>
              )}
              {order.driver_name && (
                <p className="mt-2 text-xs text-ink-600">
                  <span className="font-bold">Driver:</span> {order.driver_name} {order.driver_phone ?? ''}
                </p>
              )}
              {order.courier && <p className="text-xs text-ink-600"><span className="font-bold">Courier:</span> {order.courier}</p>}
              {order.tracking_number && <p className="text-xs text-ink-600"><span className="font-bold">Tracking:</span> {order.tracking_number}</p>}
              {order.estimated_delivery_at && (
                <p className="text-xs text-ink-600"><span className="font-bold">ETA:</span> {formatDate(order.estimated_delivery_at)}</p>
              )}
              {order.delivery_notes && <p className="mt-1 text-xs italic text-ink-500">{order.delivery_notes}</p>}
              {canFulfil && (
                <Button size="sm" variant="ghost" icon="truck" className="mt-2" onClick={() => setDeliverOpen(true)}>
                  Edit delivery
                </Button>
              )}
            </div>
          )}

          {order.customer_note && (
            <div className="sh-card-flat p-3">
              <p className="sh-label">Note from the buyer</p>
              <p className="mt-1 text-xs text-ink-700">{order.customer_note}</p>
            </div>
          )}

          <Link to={`/business/orders/${order.id}/return`} className="block">
            <Button size="sm" variant="outline" block icon="refresh">Returns & refunds</Button>
          </Link>
        </aside>
      </div>

      <RecordPaymentModal open={payOpen} onClose={() => setPayOpen(false)}
        target={{
          businessId: order.business_id,
          orderId: order.id,
          customerId: order.customer_id,
          customerName: order.customer?.name ?? order.shipping_name,
          currency: order.currency,
          balanceDue: balance,
          documentNumber: order.order_number,
        }}
        onDone={() => void load()} />

      <AssignDeliveryModal open={deliverOpen} onClose={() => setDeliverOpen(false)}
        order={order} onDone={() => void load()} />

      <CancelOrderModal open={cancelOpen} onClose={() => setCancelOpen(false)}
        order={order} onDone={() => void load()} />

      <ShareDocModal open={shareOpen} onClose={() => setShareOpen(false)}
        title={`Order ${order.order_number}`}
        url={shareUrl}
        whatsappPhone={phone}
        email={order.customer?.email}
        message={`Hello ${order.customer?.name ?? order.shipping_name ?? ''}, here is the document for your order ${order.order_number} from ${activeBusiness.name}. Total ${formatMoney(order.total, order.currency)}.`} />

      {returnOpen && <StartReturnInline orderId={order.id} onClose={() => setReturnOpen(false)} onDone={() => { setReturnOpen(false); void load(); }} />}
    </div>
  );
}

/** Placeholder route target — the full return flow lives on its own page. */
export function OrderReturnPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="space-y-3">
      <PageHeader backTo={`/business/orders/${id}`} title="Return this order" icon="↩️" />
      <ReturnForm orderId={id!} />
    </div>
  );
}

function StartReturnInline({ orderId, onClose, onDone }: { orderId: UUID; onClose: () => void; onDone: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-0 sm:items-center sm:p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-4 sm:rounded-3xl">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-extrabold">Start a return</h2>
          <Button variant="ghost" size="sm" icon="close" onClick={onClose} aria-label="Close" />
        </div>
        <ReturnForm orderId={orderId} onDone={onDone} />
      </div>
    </div>
  );
}

/* ── Return form (shared by the order page and the returns module) ─────────── */

export function ReturnForm({ orderId, onDone }: { orderId: UUID; onDone?: () => void }) {
  const { activeBusiness, warehouses, can } = useBusiness();
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();

  const [order, setOrder] = useState<OrderRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState('');
  const [reasonCode, setReasonCode] = useState('damaged');
  const [refundMethod, setRefundMethod] = useState('original');
  const [restock, setRestock] = useState(true);
  const [warehouseId, setWarehouseId] = useState('');
  const [selected, setSelected] = useState<Record<UUID, { qty: number; refund: number; condition: string }>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const o = await fetchOrder(orderId).catch(() => null);
      if (!alive) return;
      setOrder(o as OrderRow | null);
      setWarehouseId(warehouses[0]?.id ?? '');
      setLoading(false);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  const items = order?.items ?? [];
  const currency = order?.currency ?? 'ZMW';

  const toggleAll = () => {
    if (Object.keys(selected).length === items.length) { setSelected({}); return; }
    setSelected(Object.fromEntries(items.map((i) => [i.id, {
      qty: Math.round(toNum(i.quantity)) - Math.round(toNum(i.quantity_returned)),
      refund: toNum(i.line_total),
      condition: 'sellable',
    }])));
  };

  const setLine = (id: UUID, patch: Partial<{ qty: number; refund: number; condition: string }>) =>
    setSelected((prev) => {
      const base = prev[id] ?? { qty: 1, refund: 0, condition: 'sellable' };
      return { ...prev, [id]: { ...base, ...patch } };
    });

  const totalRefund = Object.values(selected).reduce((s, v) => s + toNum(v.refund), 0);

  const submit = async () => {
    if (!activeBusiness || !order) return;
    const lines = Object.entries(selected).filter(([, v]) => v.qty > 0);
    if (lines.length === 0) { setError('Select at least one item to return.'); return; }
    if (!reason.trim()) { setError('Give a reason — it is shown to the customer and kept on file.'); return; }
    setBusy(true);
    setError(null);
    try {
      const { createReturn } = await import('@/lib/api');
      const res = await createReturn({
        orderId: order.id,
        reason: reason.trim(),
        reasonCode,
        restock,
        warehouseId: warehouseId || null,
        refundMethod: refundMethod as 'original' | 'cash' | 'credit_note' | 'bank_transfer' | 'store_credit',
        items: lines.map(([itemId, v]) => {
          const it = items.find((i) => i.id === itemId)!;
          return {
            order_item_id: itemId,
            product_id: it.product_id,
            variant_id: it.variant_id,
            name: it.name,
            quantity: v.qty,
            unit_price: toNum(it.unit_price),
            refund_amount: v.refund,
            condition: v.condition as 'sellable' | 'damaged' | 'defective' | 'missing',
          };
        }),
      });
      success('Return created', `${res.return_number} · ${formatMoney(res.refund_amount, currency)} to refund.`);
      onDone?.();
      navigate(`/business/returns/${res.return_id}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message.replace(/^.*?exception:\s*/i, '') : 'Could not create the return.';
      setError(msg);
      toastError('Return not created', msg);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Skeleton className="h-64 w-full rounded-2xl" />;
  if (!order) return <EmptyState icon="refresh" title="Order not found" />;

  if (!can('returns.write')) return <DeniedPanel message={missingPermissionMessage('returns.write')} />;

  const returnable = items.filter((i) => Math.round(toNum(i.quantity)) - Math.round(toNum(i.quantity_returned)) > 0);

  if (returnable.length === 0) {
    return <EmptyState icon="success" title="Nothing left to return"
      description="Every line on this order has already been returned." />;
  }

  return (
    <div className="space-y-4">
      {error && <Notice tone="danger">{error}</Notice>}

      <div className="sh-card-flat overflow-hidden">
        <div className="flex items-center justify-between border-b border-ink-100 px-4 py-2.5">
          <h3 className="text-sm font-extrabold">Which items are coming back?</h3>
          <Button size="sm" variant="ghost" onClick={toggleAll}>
            {Object.keys(selected).length === returnable.length ? 'Clear all' : 'Select all'}
          </Button>
        </div>
        <ul className="divide-y divide-ink-100">
          {returnable.map((it) => {
            const maxQty = Math.round(toNum(it.quantity)) - Math.round(toNum(it.quantity_returned));
            const sel = selected[it.id];
            const unitRefund = maxQty > 0 ? toNum(it.line_total) / maxQty : 0;
            return (
              <li key={it.id} className={`px-4 py-3 ${sel ? 'bg-brand-50/40' : ''}`}>
                <div className="flex items-start gap-3">
                  <input type="checkbox" className="mt-1 h-4 w-4 rounded border-ink-300"
                    checked={Boolean(sel)}
                    onChange={(e) => {
                      if (e.target.checked) setLine(it.id, { qty: maxQty, refund: Math.round(toNum(it.line_total) * 100) / 100 });
                      else setSelected((prev) => { const n = { ...prev }; delete n[it.id]; return n; });
                    }}
                    aria-label={`Return ${it.name}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-bold">{it.name}</p>
                    <p className="text-[11px] text-ink-500">
                      {maxQty} of {Math.round(toNum(it.quantity))} returnable · {formatMoney(it.unit_price, currency)} each
                    </p>
                    {sel && (
                      <div className="mt-2 grid gap-2 sm:grid-cols-3">
                        <Input label="Quantity" type="number" min={1} max={maxQty} value={String(sel.qty)}
                          onChange={(e) => {
                            const qty = Math.min(maxQty, Math.max(1, Number(e.target.value) || 1));
                            setLine(it.id, { qty, refund: Math.round(qty * unitRefund * 100) / 100 });
                          }} />
                        <MoneyInput label="Refund" currency={currency} value={sel.refund}
                          onChange={(n) => setLine(it.id, { refund: n })} />
                        <Select label="Condition" value={sel.condition}
                          onChange={(e) => setLine(it.id, { condition: e.target.value })}
                          options={[
                            { value: 'sellable', label: 'Sellable — back on the shelf' },
                            { value: 'damaged', label: 'Damaged' },
                            { value: 'defective', label: 'Defective' },
                            { value: 'missing', label: 'Missing' },
                          ]} />
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Reason code" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}
          options={[
            { value: 'damaged', label: 'Damaged' },
            { value: 'wrong_item', label: 'Wrong item sent' },
            { value: 'not_as_described', label: 'Not as described' },
            { value: 'late', label: 'Arrived too late' },
            { value: 'changed_mind', label: 'Changed mind' },
            { value: 'other', label: 'Other' },
          ]} />
        <Select label="Refund method" value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)}
          options={[
            { value: 'original', label: 'Back to the original payment method' },
            { value: 'cash', label: 'Cash' },
            { value: 'bank_transfer', label: 'Bank transfer' },
            { value: 'credit_note', label: 'Credit note (they buy again later)' },
            { value: 'store_credit', label: 'Store credit' },
          ]} />
      </div>

      <Textarea label="Reason (shown to the customer)" required rows={2} value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. Two chairs arrived with scratched frames" />

      {warehouses.length > 1 && (
        <Select label="Restock into" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
          options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
      )}

      <label className="flex items-start gap-2 rounded-xl border border-ink-200 p-3">
        <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-ink-300" checked={restock}
          onChange={(e) => setRestock(e.target.checked)} />
        <span>
          <span className="block text-[13px] font-bold">Return the items to stock</span>
          <span className="block text-[11px] text-ink-500">
            Creates a <span className="font-mono">return_in</span> movement per line when the return is received.
            Turn this off for damaged or missing goods.
          </span>
        </span>
      </label>

      <div className="sh-card-flat flex flex-wrap items-center justify-between gap-3 p-3">
        <div>
          <p className="sh-label">Refund to process</p>
          <p className="sh-money text-xl font-extrabold">{formatMoney(totalRefund, currency)}</p>
          <p className="text-[11px] text-ink-500">
            {can('payments.refund')
              ? 'You can approve and pay this refund.'
              : 'A refund needs owner approval — the request will be queued for them.'}
          </p>
        </div>
        <Button icon="refresh" loading={busy} disabled={Object.keys(selected).length === 0}
          onClick={() => void submit()}>
          Create return request
        </Button>
      </div>
    </div>
  );
}
