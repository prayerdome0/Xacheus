import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon } from '@/components/ui/Icon';
import { Badge, Button, Checkbox, Input, Notice, Select } from '@/components/ui/Primitives';
import { EmptyState, Modal, ProductCard, ProductGrid, SearchBar, SkeletonCard } from '@/components/ui';
import { useCart } from '@/context/CartContext';
import { useToast } from '@/context/ToastContext';
import { useCategories } from '@/hooks/useCategories';
import { useDebounce, useGeolocation } from '@/hooks/useUi';
import { searchProducts, type SearchFilters } from '@/lib/api';
import { formatMoney } from '@/lib/currency';
import { BRAND, COUNTRIES, COUNTRY_BY_CODE, flagEmoji } from '@/lib/constants';
import type { Product, UUID } from '@/types';

/**
 * Powerful search: natural-language queries ("Black shoes under K500"),
 * full-text + trigram matching in Postgres, and the complete filter set —
 * price, category, brand, condition, stock, rating, location, wholesale.
 *
 * Filters live in the URL so any result page is shareable and survives refresh.
 */

type SortKey = NonNullable<SearchFilters['sort']>;

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'relevance', label: 'Most relevant' },
  { value: 'popular', label: 'Best selling' },
  { value: 'newest', label: 'Newest first' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'rating', label: 'Top rated' },
  { value: 'name', label: 'Name A–Z' },
];

