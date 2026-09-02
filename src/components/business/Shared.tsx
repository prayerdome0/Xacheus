import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import {
  Badge, Button, Checkbox, EmptyState, Input, Modal, Notice, Select, Skeleton, Switch, Textarea,
} from '@/components/ui/Primitives';
import { MoneyInput, StatusBadge, CopyValue } from '@/components/ui';
import { useBusiness } from '@/context/BusinessContext';
import { useToast } from '@/context/ToastContext';
import { supabase } from '@/lib/supabase';
import { useDebounce } from '@/hooks/useUi';
import { assignDelivery, recordPayment, updateOrderStatus, type OrderStatusInput } from '@/lib/api';
import { formatMoney, toNum } from '@/lib/currency';
import { formatDate, formatDateTime, todayISO } from '@/lib/dates';
import { absoluteUrl, whatsappUrl, smsUrl, mailtoUrl, copyToClipboard } from '@/lib/share';
import { MOBILE_MONEY_PROVIDERS, PAYMENT_METHOD_LABELS } from '@/lib/constants';
import type { Customer, Invoice, Order, PaymentMethod, Receipt, UUID } from '@/types';

/**
 * Pieces shared by Orders, Invoices, Quotations, POS and Payments.
 *
 * They all record money the same way (through the `record_payment` RPC so the
 * ledger, receipt and document status stay consistent) and they all move an
 * order through the same fulfilment path, so the modals live here once.
 */

/* ── Record a payment ──────────────────────────────────────────────────────── */

export interface PaymentTarget {
  /** At least one of these must be set. */
  invoiceId?: UUID | null;
  orderId?: UUID | null;
  billId?: UUID | null;
  customerId?: UUID | null;
  supplierId?: UUID | null;
  businessId: UUID;
  customerName?: string | null;
  currency?: string;
  balanceDue: number;
  documentNumber?: string;
  /** 'outbound' pays a supplier bill; everything else receives money. */
  direction?: 'inbound' | 'outbound';
}

