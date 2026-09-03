import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import {
  Badge, Button, EmptyState, Input, Modal, Notice, Select, Skeleton, Switch,
} from '@/components/ui/Primitives';
import { MoneyInput, QuantityStepper, StatusBadge } from '@/components/ui';
import { useAuth } from '@/context/AuthContext';
import { useBusiness } from '@/context/BusinessContext';
import { useToast } from '@/context/ToastContext';
import { useCategories } from '@/hooks/useCategories';
import { useDebounce } from '@/hooks/useUi';
import { db } from '@/lib/db';
import { createOrder, recordPayment, upsertCustomer, type OrderLineInput } from '@/lib/api';
import { formatMoney, toNum } from '@/lib/currency';
import { computeTotals, changeDue, priceForQuantity } from '@/lib/calc';
import { buildPosReceiptPdf, printPdf, savePdf } from '@/lib/pdf';
import { absoluteUrl, whatsappUrl } from '@/lib/share';
import { MOBILE_MONEY_PROVIDERS, PAYMENT_METHOD_LABELS } from '@/lib/constants';
import type { Customer, Order, OrderItem, Product, UUID } from '@/types';

/**
 * Point of sale.
 *
 * The counter flow: scan (or search) → adjust → take payment → receipt.
 * Everything goes through the same `create_order` and `record_payment` RPCs as
 * the online store, so a counter sale is a real order with real stock movement,
 * a real receipt number and a real customer record — never a separate till.
 *
 * Keyboard: a barcode scanner types the code and presses Enter; F2 pays,
 * F4 clears the sale, F9 opens the customer display.
 */

interface PosLine {
  key: string;
  product_id: UUID | null;
  variant_id: UUID | null;
  name: string;
  sku: string | null;
  image_url: string | null;
  unit: string;
  quantity: number;
  unit_price: number;
  cost_price: number;
  tax_rate: number;
  discount_percent: number;
  discount_amount: number;
  stock: number;
  track_inventory: boolean;
  is_wholesale: boolean;
  wholesale_price: number;
  wholesale_min_qty: number;
  notes?: string;
}

interface Tender {
  method: string;
  amount: number;
  provider?: string;
  reference?: string;
}

interface CompletedSale {
  orderId: UUID;
  orderNumber: string;
  receiptNumber: string | null;
  receiptId: UUID | null;
  total: number;
  currency: string;
  change: number;
  tendered: number;
  customerName: string;
  customerPhone: string | null;
  itemCount: number;
  at: string;
  order: Order | null;
  items: OrderItem[];
  tenders: Tender[];
}

const lineKey = (productId: UUID | null, variantId: UUID | null, name: string) =>
  `${productId ?? 'custom'}:${variantId ?? '-'}:${name}`;

