import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import {
  Badge, Button, Checkbox, EmptyState, Input, Modal, Notice, Select,
  Skeleton, Switch, Textarea,
} from '@/components/ui/Primitives';
import {
  ActionSheet, BarcodeImage, DeniedPanel, MoneyInput, StatusBadge, Tabs,
  type ActionItem,
} from '@/components/ui';
import { ImageUploader, type UploadedImage } from '@/components/ui/ImageUploader';
import { PageHeader } from '@/components/layout/BusinessShell';
import { useBusiness } from '@/context/BusinessContext';
import { useToast } from '@/context/ToastContext';
import { db, fetchList, fetchById, patchRow, newId, type DbWhere } from '@/lib/db';
import { BUCKETS } from '@/lib/media';
import { useCategories } from '@/hooks/useCategories';
import { useDebounce } from '@/hooks/useUi';
import { formatMoney, toNum } from '@/lib/currency';
import { formatDate, relativeTime } from '@/lib/dates';
import { marginPercent, stockValue } from '@/lib/calc';
import {
  LABEL_SIZES, detectFormat, generateInternalBarcode, isValidEan13, renderBarcode,
} from '@/lib/barcode';
import { buildLabelSheet, savePdf } from '@/lib/pdf';
import { downloadExcel } from '@/lib/csv';
import { missingPermissionMessage } from '@/lib/permissions';
import { UNITS, PAGE_SIZE } from '@/lib/constants';
import type { Product, ProductVariant, UUID } from '@/types';

/**
 * Product management: list, create, edit, publish, duplicate, archive,
 * variants, barcodes and price labels.
 *
 * Cost price and margin are gated by reports.read — a cashier or salesperson
 * sees prices but never what the business paid, and RLS enforces the same rule.
 */

type ProductRow = Product & { category?: { id: UUID; name: string; slug: string } | null };

/** Snapshot of the owning business, embedded in every product document at save
 *  time so catalogue screens render without per-row reads (Firestore rules
 *  still guard the reads; this only mirrors what the old views joined). */
function productBusinessSnapshot(b: { id: string; name: string; slug: string; logo_url?: string | null; city?: string | null; country_code?: string | null; verification_status?: string | null; rating_avg?: unknown; badges?: unknown; accepts_orders?: unknown; delivery_enabled?: unknown; delivery_fee?: unknown; free_delivery_over?: unknown; base_currency?: string | null }): Record<string, unknown> {
  return {
    id: b.id,
    name: b.name,
    slug: b.slug,
    logo_url: b.logo_url ?? null,
    city: b.city ?? null,
    country_code: b.country_code ?? 'ZM',
    verification_status: b.verification_status ?? 'unverified',
    rating_avg: Number(b.rating_avg ?? 0) || 0,
    badges: Array.isArray(b.badges) ? b.badges : [],
    accepts_orders: b.accepts_orders !== false,
    delivery_enabled: b.delivery_enabled === true,
    delivery_fee: Number(b.delivery_fee ?? 0) || 0,
    free_delivery_over: b.free_delivery_over != null ? Number(b.free_delivery_over) : null,
    base_currency: b.base_currency ?? 'ZMW',
  };
}

function matchesTerm(p: { name?: string | null; sku?: string | null; barcode?: string | null; brand?: string | null }, term: string): boolean {
  if (!term) return true;
  const t = term.toLowerCase();
  return [p.name, p.sku, p.barcode, p.brand].some((f) => f != null && String(f).toLowerCase().includes(t));
}