export function RecordPaymentModal({ open, onClose, target, onDone }: {
  open: boolean;
  onClose: () => void;
  target: PaymentTarget | null;
  onDone?: (result: { paymentId: UUID; receiptId: UUID | null; amount: number; balanceDue: number }) => void;
}) {
  const { can } = useBusiness();
  const { success, error: toastError } = useToast();
  const direction = target?.direction ?? 'inbound';

  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState('cash');
  const [provider, setProvider] = useState<string>(MOBILE_MONEY_PROVIDERS[0] ?? 'Airtel Money');
  const [reference, setReference] = useState('');
  const [receivedAt, setReceivedAt] = useState(todayISO());
  const [payerName, setPayerName] = useState('');
  const [payerPhone, setPayerPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [generateReceipt, setGenerateReceipt] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !target) return;
    setAmount(target.balanceDue > 0 ? target.balanceDue : 0);
    setMethod('cash');
    setProvider(MOBILE_MONEY_PROVIDERS[0] ?? 'Airtel Money');
    setReference('');
    setReceivedAt(todayISO());
    setPayerName(target.customerName ?? '');
    setPayerPhone('');
    setNotes('');
    setGenerateReceipt(true);
    setError(null);
  }, [open, target]);

  const currency = target?.currency ?? 'ZMW';
  const overpay = amount > toNum(target?.balanceDue ?? 0) + 0.001;

  const submit = async () => {
    if (!target) return;
    if (amount <= 0) { setError('Enter an amount greater than zero.'); return; }
    if (!can('payments.record')) { setError('Your role cannot record payments.'); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await recordPayment({
        business_id: target.businessId,
        invoice_id: target.invoiceId ?? null,
        order_id: target.orderId ?? null,
        bill_id: target.billId ?? null,
        customer_id: target.customerId ?? null,
        supplier_id: target.supplierId ?? null,
        amount,
        currency,
        method: method as PaymentMethod,
        provider: method === 'mobile_money' ? provider : undefined,
        reference: reference.trim() || undefined,
        received_at: receivedAt || undefined,
        payer_name: payerName.trim() || undefined,
        payer_phone: payerPhone.trim() || undefined,
        notes: notes.trim() || undefined,
        direction,
        generate_receipt: generateReceipt && direction === 'inbound',
        allow_overpay: overpay,
      });
      success(direction === 'inbound' ? 'Payment recorded' : 'Payment made',
        `${formatMoney(res.amount, res.currency)}${res.receipt_id ? ' · receipt generated' : ''}`);
      onDone?.({
        paymentId: res.payment_id,
        receiptId: res.receipt_id ?? null,
        amount: toNum(res.amount),
        balanceDue: toNum(res.balance_due),
      });
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message.replace(/^.*?exception:\s*/i, '') : 'Could not record the payment.';
      setError(msg);
      toastError('Payment not recorded', msg);
    } finally {
      setBusy(false);
    }
  };

  const methods = (Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[])
    .filter((m) => (direction === 'outbound' ? m !== 'online' && m !== 'credit' : true))
    .map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={direction === 'inbound' ? 'Record a payment' : 'Record a payment made'}
      subtitle={target?.documentNumber
        ? `${target.documentNumber}${target.customerName ? ` · ${target.customerName}` : ''}`
        : target?.customerName ?? undefined}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" icon="wallet" loading={busy} onClick={() => void submit()}>
            Record {formatMoney(amount, currency)}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Notice tone="danger" title="Could not record the payment">{error}</Notice>}

        {target && target.balanceDue > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-ink-50 px-3 py-2">
            <span className="text-xs font-semibold text-ink-600">Balance due</span>
            <span className="sh-money text-sm font-extrabold">{formatMoney(target.balanceDue, currency)}</span>
            <div className="flex gap-1.5">
              {[0.25, 0.5, 1].map((f) => (
                <Button key={f} size="sm" variant="outline"
                  onClick={() => setAmount(Math.round(target.balanceDue * f * 100) / 100)}>
                  {f === 1 ? 'Full' : `${f * 100}%`}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <MoneyInput label="Amount" required currency={currency} value={amount} onChange={setAmount} />
          <Input label="Date received" type="date" value={receivedAt} max={todayISO()}
            onChange={(e) => setReceivedAt(e.target.value)} />
          <Select label="Method" value={method} onChange={(e) => setMethod(e.target.value)} options={methods} />
          {method === 'mobile_money' ? (
            <Select label="Provider" value={provider} onChange={(e) => setProvider(e.target.value)}
              options={MOBILE_MONEY_PROVIDERS.map((p) => ({ value: p, label: p }))} />
          ) : (
            <Input label="Reference / transaction ID" value={reference}
              onChange={(e) => setReference(e.target.value)} placeholder="e.g. FNB123456789" />
          )}
        </div>

        {method === 'mobile_money' && (
          <Input label="Reference / transaction ID" value={reference}
            onChange={(e) => setReference(e.target.value)} placeholder="e.g. MP240912.1234.A12345" />
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Input label={direction === 'inbound' ? 'Paid by' : 'Paid to'} value={payerName}
            onChange={(e) => setPayerName(e.target.value)} placeholder={target?.customerName ?? 'Name'} />
          <Input label="Phone" value={payerPhone} onChange={(e) => setPayerPhone(e.target.value)}
            placeholder="+260 97 1234567" />
        </div>

        <Textarea label="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder={direction === 'inbound' ? 'e.g. Part payment, balance next week' : 'e.g. Paid supplier by EFT'} />

        {overpay && (
          <Notice tone="warning" title="This is more than the balance due">
            The extra {formatMoney(amount - toNum(target?.balanceDue ?? 0), currency)} will be recorded as a credit
            on the customer account.
          </Notice>
        )}

        {direction === 'inbound' && (
          <Switch checked={generateReceipt} onChange={setGenerateReceipt}
            label="Generate a receipt automatically"
            hint="The receipt is numbered and can be printed, shared or emailed straight away." />
        )}

        <p className="text-[11px] text-ink-500">
          Recording a payment updates the {direction === 'inbound' ? 'invoice or order balance' : 'supplier bill'},
          writes the ledger entry and logs who took the money.
        </p>
      </div>
    </Modal>
  );
}

/* ── Move an order through fulfilment ──────────────────────────────────────── */

/** What a status is called on a button, and which statuses it can follow. */
export const ORDER_FLOW: { status: OrderStatusInput; label: string; icon: 'check' | 'package' | 'box' | 'truck' | 'success' }[] = [
  { status: 'confirmed', label: 'Confirm', icon: 'check' },
  { status: 'processing', label: 'Start preparing', icon: 'package' },
  { status: 'ready', label: 'Mark ready', icon: 'box' },
  { status: 'shipped', label: 'Mark shipped', icon: 'truck' },
  { status: 'out_for_delivery', label: 'Out for delivery', icon: 'truck' },
  { status: 'delivered', label: 'Mark delivered', icon: 'success' },
];

const NEXT_STATUSES: Record<string, OrderStatusInput[]> = {
  pending: ['confirmed', 'processing', 'ready', 'cancelled'],
  confirmed: ['processing', 'ready', 'shipped', 'out_for_delivery', 'delivered', 'cancelled'],
  processing: ['ready', 'shipped', 'out_for_delivery', 'delivered', 'cancelled'],
  ready: ['out_for_delivery', 'delivered', 'shipped', 'cancelled'],
  shipped: ['out_for_delivery', 'delivered', 'cancelled'],
  out_for_delivery: ['delivered', 'cancelled'],
  delivered: ['returned'],
  cancelled: [],
  returned: [],
};

export function nextOrderStatuses(status: string): OrderStatusInput[] {
  return NEXT_STATUSES[status] ?? [];
}

export function useOrderStatus() {
  const { success, error: toastError } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const change = async (order: Pick<Order, 'id' | 'order_number' | 'amount_paid'>, status: OrderStatusInput, note?: string | null) => {
    setBusy(status);
    try {
      const res = await updateOrderStatus(order.id, status, note ?? null);
      if (res.changed) {
        success(`Order ${status.replace(/_/g, ' ')}`,
          status === 'cancelled' && res.restocked_lines > 0
            ? `${order.order_number} cancelled · ${res.restocked_lines} stock line(s) returned.`
            : `${order.order_number} · the buyer has been notified.`);
      }
      return res;
    } catch (e) {
      const msg = e instanceof Error ? e.message.replace(/^.*?exception:\s*/i, '') : 'Could not update the order.';
      toastError(`Could not mark the order ${status}`, msg);
      throw e;
    } finally {
      setBusy(null);
    }
  };

  return { change, busy };
}

/* ── Assign a driver / courier ─────────────────────────────────────────────── */

export function AssignDeliveryModal({ open, onClose, order, onDone }: {
  open: boolean;
  onClose: () => void;
  order: Order | null;
  onDone?: () => void;
}) {
  const { success, error: toastError } = useToast();
  const [method, setMethod] = useState('delivery');
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [courier, setCourier] = useState('');
  const [tracking, setTracking] = useState('');
  const [eta, setEta] = useState('');
  const [notify, setNotify] = useState(true);
  const [markShipped, setMarkShipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !order) return;
    setMethod(order.delivery_method === 'pickup' ? 'pickup' : 'delivery');
    setDriverName(order.driver_name ?? '');
    setDriverPhone(order.driver_phone ?? '');
    setCourier(order.courier ?? '');
    setTracking(order.tracking_number ?? '');
    setEta(order.estimated_delivery_at ? order.estimated_delivery_at.slice(0, 10) : '');
    setNotify(true);
    setMarkShipped(order.status === 'ready' || order.status === 'processing');
    setError(null);
  }, [open, order]);

  const submit = async () => {
    if (!order) return;
    if (method !== 'pickup' && !driverName.trim() && !courier.trim() && !tracking.trim()) {
      setError('Enter a driver, a courier or a tracking number.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await assignDelivery({
        orderId: order.id,
        method: method as 'pickup' | 'delivery' | 'shipping',
        driverName: driverName.trim() || null,
        driverPhone: driverPhone.trim() || null,
        courier: courier.trim() || null,
        tracking: tracking.trim() || null,
        eta: eta ? new Date(`${eta}T12:00:00`).toISOString() : null,
        status: markShipped ? 'shipped' : null,
        notify,
      });
      success('Delivery arranged', markShipped ? 'Order marked shipped and the buyer notified.' : 'Saved.');
      onDone?.();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message.replace(/^.*?exception:\s*/i, '') : 'Could not save the delivery.';
      setError(msg);
      toastError('Could not arrange delivery', msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="md"
      title="Arrange delivery"
      subtitle={order ? `Order ${order.order_number}` : undefined}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" icon="truck" loading={busy} onClick={() => void submit()}>Save delivery</Button>
        </>
      }>
      <div className="space-y-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <Select label="How is this order getting to the customer?" value={method}
          onChange={(e) => setMethod(e.target.value)}
          options={[
            { value: 'delivery', label: 'We deliver it' },
            { value: 'shipping', label: 'Courier / shipping' },
            { value: 'pickup', label: 'Customer collects' },
          ]} />

        {method !== 'pickup' && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Driver name" value={driverName} onChange={(e) => setDriverName(e.target.value)}
                placeholder="e.g. Mwansa" />
              <Input label="Driver phone" value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)}
                placeholder="+260 97 1234567" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Courier" value={courier} onChange={(e) => setCourier(e.target.value)}
                placeholder="e.g. DHL, Swift, Local courier" />
              <Input label="Tracking number" value={tracking} onChange={(e) => setTracking(e.target.value)} />
            </div>
            <Input label="Estimated delivery date" type="date" value={eta} onChange={(e) => setEta(e.target.value)} />
          </>
        )}

        <div className="space-y-2 rounded-xl border border-ink-200 p-3">
          <Switch checked={markShipped} onChange={setMarkShipped} label="Mark the order as shipped"
            hint="The buyer sees the tracking number in their notification." />
          <Switch checked={notify} onChange={setNotify} label="Notify the buyer" />
        </div>
      </div>
    </Modal>
  );
}

