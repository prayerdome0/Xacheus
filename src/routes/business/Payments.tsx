import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, EmptyState, Notice, Skeleton } from '@/components/ui/Primitives';
import { StatusBadge, Tabs } from '@/components/ui';
import { PageHeader } from '@/components/layout/BusinessShell';
import { RecordPaymentModal, type PaymentTarget } from '@/components/business/Shared';
import { useBusiness } from '@/context/BusinessContext';
import { useToast } from '@/context/ToastContext';
import { supabase } from '@/lib/supabase';
import { resolvePaymentSubmission } from '@/lib/api';
import { formatMoney } from '@/lib/currency';
import { formatDateTime } from '@/lib/dates';
import { PAYMENT_METHOD_LABELS, PAYMENT_METHOD_ICONS } from '@/lib/constants';
import type { PaymentMethod, UUID } from '@/types';

/**
 * Payments — monitor money in and out.
 *
 * Money coming in from the public internet never counts as received until the
 * seller confirms it. That confirmation queue is the heart of this screen:
 *
 *   1. A buyer taps "I've Made Payment" on a payment link / order.
 *   2. It lands here as a pending submission (amount, method, reference,
 *      payer).
 *   3. The seller checks their account and taps Confirm — `resolve_payment_submission`
 *      writes the real payment, updates the order/invoice balance and generates
 *      a receipt — or Reject, which notifies the buyer.
 */

interface SubmissionRow {
  id: UUID;
  payment_link_id: UUID | null;
  order_id: UUID | null;
  invoice_id: UUID | null;
  customer_id: UUID | null;
  amount: number;
  currency: string;
  method: PaymentMethod;
  provider: string | null;
  reference: string | null;
  payer_name: string | null;
  payer_phone: string | null;
  payer_email: string | null;
  status: 'submitted' | 'confirmed' | 'rejected' | 'duplicate';
  note: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  created_at: string;
  payment_link?: { code?: string; label?: string | null } | null;
  invoice?: { invoice_number?: string } | null;
  order?: { order_number?: string } | null;
}

interface PaymentRow {
  id: UUID;
  payment_number: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  reference: string | null;
  direction: 'inbound' | 'outbound';
  received_at: string;
  status: string | null;
  customer_name: string | null;
  invoice?: { invoice_number?: string } | null;
  order?: { order_number?: string } | null;
}

const METHOD_ICON: Record<string, string> = PAYMENT_METHOD_ICONS;

