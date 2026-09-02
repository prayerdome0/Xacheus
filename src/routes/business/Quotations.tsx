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
  createQuotation, createShareToken, fetchQuotation, convertQuotationToInvoice,
} from '@/lib/api';
import { buildQuotationPdf, savePdf } from '@/lib/pdf';
import { formatMoney, toNum } from '@/lib/currency';
import { formatDate } from '@/lib/dates';
import { UNITS } from '@/lib/constants';
import type { Quotation, QuotationItem, UUID } from '@/types';

/**
 * Quotations — create, list, download, share and convert to invoice.
 *
 * Every quotation carries the seller's saved business identity, a unique
 * number, and an auto-calculated subtotal / discount / tax / delivery / total.
 * Generating a PDF embeds a QR that points to the public verification page.
 */

type QuotationRow = Quotation & { items?: QuotationItem[] };

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
  let subtotal = 0;
  let discount = 0;
  let tax = 0;
  for (const l of lines) {
    const gross = toNum(l.quantity) * toNum(l.unit_price);
    const d = gross * (toNum(l.discount_percent) / 100);
    const t = (gross - d) * (toNum(l.tax_rate) / 100);
    subtotal += gross;
    discount += d;
    tax += t;
  }
  return { subtotal, discount, tax };
}

function QuotationTotals({ lines, delivery, currency, discountOverride, taxOverride, total }: {
  lines: Line[]; delivery: number; currency: string;
  discountOverride: number; taxOverride: number; total: number;
}) {
  let subtotal = 0;
  let discount = 0;
  let tax = 0;
  for (const l of lines) {
    const gross = toNum(l.quantity) * toNum(l.unit_price);
    subtotal += gross;
    discount += gross * (toNum(l.discount_percent) / 100);
    tax += (gross - (gross * (toNum(l.discount_percent) / 100))) * (toNum(l.tax_rate) / 100);
  }
  // Honour server-side authoritative numbers when provided.
  const d = discountOverride || discount;
  const t = taxOverride || tax;
  const tot = total || subtotal - d + t + toNum(delivery);
  return (
    <dl className="mt-2 rounded-2xl bg-ink-50 p-4 text-sm">
      <div className="flex justify-between py-0.5 text-ink-600"><dt>Subtotal</dt><dd>{formatMoney(subtotal, currency)}</dd></div>
      {d > 0 && <div className="flex justify-between py-0.5 text-emerald-600"><dt>Discount</dt><dd>− {formatMoney(d, currency)}</dd></div>}
      {t > 0 && <div className="flex justify-between py-0.5 text-ink-600"><dt>Tax</dt><dd>{formatMoney(t, currency)}</dd></div>}
      {toNum(delivery) > 0 && <div className="flex justify-between py-0.5 text-ink-600"><dt>Delivery</dt><dd>{formatMoney(delivery, currency)}</dd></div>}
      <div className="mt-1 flex justify-between border-t border-ink-200 pt-2 text-base font-extrabold text-ink-900">
        <dt>Total</dt><dd>{formatMoney(tot, currency)}</dd>
      </div>
    </dl>
  );
}

/* ── List ─────────────────────────────────────────────────────────────────── */

