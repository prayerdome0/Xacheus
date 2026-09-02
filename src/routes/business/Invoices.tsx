import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import {
  Badge, Button, EmptyState, Input, Notice, Select, Skeleton, Textarea,
} from '@/components/ui/Primitives';
import { MoneyInput, StatusBadge } from '@/components/ui';
import { PageHeader } from '@/components/layout/BusinessShell';
import { useBusiness } from '@/context/BusinessContext';
import { useToast } from '@/context/ToastContext';
import { supabase } from '@/lib/supabase';
import {
  createInvoice, createShareToken, fetchInvoice,
} from '@/lib/api';
import { buildInvoicePdf, savePdf } from '@/lib/pdf';
import { formatMoney, toNum } from '@/lib/currency';
import { formatDate } from '@/lib/dates';
import { UNITS } from '@/lib/constants';
import type { Invoice, InvoiceItem, UUID } from '@/types';

/**
 * Invoices — create, list, download and share branded invoices.
 *
 * The invoice automatically uses the company's saved logo, name, address,
 * phone, email, website and payment details, and carries a QR that points to
 * the public verification page.
 */

type InvoiceRow = Invoice & { items?: InvoiceItem[] };

interface Line {
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  discount_percent: number;
  tax_rate: number;
}
const emptyLine = (): Line => ({ description: '', quantity: 1, unit: 'piece', unit_price: 0, discount_percent: 0, tax_rate: 0 });

function lineTotals(lines: Line[]) {
  let subtotal = 0, discount = 0, tax = 0;
  for (const l of lines) {
    const gross = toNum(l.quantity) * toNum(l.unit_price);
    const d = gross * (toNum(l.discount_percent) / 100);
    const t = (gross - d) * (toNum(l.tax_rate) / 100);
    subtotal += gross; discount += d; tax += t;
  }
  return { subtotal, discount, tax };
}

function Totals({ subtotal, discount, tax, delivery, currency }: {
  subtotal: number; discount: number; tax: number; delivery: number; currency: string;
}) {
  const total = subtotal - discount + tax + toNum(delivery);
  return (
    <dl className="mt-2 rounded-2xl bg-ink-50 p-4 text-sm">
      <div className="flex justify-between py-0.5 text-ink-600"><dt>Subtotal</dt><dd>{formatMoney(subtotal, currency)}</dd></div>
      {discount > 0 && <div className="flex justify-between py-0.5 text-emerald-600"><dt>Discount</dt><dd>− {formatMoney(discount, currency)}</dd></div>}
      {tax > 0 && <div className="flex justify-between py-0.5 text-ink-600"><dt>Tax</dt><dd>{formatMoney(tax, currency)}</dd></div>}
      {toNum(delivery) > 0 && <div className="flex justify-between py-0.5 text-ink-600"><dt>Delivery</dt><dd>{formatMoney(delivery, currency)}</dd></div>}
      <div className="mt-1 flex justify-between border-t border-ink-200 pt-2 text-base font-extrabold text-ink-900"><dt>Total</dt><dd>{formatMoney(total, currency)}</dd></div>
    </dl>
  );
}

/* ── List ─────────────────────────────────────────────────────────────────── */