export default function PaymentsModule() {
  const { activeBusiness, can } = useBusiness();
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();

  const [tab, setTab] = useState<'pending' | 'recorded'>('pending');
  const [pending, setPending] = useState<SubmissionRow[] | null>(null);
  const [payments, setPayments] = useState<PaymentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recordOpen, setRecordOpen] = useState(false);
  const [busyId, setBusyId] = useState<UUID | null>(null);

  const load = useCallback(async () => {
    if (!activeBusiness) return;
    setError(null);
    try {
      const [pendingRes, paymentsRes] = await Promise.all([
        supabase
          .from('payment_link_submissions')
          .select('*, payment_link:payment_links(code,label), invoice:invoices(invoice_number), order:orders(order_number)')
          .eq('business_id', activeBusiness.id)
          .eq('status', 'submitted')
          .order('created_at', { ascending: false }),
        supabase
          .from('payments')
          .select('*, invoice:invoices(invoice_number), order:orders(order_number)')
          .eq('business_id', activeBusiness.id)
          .order('received_at', { ascending: false })
          .limit(50),
      ]);
      if (pendingRes.error || paymentsRes.error) {
        throw new Error(pendingRes.error?.message ?? paymentsRes.error?.message ?? 'Could not load payments.');
      }
      setPending((pendingRes.data as unknown as SubmissionRow[]) ?? []);
      setPayments((paymentsRes.data as unknown as PaymentRow[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load payments.');
      setPending([]);
      setPayments([]);
    }
  }, [activeBusiness]);

  useEffect(() => { void load(); }, [load]);

  const resolve = async (row: SubmissionRow, action: 'confirm' | 'reject') => {
    setBusyId(row.id);
    try {
      const res = await resolvePaymentSubmission(row.id, action);
      success(
        action === 'confirm' ? 'Payment confirmed' : 'Payment rejected',
        action === 'confirm'
          ? `${formatMoney(row.amount, row.currency)} recorded${res.receipt_id ? ' · receipt generated' : ''}.`
          : 'The buyer has been notified.',
      );
      void load();
    } catch (e) {
      const msg = e instanceof Error ? e.message.replace(/^.*?exception:\s*/i, '') : 'Could not update the payment.';
      toastError(action === 'confirm' ? 'Could not confirm' : 'Could not reject', msg);
    } finally {
      setBusyId(null);
    }
  };

  const canRecord = can('payments.record');

  const recordTarget: PaymentTarget | null = activeBusiness ? {
    businessId: activeBusiness.id,
    customerName: null,
    currency: activeBusiness.base_currency,
    balanceDue: 0,
    documentNumber: undefined,
    direction: 'inbound',
  } : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Payments"
        subtitle="Confirm buyer payments and watch money in and out."
        icon="wallet"
        actions={
          canRecord ? (
            <Button icon="wallet" onClick={() => setRecordOpen(true)}>Record a payment</Button>
          ) : undefined
        }
      />

      {error && <Notice tone="danger" title="Could not load payments">{error}</Notice>}

      <Tabs
        active={tab}
        onChange={(v) => setTab(v as 'pending' | 'recorded')}
        tabs={[
          { key: 'pending', label: `Waiting for confirmation${pending?.length ? ` (${pending.length})` : ''}` },
          { key: 'recorded', label: 'Recorded payments' },
        ]}
      />

      {tab === 'pending' && (
        <>
          {pending === null ? (
            <div className="space-y-2.5">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
          ) : pending.length === 0 ? (
            <EmptyState icon="shield" title="Nothing waiting for confirmation"
              description="When a buyer taps \u201cI\u2019ve Made Payment\u201d it lands here for you to confirm against your bank or mobile-money statement. You only record money you actually see."
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button variant="outline" size="sm" icon="link" onClick={() => navigate('/business/payment-links')}>Payment links</Button>
                  <Button variant="outline" size="sm" icon="receipt" onClick={() => navigate('/business/orders')}>Orders</Button>
                </div>
              } />
          ) : (
            <div className="grid gap-2.5">
              {pending.map((s) => (
                <div key={s.id} className="sh-card-flat p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-50 text-lg" aria-hidden="true">
                          {METHOD_ICON[s.method] ?? '💳'}
                        </span>
                        <div>
                          <p className="text-sm font-extrabold text-ink-950">
                            {s.payer_name ?? s.payer_phone ?? 'Anonymous payer'}
                          </p>
                          <p className="text-[11px] text-ink-500">
                            {PAYMENT_METHOD_LABELS[s.method] ?? s.method}
                            {s.provider ? ` · ${s.provider}` : ''}
                            {' '}· {formatDateTime(s.created_at)}
                          </p>
                        </div>
                      </div>
                      <div className="mt-2 grid gap-1 text-xs text-ink-600 sm:grid-cols-2">
                        {s.reference && <Meta label="Reference" value={s.reference} />}
                        {s.payer_phone && <Meta label="Phone" value={s.payer_phone} />}
                        {s.payer_email && <Meta label="Email" value={s.payer_email} />}
                        {s.invoice?.invoice_number && <Meta label="Invoice" value={s.invoice.invoice_number} />}
                        {s.order?.order_number && <Meta label="Order" value={s.order.order_number} />}
                        {s.payment_link?.label && <Meta label="Link" value={s.payment_link.label} />}
                      </div>
                      {s.note && <p className="mt-2 rounded-xl bg-ink-50 p-2 text-xs text-ink-600">{s.note}</p>}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="sh-money text-lg font-extrabold">{formatMoney(s.amount, s.currency)}</p>
                      <div className="mt-2 flex gap-2">
                        <Button variant="outline" size="sm" icon="close" disabled={busyId === s.id}
                          onClick={() => void resolve(s, 'reject')}>Reject</Button>
                        <Button size="sm" icon="check" loading={busyId === s.id}
                          onClick={() => void resolve(s, 'confirm')}>Confirm</Button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'recorded' && (
        <>
          {payments === null ? (
            <div className="space-y-2.5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-2xl" />)}</div>
          ) : payments.length === 0 ? (
            <EmptyState icon="wallet" title="No payments recorded yet"
              description="Payments you record, or that a buyer declares and you confirm, appear here with their receipt and order/invoice reference." />
          ) : (
            <div className="sh-card-flat overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-ink-200 text-[11px] uppercase tracking-wide text-ink-500">
                    <th className="px-4 py-2.5 font-semibold">Payment</th>
                    <th className="px-4 py-2.5 font-semibold">Reference</th>
                    <th className="px-4 py-2.5 font-semibold">Method</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id} className="border-b border-ink-100">
                      <td className="px-4 py-2.5">
                        <span className="block font-bold text-ink-900">{p.payment_number}</span>
                        <span className="block text-[11px] text-ink-500">
                          {p.direction === 'outbound' ? 'Money out' : 'Money in'}
                          {p.invoice?.invoice_number ? ` · ${p.invoice.invoice_number}` : ''}
                          {p.order?.order_number ? ` · ${p.order.order_number}` : ''}
                        </span>
                        <StatusBadge status={p.status} />
                      </td>
                      <td className="px-4 py-2.5 text-xs text-ink-600">{p.reference ?? '—'}</td>
                      <td className="px-4 py-2.5 text-xs capitalize">{PAYMENT_METHOD_LABELS[p.method] ?? p.method.replace(/_/g, ' ')}</td>
                      <td className={`px-4 py-2.5 text-right font-extrabold ${p.direction === 'outbound' ? 'text-red-600' : 'text-emerald-700'}`}>
                        {p.direction === 'outbound' ? '−' : '+'} {formatMoney(p.amount, p.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <RecordPaymentModal
        open={recordOpen}
        onClose={() => setRecordOpen(false)}
        target={recordTarget}
        onDone={() => void load()}
      />
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex gap-1.5">
      <span className="font-semibold text-ink-400">{label}:</span>
      <span className="truncate font-medium text-ink-700">{value}</span>
    </span>
  );
}
