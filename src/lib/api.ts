import { runTransaction } from 'firebase/firestore';
import {
  fetchList,
  fetchRow,
  writeRow,
  addRow,
  patchRow,
  bumpCounter,
  nowIso,
  newId,
  docRef,
  getFirebaseDb,
  type DbWhere,
} from './db';
import { notifyBusinessMembers, notifyUser } from './notifications';
import { roundMoney, toNum } from './currency';
import { computeTotals, priceForQuantity } from './calc';
import { slugify } from './slug';
import { env } from './env';
import type {
  Business, BusinessSummary, Category, Customer, Invoice, InvoiceItem, Order, OrderChannel,
  OrderItem, Payment, Product, Quotation, QuotationItem, Receipt, UUID,
} from '@/types';

/**
 * Seedwel Hub — domain services on Cloud Firestore.
 *
 * These functions are the application's business layer. Every operation that
 * used to run as a Postgres RPC now runs against Firestore documents:
 *
 *  - orders/documents embed their line items and display snapshots (business,
 *    customer), so a single read serves a whole screen;
 *  - document/order numbers are allocated atomically from the business
 *    document's counters (`next_invoice_number`, …) inside a transaction;
 *  - stock movements are transactional reads/writes on the product document;
 *  - notifications (the old database triggers) are written to `notifications`
 *    for the buyer and for the business's active members.
 */

/* ── Search result rows ────────────────────────────────────────────────────── */

export interface SearchProductRow {
  id: UUID;
  name: string;
  slug: string;
  sku: string | null;
  barcode: string | null;
  brand: string | null;
  short_description: string | null;
  price: string | number;
  compare_at_price: string | number | null;
  wholesale_price: string | number | null;
  wholesale_min_qty: number;
  currency: string;
  stock: number;
  unit: string;
  condition: string;
  product_type: string;
  is_wholesale: boolean;
  is_featured: boolean;
  primary_image_url: string | null;
  media: Product['media'];
  rating_avg: string | number;
  rating_count: number;
  sold_count: number;
  view_count: number;
  created_at: string;
  category_id: UUID | null;
  category_name: string | null;
  category_slug: string | null;
  category_path: string | null;
  business_id: UUID;
  business_name: string;
  business_slug: string;
  business_logo: string | null;
  business_city: string | null;
  business_country: string;
  verification_status: string;
  business_rating: string | number;
  business_badges: string[];
  accepts_orders: boolean;
  delivery_enabled: boolean;
  delivery_fee?: string | number | null;
  free_delivery_over?: string | number | null;
  base_currency?: string;
}

/** search_products returns flat rows; the app renders nested objects. */
export function rowToProduct(row: SearchProductRow): Product {
  const business: BusinessSummary = {
    id: row.business_id,
    name: row.business_name,
    slug: row.business_slug,
    logo_url: row.business_logo,
    city: row.business_city,
    country_code: row.business_country,
    verification_status: row.verification_status as BusinessSummary['verification_status'],
    rating_avg: row.business_rating,
    badges: row.business_badges ?? [],
    accepts_orders: row.accepts_orders,
    delivery_enabled: row.delivery_enabled,
    delivery_fee: row.delivery_fee ?? 0,
    free_delivery_over: row.free_delivery_over ?? null,
    base_currency: row.base_currency,
  };
  const category: Product['category'] = row.category_id
    ? {
        id: row.category_id,
        name: row.category_name ?? '',
        slug: row.category_slug ?? '',
        path: row.category_path ?? '',
        icon: null,
      }
    : undefined;

  return {
    ...(row as unknown as Product),
    price: row.price,
    business,
    category,
  } as Product;
}

export interface SearchFilters {
  q?: string;
  category_id?: UUID | null;
  category_slug?: string | null;
  business_id?: UUID | null;
  store_slug?: string | null;
  city?: string | null;
  country_code?: string | null;
  min_price?: number | null;
  max_price?: number | null;
  min_rating?: number | null;
  in_stock?: boolean;
  brand?: string | null;
  condition?: string | null;
  product_type?: 'product' | 'service' | 'both' | null;
  wholesale_only?: boolean;
  retail_only?: boolean;
  featured_only?: boolean;
  sort?: 'relevance' | 'newest' | 'price_asc' | 'price_desc' | 'rating' | 'popular' | 'name';
  limit?: number;
  offset?: number;
}

export interface SearchPage<T> {
  items: T[];
  total: number;
  hasMore: boolean;
  limit: number;
  offset: number;
}

/**
 * Natural-language query parsing.
 *
 * "Black shoes under K500" → q:"black shoes", max_price:500
 * "maize meal 25kg above K200" → q:"maize meal 25kg", min_price:200
 * "laptops between K3000 and K6000" → min 3000, max 6000
 */
export function parseNaturalQuery(raw: string): { q: string; minPrice?: number; maxPrice?: number } {
  let text = raw.trim();
  let minPrice: number | undefined;
  let maxPrice: number | undefined;

  const money = String.raw`(?:K|ZMW|MK|R|P|\$)?\s*([\d,]+(?:\.\d+)?)`;

  // "between X and Y"
  const between = new RegExp(String.raw`between\s+${money}\s*(?:and|-|to)\s*${money}`, 'i');
  const bm = text.match(between);
  if (bm) {
    minPrice = Number(bm[1].replace(/,/g, ''));
    maxPrice = Number(bm[2].replace(/,/g, ''));
    text = text.replace(between, '');
  }

  if (minPrice === undefined) {
    const under = new RegExp(String.raw`\b(?:under|below|less than|upto|up to|cheaper than|max|maximum)\s+${money}`, 'i');
    const um = text.match(under);
    if (um) { maxPrice = Number(um[1].replace(/,/g, '')); text = text.replace(under, ''); }
  }
  if (minPrice === undefined) {
    const over = new RegExp(String.raw`\b(?:over|above|from|min|minimum|at least|more than)\s+${money}`, 'i');
    const om = text.match(over);
    if (om) { minPrice = Number(om[1].replace(/,/g, '')); text = text.replace(over, ''); }
  }

  // Strip trailing "in <city>" — the city becomes a filter, not a keyword.
  text = text.replace(/\s+/g, ' ').replace(/\b(?:in|near|around)\s+$/i, '').trim();

  return { q: text, minPrice, maxPrice };
}

/** Extract a city from "… in Lusaka" so search can scope by location. */
export function extractCity(raw: string): { q: string; city?: string } {
  const m = raw.match(/\b(?:in|near|around)\s+([A-Za-z][A-Za-z\s-]{2,30})$/i);
  if (!m) return { q: raw };
  const city = m[1].trim();
  return { q: raw.replace(m[0], '').trim(), city };
}

type SortField = 'created_at' | 'price' | 'rating_avg' | 'sold_count' | 'name';

