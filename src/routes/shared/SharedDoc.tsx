import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { Badge, Button, Checkbox, EmptyState, Input, Notice, Skeleton, Textarea } from '@/components/ui/Primitives';
import { StatusBadge } from '@/components/ui';
import { BrandLockup } from '@/components/layout/Logo';
import { useAuth } from '@/context/AuthContext';
import { useToast, errorMessage } from '@/context/ToastContext';
import {
  getPaymentLink, getSharedDocument, payViaLink, respondToQuotation,
  type PaymentLinkPayload,
} from '@/lib/api';
import { formatMoney, toNum } from '@/lib/currency';
import { formatDate, formatDateTime } from '@/lib/dates';
import { buildInvoicePdf, buildQuotationPdf, buildReceiptPdf, savePdf } from '@/lib/pdf';
import { absoluteUrl, whatsappUrl } from '@/lib/share';
import { displayName } from '@/lib/format';
import { BRAND, PAYMENT_METHOD_ICONS, PAYMENT_METHOD_LABELS } from '@/lib/constants';
import type {
  BankDetails, Business, Invoice, InvoiceItem, Payment, PaymentMethod,
  Quotation, QuotationItem, Receipt,
} from '@/types';

/**
 * Public pages: shared documents, payment links and verification.
 *
 * These are the links a seller sends on WhatsApp or email, and they are opened
 * by people who usually have no account. The token or code in the URL is the
 * only credential: `get_shared_document` and `get_payment_link` are SECURITY
 * DEFINER functions that return exactly the fields a payer or customer should
 * see, and they record that the document was viewed (when, from where).
 * Row-level security means nothing else is reachable through these routes.
 *
 * Paying works the same way as everywhere else in Seedwel Hub — nothing is
 * marked as received until the business agrees. A public payer declares the
 * payment, the seller confirms it, and only then `record_payment` writes the
 * payment, updates the invoice and generates the receipt.
 */

type SharedKind = 'invoice' | 'quotation' | 'receipt';

interface SharedCustomer {
  name: string;
  email?: string | null;
  phone?: string | null;
  address_line1?: string | null;
  city?: string | null;
  tax_number?: string | null;
}

interface SharedPaymentRow {
  amount: number;
  method: PaymentMethod;
  received_at: string;
  reference?: string | null;
}

interface SharedPayload {
  found: boolean;
  kind?: string;
  invoice?: Invoice;
  quotation?: Quotation;
  receipt?: Receipt;
  items?: (InvoiceItem | QuotationItem)[];
  business?: Partial<Business>;
  customer?: SharedCustomer | null;
  payments?: SharedPaymentRow[];
  invoice_number?: string | null;
}

/* ── Small shared pieces ───────────────────────────────────────────────────── */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-ink-50 px-3 py-5 sm:px-4 sm:py-8">
      <div className="mx-auto w-full max-w-4xl space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <Link to="/"><BrandLockup /></Link>
          <Link to="/"><Button size="sm" variant="ghost" iconRight="chevronRight">Shop on {BRAND.domain}</Button></Link>
        </header>
        {children}
        <footer className="pt-2 text-center text-xs text-ink-500">
          <p className="font-bold text-ink-600">{BRAND.name} · {BRAND.tagline}</p>
          <p>{BRAND.companyLine}</p>
        </footer>
      </div>
    </div>
  );
}

function MetaRow({ label, value, tone }: { label: string; value?: string | null; tone?: 'green' | 'red' }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-3 py-1">
      <dt className="text-ink-500">{label}</dt>
      <dd className={`text-right font-semibold ${tone === 'green' ? 'text-emerald-700' : tone === 'red' ? 'text-red-600' : ''}`}>
        {value}
      </dd>
    </div>
  );
}