export default function QuotationsModule() {
  const { activeBusiness } = useBusiness();
  const navigate = useNavigate();
  const { success: toast } = useToast();
  const [rows, setRows] = useState<QuotationRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeBusiness) return;
    setError(null);
    setRows(null);
    try {
      const { data, error: err } = await supabase
        .from('quotations')
        .select('*, items:quotation_items(*), customer:customers(id,name,phone,email,city)')
        .eq('business_id', activeBusiness.id)
        .is('deleted_at', null)
        .order('issue_date', { ascending: false });
      if (err) throw new Error(err.message);
      setRows((data as unknown as QuotationRow[]) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load quotations.');
      setRows([]);
    }
  }, [activeBusiness]);

  useEffect(() => { void load(); }, [load]);

  const convert = async (row: QuotationRow) => {
    try {
      await convertQuotationToInvoice(row.id);
      toast('Converted to invoice', 'The quotation is now an invoice.');
      void load();
    } catch (e) {
      toast('Could not convert', e instanceof Error ? e.message : 'Try again.');
    }
  };

  const download = async (row: QuotationRow) => {
    try {
      const full = await fetchQuotation(row.id);
      if (!full) { toast('Quotation not found', 'It may have been removed.'); return; }
      const doc = await buildQuotationPdf({
        quotation: full as Quotation,
        business: activeBusiness!,
        items: (full.items as unknown as QuotationItem[]) ?? [],
        origin: window.location.origin,
      });
      savePdf(doc, `${row.quotation_number}.pdf`);
    } catch (e) {
      toast('Could not build the PDF', e instanceof Error ? e.message : 'Try again.');
    }
  };

  const share = async (row: QuotationRow) => {
    try {
      const token = row.share_token ?? await createShareToken('quotation', row.id);
      const url = `${window.location.origin}/q/${token}`;
      void navigator.clipboard?.writeText(url).catch(() => {});
      toast('Share link copied', url);
    } catch (e) {
      toast('Could not create a link', e instanceof Error ? e.message : 'Try again.');
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Quotations"
        subtitle="Quote, share and convert to an invoice in one tap."
        icon="invoice"
        actions={<Button icon="plus" onClick={() => navigate('/business/quotations/new')}>New quotation</Button>}
      />

      {rows === null ? (
        <SkeletonList />
      ) : error ? (
        <EmptyState icon="warning" title="Could not load quotations" description={error}
          action={<Button variant="outline" size="sm" icon="refresh" onClick={() => void load()}>Try again</Button>} />
      ) : rows.length === 0 ? (
        <EmptyState icon="invoice" title="No quotations yet"
          description="Create your first quotation and send it to a customer. It will appear here with a QR for verification."
          action={<Button icon="plus" onClick={() => navigate('/business/quotations/new')}>New quotation</Button>} />
      ) : (
        <div className="grid gap-2.5">
          {rows.map((q) => (
            <div key={q.id} className="sh-card-flat flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-extrabold text-ink-950">{q.quotation_number}</span>
                  <StatusBadge status={q.status} />
                  {q.kind === 'proforma' && <Badge tone="blue">Pro-forma</Badge>}
                </div>
                <p className="mt-0.5 truncate text-xs text-ink-500">
                  {q.customer?.name ?? 'Walk-in customer'} · {formatDate(q.issue_date)}
                  {q.valid_until ? ` · valid to ${formatDate(q.valid_until)}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="sh-money mr-2 text-sm font-extrabold">{formatMoney(q.total, q.currency)}</span>
                <Button variant="outline" size="sm" icon="file" onClick={() => void download(q)}>PDF</Button>
                <Button variant="outline" size="sm" icon="share" onClick={() => void share(q)}>Share</Button>
                <Button variant="outline" size="sm" icon="invoice" onClick={() => void convert(q)}>Invoice</Button>
                <Button variant="outline" size="sm" icon="arrowRight"
                  onClick={() => navigate(`/business/quotations/${q.id}`)}>Open</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SkeletonList() {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
    </div>
  );
}

/* ── Create / edit ────────────────────────────────────────────────────────── */

export function QuotationEditorPage() {
  const { activeBusiness } = useBusiness();
  const navigate = useNavigate();
  const { success: toast } = useToast();

  const [kind, setKind] = useState<'quotation' | 'proforma'>('quotation');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [delivery, setDelivery] = useState(0);
  const [notes, setNotes] = useState('');
  const [validDays, setValidDays] = useState(14);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const currency = activeBusiness?.base_currency ?? 'ZMW';

  const overall = useMemo(() => lineTotals(lines), [lines]);
  const total = overall.subtotal - overall.discount + overall.tax + toNum(delivery);

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const save = async () => {
    if (!activeBusiness) return;
    setFormError(null);
    const usable = lines.filter((l) => l.description.trim() && toNum(l.quantity) > 0 && toNum(l.unit_price) > 0);
    if (usable.length === 0) { setFormError('Add at least one line with a description, quantity and price.'); return; }

    setBusy(true);
    try {
      const id = await createQuotation({
        business_id: activeBusiness.id,
        kind,
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
        notes: notes.trim() || undefined,
        valid_days: toNum(validDays),
        status: 'draft',
      });
      toast('Quotation created', 'You can now preview, share or convert it to an invoice.');
      navigate(`/business/quotations/${id}`, { replace: true });
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not create the quotation.');
    } finally {
      setBusy(false);
    }
  };

  if (!activeBusiness) {
    return (
      <EmptyState icon="store" title="Select a business first"
        description="Quotations belong to a business. Switch to your business to create one."
        action={<Button variant="outline" onClick={() => navigate('/business')}>Go to dashboard</Button>} />
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="New quotation"
        subtitle={`Quotation for ${activeBusiness.name}`}
        icon="invoice"
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => navigate('/business/quotations')}>Cancel</Button>
            <Button icon="check" loading={busy} onClick={() => void save()}>Create quotation</Button>
          </div>
        }
      />

      {formError && <Notice tone="danger" title="Could not create the quotation">{formError}</Notice>}

      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          {/* Kind */}
          <div className="sh-card-flat p-4">
            <p className="sh-field-label">Document type</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(['quotation', 'proforma'] as const).map((k) => (
                <button key={k} type="button" onClick={() => setKind(k)}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ${kind === k ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-ink-200 text-ink-600 hover:border-ink-300'}`}>
                  {k === 'quotation' ? '🧾 Quotation' : '📄 Pro-forma invoice'}
                </button>
              ))}
            </div>
          </div>

          {/* Customer */}
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

          {/* Line items */}
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

          {/* Notes + delivery */}
          <div className="sh-card-flat p-4">
            <div className="grid gap-2.5 sm:grid-cols-2">
              <MoneyInput label="Delivery fee" currency={currency} value={toNum(delivery)} onChange={(v) => setDelivery(toNum(v))} />
              <Input label="Valid for (days)" type="number" inputMode="numeric" min={1} value={String(validDays)}
                onChange={(e) => setValidDays(Number(e.target.value) || 1)} />
            </div>
            <div className="mt-2.5">
              <Textarea label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
                placeholder="Payment terms, delivery notes, conditions…" />
            </div>
          </div>
        </div>

        {/* Totals summary */}
        <div className="lg:sticky lg:top-20">
          <div className="sh-card-flat p-4">
            <p className="sh-field-label">Summary</p>
            <QuotationTotals lines={lines} delivery={toNum(delivery)} currency={currency}
              discountOverride={overall.discount} taxOverride={overall.tax} total={total} />
            <p className="mt-3 text-[11px] leading-relaxed text-ink-500">
              Your saved business information (logo, name, address, phone, email, payment details) is added automatically.
            </p>
            <Button block size="lg" className="mt-4" icon="check" loading={busy} onClick={() => void save()}>
              Create quotation
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Detail ───────────────────────────────────────────────────────────────── */

export function QuotationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { activeBusiness } = useBusiness();
  const navigate = useNavigate();
  const { success: toast } = useToast();
  const [quotation, setQuotation] = useState<QuotationRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const q = await fetchQuotation(id as UUID);
      setQuotation(q as QuotationRow | null);
      if (!q) setError('This quotation could not be found.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the quotation.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const download = async () => {
    if (!quotation || !activeBusiness) return;
    try {
      const doc = await buildQuotationPdf({
        quotation: quotation as Quotation,
        business: activeBusiness,
        items: (quotation.items as unknown as QuotationItem[]) ?? [],
        origin: window.location.origin,
      });
      savePdf(doc, `${quotation.quotation_number}.pdf`);
    } catch (e) {
      toast('Could not build the PDF', e instanceof Error ? e.message : 'Try again.');
    }
  };

  const share = async () => {
    if (!quotation) return;
    setSharing(true);
    try {
      const token = quotation.share_token ?? await createShareToken('quotation', quotation.id);
      const url = `${window.location.origin}/q/${token}`;
      void navigator.clipboard?.writeText(url).catch(() => {});
      toast('Share link copied', url);
    } catch (e) {
      toast('Could not create a link', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSharing(false);
    }
  };

  const convert = async () => {
    if (!quotation) return;
    try {
      await convertQuotationToInvoice(quotation.id);
      toast('Converted to invoice', 'The quotation is now an invoice.');
      void load();
    } catch (e) {
      toast('Could not convert', e instanceof Error ? e.message : 'Try again.');
    }
  };

  if (loading) return <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>;
  if (error || !quotation) {
    return (
      <EmptyState icon="warning" title="Could not open this quotation" description={error ?? 'Not found.'}
        action={<Button variant="outline" onClick={() => navigate('/business/quotations')}>Back to quotations</Button>} />
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={quotation.quotation_number}
        subtitle={`${quotation.customer?.name ?? 'Walk-in customer'} · ${formatDate(quotation.issue_date)}`}
        icon="invoice"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => navigate('/business/quotations')}>Back</Button>
            <Button variant="outline" icon="file" onClick={() => void download()}>PDF</Button>
            <Button variant="outline" icon="share" loading={sharing} onClick={() => void share()}>Share</Button>
            <Button icon="invoice" onClick={() => void convert()}>Convert to invoice</Button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="sh-card-flat p-5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={quotation.status} />
            {quotation.kind === 'proforma' && <Badge tone="blue">Pro-forma invoice</Badge>}
            {quotation.converted_invoice_id && <Badge tone="green">Converted to invoice</Badge>}
          </div>
          <h3 className="mt-4 text-base font-extrabold text-ink-950">Line items</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-[11px] uppercase tracking-wide text-ink-500">
                  <th className="py-2 pr-3 font-semibold">Item</th>
                  <th className="py-2 pr-3 text-right font-semibold">Qty</th>
                  <th className="py-2 pr-3 text-right font-semibold">Price</th>
                  <th className="py-2 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {(quotation.items as unknown as QuotationItem[] | undefined)?.map((it, i) => (
                  <tr key={i} className="border-b border-ink-100">
                    <td className="py-2.5 pr-3 font-medium text-ink-800">{it.description}</td>
                    <td className="py-2.5 pr-3 text-right text-ink-600">{it.quantity} {it.unit}</td>
                    <td className="py-2.5 pr-3 text-right text-ink-600">{formatMoney(it.unit_price, quotation.currency)}</td>
                    <td className="py-2.5 text-right font-semibold text-ink-900">{formatMoney(it.line_total, quotation.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="mt-4 ml-auto max-w-xs space-y-1 text-sm">
            <div className="flex justify-between text-ink-600"><dt>Subtotal</dt><dd>{formatMoney(quotation.subtotal, quotation.currency)}</dd></div>
            {toNum(quotation.discount_total) > 0 && <div className="flex justify-between text-emerald-600"><dt>Discount</dt><dd>− {formatMoney(quotation.discount_total, quotation.currency)}</dd></div>}
            {toNum(quotation.tax_total) > 0 && <div className="flex justify-between text-ink-600"><dt>Tax</dt><dd>{formatMoney(quotation.tax_total, quotation.currency)}</dd></div>}
            {toNum(quotation.delivery_fee) > 0 && <div className="flex justify-between text-ink-600"><dt>Delivery</dt><dd>{formatMoney(quotation.delivery_fee, quotation.currency)}</dd></div>}
            <div className="flex justify-between border-t border-ink-200 pt-1.5 text-base font-extrabold text-ink-950"><dt>Total</dt><dd>{formatMoney(quotation.total, quotation.currency)}</dd></div>
          </dl>
          {quotation.notes && <p className="mt-4 rounded-xl bg-ink-50 p-3 text-xs text-ink-600">{quotation.notes}</p>}
        </div>

        <div className="sh-card-flat p-4">
          <p className="sh-field-label">Actions</p>
          <div className="mt-2 space-y-2">
            <Button block variant="outline" icon="file" onClick={() => void download()}>Download brand PDF</Button>
            <Button block variant="outline" icon="share" loading={sharing} onClick={() => void share()}>Copy share link</Button>
            <Button block icon="invoice" onClick={() => void convert()}>Convert to invoice</Button>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-500">
            The PDF includes a QR code your customer can scan to verify this is a genuine
            Seedwel Hub quotation. Free quotes carry the “Powered by Seedwel Hub” watermark.
          </p>
        </div>
      </div>
    </div>
  );
}