export default function InvoicesModule() {
  const { activeBusiness } = useBusiness();
  const navigate = useNavigate();
  const { success: toast } = useToast();
  const [rows, setRows] = useState<InvoiceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeBusiness) return;
    setError(null);
    setRows(null);
    try {
      const { data, error: err } = await supabase
        .from('invoices')
        .select('*, items:invoice_items(*), customer:customers(id,name,phone,email)')
        .eq('business_id', activeBusiness.id)
        .is('deleted_at', null)
        .order('issue_date', { ascending: false });
      if (err) throw new Error(err.message);
      setRows((data as unknown as InvoiceRow[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load invoices.');
      setRows([]);
    }
  }, [activeBusiness]);
  useEffect(() => { void load(); }, [load]);

  const download = async (row: InvoiceRow) => {
    try {
      const full = await fetchInvoice(row.id);
      if (!full) { toast('Invoice not found'); return; }
      const doc = await buildInvoicePdf({
        invoice: full as Invoice,
        business: activeBusiness!,
        items: (full.items as unknown as InvoiceItem[]) ?? [],
        payments: full.payments,
        origin: window.location.origin,
      });
      savePdf(doc, `${row.invoice_number}.pdf`);
    } catch (e) {
      toast('Could not build the PDF', e instanceof Error ? e.message : 'Try again.');
    }
  };

  const share = async (row: InvoiceRow) => {
    try {
      const token = row.share_token ?? await createShareToken('invoice', row.id);
      const url = `${window.location.origin}/d/invoice/${token}`;
      void navigator.clipboard?.writeText(url).catch(() => {});
      toast('Share link copied', url);
    } catch (e) {
      toast('Could not create a link', e instanceof Error ? e.message : 'Try again.');
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Invoices"
        subtitle="Branded invoices your customers can verify by QR."
        icon="receipt"
        actions={<Button icon="plus" onClick={() => navigate('/business/invoices/new')}>New invoice</Button>}
      />
      {rows === null ? (
        <div className="space-y-2.5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
      ) : error ? (
        <EmptyState icon="warning" title="Could not load invoices" description={error}
          action={<Button variant="outline" size="sm" icon="refresh" onClick={() => void load()}>Try again</Button>} />
      ) : rows.length === 0 ? (
        <EmptyState icon="receipt" title="No invoices yet"
          description="Create your first invoice and send it to a customer. It will carry your business identity and a verification QR."
          action={<Button icon="plus" onClick={() => navigate('/business/invoices/new')}>New invoice</Button>} />
      ) : (
        <div className="grid gap-2.5">
          {rows.map((inv) => (
            <div key={inv.id} className="sh-card-flat flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-extrabold text-ink-950">{inv.invoice_number}</span>
                  <StatusBadge status={inv.status} />
                  {inv.kind === 'credit_note' && <Badge tone="amber">Credit note</Badge>}
                  {inv.kind === 'proforma' && <Badge tone="blue">Pro-forma</Badge>}
                </div>
                <p className="mt-0.5 truncate text-xs text-ink-500">
                  {inv.customer?.name ?? 'Walk-in customer'} · {formatDate(inv.issue_date)}
                  {inv.due_date ? ` · due ${formatDate(inv.due_date)}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="sh-money mr-2 text-sm font-extrabold">{formatMoney(inv.total, inv.currency)}</span>
                <Button variant="outline" size="sm" icon="file" onClick={() => void download(inv)}>PDF</Button>
                <Button variant="outline" size="sm" icon="share" onClick={() => void share(inv)}>Share</Button>
                <Button variant="outline" size="sm" icon="arrowRight" onClick={() => navigate(`/business/invoices/${inv.id}`)}>Open</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Create ───────────────────────────────────────────────────────────────── */

export function InvoiceEditorPage() {
  const { activeBusiness } = useBusiness();
  const navigate = useNavigate();
  const { success: toast } = useToast();
  const currency = activeBusiness?.base_currency ?? 'ZMW';

  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [delivery, setDelivery] = useState(0);
  const [dueDays, setDueDays] = useState(14);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const overall = useMemo(() => lineTotals(lines), [lines]);

  const setLine = (i: number, patch: Partial<Line>) => setLines((p) => p.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const save = async () => {
    if (!activeBusiness) return;
    setFormError(null);
    const usable = lines.filter((l) => l.description.trim() && toNum(l.quantity) > 0 && toNum(l.unit_price) > 0);
    if (usable.length === 0) { setFormError('Add at least one line with a description, quantity and price.'); return; }
    setBusy(true);
    try {
      const id = await createInvoice({
        business_id: activeBusiness.id,
        kind: 'tax_invoice',
        currency,
        customer: customerName.trim() ? { name: customerName.trim(), email: customerEmail.trim() || undefined, phone: customerPhone.trim() || undefined } : undefined,
        items: usable.map((l) => ({
          description: l.description.trim(),
          quantity: toNum(l.quantity),
          unit_price: toNum(l.unit_price),
          unit: l.unit,
          discount_percent: toNum(l.discount_percent),
          tax_rate: toNum(l.tax_rate),
        })),
        delivery_fee: toNum(delivery),
        due_days: toNum(dueDays),
        notes: notes.trim() || undefined,
        status: 'draft',
      });
      toast('Invoice created', 'You can now preview, share or send it.');
      navigate(`/business/invoices/${id}`, { replace: true });
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not create the invoice.');
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="New invoice"
        subtitle={`Invoice for ${activeBusiness?.name ?? 'your business'}`}
        icon="receipt"
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => navigate('/business/invoices')}>Cancel</Button>
            <Button icon="check" loading={busy} onClick={() => void save()}>Create invoice</Button>
          </div>
        }
      />
      {formError && <Notice tone="danger" title="Could not create the invoice">{formError}</Notice>}

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          <div className="sh-card-flat p-4">
            <p className="sh-field-label">Customer</p>
            <div className="mt-2 space-y-2.5">
              <Input label="Customer name" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="e.g. Chanda Mulenga" />
              <div className="grid gap-2.5 sm:grid-cols-2">
                <Input label="Email" type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="customer@example.com" />
                <Input label="Phone" type="tel" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="97 123 4567" />
              </div>
            </div>
          </div>

          <div className="sh-card-flat p-4">
            <div className="flex items-center justify-between">
              <p className="sh-field-label">Items & services</p>
              <Button variant="outline" size="sm" icon="plus" onClick={() => setLines((p) => [...p, emptyLine()])}>Add line</Button>
            </div>
            <div className="mt-3 space-y-3">
              {lines.map((l, i) => (
                <div key={i} className="rounded-2xl border border-ink-200 p-3">
                  <div className="flex items-start gap-2">
                    <Input className="flex-1" label={i === 0 ? 'Description' : undefined} value={l.description}
                      onChange={(e) => setLine(i, { description: e.target.value })} placeholder="Describe the product or service" />
                    <button type="button" disabled={lines.length === 1} onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))}
                      className="mt-6 rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-red-600" aria-label="Remove line">
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Input label="Qty" type="number" inputMode="decimal" value={String(l.quantity)}
                      onChange={(e) => setLine(i, { quantity: Number(e.target.value) || 0 })} />
                    <Select label="Unit" value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })}
                      options={UNITS.map((u) => ({ value: u, label: u }))} />
                    <MoneyInput label="Unit price" currency={currency} value={toNum(l.unit_price)}
                      onChange={(v) => setLine(i, { unit_price: toNum(v) })} />
                    <Input label="Discount %" type="number" inputMode="decimal" value={String(l.discount_percent)}
                      onChange={(e) => setLine(i, { discount_percent: Number(e.target.value) || 0 })} />
                  </div>
                  <div className="mt-2">
                    <Input label="Tax %" type="number" inputMode="decimal" value={String(l.tax_rate)}
                      onChange={(e) => setLine(i, { tax_rate: Number(e.target.value) || 0 })} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="sh-card-flat p-4">
            <div className="grid gap-2.5 sm:grid-cols-2">
              <MoneyInput label="Delivery fee" currency={currency} value={toNum(delivery)} onChange={(v) => setDelivery(toNum(v))} />
              <Input label="Payment terms (days)" type="number" inputMode="numeric" min={1} value={String(dueDays)}
                onChange={(e) => setDueDays(Number(e.target.value) || 1)} />
            </div>
            <div className="mt-2.5">
              <Textarea label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
                placeholder="Payment instructions, terms, delivery notes…" />
            </div>
          </div>
        </div>

        <div className="lg:sticky lg:top-20">
          <div className="sh-card-flat p-4">
            <p className="sh-field-label">Summary</p>
            <Totals subtotal={overall.subtotal} discount={overall.discount} tax={overall.tax} delivery={toNum(delivery)} currency={currency} />
            <p className="mt-3 text-[11px] leading-relaxed text-ink-500">
              Your saved business information (logo, name, address, phone, email, website, payment details) is added automatically.
            </p>
            <Button block size="lg" className="mt-4" icon="check" loading={busy} onClick={() => void save()}>Create invoice</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Detail ───────────────────────────────────────────────────────────────── */

export function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { activeBusiness } = useBusiness();
  const navigate = useNavigate();
  const { success: toast } = useToast();
  const [invoice, setInvoice] = useState<InvoiceRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!id) return;
    fetchInvoice(id as UUID).then((f) => { if (alive) setInvoice(f as InvoiceRow | null); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'Could not load the invoice.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id]);

  const download = async () => {
    if (!invoice || !activeBusiness) return;
    try {
      const doc = await buildInvoicePdf({
        invoice: invoice as Invoice,
        business: activeBusiness,
        items: (invoice.items as unknown as InvoiceItem[]) ?? [],
        payments: invoice.payments,
        origin: window.location.origin,
      });
      savePdf(doc, `${invoice.invoice_number}.pdf`);
    } catch (e) {
      toast('Could not build the PDF', e instanceof Error ? e.message : 'Try again.');
    }
  };

  const share = async () => {
    if (!invoice) return;
    try {
      const token = invoice.share_token ?? await createShareToken('invoice', invoice.id);
      const url = `${window.location.origin}/d/invoice/${token}`;
      void navigator.clipboard?.writeText(url).catch(() => {});
      toast('Share link copied', url);
    } catch (e) {
      toast('Could not create a link', e instanceof Error ? e.message : 'Try again.');
    }
  };

  if (loading) return <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>;
  if (error || !invoice) {
    return <EmptyState icon="warning" title="Could not open this invoice" description={error ?? 'Not found.'}
      action={<Button variant="outline" onClick={() => navigate('/business/invoices')}>Back to invoices</Button>} />;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={invoice.invoice_number}
        subtitle={`${invoice.customer?.name ?? 'Walk-in customer'} · ${formatDate(invoice.issue_date)}`}
        icon="receipt"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => navigate('/business/invoices')}>Back</Button>
            <Button variant="outline" icon="file" onClick={() => void download()}>PDF</Button>
            <Button variant="outline" icon="share" onClick={() => void share()}>Share</Button>
          </div>
        }
      />
      <div className="sh-card-flat p-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={invoice.status} />
          {invoice.due_date && <Badge tone={toNum(invoice.balance_due) > 0 ? 'amber' : 'green'}>Due {formatDate(invoice.due_date)}</Badge>}
        </div>
        {invoice.balance_due != null && toNum(invoice.balance_due) > 0 && (
          <p className="mt-3 text-sm font-bold text-red-600">Balance due: {formatMoney(invoice.balance_due, invoice.currency)}</p>
        )}
      </div>
    </div>
  );
}
