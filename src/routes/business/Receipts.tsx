import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, EmptyState, Input, Notice, Select, Skeleton, Textarea } from '@/components/ui/Primitives';
import { MoneyInput, StatusBadge } from '@/components/ui';
import { PageHeader } from '@/components/layout/BusinessShell';
import { useBusiness } from '@/context/BusinessContext';
import { useToast } from '@/context/ToastContext';
import { supabase } from '@/lib/supabase';
import { createReceipt } from '@/lib/api';
import { buildReceiptPdf, savePdf } from '@/lib/pdf';
import { formatMoney, toNum } from '@/lib/currency';
import { formatDate } from '@/lib/dates';
import { PAYMENT_METHOD_LABELS } from '@/lib/constants';
import type { PaymentMethod, Receipt } from '@/types';

/**
 * Receipts — issue a receipt after payment confirmation.
 *
 * Receipts are issued against a payment and carry the company identity, the
 * payment reference, and a QR that opens the verification page.
 */

type ReceiptRow = Receipt;

const METHOD_OPTIONS = (Object.entries(PAYMENT_METHOD_LABELS) as [PaymentMethod, string][]).map(([value, label]) => ({ value, label }));

/* ── List ─────────────────────────────────────────────────────────────────── */

export default function ReceiptsModule() {
  const { activeBusiness } = useBusiness();
  const navigate = useNavigate();
  const { success: toast } = useToast();
  const [rows, setRows] = useState<ReceiptRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeBusiness) return;
    setError(null);
    setRows(null);
    try {
      const { data, error: err } = await supabase
        .from('receipts')
        .select('*')
        .eq('business_id', activeBusiness.id)
        .is('deleted_at', null)
        .order('received_at', { ascending: false });
      if (err) throw new Error(err.message);
      setRows((data as unknown as ReceiptRow[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load receipts.');
      setRows([]);
    }
  }, [activeBusiness]);
  useEffect(() => { void load(); }, [load]);

  const download = async (row: ReceiptRow) => {
    try {
      const doc = await buildReceiptPdf({
        receipt: row,
        business: activeBusiness!,
        invoiceNumber: null,
        origin: window.location.origin,
      });
      savePdf(doc, `${row.receipt_number}.pdf`);
    } catch (e) {
      toast('Could not build the receipt', e instanceof Error ? e.message : 'Try again.');
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Receipts"
        subtitle="Issue an 80 mm receipt with a QR your customer can verify."
        icon="receipt"
        actions={<Button icon="plus" onClick={() => navigate('/business/receipts/new')}>New receipt</Button>}
      />
      {rows === null ? (
        <div className="space-y-2.5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
      ) : error ? (
        <EmptyState icon="warning" title="Could not load receipts" description={error}
          action={<Button variant="outline" size="sm" icon="refresh" onClick={() => void load()}>Try again</Button>} />
      ) : rows.length === 0 ? (
        <EmptyState icon="receipt" title="No receipts yet"
          description="Issue a receipt after a payment is confirmed. It will show your business identity and a verification QR."
          action={<Button icon="plus" onClick={() => navigate('/business/receipts/new')}>New receipt</Button>} />
      ) : (
        <div className="grid gap-2.5">
          {rows.map((r) => (
            <div key={r.id} className="sh-card-flat flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-extrabold text-ink-950">{r.receipt_number}</span>
                  <StatusBadge status="paid" />
                </div>
                <p className="mt-0.5 truncate text-xs text-ink-500">
                  {r.customer_name ?? 'Customer'} · {formatDate(r.received_at)} · {PAYMENT_METHOD_LABELS[r.method]}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="sh-money mr-2 text-sm font-extrabold">{formatMoney(r.amount, r.currency)}</span>
                <Button variant="outline" size="sm" icon="file" onClick={() => void download(r)}>Receipt</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Create ───────────────────────────────────────────────────────────────── */

export function ReceiptEditorPage() {
  const { activeBusiness } = useBusiness();
  const navigate = useNavigate();
  const { success: toast } = useToast();
  const currency = activeBusiness?.base_currency ?? 'ZMW';

  const [customerName, setCustomerName] = useState('');
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const save = async () => {
    if (!activeBusiness) return;
    setFormError(null);
    if (toNum(amount) <= 0) { setFormError('Enter the amount received.'); return; }
    setBusy(true);
    try {
      await createReceipt({
        business_id: activeBusiness.id,
        amount: toNum(amount),
        method,
        currency,
        customer_name: customerName.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      toast('Receipt issued', 'The receipt is ready to print or share.');
      navigate('/business/receipts');
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not issue the receipt.');
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="New receipt"
        subtitle={`Receipt for ${activeBusiness?.name ?? 'your business'}`}
        icon="receipt"
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => navigate('/business/receipts')}>Cancel</Button>
            <Button icon="check" loading={busy} onClick={() => void save()}>Issue receipt</Button>
          </div>
        }
      />
      {formError && <Notice tone="danger" title="Could not issue the receipt">{formError}</Notice>}

      <div className="max-w-xl">
        <div className="sh-card-flat space-y-3 p-5">
          <Input label="Customer name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="e.g. Chanda Mulenga" />
          <MoneyInput label="Amount received" currency={currency} value={toNum(amount)} onChange={(v) => setAmount(toNum(v))} />
          <Select label="Payment method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}
            options={METHOD_OPTIONS} />
          <Textarea label="Payment reference / notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
            placeholder="e.g. MTN 8841 2210 · balance after · payment details…" />
          <Button block size="lg" icon="check" loading={busy} onClick={() => void save()}>Issue receipt</Button>
          <p className="text-[11px] leading-relaxed text-ink-500">
            The receipt is branded with your business identity and includes a QR that opens the
            Seedwel Hub verification page. Receipts linked to a confirmed payment are recorded automatically.
          </p>
        </div>
      </div>
    </div>
  );
}