function DocHeader({ eyebrow, title, business, status, actions }: {
  eyebrow: string;
  title: string;
  business: Partial<Business>;
  status?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="sh-card-flat flex flex-wrap items-start gap-3 p-4">
      {business.logo_url
        ? <img src={business.logo_url} alt="" className="h-12 w-12 rounded-xl border border-ink-200 object-cover" />
        : <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-xl">🏪</span>}
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-widest text-ink-400">{eyebrow}</p>
        <h1 className="truncate font-mono text-xl font-extrabold">{title}</h1>
        <p className="mt-0.5 truncate text-sm font-semibold text-ink-700">
          {business.name ?? 'Seller'}{business.city ? ` · ${business.city}` : ''}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {status}
          {business.verification_status === 'verified' && <Badge tone="green" icon="shield">Verified business</Badge>}
        </div>
      </div>
      {actions && <div className="flex w-full flex-wrap gap-2 sm:w-auto">{actions}</div>}
    </div>
  );
}

function MoneyRow({ label, value, currency, strong, tone }: {
  label: string; value: number; currency: string; strong?: boolean; tone?: 'green' | 'red';
}) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? 'border-t border-ink-200 pt-1' : ''}`}>
      <dt className={strong ? 'font-extrabold' : 'text-ink-500'}>{label}</dt>
      <dd className={`sh-money ${strong ? 'font-extrabold' : 'font-semibold'} ${
        tone === 'green' ? 'text-emerald-700' : tone === 'red' ? 'text-red-600' : ''}`}>
        {formatMoney(value, currency)}
      </dd>
    </div>
  );
}

function BankBlock({ details }: { details?: BankDetails | null }) {
  const d = details ?? {};
  const money = [d.bank, d.account_number, ...(d.mobile_money ?? []).map((m) => m.number)].filter(Boolean);
  if (money.length === 0) return null;
  return (
    <div className="space-y-1.5 text-xs text-ink-700">
      {d.bank && <p><span className="font-bold">{d.bank}</span>{d.branch ? ` · ${d.branch}` : ''}</p>}
      {d.account_name && <p>{d.account_name}</p>}
      {d.account_number && <p className="font-mono text-sm font-bold">{d.account_number}</p>}
      {d.swift && <p>SWIFT {d.swift}</p>}
      {(d.mobile_money ?? []).map((m) => (
        <p key={`${m.provider}-${m.number}`} className="flex items-center gap-1.5">
          <Badge tone="green">{m.provider}</Badge>
          <span className="font-mono text-sm font-bold">{m.number}</span>
          {m.name && <span className="text-ink-500">· {m.name}</span>}
        </p>
      ))}
    </div>
  );
}

/** Turns the trimmed payment rows returned by a share token into full Payments for the PDF builder. */
function toPayments(rows: SharedPaymentRow[], invoice: Invoice): Payment[] {
  return rows.map((p, i) => ({
    id: `shared-${i}`, business_id: invoice.business_id, invoice_id: invoice.id,
    order_id: null, quotation_id: null, customer_id: invoice.customer_id, supplier_id: null,
    direction: 'inbound', payment_number: p.reference ?? null, method: p.method, provider: null,
    provider_reference: p.reference ?? null, status: 'completed', currency: invoice.currency,
    amount: toNum(p.amount), amount_base: toNum(p.amount), fee_amount: 0,
    payer_name: null, payer_phone: null, payer_email: null, received_at: p.received_at,
    notes: null, recorded_by: null, recorded_by_name: null, receipt_id: null,
    is_online: false, payment_link_id: null, refunded_amount: 0,
  } as Payment));
}

/* ── /d/:kind/:token ───────────────────────────────────────────────────────── */

export function SharedDocumentPage() {
  const { kind, token } = useParams<{ kind: string; token: string }>();
  const type: SharedKind = kind === 'receipt' || kind === 'quotation' ? kind : 'invoice';
  const [data, setData] = useState<SharedPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      setData(null);
      try {
        const res = await getSharedDocument(type, token);
        if (!alive) return;
        const payload = res as unknown as SharedPayload;
        if (!payload?.found) {
          setError('This link is not valid any more. Ask the business to send it again.');
        } else {
          setData(payload);
        }
      } catch (e) {
        if (alive) setError(errorMessage(e, 'Could not open this document.'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [token, type]);

  if (loading) {
    return (
      <Shell>
        <Skeleton className="h-20 w-full rounded-2xl" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </Shell>
    );
  }

  if (error || !data) {
    return (
      <Shell>
        <EmptyState
          icon="lock"
          title="Document not available"
          description={error ?? 'We could not load this document.'}
          action={<Link to="/"><Button size="sm">Go to {BRAND.domain}</Button></Link>}
        />
      </Shell>
    );
  }

  if (type === 'receipt' || data.receipt) return <ReceiptView data={data} />;
  if (type === 'quotation' || data.quotation) return <QuotationView data={data} token={token!} />;
  return <InvoiceView data={data} />;
}

/* ── Invoice / credit note / debit note ────────────────────────────────────── */

function InvoiceView({ data }: { data: SharedPayload }) {
  const inv = data.invoice!;
  const items = (data.items ?? []) as InvoiceItem[];
  const business = data.business ?? {};
  const currency = inv.currency;
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const title = inv.kind === 'credit_note' ? 'Credit note'
    : inv.kind === 'debit_note' ? 'Debit note'
      : inv.kind === 'proforma' ? 'Pro-forma invoice' : 'Invoice';

  const download = async () => {
    setBusy(true);
    try {
      const pdf = await buildInvoicePdf({
        invoice: inv,
        business: business as Business,
        items,
        payments: toPayments(data.payments ?? [], inv),
        origin: absoluteUrl(''),
      });
      savePdf(pdf, `${inv.invoice_number}.pdf`);
    } catch (e) {
      toast.error('Could not build the PDF', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const paid = toNum(inv.amount_paid) + toNum(inv.amount_credited);

  return (
    <Shell>
      <DocHeader
        eyebrow={title}
        title={inv.invoice_number}
        business={business}
        status={<StatusBadge status={inv.status} />}
        actions={
          <>
            <Button size="sm" variant="outline" icon="download" loading={busy} onClick={() => void download()}>
              PDF
            </Button>
            {toNum(inv.balance_due) > 0 && inv.status !== 'void' && (
              <Link to={`/store/${business.slug ?? ''}`} className="contents">
                <Button size="sm" icon="store">Visit store</Button>
              </Link>
            )}
          </>
        }
      />

      {inv.status === 'void' && (
        <Notice tone="danger" title="This document was voided" icon="warning">
          {inv.void_reason ?? 'No reason was recorded.'}{inv.voided_at ? ` · ${formatDate(inv.voided_at)}` : ''}
        </Notice>
      )}
      {toNum(inv.balance_due) > 0 && inv.due_date && new Date(inv.due_date) < new Date() && inv.status !== 'void' && (
        <Notice tone="warning" title="This invoice is past its due date" icon="clock">
          It was due on {formatDate(inv.due_date)}. Please settle {formatMoney(inv.balance_due, currency)} or contact
          {business.phone ? ` ${business.name ?? 'the seller'} on ${business.phone}` : ' the seller'}.
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="sh-card-flat overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-ink-100 px-4 py-3">
            <h2 className="text-sm font-extrabold">Items</h2>
            <span className="text-xs text-ink-500">{items.length} line{items.length === 1 ? '' : 's'}</span>
          </div>
          <ul className="divide-y divide-ink-100">
            {items.map((it) => (
              <li key={it.id} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-bold">{it.description}</p>
                  <p className="text-[11px] text-ink-500">
                    {toNum(it.quantity)} {it.unit} × {formatMoney(it.unit_price, currency)}
                    {toNum(it.discount_amount) > 0 ? ` · discount ${formatMoney(it.discount_amount, currency)}` : ''}
                    {toNum(it.tax_amount) > 0 ? ` · tax ${formatMoney(it.tax_amount, currency)}` : ''}
                  </p>
                  {it.notes && <p className="mt-0.5 text-[11px] italic text-ink-500">{it.notes}</p>}
                </div>
                <p className="sh-money shrink-0 text-sm font-extrabold">{formatMoney(it.line_total, currency)}</p>
              </li>
            ))}
          </ul>
          <div className="border-t border-ink-100 bg-ink-50/60 p-4">
            <dl className="ml-auto max-w-xs space-y-1 text-sm">
              <MoneyRow label="Subtotal" value={toNum(inv.subtotal)} currency={currency} />
              {toNum(inv.discount_total) > 0 && (
                <MoneyRow label="Discount" value={-toNum(inv.discount_total)} currency={currency} tone="green" />
              )}
              {toNum(inv.tax_total) > 0 && <MoneyRow label="Tax" value={toNum(inv.tax_total)} currency={currency} />}
              {toNum(inv.delivery_fee) > 0 && (
                <MoneyRow label="Delivery" value={toNum(inv.delivery_fee)} currency={currency} />
              )}
              <MoneyRow label="Total" value={toNum(inv.total)} currency={currency} strong />
              {paid > 0 && <MoneyRow label="Paid" value={-paid} currency={currency} tone="green" />}
              {toNum(inv.balance_due) > 0 && (
                <MoneyRow label="Balance due" value={toNum(inv.balance_due)} currency={currency} strong tone="red" />
              )}
            </dl>
          </div>
        </div>

        <aside className="space-y-3">
          <div className="sh-card-flat p-3">
            <p className="sh-label">Details</p>
            <dl className="mt-1 divide-y divide-ink-100 text-sm">
              <MetaRow label="Issued" value={formatDate(inv.issue_date)} />
              {inv.due_date && <MetaRow label="Due" value={formatDate(inv.due_date)} />}
              {inv.terms_days ? <MetaRow label="Terms" value={`${inv.terms_days} days`} /> : null}
              {inv.reference && <MetaRow label="Reference" value={inv.reference} />}
              {inv.paid_at && <MetaRow label="Paid on" value={formatDate(inv.paid_at)} tone="green" />}
              <MetaRow label="Opened" value={inv.viewed_count > 0 ? `${inv.viewed_count}×` : 'first time'} />
            </dl>
          </div>

          {data.customer && (
            <div className="sh-card-flat p-3">
              <p className="sh-label">{inv.kind === 'credit_note' ? 'Credited to' : 'Bill to'}</p>
              <p className="mt-1 text-sm font-bold">{data.customer.name}</p>
              <p className="mt-0.5 text-xs text-ink-600">
                {[data.customer.address_line1, data.customer.city, data.customer.phone, data.customer.email]
                  .filter(Boolean).join(' · ')}
              </p>
              {data.customer.tax_number && (
                <p className="mt-1 text-xs text-ink-500">Tax no. {data.customer.tax_number}</p>
              )}
            </div>
          )}

          {(data.payments?.length ?? 0) > 0 && (
            <div className="sh-card-flat p-3">
              <p className="sh-label">Payments</p>
              <ul className="mt-1 space-y-1.5">
                {data.payments!.map((p, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-ink-600">
                      {formatDate(p.received_at)} · {PAYMENT_METHOD_LABELS[p.method] ?? p.method}
                    </span>
                    <span className="sh-money font-bold">{formatMoney(p.amount, currency)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {business.bank_details && (
            <div className="sh-card-flat p-3">
              <p className="sh-label">How to pay</p>
              <div className="mt-1"><BankBlock details={business.bank_details} /></div>
            </div>
          )}

          {inv.terms && (
            <div className="sh-card-flat p-3">
              <p className="sh-label">Terms</p>
              <p className="mt-1 whitespace-pre-line text-xs text-ink-600">{inv.terms}</p>
            </div>
          )}
          {inv.notes && (
            <div className="sh-card-flat p-3">
              <p className="sh-label">Notes</p>
              <p className="mt-1 whitespace-pre-line text-xs text-ink-600">{inv.notes}</p>
            </div>
          )}

          {business.phone && (
            <a href={whatsappUrl(business.phone, `Hello ${business.name ?? ''}, about ${inv.invoice_number}…`)}
              target="_blank" rel="noreferrer">
              <Button block size="sm" variant="outline" icon="whatsapp">Message the seller</Button>
            </a>
          )}
        </aside>
      </div>
    </Shell>
  );
}

/* ── Quotation / pro-forma ─────────────────────────────────────────────────── */

function QuotationView({ data, token }: { data: SharedPayload; token: string }) {
  const q = data.quotation!;
  const items = (data.items ?? []) as QuotationItem[];
  const business = data.business ?? {};
  const currency = q.currency;
  const toast = useToast();
  const { user, profile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [responding, setResponding] = useState<'accepted' | 'rejected' | 'change_requested' | null>(null);
  const [signerName, setSignerName] = useState('');
  const [note, setNote] = useState('');
  const [agreed, setAgreed] = useState(false);
  /** Locally recorded answer, so the page updates without refetching the token. */
  const [response, setResponse] = useState<{
    kind: 'accepted' | 'rejected' | 'change_requested'; name: string; note?: string; at: string;
  } | null>(null);

  useEffect(() => {
    if (user) setSignerName(displayName(profile));
  }, [user, profile]);

  const title = q.kind === 'proforma' ? 'Pro-forma invoice' : 'Quotation';
  const expired = q.valid_until ? new Date(q.valid_until) < new Date() : false;
  const answered = Boolean(response) || Boolean(q.responded_at)
    || ['accepted', 'rejected', 'change_requested', 'signed'].includes(q.status);

  const download = async () => {
    setBusy(true);
    try {
      const pdf = await buildQuotationPdf({
        quotation: q, business: business as Business, items, origin: absoluteUrl(''),
      });
      savePdf(pdf, `${q.quotation_number}.pdf`);
    } catch (e) {
      toast.error('Could not build the PDF', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!responding) return;
    if (!signerName.trim()) {
      toast.warning('Add your name', 'Your response is signed, so we need to know who you are.');
      return;
    }
    if (!agreed) {
      toast.warning('Confirm the signature', 'Tick the box to sign this response.');
      return;
    }
    setBusy(true);
    try {
      await respondToQuotation({
        shareToken: token,
        response: responding,
        signerName: signerName.trim(),
        note: note.trim() || undefined,
      });
      toast.success(
        responding === 'accepted' ? 'Accepted — thank you' : 'Response sent',
        `${business.name ?? 'The seller'} has been notified${responding === 'accepted' ? ' and will follow up with an invoice or an order' : ''}.`,
      );
      setResponding(null);
      setResponse({ kind: responding, name: signerName.trim(), note: note.trim() || undefined, at: new Date().toISOString() });
    } catch (e) {
      toast.error('Could not send your response', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <DocHeader
        eyebrow={title}
        title={q.quotation_number}
        business={business}
        status={<StatusBadge status={q.status} />}
        actions={<Button size="sm" variant="outline" icon="download" loading={busy} onClick={() => void download()}>PDF</Button>}
      />

      {answered && (
        <Notice
          tone={response?.kind === 'accepted' || q.status === 'accepted' || q.status === 'signed' ? 'success' : 'info'}
          title={response
            ? `You ${response.kind === 'accepted' ? 'accepted' : response.kind === 'rejected' ? 'declined' : 'asked for changes'} this quotation`
            : q.responded_at || q.signed_at
              ? `You responded on ${formatDate(q.responded_at ?? q.signed_at)}`
              : 'You have already responded'}
          icon="signature">
          {response
            ? `${business.name ?? 'The seller'} was notified on ${formatDateTime(response.at)} and signed as ${response.name}.`
            : <>
                {q.signer_name ? `Signed by ${q.signer_name}. ` : ''}
                {q.response_note ? `Your note: “${q.response_note}”. ` : ''}
              </>}
          {' '}Contact {business.name ?? 'the seller'} if you need to change it.
        </Notice>
      )}
      {!answered && expired && (
        <Notice tone="warning" title="This quotation has expired" icon="clock">
          It was valid until {formatDate(q.valid_until)}. Ask {business.name ?? 'the seller'} to reissue it.
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="sh-card-flat overflow-hidden">
          {q.title && (
            <div className="border-b border-ink-100 px-4 py-3">
              <h2 className="text-sm font-extrabold">{q.title}</h2>
            </div>
          )}
          <ul className="divide-y divide-ink-100">
            {items.map((it) => (
              <li key={it.id} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-bold">
                    {it.description}
                    {it.is_optional && <Badge tone="neutral" className="ml-1.5">optional</Badge>}
                  </p>
                  <p className="text-[11px] text-ink-500">
                    {toNum(it.quantity)} {it.unit} × {formatMoney(it.unit_price, currency)}
                    {toNum(it.tax_amount) > 0 ? ` · tax ${formatMoney(it.tax_amount, currency)}` : ''}
                  </p>
                  {it.notes && <p className="mt-0.5 text-[11px] italic text-ink-500">{it.notes}</p>}
                </div>
                <p className="sh-money shrink-0 text-sm font-extrabold">{formatMoney(it.line_total, currency)}</p>
              </li>
            ))}
          </ul>
          <div className="border-t border-ink-100 bg-ink-50/60 p-4">
            <dl className="ml-auto max-w-xs space-y-1 text-sm">
              <MoneyRow label="Subtotal" value={toNum(q.subtotal)} currency={currency} />
              {toNum(q.discount_total) > 0 && (
                <MoneyRow label="Discount" value={-toNum(q.discount_total)} currency={currency} tone="green" />
              )}
              {toNum(q.tax_total) > 0 && <MoneyRow label="Tax" value={toNum(q.tax_total)} currency={currency} />}
              {toNum(q.delivery_fee) > 0 && <MoneyRow label="Delivery" value={toNum(q.delivery_fee)} currency={currency} />}
              <MoneyRow label="Total" value={toNum(q.total)} currency={currency} strong />
            </dl>
          </div>
        </div>

        <aside className="space-y-3">
          <div className="sh-card-flat p-3">
            <p className="sh-label">Details</p>
            <dl className="mt-1 divide-y divide-ink-100 text-sm">
              <MetaRow label="Quoted on" value={formatDate(q.issue_date)} />
              <MetaRow label="Valid until" value={q.valid_until ? formatDate(q.valid_until) : `${q.validity_days} days`} />
              {q.delivery_method && <MetaRow label="Delivery" value={q.delivery_method} />}
              <MetaRow label="Opened" value={q.viewed_at ? formatDateTime(q.viewed_at) : 'first time'} />
            </dl>
          </div>

          {data.customer && (
            <div className="sh-card-flat p-3">
              <p className="sh-label">Prepared for</p>
              <p className="mt-1 text-sm font-bold">{data.customer.name}</p>
              <p className="mt-0.5 text-xs text-ink-600">
                {[data.customer.address_line1, data.customer.city, data.customer.phone].filter(Boolean).join(' · ')}
              </p>
            </div>
          )}

          {q.shipping_address && (
            <div className="sh-card-flat p-3">
              <p className="sh-label">Deliver to</p>
              <p className="mt-1 whitespace-pre-line text-xs text-ink-600">{q.shipping_address}</p>
            </div>
          )}
          {q.terms && (
            <div className="sh-card-flat p-3">
              <p className="sh-label">Terms</p>
              <p className="mt-1 whitespace-pre-line text-xs text-ink-600">{q.terms}</p>
            </div>
          )}
          {q.notes && (
            <div className="sh-card-flat p-3">
              <p className="sh-label">Notes</p>
              <p className="mt-1 whitespace-pre-line text-xs text-ink-600">{q.notes}</p>
            </div>
          )}
        </aside>
      </div>

      {!answered && !expired && (
        <div className="sh-card-flat p-4">
          <h2 className="text-base font-extrabold">Respond to this quotation</h2>
          <p className="mt-1 text-sm text-ink-600">
            Your answer is signed with your name and time-stamped, and {business.name ?? 'the seller'} sees it
            immediately. Accepting does not charge you anything.
          </p>

          {responding === null ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button icon="check" onClick={() => setResponding('accepted')}>Accept</Button>
              <Button variant="outline" icon="edit" onClick={() => setResponding('change_requested')}>
                Request changes
              </Button>
              <Button variant="ghost" icon="close" onClick={() => setResponding('rejected')}>Decline</Button>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <Notice tone={responding === 'accepted' ? 'success' : responding === 'rejected' ? 'danger' : 'info'}
                title={responding === 'accepted' ? 'Accepting this quotation'
                  : responding === 'rejected' ? 'Declining this quotation' : 'Requesting changes'}>
                {responding === 'accepted'
                  ? `${business.name ?? 'The seller'} will follow up with an invoice or start your order.`
                  : responding === 'rejected'
                    ? 'The seller will be told you declined. Nothing is charged.'
                    : 'Tell the seller what to change — quantities, prices, delivery or terms.'}
              </Notice>
              <Input label="Your name" required value={signerName} onChange={(e) => setSignerName(e.target.value)}
                placeholder="The name this should be signed with" />
              <Textarea label={responding === 'change_requested' ? 'What should change?' : 'Note (optional)'}
                value={note} onChange={(e) => setNote(e.target.value)} rows={3}
                placeholder={responding === 'change_requested' ? 'e.g. please reduce the delivery fee or extend validity' : 'Anything the seller should know'} />
              <Checkbox checked={agreed} onChange={(v) => setAgreed(v)}
                label={`I am ${signerName.trim() || '…'} and I authorise this response on behalf of ${data.customer?.name ?? 'myself'}.`} />
              <div className="flex flex-wrap gap-2">
                <Button icon="signature" loading={busy} onClick={() => void send()}>
                  Sign and send
                </Button>
                <Button variant="ghost" onClick={() => { setResponding(null); setNote(''); setAgreed(false); }}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Shell>
  );
}

/* ── Receipt ───────────────────────────────────────────────────────────────── */

function ReceiptView({ data }: { data: SharedPayload }) {
  const r = data.receipt!;
  const business = data.business ?? {};
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const download = async () => {
    setBusy(true);
    try {
      const pdf = await buildReceiptPdf({
        receipt: r, business: business as Business, invoiceNumber: data.invoice_number ?? null, origin: absoluteUrl(''),
      });
      savePdf(pdf, `${r.receipt_number}.pdf`);
    } catch (e) {
      toast.error('Could not build the PDF', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <DocHeader
        eyebrow="Receipt"
        title={r.receipt_number}
        business={business}
        status={<StatusBadge status="paid" />}
        actions={<Button size="sm" variant="outline" icon="download" loading={busy} onClick={() => void download()}>PDF</Button>}
      />

      <div className="sh-card-flat p-4">
        <p className="sh-label">Amount paid</p>
        <p className="sh-money text-3xl font-extrabold text-emerald-700">{formatMoney(r.amount, r.currency)}</p>

        <dl className="mt-3 divide-y divide-ink-100 text-sm">
          <MetaRow label="Received" value={formatDateTime(r.received_at)} />
          <MetaRow label="Method" value={PAYMENT_METHOD_LABELS[r.method] ?? r.method} />
          <MetaRow label="Customer" value={r.customer_name ?? 'Walk-in customer'} />
          <MetaRow label="Invoice" value={data.invoice_number} />
          {toNum(r.balance_after) > 0 && (
            <MetaRow label="Balance still due" value={formatMoney(r.balance_after, r.currency)} tone="red" />
          )}
          {r.signed_by_name && <MetaRow label="Received by" value={r.signed_by_name} />}
          {r.notes && <MetaRow label="Notes" value={r.notes} />}
        </dl>

        <div className="mt-4">
          <Notice tone="success" title="This receipt is genuine" icon="shield">
            It was issued by {business.name ?? 'the seller'} through {BRAND.name}. Anyone can check it at the
            verification link on the printed copy.
          </Notice>
        </div>
      </div>
    </Shell>
  );
}

/* ── /pay/:code ────────────────────────────────────────────────────────────── */

export function PayPage() {
  const { code } = useParams<{ code: string }>();
  const [link, setLink] = useState<PaymentLinkPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ amount: number; currency: string; message?: string } | null>(null);

  const methods = useMemo<PaymentMethod[]>(() => {
    const list = (link?.methods ?? ['mobile_money', 'bank_transfer', 'cash', 'card']) as PaymentMethod[];
    return list.length > 0 ? list : ['mobile_money'];
  }, [link]);

  const [method, setMethod] = useState<PaymentMethod>('mobile_money');
  const [provider, setProvider] = useState('');
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    if (!code) return;
    let alive = true;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await getPaymentLink(code);
        if (!alive) return;
        if (!res.found) {
          setLoadError(res.message ?? 'This payment link is not valid or has expired.');
          return;
        }
        setLink(res);
        const first = ((res.methods?.[0] as PaymentMethod) ?? 'mobile_money');
        setMethod(first);
        setAmount(String(res.balance ?? res.amount ?? 0));
      } catch (e) {
        if (alive) setLoadError(errorMessage(e, 'Could not open this payment link.'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [code]);

  useEffect(() => { setMethod(methods[0]); }, [methods]);

  const payAmount = link?.allow_custom_amount
    ? Number(amount) || 0
    : toNum(link?.balance ?? link?.amount ?? 0);

  const submit = async () => {
    if (!link) return;
    setSubmitError(null);
    if (link.allow_custom_amount && payAmount <= 0) {
      setSubmitError('Enter the amount you paid.');
      return;
    }
    if (method === 'mobile_money' && !phone.trim()) {
      setSubmitError('Add the phone number you paid from so the seller can match it.');
      return;
    }
    setBusy(true);
    try {
      const res = await payViaLink({
        code: code!,
        method,
        provider: method === 'mobile_money' ? provider.trim() || undefined : undefined,
        reference: reference.trim() || undefined,
        amount: link.allow_custom_amount ? payAmount : undefined,
        payer_name: name.trim() || undefined,
        payer_phone: phone.trim() || undefined,
      });
      if (res.duplicate) {
        setSubmitError(res.message ?? 'You have already told us about a payment on this link.');
        return;
      }
      if (!res.ok) throw new Error('The payment could not be recorded.');
      setDone({
        amount: toNum(res.amount ?? payAmount),
        currency: res.currency ?? link.currency ?? 'ZMW',
        message: res.message ?? undefined,
      });
      setLink({ ...link, submissions: (link.submissions ?? 0) + 1 });
    } catch (e) {
      setSubmitError(errorMessage(e, 'The payment could not be recorded.'));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Shell><Skeleton className="h-20 w-full rounded-2xl" /><Skeleton className="mt-4 h-96 w-full rounded-2xl" /></Shell>;

  if (loadError || !link) {
    return (
      <Shell>
        <EmptyState
          icon="lock"
          title="Payment link not available"
          description={loadError ?? 'We could not open this link.'}
          action={<Link to="/"><Button size="sm">Go to {BRAND.domain}</Button></Link>}
        />
      </Shell>
    );
  }

  const business = link.business;
  const currency = link.currency ?? 'ZMW';
  const settled = link.status === 'paid';

  return (
    <Shell>
      <DocHeader
        eyebrow="Payment request"
        title={link.label ?? link.invoice_number ?? 'Payment'}
        business={(business ?? {}) as Partial<Business>}
        status={<Badge tone={settled ? 'green' : 'amber'}>{settled ? 'Paid' : 'Awaiting payment'}</Badge>}
      />

      {done ? (
        <div className="sh-card-flat p-6 text-center">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
            <Icon name="success" size={32} />
          </span>
          <h1 className="mt-4 text-xl font-extrabold">Thank you — the seller has been told</h1>
          <p className="mt-1 text-sm text-ink-600">
            {done.message ?? `${business?.name ?? 'The seller'} will confirm your ${formatMoney(done.amount, done.currency)} payment and send you a receipt.`}
          </p>
          <div className="mx-auto mt-4 max-w-sm rounded-2xl bg-ink-50 p-3 text-left text-sm">
            <dl className="divide-y divide-ink-200">
              <MetaRow label="Amount" value={formatMoney(done.amount, done.currency)} />
              <MetaRow label="Method" value={PAYMENT_METHOD_LABELS[method] ?? method} />
              {reference && <MetaRow label="Reference" value={reference} />}
              <MetaRow label="Sent" value={formatDateTime(new Date().toISOString())} />
            </dl>
          </div>
          <p className="mx-auto mt-4 max-w-md text-xs text-ink-500">
            Money is only marked as received once {business?.name ?? 'the seller'} confirms it. That protects both of
            you: you will get a numbered receipt, and they will not mark an invoice paid before the money arrives.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {link.redirect_url
              ? <a href={link.redirect_url}><Button size="sm">Continue</Button></a>
              : <Link to="/"><Button size="sm">Shop on {BRAND.domain}</Button></Link>}
            {business?.slug && (
              <Link to={`/store/${business.slug}`}>
                <Button size="sm" variant="outline" icon="store">Visit {business.name}</Button>
              </Link>
            )}
          </div>
        </div>
      ) : settled ? (
        <Notice tone="success" title="This link has already been paid" icon="check">
          Nothing more is owed{link.amount_collected ? ` — ${formatMoney(link.amount_collected, currency)} collected` : ''}.
          Contact {business?.name ?? 'the seller'} if you believe this is wrong.
        </Notice>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="sh-card-flat space-y-3 p-4">
            {link.description && <p className="text-sm text-ink-700">{link.description}</p>}

            <div className="rounded-2xl bg-brand-50 p-4 text-center">
              <p className="sh-label text-brand-800">{toNum(link.amount_collected ?? 0) > 0 ? 'Balance' : 'Amount'}</p>
              <p className="sh-money text-3xl font-extrabold text-brand-900">
                {formatMoney(link.balance ?? link.amount ?? 0, currency)}
              </p>
              {link.invoice_number && <p className="mt-1 text-xs font-semibold text-brand-800">Invoice {link.invoice_number}</p>}
              {link.order_number && <p className="text-xs font-semibold text-brand-800">Order {link.order_number}</p>}
            </div>

            {link.message && (
              <p className="rounded-xl bg-ink-50 p-3 text-sm italic text-ink-600">“{link.message}”</p>
            )}

            {submitError && <Notice tone="danger" title="Could not send that">{submitError}</Notice>}
            {(link.submissions ?? 0) > 0 && (
              <Notice tone="info" title="Already waiting for confirmation" icon="clock">
                {link.submissions} payment declaration{link.submissions === 1 ? '' : 's'} on this link
                {link.submissions === 1 ? 'has' : 'have'} not been confirmed by the seller yet. Do not pay twice.
              </Notice>
            )}

            <div>
              <p className="sh-field-label">How are you paying?</p>
              <div className="mt-1 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {methods.map((m) => (
                  <button key={m} type="button" onClick={() => setMethod(m)}
                    className={`rounded-xl border p-2.5 text-left text-xs font-bold transition ${
                      method === m ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-ink-200 text-ink-600 hover:border-ink-300'}`}>
                    <span className="text-base">{PAYMENT_METHOD_ICONS[m] ?? '💳'}</span>
                    <span className="mt-0.5 block leading-tight">{PAYMENT_METHOD_LABELS[m] ?? m}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Your name" value={name} onChange={(e) => setName(e.target.value)}
                placeholder={link.customer_name ?? 'Who is paying'} />
              <Input label="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)}
                placeholder="+260 97 1234567"
                hint={method === 'mobile_money' ? 'Needed so the seller can match the transaction' : undefined} />
              {method === 'mobile_money' && (
                <Input label="Provider" value={provider} onChange={(e) => setProvider(e.target.value)}
                  placeholder="MTN, Airtel, Zamtel…" />
              )}
              <Input label="Transaction reference" value={reference} onChange={(e) => setReference(e.target.value)}
                placeholder="e.g. MP240912.1234.A12345"
                hint="Copy this from the payment confirmation SMS" />
              {link.allow_custom_amount && (
                <Input label={`Amount paid (${currency})`} type="number" min={toNum(link.min_amount ?? 0)}
                  max={link.max_amount ?? undefined} step="0.01" value={amount}
                  onChange={(e) => setAmount(e.target.value)} />
              )}
            </div>

            <Button block size="lg" icon="check" loading={busy} onClick={() => void submit()}>
              I have paid {formatMoney(payAmount, currency)}
            </Button>

            <p className="text-[11px] text-ink-500">
              This tells {business?.name ?? 'the seller'} that you have paid. When they see the money they confirm it,
              which writes the payment to your invoice and generates your receipt.
            </p>
          </div>

          <aside className="space-y-3">
            <div className="sh-card-flat p-3">
              <p className="sh-label">Paying</p>
              <p className="mt-1 text-sm font-bold">{business?.name ?? 'Seller'}</p>
              <p className="text-xs text-ink-600">
                {[business?.address_line1, business?.city, business?.phone, business?.email].filter(Boolean).join(' · ')}
              </p>
              {business?.verification_status === 'verified' && (
                <p className="mt-1.5"><Badge tone="green" icon="shield">Verified business</Badge></p>
              )}
              {business?.slug && (
                <Link className="mt-2 block" to={`/store/${business.slug}`}>
                  <Button block size="sm" variant="outline" iconRight="chevronRight">See their store</Button>
                </Link>
              )}
            </div>

            {business?.bank_details && (
              <div className="sh-card-flat p-3">
                <p className="sh-label">Where the money goes</p>
                <div className="mt-1"><BankBlock details={business.bank_details} /></div>
              </div>
            )}

            {link.expires_at && (
              <div className="sh-card-flat p-3">
                <p className="sh-label">Link expires</p>
                <p className="mt-1 text-sm font-bold">{formatDate(link.expires_at)}</p>
              </div>
            )}
            {link.customer_name && (
              <div className="sh-card-flat p-3">
                <p className="sh-label">Billed to</p>
                <p className="mt-1 text-sm font-bold">{link.customer_name}</p>
              </div>
            )}
          </aside>
        </div>
      )}
    </Shell>
  );
}