function productMatchesTerm(p: Product & { search_text?: string }, q: string): boolean {
  if (!q) return true;
  const ql = q.toLowerCase();
  const hay = [
    p.name, p.brand, p.sku, p.barcode, p.short_description, p.description,
    p.category?.name, p.category?.path, p.business?.name, (p.tags ?? []).join(' '),
    p.search_text,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(ql);
}

/** Products on the storefront are published products of public businesses. */
export async function searchProducts(filters: SearchFilters): Promise<SearchPage<Product>> {
  const { q, minPrice, maxPrice } = parseNaturalQuery(filters.q ?? '');
  const citySplit = extractCity(q);
  const term = [citySplit.q, filters.q].find((t) => t?.trim())?.trim() ?? '';
  const city = citySplit.city ?? filters.city;
  const limit = Math.max(1, Math.min(filters.limit ?? 24, 100));
  const offset = Math.max(0, filters.offset ?? 0);

  // Category slug → id (with descendants so child categories are included).
  let categoryIds: string[] | null = null;
  if (filters.category_id) categoryIds = [filters.category_id];
  else if (filters.category_slug) {
    const cats = await fetchList<Category>('categories', {
      where: [['slug', '==', filters.category_slug] as DbWhere],
      limit: 1,
    });
    const root = cats[0];
    if (!root) return { items: [], total: 0, hasMore: false, limit, offset };
    const all = await fetchList<Category>('categories', { limit: 500 });
    const walk = (id: string): string[] => {
      const kids = all.filter((c) => c.parent_id === id);
      return [id, ...kids.flatMap((k) => walk(k.id))];
    };
    categoryIds = walk(root.id);
  }

  // A store slug must resolve to the store's business first.
  let businessId = filters.business_id ?? null;
  if (filters.store_slug) {
    const stores = await fetchList<Business>('businesses', {
      where: [['slug', '==', filters.store_slug] as DbWhere, ['is_public', '==', true] as DbWhere],
      limit: 1,
    });
    const store = stores[0];
    if (!store) return { items: [], total: 0, hasMore: false, limit, offset };
    businessId = store.id;
  }

  const where: DbWhere[] = [['is_published', '==', true] as DbWhere];
  if (filters.featured_only) where.push(['is_featured', '==', true] as DbWhere);
  if (filters.product_type && filters.product_type !== 'both') where.push(['product_type', '==', filters.product_type] as DbWhere);
  if (businessId) where.push(['business_id', '==', businessId] as DbWhere);
  if (categoryIds?.length) where.push(['category_id', 'in', categoryIds.slice(0, 10)] as DbWhere);
  if (city) where.push(['business_city_lower', '==', city.toLowerCase()] as DbWhere);
  if (filters.country_code) where.push(['business_country', '==', filters.country_code] as DbWhere);
  if (filters.condition) where.push(['condition', '==', filters.condition] as DbWhere);
  if (filters.brand) where.push(['brand', '==', filters.brand] as DbWhere);
  if (filters.wholesale_only) where.push(['is_wholesale', '==', true] as DbWhere);
  const minP = minPrice ?? filters.min_price;
  const maxP = maxPrice ?? filters.max_price;
  if (minP != null) where.push(['price', '>=', Number(minP)] as DbWhere);
  if (maxP != null) where.push(['price', '<=', Number(maxP)] as DbWhere);
  if (filters.in_stock) where.push(['stock', '>', 0] as DbWhere);
  if (filters.min_rating != null && Number(filters.min_rating) > 0) {
    where.push(['rating_avg', '>=', Number(filters.min_rating)] as DbWhere);
  }

  const sortToField: Record<string, SortField> = {
    newest: 'created_at', price_asc: 'price', price_desc: 'price',
    rating: 'rating_avg', popular: 'sold_count', name: 'name',
  };
  const field = sortToField[filters.sort ?? ''] ?? 'created_at';
  const dir = filters.sort === 'price_asc' || filters.sort === 'name' ? 'asc' : 'desc';

  const rows = await fetchList<Product>(
    'products',
    {
      where,
      orderByField: field,
      orderDir: dir,
      limit: term ? Math.min(limit * 6 + offset + 40, 800) : offset + limit + 40,
    },
  );

  const filtered = term ? rows.filter((p) => productMatchesTerm(p, term)) : rows;
  const page = filtered.slice(offset, offset + limit);
  return {
    items: page,
    total: filtered.length,
    hasMore: offset + limit < filtered.length,
    limit,
    offset,
  };
}

export interface BusinessSearchFilters {
  q?: string;
  category_id?: UUID | null;
  city?: string | null;
  country_code?: string | null;
  min_rating?: number | null;
  verified_only?: boolean;
  near_lat?: number | null;
  near_lng?: number | null;
  radius_km?: number | null;
  sort?: 'relevance' | 'rating' | 'newest' | 'name';
  limit?: number;
  offset?: number;
}

export interface BusinessSearchRow extends Business {
  category_name?: string | null;
  category_slug?: string | null;
  live_products?: number;
  distance_km?: number | null;
}

export async function searchBusinesses(f: BusinessSearchFilters): Promise<SearchPage<BusinessSearchRow>> {
  const limit = Math.max(1, Math.min(f.limit ?? 24, 100));
  const offset = Math.max(0, f.offset ?? 0);
  const where: DbWhere[] = [['is_public', '==', true] as DbWhere];
  if (f.category_id) where.push(['category_id', '==', f.category_id] as DbWhere);
  if (f.city) where.push(['city_lower', '==', f.city.toLowerCase()] as DbWhere);
  if (f.country_code) where.push(['country_code', '==', f.country_code] as DbWhere);
  if (f.verified_only) where.push(['verification_status', '==', 'verified'] as DbWhere);
  if (f.min_rating != null && Number(f.min_rating) > 0) where.push(['rating_avg', '>=', Number(f.min_rating)] as DbWhere);

  const field: SortField = f.sort === 'rating' ? 'rating_avg' : f.sort === 'name' ? 'name' : 'created_at';
  const dir: 'asc' | 'desc' = f.sort === 'name' ? 'asc' : 'desc';
  const term = (f.q ?? '').trim().toLowerCase();

  const rows = await fetchList<BusinessSearchRow>(
    'businesses',
    {
      where,
      orderByField: field,
      orderDir: dir,
      limit: term ? Math.min(limit * 6 + offset + 40, 600) : offset + limit + 40,
    },
  );

  const catName = (b: BusinessSearchRow): string | null =>
    (b as BusinessSearchRow & { category?: { name?: string; slug?: string } }).category?.name ?? b.category_name ?? null;
  const catSlug = (b: BusinessSearchRow): string | null =>
    (b as BusinessSearchRow & { category?: { name?: string; slug?: string } }).category?.slug ?? b.category_slug ?? null;
  const filtered = term
    ? rows.filter((b) =>
        [b.name, b.tagline, b.description, b.city, b.category_name,
         (b as BusinessSearchRow & { category?: { name?: string } }).category?.name]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(term),
      )
    : rows;
  const page = filtered.slice(offset, offset + limit);
  return {
    items: page.map((b) => ({ ...b, distance_km: null, category_name: catName(b), category_slug: catSlug(b) })),
    total: filtered.length,
    hasMore: offset + limit < filtered.length,
    limit,
    offset,
  };
}

/* ── Storefront ────────────────────────────────────────────────────────────── */

export interface StorePayload {
  found: boolean;
  store?: Record<string, unknown>;
  business?: Business;
  category?: Pick<Category, 'id' | 'name' | 'slug'> | null;
  stats?: { products: number; services: number; reviews: number; avg_rating: number };
}

export async function getStore(slug: string): Promise<StorePayload> {
  const stores = await fetchList<Business>('businesses', {
    where: [['slug', '==', slug] as DbWhere, ['is_public', '==', true] as DbWhere],
    limit: 1,
  });
  const business = stores[0] ?? null;
  if (!business) return { found: false, category: null };
  return {
    found: true,
    store: { ...business, slug: business.slug, name: business.name },
    business,
    category: null,
    stats: {
      products: business.product_count || 0,
      services: 0,
      reviews: business.rating_count || 0,
      avg_rating: toNum(business.rating_avg),
    },
  };
}

/* ── Checkout ──────────────────────────────────────────────────────────────── */

export interface OrderLineInput {
  product_id?: UUID | null;
  variant_id?: UUID | null;
  service_id?: UUID | null;
  name?: string;
  quantity: number;
  unit_price?: number;
  unit?: string;
  discount_percent?: number;
  discount_amount?: number;
  tax_rate?: number;
  notes?: string;
}

export interface CreateOrderInput {
  business_id: UUID;
  items: OrderLineInput[];
  channel?: OrderChannel;
  customer_id?: UUID | null;
  buyer_user_id?: UUID | null;
  customer?: Partial<Customer> & { name: string };
  currency?: string;
  warehouse_id?: UUID | null;
  branch_id?: UUID | null;
  served_by?: UUID | null;
  served_by_name?: string | null;
  delivery_method?: 'pickup' | 'delivery' | 'shipping';
  delivery_fee?: number;
  tip_amount?: number;
  coupon_code?: string | null;
  shipping_name?: string;
  shipping_phone?: string;
  shipping_line1?: string;
  shipping_line2?: string;
  shipping_city?: string;
  shipping_region?: string;
  shipping_postal_code?: string;
  shipping_country?: string;
  delivery_notes?: string;
  notes?: string;
  customer_note?: string;
  reference?: string;
  is_wholesale?: boolean;
  /** The API also accepts the friendly 'paid' / 'partially_paid' spellings. */
  payment_status?: 'pending' | 'processing' | 'completed' | 'partially_paid' | 'paid' | 'refunded' | 'cancelled';
  status?: Order['status'];
  deduct_stock?: boolean;
  cart_id?: UUID | null;
}

export interface OrderResult {
  order_id: UUID;
  order_number: string;
  status: string;
  subtotal: number;
  discount: number;
  tax: number;
  delivery: number;
  tip: number;
  total: number;
  currency: string;
  item_count: number;
}

function businessSummaryOf(b: Business): BusinessSummary {
  return {
    id: b.id,
    name: b.name,
    slug: b.slug,
    logo_url: b.logo_url,
    city: b.city,
    country_code: b.country_code,
    verification_status: b.verification_status,
    rating_avg: b.rating_avg,
    rating_count: b.rating_count,
    badges: b.badges ?? [],
    accepts_orders: b.accepts_orders,
    delivery_enabled: b.delivery_enabled,
    accepts_wholesale: b.accepts_wholesale,
    delivery_fee: b.delivery_fee,
    free_delivery_over: b.free_delivery_over,
    base_currency: b.base_currency,
    phone: b.phone,
    phone_country_code: b.phone_country_code,
    whatsapp: b.whatsapp,
    email: b.email,
    website: b.website,
    address_line1: b.address_line1,
    region: b.region,
    invoice_terms: b.invoice_terms,
    payment_terms_days: b.payment_terms_days,
    quotation_validity_days: b.quotation_validity_days,
    tax_number: b.tax_number,
    primary_color: b.primary_color,
    accent_color: b.accent_color,
  };
}

/** Allocate the next prefixed number from the business document counter. */
export async function allocateNumber(businessId: UUID, counterField: string, prefix = ''): Promise<string> {
  const n = await bumpCounter('businesses', businessId, counterField, 1);
  return `${prefix}${String(n).padStart(4, '0')}`;
}

/** Friendly name for a line so a custom item can go through without a product. */
function lineName(line: OrderLineInput): string {
  return line.name?.trim() || 'Item';
}

/** Turn requested lines into authoritative order line rows. For storefront
 *  orders the prices are re-read from the product/service document. */
async function buildOrderLines(input: CreateOrderInput, business: Business) {
  const isStorefront = ['marketplace', 'store', 'wholesale'].includes(input.channel ?? 'marketplace');
  const lines: OrderItem[] = [];
  for (const raw of input.items) {
    const qty = Math.max(1, toNum(raw.quantity) || 1);
    const lineId = newId();
    if (raw.product_id && isStorefront) {
      const product = await fetchRow<Product>('products', raw.product_id);
      if (!product || !product.is_published) {
        throw new Error(isStorefront ? `“${lineName(raw)}” is no longer available.` : `Product ${raw.product_id} was not found.`);
      }
      if (product.business_id !== business.id) {
        throw new Error(`“${product.name}” does not belong to this business.`);
      }
      const tier = input.is_wholesale || product.is_wholesale
        ? priceForQuantity(toNum(product.price), qty, product.wholesale_price, product.wholesale_min_qty, product.is_wholesale)
        : { price: toNum(product.price), wholesale: product.is_wholesale && qty >= product.wholesale_min_qty };
      const unit = toNum(raw.unit_price);
      const price = unit > 0 && !isStorefront ? unit : toNum(tier.price);
      const wholesale = Boolean(tier.wholesale || input.is_wholesale);
      if (isStorefront && product.track_inventory && !product.allow_backorder && qty > toNum(product.stock)) {
        throw new Error(`Only ${Math.max(0, toNum(product.stock))} of “${product.name}” are in stock.`);
      }
      lines.push({
        id: lineId,
        order_id: '',
        product_id: product.id,
        variant_id: raw.variant_id ?? null,
        service_id: null,
        warehouse_id: input.warehouse_id ?? null,
        name: product.name,
        sku: product.sku,
        image_url: product.primary_image_url,
        unit: raw.unit ?? product.unit,
        quantity: qty,
        quantity_fulfilled: 0,
        quantity_returned: 0,
        unit_price: price,
        unit_cost: toNum(product.cost_price),
        discount_amount: 0,
        discount_percent: 0,
        tax_rate: 0,
        tax_amount: 0,
        line_subtotal: roundMoney(qty * price, business.base_currency),
        line_total: 0,
        line_profit: 0,
        is_wholesale: wholesale,
        notes: raw.notes ?? null,
      });
    } else {
      // Manual / POS line — the caller sets the price (seller's own terminal).
      lines.push({
        id: lineId,
        order_id: '',
        product_id: raw.product_id ?? null,
        variant_id: raw.variant_id ?? null,
        service_id: raw.service_id ?? null,
        warehouse_id: input.warehouse_id ?? null,
        name: lineName(raw),
        sku: null,
        image_url: null,
        unit: raw.unit ?? 'pcs',
        quantity: qty,
        quantity_fulfilled: 0,
        quantity_returned: 0,
        unit_price: toNum(raw.unit_price),
        unit_cost: 0,
        discount_amount: 0,
        discount_percent: toNum(raw.discount_percent),
        tax_rate: toNum(raw.tax_rate),
        tax_amount: 0,
        line_subtotal: 0,
        line_total: 0,
        line_profit: 0,
        is_wholesale: Boolean(input.is_wholesale),
        notes: raw.notes ?? null,
      });
    }
  }
  return lines;
}

export async function createOrder(input: CreateOrderInput): Promise<OrderResult> {
  if (!input.business_id) throw new Error('No business selected.');
  if (!input.items?.length) throw new Error('Add at least one item to place the order.');

  const business = await fetchRow<Business>('businesses', input.business_id);
  if (!business) throw new Error('That business no longer exists.');
  const currency = input.currency ?? business.base_currency ?? 'ZMW';

  const lines = await buildOrderLines(input, business);

  // Customer: find or create within this business.
  let customerId = input.customer_id ?? null;
  if (!customerId && input.customer?.name?.trim()) {
    // Buyers registering at checkout are stamped with their uid so the rules
    // can let them create their own customer row (businesses keep editing it).
    const customer = { ...input.customer, user_id: input.buyer_user_id ?? (input.customer as Partial<Customer>).user_id ?? null } as Partial<Customer> & { name: string };
    customerId = await upsertCustomer(input.business_id, customer);
  }

  const totals = computeTotals({
    lines: lines as never,
    currency,
    deliveryFee: toNum(input.delivery_fee),
    tip: toNum(input.tip_amount),
  });
  const pricedLines = totals.lines as unknown as OrderItem[];

  // Stock: transactional decrement on each tracked product.
  const deductStock = input.deduct_stock ?? true;
  const db = getFirebaseDb();
  const uniqueProducts = new Map<string, { qty: number; variantId?: string | null }>();
  lines.forEach((l) => {
    if (!l.product_id || deductStock === false) return;
    const prev = uniqueProducts.get(l.product_id) ?? { qty: 0, variantId: l.variant_id };
    prev.qty += l.quantity;
    uniqueProducts.set(l.product_id, prev);
  });
  for (const [productId, need] of uniqueProducts) {
    await runTransaction(db, async (tx) => {
      const ref = docRef('products', productId);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('A product on this order no longer exists.');
      const data = snap.data();
      if (need.variantId) {
        const variants = (data.variants ?? []) as Array<{ id: string; stock: number }>;
        const idx = variants.findIndex((v) => v.id === need.variantId);
        if (idx === -1) throw new Error('A product option on this order no longer exists.');
        const variantStock = toNum(variants[idx].stock);
        const next = variantStock - need.qty;
        if (next < 0 && !data.allow_backorder && data.track_inventory) {
          throw new Error(`Only ${Math.max(0, variantStock)} of that option are in stock.`);
        }
        const copy = [...variants];
        copy[idx] = { ...variants[idx], stock: Math.max(next, 0) };
        tx.update(ref, { variants: copy, updated_at: nowIso() });
      } else if (data.track_inventory) {
        const stock = toNum(data.stock);
        const next = stock - need.qty;
        if (next < 0 && !data.allow_backorder) {
          throw new Error(`Only ${Math.max(0, stock)} of “${data.name}” are in stock.`);
        }
        tx.update(ref, { stock: Math.max(next, 0), stock_status: stockStatusFor(Math.max(next, 0), data as { stock_alert?: unknown; track_inventory?: unknown }), updated_at: nowIso() });
      }
    });
  }

  const orderId = newId();
  const orderNumber = await allocateNumber(
    input.business_id, 'next_order_number', business.order_prefix ?? '',
  );

  const rawStatus = input.status ?? 'pending';
  const rawPay = input.payment_status ?? 'pending';
  const paymentStatus = rawPay === 'paid' ? 'completed' : rawPay;

  const order: Record<string, unknown> = {
    business_id: business.id,
    order_number: orderNumber,
    customer_id: customerId,
    buyer_user_id: input.buyer_user_id ?? null,
    branch_id: input.branch_id ?? null,
    warehouse_id: input.warehouse_id ?? null,
    served_by: input.served_by ?? null,
    served_by_name: input.served_by_name ?? null,
    channel: input.channel ?? 'marketplace',
    status: rawStatus,
    payment_status: paymentStatus,
    fulfilment_status: rawStatus === 'delivered' ? 'fulfilled' : rawStatus === 'cancelled' ? 'cancelled' : 'unfulfilled',
    is_wholesale: Boolean(input.is_wholesale),
    currency,
    subtotal: totals.subtotal,
    discount_total: totals.discount,
    tax_total: totals.tax,
    delivery_fee: totals.delivery,
    tip_amount: totals.tip,
    total: totals.total,
    amount_paid: 0,
    balance_due: totals.total,
    coupon_id: null,
    coupon_code: input.coupon_code ?? null,
    delivery_method: input.delivery_method ?? 'pickup',
    shipping_name: input.shipping_name ?? null,
    shipping_phone: input.shipping_phone ?? null,
    shipping_line1: input.shipping_line1 ?? null,
    shipping_line2: input.shipping_line2 ?? null,
    shipping_city: input.shipping_city ?? null,
    shipping_region: input.shipping_region ?? null,
    shipping_postal_code: input.shipping_postal_code ?? null,
    shipping_country: input.shipping_country ?? business.country_code ?? 'ZM',
    delivery_notes: input.delivery_notes ?? null,
    notes: input.notes ?? null,
    customer_note: input.customer_note ?? null,
    reference: input.reference ?? null,
    invoice_id: null,
    quotation_id: null,
    placed_at: nowIso(),
    status_history: [{ status: rawStatus, at: nowIso(), by: input.served_by_name ?? input.buyer_user_id ?? null, channel: input.channel }],
    items: pricedLines.map((l) => ({ ...l, order_id: orderId })),
    customer: customerId
      ? await customerPick(input.business_id, customerId)
      : input.customer?.name
        ? { id: customerId ?? '', name: input.customer.name, phone: input.customer.phone ?? null, email: input.customer.email ?? null }
        : null,
    business: businessSummaryOf(business),
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  await writeRow<{ id: string }>('orders', orderId, order as never);

  // Notify the seller (business members) and the buyer.
  void notifyBusinessMembers(business.id, {
    type: 'order',
    title: `New order ${orderNumber}`,
    body: `${order.buyer_user_id ? 'A customer' : (input.customer?.name ?? 'A buyer')} placed an order worth ${currency} ${Number(order.total ?? 0).toFixed(2)}.`,
    icon: 'cart',
    action_url: '/business/orders/' + orderId,
    entity_type: 'order',
    entity_id: orderId,
    priority: 'high',
  });
  if (input.buyer_user_id) {
    void notifyUser(input.buyer_user_id, {
      type: 'order',
      title: `Order ${orderNumber} placed`,
      body: `Your order from ${business.name} has been placed.`,
      icon: 'cart',
      action_url: '/account/orders/' + orderId,
      entity_type: 'order',
      entity_id: orderId,
    });
  }

  return {
    order_id: orderId,
    order_number: orderNumber,
    status: rawStatus,
    subtotal: totals.subtotal,
    discount: totals.discount,
    tax: totals.tax,
    delivery: totals.delivery,
    tip: totals.tip,
    total: totals.total,
    currency,
    item_count: lines.reduce((s, l) => s + l.quantity, 0),
  };
}

export interface PaymentResult {
  payment_id: UUID;
  payment_number: string;
  receipt_id: UUID | null;
  amount: number;
  balance_due: number;
  currency: string;
}

export interface RecordPaymentInput {
  business_id: UUID;
  amount: number;
  method: Payment['method'];
  direction?: 'inbound' | 'outbound';
  invoice_id?: UUID | null;
  order_id?: UUID | null;
  customer_id?: UUID | null;
  supplier_id?: UUID | null;
  bill_id?: UUID | null;
  currency?: string;
  reference?: string;
  received_at?: string;
  notes?: string;
  generate_receipt?: boolean;
  provider?: string;
  payer_name?: string;
  payer_phone?: string;
  payer_email?: string;
  transaction_ref?: string;
  allow_overpay?: boolean;
}

export async function recordPayment(input: RecordPaymentInput): Promise<PaymentResult> {
  const business = await fetchRow<Business>('businesses', input.business_id);
  if (!business) throw new Error('That business no longer exists.');
  const amount = roundMoney(Math.abs(toNum(input.amount)), business.base_currency ?? 'ZMW');
  if (amount <= 0) throw new Error('Enter an amount greater than zero.');
  const currency = input.currency ?? business.base_currency ?? 'ZMW';

  const direction = input.direction ?? 'inbound';
  const paymentId = newId();
  const paymentNumber = await allocateNumber(input.business_id, 'next_payment_number', 'PMT-');

  // Re-read the linked invoice/order to compute balances.
  let balanceDue = 0;
  let receiptId: string | null = null;
  let customerId = input.customer_id ?? null;
  if (direction === 'inbound' && input.invoice_id) {
    const invoice = await fetchRow<Invoice>('invoices', input.invoice_id);
    if (invoice) {
      customerId = customerId ?? invoice.customer_id;
      const paid = toNum(invoice.amount_paid) + amount;
      const bal = Math.max(roundMoney(toNum(invoice.total) - paid, currency), 0);
      balanceDue = bal;
      const status = bal <= 0 ? 'paid' : 'partially_paid';
      await patchRow('invoices', invoice.id, {
        amount_paid: roundMoney(paid, currency),
        balance_due: bal,
        status,
        paid_at: bal <= 0 ? (input.received_at ?? nowIso()) : invoice.paid_at ?? null,
      });
    }
  }
  if (direction === 'inbound' && input.order_id) {
    const order = await fetchRow<Order>('orders', input.order_id);
    if (order) {
      customerId = customerId ?? order.customer_id;
      const paid = toNum(order.amount_paid) + amount;
      const bal = Math.max(roundMoney(toNum(order.balance_due) - amount, currency), 0);
      balanceDue = bal;
      const status = bal <= 0 ? 'completed' : 'partially_paid';
      await patchRow('orders', order.id, {
        amount_paid: roundMoney(paid, currency),
        balance_due: bal,
        payment_status: status,
        status_history: [...(order.status_history ?? []), {
          status: order.status, at: nowIso(), by: input.payer_name ?? input.notes ?? null,
          note: `Payment ${status === 'completed' ? 'completed' : 'partially received'}`,
        }],
      });
      if (order.buyer_user_id) {
        void notifyUser(order.buyer_user_id, {
          type: 'payment',
          title: status === 'completed' ? 'Payment received' : 'Partial payment received',
          body: `${business.name} recorded ${currency} ${amount.toFixed(2)} on order ${order.order_number}.`,
          icon: 'wallet',
          action_url: '/account/orders/' + order.id,
          entity_type: 'order',
          entity_id: order.id,
        }, business.id);
      }
    }
  }

  const receivedAt = input.received_at ?? nowIso();
  const payment: Record<string, unknown> = {
    business_id: business.id,
    invoice_id: input.invoice_id ?? null,
    order_id: input.order_id ?? null,
    quotation_id: null,
    customer_id: customerId,
    supplier_id: input.supplier_id ?? null,
    direction,
    payment_number: paymentNumber,
    method: input.method,
    provider: input.provider ?? null,
    provider_reference: input.transaction_ref ?? null,
    status: direction === 'inbound' ? 'completed' : 'completed',
    currency,
    amount,
    amount_base: amount,
    fee_amount: 0,
    payer_name: input.payer_name ?? null,
    payer_phone: input.payer_phone ?? null,
    received_at: receivedAt,
    notes: input.notes ?? null,
    recorded_by: null,
    recorded_by_name: input.payer_name ?? null,
    receipt_id: null,
    is_online: Boolean(input.provider && input.provider !== 'cash'),
    payment_link_id: null,
    refunded_amount: 0,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  if (customerId) payment.customer = await customerPick(business.id, customerId);

  if (input.generate_receipt !== false && direction === 'inbound') {
    receiptId = await createReceipt({
      business_id: business.id,
      amount,
      method: input.method,
      payment_id: paymentId,
      invoice_id: input.invoice_id ?? null,
      order_id: input.order_id ?? null,
      customer_id: customerId,
      customer_name: input.payer_name ?? undefined,
      currency,
      notes: input.notes,
      balance_after: balanceDue,
    });
    payment.receipt_id = receiptId;
  }

  await writeRow<{ id: string }>('payments', paymentId, payment as never);

  return {
    payment_id: paymentId,
    payment_number: paymentNumber,
    receipt_id: receiptId,
    amount,
    balance_due: balanceDue,
    currency,
  };
}

/* ── Customers ─────────────────────────────────────────────────────────────── */

export async function upsertCustomer(businessId: UUID, customer: Partial<Customer> & { name: string }): Promise<UUID> {
  const name = customer.name?.trim();
  if (!name) throw new Error('Customer name is required.');
  const rows = await fetchList<Customer>('customers', {
    where: [
      ['business_id', '==', businessId] as DbWhere,
      ['is_active', '==', true] as DbWhere,
    ],
    limit: 600,
  });
  const qPhone = customer.phone ? normaliseKey(customer.phone) : null;
  const qEmail = customer.email ? String(customer.email).trim().toLowerCase() : null;
  const existing = rows.find(
    (r) =>
      (qEmail && r.email && r.email.trim().toLowerCase() === qEmail) ||
      (qPhone && r.phone && normaliseKey(r.phone) === qPhone) ||
      r.name.trim().toLowerCase() === name.toLowerCase(),
  );
  if (existing) {
    await patchRow('customers', existing.id, {
      name: existing.name,
      ...pickDefined(customer),
      updated_at: nowIso(),
    });
    return existing.id;
  }
  const id = newId();
  const now = nowIso();
  await addRow<Customer>(
    'customers',
    {
      business_id: businessId,
      user_id: customer.user_id ?? null,
      customer_number: null,
      name,
      company_name: customer.company_name ?? (customer.is_company ? name : null),
      is_company: Boolean(customer.is_company),
      email: customer.email ?? null,
      phone: customer.phone ?? null,
      phone_country_code: customer.phone_country_code ?? '+260',
      whatsapp: customer.whatsapp ?? null,
      tax_number: customer.tax_number ?? null,
      customer_group: customer.customer_group ?? null,
      tags: customer.tags ?? [],
      address_line1: customer.address_line1 ?? null,
      address_line2: customer.address_line2 ?? null,
      city: customer.city ?? null,
      region: customer.region ?? null,
      postal_code: customer.postal_code ?? null,
      country_code: customer.country_code ?? 'ZM',
      currency: customer.currency ?? 'ZMW',
      credit_limit: customer.credit_limit ?? 0,
      payment_terms_days: customer.payment_terms_days ?? 0,
      default_tax_id: customer.default_tax_id ?? null,
      notes: customer.notes ?? null,
      source: customer.source ?? 'manual',
      orders_count: 0,
      total_spent: 0,
      outstanding_balance: 0,
      credit_balance: 0,
      loyalty_points: 0,
      last_order_at: null,
      first_order_at: null,
      marketing_opt_in: Boolean(customer.marketing_opt_in),
      is_active: true,
      created_at: now,
      updated_at: now,
    } as never,
    id,
  );
  return id;
}

function normaliseKey(v: string): string {
  return String(v).replace(/[^\d+]/g, '');
}

function pickDefined(obj: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  Object.entries(obj).forEach(([k, v]) => {
    if (v !== undefined && k !== 'id') out[k] = v;
  });
  return out;
}

async function customerPick(businessId: string, customerId: string) {
  const c = await fetchRow<Customer>('customers', customerId);
  if (!c || c.business_id !== businessId) return null;
  return { id: c.id, name: c.name, phone: c.phone, email: c.email };
}

export async function customerStatement(customerId: UUID, from: string, to: string) {
  const customer = await fetchRow<Customer>('customers', customerId);
  if (!customer) throw new Error('Customer not found.');
  const whereBusiness: DbWhere[] = [['business_id', '==', customer.business_id] as DbWhere, ['customer_id', '==', customerId] as DbWhere];
  const invoices = await fetchList<Invoice>('invoices', { where: whereBusiness, limit: 400 });
  const orders = await fetchList<Order>('orders', { where: whereBusiness, limit: 400 });
  const payments = await fetchList<Payment>('payments', {
    where: [...whereBusiness, ['direction', '==', 'inbound'] as DbWhere],
    limit: 400,
  });

  const entries: Record<string, unknown>[] = [];
  invoices
    .filter((i) => (!from || i.issue_date >= from) && (!to || i.issue_date <= to))
    .forEach((i) => entries.push({ date: i.issue_date, kind: 'invoice', id: i.id, number: i.invoice_number, debit: toNum(i.total), credit: 0, balance: 0 }));
  payments
    .filter((p) => (!from || p.received_at >= from) && (!to || p.received_at <= to))
    .forEach((p) => entries.push({ date: p.received_at, kind: 'payment', id: p.id, number: p.payment_number, debit: 0, credit: toNum(p.amount), balance: 0 }));
  orders
    .filter((o) => (!from || o.placed_at >= from) && (!to || o.placed_at <= to))
    .forEach((o) => entries.push({ date: o.placed_at, kind: 'order', id: o.id, number: o.order_number, debit: toNum(o.total), credit: 0, balance: 0 }));

  entries.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let running = 0;
  entries.forEach((e) => { running += Number(e.debit ?? 0) - Number(e.credit ?? 0); e.balance = roundMoney(running); });
  const totalDebits = roundMoney(entries.reduce((sum, e) => sum + Number(e.debit ?? 0), 0));
  const totalCredits = roundMoney(entries.reduce((sum, e) => sum + Number(e.credit ?? 0), 0));
  return {
    customer: customer as unknown as Record<string, unknown>,
    from, to,
    opening_balance: 0,
    entries,
    total_debits: totalDebits,
    total_credits: totalCredits,
    closing_balance: roundMoney(totalDebits - totalCredits),
  };
}

/* ── Inventory ─────────────────────────────────────────────────────────────── */

/** Derived stock health used by the catalogue filters and badges. */
function stockStatusFor(stock: number, product?: { stock_alert?: unknown; track_inventory?: unknown } | null): 'in_stock' | 'low_stock' | 'out_of_stock' | null {
  if (product && product.track_inventory === false) return null;
  const qty = Math.max(0, stock);
  const alert = toNum((product?.stock_alert as number | string | null | undefined) ?? 5);
  if (qty <= 0) return 'out_of_stock';
  if (qty <= alert) return 'low_stock';
  return 'in_stock';
}

export async function adjustStock(input: {
  businessId: UUID;
  productId: UUID;
  quantityChange: number;
  movementType: string;
  warehouseId?: UUID | null;
  variantId?: UUID | null;
  unitCost?: number | null;
  referenceType?: string | null;
  referenceId?: UUID | null;
  referenceNumber?: string | null;
  reason?: string | null;
}): Promise<Record<string, unknown>> {
  const change = Math.round(toNum(input.quantityChange));
  if (change === 0) return { ok: true, product_id: input.productId, quantity_change: 0 };
  const product = await fetchRow<Product>('products', input.productId);
  if (!product || product.business_id !== input.businessId) {
    throw new Error('Product not found in this business.');
  }
  await runTransaction(getFirebaseDb(), async (tx) => {
    const ref = docRef('products', input.productId);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Product not found.');
    const data = snap.data();
    if (input.variantId) {
      const variants = [...((data.variants ?? []) as Array<{ id: string; stock: number }>)];
      const idx = variants.findIndex((v) => v.id === input.variantId);
      if (idx === -1) throw new Error('Product option not found.');
      const next = Math.max(toNum(variants[idx].stock) + change, 0);
      variants[idx] = { ...variants[idx], stock: next };
      tx.update(ref, { variants, updated_at: nowIso() });
    } else {
      const next = Math.max(toNum(data.stock) + change, 0);
      const status = stockStatusFor(next, data as { stock_alert?: unknown; track_inventory?: unknown });
      tx.update(ref, { stock: next, stock_status: status, updated_at: nowIso() });
    }
  });
  const movementId = newId();
  await addRow<{ id: string }>('inventory_movements', {
    business_id: input.businessId,
    product_id: input.productId,
    variant_id: input.variantId ?? null,
    warehouse_id: input.warehouseId ?? null,
    quantity_change: change,
    movement_type: input.movementType,
    unit_cost: input.unitCost ?? null,
    reference_type: input.referenceType ?? null,
    reference_id: input.referenceId ?? null,
    reference_number: input.referenceNumber ?? null,
    reason: input.reason ?? null,
    created_at: nowIso(),
    updated_at: nowIso(),
  }, movementId);
  return { ok: true, product_id: input.productId, quantity_change: change, movement_id: movementId };
}

export async function transferStock(transferId: UUID): Promise<Record<string, unknown>> {
  const movement = await fetchRow<{ id: string; business_id: string; product_id: string; quantity_change: number; status?: string }>('inventory_movements', transferId);
  if (!movement) throw new Error('Transfer not found.');
  if (movement.status === 'completed') return { ok: true, transfer_id: transferId, status: 'completed' };
  await patchRow('inventory_movements', transferId, { status: 'completed' });
  return { ok: true, transfer_id: transferId, status: 'completed' };
}

/* ── Documents (quotations / invoices / receipts) ─────────────────────────── */

export interface DocumentLineInput extends OrderLineInput {
  description?: string;
}

export interface CreateInvoiceInput {
  business_id: UUID;
  kind?: 'tax_invoice' | 'proforma' | 'credit_note' | 'debit_note';
  customer_id?: UUID | null;
  buyer_user_id?: UUID | null;
  order_id?: UUID | null;
  quotation_id?: UUID | null;
  branch_id?: UUID | null;
  currency?: string;
  items: DocumentLineInput[];
  customer?: { name: string; email?: string; phone?: string };
  issue_date?: string;
  due_date?: string;
  due_days?: number;
  delivery_fee?: number;
  notes?: string;
  terms?: string;
  reference?: string;
  status?: 'draft' | 'sent';
  invoice_number?: string;
  discount_percent?: number;
}

export async function createInvoice(input: CreateInvoiceInput): Promise<UUID> {
  const business = await requireBusiness(input.business_id);
  const currency = input.currency ?? business.base_currency ?? 'ZMW';
  const lines = input.items.map((raw, i) => docLine(raw, currency, i));
  const totals = computeTotals({ lines: lines as never, currency, deliveryFee: toNum(input.delivery_fee) });
  const customerId = input.customer_id ?? (input.customer?.name ? await upsertCustomer(input.business_id, input.customer as never) : null);
  const id = newId();
  const invoiceNumber = input.invoice_number ?? await allocateNumber(input.business_id, 'next_invoice_number', business.invoice_prefix ?? '');
  const issueDate = input.issue_date ?? nowIso().slice(0, 10);
  const dueDays = input.due_days ?? business.payment_terms_days ?? 14;
  const dueDate = input.due_date ?? addDays(issueDate, dueDays);
  const status = input.status ?? 'draft';
  await writeRow<{ id: string }>('invoices', id, {
    business_id: business.id,
    invoice_number: invoiceNumber,
    kind: input.kind ?? 'tax_invoice',
    customer_id: customerId,
    buyer_user_id: input.buyer_user_id ?? null,
    order_id: input.order_id ?? null,
    quotation_id: input.quotation_id ?? null,
    status,
    currency,
    subtotal: totals.subtotal,
    discount_total: totals.discount,
    tax_total: totals.tax,
    delivery_fee: totals.delivery,
    total: totals.total,
    amount_paid: 0,
    amount_credited: 0,
    balance_due: totals.total,
    issue_date: issueDate,
    due_date: dueDate,
    paid_at: null,
    terms_days: dueDays,
    terms: input.terms ?? business.invoice_terms ?? null,
    notes: input.notes ?? null,
    reference: input.reference ?? null,
    viewed_at: null,
    viewed_count: 0,
    signature_id: null,
    signed_at: null,
    qr_token: null,
    share_token: null,
    payment_link: null,
    reminders_sent: 0,
    created_by: input.buyer_user_id ?? business.owner_id,
    created_by_name: business.name,
    sent_at: status === 'sent' ? nowIso() : null,
    sent_channel: null,
    voided_at: null,
    void_reason: null,
    items: lines.map((l) => ({ ...l, id: l.id ?? newId(), invoice_id: id })),
    customer: customerId ? await customerPick(business.id, customerId) : null,
    business: businessSummaryOf(business),
    created_at: nowIso(),
    updated_at: nowIso(),
  } as never);
  if (input.order_id) {
    await patchRow('orders', input.order_id, { invoice_id: id });
  }
  return id;
}

function docLine(raw: DocumentLineInput, _currency: string, i: number) {
  const qty = Math.max(1, toNum(raw.quantity) || 1);
  const price = toNum(raw.unit_price);
  const discountPct = toNum(raw.discount_percent);
  const gross = roundMoney(qty * price);
  const discount = roundMoney((gross * discountPct) / 100);
  const taxRate = toNum(raw.tax_rate);
  const net = roundMoney(Math.max(gross - discount, 0));
  const tax = roundMoney((net * taxRate) / 100);
  return {
    id: newId(),
    invoice_id: '',
    product_id: raw.product_id ?? null,
    variant_id: raw.variant_id ?? null,
    service_id: raw.service_id ?? null,
    order_item_id: null,
    description: raw.description ?? raw.name ?? 'Item',
    quantity: qty,
    unit: raw.unit ?? 'pcs',
    unit_price: price,
    discount_amount: discount,
    discount_percent: discountPct,
    tax_rate: taxRate,
    tax_amount: tax,
    line_subtotal: net,
    line_total: roundMoney(net + tax),
    sort_order: i,
    notes: raw.notes ?? null,
  };
}

export interface CreateQuotationInput extends Omit<CreateInvoiceInput, 'kind' | 'due_date' | 'due_days'> {
  kind?: 'quotation' | 'proforma';
  valid_until?: string;
  valid_days?: number;
}

export async function createQuotation(input: CreateQuotationInput): Promise<UUID> {
  const business = await requireBusiness(input.business_id);
  const currency = input.currency ?? business.base_currency ?? 'ZMW';
  const lines = input.items.map((raw, i) => docLine(raw, currency, i));
  const totals = computeTotals({ lines: lines as never, currency, deliveryFee: toNum(input.delivery_fee) });
  const customerId = input.customer_id ?? (input.customer?.name ? await upsertCustomer(input.business_id, input.customer as never) : null);
  const id = newId();
  const quotationNumber = await allocateNumber(input.business_id, 'next_quotation_number', business.quotation_prefix ?? '');
  const issueDate = input.issue_date ?? nowIso().slice(0, 10);
  const validityDays = input.valid_days ?? business.quotation_validity_days ?? 30;
  const validUntil = input.valid_until ?? addDays(issueDate, validityDays);
  const status = input.status ?? 'draft';
  await writeRow<{ id: string }>('quotations', id, {
    business_id: business.id,
    quotation_number: quotationNumber,
    kind: input.kind ?? 'quotation',
    customer_id: customerId,
    buyer_user_id: input.buyer_user_id ?? null,
    status,
    title: null,
    currency,
    subtotal: totals.subtotal,
    discount_total: totals.discount,
    tax_total: totals.tax,
    delivery_fee: totals.delivery,
    total: totals.total,
    validity_days: validityDays,
    valid_until: validUntil,
    terms: input.terms ?? business.invoice_terms ?? null,
    notes: input.notes ?? null,
    issue_date: issueDate,
    delivery_method: null,
    shipping_address: null,
    viewed_at: null,
    responded_at: null,
    response_note: null,
    signature_id: null,
    signed_at: null,
    signer_name: null,
    converted_order_id: null,
    converted_invoice_id: null,
    created_by: input.buyer_user_id ?? business.owner_id,
    created_by_name: business.name,
    sent_at: status === 'sent' ? nowIso() : null,
    sent_channel: null,
    share_token: null,
    items: lines.map((l) => ({ ...l, quotation_id: id })),
    customer: customerId ? await customerPick(business.id, customerId) : null,
    business: businessSummaryOf(business),
    created_at: nowIso(),
    updated_at: nowIso(),
  } as never);
  return id;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate.length === 10 ? `${isoDate}T00:00:00Z` : isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function requireBusiness(businessId: string): Promise<Business> {
  const business = await fetchRow<Business>('businesses', businessId);
  if (!business) throw new Error('That business no longer exists.');
  return business;
}

/** Create an invoice from an order's items (keeps prices + buyer). */
export async function createInvoiceFromOrder(orderId: UUID, dueDays?: number | null): Promise<UUID> {
  const order = await fetchRow<Order & { items?: OrderItem[] }>('orders', orderId);
  if (!order) throw new Error('Order not found.');
  return createInvoice({
    business_id: order.business_id,
    kind: 'tax_invoice',
    customer_id: order.customer_id,
    buyer_user_id: order.buyer_user_id,
    order_id: order.id,
    currency: order.currency,
    due_days: dueDays ?? undefined,
    items: (order.items ?? []).map((l) => ({
      product_id: l.product_id,
      variant_id: l.variant_id,
      service_id: l.service_id,
      name: l.name,
      description: l.name,
      unit_price: toNum(l.unit_price),
      quantity: l.quantity,
      unit: l.unit,
      discount_percent: toNum(l.discount_percent),
      tax_rate: toNum(l.tax_rate),
      notes: l.notes,
    })) as unknown as DocumentLineInput[],
    delivery_fee: toNum(order.delivery_fee),
    reference: `Order ${order.order_number}`,
    customer: order.customer
      ? { name: order.customer.name, email: order.customer.email ?? undefined, phone: order.customer.phone ?? undefined }
      : undefined,
    status: order.payment_status === 'completed' ? 'sent' : 'draft',
  });
}

/** Create an invoice from an accepted quotation. */
export async function convertQuotationToInvoice(quotationId: UUID): Promise<UUID> {
  const quotation = await fetchRow<Quotation & { items?: QuotationItem[] }>('quotations', quotationId);
  if (!quotation) throw new Error('Quotation not found.');
  const invoiceId = await createInvoice({
    business_id: quotation.business_id,
    kind: 'tax_invoice',
    customer_id: quotation.customer_id,
    buyer_user_id: quotation.buyer_user_id,
    quotation_id: quotation.id,
    currency: quotation.currency,
    due_days: undefined,
    items: (quotation.items ?? []).map((l) => ({
      product_id: l.product_id,
      variant_id: l.variant_id,
      service_id: l.service_id,
      name: l.description,
      description: l.description,
      unit_price: toNum(l.unit_price),
      quantity: toNum(l.quantity),
      unit: l.unit,
      discount_percent: toNum(l.discount_percent),
      tax_rate: toNum(l.tax_rate),
      notes: l.notes,
    })) as unknown as DocumentLineInput[],
    delivery_fee: toNum(quotation.delivery_fee),
    reference: `Quotation ${quotation.quotation_number}`,
    customer: quotation.customer
      ? { name: quotation.customer.name, email: quotation.customer.email ?? undefined, phone: quotation.customer.phone ?? undefined }
      : undefined,
  });
  await patchRow('quotations', quotation.id, {
    converted_invoice_id: invoiceId,
    status: 'accepted',
    responded_at: nowIso(),
    updated_at: nowIso(),
  });
  return invoiceId;
}

export async function createReceipt(input: {
  business_id: UUID;
  amount: number;
  method: Receipt['method'];
  payment_id?: UUID | null;
  invoice_id?: UUID | null;
  order_id?: UUID | null;
  customer_id?: UUID | null;
  customer_name?: string;
  currency?: string;
  notes?: string;
  balance_after?: number;
}): Promise<UUID> {
  const business = await requireBusiness(input.business_id);
  const currency = input.currency ?? business.base_currency ?? 'ZMW';
  const id = newId();
  const receiptNumber = await allocateNumber(input.business_id, 'next_receipt_number', business.receipt_prefix ?? '');
  const customer = input.customer_name ?? null;
  await writeRow<{ id: string }>('receipts', id, {
    business_id: business.id,
    receipt_number: receiptNumber,
    payment_id: input.payment_id ?? null,
    invoice_id: input.invoice_id ?? null,
    order_id: input.order_id ?? null,
    customer_id: input.customer_id ?? null,
    customer_name: customer,
    amount: roundMoney(toNum(input.amount), currency),
    currency,
    method: input.method,
    balance_after: roundMoney(toNum(input.balance_after ?? 0), currency),
    received_at: nowIso(),
    notes: input.notes ?? null,
    qr_token: null,
    share_token: null,
    signed_by_name: null,
    created_by_name: null,
    is_automatic: false,
    business: businessSummaryOf(business),
    created_at: nowIso(),
    updated_at: nowIso(),
  } as never);
  return id;
}

/* ── Share tokens (public document links) ─────────────────────────────────── */

function newToken(): string {
  const abc = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  for (let i = 0; i < 28; i += 1) out += abc[Math.floor(Math.random() * abc.length)];
  return out;
}

export async function createShareToken(entityType: string, entityId: UUID, expiresDays = 30): Promise<string> {
  const token = newToken();
  await addRow<{ id: string }>('shares', {
    entity_type: entityType,
    entity_id: entityId,
    token,
    expires_at: addDays(nowIso(), expiresDays) + 'T23:59:59.999Z',
    view_count: 0,
    viewed_at: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  }, token);
  // Stamp the entity itself with the token: Firestore rules can then allow
  // anonymous reads of exactly the documents the owner chose to share
  // (resource.data.share_token != null && not expired), and only those.
  const collection = entityType === 'invoice' ? 'invoices'
    : entityType === 'quotation' ? 'quotations'
    : entityType === 'receipt' ? 'receipts'
    : entityType === 'order' ? 'orders' : null;
  if (collection) {
    void patchRow(collection, entityId, { share_token: token, share_expires_at: addDays(nowIso(), expiresDays) }).catch(() => undefined);
  }
  return token;
}

export async function markDocumentViewed(entityType: string, shareToken: string, meta: Record<string, unknown> = {}): Promise<boolean> {
  const share = await fetchRow<{ id: string; entity_id: string; view_count: number; seen_by?: string[] }>('shares', shareToken);
  if (!share) return false;
  try {
    await patchRow('shares', shareToken, {
      view_count: toNum(share.view_count) + 1,
      last_viewed_at: nowIso(),
      last_meta: meta ?? null,
      updated_at: nowIso(),
    });
  } catch { /* best effort */ }
  void entityType;
  return true;
}

export async function getSharedDocument(entityType: string, shareToken: string): Promise<Record<string, unknown>> {
  const share = await fetchRow<{ id: string; entity_type: string; entity_id: string; expires_at: string | null }>('shares', shareToken);
  if (!share) return { found: false, message: 'That link is not valid.' };
  if (share.entity_type !== entityType) return { found: false, message: 'That link is not valid.' };
  if (share.expires_at && share.expires_at < nowIso()) return { found: false, reason: 'expired', message: 'That link has expired.' };
  const collection = entityType === 'invoice' ? 'invoices' : entityType === 'quotation' ? 'quotations' : entityType === 'receipt' ? 'receipts' : entityType === 'order' ? 'orders' : null;
  if (!collection) return { found: false, message: 'That document type is not supported.' };
  const doc = await fetchRow<Record<string, unknown>>(collection, share.entity_id);
  if (!doc) return { found: false, message: 'That document could not be found.' };
  if (entityType === 'invoice' || entityType === 'quotation') {
    await patchRow(collection, share.entity_id, { viewed_at: nowIso(), viewed_count: Number(doc.viewed_count ?? 0) + 1, updated_at: nowIso() });
  }
  return { found: true, ...doc };
}

export async function respondToQuotation(input: {
  shareToken: string;
  response: 'accepted' | 'rejected' | 'change_requested';
  signerName?: string;
  note?: string;
  signatureImage?: string;
}): Promise<Record<string, unknown>> {
  const share = await fetchRow<{ id: string; entity_id: string }>('shares', input.shareToken);
  if (!share) return { ok: false, message: 'That link is not valid.' };
  const quotation = await fetchRow<Quotation>('quotations', share.entity_id);
  if (!quotation) return { ok: false, message: 'That quotation no longer exists.' };
  const status = input.response === 'accepted' ? 'accepted' : input.response === 'rejected' ? 'rejected' : 'change_requested';
  const patch: Record<string, unknown> = {
    status,
    responded_at: nowIso(),
    response_note: input.note ?? null,
    signer_name: input.signerName ?? null,
    signed_at: input.response === 'accepted' && input.signatureImage ? nowIso() : quotation.signed_at ?? null,
    updated_at: nowIso(),
  };
  if (input.signatureImage) patch.signature_data = input.signatureImage;
  await patchRow('quotations', quotation.id, patch);
  const business = await fetchRow<Business>('businesses', quotation.business_id);
  if (business) {
    await notifyBusinessMembers(business.id, {
      type: 'invoice',
      title: `Quotation ${quotation.quotation_number} ${status.replace('_', ' ')}`,
      body: `${input.signerName ?? 'The customer'} ${status === 'accepted' ? 'accepted' : status === 'rejected' ? 'rejected' : 'requested changes to'} your quotation.`,
      icon: 'invoice',
      action_url: `/business/quotations/${quotation.id}`,
      entity_type: 'quotation',
      entity_id: quotation.id,
      priority: status === 'accepted' ? 'high' : 'normal',
    });
  }
  return { ok: true, quotation_id: quotation.id, status };
}

/* ── Payments links ────────────────────────────────────────────────────────── */

export async function createPaymentLink(input: {
  business_id: UUID;
  amount: number;
  label?: string;
  description?: string;
  currency?: string;
  customer_id?: UUID | null;
  customer?: { name: string };
  customer_name?: string;
  customer_phone?: string;
  customer_email?: string;
  invoice_id?: UUID | null;
  order_id?: UUID | null;
  quotation_id?: UUID | null;
  methods?: string[];
  message?: string;
  allow_custom_amount?: boolean;
  min_amount?: number | null;
  max_amount?: number | null;
  expires_at?: string | null;
}): Promise<{ id: UUID; code: string; url: string }> {
  const business = await requireBusiness(input.business_id);
  const id = newId();
  const code = makeLinkCode();
  const methods = (input.methods?.length ? input.methods : ['mobile_money', 'bank_transfer', 'cash']) as Payment['method'][];
  await writeRow<{ id: string }>('payment_links', id, {
    business_id: business.id,
    code,
    label: input.label ?? input.description ?? 'Payment',
    description: input.description ?? null,
    amount: roundMoney(toNum(input.amount), business.base_currency ?? 'ZMW'),
    currency: input.currency ?? business.base_currency ?? 'ZMW',
    allow_custom_amount: Boolean(input.allow_custom_amount),
    min_amount: input.min_amount ?? null,
    max_amount: input.max_amount ?? null,
    invoice_id: input.invoice_id ?? null,
    order_id: input.order_id ?? null,
    quotation_id: input.quotation_id ?? null,
    customer_id: input.customer_id ?? null,
    customer_name: input.customer_name ?? input.customer?.name ?? null,
    customer_phone: input.customer_phone ?? null,
    customer_email: input.customer_email ?? null,
    methods,
    status: 'active',
    expires_at: input.expires_at ?? null,
    payments_count: 0,
    amount_collected: 0,
    message: input.message ?? null,
    thank_you_message: null,
    business: businessSummaryOf(business),
    created_at: nowIso(),
    updated_at: nowIso(),
  } as never);
  return { id, code, url: `${env.appUrl}/pay/${code}` };
}

function makeLinkCode(): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i += 1) out += abc[Math.floor(Math.random() * abc.length)];
  return out;
}

export interface PaymentLinkPayload {
  found: boolean;
  reason?: 'inactive' | 'expired';
  message?: string | null;
  code?: string;
  label?: string | null;
  description?: string | null;
  amount?: number;
  currency?: string;
  allow_custom_amount?: boolean;
  min_amount?: number | null;
  max_amount?: number | null;
  methods?: Payment['method'][];
  message_to_payer?: string | null;
  thank_you_message?: string | null;
  redirect_url?: string | null;
  customer_name?: string | null;
  status?: string;
  expires_at?: string | null;
  amount_collected?: number;
  balance?: number;
  submissions?: number;
  invoice_number?: string | null;
  order_number?: string | null;
  business?: {
    name: string; logo_url: string | null; slug: string; phone: string | null;
    email: string | null; city: string | null; country_code: string; address_line1: string | null;
    verification_status: string; rating_avg: number;
    bank_details?: Business['bank_details'];
  };
}

export async function getPaymentLink(code: string): Promise<PaymentLinkPayload> {
  const links = await fetchList<{ id: string; [k: string]: unknown }>('payment_links', {
    where: [['code', '==', code] as DbWhere],
    limit: 1,
  });
  const link = links[0];
  if (!link) return { found: false, message: 'That payment link is not valid.' };
  if (link.status !== 'active') {
    return { found: false, reason: 'inactive', message: link.status === 'paid' ? 'This payment link has already been paid.' : 'That payment link is not active.' };
  }
  if (link.expires_at && String(link.expires_at) < nowIso()) {
    return { found: false, reason: 'expired', message: 'That payment link has expired.' };
  }
  const submissions = await fetchList<{ id: string; status: string; amount: number }>('payment_submissions', {
    where: [['payment_link_id', '==', link.id] as DbWhere],
    limit: 200,
  });
  const collected = roundMoney(submissions.filter((s) => s.status === 'confirmed').reduce((s, x) => s + toNum(x.amount), 0));
  const business = link.business ? (link.business as PaymentLinkPayload['business']) : undefined;
  return {
    found: true,
    code,
    label: (link.label as string) ?? null,
    description: (link.description as string | null) ?? null,
    amount: Number(link.amount ?? 0),
    currency: (link.currency as string) ?? 'ZMW',
    allow_custom_amount: Boolean(link.allow_custom_amount),
    min_amount: link.min_amount as number | null,
    max_amount: link.max_amount as number | null,
    methods: link.methods as Payment['method'][],
    message_to_payer: link.message as string | null,
    thank_you_message: link.thank_you_message as string | null,
    customer_name: link.customer_name as string | null,
    status: link.status as string,
    expires_at: (link.expires_at as string | null) ?? null,
    amount_collected: collected,
    balance: Math.max(Number(link.amount ?? 0) - collected, 0),
    submissions: submissions.length,
    business: business ?? undefined,
  };
}

/**
 * An anonymous payer declares "I have paid".
 *
 * This never marks money as received: it queues the declaration for the seller,
 * who confirms it and only then is a real payment and receipt written.
 */
export async function payViaLink(input: {
  code: string;
  method: string;
  provider?: string;
  reference?: string;
  amount?: number;
  payer_name?: string;
  payer_phone?: string;
  payer_email?: string;
}): Promise<{
  ok: boolean;
  duplicate?: boolean;
  submission_id?: UUID;
  amount?: number;
  currency?: string;
  status?: string;
  message?: string;
}> {
  const payload = await getPaymentLink(input.code);
  if (!payload.found) return { ok: false, message: payload.message ?? 'That payment link is not valid.' };
  const links = await fetchList<{ id: string; business_id: string; currency: string }>('payment_links', {
    where: [['code', '==', input.code] as DbWhere], limit: 1,
  });
  const link = links[0];
  if (!link) return { ok: false, message: 'That payment link is not valid.' };
  const amount = roundMoney(toNum(input.amount ?? payload.amount));
  if (amount <= 0) return { ok: false, message: 'Enter an amount greater than zero.' };
  if (!input.method) return { ok: false, message: 'Choose a payment method.' };

  // Duplicate guard: same link + method + reference within 5 minutes.
  const recent = await fetchList<{ id: string; reference: string; created_at: string }>('payment_submissions', {
    where: [
      ['payment_link_id', '==', link.id] as DbWhere,
      ['method', '==', input.method] as DbWhere,
      ['status', '==', 'submitted'] as DbWhere,
    ],
    limit: 10,
  });
  if (input.reference && recent.some((r) => r.reference === input.reference)) {
    return { ok: false, duplicate: true, message: 'That reference was already submitted. The seller will confirm it shortly.' };
  }

  const id = newId();
  await addRow<{ id: string }>('payment_submissions', {
    payment_link_id: link.id,
    business_id: link.business_id,
    amount,
    currency: link.currency ?? 'ZMW',
    method: input.method,
    provider: input.provider ?? null,
    reference: input.reference ?? null,
    payer_name: input.payer_name ?? null,
    payer_phone: input.payer_phone ?? null,
    payer_email: input.payer_email ?? null,
    status: 'submitted',
    payment_id: null,
    receipt_id: null,
    note: null,
    invoice_id: null,
    order_id: null,
    customer_id: null,
    reviewed_by_name: null,
    reviewed_at: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  }, id);

  await notifyBusinessMembers(link.business_id, {
    type: 'payment',
    title: 'Payment submitted',
    body: `${input.payer_name ?? 'Someone'} submitted ${link.currency ?? 'ZMW'} ${amount.toFixed(2)} for your payment link. Review it to confirm.`,
    icon: 'wallet',
    action_url: '/business/payments',
    entity_type: 'payment_submission',
    entity_id: id,
    priority: 'high',
  });

  return { ok: true, submission_id: id, amount, currency: link.currency ?? 'ZMW', status: 'submitted' };
}

export interface PaymentSubmission {
  id: UUID;
  payment_link_id: UUID;
  business_id: UUID;
  amount: number;
  currency: string;
  method: Payment['method'];
  provider: string | null;
  reference: string | null;
  payer_name: string | null;
  payer_phone: string | null;
  payer_email: string | null;
  status: 'submitted' | 'confirmed' | 'rejected' | 'duplicate';
  payment_id: UUID | null;
  receipt_id: UUID | null;
  note: string | null;
  invoice_id: UUID | null;
  order_id: UUID | null;
  customer_id: UUID | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export async function resolvePaymentSubmission(
  submissionId: UUID,
  action: 'confirm' | 'reject',
  note?: string,
): Promise<{ ok: boolean; status: string; submission_id: UUID; payment_id?: UUID | null; receipt_id?: UUID | null }> {
  const submission = await fetchRow<PaymentSubmission>('payment_submissions', submissionId);
  if (!submission) throw new Error('That payment submission no longer exists.');
  if (submission.status !== 'submitted') {
    return { ok: false, status: submission.status, submission_id: submissionId };
  }
  if (action === 'reject') {
    await patchRow('payment_submissions', submissionId, {
      status: 'rejected',
      note: note ?? null,
      reviewed_by_name: 'Seller',
      reviewed_at: nowIso(),
      updated_at: nowIso(),
    });
    return { ok: true, status: 'rejected', submission_id: submissionId };
  }

  const payment = await recordPayment({
    business_id: submission.business_id,
    amount: submission.amount,
    method: submission.method,
    currency: submission.currency,
    invoice_id: submission.invoice_id,
    order_id: submission.order_id,
    customer_id: submission.customer_id,
    reference: submission.reference ?? undefined,
    received_at: nowIso(),
    notes: note ?? `Confirmed from payment link submission`,
    generate_receipt: true,
    provider: submission.provider ?? 'payment_link',
    payer_name: submission.payer_name ?? undefined,
    payer_phone: submission.payer_phone ?? undefined,
    payer_email: submission.payer_email ?? undefined,
    transaction_ref: submission.reference ?? undefined,
  });

  await patchRow('payment_submissions', submissionId, {
    status: 'confirmed',
    payment_id: payment.payment_id,
    receipt_id: payment.receipt_id,
    note: note ?? null,
    reviewed_by_name: 'Seller',
    reviewed_at: nowIso(),
    updated_at: nowIso(),
  });

  // Reflect confirmed amount on the payment link.
  const link = submission.payment_link_id ? await fetchRow<{ id: string; amount_collected: number; payments_count: number; status: string; amount: number }>('payment_links', submission.payment_link_id) : null;
  if (link) {
    const collected = roundMoney(toNum(link.amount_collected) + payment.amount);
    await patchRow('payment_links', link.id, {
      amount_collected: collected,
      payments_count: toNum(link.payments_count) + 1,
      status: collected >= toNum(link.amount) ? 'paid' : link.status,
      updated_at: nowIso(),
    });
  }
  return { ok: true, status: 'confirmed', submission_id: submissionId, payment_id: payment.payment_id, receipt_id: payment.receipt_id };
}

/* ── Dashboard & reports ───────────────────────────────────────────────────── */

export interface DashboardSummary {
  currency: string;
  symbol: string;
  from: string;
  to: string;
  today: { sales: number; orders: number; payments: number };
  period: { revenue: number; orders: number; cogs: number; profit: number; items_sold: number };
  expenses: number;
  receivable: number;
  overdue: { amount: number; count: number };
  payable: number;
  available: number;
  stock: { value: number; units: number; low: number; out: number };
  counts: {
    products: number; published: number; drafts: number; customers: number; new_customers: number;
    orders_pending: number; quotations_open: number; invoices_unpaid: number; reviews: number;
    unread_messages: number; staff: number;
  };
  pending_approvals: {
    refunds: number; purchase_orders: number; expenses: number; ai_actions: number; returns: number;
  };
  verification: { status: string; badges: string[]; growth_score: number };
}

export async function dashboardSummary(
  businessId: UUID, from?: string | null, to?: string | null, branchId?: UUID | null,
): Promise<DashboardSummary> {
  const business = await fetchRow<Business>('businesses', businessId);
  const baseWhere: DbWhere[] = [['business_id', '==', businessId] as DbWhere];
  if (branchId) baseWhere.push(['branch_id', '==', branchId] as DbWhere);
  const currency = business?.base_currency ?? 'ZMW';

  const todayStart = nowIso().slice(0, 10);
  const [orders, payments, invoices, quotations, products, customers, reviews] = await Promise.all([
    fetchList<Order>('orders', { where: baseWhere, orderByField: 'placed_at', orderDir: 'desc', limit: 400 }),
    fetchList<Payment>('payments', { where: baseWhere, orderByField: 'received_at', orderDir: 'desc', limit: 300 }),
    fetchList<Invoice>('invoices', { where: baseWhere, limit: 400 }),
    fetchList<Quotation>('quotations', { where: baseWhere, limit: 300 }),
    fetchList<Product>('products', { where: baseWhere, limit: 500 }),
    fetchList<Customer>('customers', { where: baseWhere, limit: 500 }),
    fetchList<{ id: string; created_at: string }>('reviews', { where: baseWhere, limit: 300 }),
  ]);

  const activeOrders = orders.filter((o) => !['cancelled', 'returned'].includes(o.status));
  const revenue = roundMoney(activeOrders.filter((o) => ['delivered', 'completed', 'processing', 'ready', 'shipped', 'confirmed'].includes(o.status)).reduce((s, o) => s + toNum(o.total), 0));
  const today = orders.filter((o) => (o.placed_at ?? '').startsWith(todayStart));
  const todayRevenue = roundMoney(today.reduce((s, o) => s + toNum(o.total), 0));
  const itemsSold = activeOrders.reduce((s, o) => s + (o.items ?? []).reduce((x, i) => x + toNum(i.quantity), 0), 0);
  const paidOrders = orders.filter((o) => o.payment_status === 'completed' && o.status === 'delivered');
  const cogs = roundMoney(paidOrders.reduce((s, o) => s + (o.items ?? []).reduce((x, i) => x + toNum(i.unit_cost) * toNum(i.quantity), 0), 0));

  const unpaidInvoices = invoices.filter((i) => ['sent', 'viewed', 'partially_paid', 'overdue'].includes(i.status) && toNum(i.balance_due) > 0);
  const receivable = roundMoney(unpaidInvoices.reduce((s, i) => s + toNum(i.balance_due), 0));
  const overdueInvs = invoices.filter((i) => i.status === 'overdue' || (i.due_date && i.due_date < todayStart && ['sent', 'viewed', 'partially_paid'].includes(i.status)));
  const overdueAmount = roundMoney(overdueInvs.reduce((s, i) => s + toNum(i.balance_due), 0));

  const paymentsIn = payments.filter((p) => p.direction === 'inbound');
  const todayPayments = paymentsIn.filter((p) => (p.received_at ?? '').startsWith(todayStart)).reduce((s, p) => s + toNum(p.amount), 0);

  const stockUnits = products.reduce((s, p) => s + toNum(p.stock), 0);
  const stockValue = roundMoney(products.reduce((s, p) => s + toNum(p.stock) * toNum(p.cost_price), 0));
  const lowStock = products.filter((p) => p.track_inventory && toNum(p.stock) > 0 && toNum(p.stock) <= toNum(p.stock_alert)).length;
  const outOfStock = products.filter((p) => p.track_inventory && toNum(p.stock) <= 0 && p.is_published).length;

  const pendingOrders = orders.filter((o) => ['pending', 'confirmed', 'processing'].includes(o.status)).length;
  const openQuotations = quotations.filter((q) => ['draft', 'sent', 'viewed'].includes(q.status)).length;
  const invoicesUnpaid = unpaidInvoices.length;

  return {
    currency,
    symbol: currencySymbol(currency),
    from: from ?? todayStart,
    to: to ?? todayStart,
    today: { sales: todayRevenue, orders: today.length, payments: roundMoney(todayPayments) },
    period: { revenue, orders: activeOrders.length, cogs, profit: roundMoney(revenue - cogs), items_sold: itemsSold },
    expenses: 0,
    receivable,
    overdue: { amount: overdueAmount, count: overdueInvs.length },
    payable: 0,
    available: roundMoney(paymentsIn.filter((p) => p.status === 'completed').reduce((s, p) => s + toNum(p.amount), 0)),
    stock: { value: stockValue, units: stockUnits, low: lowStock, out: outOfStock },
    counts: {
      products: products.length,
      published: products.filter((p) => p.is_published).length,
      drafts: products.filter((p) => !p.is_published).length,
      customers: customers.length,
      new_customers: customers.filter((c) => (c.created_at ?? '').startsWith(todayStart)).length,
      orders_pending: pendingOrders,
      quotations_open: openQuotations,
      invoices_unpaid: invoicesUnpaid,
      reviews: reviews.length,
      unread_messages: 0,
      staff: 0,
    },
    pending_approvals: { refunds: 0, purchase_orders: 0, expenses: 0, ai_actions: 0, returns: 0 },
    verification: {
      status: business?.verification_status ?? 'unverified',
      badges: business?.badges ?? [],
      growth_score: toNum(business?.growth_score),
    },
  };
}

function currencySymbol(code: string): string {
  const map: Record<string, string> = { ZMW: 'K', USD: '$', EUR: '€', GBP: '£', ZAR: 'R', MWK: 'MK', NGN: '₦', KES: 'KSh', TZS: 'TSh', UGX: 'USh' };
  return map[code] ?? code;
}

export interface SalesPoint {
  bucket: string;
  revenue: number;
  orders: number;
  profit: number;
  items: number;
}

export async function salesSeries(
  businessId: UUID, from: string, to: string, granularity: 'day' | 'week' | 'month' = 'day',
): Promise<{ series: SalesPoint[]; granularity: string; from: string; to: string }> {
  const orders = await fetchList<Order>('orders', {
    where: [['business_id', '==', businessId] as DbWhere],
    orderByField: 'placed_at', orderDir: 'asc', limit: 600,
  });
  const inRange = orders.filter((o) => (o.placed_at ?? '').slice(0, 10) >= from && (o.placed_at ?? '').slice(0, 10) <= to);
  const buckets = new Map<string, SalesPoint>();
  inRange.forEach((o) => {
    const date = (o.placed_at ?? '').slice(0, 10);
    const key = granularity === 'month' ? date.slice(0, 7) : granularity === 'week' ? isoWeek(date) : date;
    const point = buckets.get(key) ?? { bucket: key, revenue: 0, orders: 0, profit: 0, items: 0 };
    point.revenue = roundMoney(point.revenue + toNum(o.total));
    point.orders += 1;
    point.items += (o.items ?? []).reduce((s, i) => s + toNum(i.quantity), 0);
    buckets.set(key, point);
  });
  const series = Array.from(buckets.values()).sort((a, b) => a.bucket.localeCompare(b.bucket));
  return { series, granularity, from, to };
}

function isoWeek(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d.getTime() - firstThu.getTime()) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export interface TopProductRow {
  product_id: UUID | null;
  name: string;
  sku: string | null;
  image_url: string | null;
  quantity: number;
  revenue: number;
  profit: number;
}

export async function topProducts(
  businessId: UUID, from: string, to: string, limit = 10,
  order: 'revenue' | 'quantity' | 'profit' = 'revenue',
): Promise<{ items: TopProductRow[] }> {
  const orders = await fetchList<Order>('orders', {
    where: [['business_id', '==', businessId] as DbWhere],
    orderByField: 'placed_at', orderDir: 'desc', limit: 400,
  });
  const rows = new Map<string, TopProductRow>();
  orders
    .filter((o) => (o.placed_at ?? '').slice(0, 10) >= from && (o.placed_at ?? '').slice(0, 10) <= to && !['cancelled', 'returned'].includes(o.status))
    .forEach((o) => {
      (o.items ?? []).forEach((l) => {
        const key = l.product_id ?? l.name;
        const row = rows.get(key) ?? { product_id: l.product_id, name: l.name, sku: l.sku, image_url: l.image_url, quantity: 0, revenue: 0, profit: 0 };
        row.quantity += toNum(l.quantity);
        row.revenue = roundMoney(row.revenue + toNum(l.line_total));
        row.profit = roundMoney(row.profit + (toNum(l.unit_price) - toNum(l.unit_cost)) * toNum(l.quantity));
        rows.set(key, row);
      });
    });
  const items = Array.from(rows.values()).sort((a, b) => {
    if (order === 'quantity') return b.quantity - a.quantity;
    if (order === 'profit') return b.profit - a.profit;
    return b.revenue - a.revenue;
  }).slice(0, Math.max(1, Math.min(limit, 50)));
  return { items };
}

export interface TopCustomerRow {
  id: UUID; name: string; phone: string | null; email: string | null; city: string | null;
  customer_group: string | null; orders_count: number; total_spent: number;
  outstanding_balance: number; last_order_at: string | null; loyalty_points: number;
}

export async function topCustomers(businessId: UUID, limit = 10): Promise<{ items: TopCustomerRow[] }> {
  const customers = await fetchList<Customer>('customers', {
    where: [['business_id', '==', businessId] as DbWhere],
    orderByField: 'total_spent', orderDir: 'desc', limit: Math.max(limit, 50),
  });
  const items: TopCustomerRow[] = customers.slice(0, limit).map((c) => ({
    id: c.id, name: c.name, phone: c.phone, email: c.email, city: c.city,
    customer_group: c.customer_group, orders_count: toNum(c.orders_count),
    total_spent: toNum(c.total_spent), outstanding_balance: toNum(c.outstanding_balance),
    last_order_at: c.last_order_at, loyalty_points: toNum(c.loyalty_points),
  }));
  return { items };
}

export interface LowStockRow {
  product_id: UUID;
  name: string;
  sku: string | null;
  primary_image_url: string | null;
  product_stock: number;
  stock_alert: number;
  warehouse: string;
  warehouse_id: UUID;
  quantity_on_hand: number;
  quantity_reserved: number;
  reorder_point: number;
  unit_cost: number;
  stock_value: number;
  bin_location: string | null;
  shortfall: number;
  severity: number;
  level: 'low_stock' | 'out_of_stock';
}

export async function lowStockAlerts(businessId: UUID, limit = 20): Promise<{ items: LowStockRow[]; count: number }> {
  const products = await fetchList<Product>('products', {
    where: [['business_id', '==', businessId] as DbWhere, ['track_inventory', '==', true] as DbWhere],
    limit: 600,
  });
  const alerts = products
    .filter((p) => toNum(p.stock) <= toNum(p.stock_alert))
    .map((p) => ({
      product_id: p.id,
      name: p.name,
      sku: p.sku,
      primary_image_url: p.primary_image_url,
      product_stock: toNum(p.stock),
      stock_alert: toNum(p.stock_alert),
      warehouse: 'Main',
      warehouse_id: '',
      quantity_on_hand: toNum(p.stock),
      quantity_reserved: 0,
      reorder_point: toNum(p.stock_alert),
      unit_cost: toNum(p.cost_price),
      stock_value: roundMoney(toNum(p.stock) * toNum(p.cost_price)),
      bin_location: null,
      shortfall: Math.max(toNum(p.stock_alert) - toNum(p.stock), 0),
      severity: toNum(p.stock) <= 0 ? 2 : toNum(p.stock) <= toNum(p.stock_alert) / 2 ? 1 : 0,
      level: (toNum(p.stock) <= 0 ? 'out_of_stock' : 'low_stock') as LowStockRow['level'],
    }))
    .sort((a, b) => b.severity - a.severity || a.name.localeCompare(b.name));
  return { items: alerts.slice(0, limit), count: alerts.length };
}

export interface OverdueInvoiceRow {
  id: UUID;
  invoice_number: string;
  issue_date: string;
  due_date: string;
  total: number;
  amount_paid: number;
  balance_due: number;
  currency: string;
  status: string;
  days_overdue: number;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  share_token: string | null;
  reminders_sent: number;
}

export async function overdueInvoices(businessId: UUID, limit = 50): Promise<{ items: OverdueInvoiceRow[]; total_outstanding: number }> {
  const today = nowIso().slice(0, 10);
  const invoices = await fetchList<Invoice>('invoices', {
    where: [['business_id', '==', businessId] as DbWhere],
    limit: 400,
  });
  const overdue = invoices.filter((i) => i.status !== 'paid' && i.status !== 'void' && toNum(i.balance_due) > 0 && !!i.due_date && String(i.due_date) < today);
  const items: OverdueInvoiceRow[] = overdue.slice(0, limit).map((i) => ({
    id: i.id,
    invoice_number: i.invoice_number,
    issue_date: i.issue_date,
    due_date: i.due_date ?? '',
    total: toNum(i.total),
    amount_paid: toNum(i.amount_paid),
    balance_due: toNum(i.balance_due),
    currency: i.currency,
    status: i.status,
    days_overdue: Math.max(0, Math.floor((Date.now() - new Date(`${i.due_date}T00:00:00Z`).getTime()) / 86400000)),
    customer_name: i.customer?.name ?? null,
    customer_phone: i.customer?.phone ?? null,
    customer_email: i.customer?.email ?? null,
    share_token: i.share_token,
    reminders_sent: toNum(i.reminders_sent),
  }));
  return { items, total_outstanding: roundMoney(items.reduce((s, i) => s + i.balance_due, 0)) };
}

export interface GrowthBreakdown {
  profile: number; catalogue: number; activity: number; inventory: number; reputation: number;
  total: number;
  level: 'getting_started' | 'developing' | 'strong' | 'excellent';
  next_steps: string[];
}

export async function computeGrowthScore(businessId: UUID): Promise<GrowthBreakdown> {
  const business = await fetchRow<Business>('businesses', businessId);
  const profile = business
    ? 20 + (business.logo_url ? 20 : 0) + (business.cover_url ? 10 : 0) + (business.description ? 15 : 0)
        + (business.phone ? 10 : 0) + (business.email ? 5 : 0) + (business.address_line1 ? 10 : 0) + (business.whatsapp ? 10 : 0)
    : 0;
  const products = await fetchList<Product>('products', { where: [['business_id', '==', businessId] as DbWhere], limit: 500 });
  const catalogue = Math.min(60, Math.round((products.length / 10) * 30 + (products.filter((p) => p.primary_image_url).length / Math.max(products.length, 1)) * 20 + (products.some((p) => p.is_published) ? 10 : 0)));
  const orders = await fetchList<Order>('orders', { where: [['business_id', '==', businessId] as DbWhere], limit: 300 });
  const activity = Math.min(40, orders.length * 4);
  const inventory = Math.min(30, products.filter((p) => p.track_inventory).length * 2);
  const total = Math.min(100, Math.round((profile + catalogue + activity + inventory) / 1.8));
  const level = total >= 80 ? 'excellent' : total >= 55 ? 'strong' : total >= 30 ? 'developing' : 'getting_started';
  const nextSteps: string[] = [];
  if (!business?.logo_url) nextSteps.push('Upload a business logo.');
  if (!business?.description) nextSteps.push('Write a short business description.');
  if (products.length === 0) nextSteps.push('Add your first products or services.');
  if (orders.length === 0) nextSteps.push('Place your first sale or use the POS.');
  if (products.length > 0 && inventory === 0) nextSteps.push('Enable inventory tracking on your products.');
  if (total < 100) nextSteps.push('Keep publishing products to grow your score.');
  return { profile, catalogue, activity, inventory, reputation: 0, total, level, next_steps: nextSteps };
}

/* ── Coupons ───────────────────────────────────────────────────────────────── */

export interface CouponCheck {
  valid: boolean;
  coupon_id?: UUID;
  code?: string;
  discount_type?: 'percent' | 'fixed' | 'free_delivery';
  discount_value?: number;
  discount?: number;
  description?: string | null;
  ends_at?: string | null;
  reason?: 'not_found' | 'exhausted' | 'min_subtotal' | 'per_customer_limit';
  required?: number;
}

export async function validateCoupon(code: string, businessId: UUID | null, subtotal: number): Promise<CouponCheck> {
  const where: DbWhere[] = [['code', '==', String(code).trim().toUpperCase()] as DbWhere];
  if (businessId) where.push(['business_id', '==', businessId] as DbWhere);
  const coupons = await fetchList<CouponLike>('coupons', { where, limit: 1 });
  const coupon = coupons[0];
  const reason = coupon?.status !== 'active' ? 'not_found' : undefined;
  if (!coupon || reason) {
    return { valid: false, reason: (reason ?? 'not_found') as CouponCheck['reason'] };
  }
  const now = nowIso();
  if (coupon.ends_at && coupon.ends_at < now) return { valid: false, reason: 'exhausted' };
  if (toNum(coupon.max_uses) > 0 && toNum(coupon.used_count) >= toNum(coupon.max_uses)) return { valid: false, reason: 'exhausted' };
  const minSubtotal = toNum(coupon.min_subtotal);
  if (minSubtotal > 0 && subtotal < minSubtotal) {
    return { valid: false, reason: 'min_subtotal', required: minSubtotal };
  }
  const discountValue = toNum(coupon.discount_value);
  const discount = coupon.discount_type === 'percent' ? roundMoney((subtotal * discountValue) / 100) : Math.min(discountValue, subtotal);
  return {
    valid: true,
    coupon_id: coupon.id,
    code: coupon.code,
    discount_type: coupon.discount_type,
    discount_value: discountValue,
    discount,
    description: coupon.description ?? null,
    ends_at: coupon.ends_at ?? null,
  };
}

interface CouponLike {
  id: string;
  code: string;
  business_id: string | null;
  discount_type: 'percent' | 'fixed' | 'free_delivery';
  discount_value: number;
  min_subtotal: number;
  max_uses: number;
  used_count: number;
  ends_at: string | null;
  status: string;
  description?: string | null;
}

/* ── CSV import ────────────────────────────────────────────────────────────── */

export async function importCsvRows(sourceId: UUID, rows: Record<string, unknown>[]): Promise<{ created: number; updated: number; skipped: number; errors: { row: number; message: string }[] }> {
  const source = await fetchRow<{ id: string; business_id: string; kind: string }>('import_sources', sourceId);
  let created = 0;
  let updated = 0;
  const skipped = 0;
  const errors: { row: number; message: string }[] = [];
  if (!source) return { created, updated, skipped, errors: rows.map((_, i) => ({ row: i + 1, message: 'Import source not found.' })) };
  if (source.kind === 'products') {
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];
      try {
        const name = String(r.name ?? r.title ?? '').trim();
        if (!name) throw new Error('Missing product name.');
        const sku = r.sku ? String(r.sku).trim() : null;
        if (sku) {
          const existing = await fetchList<Product>('products', {
            where: [['business_id', '==', source.business_id] as DbWhere, ['sku', '==', sku] as DbWhere], limit: 1,
          });
          if (existing[0]) {
            await patchRow('products', existing[0].id, { name, updated_at: nowIso() });
            updated += 1;
            continue;
          }
        }
        const id = newId();
        await addRow<Product>('products', {
          id,
          business_id: source.business_id,
          store_id: null,
          branch_id: null,
          name,
          slug: slugify(name) + '-' + id.slice(0, 6),
          sku,
          barcode: r.barcode ? String(r.barcode) : null,
          barcode_format: 'auto',
          description: r.description ? String(r.description) : null,
          short_description: r.short_description ? String(r.short_description) : null,
          brand: r.brand ? String(r.brand) : null,
          model: null,
          category_id: null,
          tags: [],
          product_type: 'product',
          condition: 'new',
          status: 'active',
          is_published: false,
          is_featured: false,
          is_wholesale: false,
          is_digital: false,
          is_taxable: true,
          tax_id: null,
          currency: 'ZMW',
          price: Number(r.price ?? 0),
          compare_at_price: r.compare_at_price != null ? Number(r.compare_at_price) : null,
          cost_price: r.cost_price != null ? Number(r.cost_price) : 0,
          wholesale_price: r.wholesale_price != null ? Number(r.wholesale_price) : null,
          wholesale_min_qty: 0,
          discount_percent: 0,
          stock: Number(r.stock ?? 0),
          stock_alert: Number(r.stock_alert ?? 3),
          stock_max: null,
          allow_backorder: false,
          track_inventory: true,
          weight_kg: null,
          length_cm: null,
          width_cm: null,
          height_cm: null,
          requires_delivery: false,
          delivery_days: null,
          warranty: null,
          unit: 'pcs',
          has_variants: false,
          variant_options: [],
          service_duration_minutes: null,
          service_area: null,
          is_quotation_only: false,
          media: [],
          primary_image_url: r.image_url ? String(r.image_url) : null,
          source: 'csv',
          external_id: null,
          csv_source_id: sourceId,
          last_synced_at: nowIso(),
          view_count: 0,
          sold_count: 0,
          rating_avg: 0,
          rating_count: 0,
          min_purchase_qty: 1,
          published_at: null,
          created_at: nowIso(),
          updated_at: nowIso(),
        } as never);
        created += 1;
      } catch (e) {
        errors.push({ row: i + 1, message: e instanceof Error ? e.message : 'Invalid row.' });
      }
    }
  }
  return { created, updated, skipped, errors };
}

export async function syncCsvSource(sourceId: UUID, _rows: Record<string, unknown>[]): Promise<Record<string, unknown>> {
  try {
    await patchRow('import_sources', sourceId, { last_synced_at: nowIso(), updated_at: nowIso() });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/* ── AI action centre ──────────────────────────────────────────────────────── */

const AI_IMPACTS: Record<string, { impact: string; requires_approval: boolean; auto_execute: boolean }> = {
  adjust_price: { impact: 'Changes the selling price of one or more products.', requires_approval: true, auto_execute: false },
  adjust_stock: { impact: 'Adjusts stock levels for one or more products.', requires_approval: true, auto_execute: false },
  send_message: { impact: 'Sends a message to a customer.', requires_approval: true, auto_execute: false },
  create_document: { impact: 'Creates a quotation or invoice.', requires_approval: true, auto_execute: false },
  suggest_discount: { impact: 'Proposes a promotional discount.', requires_approval: true, auto_execute: false },
  restock: { impact: 'Marks products for reordering.', requires_approval: false, auto_execute: true },
  default: { impact: 'Performs an automated action on your business data.', requires_approval: true, auto_execute: false },
};

export async function aiActionImpact(action: string): Promise<{ impact: string; requires_approval: boolean; auto_execute: boolean }> {
  return AI_IMPACTS[action] ?? AI_IMPACTS.default;
}

export async function proposeAiAction(
  businessId: UUID, action: string, payload: Record<string, unknown>, explanation?: string, _conversationId?: UUID | null,
): Promise<{ action_id: UUID; status: string; requires_approval: boolean; auto_executed: boolean; result?: unknown }> {
  const meta = await aiActionImpact(action);
  const id = newId();
  await addRow<{ id: string }>('ai_actions', {
    business_id: businessId,
    action,
    payload,
    explanation: explanation ?? null,
    status: meta.auto_execute ? 'approved' : 'pending',
    requires_approval: meta.requires_approval,
    decision: null,
    decision_reason: null,
    created_by: null,
    resolved_by: null,
    resolved_at: null,
    created_at: nowIso(),
    updated_at: nowIso(),
  }, id);
  return { action_id: id, status: meta.auto_execute ? 'approved' : 'pending', requires_approval: meta.requires_approval, auto_executed: meta.auto_execute };
}

export async function resolveAiAction(
  actionId: UUID, decision: 'approved' | 'rejected' | 'modified', reason?: string,
): Promise<{ action_id: UUID; status: string; executed: boolean; result?: unknown }> {
  const action = await fetchRow<{ id: string; action: string; payload: Record<string, unknown> }>('ai_actions', actionId);
  if (!action) throw new Error('Action not found.');
  const approved = decision === 'approved';
  if (approved && action.action === 'adjust_price' && action.payload) {
    const productId = String(action.payload.product_id ?? action.payload.id ?? '');
    const price = Number(action.payload.price ?? 0);
    if (productId && price > 0) {
      await patchRow('products', productId, { price, updated_at: nowIso() });
    }
  }
  await patchRow('ai_actions', actionId, {
    status: approved ? 'approved' : 'rejected',
    decision,
    decision_reason: reason ?? null,
    resolved_at: nowIso(),
    updated_at: nowIso(),
  });
  return { action_id: actionId, status: approved ? 'approved' : 'rejected', executed: approved };
}

/* ── Business setup ────────────────────────────────────────────────────────── */

export async function suggestSlug(name: string): Promise<string> {
  const base = slugify(name);
  if (!base) return '';
  let candidate = base;
  let tries = 0;
  while (!(await isSlugAvailable(candidate)) && tries < 20) {
    tries += 1;
    candidate = `${base}-${tries + 1}`;
  }
  return candidate;
}

export async function isSlugAvailable(slug: string): Promise<boolean> {
  const clean = slug.trim().toLowerCase();
  const reserved = ['admin', 'account', 'business', 'cart', 'checkout', 'search', 'products', 'services', 'login', 'signin', 'signup', 'settings', 'notifications', 'pay', 'd', 'verify', 'share'];
  if (reserved.includes(clean)) return false;
  const rows = await fetchList<{ id: string }>('businesses', { where: [['slug', '==', clean] as DbWhere], limit: 1 });
  return rows.length === 0;
}

/**
 * Create a business from the onboarding form. Creates the business, the owner
 * membership, the primary branch and warehouse, and a starter subscription —
 * one owner action, all on Firestore.
 */
export interface CreateBusinessInput {
  name: string;
  slug?: string;
  legal_name?: string;
  tagline?: string;
  description?: string;
  business_type?: string;
  category_id?: UUID | string | null;
  registration_number?: string;
  tax_number?: string;
  tax_registered?: boolean;
  email?: string;
  phone?: string;
  phone_country_code?: string;
  whatsapp?: string;
  website?: string;
  social?: Record<string, string>;
  address_line1?: string;
  address_line2?: string;
  city?: string;
  region?: string;
  postal_code?: string;
  country_code?: string;
  opening_hours?: Record<string, unknown>;
  time_zone?: string;
  locale?: string;
  base_currency?: string;
  primary_color?: string;
  accent_color?: string;
  logo_url?: string;
  cover_url?: string;
  banner_url?: string;
  invoice_prefix?: string;
  quotation_prefix?: string;
  receipt_prefix?: string;
  order_prefix?: string;
  invoice_terms?: string;
  payment_terms_days?: number;
  quotation_validity_days?: number;
  branch_name?: string;
  warehouse_name?: string;
  accepts_orders?: boolean;
  accepts_wholesale?: boolean;
  is_public?: boolean;
  delivery_enabled?: boolean;
  delivery_fee?: number;
  free_delivery_over?: number;
  delivery_radius_km?: number;
  owner_id?: string;
}

export async function createBusiness(input: CreateBusinessInput): Promise<{ business_id: UUID; store_id: UUID; slug: string; branch_id: UUID; warehouse_id: UUID; store_url: string }> {
  if (!input.name?.trim()) throw new Error('Business name is required.');
  const ownerId = input.owner_id ?? '';
  if (!ownerId) throw new Error('You must be signed in to create a business.');
  const businessId = newId();
  const slug = input.slug?.toLowerCase() || slugify(input.name) || newId('store').toLowerCase();
  const country = input.country_code ?? 'ZM';
  const currency = input.base_currency ?? 'ZMW';
  const now = nowIso();

  const business: Partial<Business> & Record<string, unknown> = {
    owner_id: ownerId,
    name: input.name.trim(),
    slug,
    legal_name: input.legal_name ?? null,
    logo_url: input.logo_url ?? null,
    cover_url: input.cover_url ?? null,
    description: input.description ?? null,
    tagline: input.tagline ?? null,
    category_id: (input.category_id as string | null) ?? null,
    category: null,
    business_type: (input.business_type as Business['business_type']) ?? 'registered_business',
    registration_number: input.registration_number ?? null,
    tax_number: input.tax_number ?? null,
    tax_registered: Boolean(input.tax_registered),
    email: input.email ?? null,
    phone: input.phone ?? null,
    phone_country_code: input.phone_country_code ?? '+260',
    whatsapp: input.whatsapp ?? null,
    website: input.website ?? null,
    social: input.social ?? {},
    address_line1: input.address_line1 ?? null,
    address_line2: input.address_line2 ?? null,
    city: input.city ?? null,
    region: input.region ?? null,
    postal_code: input.postal_code ?? null,
    country_code: country,
    city_lower: (input.city ?? '').toLowerCase() || null,
    location: null,
    map_url: null,
    opening_hours: (input.opening_hours as Business['opening_hours']) ?? { monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null },
    base_currency: currency,
    fiscal_year_start: 1,
    time_zone: input.time_zone ?? 'Africa/Lusaka',
    locale: input.locale ?? 'en-ZM',
    primary_color: input.primary_color ?? '#0f766e',
    accent_color: input.accent_color ?? '#f59e0b',
    custom_domain: null,
    store_theme: 'default',
    invoice_prefix: input.invoice_prefix ?? 'INV-',
    quotation_prefix: input.quotation_prefix ?? 'QT-',
    receipt_prefix: input.receipt_prefix ?? 'RCP-',
    order_prefix: input.order_prefix ?? 'ORD-',
    po_prefix: 'PO-',
    credit_note_prefix: 'CN-',
    debit_note_prefix: 'DN-',
    next_invoice_number: 0,
    next_quotation_number: 0,
    next_receipt_number: 0,
    next_order_number: 0,
    next_po_number: 0,
    next_credit_note_number: 0,
    next_debit_note_number: 0,
    invoice_terms: input.invoice_terms ?? null,
    invoice_footer: null,
    quotation_validity_days: input.quotation_validity_days ?? 30,
    payment_terms_days: input.payment_terms_days ?? 14,
    default_tax_id: null,
    bank_details: { bank: null, branch: null, account_name: null, account_number: null, swift: null, mobile_money: [] } as never,
    verification_status: 'unverified',
    verified_at: null,
    badges: [],
    is_featured: false,
    is_public: input.is_public ?? true,
    accepts_orders: input.accepts_orders ?? true,
    accepts_wholesale: input.accepts_wholesale ?? false,
    delivery_enabled: input.delivery_enabled ?? false,
    delivery_radius_km: input.delivery_radius_km ?? null,
    delivery_fee: input.delivery_fee ?? 0,
    free_delivery_over: input.free_delivery_over ?? null,
    rating_avg: 0,
    rating_count: 0,
    sales_count: 0,
    growth_score: 0,
    member_count: 1,
    product_count: 0,
    joined_at: now,
    suspended_at: null,
    created_at: now,
    updated_at: now,
  };
  await writeRow<{ id: string }>('businesses', businessId, business as never);

  const memberId = `${businessId}__${ownerId}`;
  await addRow<{ id: string }>('business_members', {
    business_id: businessId,
    user_id: ownerId,
    role: 'owner',
    custom_role_id: null,
    status: 'active',
    job_title: 'Owner',
    phone: input.phone ?? null,
    email: input.email ?? null,
    branch_id: null,
    permissions_override: [],
    denied_permissions: [],
    can_approve_ai_actions: true,
    invited_at: now,
    joined_at: now,
    last_active_at: null,
    created_at: now,
    updated_at: now,
  }, memberId);

  const branchId = newId();
  await addRow<{ id: string }>('branches', {
    business_id: businessId,
    name: input.branch_name ?? 'Main Branch',
    code: 'MAIN',
    is_primary: true,
    is_active: true,
    phone: input.phone ?? null,
    email: input.email ?? null,
    address_line1: input.address_line1 ?? null,
    city: input.city ?? null,
    region: input.region ?? null,
    country_code: country,
    created_at: now,
    updated_at: now,
  }, branchId);

  const warehouseId = newId();
  await addRow<{ id: string }>('warehouses', {
    business_id: businessId,
    branch_id: branchId,
    name: input.warehouse_name ?? 'Main Warehouse',
    code: 'MAIN',
    is_primary: true,
    is_active: true,
    address_line1: null,
    city: input.city ?? null,
    country_code: country,
    created_at: now,
    updated_at: now,
  }, warehouseId);

  // Starter subscription when a Free plan exists.
  const plans = await fetchList<{ id: string; code: string }>('plans', { where: [['code', '==', 'free'] as DbWhere], limit: 1 });
  if (plans[0]) {
    await addRow<{ id: string }>('subscriptions', {
      business_id: businessId,
      plan_id: plans[0].id,
      status: 'active',
      current_period_start: now,
      current_period_end: null,
      cancel_at_period_end: false,
      watermark_enabled: false,
      created_at: now,
      updated_at: now,
    });
  }

  return {
    business_id: businessId,
    store_id: businessId,
    slug,
    branch_id: branchId,
    warehouse_id: warehouseId,
    store_url: `${env.appUrl}/${slug}`,
  };
}

export async function registerAsSeller(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const ownerId = String(input.owner_id ?? input.user_id ?? '');
  const business = await createBusiness({
    name: String(input.name ?? input.business_name ?? ''),
    legal_name: input.legal_name ? String(input.legal_name) : undefined,
    tagline: input.tagline ? String(input.tagline) : undefined,
    description: input.description ? String(input.description) : undefined,
    business_type: input.business_type ? String(input.business_type) : undefined,
    category_id: input.category_id ? String(input.category_id) : undefined,
    registration_number: input.registration_number ? String(input.registration_number) : undefined,
    email: input.email ? String(input.email) : undefined,
    phone: input.phone ? String(input.phone) : undefined,
    phone_country_code: input.phone_country_code ? String(input.phone_country_code) : undefined,
    whatsapp: input.whatsapp ? String(input.whatsapp) : undefined,
    website: input.website ? String(input.website) : undefined,
    address_line1: input.address_line1 ? String(input.address_line1) : undefined,
    city: input.city ? String(input.city) : undefined,
    region: input.region ? String(input.region) : undefined,
    postal_code: input.postal_code ? String(input.postal_code) : undefined,
    country_code: input.country_code ? String(input.country_code) : undefined,
    time_zone: input.time_zone ? String(input.time_zone) : undefined,
    base_currency: input.base_currency ? String(input.base_currency) : undefined,
    invoice_terms: input.invoice_terms ? String(input.invoice_terms) : undefined,
    payment_terms_days: Number(input.payment_terms_days) || undefined,
    quotation_validity_days: Number(input.quotation_validity_days) || undefined,
    logo_url: input.logo_url ? String(input.logo_url) : undefined,
    cover_url: input.cover_url ? String(input.cover_url) : undefined,
    delivery_fee: Number(input.delivery_fee) || undefined,
    free_delivery_over: input.free_delivery_over != null ? Number(input.free_delivery_over) : undefined,
    accepts_orders: input.accepts_orders != null ? Boolean(input.accepts_orders) : undefined,
    accepts_wholesale: input.accepts_wholesale != null ? Boolean(input.accepts_wholesale) : undefined,
    is_public: input.is_public != null ? Boolean(input.is_public) : undefined,
    delivery_enabled: input.delivery_enabled != null ? Boolean(input.delivery_enabled) : undefined,
    owner_id: ownerId,
  });
  return { ...business, ok: true };
}

/* ── Order operations ──────────────────────────────────────────────────────── */

export type OrderStatusInput =
  | 'pending' | 'confirmed' | 'processing' | 'ready' | 'shipped' | 'out_for_delivery' | 'delivered' | 'cancelled' | 'returned';

export interface OrderStatusResult {
  order_id: UUID;
  order_number: string;
  status: OrderStatusInput;
  previous_status: OrderStatusInput;
  changed: boolean;
  restocked_lines: number;
}

/**
 * Move an order through fulfilment. Cancelling a paid order is refused — refund
 * it first — and stock is returned automatically unless you pass `restock: false`.
 */
export async function updateOrderStatus(
  orderId: UUID, status: OrderStatusInput, note?: string | null, restock = true,
): Promise<OrderStatusResult> {
  const order = await fetchRow<Order>('orders', orderId);
  if (!order) throw new Error('Order not found.');
  const previous = order.status as OrderStatusInput;
  if (previous === status) return { order_id: orderId, order_number: order.order_number, status, previous_status: previous, changed: false, restocked_lines: 0 };
  if (status === 'cancelled' && toNum(order.amount_paid) > 0) {
    throw new Error('This order already has payments. Refund it first, then cancel.');
  }
  const now = nowIso();
  const patch: Record<string, unknown> = {
    status,
    fulfilment_status: status === 'delivered' ? 'fulfilled' : status === 'cancelled' || status === 'returned' ? 'cancelled' : 'unfulfilled',
    status_history: [...(order.status_history ?? []), { status, at: now, note: note ?? null, by: null }],
    updated_at: now,
  };
  if (status === 'delivered') { patch.delivered_at = now; patch.payment_status = order.payment_status; }
  if (status === 'shipped' && !order.shipped_at) patch.shipped_at = now;
  if (status === 'cancelled') { patch.cancelled_at = now; patch.cancellation_reason = note ?? null; }
  await patchRow('orders', orderId, patch);

  // Sales counters: delivering an order increases each product's sold_count;
  // cancelling or returning an already-delivered order pulls it back.
  if ((order.items ?? []).length) {
    const soldDelta = new Map<string, number>();
    (order.items ?? []).forEach((l) => {
      if (!l.product_id) return;
      if (status === 'delivered' && previous !== 'delivered') {
        soldDelta.set(l.product_id, (soldDelta.get(l.product_id) ?? 0) + toNum(l.quantity));
      } else if ((status === 'cancelled' || status === 'returned') && previous === 'delivered') {
        soldDelta.set(l.product_id, (soldDelta.get(l.product_id) ?? 0) - toNum(l.quantity));
      }
    });
    for (const [pid, delta] of soldDelta) {
      if (delta === 0) continue;
      try {
        const p = await fetchRow<Product>('products', pid);
        if (p) {
          await patchRow('products', pid, { sold_count: Math.max(0, toNum(p.sold_count) + delta), updated_at: nowIso() });
        }
      } catch { /* product may have been deleted */ }
    }
  }

  let restocked = 0;
  const cancelsStock = status === 'cancelled' || status === 'returned';
  if (cancelsStock && restock && (order.items ?? []).length) {
    const unique = new Map<string, { qty: number; variantId?: string | null }>();
    (order.items ?? []).forEach((l) => {
      if (!l.product_id) return;
      const p = unique.get(l.product_id) ?? { qty: 0, variantId: l.variant_id };
      p.qty += toNum(l.quantity) - toNum(l.quantity_returned);
      unique.set(l.product_id, p);
    });
    for (const [pid, need] of unique) {
      const product = await fetchRow<Product>('products', pid);
      if (!product) continue;
      if (need.variantId) {
        const variants = [...(product.variants ?? [])];
        const idx = variants.findIndex((v) => v.id === need.variantId);
        if (idx > -1) {
          variants[idx] = { ...variants[idx], stock: toNum(variants[idx].stock) + need.qty };
          await patchRow('products', pid, { variants });
        }
      } else {
        await patchRow('products', pid, { stock: toNum(product.stock) + need.qty, stock_status: stockStatusFor(toNum(product.stock) + need.qty, product) });
      }
      restocked += 1;
    }
  }

  // Notify the buyer of the new status.
  if (order.buyer_user_id) {
    const statusLabel = status.replace(/_/g, ' ');
    void notifyUser(order.buyer_user_id, {
      type: 'order',
      title: `Order ${order.order_number} — ${statusLabel}`,
      body: `Your order is now ${statusLabel}.`,
      icon: 'cart',
      action_url: '/account/orders/' + order.id,
      entity_type: 'order',
      entity_id: order.id,
      priority: status === 'delivered' || status === 'cancelled' ? 'high' : 'normal',
    });
  }
  return { order_id: orderId, order_number: order.order_number, status, previous_status: previous, changed: true, restocked_lines: restocked };
}

export async function assignDelivery(input: {
  orderId: UUID;
  method?: 'pickup' | 'delivery' | 'shipping' | 'digital';
  driverName?: string | null;
  driverPhone?: string | null;
  courier?: string | null;
  tracking?: string | null;
  eta?: string | null;
  status?: OrderStatusInput | null;
  notify?: boolean;
}): Promise<{ order_id: UUID; ok: boolean }> {
  const order = await fetchRow<Order>('orders', input.orderId);
  if (!order) throw new Error('Order not found.');
  const now = nowIso();
  const patch: Record<string, unknown> = {
    driver_name: input.driverName ?? null,
    driver_phone: input.driverPhone ?? null,
    courier: input.courier ?? null,
    tracking_number: input.tracking ?? null,
    estimated_delivery_at: input.eta ?? null,
    updated_at: now,
  };
  if (input.method) patch.delivery_method = input.method;
  if (input.status) {
    patch.status = input.status;
    patch.status_history = [...(order.status_history ?? []), { status: input.status, at: now, note: 'Delivery assigned', by: null }];
  }
  await patchRow('orders', order.id, patch);
  if (input.notify !== false && order.buyer_user_id) {
    void notifyUser(order.buyer_user_id, {
      type: 'order',
      title: `Order ${order.order_number} is on its way`,
      body: input.courier || input.driverName ? `Delivered by ${input.courier ?? input.driverName}.` : 'Delivery details were updated.',
      icon: 'cart',
      action_url: '/account/orders/' + order.id,
      entity_type: 'order',
      entity_id: order.id,
    });
  }
  return { order_id: order.id, ok: true };
}

/* ── Returns & refunds ─────────────────────────────────────────────────────── */

export interface ReturnItemInput {
  order_item_id?: UUID | null;
  product_id?: UUID | null;
  variant_id?: UUID | null;
  name?: string | null;
  quantity: number;
  unit_price?: number | null;
  refund_amount?: number | null;
  condition?: 'sellable' | 'damaged' | 'defective' | 'missing';
}

export async function createReturn(input: {
  orderId?: UUID | null;
  businessId?: UUID | null;
  customerId?: UUID | null;
  invoiceId?: UUID | null;
  reason: string;
  reasonCode?: string | null;
  restock?: boolean;
  warehouseId?: UUID | null;
  refundMethod?: 'original' | 'cash' | 'credit_note' | 'bank_transfer' | 'store_credit' | null;
  images?: string[];
  items: ReturnItemInput[];
}): Promise<{ return_id: UUID; return_number: string; refund_amount: number; status: string }> {
  const businessId = input.businessId ?? (input.orderId ? (await fetchRow<Order>('orders', input.orderId))?.business_id : null);
  if (!businessId) throw new Error('A business is required to create a return.');
  const business = await requireBusiness(businessId);
  const id = newId();
  const returnNumber = await allocateNumber(businessId, 'next_return_number', 'RET-');
  const refundAmount = roundMoney(input.items.reduce((s, l) => s + toNum(l.refund_amount ?? (toNum(l.unit_price) * toNum(l.quantity))), 0));
  await addRow<{ id: string }>('returns', {
    business_id: businessId,
    order_id: input.orderId ?? null,
    customer_id: input.customerId ?? null,
    invoice_id: input.invoiceId ?? null,
    warehouse_id: input.warehouseId ?? null,
    return_number: returnNumber,
    status: 'requested',
    reason: input.reason,
    reason_code: input.reasonCode ?? null,
    restock: input.restock ?? true,
    refund_method: input.refundMethod ?? null,
    refund_amount: refundAmount,
    images: input.images ?? [],
    items: input.items,
    created_at: nowIso(),
    updated_at: nowIso(),
  }, id);
  await notifyBusinessMembers(businessId, {
    type: 'order',
    title: `Return ${returnNumber} requested`,
    body: `A return of ${business.base_currency ?? 'ZMW'} ${refundAmount.toFixed(2)} was requested.`,
    icon: 'cart',
    action_url: '/business/orders',
    entity_type: 'return',
    entity_id: id,
    priority: 'high',
  });
  return { return_id: id, return_number: returnNumber, refund_amount: refundAmount, status: 'requested' };
}

export type ReturnAction = 'approve' | 'reject' | 'receive' | 'refund' | 'close';

export async function processReturn(
  returnId: UUID, action: ReturnAction, note?: string | null, restock = true, refundMethod?: string | null,
): Promise<{ return_id: UUID; action: ReturnAction; refund_id: UUID | null; credit_note_id: UUID | null; restocked: number }> {
  const ret = await fetchRow<{ id: string; business_id: string; order_id: string | null; customer_id: string | null; refund_amount: number; restock: boolean; items: ReturnItemInput[] }>('returns', returnId);
  if (!ret) throw new Error('Return not found.');
  let refundId: string | null = null;
  let restocked = 0;
  if (action === 'refund') {
    const payment = await recordPayment({
      business_id: ret.business_id,
      amount: toNum(ret.refund_amount),
      method: 'other',
      direction: 'outbound',
      order_id: ret.order_id ?? null,
      customer_id: ret.customer_id ?? null,
      notes: note ?? `Refund for return`,
      generate_receipt: false,
    });
    refundId = payment.payment_id;
  }
  if (action === 'receive' && restock && ret.restock) {
    for (const l of ret.items) {
      if (!l.product_id) continue;
      try {
        await adjustStock({
          businessId: ret.business_id,
          productId: l.product_id,
          variantId: l.variant_id ?? null,
          quantityChange: toNum(l.quantity),
          movementType: 'return',
          referenceType: 'return',
          referenceId: returnId,
          referenceNumber: `RET-${returnId.slice(0, 6)}`,
          reason: 'Returned to stock',
        });
        restocked += 1;
      } catch { /* item may have been deleted */ }
    }
  }
  if (action === 'close' && ret.order_id) {
    await updateOrderStatus(ret.order_id, 'returned', 'Closed after return', true);
  }
  await patchRow('returns', returnId, {
    status: action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : action === 'receive' ? 'received' : action === 'refund' ? 'refunded' : 'closed',
    action_note: note ?? null,
    refund_method: refundMethod ?? null,
    refund_id: refundId,
    resolved_at: nowIso(),
    updated_at: nowIso(),
  });
  return { return_id: returnId, action, refund_id: refundId, credit_note_id: null, restocked };
}

/** Order with its lines and customer — one round trip for the detail screens. */
export async function fetchOrder(id: UUID): Promise<(Order & { items: OrderItem[] }) | null> {
  const order = await fetchRow<Order & { items?: OrderItem[] }>('orders', id);
  if (!order) return null;
  const [payments, invoices] = await Promise.all([
    fetchList<Payment>('payments', { where: [['order_id', '==', id] as DbWhere], orderByField: 'received_at', orderDir: 'desc', limit: 30 }),
    fetchList<Invoice>('invoices', { where: [['order_id', '==', id] as DbWhere], limit: 5 }),
  ]);
  return {
    ...order,
    items: order.items ?? [],
    payments: payments.length ? payments : undefined,
    invoices: invoices.length
      ? invoices.map((i) => ({ id: i.id, invoice_number: i.invoice_number, status: i.status, total: i.total, balance_due: i.balance_due }))
      : undefined,
  } as (Order & { items: OrderItem[] }) | null;
}

export async function fetchInvoice(id: UUID): Promise<(Invoice & { items: InvoiceItem[] }) | null> {
  const invoice = await fetchRow<Invoice & { items?: InvoiceItem[] }>('invoices', id);
  if (!invoice) return null;
  const payments = await fetchList<Payment>('payments', { where: [['invoice_id', '==', id] as DbWhere], orderByField: 'received_at', orderDir: 'desc', limit: 50 });
  return {
    ...invoice,
    items: invoice.items ?? [],
    payments: payments.length ? payments : undefined,
  } as (Invoice & { items: InvoiceItem[] }) | null;
}

export async function fetchQuotation(id: UUID): Promise<(Quotation & { items: unknown[] }) | null> {
  const quotation = await fetchRow<Quotation & { items?: unknown[] }>('quotations', id);
  if (!quotation) return null;
  return { ...quotation, items: quotation.items ?? [] } as (Quotation & { items: unknown[] }) | null;
}

/** Sum a numeric column client-side for quick previews only. */
export function sumAmounts(rows: { amount?: number | string }[]): number {
  return rows.reduce((s, r) => s + toNum(r.amount ?? 0), 0);
}