const PRICE_BANDS: { label: string; min?: number; max?: number }[] = [
  { label: 'Under K100', max: 100 },
  { label: 'K100 – K500', min: 100, max: 500 },
  { label: 'K500 – K1,000', min: 500, max: 1000 },
  { label: 'K1,000 – K5,000', min: 1000, max: 5000 },
  { label: 'K5,000 – K20,000', min: 5000, max: 20000 },
  { label: 'Over K20,000', min: 20000 },
];

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const { categories, topLevel, childrenOf } = useCategories('both');
  const { add } = useCart();
  const { success } = useToast();
  const geo = useGeolocation(false);

  const q = params.get('q') ?? '';
  const categorySlug = params.get('category') ?? '';
  const city = params.get('city') ?? '';
  const country = params.get('country') ?? '';
  const minPrice = params.get('min_price') ? Number(params.get('min_price')) : null;
  const maxPrice = params.get('max_price') ? Number(params.get('max_price')) : null;
  const minRating = params.get('min_rating') ? Number(params.get('min_rating')) : null;
  const inStock = params.get('in_stock') === '1';
  const brand = params.get('brand') ?? '';
  const condition = params.get('condition') ?? '';
  const wholesale = params.get('wholesale') === '1';
  const featured = params.get('featured') === '1';
  const sort = (params.get('sort') as SortKey) ?? 'relevance';
  const page = Math.max(1, Number(params.get('page') ?? 1));
  const pageSize = 24;

  const [draftQ, setDraftQ] = useState(q);
  const debouncedQ = useDebounce(draftQ, 400);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [brands, setBrands] = useState<string[]>([]);

  useEffect(() => { setDraftQ(q); }, [q]);

  const setParam = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    });
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  }, [params, setParams]);

  // Live search-as-you-type when the user edits the box (not the URL).
  useEffect(() => {
    if (debouncedQ === q) return;
    setParam({ q: debouncedQ || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQ]);

  const category = categorySlug
    ? categories.find((c) => c.slug === categorySlug) ?? null
    : null;

  const descendantIds = useMemo(() => {
    if (!category) return null;
    const ids: UUID[] = [category.id];
    const walk = (parentId: UUID) => {
      categories.filter((c) => c.parent_id === parentId).forEach((c) => { ids.push(c.id); walk(c.id); });
    };
    walk(category.id);
    return ids;
  }, [category, categories]);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await searchProducts({
        q: q || undefined,
        category_id: descendantIds ? descendantIds[0] : null,
        city: city || null,
        country_code: country || null,
        min_price: minPrice,
        max_price: maxPrice,
        min_rating: minRating,
        in_stock: inStock,
        brand: brand || null,
        condition: condition || null,
        wholesale_only: wholesale,
        featured_only: featured,
        sort,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      });
      setItems(res.items);
      setTotal(res.total);

      // Facet: brand list from the current result set.
      const found = new Set<string>();
      res.items.forEach((p) => { if (p.brand) found.add(p.brand); });
      setBrands((prev) => {
        if (found.size === 0) return prev;
        const merged = Array.from(new Set([...prev, ...found])).sort();
        return merged.slice(0, 40);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^.*?exception:\s*/i, '') : 'Search failed.');
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [q, descendantIds, city, country, minPrice, maxPrice, minRating, inStock, brand, condition,
      wholesale, featured, sort, page]);

  useEffect(() => { void run(); }, [run]);

  const activeFilters = [
    category && { key: 'category', label: category.name, clear: () => setParam({ category: null }) },
    city && { key: 'city', label: `In ${city}`, clear: () => setParam({ city: null }) },
    country && { key: 'country', label: `${flagEmoji(country)} ${COUNTRY_BY_CODE[country]?.name ?? country}`, clear: () => setParam({ country: null }) },
    minPrice !== null && { key: 'min', label: `From ${formatMoney(minPrice)}`, clear: () => setParam({ min_price: null }) },
    maxPrice !== null && { key: 'max', label: `Up to ${formatMoney(maxPrice)}`, clear: () => setParam({ max_price: null }) },
    minRating !== null && { key: 'rating', label: `${minRating}★ & up`, clear: () => setParam({ min_rating: null }) },
    inStock && { key: 'stock', label: 'In stock', clear: () => setParam({ in_stock: null }) },
    brand && { key: 'brand', label: brand, clear: () => setParam({ brand: null }) },
    condition && { key: 'condition', label: condition, clear: () => setParam({ condition: null }) },
    wholesale && { key: 'wholesale', label: 'Wholesale', clear: () => setParam({ wholesale: null }) },
    featured && { key: 'featured', label: 'Featured', clear: () => setParam({ featured: null }) },
  ].filter(Boolean) as { key: string; label: string; clear: () => void }[];

  const clearAll = () => setParams(q ? new URLSearchParams({ q }) : new URLSearchParams(), { replace: true });

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const filterPanel = (
    <div className="space-y-5">
      {/* Category */}
      <FilterBlock title="Category" icon="grid">
        <div className="space-y-1">
          <CategoryRow label="All categories" active={!categorySlug} onClick={() => setParam({ category: null })} />
          {topLevel.slice(0, 14).map((c) => {
            const kids = childrenOf(c.id);
            return (
              <div key={c.id}>
                <CategoryRow
                  label={c.name} emoji={c.icon}
                  active={categorySlug === c.slug}
                  onClick={() => setParam({ category: c.slug })}
                />
                {category && (category.id === c.id || descendantIds?.includes(c.id)) && kids.length > 0 && (
                  <div className="ml-4 mt-0.5 space-y-0.5 border-l border-ink-200 pl-3">
                    {kids.map((k) => (
                      <CategoryRow key={k.id} label={k.name} emoji={k.icon} small
                        active={categorySlug === k.slug}
                        onClick={() => setParam({ category: k.slug })} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {topLevel.length > 14 && (
            <Link to="/categories" className="block px-2 py-1.5 text-xs font-bold text-brand-700 hover:underline">
              Browse all {topLevel.length} categories
            </Link>
          )}
        </div>
      </FilterBlock>

      {/* Price */}
      <FilterBlock title="Price" icon="tag">
        <div className="flex flex-wrap gap-1.5">
          {PRICE_BANDS.map((b) => {
            const active = minPrice === (b.min ?? null) && maxPrice === (b.max ?? null);
            return (
              <button key={b.label} type="button"
                onClick={() => setParam({
                  min_price: b.min !== undefined ? String(b.min) : null,
                  max_price: b.max !== undefined ? String(b.max) : null,
                })}
                className={`sh-pill ${active ? 'sh-pill-brand' : 'sh-pill-neutral hover:bg-ink-200'}`}>
                {b.label}
              </button>
            );
          })}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Input label="Min" type="number" inputMode="decimal" min={0} placeholder="0"
            value={minPrice ?? ''} onChange={(e) => setParam({ min_price: e.target.value || null })} />
          <Input label="Max" type="number" inputMode="decimal" min={0} placeholder="Any"
            value={maxPrice ?? ''} onChange={(e) => setParam({ max_price: e.target.value || null })} />
        </div>
      </FilterBlock>

      {/* Location */}
      <FilterBlock title="Location" icon="pin">
        <Select label="Country" value={country} onChange={(e) => setParam({ country: e.target.value || null })}
          options={[
            { value: '', label: 'Anywhere in the world' },
            ...COUNTRIES.map((c) => ({ value: c.code, label: `${flagEmoji(c.code)} ${c.name}` })),
          ]} />
        <Input placeholder="City, e.g. Lusaka" value={city}
          onChange={(e) => setParam({ city: e.target.value || null })} />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {['Lusaka', 'Ndola', 'Kitwe', 'Livingstone', 'Kabwe', 'Solwezi'].map((c) => (
            <button key={c} type="button" onClick={() => setParam({ city: city === c ? null : c })}
              className={`sh-pill ${city === c ? 'sh-pill-brand' : 'sh-pill-neutral hover:bg-ink-200'}`}>{c}</button>
          ))}
        </div>
        <Button variant="outline" size="sm" icon="map" className="mt-2" loading={geo.loading}
          onClick={() => void geo.locate()}>
          {geo.granted ? 'Location set — see Nearby' : 'Use my location'}
        </Button>
        {geo.granted && (
          <Link to="/nearby" className="mt-1 block text-xs font-bold text-brand-700 hover:underline">
            Open the Nearby page →
          </Link>
        )}
      </FilterBlock>

      {/* Availability & type */}
      <FilterBlock title="Availability" icon="box">
        <div className="space-y-2.5">
          <Checkbox checked={inStock} onChange={(v) => setParam({ in_stock: v ? '1' : null })}
            label="In stock only" hint="Hide sold-out items" />
          <Checkbox checked={wholesale} onChange={(v) => setParam({ wholesale: v ? '1' : null })}
            label="Wholesale only" hint="Bulk pricing with a minimum order quantity" />
          <Checkbox checked={featured} onChange={(v) => setParam({ featured: v ? '1' : null })}
            label="Featured by sellers" />
        </div>
      </FilterBlock>

      {/* Rating */}
      <FilterBlock title="Customer rating" icon="star">
        <div className="flex flex-wrap gap-1.5">
          {[4, 3, 2].map((r) => (
            <button key={r} type="button" onClick={() => setParam({ min_rating: minRating === r ? null : String(r) })}
              className={`sh-pill ${minRating === r ? 'sh-pill-brand' : 'sh-pill-neutral hover:bg-ink-200'}`}>
              <span className="text-accent-400">★</span> {r} & up
            </button>
          ))}
        </div>
      </FilterBlock>

      {/* Condition */}
      <FilterBlock title="Condition" icon="tag">
        <div className="flex flex-wrap gap-1.5">
          {['new', 'refurbished', 'used'].map((c) => (
            <button key={c} type="button" onClick={() => setParam({ condition: condition === c ? null : c })}
              className={`sh-pill ${condition === c ? 'sh-pill-brand' : 'sh-pill-neutral hover:bg-ink-200'}`}>
              {c[0].toUpperCase() + c.slice(1)}
            </button>
          ))}
        </div>
      </FilterBlock>

      {/* Brand */}
      {brands.length > 0 && (
        <FilterBlock title="Brand" icon="tag">
          <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
            {brands.map((b) => (
              <Checkbox key={b} checked={brand === b} onChange={(v) => setParam({ brand: v ? b : null })} label={b} />
            ))}
          </div>
        </FilterBlock>
      )}

      {activeFilters.length > 0 && (
        <Button variant="ghost" size="sm" block icon="close" onClick={clearAll}>Clear all filters</Button>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Search header */}
      <div className="sh-card-flat space-y-3 p-3 sm:p-4">
        <SearchBar
          value={draftQ}
          onChange={setDraftQ}
          onSubmit={() => setParam({ q: draftQ.trim() || null })}
          placeholder={BRAND.searchPlaceholder}
          autoFocus={!q}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" icon="filter" onClick={() => setFiltersOpen(true)} className="lg:hidden">
            Filters
            {activeFilters.length > 0 && (
              <span className="ml-1 rounded-full bg-brand-600 px-1.5 text-[10px] font-bold text-white">
                {activeFilters.length}
              </span>
            )}
          </Button>

          <Select
            value={sort}
            onChange={(e) => setParam({ sort: e.target.value })}
            options={SORTS}
            className="w-auto min-w-[11rem] [&_.sh-select]:py-1.5"
            aria-label="Sort results"
          />

          <span className="ml-auto text-xs font-semibold text-ink-500">
            {loading ? 'Searching…' : `${total.toLocaleString()} result${total === 1 ? '' : 's'}`}
          </span>
        </div>

        {activeFilters.length > 0 && (
          <div className="sh-rail pt-0.5">
            {activeFilters.map((f) => (
              <button key={f.key} type="button" onClick={f.clear}
                className="sh-pill sh-pill-brand group" title="Remove filter">
                {f.label}
                <Icon name="close" size={11} className="opacity-60 group-hover:opacity-100" />
              </button>
            ))}
            <button type="button" onClick={clearAll}
              className="sh-pill sh-pill-neutral text-red-600 hover:bg-red-50">
              Clear all
            </button>
          </div>
        )}

        {category && (
          <nav className="flex flex-wrap items-center gap-1 text-xs text-ink-500" aria-label="Breadcrumb">
            <Link to="/categories" className="font-semibold hover:text-brand-700">Categories</Link>
            <Icon name="chevronRight" size={12} />
            {category.path?.split('/').filter(Boolean).slice(0, -1).map((seg) => {
              const c = categories.find((x) => x.slug === seg);
              return c ? (
                <span key={seg} className="flex items-center gap-1">
                  <Link to={`/category/${c.slug}`} className="hover:text-brand-700">{c.name}</Link>
                  <Icon name="chevronRight" size={12} />
                </span>
              ) : null;
            })}
            <span className="font-bold text-ink-800">{category.name}</span>
          </nav>
        )}
      </div>

      <div className="flex gap-5">
        {/* Desktop filter rail */}
        <aside className="hidden w-[268px] shrink-0 lg:block">
          <div className="sh-card-flat sticky top-32 max-h-[calc(100dvh-10rem)] overflow-y-auto p-4">
            {filterPanel}
          </div>
        </aside>

        {/* Results */}
        <div className="min-w-0 flex-1">
          {error && (
            <div className="mb-4">
              <Notice tone="danger" title="Search failed" action={
                <Button variant="outline" size="sm" icon="refresh" onClick={() => void run()}>Try again</Button>
              }>{error}</Notice>
            </div>
          )}

          {loading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : items.length === 0 && !error ? (
            <EmptyState
              icon="search"
              title={q ? `No results for “${q}”` : 'Nothing matches these filters'}
              description={
                <>
                  Try a broader search — for example <span className="font-semibold">“shoes”</span> instead of
                  “black leather running shoes size 42”. You can also add price words like
                  {' '}<span className="font-semibold">“under K500”</span>.
                </>
              }
              action={
                <>
                  <Button variant="outline" size="sm" icon="close" onClick={clearAll}>Clear filters</Button>
                  <Link to="/categories"><Button size="sm" icon="grid">Browse categories</Button></Link>
                </>
              }
            />
          ) : (
            <>
              <ProductGrid cols={4}>
                {items.map((p) => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    onAddToCart={async (prod) => {
                      await add(prod);
                      success('Added to cart', `${prod.name} · ${formatMoney(prod.price, prod.currency)}`);
                    }}
                  />
                ))}
              </ProductGrid>

              {pageCount > 1 && (
                <nav className="mt-6 flex items-center justify-center gap-2" aria-label="Pagination">
                  <Button variant="outline" size="sm" icon="chevronLeft" disabled={page <= 1}
                    onClick={() => setParam({ page: String(page - 1) })}>
                    Previous
                  </Button>
                  <span className="text-sm font-semibold text-ink-600">
                    Page {page} of {pageCount}
                  </span>
                  <Button variant="outline" size="sm" iconRight="chevronRight" disabled={page >= pageCount}
                    onClick={() => setParam({ page: String(page + 1) })}>
                    Next
                  </Button>
                </nav>
              )}
            </>
          )}
        </div>
      </div>

      {/* Mobile filter modal */}
      <Modal open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filters"
        subtitle={`${total.toLocaleString()} result${total === 1 ? '' : 's'}`} size="md"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={clearAll}>Clear all</Button>
            <Button size="sm" onClick={() => setFiltersOpen(false)}>Show {total.toLocaleString()} results</Button>
          </>
        }>
        {filterPanel}
      </Modal>
    </div>
  );
}

function FilterBlock({ title, icon, children }: { title: string; icon: 'grid' | 'tag' | 'pin' | 'box' | 'star'; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b border-ink-100 pb-4 last:border-0">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="mb-2 flex w-full items-center gap-2 text-left">
        <Icon name={icon} size={15} className="text-ink-400" />
        <span className="sh-label flex-1">{title}</span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={15} className="text-ink-400" />
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

function CategoryRow({ label, emoji, active, onClick, small }: {
  label: string; emoji?: string | null; active: boolean; onClick: () => void; small?: boolean;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
        active ? 'bg-brand-50 text-brand-800' : 'text-ink-700 hover:bg-ink-100'
      } ${small ? 'text-xs' : 'text-[13px]'}`}>
      {emoji && <span aria-hidden="true" className="text-sm">{emoji}</span>}
      <span className={`min-w-0 flex-1 truncate ${active ? 'font-bold' : 'font-medium'}`}>{label}</span>
      {active && <Icon name="check" size={13} />}
    </button>
  );
}

/** Category landing page: description, children, and the products inside it. */
export function CategoryPage() {
  const [params] = useSearchParams();
  const { categories } = useCategories('both');
  const slug = params.get('slug') ?? '';
  const category = categories.find((c) => c.slug === slug) ?? null;

  return (
    <div className="space-y-4">
      {category ? (
        <div className="sh-card-flat p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-2xl" aria-hidden="true">
              {category.icon ?? '📦'}
            </span>
            <div>
              <h1 className="text-lg font-extrabold sm:text-xl">{category.name}</h1>
              {category.description && <p className="text-sm text-ink-500">{category.description}</p>}
            </div>
          </div>
        </div>
      ) : (
        <Notice tone="warning" title="Category not found">
          That category does not exist or has been renamed.
        </Notice>
      )}
      <SearchResultsEmbed categorySlug={slug} />
    </div>
  );
}

function SearchResultsEmbed({ categorySlug }: { categorySlug: string }) {
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const { add } = useCart();
  const { success } = useToast();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    searchProducts({ category_slug: categorySlug, limit: 24, sort: 'popular' })
      .then((r) => { if (alive) { setItems(r.items); setTotal(r.total); } })
      .catch(() => { if (alive) setItems([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [categorySlug]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <EmptyState icon="box" title="No products in this category yet"
        description={<Link to="/search" className="font-bold text-brand-700 hover:underline">Search the whole marketplace →</Link>} />
    );
  }
  return (
    <>
      <p className="text-xs font-semibold text-ink-500">{total} product{total === 1 ? '' : 's'}</p>
      <ProductGrid cols={4}>
        {items.map((p) => (
          <ProductCard key={p.id} product={p} onAddToCart={async (prod) => {
            await add(prod);
            success('Added to cart', prod.name);
          }} />
        ))}
      </ProductGrid>
    </>
  );
}

/** Wholesale landing page — bulk pricing across the marketplace. */
export function WholesalePage() {
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { add } = useCart();
  const { success } = useToast();

  useEffect(() => {
    searchProducts({ wholesale_only: true, sort: 'popular', limit: 48 })
      .then((r) => setItems(r.items))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-4">
      <div className="sh-card-flat p-4 sm:p-6">
        <Badge tone="accent" icon="box">Wholesale</Badge>
        <h1 className="mt-2 text-xl font-extrabold sm:text-2xl">Buy in bulk, pay less per unit</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-ink-600">
          Sellers list a retail price and a wholesale price with a minimum order quantity. Add enough units and the
          wholesale price applies automatically at checkout — the order is recorded as a wholesale sale for the seller.
        </p>
      </div>

      {error && <Notice tone="danger" title="Could not load wholesale products">{error}</Notice>}
      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon="box" title="No wholesale listings yet"
          description="Sellers can turn on wholesale pricing per product from Products → Edit → Wholesale." />
      ) : (
        <ProductGrid cols={4}>
          {items.map((p) => (
            <ProductCard key={p.id} product={p} onAddToCart={async (prod) => {
              await add(prod);
              success('Added to cart', `${prod.name} · wholesale from ${prod.wholesale_min_qty} ${prod.unit}s`);
            }} />
          ))}
        </ProductGrid>
      )}
    </div>
  );
}