/* ── Share a document / order ──────────────────────────────────────────────── */

export function ShareDocModal({ open, onClose, title, message, url, whatsappPhone, email }: {
  open: boolean;
  onClose: () => void;
  title: string;
  message: string;
  url: string;
  whatsappPhone?: string | null;
  email?: string | null;
}) {
  const { success } = useToast();
  const [text, setText] = useState(message);

  useEffect(() => { setText(message); }, [message, open]);

  const fullUrl = url.startsWith('http') ? url : absoluteUrl(url);

  const channels = [
    {
      key: 'whatsapp', label: 'WhatsApp', icon: 'whatsapp' as const, tone: 'green' as const,
      href: whatsappUrl(whatsappPhone ?? null, `${text}\n\n${fullUrl}`),
      hint: whatsappPhone ? `to ${whatsappPhone}` : 'opens WhatsApp — pick the contact',
    },
    {
      key: 'sms', label: 'SMS', icon: 'phone' as const, tone: 'blue' as const,
      href: smsUrl(whatsappPhone ?? null, `${text} ${fullUrl}`),
      hint: whatsappPhone ? `to ${whatsappPhone}` : 'opens your messages app',
    },
    {
      key: 'email', label: 'Email', icon: 'mail' as const, tone: 'brand' as const,
      href: mailtoUrl(email ?? null, title, `${text}\n\n${fullUrl}`),
      hint: email ?? 'opens your mail app',
    },
  ];

  return (
    <Modal open={open} onClose={onClose} size="md" title={`Share · ${title}`}
      footer={<Button variant="ghost" size="sm" onClick={onClose}>Done</Button>}>
      <div className="space-y-3">
        <Textarea label="Message" rows={4} value={text} onChange={(e) => setText(e.target.value)} />
        <CopyValue label="Link" value={fullUrl} />
        <div className="grid gap-2 sm:grid-cols-3">
          {channels.map((c) => (
            <a key={c.key} href={c.href} target="_blank" rel="noreferrer"
              className="flex items-center gap-2 rounded-xl border border-ink-200 p-3 text-left hover:border-brand-300 hover:bg-brand-50">
              <Icon name={c.icon} size={18} />
              <span className="min-w-0">
                <span className="block text-[13px] font-bold">{c.label}</span>
                <span className="block truncate text-[11px] text-ink-500">{c.hint}</span>
              </span>
            </a>
          ))}
        </div>
        <Button block variant="outline" icon="copy" onClick={async () => {
          const ok = await copyToClipboard(`${text}\n\n${fullUrl}`);
          if (ok) success('Copied', 'The message and link are on your clipboard.');
        }}>
          Copy message & link
        </Button>
        <p className="text-[11px] text-ink-500">
          Anyone with the link can view this document without signing in. Revoke it from the document page.
        </p>
      </div>
    </Modal>
  );
}