export function ProductsPage() {
  const { activeBusiness, can } = useBusiness();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { success, error: toastError } = useToast();

  const [rows, setRows] = useState<ProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<UUID>>(new Set());
  const [labelsFor, setLabelsFor] = useState<ProductRow[]>([]);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [actionFor, setActionFor] = useState<ProductRow | null>(null);

  const q = params.get('q') ?? '';
  const status = params.get('status') ?? '';
  const categoryId = params.get('category') ?? '';
  const stockFilter = params.get('stock') ?? '';
  const page = Math.max(1, Number(params.get('page') ?? 1));
  const debouncedQ = useDebounce(q, 350);

  const canWrite = can('products.write');
  const canSeeCost = can('reports.read');

  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => { if (!v) next.delete(k); else next.set(k, v); });
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  useEffect(() => {
    if (params.get('q') !== debouncedQ) setParam({ q: debouncedQ || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  const load = useCallback(async () => {
    if (!activeBusiness) return;
    setLoading(true);
    setError(null);
    try {
      const term = q.trim().replace(/[,()%]/g, ' ');

      // Low-stock compares stock against each product's own alert level, which
      // Firestore cannot express as a single query — read the tracked batch
      // once and filter client-side (stock_status is maintained on every stock
      // write, so the filter itself stays a simple equality check).
      if (stockFilter === 'low') {
        const where: DbWhere[] = [
          ['business_id', '==', activeBusiness.id] as DbWhere,
          ['track_inventory', '==', true] as DbWhere,
          ['stock_status', '==', 'low_stock'] as DbWhere,
        ];
        if (status === 'draft' || status === 'archived' || status) where.push(['status', '==', status === 'published' || status === 'unpublished' ? '__never__' : status] as DbWhere);
        if (status === 'published') where.push(['is_published', '==', true] as DbWhere);
        else if (status === 'unpublished') where.push(['is_published', '==', false] as DbWhere);
        if (categoryId) where.push(['category_id', '==', categoryId] as DbWhere);
        const all = await fetchList<ProductRow>('products', {
          where, orderByField: 'updated_at', orderDir: 'desc', limit: 1000,
        });
        const filtered = all.filter((p) => matchesTerm(p, term));
        setTotal(filtered.length);
        setRows(filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE));
      } else {
        let query = db.from('products')
          .select('*')
          .eq('business_id', activeBusiness.id)
          .is('deleted_at', null)
          .order('updated_at', { ascending: false })
          .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
        if (term) query = query.or(`name.ilike.%${term}%,sku.ilike.%${term}%,barcode.ilike.%${term}%,brand.ilike.%${term}%`);
        if (status === 'draft') query = query.eq('status', 'draft');
        else if (status === 'published') query = query.eq('is_published', true);
        else if (status === 'unpublished') query = query.eq('is_published', false);
        else if (status === 'archived') query = query.eq('status', 'archived');
        else if (status) query = query.eq('status', status);
        if (categoryId) query = query.eq('category_id', categoryId);
        if (stockFilter === 'out') query = query.eq('track_inventory', true).lte('stock', 0);
        else if (stockFilter === 'in') query = query.eq('track_inventory', true).gt('stock', 0);
        const { data, error: e, count } = await query;
        if (e) throw e;
        setRows((data ?? []) as ProductRow[]);
        setTotal(count ?? 0);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load products.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [activeBusiness, q, status, categoryId, stockFilter, page]);

  useEffect(() => { void load(); }, [load]);

  const toggleSelect = (id: UUID) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const setPublished = async (ids: UUID[], published: boolean) => {
    const { error: e } = await db.from('products')
      .update({ is_published: published, published_at: published ? new Date().toISOString() : null,
                status: published ? 'active' : 'draft' })
      .in('id', ids);
    if (e) { toastError('Could not update products', e.message); return; }
    success(published ? 'Published' : 'Unpublished', `${ids.length} product${ids.length === 1 ? '' : 's'} updated.`);
    setSelected(new Set());
    void load();
  };

  const archive = async (p: ProductRow) => {
    const { error: e } = await db.from('products')
      .update({ status: 'archived', is_published: false }).eq('id', p.id);
    if (e) { toastError('Could not archive', e.message); return; }
    success('Product archived', p.name);
    void load();
  };

  const duplicate = async (p: ProductRow) => {
    const { data, error: e } = await db.from('products').select('*').eq('id', p.id).single();
    if (e || !data) { toastError('Could not duplicate', e?.message); return; }
    const copy = data as unknown as Product;
    const { error: insErr } = await db.from('products').insert({
      ...stripCopy(copy),
      name: `${copy.name} (copy)`,
      sku: copy.sku ? `${copy.sku}-COPY` : null,
      barcode: null,
      slug: `${copy.slug}-copy-${Math.random().toString(36).slice(2, 6)}`,
      status: 'draft',
      is_published: false,
      published_at: null,
      stock: 0,
      stock_status: copy.track_inventory ? 'out_of_stock' : null,
      variants: [],
      sold_count: 0,
      view_count: 0,
      rating_avg: 0,
      rating_count: 0,
    });
    if (insErr) { toastError('Could not create the copy', insErr.message); return; }
    success('Product duplicated', 'The copy is saved as a draft.');
    void load();
  };

  const remove = async (p: ProductRow) => {
    const { error: e } = await db.from('products')
      .update({ deleted_at: new Date().toISOString(), is_published: false }).eq('id', p.id);
    if (e) { toastError('Could not delete', e.message); return; }
    success('Product deleted', `${p.name} is no longer visible. Stock history is preserved.`);
    void load();
  };

  const exportRows = (only: ProductRow[]) => {
    const rows = only.map((p) => ({
      name: p.name, sku: p.sku ?? '', barcode: p.barcode ?? '', brand: p.brand ?? '',
      category: p.category?.name ?? '', price: toNum(p.price), cost_price: canSeeCost ? toNum(p.cost_price) : '',
      wholesale_price: p.wholesale_price ? toNum(p.wholesale_price) : '', wholesale_min_qty: p.wholesale_min_qty ?? '',
      stock: p.stock, stock_alert: p.stock_alert, unit: p.unit, currency: p.currency,
      status: p.status, published: p.is_published ? 'yes' : 'no',
      short_description: p.short_description ?? '', description: p.description ?? '',
    }));
    downloadExcel('Products', `seedwel-products-${new Date().toISOString().slice(0, 10)}.xls`, rows);
    success('Export ready', `${rows.length} products exported.`);
  };

  if (!activeBusiness) return null;

  if (!can('products.read')) {
    return <DeniedPanel message={missingPermissionMessage('products.read')} />;
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Products"
        subtitle={`${total} product${total === 1 ? '' : 's'} · ${rows.filter((r) => r.is_published).length} published on this page`}
        icon="🏷️"
        actions={
          <>
            <Button size="sm" variant="outline" icon="download" onClick={() => exportRows(rows)} disabled={rows.length === 0}>
              Export
            </Button>
            <Link to="/business/import"><Button size="sm" variant="outline" icon="upload">CSV import</Button></Link>
            <Link to="/business/barcodes"><Button size="sm" variant="outline" icon="barcode">Labels</Button></Link>
            {canWrite && (
              <Link to="/business/products/new"><Button size="sm" icon="plus">Add product</Button></Link>
            )}
          </>
        }
      />

      {/* Filters */}
      <div className="sh-card-flat space-y-2 p-3">
        <div className="flex flex-wrap gap-2">
          <div className="min-w-[12rem] flex-1">
            <Input value={q} onChange={(e) => setParam({ q: e.target.value || null })}
              placeholder="Search by name, SKU, barcode or brand" />
          </div>
          <Select value={status} onChange={(e) => setParam({ status: e.target.value || null })} className="w-auto"
            placeholder="All statuses"
            options={[
              { value: 'published', label: 'Published' },
              { value: 'draft', label: 'Draft' },
              { value: 'active', label: 'Active' },
              { value: 'out_of_stock', label: 'Out of stock' },
              { value: 'archived', label: 'Archived' },
            ]} />
          <Select value={stockFilter} onChange={(e) => setParam({ stock: e.target.value || null })} className="w-auto"
            placeholder="Any stock level"
            options={[
              { value: 'out', label: 'Out of stock' },
              { value: 'low', label: 'Low stock' },
              { value: 'in', label: 'In stock' },
            ]} />
          <CategoryFilter value={categoryId} onChange={(v) => setParam({ category: v || null })} />
        </div>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-brand-50 p-2">
            <span className="text-xs font-bold text-brand-800">{selected.size} selected</span>
            {canWrite && (
              <>
                <Button size="sm" variant="outline" icon="eye" onClick={() => void setPublished(Array.from(selected), true)}>
                  Publish
                </Button>
                <Button size="sm" variant="outline" icon="eyeOff" onClick={() => void setPublished(Array.from(selected), false)}>
                  Unpublish
                </Button>
              </>
            )}
            <Button size="sm" variant="outline" icon="tag"
              onClick={() => { setLabelsFor(rows.filter((r) => selected.has(r.id))); setLabelsOpen(true); }}>
              Price labels
            </Button>
            <Button size="sm" variant="outline" icon="download"
              onClick={() => exportRows(rows.filter((r) => selected.has(r.id)))}>
              Export selected
            </Button>
            <Button size="sm" variant="ghost" icon="close" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        )}
      </div>

      {error && <Notice tone="danger" title="Could not load products">{error}</Notice>}

      {/* Desktop table */}
      <div className="hidden lg:block">
        <div className="sh-card-flat overflow-hidden">
          <table className="sh-table">
            <thead>
              <tr>
                <th className="w-8">
                  <input type="checkbox" className="h-4 w-4 rounded border-ink-300"
                    checked={rows.length > 0 && rows.every((r) => selected.has(r.id))}
                    onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                    aria-label="Select all" />
                </th>
                <th>Product</th>
                <th>SKU / barcode</th>
                <th className="text-right">Price</th>
                {canSeeCost && <th className="text-right">Cost</th>}
                {canSeeCost && <th className="text-right">Margin</th>}
                <th className="text-right">Stock</th>
                <th>Status</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={canSeeCost ? 9 : 7}><Skeleton className="h-10 w-full" /></td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr><td colSpan={canSeeCost ? 9 : 7} className="p-0">
                  <EmptyState icon="tag" title={q || status || categoryId ? 'No products match those filters' : 'No products yet'}
                    description={q || status || categoryId
                      ? 'Try clearing a filter — archived and draft products are hidden by default.'
                      : 'Add your first product, or import a CSV to bring your whole catalogue in at once.'}
                    action={
                      <>
                        {canWrite && <Link to="/business/products/new"><Button size="sm" icon="plus">Add product</Button></Link>}
                        <Link to="/business/import"><Button size="sm" variant="outline" icon="upload">Import CSV</Button></Link>
                      </>
                    } />
                </td></tr>
              ) : rows.map((p) => {
                const stockQty = Math.round(toNum(p.stock));
                const out = p.track_inventory && stockQty <= 0;
                const low = p.track_inventory && !out && stockQty <= Math.round(toNum(p.stock_alert));
                return (
                  <tr key={p.id}>
                    <td>
                      <input type="checkbox" className="h-4 w-4 rounded border-ink-300"
                        checked={selected.has(p.id)} onChange={() => toggleSelect(p.id)}
                        aria-label={`Select ${p.name}`} />
                    </td>
                    <td>
                      <Link to={`/business/products/${p.id}`} className="flex items-center gap-2.5">
                        {p.primary_image_url
                          ? <img src={p.primary_image_url} alt="" className="h-10 w-10 shrink-0 rounded-lg border border-ink-200 object-cover" />
                          : <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-base">📦</span>}
                        <span className="min-w-0">
                          <span className="block max-w-[22rem] truncate text-[13px] font-bold hover:text-brand-700">{p.name}</span>
                          <span className="block truncate text-[11px] text-ink-500">
                            {p.category?.name ?? 'Uncategorised'}{p.brand ? ` · ${p.brand}` : ''} · updated {relativeTime(p.updated_at)}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="font-mono text-[11px] text-ink-600">
                      <span className="block">{p.sku ?? '—'}</span>
                      <span className="block text-ink-400">{p.barcode ?? 'no barcode'}</span>
                    </td>
                    <td className="text-right">
                      <span className="sh-money block text-[13px]">{formatMoney(p.price, p.currency)}</span>
                      {p.is_wholesale && p.wholesale_price && (
                        <span className="block text-[10px] font-semibold text-brand-700">
                          {formatMoney(p.wholesale_price, p.currency)} / {p.wholesale_min_qty}+
                        </span>
                      )}
                    </td>
                    {canSeeCost && (
                      <td className="sh-money text-right text-[13px] text-ink-600">{formatMoney(p.cost_price, p.currency)}</td>
                    )}
                    {canSeeCost && (
                      <td className="text-right">
                        <Badge tone={marginPercent(toNum(p.price), toNum(p.cost_price)) >= 30 ? 'green'
                          : marginPercent(toNum(p.price), toNum(p.cost_price)) >= 10 ? 'amber' : 'red'}>
                          {marginPercent(toNum(p.price), toNum(p.cost_price)).toFixed(0)}%
                        </Badge>
                      </td>
                    )}
                    <td className="text-right">
                      <span className={`sh-money block text-[13px] font-bold ${out ? 'text-red-600' : low ? 'text-amber-600' : ''}`}>
                        {p.track_inventory ? stockQty : '—'}
                      </span>
                      {canSeeCost && p.track_inventory && stockQty > 0 && (
                        <span className="block text-[10px] text-ink-400">
                          {formatMoney(stockValue(stockQty, toNum(p.cost_price), p.currency), p.currency)}
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        <StatusBadge status={p.is_published ? 'published' : 'draft'} />
                        {out && <Badge tone="red">Out</Badge>}
                        {low && !out && <Badge tone="amber">Low</Badge>}
                        {p.is_featured && <Badge tone="accent" icon="fire">Featured</Badge>}
                        {p.has_variants && <Badge tone="blue">Variants</Badge>}
                      </div>
                    </td>
                    <td>
                      <button type="button" onClick={() => setActionFor(p)}
                        className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700" aria-label="Product actions">
                        <Icon name="more" size={17} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile cards */}
      <ul className="space-y-2 lg:hidden">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <li key={i}><Skeleton className="h-24 w-full rounded-2xl" /></li>)
        ) : rows.length === 0 ? (
          <EmptyState icon="tag" title="No products yet"
            action={canWrite ? <Link to="/business/products/new"><Button size="sm" icon="plus">Add product</Button></Link> : undefined} />
        ) : rows.map((p) => {
          const stockQty = Math.round(toNum(p.stock));
          return (
            <li key={p.id} className="sh-card-flat p-3">
              <div className="flex gap-3">
                <Link to={`/business/products/${p.id}`} className="shrink-0">
                  {p.primary_image_url
                    ? <img src={p.primary_image_url} alt="" className="h-16 w-16 rounded-xl border border-ink-200 object-cover" />
                    : <span className="flex h-16 w-16 items-center justify-center rounded-xl bg-ink-100 text-xl">📦</span>}
                </Link>
                <div className="min-w-0 flex-1">
                  <Link to={`/business/products/${p.id}`} className="line-clamp-2 text-sm font-bold hover:text-brand-700">
                    {p.name}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="sh-money text-sm font-extrabold">{formatMoney(p.price, p.currency)}</span>
                    <StatusBadge status={p.is_published ? 'published' : 'draft'} />
                    {p.track_inventory && (
                      <Badge tone={stockQty <= 0 ? 'red' : stockQty <= toNum(p.stock_alert) ? 'amber' : 'green'}>
                        {stockQty <= 0 ? 'Out' : `${stockQty} in stock`}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 truncate font-mono text-[10px] text-ink-400">{p.sku ?? '—'} · {p.barcode ?? 'no barcode'}</p>
                </div>
                <button type="button" onClick={() => setActionFor(p)}
                  className="h-fit shrink-0 rounded-lg p-1.5 text-ink-400 hover:bg-ink-100" aria-label="Product actions">
                  <Icon name="more" size={17} />
                </button>
              </div>
            </li>
          );
        })}
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

      <ActionSheet
        open={Boolean(actionFor)}
        onClose={() => setActionFor(null)}
        title={actionFor?.name}
        items={buildActions(actionFor, {
          canWrite,
          canSeeCost,
          onEdit: (p) => navigate(`/business/products/${p.id}/edit`),
          onView: (p) => navigate(`/business/products/${p.id}`),
          onPublish: (p) => void setPublished([p.id], !p.is_published),
          onDuplicate: (p) => void duplicate(p),
          onArchive: (p) => void archive(p),
          onDelete: (p) => void remove(p),
          onLabels: (p) => { setLabelsFor([p]); setLabelsOpen(true); },
          onStock: (p) => navigate(`/business/inventory?product=${p.id}`),
        })}
      />

      <LabelSheetModal
        open={labelsOpen}
        onClose={() => setLabelsOpen(false)}
        products={labelsFor}
        business={activeBusiness}
        showCost={canSeeCost}
      />
    </div>
  );
}

function buildActions(p: ProductRow | null, handlers: {
  canWrite: boolean; canSeeCost: boolean;
  onEdit: (p: ProductRow) => void; onView: (p: ProductRow) => void;
  onPublish: (p: ProductRow) => void; onDuplicate: (p: ProductRow) => void;
  onArchive: (p: ProductRow) => void; onDelete: (p: ProductRow) => void;
  onLabels: (p: ProductRow) => void; onStock: (p: ProductRow) => void;
}): ActionItem[] {
  if (!p) return [];
  const items: ActionItem[] = [
    { label: 'View details', icon: <Icon name="eye" size={17} />, onSelect: () => handlers.onView(p) },
    { label: 'Price labels & barcode', icon: <Icon name="barcode" size={17} />, onSelect: () => handlers.onLabels(p) },
    { label: 'Stock & movements', icon: <Icon name="box" size={17} />, onSelect: () => handlers.onStock(p) },
  ];
  if (handlers.canWrite) {
    items.push(
      { label: 'Edit product', icon: <Icon name="edit" size={17} />, onSelect: () => handlers.onEdit(p) },
      {
        label: p.is_published ? 'Unpublish' : 'Publish to store',
        icon: <Icon name={p.is_published ? 'eyeOff' : 'eye'} size={17} />,
        onSelect: () => handlers.onPublish(p),
      },
      { label: 'Duplicate', icon: <Icon name="copy" size={17} />, onSelect: () => handlers.onDuplicate(p) },
      { label: 'Archive', icon: <Icon name="package" size={17} />, onSelect: () => handlers.onArchive(p) },
      { label: 'Delete product', icon: <Icon name="trash" size={17} />, tone: 'danger', onSelect: () => handlers.onDelete(p) },
    );
  }
  return items;
}

const NON_COPYABLE = new Set([
  'id', 'created_at', 'updated_at', 'published_at', 'search_vector', 'created_by',
  'business', 'category', 'variants', 'inventory', 'deleted_at', 'qr_token',
]);

function stripCopy(p: Product): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(p as unknown as Record<string, unknown>).filter(([k]) => !NON_COPYABLE.has(k)),
  );
}

function CategoryFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { topLevel, childrenOf } = useCategories('both');
  const [parentId, setParentId] = useState('');
  const children = parentId ? childrenOf(parentId) : [];
  return (
    <div className="flex gap-2">
      <Select value={parentId} onChange={(e) => { setParentId(e.target.value); onChange(''); }} className="w-auto"
        placeholder="All categories"
        options={topLevel.map((c) => ({ value: c.id, label: c.name }))} />
      {children.length > 0 && (
        <Select value={value} onChange={(e) => onChange(e.target.value)} className="w-auto" placeholder="Subcategory"
          options={children.map((c) => ({ value: c.id, label: c.name }))} />
      )}
    </div>
  );
}

/* ── Price labels ──────────────────────────────────────────────────────────── */

export function LabelSheetModal({ open, onClose, products, business, showCost }: {
  open: boolean; onClose: () => void; products: ProductRow[];
  /** Only the store name is printed, so the loose shape keeps call sites simple. */
  business: { name: string; slug: string; phone?: string | null; primary_color?: string; base_currency?: string };
  showCost: boolean;
}) {
  const { success, error: toastError } = useToast();
  const [sizeKey, setSizeKey] = useState<string>(LABEL_SIZES[0].key);
  const [perRow, setPerRow] = useState(2);
  const [copies, setCopies] = useState(1);
  const [withBarcode, setWithBarcode] = useState(true);
  const [busy, setBusy] = useState(false);

  const size = LABEL_SIZES.find((s) => s.key === sizeKey) ?? LABEL_SIZES[0];
  const perSheet = Math.max(1, Math.floor(210 / size.h) * perRow);

  const generate = async () => {
    if (products.length === 0) return;
    setBusy(true);
    try {
      const labels = products.flatMap((p) =>
        Array.from({ length: copies }).map(() => ({
          name: p.name,
          price: toNum(p.price),
          currency: p.currency,
          sku: p.sku,
          compareAt: p.compare_at_price ? toNum(p.compare_at_price) : null,
          barcode: withBarcode ? (p.barcode ?? undefined) : undefined,
          barcodeFormat: p.barcode ? detectFormat(p.barcode) : 'code128',
          businessName: business.name,
          unit: p.unit,
        })),
      );
      const doc = await buildLabelSheet({ labels, size: { w: size.w, h: size.h }, perRow, showBarcode: withBarcode });
      savePdf(doc, `seedwel-labels-${new Date().toISOString().slice(0, 10)}.pdf`);
      success('Labels generated', `${labels.length} labels ready to print at 100% scale.`);
      onClose();
    } catch (e) {
      toastError('Could not build the label sheet', e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Price labels" size="md"
      subtitle={`${products.length} product${products.length === 1 ? '' : 's'} selected`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" icon="print" loading={busy} disabled={products.length === 0} onClick={() => void generate()}>
            Generate PDF
          </Button>
        </>
      }>
      {products.length === 0 ? (
        <Notice tone="info">Select one or more products first, then open Price labels.</Notice>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Label size" value={sizeKey} onChange={(e) => setSizeKey(e.target.value)}
              options={LABEL_SIZES.map((s) => ({ value: s.key, label: s.label }))} />
            <Select label="Copies per product" value={String(copies)} onChange={(e) => setCopies(Number(e.target.value))}
              options={[1, 2, 3, 4, 6, 8, 12, 24].map((n) => ({ value: String(n), label: `${n} ×` }))} />
            <Select label="Labels per row" value={String(perRow)} onChange={(e) => setPerRow(Number(e.target.value))}
              options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: `${n} per row` }))} />
            <div className="rounded-xl bg-ink-50 p-3 text-xs text-ink-600">
              <span className="block font-bold text-ink-800">About {perSheet} labels per A4 sheet</span>
              {size.w} × {size.h} mm · cut along the printed guides
            </div>
          </div>

          <div className="space-y-2 rounded-xl border border-ink-200 p-3">
            <Switch checked={withBarcode} onChange={setWithBarcode} label="Print scannable barcode"
              hint="The counter can scan the label straight into the POS." />
            <p className="text-[11px] text-ink-500">
              Cost price is never printed on customer-facing labels.
              {showCost ? '' : ' Your role cannot see cost prices anyway.'}
            </p>
          </div>

          <p className="text-xs text-ink-600">
            Total labels: <span className="font-bold">{products.length * copies}</span> ·
            sheets: <span className="font-bold">{Math.ceil((products.length * copies) / perSheet)}</span> ·
            print at 100% (turn off “fit to page”).
          </p>
        </div>
      )}
    </Modal>
  );
}

/* ── Product editor ────────────────────────────────────────────────────────── */

/** One editable variant row; `id` is empty for variants not yet saved. */
interface VariantDraft {
  id: UUID | '';
  name: string;
  sku: string;
  barcode: string;
  price: number | null;
  cost_price: number;
  wholesale_price: number | null;
  stock: number;
  stock_alert: number;
  image_url: string | null;
  option_values: Record<string, string>;
  is_active: boolean;
  is_default: boolean;
}

interface ProductForm {
  name: string;
  short_description: string;
  description: string;
  brand: string;
  model: string;
  sku: string;
  barcode: string;
  barcode_format: string;
  category_id: string;
  product_type: string;
  condition: string;
  unit: string;
  currency: string;
  price: number;
  compare_at_price: number | null;
  cost_price: number;
  tax_id: string;
  is_taxable: boolean;
  is_wholesale: boolean;
  wholesale_price: number | null;
  wholesale_min_qty: number;
  min_purchase_qty: number;
  track_inventory: boolean;
  stock: number;
  stock_alert: number;
  stock_max: number | null;
  allow_backorder: boolean;
  weight_kg: number | null;
  requires_delivery: boolean;
  delivery_days: number | null;
  warranty: string;
  service_duration_minutes: number | null;
  service_area: string;
  is_quotation_only: boolean;
  tags: string;
  status: string;
  is_published: boolean;
  is_featured: boolean;
  media: UploadedImage[];
  primary_image_url: string | null;
  variants: VariantDraft[];
  variant_options: { name: string; values: string[] }[];
  has_variants: boolean;
  warehouse_id: string;
}

const EMPTY_FORM: ProductForm = {
  name: '', short_description: '', description: '', brand: '', model: '', sku: '', barcode: '',
  barcode_format: 'code128', category_id: '', product_type: 'product', condition: 'new', unit: 'piece',
  currency: 'ZMW', price: 0, compare_at_price: null, cost_price: 0, tax_id: '', is_taxable: true,
  is_wholesale: false, wholesale_price: null, wholesale_min_qty: 10, min_purchase_qty: 1,
  track_inventory: true, stock: 0, stock_alert: 5, stock_max: null, allow_backorder: false,
  weight_kg: null, requires_delivery: false, delivery_days: null, warranty: '',
  service_duration_minutes: null, service_area: '', is_quotation_only: false, tags: '',
  status: 'draft', is_published: false, is_featured: false, media: [], primary_image_url: null,
  variants: [], variant_options: [], has_variants: false, warehouse_id: '',
};

export function ProductEditorPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const { activeBusiness, can, defaultTax, warehouses } = useBusiness();
  const { success, error: toastError } = useToast();
  const { topLevel, childrenOf, categories } = useCategories('both');

  const [form, setForm] = useState<ProductForm>({ ...EMPTY_FORM });
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState('basics');
  const [parentCategory, setParentCategory] = useState('');
  const [barcodeSvg, setBarcodeSvg] = useState<string | null>(null);
  const [slugPreview, setSlugPreview] = useState('');
  const topRef = useRef<HTMLDivElement>(null);

  const canSeeCost = can('reports.read');
  const currency = form.currency;

  useEffect(() => {
    if (!activeBusiness) return;
    setForm((f) => ({
      ...f,
      currency: f.currency || activeBusiness.base_currency,
      tax_id: f.tax_id || defaultTax?.id || '',
      is_taxable: defaultTax ? true : f.is_taxable,
      warehouse_id: f.warehouse_id || warehouses[0]?.id || '',
    }));
  }, [activeBusiness, defaultTax, warehouses]);

  useEffect(() => {
    if (isNew || !id) return;
    let alive = true;
    (async () => {
      setLoading(true);
      const { data, error: e } = await db.from('products')
        .select('*, variants:product_variants(*)')
        .eq('id', id).maybeSingle();
      if (!alive) return;
      if (e || !data) { setError(e?.message ?? 'That product no longer exists.'); setLoading(false); return; }
      const p = data as unknown as Product & { variants?: ProductVariant[] };
      setForm({
        name: p.name ?? '', short_description: p.short_description ?? '', description: p.description ?? '',
        brand: p.brand ?? '', model: p.model ?? '', sku: p.sku ?? '', barcode: p.barcode ?? '',
        barcode_format: p.barcode_format ?? 'code128', category_id: p.category_id ?? '',
        product_type: p.product_type ?? 'product', condition: p.condition ?? 'new', unit: p.unit ?? 'piece',
        currency: p.currency ?? 'ZMW', price: toNum(p.price), compare_at_price: p.compare_at_price ? toNum(p.compare_at_price) : null,
        cost_price: toNum(p.cost_price), tax_id: p.tax_id ?? '', is_taxable: p.is_taxable ?? true,
        is_wholesale: p.is_wholesale ?? false,
        wholesale_price: p.wholesale_price ? toNum(p.wholesale_price) : null,
        wholesale_min_qty: p.wholesale_min_qty ?? 10, min_purchase_qty: p.min_purchase_qty ?? 1,
        track_inventory: p.track_inventory ?? true, stock: Math.round(toNum(p.stock ?? 0)),
        stock_alert: p.stock_alert ?? 5, stock_max: p.stock_max ?? null, allow_backorder: p.allow_backorder ?? false,
        weight_kg: p.weight_kg ? toNum(p.weight_kg) : null, requires_delivery: p.requires_delivery ?? false,
        delivery_days: p.delivery_days ?? null, warranty: p.warranty ?? '',
        service_duration_minutes: p.service_duration_minutes ?? null, service_area: p.service_area ?? '',
        is_quotation_only: p.is_quotation_only ?? false, tags: (p.tags ?? []).join(', '),
        status: p.status ?? 'draft', is_published: p.is_published ?? false, is_featured: p.is_featured ?? false,
        media: (p.media ?? []).filter((m) => (m.type ?? 'image') === 'image')
          .map((m) => ({ url: m.url, path: m.url, name: m.alt ?? 'photo', size: 0, type: 'image' as const })),
        primary_image_url: p.primary_image_url,
        variants: (p.variants ?? []).map((v) => ({
          id: v.id,
          name: v.name,
          sku: v.sku ?? '',
          barcode: v.barcode ?? '',
          price: v.price === null ? null : toNum(v.price),
          cost_price: toNum(v.cost_price),
          wholesale_price: v.wholesale_price === null ? null : toNum(v.wholesale_price),
          stock: v.stock ?? 0,
          stock_alert: v.stock_alert ?? 0,
          image_url: v.image_url,
          option_values: v.option_values ?? {},
          is_active: v.is_active ?? true,
          is_default: v.is_default ?? false,
        })),
        variant_options: p.variant_options ?? [],
        has_variants: p.has_variants ?? (p.variants?.length ?? 0) > 0,
        warehouse_id: warehouses[0]?.id ?? '',
      });
      setSlugPreview(p.slug ?? '');
      setLoading(false);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isNew]);

  // Barcode preview as the seller types.
  useEffect(() => {
    if (!form.barcode) { setBarcodeSvg(null); return; }
    let alive = true;
    const fmt = detectFormat(form.barcode);
    renderBarcode(form.barcode, { format: fmt === 'qrcode' ? 'code128' : fmt })
      .then((svg) => { if (alive) setBarcodeSvg(svg); })
      .catch(() => { if (alive) setBarcodeSvg(null); });
    return () => { alive = false; };
  }, [form.barcode]);

  const set = (patch: Partial<ProductForm>) => setForm((f) => ({ ...f, ...patch }));

  const children = parentCategory ? childrenOf(parentCategory) : [];
  const selectedCategory = categories.find((c) => c.id === form.category_id);

  useEffect(() => {
    if (selectedCategory?.parent_id) setParentCategory(selectedCategory.parent_id);
  }, [selectedCategory]);

  const margin = marginPercent(form.price, form.cost_price);
  const profitPerUnit: number = Number(form.price ?? 0) - Number(form.cost_price ?? 0);

  const validate = (): string | null => {
    if (!form.name.trim()) return 'Give the product a name.';
    if (form.price <= 0) return 'Set a selling price above zero.';
    if (form.is_wholesale && (form.wholesale_price ?? 0) <= 0) return 'Set a wholesale price or turn wholesale off.';
    if (form.is_wholesale && form.wholesale_min_qty < 2) return 'The wholesale minimum quantity must be at least 2.';
    if (form.compare_at_price !== null && form.compare_at_price <= form.price) return 'The compare-at price must be higher than the selling price.';
    if (form.barcode && form.barcode_format === 'ean13' && !isValidEan13(form.barcode)) return 'That EAN-13 barcode check digit is wrong.';
    if (form.product_type !== 'service' && form.track_inventory && form.stock < 0) return 'Opening stock cannot be negative.';
    return null;
  };

  const save = async (publish?: boolean) => {
    if (!activeBusiness) return;
    const problem = validate();
    if (problem) { setError(problem); topRef.current?.scrollIntoView({ behavior: 'smooth' }); return; }
    setError(null);
    setSaving(true);

    const isPublished = publish ?? form.is_published;
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      short_description: form.short_description.trim() || null,
      description: form.description.trim() || null,
      brand: form.brand.trim() || null,
      model: form.model.trim() || null,
      sku: form.sku.trim().toUpperCase() || null,
      barcode: form.barcode.trim() || null,
      barcode_format: form.barcode_format,
      category_id: form.category_id || null,
      product_type: form.product_type,
      condition: form.condition,
      unit: form.unit,
      currency: form.currency,
      price: form.price,
      compare_at_price: form.compare_at_price,
      ...(canSeeCost ? { cost_price: form.cost_price } : {}),
      tax_id: form.is_taxable ? (form.tax_id || null) : null,
      is_taxable: form.is_taxable,
      is_wholesale: form.is_wholesale,
      wholesale_price: form.is_wholesale ? form.wholesale_price : null,
      wholesale_min_qty: form.is_wholesale ? form.wholesale_min_qty : 1,
      min_purchase_qty: form.min_purchase_qty,
      track_inventory: form.track_inventory,
      stock_alert: form.stock_alert,
      stock_max: form.stock_max,
      // Stock always starts at 0 on create — adjustStock (called right after
      // insert) moves the opening balance in and records the movement row, so
      // the product document and the audit trail can never disagree.
      ...(isNew ? { stock: 0, stock_status: form.track_inventory ? 'out_of_stock' : null } : {}),
      allow_backorder: form.allow_backorder,
      weight_kg: form.weight_kg,
      requires_delivery: form.requires_delivery,
      delivery_days: form.delivery_days,
      warranty: form.warranty.trim() || null,
      service_duration_minutes: form.service_duration_minutes,
      service_area: form.service_area.trim() || null,
      is_quotation_only: form.is_quotation_only,
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      status: form.status === 'archived' || form.status === 'blocked'
        ? form.status
        : isPublished ? 'active' : 'draft',
      is_published: isPublished,
      is_featured: form.is_featured,
      has_variants: form.has_variants,
      variant_options: form.has_variants ? form.variant_options : [],
      published_at: isPublished ? undefined : null,
      media: form.media.map((m, i) => ({
        url: m.url, type: 'image' as const, alt: `${form.name} photo ${i + 1}`, position: i,
      })),
      primary_image_url: form.primary_image_url ?? form.media[0]?.url ?? null,
    };

    try {
      // Product documents carry the snapshots the storefront renders (owning
      // business + category) so no per-row join is needed anywhere else.
      const categoryDoc = form.category_id
        ? await fetchById<{ id: string; name: string; slug: string; path?: string | null }>('categories', form.category_id).catch(() => null)
        : null;
      const snap: Record<string, unknown> = {
        business: productBusinessSnapshot(activeBusiness as never),
        category: categoryDoc ? { id: categoryDoc.id, name: categoryDoc.name ?? '', slug: categoryDoc.slug ?? '', path: categoryDoc.path ?? null, icon: null } : null,
      };

      let productId: UUID | undefined = id as UUID | undefined;
      if (isNew) {
        const { data, error: e } = await db.from('products')
          .insert({ ...payload, ...snap, business_id: activeBusiness.id })
          .select('id')
          .single();
        if (e) throw e;
        productId = (data as { id: UUID }).id;

        // Record the opening balance as a movement so the audit trail starts
        // here — the product doc starts at 0 and adjustStock moves it in.
        if (form.track_inventory && form.stock !== 0) {
          const { adjustStock } = await import('@/lib/api');
          await adjustStock({
            businessId: activeBusiness.id,
            productId: productId,
            quantityChange: form.stock,
            movementType: 'opening_balance',
            warehouseId: form.warehouse_id || null,
            unitCost: canSeeCost ? form.cost_price : null,
            referenceType: 'product',
            referenceId: productId,
            reason: 'Opening stock set when the product was created',
          }).catch(() => undefined);
        }
      } else {
        const { error: e } = await db.from('products').update({ ...payload, ...snap }).eq('id', id);
        if (e) throw e;
      }

      // Variants are saved separately so a failure there never loses the product.
      await saveVariants(productId!);

      success(isNew ? 'Product created' : 'Product saved',
        isPublished ? `${form.name} is live in your store.` : `${form.name} saved as a draft.`);
      navigate(`/business/products/${productId}`, { replace: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message.replace(/^.*?exception:\s*/i, '') : 'Could not save the product.';
      setError(msg);
      toastError('Could not save', msg);
      topRef.current?.scrollIntoView({ behavior: 'smooth' });
    } finally {
      setSaving(false);
    }
  };

  /** Upsert variants: variants live *inside* the product document, so editing
   *  them is one document patch (rows with an id are kept/updated, the rest
   *  are removed — exactly the old delete-others semantics). */
  const saveVariants = async (productId: UUID) => {
    const existing = await fetchById<Product & { variants?: ProductVariant[] }>('products', productId).catch(() => null);
    const keepIds = new Set(form.variants.filter((v) => v.id).map((v) => v.id as UUID));
    const kept: ProductVariant[] = (existing?.variants ?? []).filter((v) => keepIds.has(v.id));

    let order = 0;
    for (const v of form.variants) {
      order += 1;
      const rec: ProductVariant = {
        id: (v.id as UUID) ?? newId(),
        product_id: productId,
        name: v.name.trim() || `Option ${order}`,
        sku: v.sku.trim() || null,
        barcode: v.barcode.trim() || null,
        price: v.price && v.price > 0 ? v.price : null,
        compare_at_price: null,
        cost_price: toNum(v.cost_price ?? 0),
        wholesale_price: v.wholesale_price && v.wholesale_price > 0 ? v.wholesale_price : null,
        stock: toNum(v.stock ?? 0),
        stock_alert: toNum(v.stock_alert ?? 0),
        image_url: v.image_url,
        option_values: v.option_values,
        is_active: v.is_active,
        is_default: v.is_default,
        sort_order: order,
      };
      const idx = kept.findIndex((k) => k.id === rec.id);
      if (idx >= 0) kept[idx] = rec; else kept.push(rec);
    }
    kept.sort((a, b) => toNum(a.sort_order) - toNum(b.sort_order));
    await patchRow('products', productId, { variants: kept });
  };

  const generateBarcode = () => {
    const code = generateInternalBarcode('SH');
    set({ barcode: code, barcode_format: 'code128' });
    success('Barcode generated', `${code} — print it on your labels.`);
  };

  if (!activeBusiness) return null;
  if (!can('products.write') && !isNew) {
    return <DeniedPanel message={missingPermissionMessage('products.write')} />;
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div ref={topRef} className="space-y-4">
      <PageHeader
        backTo="/business/products"
        title={isNew ? 'Add product' : `Edit · ${form.name || 'Product'}`}
        subtitle={isNew
          ? 'Only a name and a price are required — you can fill in the rest later.'
          : `Status: ${form.status.replace(/_/g, ' ')} · ${form.is_published ? 'published in your store' : 'not published'}`}
        icon="🏷️"
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => navigate('/business/products')} disabled={saving}>Cancel</Button>
            <Button size="sm" variant="outline" icon="check" loading={saving} onClick={() => void save(false)}>
              Save draft
            </Button>
            <Button size="sm" icon="eye" loading={saving} onClick={() => void save(true)}>
              {isNew ? 'Create & publish' : 'Save & publish'}
            </Button>
          </>
        }
      />

      {error && <Notice tone="danger" title="Check the form">{error}</Notice>}

      <Tabs
        variant="pill"
        tabs={[
          { key: 'basics', label: 'Basics' },
          { key: 'pricing', label: 'Pricing & tax' },
          { key: 'inventory', label: 'Stock' },
          { key: 'media', label: 'Photos' },
          { key: 'variants', label: 'Variants' },
          { key: 'shipping', label: 'Delivery & service' },
          { key: 'advanced', label: 'Advanced' },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="sh-card space-y-4 p-4">
          {tab === 'basics' && (
            <>
              <Input label="Product name" required value={form.name} onChange={(e) => set({ name: e.target.value })}
                placeholder="e.g. Steel office chair — black" autoFocus />
              <Input label="Short description" value={form.short_description}
                onChange={(e) => set({ short_description: e.target.value })}
                placeholder="One line shown in search results and on the cart" maxLength={200} />
              <Textarea label="Full description" rows={6} value={form.description}
                onChange={(e) => set({ description: e.target.value })}
                placeholder="Materials, dimensions, what is in the box, warranty, care instructions…" />

              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="Brand" value={form.brand} onChange={(e) => set({ brand: e.target.value })} placeholder="e.g. Dormax" />
                <Input label="Model" value={form.model} onChange={(e) => set({ model: e.target.value })} />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Select label="Category" placeholder="Choose a category"
                  value={children.length > 0 && !selectedCategory?.parent_id ? parentCategory : form.category_id}
                  onChange={(e) => {
                    const v = e.target.value;
                    const cat = categories.find((c) => c.id === v);
                    if (cat && childrenOf(cat.id).length > 0) setParentCategory(v);
                    else set({ category_id: v });
                  }}
                  options={(parentCategory ? children : topLevel).map((c) => ({ value: c.id, label: `${c.icon ?? ''} ${c.name}`.trim() }))} />
                {parentCategory && (
                  <Button variant="ghost" size="sm" className="mt-6" icon="arrowLeft"
                    onClick={() => setParentCategory('')}>
                    Back to top-level categories
                  </Button>
                )}
                <Select label="Product type" value={form.product_type} onChange={(e) => set({ product_type: e.target.value })}
                  options={[
                    { value: 'product', label: 'Physical product' },
                    { value: 'service', label: 'Service' },
                    { value: 'wholesale', label: 'Wholesale item' },
                    { value: 'both', label: 'Product & service' },
                  ]} />
                <Select label="Condition" value={form.condition} onChange={(e) => set({ condition: e.target.value })}
                  options={[
                    { value: 'new', label: 'New' },
                    { value: 'refurbished', label: 'Refurbished' },
                    { value: 'used', label: 'Used' },
                  ]} />
                <Select label="Selling unit" value={form.unit} onChange={(e) => set({ unit: e.target.value })}
                  options={UNITS.map((u) => ({ value: u, label: u }))} />
              </div>

              <Input label="Tags" value={form.tags} onChange={(e) => set({ tags: e.target.value })}
                placeholder="chair, office, furniture" hint="Comma separated. Tags improve search." />
            </>
          )}

          {tab === 'pricing' && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Select label="Currency" value={form.currency} onChange={(e) => set({ currency: e.target.value })}
                  options={['ZMW', 'USD', 'ZAR', 'BWP', 'MWK', 'TZS', 'KES', 'GBP', 'EUR'].map((c) => ({ value: c, label: c }))} />
                <MoneyInput label="Selling price" required currency={currency} value={form.price}
                  onChange={(v) => set({ price: v })} />
                <MoneyInput label="Compare-at price" currency={currency} value={form.compare_at_price ?? ''}
                  onChange={(v) => set({ compare_at_price: v > 0 ? v : null })}
                  hint="Shows a struck-through “was” price and a discount badge." />
                <Input label="Minimum order quantity" type="number" min={1} value={String(form.min_purchase_qty)}
                  onChange={(e) => set({ min_purchase_qty: Math.max(1, Number(e.target.value) || 1) })} />
              </div>

              {canSeeCost ? (
                <div className="rounded-2xl border border-ink-200 p-3">
                  <p className="sh-field-label">Cost & margin</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <MoneyInput label="Cost price (what you pay)" currency={currency} value={form.cost_price}
                      onChange={(v) => set({ cost_price: v })} />
                    <div className="rounded-xl bg-ink-50 p-3">
                      <p className="sh-label">Margin</p>
                      <p className={`mt-1 text-xl font-extrabold ${margin >= 30 ? 'text-emerald-600' : margin >= 10 ? 'text-amber-600' : 'text-red-600'}`}>
                        {margin.toFixed(1)}%
                      </p>
                      <p className="text-xs text-ink-500">
                        {formatMoney(profitPerUnit, currency)} profit per {form.unit}
                        {form.cost_price > 0 ? ` · markup ${(((form.price - form.cost_price) / form.cost_price) * 100).toFixed(0)}%` : ''}
                      </p>
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] text-ink-500">
                    Cost price is only visible to roles with reports.read — cashiers and salespeople never see it.
                  </p>
                </div>
              ) : (
                <Notice tone="warning" title="Cost price hidden for your role" icon="lock">
                  Your role cannot view or edit cost prices. Ask the business owner if you need this.
                </Notice>
              )}

              <div className="rounded-2xl border border-ink-200 p-3">
                <Switch checked={form.is_taxable} onChange={(v) => set({ is_taxable: v })}
                  label="Charge tax on this product" />
                {form.is_taxable && (
                  <div className="mt-3">
                    <TaxSelect value={form.tax_id} onChange={(v) => set({ tax_id: v })} />
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-ink-200 p-3">
                <Switch checked={form.is_wholesale} onChange={(v) => set({ is_wholesale: v })}
                  label="Offer a wholesale price"
                  hint="Buyers who reach the minimum quantity get the bulk price automatically." />
                {form.is_wholesale && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <MoneyInput label="Wholesale price per unit" currency={currency} value={form.wholesale_price ?? ''}
                      onChange={(v) => set({ wholesale_price: v > 0 ? v : null })} />
                    <Input label="Minimum quantity" type="number" min={2} value={String(form.wholesale_min_qty)}
                      onChange={(e) => set({ wholesale_min_qty: Math.max(2, Number(e.target.value) || 2) })} />
                  </div>
                )}
                {form.is_wholesale && form.wholesale_price && form.wholesale_price > 0 && (
                  <p className="mt-2 text-xs font-semibold text-brand-700">
                    Retail {formatMoney(form.price, currency)} · wholesale {formatMoney(form.wholesale_price, currency)} from
                    {' '}{form.wholesale_min_qty} {form.unit}s — a buyer of {form.wholesale_min_qty} saves
                    {' '}{formatMoney((form.price - form.wholesale_price) * form.wholesale_min_qty, currency)}.
                  </p>
                )}
              </div>

              <div className="rounded-2xl border border-ink-200 p-3">
                <Switch checked={form.is_quotation_only} onChange={(v) => set({ is_quotation_only: v })}
                  label="Quotation only — no fixed price online"
                  hint="Buyers request a quote instead of adding to cart. Useful for custom work." />
              </div>
            </>
          )}

          {tab === 'inventory' && (
            <>
              <Switch checked={form.track_inventory} onChange={(v) => set({ track_inventory: v })}
                label="Track stock for this product"
                hint="Stock decreases on every sale and increases when you receive goods." />

              {form.track_inventory && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {isNew ? (
                    <Input label="Opening stock" type="number" value={String(form.stock)}
                      onChange={(e) => set({ stock: Number(e.target.value) || 0 })}
                      hint="Recorded as an opening-balance stock movement." />
                  ) : (
                    <div className="rounded-xl bg-ink-50 p-3">
                      <p className="sh-label">Current stock</p>
                      <p className="mt-0.5 text-xl font-extrabold">{form.stock}</p>
                      <p className="text-xs text-ink-500">
                        Change stock from Inventory → Adjust, so every movement is logged.
                      </p>
                      <Link to={`/business/inventory?product=${id}`}>
                        <Button size="sm" variant="outline" className="mt-2" icon="box">Open inventory</Button>
                      </Link>
                    </div>
                  )}
                  <Select label="Warehouse" value={form.warehouse_id} onChange={(e) => set({ warehouse_id: e.target.value })}
                    options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
                    placeholder={warehouses.length ? undefined : 'No warehouses yet'} />
                  <Input label="Low-stock alert at" type="number" min={0} value={String(form.stock_alert)}
                    onChange={(e) => set({ stock_alert: Number(e.target.value) || 0 })}
                    hint="You get a notification and a dashboard task at this level." />
                  <Input label="Maximum stock (optional)" type="number" min={0} value={String(form.stock_max ?? '')}
                    onChange={(e) => set({ stock_max: e.target.value ? Number(e.target.value) : null })} />
                </div>
              )}

              {form.track_inventory && (
                <div className="rounded-2xl border border-ink-200 p-3">
                  <Switch checked={form.allow_backorder} onChange={(v) => set({ allow_backorder: v })}
                    label="Allow backorders"
                    hint="Buyers can order when stock is zero; you commit to sourcing it." />
                </div>
              )}

              {!isNew && (
                <RecentMovements productId={id!} />
              )}
            </>
          )}

          {tab === 'media' && (
            <>
              <ImageUploader
                bucket={BUCKETS.products}
                scope={activeBusiness.slug}
                sub={isNew ? 'new' : String(id)}
                multiple
                max={8}
                images={form.media}
                onImagesChange={(imgs) => set({
                  media: imgs,
                  primary_image_url: imgs[0]?.url ?? null,
                })}
                label="Product photos"
                hint="First photo is the main image. Square photos look best in the grid."
              />
              {form.media.length > 1 && (
                <div>
                  <p className="sh-field-label">Main image</p>
                  <div className="flex flex-wrap gap-2">
                    {form.media.map((m, i) => (
                      <button key={m.path} type="button"
                        onClick={() => set({
                          media: [m, ...form.media.filter((_, idx) => idx !== i)],
                          primary_image_url: m.url,
                        })}
                        className={`h-16 w-16 overflow-hidden rounded-xl border-2 ${
                          form.primary_image_url === m.url ? 'border-brand-500' : 'border-transparent'
                        }`}
                        aria-label={`Make image ${i + 1} the main image`}>
                        <img src={m.url} alt="" className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {tab === 'variants' && (
            <VariantsEditor
              variants={form.variants}
              hasVariants={form.has_variants}
              currency={currency}
              canSeeCost={canSeeCost}
              onToggle={(v) => set({ has_variants: v })}
              onChange={(v) => set({ variants: v })}
              onOptionsChange={(opts) => set({ variant_options: opts })}
            />
          )}

          {tab === 'shipping' && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="Weight (kg)" type="number" step="0.01" min={0} value={String(form.weight_kg ?? '')}
                  onChange={(e) => set({ weight_kg: e.target.value ? Number(e.target.value) : null })} />
                <Input label="Delivery days (estimate)" type="number" min={0} value={String(form.delivery_days ?? '')}
                  onChange={(e) => set({ delivery_days: e.target.value ? Number(e.target.value) : null })} />
              </div>
              <Switch checked={form.requires_delivery} onChange={(v) => set({ requires_delivery: v })}
                label="This item must be delivered" hint="Collection-only items keep this off." />
              <Input label="Warranty" value={form.warranty} onChange={(e) => set({ warranty: e.target.value })}
                placeholder="12 months parts and labour" />

              {(form.product_type === 'service' || form.product_type === 'both') && (
                <div className="grid gap-3 rounded-2xl border border-ink-200 p-3 sm:grid-cols-2">
                  <Input label="Typical duration (minutes)" type="number" min={0}
                    value={String(form.service_duration_minutes ?? '')}
                    onChange={(e) => set({ service_duration_minutes: e.target.value ? Number(e.target.value) : null })} />
                  <Input label="Service area" value={form.service_area}
                    onChange={(e) => set({ service_area: e.target.value })} placeholder="Lusaka and within 50 km" />
                </div>
              )}
            </>
          )}

          {tab === 'advanced' && (
            <>
              <div className="rounded-2xl border border-ink-200 p-3">
                <p className="sh-field-label">SKU & barcode</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input label="SKU" value={form.sku} onChange={(e) => set({ sku: e.target.value.toUpperCase() })}
                    placeholder="CHR-STL-BLK" hint="Your internal code. Used by CSV sync and the POS." />
                  <div>
                    <Input label="Barcode" value={form.barcode} onChange={(e) => set({ barcode: e.target.value })}
                      placeholder="6001234567890" />
                    <Button size="sm" variant="outline" icon="barcode" className="mt-2" onClick={generateBarcode}>
                      Generate a Seedwel barcode
                    </Button>
                  </div>
                </div>

                {form.barcode && (
                  <div className="mt-3 rounded-xl border border-ink-200 bg-white p-3 text-center">
                    <BarcodeImage svg={barcodeSvg} alt={`Barcode ${form.barcode}`} height={64} />
                    <p className="mt-1 font-mono text-xs text-ink-500">{form.barcode}</p>
                    {form.barcode_format === 'ean13' && !isValidEan13(form.barcode) && (
                      <p className="mt-1 text-xs font-bold text-red-600">
                        Invalid EAN-13 — the check digit does not match.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Select label="Status" value={form.status} onChange={(e) => set({ status: e.target.value })}
                  options={[
                    { value: 'draft', label: 'Draft' },
                    { value: 'active', label: 'Active' },
                    { value: 'out_of_stock', label: 'Out of stock' },
                    { value: 'archived', label: 'Archived' },
                  ]} />
                <div className="space-y-2 rounded-xl border border-ink-200 p-3">
                  <Switch checked={form.is_published} onChange={(v) => set({ is_published: v })}
                    label="Published in store" />
                  <Switch checked={form.is_featured} onChange={(v) => set({ is_featured: v })}
                    label="Featured (shows in Deals & homepage)" />
                </div>
              </div>

              {!isNew && slugPreview && (
                <div className="rounded-xl bg-ink-50 p-3 text-xs text-ink-600">
                  Public URL: <span className="font-mono font-bold">seedwelhub.com/product/{slugPreview}</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Live preview */}
        <aside className="space-y-3 lg:sticky lg:top-32 lg:self-start">
          <div className="sh-card-flat overflow-hidden">
            <p className="sh-label border-b border-ink-100 px-3 py-2">Storefront preview</p>
            <div className="aspect-square bg-ink-100">
              {form.primary_image_url ?? form.media[0]?.url
                ? <img src={(form.primary_image_url ?? form.media[0]?.url)!} alt="" className="h-full w-full object-cover" />
                : <div className="flex h-full items-center justify-center text-4xl opacity-40">📦</div>}
            </div>
            <div className="p-3">
              <p className="line-clamp-2 text-sm font-bold">{form.name || 'Product name'}</p>
              {form.short_description && <p className="mt-0.5 line-clamp-2 text-xs text-ink-500">{form.short_description}</p>}
              <p className="sh-money mt-1.5 text-lg font-extrabold">{formatMoney(form.price, currency)}</p>
              {form.compare_at_price && form.compare_at_price > form.price && (
                <p className="text-xs text-ink-400 line-through">{formatMoney(form.compare_at_price, currency)}</p>
              )}
              {form.is_wholesale && form.wholesale_price && (
                <p className="text-[11px] font-semibold text-brand-700">
                  Wholesale {formatMoney(form.wholesale_price, currency)} from {form.wholesale_min_qty}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-1">
                {form.track_inventory && (
                  <Badge tone={form.stock <= 0 ? 'red' : form.stock <= form.stock_alert ? 'amber' : 'green'}>
                    {form.stock <= 0 ? 'Out of stock' : `${form.stock} in stock`}
                  </Badge>
                )}
                {form.is_featured && <Badge tone="accent" icon="fire">Hot</Badge>}
                {form.has_variants && <Badge tone="blue">Variants</Badge>}
              </div>
            </div>
          </div>

          {canSeeCost && (
            <div className="sh-card-flat p-3">
              <p className="sh-label">Profitability</p>
              <dl className="mt-2 space-y-1 text-sm">
                <div className="flex justify-between"><dt className="text-ink-500">Price</dt><dd className="sh-money">{formatMoney(form.price, currency)}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-500">Cost</dt><dd className="sh-money">{formatMoney(form.cost_price, currency)}</dd></div>
                <div className="flex justify-between border-t border-ink-100 pt-1">
                  <dt className="font-bold">Profit / {form.unit}</dt>
                  <dd className={`sh-money font-extrabold ${profitPerUnit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                    {formatMoney(profitPerUnit, currency)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-500">Margin</dt>
                  <dd className="sh-money font-bold">{margin.toFixed(1)}%</dd>
                </div>
                {form.track_inventory && (
                  <div className="flex justify-between border-t border-ink-100 pt-1">
                    <dt className="text-ink-500">Stock value</dt>
                    <dd className="sh-money font-bold">{formatMoney(stockValue(form.stock, form.cost_price, currency), currency)}</dd>
                  </div>
                )}
              </dl>
              {margin < 10 && form.cost_price > 0 && (
                <p className="mt-2 rounded-lg bg-amber-50 p-2 text-[11px] font-semibold text-amber-800">
                  Margin below 10% — check the cost price or raise the selling price.
                </p>
              )}
            </div>
          )}

          <div className="sh-card-flat p-3">
            <p className="sh-label">Checklist</p>
            <ul className="mt-2 space-y-1.5 text-xs">
              <Check ok={Boolean(form.name.trim())} label="Name" />
              <Check ok={form.price > 0} label="Selling price" />
              <Check ok={Boolean(form.primary_image_url || form.media[0])} label="At least one photo" />
              <Check ok={Boolean(form.category_id)} label="Category (improves discovery)" />
              <Check ok={canSeeCost ? form.cost_price > 0 : true} label="Cost price (enables profit reports)" />
              <Check ok={Boolean(form.sku)} label="SKU (needed for CSV sync)" />
              <Check ok={Boolean(form.barcode)} label="Barcode (needed for POS scanning)" />
              <Check ok={Boolean(form.short_description)} label="Short description" />
            </ul>
          </div>

          <div className="grid gap-2">
            <Button icon="check" variant="outline" loading={saving} onClick={() => void save(false)}>Save draft</Button>
            <Button icon="eye" loading={saving} onClick={() => void save(true)}>
              {isNew ? 'Create & publish' : 'Save & publish'}
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className={`flex items-center gap-1.5 ${ok ? 'text-emerald-700' : 'text-ink-500'}`}>
      <Icon name={ok ? 'success' : 'alert'} size={13} /> {label}
    </li>
  );
}

function TaxSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { activeBusiness } = useBusiness();
  const [taxes, setTaxes] = useState<{ id: UUID; name: string; rate: number; is_default: boolean }[]>([]);

  useEffect(() => {
    if (!activeBusiness) return;
    (async () => {
      const { data } = await db.from('taxes')
        .select('id,name,rate,is_default').eq('business_id', activeBusiness.id).eq('is_active', true);
      setTaxes((data ?? []) as never);
    })();
  }, [activeBusiness]);

  return (
    <Select label="Tax rate" value={value} onChange={(e) => onChange(e.target.value)}
      placeholder={taxes.length ? 'No tax' : 'No tax rates set up yet'}
      options={taxes.map((t) => ({ value: t.id, label: `${t.name} · ${Number(t.rate)}%${t.is_default ? ' (default)' : ''}` }))}
      hint={taxes.length === 0 ? 'Add tax rates under Money → Taxes.' : undefined} />
  );
}

function VariantsEditor({ variants, hasVariants, currency, canSeeCost, onToggle, onChange, onOptionsChange }: {
  variants: VariantDraft[]; hasVariants: boolean; currency: string; canSeeCost: boolean;
  onToggle: (v: boolean) => void; onChange: (v: VariantDraft[]) => void;
  /** Keeps products.variant_options in sync so the storefront can render pickers. */
  onOptionsChange: (opts: { name: string; values: string[] }[]) => void;
}) {
  const [optionNames, setOptionNames] = useState<{ name: string; values: string }[]>([
    { name: 'Size', values: '' },
  ]);

  const blank = (index: number): VariantDraft => ({
    id: '', name: `Option ${index + 1}`, sku: '', barcode: '', price: null, cost_price: 0,
    wholesale_price: null, stock: 0, stock_alert: 0, image_url: null, option_values: {},
    is_active: true, is_default: false,
  });

  const addVariant = () => onChange([...variants, blank(variants.length)]);

  const update = (index: number, patch: Partial<VariantDraft>) =>
    onChange(variants.map((v, i) => (i === index ? { ...v, ...patch } : v)));

  const remove = (index: number) => onChange(variants.filter((_, i) => i !== index));

  /** Turn "Size: S,M,L" + "Colour: Red,Blue" into 6 concrete variant rows. */
  const generateFromOptions = () => {
    const combos = optionNames
      .map((o) => ({ name: o.name.trim(), values: o.values.split(',').map((v) => v.trim()).filter(Boolean) }))
      .filter((o) => o.name && o.values.length > 0);
    if (combos.length === 0) return;

    let list: { name: string; option_values: Record<string, string> }[] = [{ name: '', option_values: {} }];
    combos.forEach((combo) => {
      const next: typeof list = [];
      list.forEach((item) => combo.values.forEach((val) => next.push({
        name: [item.name, val].filter(Boolean).join(' / '),
        option_values: { ...item.option_values, [combo.name]: val },
      })));
      list = next;
    });

    onOptionsChange(combos.map((c) => ({ name: c.name, values: c.values })));

    const base = variants[0];
    onChange(list.map((l, i) => ({
      ...blank(i),
      name: l.name,
      option_values: l.option_values,
      price: base?.price ?? null,
      cost_price: base?.cost_price ?? 0,
      stock: base?.stock ?? 0,
      stock_alert: base?.stock_alert ?? 0,
      is_default: i === 0,
    })));
  };

  return (
    <div className="space-y-4">
      <Switch checked={hasVariants} onChange={onToggle}
        label="This product has options (size, colour, pack size)"
        hint="Each option gets its own price, SKU, barcode and stock level." />

      {hasVariants && (
        <>
          <div className="rounded-2xl border border-ink-200 p-3">
            <p className="sh-field-label">Generate combinations</p>
            {optionNames.map((opt, i) => (
              <div key={i} className="mb-2 grid items-end gap-2 sm:grid-cols-[10rem_1fr_auto]">
                <Input label={i === 0 ? 'Option name' : undefined} value={opt.name} placeholder="Size"
                  onChange={(e) => setOptionNames(optionNames.map((o, idx) => idx === i ? { ...o, name: e.target.value } : o))} />
                <Input label={i === 0 ? 'Values (comma separated)' : undefined} value={opt.values}
                  placeholder="S, M, L, XL"
                  onChange={(e) => setOptionNames(optionNames.map((o, idx) => idx === i ? { ...o, values: e.target.value } : o))} />
                <Button variant="ghost" size="sm" icon="trash" className="text-red-600"
                  onClick={() => setOptionNames(optionNames.filter((_, idx) => idx !== i))}
                  aria-label={`Remove option ${opt.name || i + 1}`} />
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" icon="plus"
                onClick={() => setOptionNames([...optionNames, { name: '', values: '' }])}>
                Add option
              </Button>
              <Button size="sm" icon="sparkles" onClick={generateFromOptions}>Generate variants</Button>
            </div>
            <p className="mt-2 text-[11px] text-ink-500">
              Generating replaces the list below with every combination. Set prices and stock per variant afterwards.
            </p>
          </div>

          {variants.length === 0 ? (
            <EmptyState icon="box" title="No variants yet"
              description="Generate them from the options above, or add them one by one."
              action={<Button size="sm" icon="plus" onClick={addVariant}>Add a variant</Button>} />
          ) : (
            <ul className="space-y-2">
              {variants.map((v, i) => (
                <li key={v.id || `${v.name}-${i}`} className="rounded-2xl border border-ink-200 p-3">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <p className="sh-label">Variant {i + 1}</p>
                    <div className="flex items-center gap-2">
                      <Checkbox checked={v.is_default} onChange={(c) => update(i, { is_default: c })} label="Default" />
                      <Button size="sm" variant="ghost" icon="trash" className="text-red-600"
                        onClick={() => remove(i)} aria-label={`Remove variant ${v.name}`} />
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <Input label="Option name" value={v.name} onChange={(e) => update(i, { name: e.target.value })}
                      placeholder="Black / XL" />
                    <Input label="SKU" value={v.sku} onChange={(e) => update(i, { sku: e.target.value.toUpperCase() })} />
                    <Input label="Barcode" value={v.barcode} onChange={(e) => update(i, { barcode: e.target.value })} />
                    <MoneyInput label="Price (blank = use product price)" currency={currency}
                      value={v.price ?? ''} onChange={(n) => update(i, { price: n > 0 ? n : null })} />
                    {canSeeCost && (
                      <MoneyInput label="Cost" currency={currency} value={v.cost_price}
                        onChange={(n) => update(i, { cost_price: n })} />
                    )}
                    <Input label="Opening stock" type="number" value={String(v.stock)}
                      onChange={(e) => update(i, { stock: Number(e.target.value) || 0 })} />
                  </div>
                  <div className="mt-2">
                    <Checkbox checked={v.is_active} onChange={(c) => update(i, { is_active: c })}
                      label="Available for sale" />
                  </div>
                  {Object.keys(v.option_values).length > 0 && (
                    <p className="mt-1.5 text-[11px] text-ink-500">
                      {Object.entries(v.option_values).map(([k, val]) => `${k}: ${val}`).join(' · ')}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}

          {variants.length > 0 && (
            <Button size="sm" variant="outline" icon="plus" onClick={addVariant}>Add another variant</Button>
          )}
        </>
      )}
    </div>
  );
}

function RecentMovements({ productId }: { productId: UUID }) {
  const [rows, setRows] = useState<{ id: UUID; movement_type: string; quantity_change: number; created_at: string; reference_number: string | null; reason: string | null }[]>([]);

  useEffect(() => {
    (async () => {
      const { data } = await db.from('inventory_movements')
        .select('id,movement_type,quantity_change,created_at,reference_number,reason')
        .eq('product_id', productId).order('created_at', { ascending: false }).limit(8);
      setRows((data ?? []) as never);
    })();
  }, [productId]);

  if (rows.length === 0) return null;
  return (
    <div className="rounded-2xl border border-ink-200 p-3">
      <p className="sh-field-label">Recent stock movements</p>
      <ul className="space-y-1 text-xs">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2">
            <span className="truncate text-ink-600">
              <span className="font-bold capitalize">{r.movement_type.replace(/_/g, ' ')}</span>
              {r.reference_number ? ` · ${r.reference_number}` : ''}
              {r.reason ? ` · ${r.reason}` : ''}
            </span>
            <span className={`shrink-0 font-bold ${r.quantity_change >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {r.quantity_change >= 0 ? '+' : ''}{r.quantity_change}
            </span>
            <span className="shrink-0 text-ink-400">{formatDate(r.created_at)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Product detail (seller view) ──────────────────────────────────────────── */

export function ProductDetailBusinessPage() {
  const { id } = useParams<{ id: string }>();
  const { activeBusiness, can } = useBusiness();
  const navigate = useNavigate();
  const [product, setProduct] = useState<(Product & { variants?: ProductVariant[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [movements, setMovements] = useState<{ id: UUID; movement_type: string; quantity_change: number; quantity_before: number; quantity_after: number; created_at: string; reference_number: string | null; reason: string | null; performed_by_name: string | null }[]>([]);
  const [stockOpen, setStockOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);

  const canSeeCost = can('reports.read');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [{ data }, { data: mv }] = await Promise.all([
      db.from('products').select('*, variants:product_variants(*), category:categories(id,name,slug)').eq('id', id).maybeSingle(),
      db.from('inventory_movements')
        .select('id,movement_type,quantity_change,quantity_before,quantity_after,created_at,reference_number,reason,performed_by_name')
        .eq('product_id', id).order('created_at', { ascending: false }).limit(20),
    ]);
    setProduct((data as never) ?? null);
    setMovements((mv ?? []) as never);
    setLoading(false);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <Skeleton className="h-96 w-full rounded-2xl" />;
  if (!product || !activeBusiness) {
    return <EmptyState icon="tag" title="Product not found"
      action={<Link to="/business/products"><Button size="sm">Back to products</Button></Link>} />;
  }

  const stockQty = Math.round(toNum(product.stock));
  const currency = product.currency;

  return (
    <div className="space-y-4">
      <PageHeader
        backTo="/business/products"
        title={product.name}
        subtitle={`${product.sku ?? 'No SKU'} · ${product.category?.name ?? 'Uncategorised'} · updated ${relativeTime(product.updated_at)}`}
        icon="🏷️"
        actions={
          <>
            <Button size="sm" variant="outline" icon="external" onClick={() => window.open(`/product/${product.slug ?? product.id}`, '_blank', 'noopener')}>
              View in store
            </Button>
            <Button size="sm" variant="outline" icon="barcode" onClick={() => setLabelsOpen(true)}>Labels</Button>
            {can('inventory.adjust') && (
              <Button size="sm" variant="outline" icon="box" onClick={() => setStockOpen(true)}>Adjust stock</Button>
            )}
            {can('products.write') && (
              <Button size="sm" icon="edit" onClick={() => navigate(`/business/products/${product.id}/edit`)}>Edit</Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="sh-card-flat overflow-hidden">
            {product.primary_image_url
              ? <img src={product.primary_image_url} alt="" className="aspect-square w-full object-cover" />
              : <div className="flex aspect-square items-center justify-center bg-ink-100 text-5xl opacity-40">📦</div>}
          </div>
          {(product.media ?? []).filter((m) => m.url !== product.primary_image_url).length > 0 && (
            <div className="sh-rail">
              {(product.media ?? []).filter((m) => m.url !== product.primary_image_url).map((m) => (
                <img key={m.url} src={m.url} alt="" className="h-16 w-16 shrink-0 rounded-xl border border-ink-200 object-cover" />
              ))}
            </div>
          )}
          <div className="sh-card-flat divide-y divide-ink-100 text-sm">
            <DetailRow label="Status"><StatusBadge status={product.is_published ? 'published' : 'draft'} /></DetailRow>
            <DetailRow label="Price"><span className="sh-money font-extrabold">{formatMoney(product.price, currency)}</span></DetailRow>
            {canSeeCost && <DetailRow label="Cost"><span className="sh-money">{formatMoney(product.cost_price, currency)}</span></DetailRow>}
            {canSeeCost && <DetailRow label="Margin"><Badge tone={marginPercent(toNum(product.price), toNum(product.cost_price)) >= 30 ? 'green' : 'amber'}>{marginPercent(toNum(product.price), toNum(product.cost_price)).toFixed(1)}%</Badge></DetailRow>}
            <DetailRow label="Stock">
              <Badge tone={stockQty <= 0 ? 'red' : stockQty <= toNum(product.stock_alert) ? 'amber' : 'green'}>
                {product.track_inventory ? `${stockQty} ${product.unit}s` : 'Not tracked'}
              </Badge>
            </DetailRow>
            {canSeeCost && product.track_inventory && (
              <DetailRow label="Stock value">
                <span className="sh-money">{formatMoney(stockValue(stockQty, toNum(product.cost_price), currency), currency)}</span>
              </DetailRow>
            )}
            <DetailRow label="Sold"><span className="font-bold">{product.sold_count}</span></DetailRow>
            <DetailRow label="Views"><span className="font-bold">{product.view_count}</span></DetailRow>
            <DetailRow label="Rating">
              <span className="font-bold">{toNum(product.rating_avg).toFixed(1)} ★</span>
              <span className="text-xs text-ink-500"> ({product.rating_count})</span>
            </DetailRow>
            <DetailRow label="Barcode"><span className="font-mono text-xs">{product.barcode ?? '—'}</span></DetailRow>
            <DetailRow label="Source"><Badge tone="neutral">{product.source}</Badge></DetailRow>
            {product.last_synced_at && <DetailRow label="Last CSV sync"><span className="text-xs">{relativeTime(product.last_synced_at)}</span></DetailRow>}
          </div>
        </div>

        <div className="space-y-4">
          {product.description && (
            <div className="sh-card-flat p-4">
              <h2 className="text-sm font-extrabold">Description</h2>
              <p className="mt-1.5 whitespace-pre-line text-sm text-ink-700">{product.description}</p>
            </div>
          )}

          {(product.variants?.length ?? 0) > 0 && (
            <div className="sh-card-flat overflow-hidden">
              <h2 className="border-b border-ink-100 px-4 py-3 text-sm font-extrabold">Variants ({product.variants!.length})</h2>
              <div className="overflow-x-auto">
                <table className="sh-table">
                  <thead>
                    <tr>
                      <th>Option</th><th>SKU</th><th className="text-right">Price</th>
                      {canSeeCost && <th className="text-right">Cost</th>}
                      <th className="text-right">Stock</th>
                    </tr>
                  </thead>
                  <tbody>
                    {product.variants!.map((v) => (
                      <tr key={v.id}>
                        <td className="font-semibold">{v.name}</td>
                        <td className="font-mono text-[11px]">{v.sku ?? '—'}</td>
                        <td className="sh-money text-right">{formatMoney(v.price, currency)}</td>
                        {canSeeCost && <td className="sh-money text-right text-ink-600">{formatMoney(v.cost_price, currency)}</td>}
                        <td className="text-right font-bold">{v.stock ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="sh-card-flat overflow-hidden">
            <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
              <h2 className="text-sm font-extrabold">Stock movements</h2>
              <Link to={`/business/inventory/movements?product=${product.id}`}>
                <Button variant="ghost" size="sm" iconRight="chevronRight">All movements</Button>
              </Link>
            </div>
            {movements.length === 0 ? (
              <p className="p-6 text-center text-sm text-ink-500">
                No stock movements yet. Sales, purchases, transfers and adjustments all appear here.
              </p>
            ) : (
              <ul className="divide-y divide-ink-100">
                {movements.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                      m.quantity_change >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                    }`}>
                      <Icon name={m.quantity_change >= 0 ? 'arrowUp' : 'arrowDown'} size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold capitalize">{m.movement_type.replace(/_/g, ' ')}</span>
                      <span className="block truncate text-xs text-ink-500">
                        {m.reference_number ?? m.reason ?? '—'}{m.performed_by_name ? ` · ${m.performed_by_name}` : ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={`sh-money block text-sm font-extrabold ${m.quantity_change >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {m.quantity_change >= 0 ? '+' : ''}{m.quantity_change}
                      </span>
                      <span className="block text-[11px] text-ink-400">→ {m.quantity_after}</span>
                    </span>
                    <span className="w-20 shrink-0 text-right text-[11px] text-ink-400">{formatDate(m.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <StockAdjustModal open={stockOpen} onClose={() => setStockOpen(false)} product={product} onDone={() => { setStockOpen(false); void load(); }} />
      <LabelSheetModal open={labelsOpen} onClose={() => setLabelsOpen(false)} products={[product as ProductRow]}
        business={activeBusiness} showCost={canSeeCost} />
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-2">
      <span className="text-xs font-semibold text-ink-500">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}

export function StockAdjustModal({ open, onClose, product, onDone }: {
  open: boolean; onClose: () => void; product: Product; onDone: () => void;
}) {
  const { activeBusiness, warehouses, can } = useBusiness();
  const { success, error: toastError } = useToast();
  const [type, setType] = useState('adjustment');
  const [qty, setQty] = useState(0);
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '');
  const [reason, setReason] = useState('');
  const [cost, setCost] = useState(toNum(product.cost_price));
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setQty(0); setReason(''); setType('adjustment'); } }, [open]);

  const run = async () => {
    if (!activeBusiness) return;
    if (qty === 0) { toastError('Enter a quantity', 'Use a negative number to reduce stock.'); return; }
    setBusy(true);
    try {
      const { adjustStock } = await import('@/lib/api');
      await adjustStock({
        businessId: activeBusiness.id,
        productId: product.id,
        quantityChange: qty,
        movementType: type,
        warehouseId: warehouseId || null,
        unitCost: cost || null,
        reason: reason.trim() || null,
        referenceType: 'product',
        referenceId: product.id,
      });
      success('Stock updated', `${product.name}: ${qty > 0 ? '+' : ''}${qty}`);
      onDone();
    } catch (e) {
      toastError('Could not adjust stock', e instanceof Error ? e.message.replace(/^.*?exception:\s*/i, '') : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Adjust stock · ${product.name}`} size="sm"
      subtitle={`Current stock ${Math.round(toNum(product.stock))} ${product.unit}s`}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" loading={busy} onClick={() => void run()}>Apply movement</Button>
        </>
      }>
      <div className="space-y-3">
        <Select label="Movement type" value={type} onChange={(e) => setType(e.target.value)}
          options={[
            { value: 'adjustment', label: 'Manual adjustment (count correction)' },
            { value: 'damage', label: 'Damaged / written off' },
            { value: 'theft', label: 'Lost or stolen' },
            { value: 'expiry', label: 'Expired' },
            { value: 'return_in', label: 'Customer return received' },
            { value: 'sample', label: 'Sample given away' },
            { value: 'opening_balance', label: 'Opening balance' },
          ]} />
        <Input label="Quantity change" type="number" value={String(qty)} required
          onChange={(e) => setQty(Number(e.target.value) || 0)}
          hint="Positive adds stock, negative removes it. e.g. -3 for three damaged units." />
        {warehouses.length > 1 && (
          <Select label="Warehouse" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
            options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
        )}
        {can('reports.read') && (
          <MoneyInput label="Unit cost for this movement" currency={product.currency} value={cost} onChange={setCost}
            hint="Used for stock valuation and profit on the affected units." />
        )}
        <Textarea label="Reason (recorded in the audit log)" rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder="Found 3 extra during shelf count" />
        <Notice tone="info" icon="history">
          Every adjustment is written to inventory_movements with who, when, before and after — you can reverse it later
          with an opposite movement, the history is never overwritten.
        </Notice>
      </div>
    </Modal>
  );
}
