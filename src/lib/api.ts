import { rpc, supabase } from './supabase';
import { toNum } from './currency';
import type {
  Business, BusinessSummary, Category, Customer, Invoice, InvoiceItem, Order, OrderChannel,
  OrderItem, Payment, Product, Quotation, Receipt, UUID,
} from '@/types';

/**
 * Typed wrappers around the Postgres RPCs in supabase/sql/0009_functions.sql.
 *
 * Every number that matters (stock, money, document numbering) is computed in
 * the database inside a transaction. These functions only shape the input and
 * translate the returned JSON into the app's types — they never invent data.
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

export async function searchProducts(filters: SearchFilters): Promise<SearchPage<Product>> {
  const input: Record<string, unknown> = {};
  const { q, minPrice, maxPrice } = parseNaturalQuery(filters.q ?? '');
  const citySplit = extractCity(q);

  if (citySplit.q) input.q = citySplit.q;
  if (citySplit.city) input.city = citySplit.city;
  if (filters.city) input.city = filters.city;
  if (minPrice !== undefined) input.min_price = minPrice;
  if (maxPrice !== undefined) input.max_price = maxPrice;
  if (filters.min_price != null) input.min_price = filters.min_price;
  if (filters.max_price != null) input.max_price = filters.max_price;
  if (filters.category_id) input.category_id = filters.category_id;
  if (filters.category_slug) input.category_slug = filters.category_slug;
  if (filters.business_id) input.business_id = filters.business_id;
  if (filters.store_slug) input.store_slug = filters.store_slug;
  if (filters.country_code) input.country_code = filters.country_code;
  if (filters.min_rating != null) input.min_rating = filters.min_rating;
  if (filters.in_stock) input.in_stock = true;
  if (filters.brand) input.brand = filters.brand;
  if (filters.condition) input.condition = filters.condition;
  if (filters.product_type) input.product_type = filters.product_type;
  if (filters.wholesale_only) input.wholesale_only = true;
  if (filters.retail_only) input.retail_only = true;
  if (filters.featured_only) input.featured_only = true;
  input.sort = filters.sort ?? 'relevance';
  input.limit = filters.limit ?? 24;
  input.offset = filters.offset ?? 0;

  const res = await rpc<{ total: number; items: SearchProductRow[]; has_more: boolean; limit: number; offset: number }>(
    'search_products', { p_input: input },
  );
  return {
    items: (res.items ?? []).map(rowToProduct),
    total: Number(res.total ?? 0),
    hasMore: Boolean(res.has_more),
    limit: res.limit ?? 24,
    offset: res.offset ?? 0,
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
  const res = await rpc<{ total: number; items: BusinessSearchRow[]; has_more: boolean }>('search_businesses', {
    p_q: f.q ?? null,
    p_category_id: f.category_id ?? null,
    p_city: f.city ?? null,
    p_country_code: f.country_code ?? null,
    p_min_rating: f.min_rating ?? null,
    p_verified_only: f.verified_only ?? false,
    p_near_lat: f.near_lat ?? null,
    p_near_lng: f.near_lng ?? null,
    p_radius_km: f.radius_km ?? null,
    p_sort: f.sort ?? 'relevance',
    p_limit: f.limit ?? 24,
    p_offset: f.offset ?? 0,
  });
  return {
    items: res.items ?? [],
    total: Number(res.total ?? 0),
    hasMore: Boolean(res.has_more),
    limit: f.limit ?? 24,
    offset: f.offset ?? 0,
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

export const getStore = (slug: string) => rpc<StorePayload>('get_store', { p_slug: slug });

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
  /** The RPC also accepts the friendly 'paid' / 'partially_paid' spellings. */
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

export const createOrder = (input: CreateOrderInput) => rpc<OrderResult>('create_order', { p_input: input });

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

export const recordPayment = (input: RecordPaymentInput) => rpc<PaymentResult>('record_payment', { p_input: input });

/* ── Documents ─────────────────────────────────────────────────────────────── */

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

export const createInvoice = (input: CreateInvoiceInput) => rpc<UUID>('create_invoice', { p_input: input });

export interface CreateQuotationInput extends Omit<CreateInvoiceInput, 'kind' | 'due_date' | 'due_days'> {
  kind?: 'quotation' | 'proforma';
  valid_until?: string;
  valid_days?: number;
}

export const createQuotation = (input: CreateQuotationInput) => rpc<UUID>('create_quotation', { p_input: input });

export const convertQuotationToInvoice = (quotationId: UUID) =>
  rpc<UUID>('convert_quotation_to_invoice', { p_quotation_id: quotationId });