/* ── /verify/:kind/:token ──────────────────────────────────────────────────── */

export function VerifyPage() {
  const { kind, token } = useParams<{ kind: string; token: string }>();
  const type: SharedKind = kind === 'receipt' || kind === 'quotation' ? kind : 'invoice';
  const [state, setState] = useState<'loading' | 'valid' | 'invalid'>('loading');
  const [detail, setDetail] = useState<{
    number?: string; business?: string; total?: number; currency?: string; date?: string; status?: string;
  } | null>(null);

  useEffect(() => {
    if (!token) return;
    let alive = true;
    (async () => {
      try {
        const res = await getSharedDocument(type, token) as unknown as SharedPayload;
        if (!alive) return;
        if (!res?.found) { setState('invalid'); return; }
        if (res.receipt) {
          setDetail({
            number: res.receipt.receipt_number,
            business: res.business?.name,
            total: toNum(res.receipt.amount),
            currency: res.receipt.currency,
            date: res.receipt.received_at,
            status: 'paid',
          });
        } else if (res.invoice) {
          setDetail({
            number: res.invoice.invoice_number,
            business: res.business?.name,
            total: toNum(res.invoice.total),
            currency: res.invoice.currency,
            date: res.invoice.issue_date,
            status: res.invoice.status,
          });
        } else if (res.quotation) {
          setDetail({
            number: res.quotation.quotation_number,
            business: res.business?.name,
            total: toNum(res.quotation.total),
            currency: res.quotation.currency,
            date: res.quotation.issue_date,
            status: res.quotation.status,
          });
        }
        setState('valid');
      } catch {
        if (alive) setState('invalid');
      }
    })();
    return () => { alive = false; };
  }, [token, type]);

  return (
    <Shell>
      <div className="sh-card-flat p-6 text-center">
        {state === 'loading' && <Skeleton className="mx-auto h-24 w-24 rounded-2xl" />}

        {state === 'valid' && (
          <>
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
              <Icon name="shield" size={32} />
            </span>
            <h1 className="mt-4 text-xl font-extrabold">This document is genuine</h1>
            <p className="mt-1 text-sm text-ink-600">
              It was issued through {BRAND.name} and matches our records.
            </p>
            {detail && (
              <dl className="mx-auto mt-4 max-w-sm divide-y divide-ink-100 text-left text-sm">
                <MetaRow label="Document" value={detail.number} />
                <MetaRow label="Issued by" value={detail.business} />
                <MetaRow label="Date" value={detail.date ? formatDate(detail.date) : undefined} />
                <MetaRow label="Amount" value={detail.total !== undefined ? formatMoney(detail.total, detail.currency) : undefined} />
                <div className="flex justify-between gap-3 py-1">
                  <dt className="text-ink-500">Status</dt>
                  <dd><StatusBadge status={detail.status} /></dd>
                </div>
              </dl>
            )}
            <Link to={`/d/${type}/${token ?? ''}`}>
              <Button className="mt-5" size="sm" variant="outline" icon="eye">Open the document</Button>
            </Link>
          </>
        )}

        {state === 'invalid' && (
          <>
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 text-red-600">
              <Icon name="warning" size={32} />
            </span>
            <h1 className="mt-4 text-xl font-extrabold">We could not verify this document</h1>
            <p className="mx-auto mt-1 max-w-md text-sm text-ink-600">
              The code does not match any document, or it was replaced by a newer one. Ask the business to send it
              again — and do not pay against a document that will not verify.
            </p>
          </>
        )}

        <Link to="/"><Button className="mt-5" size="sm">Go to {BRAND.domain}</Button></Link>
      </div>
    </Shell>
  );
}