/* ── Small shared readouts ─────────────────────────────────────────────────── */

/** The four money lines every document ends with. */
export function TotalsBlock({ currency, subtotal, discount = 0, tax = 0, delivery = 0, tip = 0, total, amountPaid = 0, balanceDue, compact = false }: {
  currency: string; subtotal: number; discount?: number; tax?: number; delivery?: number; tip?: number;
  total: number; amountPaid?: number; balanceDue?: number; compact?: boolean;
}) {
  const rows: [string, number][] = [['Subtotal', subtotal]];
  if (discount) rows.push(['Discount', -discount]);
  if (tax) rows.push(['Tax', tax]);
  if (delivery) rows.push(['Delivery', delivery]);
  if (tip) rows.push(['Tip', tip]);
  const balance = balanceDue ?? Math.max(total - amountPaid, 0);

  return (
    <dl className={compact ? 'space-y-0.5 text-xs' : 'space-y-1 text-sm'}>
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3">
          <dt className="text-ink-500">{label}</dt>
          <dd className={`sh-money ${value < 0 ? 'text-emerald-600' : ''}`}>{formatMoney(value, currency)}</dd>
        </div>
      ))}
      <div className="flex justify-between gap-3 border-t border-ink-200 pt-1">
        <dt className="font-extrabold">Total</dt>
        <dd className="sh-money font-extrabold">{formatMoney(total, currency)}</dd>
      </div>
      {amountPaid > 0 && (
        <div className="flex justify-between gap-3 text-emerald-700">
          <dt>Paid</dt><dd className="sh-money">−{formatMoney(amountPaid, currency)}</dd>
        </div>
      )}
      {amountPaid > 0 && (
        <div className="flex justify-between gap-3 border-t border-ink-200 pt-1">
          <dt className="font-extrabold">Balance due</dt>
          <dd className={`sh-money font-extrabold ${balance > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
            {formatMoney(balance, currency)}
          </dd>
        </div>
      )}
    </dl>
  );
}

/** Customer / supplier card used on every document. */
export function PartyCard({ title, party, businessId, showBalance = true }: {
  title: string;
  party: (Omit<Partial<Customer>, 'name' | 'phone' | 'email' | 'city'> & {
    name?: string | null; phone?: string | null; email?: string | null; city?: string | null;
  }) | null;
  businessId?: UUID;
  showBalance?: boolean;
}) {
  if (!party) {
    return (
      <div className="sh-card-flat p-3">
        <p className="sh-label">{title}</p>
        <p className="mt-1 text-sm text-ink-500">Walk-in customer — no record kept.</p>
      </div>
    );
  }
  const balance = toNum((party as Customer).outstanding_balance ?? 0);
  return (
    <div className="sh-card-flat p-3">
      <p className="sh-label">{title}</p>
      {party.id && businessId ? (
        <Link to={`/business/customers/${party.id}`} className="text-sm font-bold hover:text-brand-700">
          {party.name ?? 'Customer'}
        </Link>
      ) : (
        <p className="text-sm font-bold">{party.name ?? 'Customer'}</p>
      )}
      <div className="mt-1 space-y-0.5 text-xs text-ink-600">
        {party.phone && (
          <a className="block font-semibold text-brand-700 hover:underline" href={`tel:${party.phone}`}>
            <Icon name="phone" size={11} /> {party.phone}
          </a>
        )}
        {party.email && <p className="truncate">{party.email}</p>}
        {party.city && <p>{party.city}</p>}
      </div>
      {showBalance && balance > 0 && (
        <p className="mt-1.5 rounded-lg bg-red-50 px-2 py-1 text-[11px] font-bold text-red-700">
          Owes {formatMoney(balance, (party as Customer).currency ?? 'ZMW')}
        </p>
      )}
    </div>
  );
}

/** Status timeline for an order, built from status_history. */
export function OrderTimeline({ order }: { order: Order }) {
  const history = useMemo(() => {
    const rows = (order.status_history ?? []).map((h) => ({
      status: h.status, at: h.at, by: h.by ?? 'System', note: h.note ?? null,
    }));
    rows.push({ status: order.status, at: order.placed_at, by: 'Placed', note: null });
    const seen = new Set<string>();
    return rows
      .filter((r) => {
        const key = `${r.status}-${r.at}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [order]);

  return (
    <ol className="relative space-y-3 border-l border-ink-200 pl-4">
      {history.map((h, i) => (
        <li key={`${h.status}-${h.at}-${i}`} className="relative">
          <span className={`absolute -left-[1.35rem] top-1 flex h-3 w-3 items-center justify-center rounded-full ring-4 ring-white ${
            i === history.length - 1 ? 'bg-brand-500' : 'bg-ink-300'
          }`} />
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={h.status} />
            <span className="text-[11px] text-ink-500">{formatDateTime(h.at)} · {h.by}</span>
          </div>
          {h.note && <p className="mt-0.5 text-xs text-ink-600">{h.note}</p>}
        </li>
      ))}
    </ol>
  );
}

/** Payments already taken against a document. */
export function PaymentsList({ invoiceId, orderId, currency, emptyText = 'No payments recorded yet.' }: {
  invoiceId?: UUID | null;
  orderId?: UUID | null;
  currency: string;
  emptyText?: string;
}) {
  const [rows, setRows] = useState<(PaymentRow)[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!invoiceId && !orderId) { setRows([]); setLoading(false); return; }
    let alive = true;
    (async () => {
      let q = supabase.from('payments')
        .select('id,payment_number,method,provider,provider_reference,amount,currency,status,received_at,recorded_by_name,receipt_id')
        .order('received_at', { ascending: false });
      q = invoiceId ? q.eq('invoice_id', invoiceId) : q.eq('order_id', orderId!);
      const { data } = await q;
      if (alive) { setRows((data ?? []) as PaymentRow[]); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [invoiceId, orderId]);

  if (loading) return <p className="text-xs text-ink-400">Loading payments…</p>;
  if (rows.length === 0) return <p className="text-xs text-ink-500">{emptyText}</p>;

  return (
    <ul className="divide-y divide-ink-100">
      {rows.map((p) => (
        <li key={p.id} className="flex items-center gap-2 py-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
            <Icon name={p.method === 'mobile_money' ? 'mobile' : p.method === 'card' ? 'card' : p.method === 'bank_transfer' ? 'bank' : 'cash'} size={15} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-bold">
              {formatMoney(p.amount, p.currency ?? currency)}
              <span className="ml-1.5 text-[11px] font-semibold capitalize text-ink-500">{p.method.replace(/_/g, ' ')}</span>
            </span>
            <span className="block truncate text-[11px] text-ink-500">
              {p.payment_number} · {formatDate(p.received_at)}
              {p.provider_reference ? ` · ref ${p.provider_reference}` : ''}
              {p.recorded_by_name ? ` · by ${p.recorded_by_name}` : ''}
            </span>
          </span>
          <StatusBadge status={p.status} />
          {p.receipt_id && (
            <Link to={`/business/receipts/${p.receipt_id}`}>
              <Button size="sm" variant="ghost" icon="receipt">Receipt</Button>
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

interface PaymentRow {
  id: UUID;
  payment_number: string;
  method: string;
  provider: string | null;
  provider_reference: string | null;
  amount: number;
  currency: string;
  status: string;
  received_at: string;
  recorded_by_name: string | null;
  receipt_id: UUID | null;
}

/* ── Cancel with a reason ──────────────────────────────────────────────────── */

export function CancelOrderModal({ open, onClose, order, onDone }: {
  open: boolean;
  onClose: () => void;
  order: Order | null;
  onDone?: () => void;
}) {
  const { success, error: toastError } = useToast();
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (open) { setReason(''); setRestock(true); setError(null); } }, [open]);

  const cancel = async () => {
    if (!order) return;
    if (!reason.trim()) { setError('Give a reason — it is shown to the buyer and kept in the audit log.'); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await updateOrderStatus(order.id, 'cancelled', reason.trim(), restock);
      success('Order cancelled',
        res.restocked_lines > 0 ? `${order.order_number} · ${res.restocked_lines} stock line(s) returned to inventory.` : order.order_number);
      onDone?.();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message.replace(/^.*?exception:\s*/i, '') : 'Could not cancel the order.';
      setError(msg);
      toastError('Could not cancel', msg);
    } finally {
      setBusy(false);
    }
  };

  const paid = toNum(order?.amount_paid ?? 0);

  return (
    <Modal open={open} onClose={onClose} size="sm" title="Cancel order"
      subtitle={order?.order_number}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Keep order</Button>
          <Button size="sm" variant="danger" icon="close" loading={busy} disabled={paid > 0} onClick={() => void cancel()}>
            Cancel order
          </Button>
        </>
      }>
      <div className="space-y-3">
        {paid > 0 && (
          <Notice tone="danger" title={`${formatMoney(paid, order?.currency)} has already been paid`}>
            Refund the payment (or raise a credit note) before cancelling, so the money and the stock both balance.
            Open Returns &amp; refunds to do that.
          </Notice>
        )}
        <Textarea label="Reason for cancellation" required rows={3} value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Customer asked to cancel · item damaged in storage" />
        <Checkbox checked={restock} onChange={setRestock} label="Return the stock to inventory"
          hint="Creates a return_in movement for every line on the order." />
        {error && <Notice tone="danger">{error}</Notice>}
        <p className="text-[11px] text-ink-500">
          The buyer is notified, any draft invoice is voided, and the cancellation is written to the audit log.
        </p>
      </div>
    </Modal>
  );
}

/* ── Document header helpers ───────────────────────────────────────────────── */

export function DocumentMeta({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="divide-y divide-ink-100 text-sm">
      {rows.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([label, value]) => (
        <div key={label} className="flex items-start justify-between gap-3 py-1.5">
          <dt className="shrink-0 text-xs font-semibold text-ink-500">{label}</dt>
          <dd className="min-w-0 text-right text-[13px] font-semibold">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DocumentBadgeRow({ doc }: { doc: Invoice | Receipt | Order }) {
  const d = doc as { status?: string; payment_status?: string; kind?: string; share_token?: string | null };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <StatusBadge status={d.status} />
      {d.payment_status && <StatusBadge status={d.payment_status} />}
      {d.kind && d.kind !== 'tax_invoice' && <Badge tone="blue">{d.kind.replace(/_/g, ' ')}</Badge>}
      {d.share_token && <Badge tone="neutral" icon="link">Link active</Badge>}
    </div>
  );
}

/* ── Document line editor (invoices, quotations, pro-formas) ───────────────── */

/** A catalogue row as the picker reads it (products today; services can join later). */
interface CatalogueRow {
  id: UUID;
  name: string;
  sku: string | null;
  price: number;
  currency: string;
  stock: number;
  unit: string;
  primary_image_url: string | null;
  is_taxable: boolean;
  kind: 'product' | 'service';
}

export interface DocLineDraft {
  key: string;
  product_id: UUID | null;
  service_id: UUID | null;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  discount_percent: number;
  discount_amount: number;
  tax_rate: number;
  notes: string;
  image_url: string | null;
  stock: number | null;
  is_optional?: boolean;
}

export const blankLine = (taxRate: number): DocLineDraft => ({
  key: `line-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  product_id: null,
  service_id: null,
  description: '',
  quantity: 1,
  unit: 'piece',
  unit_price: 0,
  discount_percent: 0,
  discount_amount: 0,
  tax_rate: taxRate,
  notes: '',
  image_url: null,
  stock: null,
});

/** Line maths mirror the server exactly, so what the seller sees is what is saved. */
export function lineTotals(l: DocLineDraft) {
  const qty = Math.max(toNum(l.quantity), 0);
  const gross = round2(qty * toNum(l.unit_price));
  const discount = round2(toNum(l.discount_amount) + (gross * toNum(l.discount_percent)) / 100);
  const net = round2(Math.max(gross - discount, 0));
  const tax = round2((net * toNum(l.tax_rate)) / 100);
  return { subtotal: net, discount, tax, total: round2(net + tax) };
}

export function docTotals(lines: DocLineDraft[], deliveryFee = 0) {
  const t = lines.map(lineTotals);
  const subtotal = round2(t.reduce((s, x) => s + x.subtotal, 0));
  const discount = round2(t.reduce((s, x) => s + x.discount, 0));
  const tax = round2(t.reduce((s, x) => s + x.tax, 0));
  const delivery = round2(toNum(deliveryFee));
  return { subtotal, discount, tax, delivery, total: round2(subtotal + tax + delivery), itemCount: lines.reduce((s, l) => s + toNum(l.quantity), 0) };
}

function round2(n: number): number { return Math.round((n + Number.EPSILON) * 100) / 100; }

export function DocumentLinesEditor({ lines, onChange, businessId, currency, defaultTaxRate, showStock = true, allowOptional = false }: {
  lines: DocLineDraft[];
  onChange: (lines: DocLineDraft[]) => void;
  businessId: UUID;
  currency: string;
  defaultTaxRate: number;
  showStock?: boolean;
  allowOptional?: boolean;
}) {
  const { can } = useBusiness();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<CatalogueRow[]>([]);
  const [loading, setLoading] = useState(false);
  const debounced = useDebounce(q, 280);
  const canSeeCost = can('reports.read');

  useEffect(() => {
    if (!pickerOpen) return;
    let alive = true;
    (async () => {
      setLoading(true);
      const term = debounced.trim().replace(/[,()%]/g, ' ');
      const base = supabase.from('products')
        .select('id,name,sku,price,currency,stock,unit,primary_image_url,is_taxable')
        .eq('business_id', businessId).is('deleted_at', null).limit(25);
      const { data } = term
        ? await base.or(`name.ilike.%${term}%,sku.ilike.%${term}%,barcode.ilike.%${term}%`)
        : await base.order('sold_count', { ascending: false });
      if (!alive) return;
      setResults(((data ?? []) as CatalogueRow[]).map((r) => ({
        ...r,
        price: toNum(r.price),
        stock: Math.round(toNum(r.stock)),
      })));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [pickerOpen, debounced, businessId]);

  const add = (r: CatalogueRow) => {
    onChange([...lines, {
      ...blankLine(defaultTaxRate),
      product_id: r.kind === 'product' ? r.id : null,
      service_id: r.kind === 'service' ? r.id : null,
      description: r.name,
      unit_price: r.price,
      unit: r.unit || 'piece',
      image_url: r.primary_image_url,
      stock: r.stock,
    }]);
    setQ('');
  };

  const addCustom = () => onChange([...lines, blankLine(defaultTaxRate)]);

  const update = (key: string, patch: Partial<DocLineDraft>) =>
    onChange(lines.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const remove = (key: string) => onChange(lines.filter((l) => l.key !== key));

  const totals = docTotals(lines);

  return (
    <div className="space-y-3">
      <div className="hidden gap-2 px-1 text-[11px] font-bold uppercase tracking-wide text-ink-400 lg:grid lg:grid-cols-[minmax(0,1fr)_5rem_5rem_7rem_5rem_5rem_2rem]">
        <span>Description</span><span>Qty</span><span>Unit</span>
        <span className="text-right">Price</span><span className="text-right">Disc.</span>
        <span className="text-right">Tax %</span><span />
      </div>

      <ul className="space-y-2">
        {lines.map((l) => {
          const t = lineTotals(l);
          return (
            <li key={l.key} className="rounded-2xl border border-ink-200 p-2.5 lg:p-2">
              <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_5rem_5rem_7rem_5rem_5rem_2rem] lg:items-center">
                <div className="min-w-0">
                  <Input value={l.description} onChange={(e) => update(l.key, { description: e.target.value })}
                    placeholder="Item or service description" aria-label="Description" />
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-500">
                    {l.product_id && <Badge tone="neutral">Catalogue item</Badge>}
                    {showStock && l.stock !== null && l.stock !== undefined && (
                      <span className={l.stock <= 0 ? 'font-bold text-red-600' : ''}>{l.stock} in stock</span>
                    )}
                    {canSeeCost && l.notes && <span className="truncate">{l.notes}</span>}
                    {allowOptional && (
                      <label className="flex items-center gap-1">
                        <input type="checkbox" className="h-3 w-3 rounded border-ink-300"
                          checked={Boolean(l.is_optional)}
                          onChange={(e) => update(l.key, { is_optional: e.target.checked })} />
                        optional
                      </label>
                    )}
                  </div>
                </div>
                <Input type="number" min={0} step="0.001" value={String(l.quantity)}
                  onChange={(e) => update(l.key, { quantity: Number(e.target.value) || 0 })}
                  aria-label="Quantity" />
                <Input value={l.unit} onChange={(e) => update(l.key, { unit: e.target.value })} aria-label="Unit" />
                <MoneyInput currency={currency} value={l.unit_price}
                  onChange={(n) => update(l.key, { unit_price: n })} />
                <Input type="number" min={0} step="0.5" value={String(l.discount_percent)}
                  onChange={(e) => update(l.key, { discount_percent: Number(e.target.value) || 0, discount_amount: 0 })}
                  aria-label="Discount percent" trail="%" />
                <Input type="number" min={0} step="0.5" value={String(l.tax_rate)}
                  onChange={(e) => update(l.key, { tax_rate: Number(e.target.value) || 0 })}
                  aria-label="Tax rate" trail="%" />
                <div className="flex items-center justify-end gap-1">
                  <span className="sh-money hidden text-[13px] font-extrabold lg:block">{formatMoney(t.total, currency)}</span>
                  <Button size="sm" variant="ghost" icon="trash" className="text-red-600"
                    onClick={() => remove(l.key)} aria-label="Remove line" />
                </div>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-500 lg:hidden">
                <span className="sh-money font-extrabold text-ink-800">{formatMoney(t.total, currency)}</span>
                <span>{l.quantity} × {formatMoney(l.unit_price, currency)}</span>
                {t.discount > 0 && <span className="text-emerald-700">−{formatMoney(t.discount, currency)}</span>}
                {t.tax > 0 && <span>tax {formatMoney(t.tax, currency)}</span>}
              </div>
              <details className="mt-1">
                <summary className="cursor-pointer text-[11px] font-semibold text-brand-700">Line options</summary>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <MoneyInput label="Fixed discount amount" currency={currency} value={l.discount_amount}
                    onChange={(n) => update(l.key, { discount_amount: n, discount_percent: 0 })} />
                  <Input label="Line note (printed on the document)" value={l.notes}
                    onChange={(e) => update(l.key, { notes: e.target.value })} placeholder="e.g. 12 month warranty" />
                </div>
              </details>
            </li>
          );
        })}
      </ul>

      {lines.length === 0 && (
        <EmptyState icon="file" title="No lines yet"
          description="Add a product from your catalogue, or type a custom line for anything you do not stock." />
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" icon="search" onClick={() => setPickerOpen(true)}>Add from catalogue</Button>
        <Button size="sm" variant="outline" icon="plus" onClick={addCustom}>Add a custom line</Button>
        {lines.length > 0 && (
          <span className="ml-auto self-center text-xs text-ink-500">
            {lines.length} line{lines.length === 1 ? '' : 's'} · {Math.round(totals.itemCount)} item{Math.round(totals.itemCount) === 1 ? '' : 's'} ·
            <span className="sh-money ml-1 font-extrabold text-ink-800">{formatMoney(totals.total, currency)}</span>
          </span>
        )}
      </div>

      <Modal open={pickerOpen} onClose={() => setPickerOpen(false)} size="md" title="Add from your catalogue"
        footer={<Button variant="ghost" size="sm" onClick={() => setPickerOpen(false)}>Done</Button>}>
        <div className="space-y-3">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products by name, SKU or barcode" autoFocus />
          {loading ? (
            <Skeleton className="h-40 w-full rounded-2xl" />
          ) : results.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-500">
              Nothing matches “{q}”. Close this and add a custom line instead.
            </p>
          ) : (
            <ul className="max-h-72 divide-y divide-ink-100 overflow-y-auto rounded-2xl border border-ink-200">
              {results.map((r) => (
                <li key={`${r.kind}-${r.id}`}>
                  <button type="button" onClick={() => add(r)}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-brand-50">
                    {r.primary_image_url
                      ? <img src={r.primary_image_url} alt="" className="h-9 w-9 shrink-0 rounded-lg border border-ink-200 object-cover" />
                      : <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink-100">📦</span>}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-bold">{r.name}</span>
                      <span className="block truncate text-[11px] text-ink-500">
                        {r.sku ?? 'no SKU'} · {r.stock} in stock
                      </span>
                    </span>
                    <span className="sh-money shrink-0 text-sm font-extrabold">{formatMoney(r.price, r.currency)}</span>
                    <Icon name="plus" size={15} className="shrink-0 text-brand-600" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    </div>
  );
}

/** Customer search-and-pick used by every document screen. */
export function CustomerField({ businessId, value, onChange, allowCreate = true }: {
  businessId: UUID;
  value: Customer | null;
  onChange: (c: Customer | null) => void;
  allowCreate?: boolean;
}) {
  const { success, error: toastError } = useToast();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const debounced = useDebounce(q, 280);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      setLoading(true);
      const term = debounced.trim().replace(/[,()%]/g, ' ');
      let query = supabase.from('customers').select('*')
        .eq('business_id', businessId).is('deleted_at', null)
        .order('total_spent', { ascending: false, nullsFirst: false }).limit(25);
      if (term) query = query.or(`name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%,company_name.ilike.%${term}%`);
      const { data } = await query;
      if (alive) { setRows((data ?? []) as Customer[]); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [open, businessId, debounced]);

  const create = async () => {
    if (!name.trim()) { toastError('Enter a name'); return; }
    setBusy(true);
    try {
      const { upsertCustomer } = await import('@/lib/api');
      const id = await upsertCustomer(businessId, { name: name.trim(), phone: phone.trim() || undefined });
      const { data } = await supabase.from('customers').select('*').eq('id', id).maybeSingle();
      if (data) {
        onChange(data as Customer);
        success('Customer added', (data as Customer).name);
        setName(''); setPhone(''); setOpen(false);
      }
    } catch (e) {
      toastError('Could not add the customer', e instanceof Error ? e.message.replace(/^.*?exception:\s*/i, '') : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="sh-field-label">Customer</p>
      {value ? (
        <div className="flex items-center gap-2 rounded-xl border border-ink-200 p-2.5">
          <span className="min-w-0 flex-1">
            <Link to={`/business/customers/${value.id}`} className="block truncate text-sm font-bold hover:text-brand-700">
              {value.name}
            </Link>
            <span className="block truncate text-xs text-ink-500">
              {[value.phone, value.email, value.city].filter(Boolean).join(' · ') || 'no contact details'}
              {toNum(value.outstanding_balance) > 0 ? ` · owes ${formatMoney(value.outstanding_balance, value.currency)}` : ''}
            </span>
          </span>
          <Button size="sm" variant="ghost" icon="edit" onClick={() => setOpen(true)}>Change</Button>
          <Button size="sm" variant="ghost" icon="close" onClick={() => onChange(null)} aria-label="Clear customer" />
        </div>
      ) : (
        <Button variant="outline" size="sm" icon="users" onClick={() => setOpen(true)}>Choose a customer</Button>
      )}

      <Modal open={open} onClose={() => setOpen(false)} size="md" title="Choose a customer"
        footer={allowCreate
          ? <Button size="sm" icon="plus" loading={busy} onClick={() => void create()}>Add “{name || 'new customer'}”</Button>
          : undefined}>
        <div className="space-y-3">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, phone, email or company" autoFocus />
          {allowCreate && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Input label="New customer name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bwalya Mulenga" />
              <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+260 97 1234567" />
            </div>
          )}
          {loading ? (
            <Skeleton className="h-32 w-full rounded-2xl" />
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-500">
              No customers match “{q}”.{allowCreate ? ' Add one below.' : ''}
            </p>
          ) : (
            <ul className="max-h-64 divide-y divide-ink-100 overflow-y-auto rounded-2xl border border-ink-200">
              {rows.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => { onChange(c); setOpen(false); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-brand-50">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-bold">{c.name}</span>
                      <span className="block truncate text-[11px] text-ink-500">
                        {c.phone ?? 'no phone'}{c.company_name ? ` · ${c.company_name}` : ''} · {c.orders_count} orders
                      </span>
                    </span>
                    {toNum(c.outstanding_balance) > 0 && <Badge tone="red">Owes {formatMoney(c.outstanding_balance, c.currency)}</Badge>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    </div>
  );
}