export const createInvoiceFromOrder = (orderId: UUID, dueDays?: number | null) =>
  rpc<UUID>('create_invoice_from_order', { p_order_id: orderId, p_due_days: dueDays ?? null });

export const createReceipt = (input: {
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
}) => rpc<UUID>('create_receipt', { p_input: input });

export const createShareToken = (entityType: string, entityId: UUID, expiresDays = 30) =>
  rpc<string>('create_share_token', {
    p_entity_type: entityType, p_entity_id: entityId, p_expires_in_days: expiresDays,
  });

export const markDocumentViewed = (entityType: string, shareToken: string, meta: Record<string, unknown> = {}) =>
  rpc<boolean>('mark_document_viewed', {
    p_entity_type: entityType, p_share_token: shareToken, p_metadata: meta,
  });

export const getSharedDocument = (entityType: string, shareToken: string) =>
  rpc<Record<string, unknown>>('get_shared_document', { p_entity_type: entityType, p_share_token: shareToken });

export const respondToQuotation = (input: {
  shareToken: string;
  response: 'accepted' | 'rejected' | 'change_requested';
  signerName?: string;
  note?: string;
  signatureImage?: string;
}) => rpc<Record<string, unknown>>('respond_to_quotation', {
  p_share_token: input.shareToken,
  p_response: input.response,
  p_signer_name: input.signerName ?? null,
  p_note: input.note ?? null,
  p_signature_image: input.signatureImage ?? null,
});

/* ── Customers ─────────────────────────────────────────────────────────────── */

export const upsertCustomer = (businessId: UUID, customer: Partial<Customer> & { name: string }) =>
  rpc<UUID>('upsert_customer', { p_business_id: businessId, p_input: customer as Record<string, unknown> });

export const customerStatement = (customerId: UUID, from: string, to: string) =>
  rpc<{
    customer: Record<string, unknown>;
    from: string; to: string;
    opening_balance: number;
    entries: Record<string, unknown>[];
    total_debits: number; total_credits: number; closing_balance: number;
  }>('customer_statement', { p_customer_id: customerId, p_from: from, p_to: to });

/* ── Inventory ─────────────────────────────────────────────────────────────── */

export const adjustStock = (input: {
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
}) => rpc<Record<string, unknown>>('adjust_stock', {
  p_business_id: input.businessId,
  p_product_id: input.productId,
  p_quantity_change: input.quantityChange,
  p_movement_type: input.movementType,
  p_warehouse_id: input.warehouseId ?? null,
  p_variant_id: input.variantId ?? null,
  p_unit_cost: input.unitCost ?? null,
  p_reference_type: input.referenceType ?? null,
  p_reference_id: input.referenceId ?? null,
  p_reference_number: input.referenceNumber ?? null,
  p_reason: input.reason ?? null,
});

export const transferStock = (transferId: UUID) =>
  rpc<Record<string, unknown>>('transfer_stock', { p_transfer_id: transferId });

/* ── Payments links ────────────────────────────────────────────────────────── */

export const createPaymentLink = (input: {
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
}) => rpc<{ id: UUID; code: string; url: string }>('create_payment_link', { p_input: input });