export default function PosPage() {
  const { activeBusiness, warehouses, branches, defaultTax, can } = useBusiness();
  const { profile } = useAuth();
  const { success, error: toastError } = useToast();
  const navigate = useNavigate();
  const { topLevel } = useCategories('product');

  const [lines, setLines] = useState<PosLine[]>([]);
  const [q, setQ] = useState('');
  const [scan, setScan] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [catalogue, setCatalogue] = useState<Product[]>([]);
  const [catalogueLoading, setCatalogueLoading] = useState(true);
  const [searching, setSearching] = useState<Product[] | null>(null);
  const [busyScan, setBusyScan] = useState(false);

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customItemOpen, setCustomItemOpen] = useState(false);

  const [payOpen, setPayOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [done, setDone] = useState<CompletedSale | null>(null);
  const [recent, setRecent] = useState<CompletedSale[]>([]);

  const [warehouseId, setWarehouseId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [note, setNote] = useState('');

  const debouncedQ = useDebounce(q, 300);
  const scanRef = useRef<HTMLInputElement>(null);

  const currency = activeBusiness?.base_currency ?? 'ZMW';
  const canSeeCost = can('reports.read');
  const taxRate = defaultTax?.rate ?? 0;

  useEffect(() => {
    setWarehouseId(warehouses[0]?.id ?? '');
    setBranchId(branches[0]?.id ?? '');
  }, [warehouses, branches]);

  /* ── catalogue ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!activeBusiness) return;
    let alive = true;
    (async () => {
      setCatalogueLoading(true);
      let query = db.from('products')
        .select('*')
        .eq('business_id', activeBusiness.id)
        .is('deleted_at', null)
        .order('sold_count', { ascending: false })
        .limit(60);
      if (categoryId) query = query.eq('category_id', categoryId);
      const { data } = await query;
      if (alive) { setCatalogue((data ?? []) as unknown as Product[]); setCatalogueLoading(false); }
    })();
    return () => { alive = false; };
  }, [activeBusiness, categoryId]);

  useEffect(() => {
    if (!activeBusiness || !debouncedQ.trim()) { setSearching(null); return; }
    let alive = true;
    (async () => {
      const term = debouncedQ.trim().replace(/[,()%]/g, ' ');
      const { data } = await db.from('products')
        .select('*')
        .eq('business_id', activeBusiness.id)
        .is('deleted_at', null)
        .or(`name.ilike.%${term}%,sku.ilike.%${term}%,brand.ilike.%${term}%`)
        .limit(20);
      if (alive) setSearching((data ?? []) as unknown as Product[]);
    })();
    return () => { alive = false; };
  }, [activeBusiness, debouncedQ]);

  /* ── cart maths ────────────────────────────────────────────────────────── */
  const totals = useMemo(() => computeTotals({
    currency,
    defaultTaxRate: taxRate,
    lines: lines.map((l) => ({
      product_id: l.product_id,
      name: l.name,
      quantity: l.quantity,
      unit: l.unit,
      unit_price: l.unit_price,
      discount_percent: l.discount_percent,
      discount_amount: l.discount_amount,
      tax_rate: l.tax_rate,
      sku: l.sku ?? undefined,
      image_url: l.image_url ?? undefined,
    })),
  }), [lines, currency, taxRate]);

  const profit = useMemo(() => lines.reduce((s, l) =>
    s + (l.unit_price - l.cost_price) * l.quantity * (1 - l.discount_percent / 100), 0), [lines]);

  const itemCount = lines.reduce((s, l) => s + l.quantity, 0);

  /* ── adding items ──────────────────────────────────────────────────────── */
  const addProduct = useCallback((p: Product, qty = 1) => {
    setLines((prev) => {
      const key = lineKey(p.id, null, p.name);
      const existing = prev.find((l) => l.key === key);
      if (existing) {
        const nextQty = existing.quantity + qty;
        const priced = priceForQuantity(existing.unit_price, nextQty, existing.wholesale_price,
          existing.wholesale_min_qty, existing.is_wholesale);
        return prev.map((l) => (l.key === key
          ? { ...l, quantity: nextQty, unit_price: priced.price, is_wholesale: priced.wholesale }
          : l));
      }
      const priced = priceForQuantity(p.price, qty, p.wholesale_price, p.wholesale_min_qty, p.is_wholesale);
      return [...prev, {
        key,
        product_id: p.id,
        variant_id: null,
        name: p.name,
        sku: p.sku,
        image_url: p.primary_image_url,
        unit: p.unit,
        quantity: qty,
        unit_price: priced.price,
        cost_price: toNum(p.cost_price),
        tax_rate: p.is_taxable ? taxRate : 0,
        discount_percent: 0,
        discount_amount: 0,
        stock: Math.round(toNum(p.stock)),
        track_inventory: p.track_inventory,
        is_wholesale: priced.wholesale,
        wholesale_price: toNum(p.wholesale_price),
        wholesale_min_qty: p.wholesale_min_qty ?? 1,
      }];
    });
  }, [taxRate]);

  /** Barcode scanners type the code then send Enter — treat it as a lookup. */
  const handleScan = async (code: string) => {
    const value = code.trim();
    if (!value || !activeBusiness) return;
    setBusyScan(true);
    const { data } = await db.from('products')
      .select('*')
      .eq('business_id', activeBusiness.id)
      .is('deleted_at', null)
      .or(`barcode.eq.${value},sku.eq.${value.toUpperCase()}`)
      .limit(2);
    const rows = (data ?? []) as unknown as Product[];
    setBusyScan(false);

    if (rows.length === 0) {
      toastError('No product matches that code', `${value} is not in your catalogue. Add it or sell it as a custom item.`);
      return;
    }
    addProduct(rows[0]);
    setScan('');
    success('Added', rows[0].name);
  };

  const updateLine = (key: string, patch: Partial<PosLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const setQty = (key: string, quantity: number) => {
    if (quantity <= 0) { setLines((prev) => prev.filter((l) => l.key !== key)); return; }
    setLines((prev) => prev.map((l) => {
      if (l.key !== key) return l;
      const priced = priceForQuantity(l.unit_price, quantity, l.wholesale_price, l.wholesale_min_qty, l.is_wholesale);
      return { ...l, quantity, unit_price: priced.price, is_wholesale: priced.wholesale };
    }));
  };

  const clearSale = () => {
    setLines([]);
    setCustomer(null);
    setNote('');
    setScan('');
    setQ('');
    scanRef.current?.focus();
  };

  /* ── keyboard shortcuts ────────────────────────────────────────────────── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') { e.preventDefault(); if (lines.length > 0 && !payOpen && !done) setPayOpen(true); }
      if (e.key === 'F4') { e.preventDefault(); clearSale(); }
      if (e.key === 'F9') { e.preventDefault(); setDisplayOpen(true); }
      if (e.key === 'Escape' && !payOpen) { setCustomerOpen(false); setCustomItemOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.length, payOpen, done]);

  /* ── checkout ──────────────────────────────────────────────────────────── */
  const completeSale = async (
    tenders: Tender[],
    opts: { sendReceipt?: boolean; printReceipt?: boolean } = {},
  ): Promise<CompletedSale | null> => {
    if (!activeBusiness || lines.length === 0) return null;
    try {
      const items: OrderLineInput[] = lines.map((l) => ({
        product_id: l.product_id,
        variant_id: l.variant_id,
        name: l.name,
        quantity: l.quantity,
        unit: l.unit,
        unit_price: l.unit_price,
        discount_percent: l.discount_percent || undefined,
        discount_amount: l.discount_amount || undefined,
        tax_rate: l.tax_rate,
        notes: l.notes,
        sku: l.sku ?? undefined,
      }));

      const order = await createOrder({
        business_id: activeBusiness.id,
        items,
        channel: 'pos',
        currency,
        warehouse_id: warehouseId || null,
        branch_id: branchId || null,
        customer_id: customer?.id ?? null,
        // No name/phone needed when a customer record exists; a walk-in sale
        // stays anonymous rather than creating a junk CRM row.
        served_by: profile?.id ?? null,
        served_by_name: profile?.display_name ?? profile?.full_name ?? undefined,
        delivery_method: 'pickup',
        status: tenders.length > 0 ? 'delivered' : 'confirmed',
        notes: note.trim() || undefined,
        deduct_stock: true,
      });

      // Take the money — one record per tender so split payments stay visible.
      let receiptId: UUID | null = null;
      let receiptNumber: string | null = null;
      let paid = 0;
      for (let i = 0; i < tenders.length; i += 1) {
        const t = tenders[i];
        if (t.amount <= 0) continue;
        const res = await recordPayment({
          business_id: activeBusiness.id,
          order_id: order.order_id,
          customer_id: customer?.id ?? null,
          amount: t.amount,
          currency,
          method: t.method as never,
          provider: t.provider,
          reference: t.reference,
          direction: 'inbound',
          generate_receipt: i === 0,
          notes: `POS sale ${order.order_number}`,
          allow_overpay: true,
        });
        paid += toNum(res.amount);
        if (res.receipt_id) { receiptId = res.receipt_id; }
      }

      if (receiptId) {
        const { data } = await db.from('receipts')
          .select('id,receipt_number').eq('id', receiptId).maybeSingle();
        receiptNumber = ((data as unknown as { receipt_number: string } | null) ?? null)?.receipt_number ?? null;
      }

      const tendered = tenders.reduce((s, t) => s + t.amount, 0);
      const change = Math.max(tendered - toNum(order.total), 0);

      const full = await db.from('orders')
        .select('*, items:order_items(*)').eq('id', order.order_id).maybeSingle();
      const fullOrder = (full.data as unknown as (Order & { items: OrderItem[] }) | null) ?? null;

      const sale: CompletedSale = {
        orderId: order.order_id,
        orderNumber: order.order_number,
        receiptNumber,
        receiptId,
        total: toNum(order.total),
        currency: order.currency,
        change,
        tendered,
        customerName: customer?.name ?? 'Walk-in',
        customerPhone: customer?.phone ?? null,
        itemCount: order.item_count,
        at: new Date().toISOString(),
        order: fullOrder,
        items: fullOrder?.items ?? [],
        tenders,
      };

      setDone(sale);
      setRecent((prev) => [sale, ...prev].slice(0, 12));
      setLines([]);
      setNote('');
      setCustomer(null);
      setPayOpen(false);

      success(tenders.length > 0 ? 'Sale complete' : 'Credit sale recorded',
        `${order.order_number} · ${formatMoney(order.total, order.currency)}${
          change > 0 ? ` · change ${formatMoney(change, order.currency)}` : ''}${
          tenders.length === 0 ? ' · no payment taken yet' : ''}`);

      if (opts.printReceipt && fullOrder && tenders.length > 0) {
        await printReceipt(sale, fullOrder, tenders, change);
      }
      return sale;
    } catch (e) {
      const msg = e instanceof Error ? e.message.replace(/^.*?exception:\s*/i, '') : 'Could not complete the sale.';
      toastError('Sale failed', msg);
      throw e;
    }
  };

  const printReceipt = async (sale: CompletedSale, order: Order, tenders: Tender[], change: number) => {
    if (!activeBusiness) return;
    try {
      const doc = await buildPosReceiptPdf({
        order,
        items: sale.items,
        business: activeBusiness,
        receipt: { receipt_number: sale.receiptNumber, received_at: sale.at },
        payments: tenders.map((t) => ({ method: t.method, provider: t.provider, reference: t.reference, amount: t.amount })),
        tendered: sale.tendered,
        change,
        customerName: sale.customerName,
        servedBy: profile?.display_name ?? profile?.full_name ?? undefined,
        origin: absoluteUrl(''),
      });
      printPdf(doc, `Receipt ${sale.receiptNumber ?? sale.orderNumber}`);
    } catch (e) {
      toastError('Could not print the receipt', e instanceof Error ? e.message : undefined);
    }
  };

  if (!activeBusiness) return null;

  if (!can('pos.use')) {
    return (
      <div className="py-8">
        <EmptyState icon="lock" title="You cannot use the POS"
          description="Ask the business owner to give your role the “Use the POS” permission."
          action={<Link to="/business"><Button size="sm">Back to dashboard</Button></Link>} />
      </div>
    );
  }

  // Publish the running cart so the second-screen customer display can follow.
  useEffect(() => {
    try {
      window.localStorage.setItem('seedwel.pos.display', JSON.stringify({
        lines: lines.map((l) => ({
          name: l.name,
          quantity: l.quantity,
          unit_price: l.unit_price,
          line_total: l.unit_price * l.quantity * (1 - l.discount_percent / 100) - l.discount_amount,
        })),
        total: totals.total,
        at: Date.now(),
      }));
    } catch { /* storage can be unavailable in private mode */ }
  }, [lines, totals.total]);

  const shown = searching ?? catalogue;

  return (
    <div className="space-y-3">
      {/* Counter bar */}
      <div className="sh-card-flat flex flex-wrap items-center gap-2 p-2.5">
        <div className="relative min-w-[14rem] flex-1">
          <Icon name="scan" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            ref={scanRef}
            value={scan}
            onChange={(e) => setScan(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleScan(scan); } }}
            placeholder="Scan a barcode or type a SKU, then Enter"
            className="sh-input pl-9 font-mono"
            aria-label="Barcode scanner"
            autoFocus
          />
          {busyScan && <Icon name="loading" size={15} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-brand-500" />}
        </div>
        <div className="min-w-[10rem] flex-1">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products by name" />
        </div>
        <Button variant="outline" icon="plus" onClick={() => setCustomItemOpen(true)}>Custom item</Button>
        <Button variant="outline" icon="users" onClick={() => setCustomerOpen(true)}>
          {customer ? customer.name : 'Walk-in'}
        </Button>
        <Button variant="outline" icon="eye" onClick={() => setDisplayOpen(true)} title="Customer display (F9)">
          Display
        </Button>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_24rem]">
        {/* Catalogue */}
        <div className="space-y-2">
          <div className="sh-rail">
            <button type="button" onClick={() => setCategoryId('')}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${
                categoryId === '' ? 'bg-brand-600 text-white' : 'bg-white text-ink-600 ring-1 ring-ink-200'}`}>
              All
            </button>
            {topLevel.map((c) => (
              <button key={c.id} type="button" onClick={() => setCategoryId(c.id)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${
                  categoryId === c.id ? 'bg-brand-600 text-white' : 'bg-white text-ink-600 ring-1 ring-ink-200'}`}>
                {c.icon ? `${c.icon} ` : ''}{c.name}
              </button>
            ))}
          </div>

          {catalogueLoading && !searching ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
            </div>
          ) : shown.length === 0 ? (
            <EmptyState icon="tag" title={q ? 'Nothing matches that search' : 'No products to sell yet'}
              description={q ? 'Try a shorter search, or scan the barcode.' : 'Add products (or import a CSV) and they appear here instantly.'}
              action={<Link to="/business/products/new"><Button size="sm" icon="plus">Add a product</Button></Link>} />
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {shown.map((p) => {
                const stockQty = Math.round(toNum(p.stock));
                const out = p.track_inventory && stockQty <= 0 && !p.allow_backorder;
                return (
                  <button key={p.id} type="button" disabled={out}
                    onClick={() => { addProduct(p); setQ(''); setSearching(null); }}
                    className={`sh-card-flat group overflow-hidden p-0 text-left transition hover:-translate-y-0.5 hover:shadow-card disabled:cursor-not-allowed disabled:opacity-50 ${
                      lines.some((l) => l.product_id === p.id) ? 'ring-2 ring-brand-400' : ''}`}>
                    <div className="aspect-[4/3] bg-ink-100">
                      {p.primary_image_url
                        ? <img src={p.primary_image_url} alt="" className="h-full w-full object-cover" />
                        : <div className="flex h-full items-center justify-center text-2xl opacity-40">📦</div>}
                    </div>
                    <div className="p-2">
                      <p className="line-clamp-2 min-h-[2rem] text-[12px] font-bold leading-tight">{p.name}</p>
                      <p className="sh-money mt-0.5 text-sm font-extrabold">{formatMoney(p.price, p.currency)}</p>
                      <div className="mt-1 flex items-center gap-1">
                        {p.track_inventory ? (
                          <Badge tone={stockQty <= 0 ? 'red' : stockQty <= toNum(p.stock_alert) ? 'amber' : 'green'}>
                            {stockQty <= 0 ? 'Out' : `${stockQty} left`}
                          </Badge>
                        ) : <Badge tone="neutral">No stock limit</Badge>}
                        {p.is_wholesale && <Badge tone="blue">Bulk</Badge>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Cart */}
        <div className="space-y-2 lg:sticky lg:top-24 lg:self-start">
          <div className="sh-card-flat overflow-hidden">
            <div className="flex items-center justify-between border-b border-ink-100 px-3 py-2">
              <h2 className="text-sm font-extrabold">
                Current sale <span className="font-semibold text-ink-500">({itemCount})</span>
              </h2>
              {lines.length > 0 && (
                <Button size="sm" variant="ghost" icon="trash" className="text-red-600" onClick={clearSale}>
                  Clear (F4)
                </Button>
              )}
            </div>

            {lines.length === 0 ? (
              <div className="px-3 py-10 text-center">
                <p className="text-3xl">🧾</p>
                <p className="mt-2 text-sm font-bold">Nothing on the counter</p>
                <p className="mt-1 text-xs text-ink-500">
                  Scan a barcode, tap a product, or add a custom item.
                </p>
              </div>
            ) : (
              <ul className="max-h-[46vh] divide-y divide-ink-100 overflow-y-auto lg:max-h-[52vh]">
                {lines.map((l) => (
                  <li key={l.key} className="px-3 py-2">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-bold">{l.name}</p>
                        <p className="sh-money text-[11px] text-ink-500">
                          {formatMoney(l.unit_price, currency)} / {l.unit}
                          {l.is_wholesale ? ' · wholesale' : ''}
                          {l.discount_percent > 0 ? ` · −${l.discount_percent}%` : ''}
                          {l.discount_amount > 0 ? ` · −${formatMoney(l.discount_amount, currency)}` : ''}
                        </p>
                        {l.track_inventory && l.quantity > l.stock && (
                          <p className="mt-0.5 text-[11px] font-bold text-red-600">
                            Only {l.stock} in stock{l.stock <= 0 ? ' — this will oversell' : ''}
                          </p>
                        )}
                      </div>
                      <p className="sh-money shrink-0 text-sm font-extrabold">
                        {formatMoney(l.unit_price * l.quantity * (1 - l.discount_percent / 100) - l.discount_amount, currency)}
                      </p>
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <QuantityStepper value={l.quantity} onChange={(n) => setQty(l.key, n)} size="sm" />
                      <Button size="sm" variant="ghost" icon="tag" aria-label={`Discount ${l.name}`}
                        onClick={() => {
                          const raw = window.prompt(`Discount on ${l.name} — enter a percentage or an amount in ${currency}`, '5%');
                          if (!raw) return;
                          const pct = raw.trim().endsWith('%') ? Number(raw.replace('%', '')) : null;
                          if (pct !== null && Number.isFinite(pct)) {
                            updateLine(l.key, { discount_percent: Math.min(100, Math.max(0, pct)), discount_amount: 0 });
                          } else {
                            const amt = Number(raw.replace(/[^\d.]/g, ''));
                            if (Number.isFinite(amt)) updateLine(l.key, { discount_amount: amt, discount_percent: 0 });
                          }
                        }} />
                      <Button size="sm" variant="ghost" icon="trash" className="text-red-600"
                        aria-label={`Remove ${l.name}`} onClick={() => setQty(l.key, 0)} />
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {lines.length > 0 && (
              <div className="border-t border-ink-100 bg-ink-50/60 p-3">
                <dl className="space-y-0.5 text-xs">
                  <Row label="Subtotal" value={formatMoney(totals.subtotal, currency)} />
                  {totals.discount > 0 && <Row label="Discount" value={`−${formatMoney(totals.discount, currency)}`} tone="green" />}
                  {totals.tax > 0 && <Row label={`Tax${taxRate ? ` (${taxRate}%)` : ''}`} value={formatMoney(totals.tax, currency)} />}
                  {canSeeCost && <Row label="Profit on this sale" value={formatMoney(profit, currency)} tone="green" />}
                </dl>
                <div className="mt-1.5 flex items-end justify-between border-t border-ink-200 pt-1.5">
                  <span className="text-sm font-extrabold">Total</span>
                  <span className="sh-money text-2xl font-extrabold">{formatMoney(totals.total, currency)}</span>
                </div>
                <div className="mt-2 grid gap-1.5">
                  <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note on the receipt (optional)" />
                  {warehouses.length > 1 && (
                    <Select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
                      options={warehouses.map((w) => ({ value: w.id, label: `Stock: ${w.name}` }))} />
                  )}
                  {branches.length > 1 && (
                    <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}
                      options={branches.map((b) => ({ value: b.id, label: `Branch: ${b.name}` }))} />
                  )}
                  <Button size="lg" icon="wallet" onClick={() => setPayOpen(true)} disabled={lines.length === 0}>
                    Take payment (F2)
                  </Button>
                  <Button variant="outline" size="sm" icon="invoice"
                    onClick={() => {
                      if (lines.length === 0) return;
                      toastError('Complete the sale first',
                        'Take payment or sell on credit, then open the order and create the invoice from it.');
                    }}>
                    Invoice after the sale
                  </Button>
                </div>
              </div>
            )}
          </div>

          {recent.length > 0 && (
            <div className="sh-card-flat p-3">
              <p className="sh-label">Recent sales</p>
              <ul className="mt-1.5 space-y-1">
                {recent.slice(0, 5).map((s) => (
                  <li key={s.orderId} className="flex items-center gap-2 text-xs">
                    <Link to={`/business/orders/${s.orderId}`} className="font-mono font-bold hover:text-brand-700">
                      {s.orderNumber}
                    </Link>
                    <span className="min-w-0 flex-1 truncate text-ink-500">{s.customerName}</span>
                    <span className="sh-money font-bold">{formatMoney(s.total, s.currency)}</span>
                    {s.receiptId && (
                      <Link to={`/business/receipts/${s.receiptId}`} aria-label="Open receipt">
                        <Icon name="receipt" size={14} className="text-ink-400 hover:text-brand-600" />
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <PaymentModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        total={totals.total}
        currency={currency}
        itemCount={itemCount}
        customerName={customer?.name ?? 'Walk-in'}
        onComplete={(tenders, opts) => completeSale(tenders, opts)}
        onCredit={() => completeSale([], { printReceipt: false })}
      />

      <CustomerPickerModal open={customerOpen} onClose={() => setCustomerOpen(false)}
        businessId={activeBusiness.id} selected={customer} onPick={setCustomer} />

      <CustomItemModal open={customItemOpen} onClose={() => setCustomItemOpen(false)}
        currency={currency} taxRate={taxRate}
        onAdd={(line) => { setLines((prev) => [...prev, line]); setCustomItemOpen(false); }} />

      <CustomerDisplayModal open={displayOpen} onClose={() => setDisplayOpen(false)}
        lines={lines} totals={totals} currency={currency} businessName={activeBusiness.name} />

      <SaleCompleteModal sale={done} onClose={() => setDone(null)}
        onPrint={async () => {
          if (!done?.order || !activeBusiness) return;
          const doc = await buildPosReceiptPdf({
            order: done.order, items: done.items, business: activeBusiness,
            receipt: { receipt_number: done.receiptNumber, received_at: done.at },
            payments: done.tenders.map((t) => ({ method: t.method, provider: t.provider, reference: t.reference, amount: t.amount })),
            tendered: done.tendered, change: done.change, customerName: done.customerName,
            servedBy: profile?.display_name ?? profile?.full_name ?? undefined,
            origin: absoluteUrl(''),
          });
          printPdf(doc, `Receipt ${done.receiptNumber ?? done.orderNumber}`);
        }}
        onSave={async () => {
          if (!done?.order || !activeBusiness) return;
          const doc = await buildPosReceiptPdf({
            order: done.order, items: done.items, business: activeBusiness,
            receipt: { receipt_number: done.receiptNumber, received_at: done.at },
            payments: done.tenders.map((t) => ({ method: t.method, provider: t.provider, reference: t.reference, amount: t.amount })),
            tendered: done.tendered, change: done.change, customerName: done.customerName,
            servedBy: profile?.display_name ?? profile?.full_name ?? undefined,
            origin: absoluteUrl(''),
          });
          savePdf(doc, `${done.receiptNumber ?? done.orderNumber}.pdf`);
        }}
        onNewSale={() => { setDone(null); scanRef.current?.focus(); }}
        onOpenOrder={() => { if (done) navigate(`/business/orders/${done.orderId}`); }} />
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'green' }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-ink-500">{label}</dt>
      <dd className={`sh-money font-semibold ${tone === 'green' ? 'text-emerald-600' : ''}`}>{value}</dd>
    </div>
  );
}

/* ── Payment ───────────────────────────────────────────────────────────────── */

function PaymentModal({ open, onClose, total, currency, itemCount, customerName, onComplete, onCredit }: {
  open: boolean;
  onClose: () => void;
  total: number;
  currency: string;
  itemCount: number;
  customerName: string;
  onComplete: (tenders: Tender[], opts: { sendReceipt: boolean; printReceipt: boolean }) => Promise<CompletedSale | null>;
  /** Credit sale: create the order with no payment so an invoice can follow. */
  onCredit: () => Promise<CompletedSale | null>;
}) {
  const { error: toastError } = useToast();
  const [tenders, setTenders] = useState<Tender[]>([{ method: 'cash', amount: total }]);
  const [split, setSplit] = useState(false);
  const [sendReceipt, setSendReceipt] = useState(false);
  const [printReceipt, setPrintReceipt] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTenders([{ method: 'cash', amount: total }]);
      setSplit(false);
      setSendReceipt(false);
      setPrintReceipt(true);
      setError(null);
    }
  }, [open, total]);

  const paid = tenders.reduce((s, t) => s + t.amount, 0);
  const owing = Math.max(total - paid, 0);
  const over = Math.max(paid - total, 0);
  const isCashOnly = tenders.length === 1 && tenders[0].method === 'cash';

  const setTender = (i: number, patch: Partial<Tender>) =>
    setTenders((prev) => prev.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));

  const quickCash = [total, Math.ceil(total / 10) * 10, Math.ceil(total / 50) * 50, Math.ceil(total / 100) * 100]
    .filter((v, i, arr) => v > 0 && arr.indexOf(v) === i).slice(0, 4);

  const submit = async () => {
    if (paid <= 0) { setError('Enter the amount received.'); return; }
    if (paid < total - 0.009) {
      setError(`Still ${formatMoney(owing, currency)} short. Add another tender or reduce the amount.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onComplete(tenders.filter((t) => t.amount > 0), { sendReceipt, printReceipt });
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^.*?exception:\s*/i, '') : 'The sale could not be completed.');
      toastError('Sale failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="md" title="Take payment"
      subtitle={`${itemCount} item${itemCount === 1 ? '' : 's'} · ${customerName}`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="sm" variant="outline" loading={busy}
            onClick={() => { setBusy(true); void onCredit().catch(() => undefined).finally(() => setBusy(false)); }}>
            Sell on credit
          </Button>
          <Button size="sm" icon="check" loading={busy} onClick={() => void submit()}>
            Complete sale · {formatMoney(total, currency)}
          </Button>
        </>
      }>
      <div className="space-y-3">
        <div className="rounded-2xl bg-brand-50 p-4 text-center">
          <p className="sh-label text-brand-800">Amount due</p>
          <p className="sh-money text-4xl font-extrabold text-brand-900">{formatMoney(total, currency)}</p>
          {paid > 0 && (
            <p className="mt-1 text-sm font-bold text-brand-800">
              {owing > 0
                ? <>Still owing <span className="sh-money">{formatMoney(owing, currency)}</span></>
                : <>Change due <span className="sh-money">{formatMoney(over, currency)}</span></>}
            </p>
          )}
        </div>

        {error && <Notice tone="danger">{error}</Notice>}

        <div className="flex items-center justify-between">
          <Switch checked={split} onChange={(v) => {
            setSplit(v);
            setTenders(v ? [{ method: 'cash', amount: total }] : [{ method: 'cash', amount: total }]);
          }} label="Split payment" hint="Take part in cash and part on mobile money, for example." />
        </div>

        <ul className="space-y-2">
          {tenders.map((t, i) => (
            <li key={i} className="rounded-2xl border border-ink-200 p-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_10rem]">
                <div>
                  <Select label={i === 0 ? 'Method' : undefined} value={t.method}
                    onChange={(e) => setTender(i, { method: e.target.value })}
                    options={(Object.keys(PAYMENT_METHOD_LABELS) as (keyof typeof PAYMENT_METHOD_LABELS)[])
                      .filter((m) => m !== 'credit')
                      .map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] }))} />
                  {t.method === 'mobile_money' && (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <Select label="Provider" value={t.provider ?? MOBILE_MONEY_PROVIDERS[0]}
                        onChange={(e) => setTender(i, { provider: e.target.value })}
                        options={MOBILE_MONEY_PROVIDERS.map((p) => ({ value: p, label: p }))} />
                      <Input label="Reference" value={t.reference ?? ''}
                        onChange={(e) => setTender(i, { reference: e.target.value })} placeholder="Txn ID" />
                    </div>
                  )}
                  {(t.method === 'bank_transfer' || t.method === 'card' || t.method === 'cheque') && (
                    <Input className="mt-2" label="Reference" value={t.reference ?? ''}
                      onChange={(e) => setTender(i, { reference: e.target.value })} placeholder="Transaction or cheque number" />
                  )}
                </div>
                <div>
                  <MoneyInput label={i === 0 ? 'Amount' : undefined} currency={currency} value={t.amount}
                    onChange={(n) => setTender(i, { amount: n })} />
                  {split && tenders.length > 1 && (
                    <Button size="sm" variant="ghost" icon="trash" className="mt-1 text-red-600"
                      onClick={() => setTenders(tenders.filter((_, idx) => idx !== i))}>Remove</Button>
                  )}
                </div>
              </div>

              {t.method === 'cash' && isCashOnly && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {quickCash.map((v) => (
                    <Button key={v} size="sm" variant="outline" onClick={() => setTender(i, { amount: Math.round(v * 100) / 100 })}>
                      {formatMoney(v, currency)}
                    </Button>
                  ))}
                  {[50, 100, 200, 500].map((v) => (
                    <Button key={`+${v}`} size="sm" variant="ghost"
                      onClick={() => setTender(i, { amount: Math.round((t.amount + v) * 100) / 100 })}>
                      +{v}
                    </Button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>

        {split && tenders.length < 4 && (
          <Button size="sm" variant="outline" icon="plus"
            onClick={() => setTenders([...tenders, { method: 'mobile_money', amount: owing }])}>
            Add another tender
          </Button>
        )}

        {isCashOnly && over > 0 && (
          <div className="rounded-2xl bg-emerald-50 p-3 text-center">
            <p className="sh-label text-emerald-800">Change to give back</p>
            <p className="sh-money text-2xl font-extrabold text-emerald-700">{formatMoney(changeDue(total, paid, currency), currency)}</p>
          </div>
        )}

        <div className="space-y-2 rounded-xl border border-ink-200 p-3">
          <Switch checked={printReceipt} onChange={setPrintReceipt} label="Print the receipt now"
            hint="Opens your browser's print dialog on 80 mm paper." />
          <Switch checked={sendReceipt} onChange={setSendReceipt} label="Open WhatsApp to send the receipt"
            hint="Handy when the customer is not at the counter." />
        </div>

        <p className="text-[11px] text-ink-500">
          The order is written first, then each payment — stock comes out of the selected warehouse and a numbered
          receipt is generated. “Sell on credit” records the order with no payment, so you can invoice it and the
          customer's balance is tracked.
        </p>
      </div>
    </Modal>
  );
}

/* ── Customer picker ───────────────────────────────────────────────────────── */

function CustomerPickerModal({ open, onClose, businessId, selected, onPick }: {
  open: boolean; onClose: () => void; businessId: UUID; selected: Customer | null;
  onPick: (c: Customer | null) => void;
}) {
  const { success, error: toastError } = useToast();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const debounced = useDebounce(q, 300);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      setLoading(true);
      let query = db.from('customers')
        .select('*').eq('business_id', businessId).is('deleted_at', null)
        .order('last_order_at', { ascending: false, nullsFirst: false }).limit(25);
      if (debounced.trim()) {
        const term = debounced.trim().replace(/[,()%]/g, ' ');
        query = query.or(`name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%,company_name.ilike.%${term}%`);
      }
      const { data } = await query;
      if (alive) { setRows((data ?? []) as unknown as Customer[]); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [open, businessId, debounced]);

  const create = async () => {
    if (!name.trim()) { toastError('Enter a name'); return; }
    setBusy(true);
    try {
      const id = await upsertCustomer(businessId, { name: name.trim(), phone: phone.trim() || undefined });
      const { data } = await db.from('customers').select('*').eq('id', id).maybeSingle();
      if (data) {
        onPick(data as unknown as Customer);
        success('Customer added', (data as unknown as Customer).name);
        setName(''); setPhone(''); onClose();
      }
    } catch (e) {
      toastError('Could not add the customer', e instanceof Error ? e.message.replace(/^.*?exception:\s*/i, '') : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="md" title="Who is buying?"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => { onPick(null); onClose(); }}>Walk-in (no record)</Button>
          <Button size="sm" icon="plus" loading={busy} onClick={() => void create()}>Add customer</Button>
        </>
      }>
      <div className="space-y-3">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, phone or company" autoFocus />

        {selected && (
          <div className="flex items-center gap-2 rounded-xl bg-brand-50 p-2.5">
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold">{selected.name}</span>
              <span className="block text-xs text-brand-800">
                {selected.phone ?? 'no phone'} · {formatMoney(selected.total_spent, selected.currency)} lifetime
              </span>
            </span>
            <Button size="sm" variant="ghost" icon="close" onClick={() => onPick(null)}>Remove</Button>
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <Input label="New customer name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bwalya Mulenga" />
          <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+260 97 1234567" />
        </div>

        {loading ? (
          <Skeleton className="h-32 w-full rounded-2xl" />
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-500">
            No customers match “{q}”. Add one above — their purchases and balance are then tracked.
          </p>
        ) : (
          <ul className="max-h-64 divide-y divide-ink-100 overflow-y-auto rounded-2xl border border-ink-200">
            {rows.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => { onPick(c); onClose(); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-brand-50">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold">{c.name}</span>
                    <span className="block truncate text-[11px] text-ink-500">
                      {c.phone ?? 'no phone'}{c.company_name ? ` · ${c.company_name}` : ''} · {c.orders_count} order{c.orders_count === 1 ? '' : 's'}
                    </span>
                  </span>
                  {toNum(c.outstanding_balance) > 0 && <Badge tone="red">Owes {formatMoney(c.outstanding_balance, c.currency)}</Badge>}
                  {selected?.id === c.id && <Icon name="check" size={16} className="text-brand-600" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

/* ── Custom item ───────────────────────────────────────────────────────────── */

function CustomItemModal({ open, onClose, currency, taxRate, onAdd }: {
  open: boolean; onClose: () => void; currency: string; taxRate: number; onAdd: (l: PosLine) => void;
}) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState(0);
  const [qty, setQty] = useState(1);
  const [taxable, setTaxable] = useState(true);

  useEffect(() => { if (open) { setName(''); setPrice(0); setQty(1); setTaxable(true); } }, [open]);

  const add = () => {
    if (!name.trim() || price <= 0) return;
    onAdd({
      key: lineKey(null, null, `${name.trim()}-${Date.now()}`),
      product_id: null,
      variant_id: null,
      name: name.trim(),
      sku: null,
      image_url: null,
      unit: 'piece',
      quantity: Math.max(1, qty),
      unit_price: price,
      cost_price: 0,
      tax_rate: taxable ? taxRate : 0,
      discount_percent: 0,
      discount_amount: 0,
      stock: 0,
      track_inventory: false,
      is_wholesale: false,
      wholesale_price: 0,
      wholesale_min_qty: 1,
    });
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} size="sm" title="Sell a custom item"
      subtitle="Not in the catalogue — a service, a bundle or something you do not stock."
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" icon="plus" disabled={!name.trim() || price <= 0} onClick={add}>Add to sale</Button>
        </>
      }>
      <div className="space-y-3">
        <Input label="Description" required value={name} onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Delivery fee · Table assembly" autoFocus />
        <div className="grid gap-3 sm:grid-cols-2">
          <MoneyInput label="Unit price" required currency={currency} value={price} onChange={setPrice} />
          <Input label="Quantity" type="number" min={1} value={String(qty)}
            onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} />
        </div>
        <Switch checked={taxable} onChange={setTaxable} label={`Charge ${taxRate}% tax`} />
        <Notice tone="info">
          Custom items do not touch inventory. If you sell the same thing often, add it as a product so stock and
          reports stay accurate.
        </Notice>
      </div>
    </Modal>
  );
}

/* ── Customer display ──────────────────────────────────────────────────────── */

export function CustomerDisplayModal({ open, onClose, lines, totals, currency, businessName }: {
  open: boolean; onClose: () => void; lines: PosLine[];
  totals: { subtotal: number; tax: number; discount: number; total: number; itemCount: number };
  currency: string; businessName: string;
}) {
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Customer display">
      <div className="rounded-2xl bg-ink-900 p-6 text-white">
        <p className="text-center text-sm font-bold uppercase tracking-widest text-brand-300">{businessName}</p>
        <ul className="mt-5 max-h-[38vh] space-y-2 overflow-y-auto">
          {lines.length === 0 && (
            <li className="py-10 text-center text-lg text-white/50">Waiting for the first item…</li>
          )}
          {lines.map((l) => (
            <li key={l.key} className="flex items-center justify-between gap-3 border-b border-white/10 pb-2">
              <span className="min-w-0">
                <span className="block truncate text-base font-semibold">{l.name}</span>
                <span className="block text-xs text-white/50">
                  {l.quantity} × {formatMoney(l.unit_price, currency)}
                </span>
              </span>
              <span className="sh-money shrink-0 text-base font-bold">
                {formatMoney(l.unit_price * l.quantity * (1 - l.discount_percent / 100) - l.discount_amount, currency)}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-4 space-y-1 text-sm text-white/70">
          <div className="flex justify-between"><span>Items</span><span>{totals.itemCount}</span></div>
          <div className="flex justify-between"><span>Subtotal</span><span className="sh-money">{formatMoney(totals.subtotal, currency)}</span></div>
          {totals.discount > 0 && <div className="flex justify-between"><span>Discount</span><span className="sh-money">−{formatMoney(totals.discount, currency)}</span></div>}
          {totals.tax > 0 && <div className="flex justify-between"><span>Tax</span><span className="sh-money">{formatMoney(totals.tax, currency)}</span></div>}
        </div>
        <div className="mt-3 flex items-end justify-between border-t border-white/20 pt-3">
          <span className="text-xl font-bold">TOTAL</span>
          <span className="sh-money text-5xl font-extrabold">{formatMoney(totals.total, currency)}</span>
        </div>
      </div>
      <p className="mt-2 text-center text-xs text-ink-500">
        Turn the screen to face the customer, or press F9 to reopen this during a sale.
      </p>
    </Modal>
  );
}

/* ── Sale complete ─────────────────────────────────────────────────────────── */

function SaleCompleteModal({ sale, onClose, onPrint, onSave, onNewSale, onOpenOrder }: {
  sale: CompletedSale | null;
  onClose: () => void;
  onPrint: () => Promise<void>;
  onSave: () => Promise<void>;
  onNewSale: () => void;
  onOpenOrder: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!sale) return null;

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } finally { setBusy(null); }
  };

  return (
    <Modal open onClose={onClose} size="md" title="Sale complete"
      subtitle={`${sale.orderNumber}${sale.receiptNumber ? ` · receipt ${sale.receiptNumber}` : ''}`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onOpenOrder}>Open the order</Button>
          <Button size="sm" icon="plus" onClick={onNewSale}>Next customer</Button>
        </>
      }>
      <div className="space-y-3">
        <div className="rounded-2xl bg-emerald-50 p-4 text-center">
          <Icon name="success" size={30} className="mx-auto text-emerald-600" />
          <p className="sh-money mt-2 text-3xl font-extrabold text-emerald-800">
            {formatMoney(sale.total, sale.currency)}
          </p>
          <p className="mt-1 text-sm font-semibold text-emerald-700">
            {sale.itemCount} item{sale.itemCount === 1 ? '' : 's'} · {sale.customerName}
          </p>
          {sale.change > 0 && (
            <p className="mt-2 rounded-xl bg-white/70 py-1.5 text-lg font-extrabold text-emerald-900">
              Change due {formatMoney(sale.change, sale.currency)}
            </p>
          )}
        </div>

        <ul className="space-y-1 text-sm">
          {sale.tenders.map((t, i) => (
            <li key={i} className="flex justify-between gap-2">
              <span className="text-ink-600">
                {PAYMENT_METHOD_LABELS[t.method as keyof typeof PAYMENT_METHOD_LABELS] ?? t.method}
                {t.provider ? ` · ${t.provider}` : ''}{t.reference ? ` · ${t.reference}` : ''}
              </span>
              <span className="sh-money font-bold">{formatMoney(t.amount, sale.currency)}</span>
            </li>
          ))}
        </ul>

        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="outline" icon="print" loading={busy === 'print'} onClick={() => void run('print', onPrint)}>
            Print receipt
          </Button>
          <Button variant="outline" icon="download" loading={busy === 'save'} onClick={() => void run('save', onSave)}>
            Save as PDF
          </Button>
          {sale.customerPhone && (
            <a className="sm:col-span-2"
              href={whatsappUrl(sale.customerPhone,
                `Thank you for your purchase from Seedwel Hub. Receipt ${sale.receiptNumber ?? sale.orderNumber} · ${formatMoney(sale.total, sale.currency)}. View: ${absoluteUrl(`/orders/${sale.orderId}`)}`)}
              target="_blank" rel="noreferrer">
              <Button block variant="outline" icon="whatsapp">Send the receipt on WhatsApp</Button>
            </a>
          )}
        </div>

        {sale.receiptId && (
          <Link to={`/business/receipts/${sale.receiptId}`} className="block">
            <Button block variant="ghost" icon="receipt">Open receipt {sale.receiptNumber}</Button>
          </Link>
        )}
      </div>
    </Modal>
  );
}

/** Standalone customer-display route (open it on a second screen). */
export function CustomerDisplayPage() {
  const { activeBusiness } = useBusiness();
  const [rows, setRows] = useState<{ name: string; quantity: number; unit_price: number; line_total: number }[]>([]);
  const [total, setTotal] = useState(0);
  const currency = activeBusiness?.base_currency ?? 'ZMW';

  // The till posts the running cart to this window through localStorage.
  useEffect(() => {
    const read = () => {
      try {
        const raw = window.localStorage.getItem('seedwel.pos.display');
        if (!raw) return;
        const parsed = JSON.parse(raw) as { lines?: typeof rows; total?: number };
        setRows(parsed.lines ?? []);
        setTotal(parsed.total ?? 0);
      } catch { /* ignore malformed payloads */ }
    };
    read();
    window.addEventListener('storage', read);
    const t = window.setInterval(read, 1000);
    return () => { window.removeEventListener('storage', read); window.clearInterval(t); };
  }, []);

  return (
    <div className="flex min-h-screen flex-col justify-between bg-ink-900 p-8 text-white">
      <p className="text-center text-lg font-bold uppercase tracking-[0.3em] text-brand-300">
        {activeBusiness?.name ?? 'Seedwel Hub'}
      </p>
      <ul className="mx-auto w-full max-w-2xl flex-1 space-y-3 overflow-y-auto py-8">
        {rows.length === 0 && <li className="py-16 text-center text-xl text-white/40">Waiting for items…</li>}
        {rows.map((r, i) => (
          <li key={i} className="flex items-center justify-between gap-4 border-b border-white/10 pb-3">
            <span>
              <span className="block text-xl font-semibold">{r.name}</span>
              <span className="block text-sm text-white/50">{r.quantity} × {formatMoney(r.unit_price, currency)}</span>
            </span>
            <span className="sh-money text-xl font-bold">{formatMoney(r.line_total, currency)}</span>
          </li>
        ))}
      </ul>
      <div className="mx-auto flex w-full max-w-2xl items-end justify-between border-t border-white/20 pt-6">
        <span className="text-2xl font-bold">TOTAL</span>
        <span className="sh-money text-6xl font-extrabold">{formatMoney(total, currency)}</span>
      </div>
    </div>
  );
}

/** Status pill used by the recent-sales strip on the dashboard. */
export function PosStatusPill({ status }: { status: string }) {
  return <StatusBadge status={status} />;
}