export interface PaymentLinkPayload {
  found: boolean;
  /** Set when the link exists but cannot take payment: inactive | expired. */
  reason?: 'inactive' | 'expired';
  /** Human-readable explanation to show the payer. */
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
  /** Declarations already waiting for the seller to confirm. */
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

export const getPaymentLink = (code: string) => rpc<PaymentLinkPayload>('get_payment_link', { p_code: code });

/**
 * An anonymous payer declares "I have paid".
 *
 * This never marks money as received: it queues the declaration for the seller,
 * who confirms it and only then is a real payment and receipt written. That is
 * the owner-approval rule applied to money coming in from the public internet.
 */
export const payViaLink = (input: {
  code: string;
  method: string;
  provider?: string;
  reference?: string;
  amount?: number;
  payer_name?: string;
  payer_phone?: string;
  payer_email?: string;
}) => rpc<{
  ok: boolean;
  duplicate?: boolean;
  submission_id?: UUID;
  amount?: number;
  currency?: string;
  status?: string;
  message?: string;
}>('pay_via_link', { p_input: input });

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

export const resolvePaymentSubmission = (submissionId: UUID, action: 'confirm' | 'reject', note?: string) =>
  rpc<{ ok: boolean; status: string; submission_id: UUID; payment_id?: UUID | null; receipt_id?: UUID | null }>(
    'resolve_payment_submission', { p_submission_id: submissionId, p_action: action, p_note: note ?? null });

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

export const dashboardSummary = (businessId: UUID, from?: string | null, to?: string | null, branchId?: UUID | null) =>
  rpc<DashboardSummary>('dashboard_summary', {
    p_business_id: businessId, p_from: from ?? null, p_to: to ?? null, p_branch_id: branchId ?? null,
  });

export interface SalesPoint {
  bucket: string;
  revenue: number;
  orders: number;
  profit: number;
  items: number;
}

export const salesSeries = (businessId: UUID, from: string, to: string, granularity: 'day' | 'week' | 'month' = 'day') =>
  rpc<{ series: SalesPoint[]; granularity: string; from: string; to: string }>(
    'sales_series', { p_business_id: businessId, p_from: from, p_to: to, p_granularity: granularity },
  );

export interface TopProductRow {
  product_id: UUID | null;
  name: string;
  sku: string | null;
  image_url: string | null;
  quantity: number;
  revenue: number;
  profit: number;
}

export const topProducts = (businessId: UUID, from: string, to: string, limit = 10, order: 'revenue' | 'quantity' | 'profit' = 'revenue') =>
  rpc<{ items: TopProductRow[] }>(
    'top_products', { p_business_id: businessId, p_from: from, p_to: to, p_limit: limit, p_order: order },
  );

export interface TopCustomerRow {
  id: UUID; name: string; phone: string | null; email: string | null; city: string | null;
  customer_group: string | null; orders_count: number; total_spent: number;
  outstanding_balance: number; last_order_at: string | null; loyalty_points: number;
}

export const topCustomers = (businessId: UUID, limit = 10) =>
  rpc<{ items: TopCustomerRow[] }>('top_customers', { p_business_id: businessId, p_limit: limit });

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

export const lowStockAlerts = (businessId: UUID, limit = 20) =>
  rpc<{ items: LowStockRow[]; count: number }>('low_stock_alerts', { p_business_id: businessId, p_limit: limit });

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

export const overdueInvoices = (businessId: UUID, limit = 50) =>
  rpc<{ items: OverdueInvoiceRow[]; total_outstanding: number }>(
    'overdue_invoices', { p_business_id: businessId, p_limit: limit },
  );

export interface GrowthBreakdown {
  profile: number; catalogue: number; activity: number; inventory: number; reputation: number;
  total: number;
  level: 'getting_started' | 'developing' | 'strong' | 'excellent';
  next_steps: string[];
}

export const computeGrowthScore = (businessId: UUID) =>
  rpc<GrowthBreakdown>('compute_growth_score', { p_business_id: businessId });

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

export const validateCoupon = (code: string, businessId: UUID | null, subtotal: number) =>
  rpc<CouponCheck>('validate_coupon', { p_code: code, p_business_id: businessId, p_subtotal: subtotal });

/* ── CSV ───────────────────────────────────────────────────────────────────── */

export const importCsvRows = (sourceId: UUID, rows: Record<string, unknown>[]) =>
  rpc<{ created: number; updated: number; skipped: number; errors: { row: number; message: string }[] }>(
    'import_csv_rows', { p_source_id: sourceId, p_rows: rows },
  );

export const syncCsvSource = (sourceId: UUID, rows: Record<string, unknown>[]) =>
  rpc<Record<string, unknown>>('sync_csv_source', { p_source_id: sourceId, p_rows: rows });

/* ── AI ────────────────────────────────────────────────────────────────────── */

export const aiActionImpact = (action: string) =>
  rpc<{ impact: string; requires_approval: boolean; auto_execute: boolean }>('ai_action_impact', { p_action: action });

export const proposeAiAction = (businessId: UUID, action: string, payload: Record<string, unknown>, explanation?: string, conversationId?: UUID | null) =>
  rpc<{ action_id: UUID; status: string; requires_approval: boolean; auto_executed: boolean; result?: unknown }>(
    'propose_ai_action',
    { p_business_id: businessId, p_action: action, p_payload: payload, p_explanation: explanation ?? null, p_conversation_id: conversationId ?? null },
  );

export const resolveAiAction = (actionId: UUID, decision: 'approved' | 'rejected' | 'modified', reason?: string) =>
  rpc<{ action_id: UUID; status: string; executed: boolean; result?: unknown }>(
    'resolve_ai_action', { p_action_id: actionId, p_decision: decision, p_reason: reason ?? null },
  );

/* ── Business setup ────────────────────────────────────────────────────────── */

export const suggestSlug = (name: string) => rpc<string>('suggest_slug', { p_name: name });
export const isSlugAvailable = (slug: string) => rpc<boolean>('is_slug_available', { p_slug: slug });

/**
 * Payload for the `create_business` RPC. Every key is optional except `name`;
 * the function fills sensible Zambian defaults (ZM, ZMW, Africa/Lusaka, en-ZM).
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
}

export const createBusiness = (input: CreateBusinessInput) =>
  rpc<{ business_id: UUID; store_id: UUID; slug: string; branch_id: UUID; warehouse_id: UUID; store_url: string }>(
    'create_business', { p_input: input as unknown as Record<string, unknown> },
  );

export const registerAsSeller = (input: Record<string, unknown>) =>
  rpc<Record<string, unknown>>('register_as_seller', { p_input: input });

/* ── Small direct-table helpers ────────────────────────────────────────────── */

/* ── Order operations ─────────────────────────────────────────────────────── */

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
 * Move an order through fulfilment. Cancelling a paid order is refused by the
 * database — refund it first — and stock is returned automatically unless you
 * pass `restock: false`.
 */
export const updateOrderStatus = (orderId: UUID, status: OrderStatusInput, note?: string | null, restock = true) =>
  rpc<OrderStatusResult>('update_order_status', {
    p_order_id: orderId, p_status: status, p_note: note ?? null, p_restock: restock,
  });

export const assignDelivery = (input: {
  orderId: UUID;
  method?: 'pickup' | 'delivery' | 'shipping' | 'digital';
  driverName?: string | null;
  driverPhone?: string | null;
  courier?: string | null;
  tracking?: string | null;
  eta?: string | null;
  status?: OrderStatusInput | null;
  notify?: boolean;
}) => rpc<{ order_id: UUID; ok: boolean }>('assign_delivery', {
  p_order_id: input.orderId,
  p_method: input.method ?? null,
  p_driver_name: input.driverName ?? null,
  p_driver_phone: input.driverPhone ?? null,
  p_courier: input.courier ?? null,
  p_tracking: input.tracking ?? null,
  p_eta: input.eta ?? null,
  p_status: input.status ?? null,
  p_notify: input.notify ?? true,
});

/* ── Returns & refunds ────────────────────────────────────────────────────── */

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

export const createReturn = (input: {
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
}) => rpc<{ return_id: UUID; return_number: string; refund_amount: number; status: string }>('create_return', {
  p_input: {
    order_id: input.orderId ?? null,
    business_id: input.businessId ?? null,
    customer_id: input.customerId ?? null,
    invoice_id: input.invoiceId ?? null,
    reason: input.reason,
    reason_code: input.reasonCode ?? null,
    restock: input.restock ?? true,
    warehouse_id: input.warehouseId ?? null,
    refund_method: input.refundMethod ?? null,
    images: input.images ?? [],
    items: input.items,
  } as unknown as Record<string, unknown>,
});

export type ReturnAction = 'approve' | 'reject' | 'receive' | 'refund' | 'close';

export const processReturn = (
  returnId: UUID, action: ReturnAction, note?: string | null, restock = true, refundMethod?: string | null,
) => rpc<{ return_id: UUID; action: ReturnAction; refund_id: UUID | null; credit_note_id: UUID | null; restocked: number }>(
  'process_return',
  { p_return_id: returnId, p_action: action, p_note: note ?? null, p_restock: restock, p_refund_method: refundMethod ?? null },
);

/** Order with its lines and customer — one round trip for the detail screens. */
export async function fetchOrder(id: UUID): Promise<(Order & { items: OrderItem[] }) | null> {
  const { data, error } = await supabase
    .from('orders')
    .select('*, items:order_items(*), customer:customers(id,name,phone,email,city), invoices(id,invoice_number,status,total,balance_due)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as Order & { items: OrderItem[] }) ?? null;
}

export async function fetchInvoice(id: UUID): Promise<(Invoice & { items: InvoiceItem[] }) | null> {
  const { data, error } = await supabase
    .from('invoices')
    .select('*, items:invoice_items(*), customer:customers(id,name,phone,email,address_line1,city,tax_number), payments(id,payment_number,amount,method,received_at)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as Invoice & { items: InvoiceItem[] }) ?? null;
}

export async function fetchQuotation(id: UUID): Promise<(Quotation & { items: unknown[] }) | null> {
  const { data, error } = await supabase
    .from('quotations')
    .select('*, items:quotation_items(*), customer:customers(id,name,phone,email,address_line1,city)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as Quotation & { items: unknown[] }) ?? null;
}

/** Sum a numeric column client-side for quick previews only (never for money
 *  that gets written back — Postgres recalculates authoritative totals). */
export function sumAmounts(rows: { amount?: number | string }[]): number {
  return rows.reduce((s, r) => s + toNum(r.amount ?? 0), 0);
}
