/**
 * Domain types for Seedwel Hub.
 *
 * Firestore documents keep the same snake_case field names the UI has always
 * used, so these types double as the document shape. Money values are typed
 * `number | string` (legacy rows may carry strings) and always pass through
 * `toNum()` before maths.
 */

export type UUID = string;
export type Money = number | string;
export type ISODate = string;

// ── Identity ────────────────────────────────────────────────────────────────
export type UserRole =
  | 'buyer'
  | 'seller'
  | 'business'
  | 'employee'
  | 'supplier'
  | 'service_provider'
  | 'admin';

export type MemberRole =
  | 'owner'
  | 'administrator'
  | 'manager'
  | 'salesperson'
  | 'cashier'
  | 'accountant'
  | 'inventory_manager'
  | 'warehouse_manager';

export type BusinessType =
  | 'sole_proprietorship'
  | 'partnership'
  | 'llc'
  | 'company'
  | 'cooperative'
  | 'ngo'
  | 'informal'
  | 'other';

export type VerificationStatus =
  | 'unverified'
  | 'submitted'
  | 'under_review'
  | 'verified'
  | 'rejected'
  | 'suspended';

export interface Profile {
  id: UUID;
  email: string;
  phone: string | null;
  phone_country_code: string;
  full_name: string | null;
  display_name: string | null;
  avatar_url: string | null;
  country_code: string;
  language: string;
  currency: string;
  time_zone: string;
  roles: UserRole[];
  primary_role: UserRole;
  headline: string | null;
  bio: string | null;
  website: string | null;
  social: Record<string, string>;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  location: { lat?: number; lng?: number } | null;
  default_business: UUID | null;
  email_verified_at: string | null;
  phone_verified_at: string | null;
  two_factor_enabled: boolean;
  is_platform_admin: boolean;
  is_suspended: boolean;
  marketing_opt_in: boolean;
  onboarding_completed_at: string | null;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OpeningHours {
  [day: string]: { open?: string; close?: string; closed?: boolean };
}

export interface Business {
  id: UUID;
  owner_id: UUID;
  name: string;
  slug: string;
  legal_name: string | null;
  logo_url: string | null;
  cover_url: string | null;
  description: string | null;
  tagline: string | null;
  category_id: UUID | null;
  business_type: BusinessType;
  registration_number: string | null;
  tax_number: string | null;
  tax_registered: boolean;
  email: string | null;
  phone: string | null;
  phone_country_code: string;
  whatsapp: string | null;
  website: string | null;
  social: Record<string, string>;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country_code: string;
  location: { lat?: number; lng?: number } | null;
  map_url: string | null;
  opening_hours: OpeningHours;
  base_currency: string;
  fiscal_year_start: number;
  time_zone: string;
  locale: string;
  primary_color: string;
  accent_color: string;
  custom_domain: string | null;
  store_theme: string;
  invoice_prefix: string;
  quotation_prefix: string;
  receipt_prefix: string;
  order_prefix: string;
  po_prefix: string;
  credit_note_prefix: string;
  debit_note_prefix: string;
  next_invoice_number: number;
  next_quotation_number: number;
  next_receipt_number: number;
  next_order_number: number;
  next_po_number: number;
  next_credit_note_number: number;
  next_debit_note_number: number;
  invoice_terms: string | null;
  invoice_footer: string | null;
  quotation_validity_days: number;
  payment_terms_days: number;
  default_tax_id: UUID | null;
  bank_details: BankDetails;
  verification_status: VerificationStatus;
  verified_at: string | null;
  badges: string[];
  is_featured: boolean;
  is_public: boolean;
  accepts_orders: boolean;
  accepts_wholesale: boolean;
  delivery_enabled: boolean;
  delivery_radius_km: Money | null;
  delivery_fee: Money;
  free_delivery_over: Money | null;
  rating_avg: Money;
  rating_count: number;
  sales_count: number;
  growth_score: number;
  member_count: number;
  product_count: number;
  joined_at: string;
  suspended_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BankDetails {
  bank?: string;
  branch?: string;
  account_name?: string;
  account_number?: string;
  swift?: string;
  mobile_money?: { provider: string; number: string; name?: string }[];
}

export interface BusinessMember {
  id: UUID;
  business_id: UUID;
  user_id: UUID;
  role: MemberRole;
  custom_role_id: UUID | null;
  status: 'invited' | 'active' | 'suspended' | 'removed';
  job_title: string | null;
  phone: string | null;
  email: string | null;
  branch_id: UUID | null;
  permissions_override: string[];
  denied_permissions: string[];
  can_approve_ai_actions: boolean;
  invited_at: string;
  joined_at: string | null;
  last_active_at: string | null;
  /** joined from profiles */
  profile?: Pick<Profile, 'full_name' | 'display_name' | 'avatar_url' | 'email' | 'phone'>;
}

export interface Branch {
  id: UUID;
  business_id: UUID;
  name: string;
  code: string | null;
  kind: 'head_office' | 'branch' | 'shop' | 'warehouse';
  is_primary: boolean;
  email: string | null;
  phone: string | null;
  address_line1: string | null;
  city: string | null;
  region: string | null;
  country_code: string;
  manager_id: UUID | null;
  is_active: boolean;
}

export interface Warehouse {
  id: UUID;
  business_id: UUID;
  branch_id: UUID | null;
  name: string;
  code: string | null;
  kind: 'warehouse' | 'shop' | 'van' | 'consignment';
  is_primary: boolean;
  city: string | null;
  manager_id: UUID | null;
  is_active: boolean;
}

// ── Marketplace ─────────────────────────────────────────────────────────────
export interface Category {
  id: UUID;
  parent_id: UUID | null;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  image_url: string | null;
  kind: 'product' | 'service' | 'both';
  path: string;
  depth: number;
  sort_order: number;
  is_active: boolean;
  is_featured: boolean;
  product_count: number;
  children?: Category[];
}

export type ProductStatus = 'draft' | 'active' | 'out_of_stock' | 'archived' | 'blocked';
export type ProductType = 'product' | 'service' | 'wholesale' | 'both';
export type ProductCondition = 'new' | 'used' | 'refurbished';

export interface ProductMedia {
  url: string;
  type?: 'image' | 'video';
  alt?: string;
  position?: number;
  thumb_url?: string;
}

export interface VariantOption {
  name: string;
  values: string[];
}

export interface Product {
  id: UUID;
  business_id: UUID;
  store_id: UUID | null;
  branch_id: UUID | null;
  name: string;
  slug: string;
  sku: string | null;
  barcode: string | null;
  barcode_format: string;
  description: string | null;
  short_description: string | null;
  brand: string | null;
  model: string | null;
  category_id: UUID | null;
  tags: string[];
  product_type: ProductType;
  condition: ProductCondition;
  status: ProductStatus;
  is_published: boolean;
  is_featured: boolean;
  is_wholesale: boolean;
  is_digital: boolean;
  is_taxable: boolean;
  tax_id: UUID | null;
  currency: string;
  price: Money;
  compare_at_price: Money | null;
  cost_price: Money;
  wholesale_price: Money | null;
  wholesale_min_qty: number;
  discount_percent: Money;
  stock: number;
  stock_alert: number;
  stock_max: number | null;
  allow_backorder: boolean;
  track_inventory: boolean;
  weight_kg: Money | null;
  length_cm: Money | null;
  width_cm: Money | null;
  height_cm: Money | null;
  requires_delivery: boolean;
  delivery_days: number | null;
  warranty: string | null;
  unit: string;
  has_variants: boolean;
  variant_options: VariantOption[];
  service_duration_minutes: number | null;
  service_area: string | null;
  is_quotation_only: boolean;
  media: ProductMedia[];
  primary_image_url: string | null;
  source: 'manual' | 'csv' | 'ai' | 'api' | 'external';
  external_id: string | null;
  csv_source_id: UUID | null;
  last_synced_at: string | null;
  view_count: number;
  sold_count: number;
  rating_avg: Money;
  rating_count: number;
  min_purchase_qty: number;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  /** joined */
  category?: Pick<Category, 'id' | 'name' | 'slug' | 'path' | 'icon'>;
  business?: BusinessSummary;
  variants?: ProductVariant[];
  inventory?: InventoryRow[];
}

export interface BusinessSummary {
  id: UUID;
  name: string;
  slug: string;
  logo_url: string | null;
  city: string | null;
  country_code: string;
  verification_status: VerificationStatus;
  rating_avg: Money;
  rating_count?: number;
  badges: string[];
  accepts_orders?: boolean;
  delivery_enabled?: boolean;
  accepts_wholesale?: boolean;
  /** Delivery economics the buyer needs before checkout (preview only —
   *  create_order() re-reads them server-side). */
  delivery_fee?: Money;
  free_delivery_over?: Money | null;
  base_currency?: string;
  tax_registered?: boolean;
  /** Extra columns present when the seller row is fetched with `businesses(*)`. */
  phone?: string | null;
  phone_country_code?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  website?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  region?: string | null;
  invoice_terms?: string | null;
  payment_terms_days?: number | null;
  quotation_validity_days?: number | null;
  tax_number?: string | null;
  primary_color?: string | null;
  accent_color?: string | null;
  opening_hours?: Record<string, unknown> | null;
}

/** Buyer-side address book (public.addresses). */
export interface Address {
  id: UUID;
  user_id: UUID;
  label: string;
  recipient_name: string | null;
  phone: string | null;
  line1: string;
  line2: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country_code: string;
  location: { lat?: number; lng?: number } | null;
  delivery_notes: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

/** Saved item — product, service or business (public.wishlist_items). */
export interface WishlistItem {
  id: UUID;
  user_id: UUID;
  product_id: UUID | null;
  service_id: UUID | null;
  business_id: UUID | null;
  note: string | null;
  price_at_save: Money | null;
  notify_on_price_drop: boolean;
  notify_on_back_in_stock: boolean;
  created_at: string;
  /** joined */
  product?: Product;
  service?: Pick<Service, 'id' | 'name' | 'primary_image_url' | 'price' | 'currency' | 'service_type'>;
  business?: BusinessSummary;
}

export interface Follow {
  id: UUID;
  follower_id: UUID;
  business_id: UUID;
  notify_new_products: boolean;
  notify_deals: boolean;
  created_at: string;
  business?: BusinessSummary;
}

/** Flash sale / promotion (public.deals). */
export interface Deal {
  id: UUID;
  business_id: UUID;
  product_id: UUID | null;
  category_id: UUID | null;
  title: string;
  description: string | null;
  deal_type: 'discount' | 'flash' | 'bundle' | 'bogo' | 'clearance' | string;
  discount_percent: Money | null;
  discount_amount: Money | null;
  deal_price: Money | null;
  min_qty: number | null;
  quantity_limit: number | null;
  total_quantity: number | null;
  sold_quantity: number;
  starts_at: string;
  ends_at: string | null;
  is_platform_featured: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  /** joined */
  product?: Product;
  business?: BusinessSummary;
}

/** GDPR-style export / deletion request (public.data_requests). */
export interface DataRequest {
  id: UUID;
  user_id: UUID;
  business_id: UUID | null;
  kind: 'export' | 'delete_account' | 'delete_business' | string;
  status: 'requested' | 'processing' | 'completed' | 'cancelled' | string;
  file_url: string | null;
  notes: string | null;
  requested_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductVariant {
  id: UUID;
  product_id: UUID;
  sku: string | null;
  barcode: string | null;
  name: string;
  option_values: Record<string, string>;
  price: Money | null;
  compare_at_price: Money | null;
  cost_price: Money;
  wholesale_price: Money | null;
  stock: number;
  stock_alert: number;
  image_url: string | null;
  is_active: boolean;
  is_default: boolean;
  sort_order: number;
}

export interface Service {
  id: UUID;
  business_id: UUID;
  store_id: UUID | null;
  name: string;
  slug: string;
  description: string | null;
  category_id: UUID | null;
  service_type: 'fixed' | 'hourly' | 'daily' | 'per_job' | 'quote';
  price: Money;
  currency: string;
  min_price: Money | null;
  max_price: Money | null;
  duration_minutes: number | null;
  unit: string;
  coverage_area: string | null;
  travel_radius_km: Money | null;
  is_remote: boolean;
  media: ProductMedia[];
  primary_image_url: string | null;
  tags: string[];
  status: ProductStatus;
  is_published: boolean;
  rating_avg: Money;
  rating_count: number;
  jobs_completed: number;
  view_count: number;
  business?: BusinessSummary;
}

export interface Store {
  id: UUID;
  business_id: UUID;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  logo_url: string | null;
  banner_url: string | null;
  theme: string;
  primary_color: string;
  accent_color: string;
  layout: 'grid' | 'list' | 'catalog';
  show_prices: boolean;
  show_stock: boolean;
  allow_reviews: boolean;
  allow_wishlist: boolean;
  allow_enquiries: boolean;
  allow_checkout: boolean;
  custom_domain: string | null;
  domain_status: string;
  announcement: string | null;
  social: Record<string, string>;
  contact_email: string | null;
  contact_phone: string | null;
  whatsapp: string | null;
  is_published: boolean;
  view_count: number;
  rating_avg: Money;
  rating_count: number;
}

export interface Review {
  id: UUID;
  business_id: UUID;
  product_id: UUID | null;
  service_id: UUID | null;
  order_id: UUID | null;
  reviewer_id: UUID;
  reviewer_name: string;
  target_type: 'product' | 'service' | 'business';
  rating: number;
  title: string | null;
  body: string | null;
  images: ProductMedia[];
  is_verified_purchase: boolean;
  helpful_count: number;
  seller_reply: string | null;
  seller_reply_at: string | null;
  status: string;
  created_at: string;
}

// ── Inventory ───────────────────────────────────────────────────────────────
export interface InventoryRow {
  id: UUID;
  business_id: UUID;
  warehouse_id: UUID;
  product_id: UUID;
  variant_id: UUID | null;
  quantity_on_hand: number;
  quantity_reserved: number;
  quantity_available: number;
  reorder_point: number;
  reorder_qty: number;
  unit_cost: Money;
  stock_value: Money;
  bin_location: string | null;
  batch_number: string | null;
  expiry_date: string | null;
  last_counted_at: string | null;
  last_movement_at: string | null;
  product?: Pick<Product, 'id' | 'name' | 'sku' | 'barcode' | 'primary_image_url' | 'unit' | 'stock_alert'>;
  warehouse?: Pick<Warehouse, 'id' | 'name' | 'kind'>;
}

export type MovementType =
  | 'purchase'
  | 'sale'
  | 'adjustment'
  | 'transfer_in'
  | 'transfer_out'
  | 'return_in'
  | 'return_out'
  | 'damaged'
  | 'expired'
  | 'counted'
  | 'opening'
  | 'import';

export interface InventoryMovement {
  id: number;
  business_id: UUID;
  warehouse_id: UUID;
  product_id: UUID;
  variant_id: UUID | null;
  movement_type: MovementType;
  quantity_change: number;
  quantity_before: number;
  quantity_after: number;
  unit_cost: Money;
  total_value: Money;
  reference_type: string | null;
  reference_id: UUID | null;
  reference_number: string | null;
  reason: string | null;
  notes: string | null;
  performed_by: UUID | null;
  performed_name: string | null;
  created_at: string;
  product?: Pick<Product, 'name' | 'sku' | 'primary_image_url'>;
  warehouse?: Pick<Warehouse, 'name'>;
}

export interface CsvSource {
  id: UUID;
  business_id: UUID;
  name: string;
  kind: 'upload' | 'url' | 'api' | 'integration';
  source_url: string | null;
  file_path: string | null;
  file_name: string | null;
  delimiter: string;
  has_header: boolean;
  column_mapping: Record<string, string>;
  transform_rules: Record<string, unknown>;
  default_values: Record<string, unknown>;
  sync_mode: 'one_time' | 'scheduled';
  sync_interval_minutes: number | null;
  match_strategy: 'sku' | 'barcode' | 'name' | 'external_id';
  on_conflict: 'skip' | 'update' | 'create_new';
  update_fields: string[];
  auto_publish: boolean;
  auto_adjust_stock: boolean;
  is_active: boolean;
  last_sync_at: string | null;
  last_sync_status: string | null;
  next_sync_at: string | null;
  total_syncs: number;
  created_at: string;
}

export interface SyncLog {
  id: UUID;
  csv_source_id: UUID;
  business_id: UUID;
  status: 'running' | 'success' | 'partial' | 'failed';
  triggered_by: string;
  rows_total: number;
  rows_created: number;
  rows_updated: number;
  rows_skipped: number;
  rows_failed: number;
  stock_changed: number;
  errors: { row: number; name?: string; sku?: string; field?: string; message: string }[];
  warnings: unknown[];
  duration_ms: number | null;
  started_at: string;
  finished_at: string | null;
}

// ── Customers, suppliers ────────────────────────────────────────────────────
export interface Customer {
  id: UUID;
  business_id: UUID;
  user_id: UUID | null;
  customer_number: string | null;
  name: string;
  company_name: string | null;
  is_company: boolean;
  email: string | null;
  phone: string | null;
  phone_country_code: string;
  whatsapp: string | null;
  tax_number: string | null;
  customer_group: string | null;
  tags: string[];
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country_code: string;
  currency: string;
  credit_limit: Money;
  payment_terms_days: number;
  default_tax_id: UUID | null;
  notes: string | null;
  source: string | null;
  orders_count: number;
  total_spent: Money;
  outstanding_balance: Money;
  credit_balance: Money;
  loyalty_points: number;
  last_order_at: string | null;
  first_order_at: string | null;
  marketing_opt_in: boolean;
  is_active: boolean;
  created_at: string;
}

export interface CustomerAddress {
  id: UUID;
  customer_id: UUID;
  label: string;
  is_default_billing: boolean;
  is_default_delivery: boolean;
  recipient_name: string | null;
  phone: string | null;
  address_line1: string;
  address_line2: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country_code: string;
  delivery_instructions: string | null;
}

export interface Supplier {
  id: UUID;
  business_id: UUID;
  user_id: UUID | null;
  supplier_number: string | null;
  name: string;
  company_name: string | null;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  phone_country_code: string;
  whatsapp: string | null;
  website: string | null;
  tax_number: string | null;
  address_line1: string | null;
  city: string | null;
  region: string | null;
  country_code: string;
  currency: string;
  payment_terms_days: number;
  credit_limit: Money;
  bank_details: BankDetails;
  lead_time_days: number | null;
  notes: string | null;
  tags: string[];
  is_active: boolean;
  orders_count: number;
  total_purchased: Money;
  outstanding_amount: Money;
  last_order_at: string | null;
  created_at: string;
}

// ── Sales ───────────────────────────────────────────────────────────────────
export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'processing'
  | 'ready'
  | 'shipped'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'
  | 'returned';

export type OrderChannel = 'marketplace' | 'pos' | 'store' | 'wholesale' | 'manual' | 'api';
export type PaymentMethod =
  | 'cash'
  | 'bank_transfer'
  | 'card'
  | 'mobile_money'
  | 'online'
  | 'cheque'
  | 'credit'
  | 'other';
export type PaymentStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'refunded' | 'cancelled';

export type DocStatus =
  | 'draft'
  | 'sent'
  | 'viewed'
  | 'accepted'
  | 'rejected'
  | 'change_requested'
  | 'signed'
  | 'partially_paid'
  | 'paid'
  | 'overdue'
  | 'cancelled'
  | 'void'
  | 'approved';

export interface Order {
  id: UUID;
  business_id: UUID;
  order_number: string;
  customer_id: UUID | null;
  buyer_user_id: UUID | null;
  branch_id: UUID | null;
  warehouse_id: UUID | null;
  served_by: UUID | null;
  served_by_name: string | null;
  channel: OrderChannel;
  status: OrderStatus;
  payment_status: PaymentStatus;
  fulfilment_status: string;
  is_wholesale: boolean;
  currency: string;
  subtotal: Money;
  discount_total: Money;
  tax_total: Money;
  delivery_fee: Money;
  tip_amount: Money;
  total: Money;
  amount_paid: Money;
  balance_due: Money;
  coupon_id: UUID | null;
  coupon_code: string | null;
  delivery_method: 'pickup' | 'delivery' | 'shipping' | 'digital';
  shipping_name: string | null;
  shipping_phone: string | null;
  shipping_line1: string | null;
  shipping_line2: string | null;
  shipping_city: string | null;
  shipping_region: string | null;
  shipping_postal_code: string | null;
  shipping_country: string;
  shipping_location: { lat?: number; lng?: number } | null;
  delivery_notes: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  tracking_number: string | null;
  courier: string | null;
  estimated_delivery_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  notes: string | null;
  customer_note: string | null;
  reference: string | null;
  invoice_id: UUID | null;
  quotation_id: UUID | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  placed_at: string;
  status_history: { status: string; at: string; by?: string; note?: string; channel?: string }[];
  items?: OrderItem[];
  customer?: Pick<Customer, 'id' | 'name' | 'phone' | 'email'>;
  business?: BusinessSummary;
}

export interface OrderItem {
  id: UUID;
  order_id: UUID;
  product_id: UUID | null;
  variant_id: UUID | null;
  service_id: UUID | null;
  warehouse_id: UUID | null;
  name: string;
  sku: string | null;
  image_url: string | null;
  unit: string;
  quantity: number;
  quantity_fulfilled: number;
  quantity_returned: number;
  unit_price: Money;
  unit_cost: Money;
  discount_amount: Money;
  discount_percent: Money;
  tax_rate: Money;
  tax_amount: Money;
  line_subtotal: Money;
  line_total: Money;
  line_profit: Money;
  is_wholesale: boolean;
  notes: string | null;
}

export interface Quotation {
  id: UUID;
  business_id: UUID;
  quotation_number: string;
  kind: 'quotation' | 'proforma';
  customer_id: UUID | null;
  buyer_user_id: UUID | null;
  status: DocStatus;
  title: string | null;
  currency: string;
  subtotal: Money;
  discount_total: Money;
  tax_total: Money;
  delivery_fee: Money;
  total: Money;
  validity_days: number;
  valid_until: string | null;
  terms: string | null;
  notes: string | null;
  issue_date: string;
  delivery_method: string | null;
  shipping_address: string | null;
  viewed_at: string | null;
  responded_at: string | null;
  response_note: string | null;
  signature_id: UUID | null;
  signed_at: string | null;
  signer_name: string | null;
  converted_order_id: UUID | null;
  converted_invoice_id: UUID | null;
  created_by: UUID;
  created_by_name: string | null;
  sent_at: string | null;
  sent_channel: string | null;
  share_token: string | null;
  items?: QuotationItem[];
  customer?: Pick<Customer, 'id' | 'name' | 'phone' | 'email' | 'address_line1' | 'city'>;
  business?: Business;
}

export interface QuotationItem {
  id: UUID;
  quotation_id: UUID;
  product_id: UUID | null;
  variant_id: UUID | null;
  service_id: UUID | null;
  description: string;
  quantity: Money;
  unit: string;
  unit_price: Money;
  discount_amount: Money;
  discount_percent: Money;
  tax_rate: Money;
  tax_amount: Money;
  line_total: Money;
  sort_order: number;
  is_optional: boolean;
  notes: string | null;
}

export interface Invoice {
  id: UUID;
  business_id: UUID;
  invoice_number: string;
  kind: 'tax_invoice' | 'proforma' | 'credit_note' | 'debit_note';
  customer_id: UUID | null;
  buyer_user_id: UUID | null;
  order_id: UUID | null;
  quotation_id: UUID | null;
  status: DocStatus;
  currency: string;
  subtotal: Money;
  discount_total: Money;
  tax_total: Money;
  delivery_fee: Money;
  total: Money;
  amount_paid: Money;
  amount_credited: Money;
  balance_due: Money;
  issue_date: string;
  due_date: string | null;
  paid_at: string | null;
  terms_days: number;
  terms: string | null;
  notes: string | null;
  reference: string | null;
  viewed_at: string | null;
  viewed_count: number;
  signature_id: UUID | null;
  signed_at: string | null;
  qr_token: string | null;
  share_token: string | null;
  payment_link: string | null;
  reminders_sent: number;
  created_by: UUID;
  created_by_name: string | null;
  sent_at: string | null;
  sent_channel: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
  items?: InvoiceItem[];
  customer?: Pick<Customer, 'id' | 'name' | 'phone' | 'email' | 'address_line1' | 'city' | 'tax_number'>;
  business?: Business;
  payments?: Payment[];
}

export interface InvoiceItem {
  id: UUID;
  invoice_id: UUID;
  product_id: UUID | null;
  variant_id: UUID | null;
  service_id: UUID | null;
  order_item_id: UUID | null;
  description: string;
  quantity: Money;
  unit: string;
  unit_price: Money;
  discount_amount: Money;
  discount_percent: Money;
  tax_rate: Money;
  tax_amount: Money;
  line_subtotal: Money;
  line_total: Money;
  sort_order: number;
  notes: string | null;
}

export interface Payment {
  id: UUID;
  business_id: UUID;
  invoice_id: UUID | null;
  order_id: UUID | null;
  quotation_id: UUID | null;
  customer_id: UUID | null;
  supplier_id: UUID | null;
  direction: 'inbound' | 'outbound';
  payment_number: string | null;
  method: PaymentMethod;
  provider: string | null;
  provider_reference: string | null;
  status: PaymentStatus;
  currency: string;
  amount: Money;
  amount_base: Money;
  fee_amount: Money;
  payer_name: string | null;
  payer_phone: string | null;
  received_at: string;
  notes: string | null;
  recorded_by: UUID | null;
  recorded_by_name: string | null;
  receipt_id: UUID | null;
  is_online: boolean;
  payment_link_id: UUID | null;
  refunded_amount: Money;
  invoice?: Pick<Invoice, 'id' | 'invoice_number'>;
  customer?: Pick<Customer, 'id' | 'name'>;
  receipt?: Receipt;
}

export interface Receipt {
  id: UUID;
  business_id: UUID;
  receipt_number: string;
  payment_id: UUID;
  invoice_id: UUID | null;
  order_id: UUID | null;
  customer_id: UUID | null;
  customer_name: string | null;
  amount: Money;
  currency: string;
  method: PaymentMethod;
  balance_after: Money;
  received_at: string;
  notes: string | null;
  qr_token: string | null;
  share_token: string | null;
  signed_by_name: string | null;
  created_by_name: string | null;
  is_automatic: boolean;
  business?: Business;
}

export interface PaymentLink {
  id: UUID;
  business_id: UUID;
  code: string;
  label: string | null;
  description: string | null;
  amount: Money;
  currency: string;
  allow_custom_amount: boolean;
  min_amount: Money | null;
  max_amount: Money | null;
  invoice_id: UUID | null;
  order_id: UUID | null;
  customer_id: UUID | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  methods: PaymentMethod[];
  status: 'active' | 'paid' | 'expired' | 'cancelled' | 'paused';
  expires_at: string | null;
  payments_count: number;
  amount_collected: Money;
  message: string | null;
  thank_you_message: string | null;
  created_at: string;
}

export interface Expense {
  id: UUID;
  business_id: UUID;
  branch_id: UUID | null;
  category_id: UUID | null;
  supplier_id: UUID | null;
  expense_number: string | null;
  title: string;
  description: string | null;
  amount: Money;
  tax_amount: Money;
  currency: string;
  method: PaymentMethod;
  status: 'recorded' | 'pending_approval' | 'approved' | 'rejected' | 'reimbursed' | 'recurring';
  expense_date: string;
  is_reimbursable: boolean;
  is_recurring: boolean;
  attachment_urls: string[];
  receipt_url: string | null;
  reference: string | null;
  requires_approval: boolean;
  approved_by: UUID | null;
  created_by: UUID;
  created_by_name: string | null;
  notes: string | null;
  created_at: string;
  category?: { id: UUID; name: string; icon: string | null; color: string | null };
}

export interface ExpenseCategory {
  id: UUID;
  business_id: UUID;
  name: string;
  icon: string | null;
  color: string | null;
  account_code: string | null;
  budget_monthly: Money | null;
  sort_order: number;
  is_active: boolean;
}

export interface PurchaseOrder {
  id: UUID;
  business_id: UUID;
  po_number: string;
  supplier_id: UUID;
  warehouse_id: UUID | null;
  status:
    | 'draft'
    | 'sent'
    | 'acknowledged'
    | 'partially_received'
    | 'received'
    | 'billed'
    | 'paid'
    | 'cancelled';
  currency: string;
  subtotal: Money;
  tax_total: Money;
  discount_total: Money;
  delivery_fee: Money;
  total: Money;
  amount_paid: Money;
  balance_due: Money;
  order_date: string;
  expected_date: string | null;
  received_at: string | null;
  terms: string | null;
  notes: string | null;
  supplier_reference: string | null;
  requires_approval: boolean;
  approved_by: UUID | null;
  created_by_name: string | null;
  supplier?: Pick<Supplier, 'id' | 'name' | 'phone' | 'email'>;
  items?: PurchaseItem[];
}

export interface PurchaseItem {
  id: UUID;
  purchase_order_id: UUID;
  product_id: UUID | null;
  description: string;
  supplier_sku: string | null;
  quantity_ordered: number;
  quantity_received: number;
  quantity_rejected: number;
  unit: string;
  unit_cost: Money;
  tax_rate: Money;
  tax_amount: Money;
  discount_amount: Money;
  line_total: Money;
}

// ── Documents ───────────────────────────────────────────────────────────────
export type DocType =
  | 'quotation'
  | 'proforma_invoice'
  | 'invoice'
  | 'receipt'
  | 'purchase_order'
  | 'delivery_note'
  | 'contract'
  | 'agreement'
  | 'statement'
  | 'credit_note'
  | 'debit_note'
  | 'payment_voucher'
  | 'expense_document'
  | 'return_note'
  | 'other';

export interface DocumentRow {
  id: UUID;
  business_id: UUID;
  doc_number: string;
  doc_type: DocType;
  title: string;
  status: DocStatus;
  entity_type: string;
  entity_id: UUID | null;
  customer_id: UUID | null;
  supplier_id: UUID | null;
  currency: string;
  total: Money;
  issue_date: string;
  due_date: string | null;
  file_url: string | null;
  file_name: string | null;
  qr_token: string | null;
  share_token: string | null;
  view_count: number;
  last_viewed_at: string | null;
  download_count: number;
  requires_signature: boolean;
  is_signed: boolean;
  signed_at: string | null;
  is_archived: boolean;
  created_by_name: string | null;
  sent_at: string | null;
  created_at: string;
  customer?: Pick<Customer, 'id' | 'name'>;
}

export interface Signature {
  id: UUID;
  business_id: UUID | null;
  user_id: UUID | null;
  signer_name: string;
  signer_email: string | null;
  method: 'drawn' | 'uploaded' | 'typed' | 'saved';
  image_url: string | null;
  image_data: string | null;
  typed_text: string | null;
  is_saved_template: boolean;
  signed_at: string;
  intent_text: string | null;
}

// ── Communication ───────────────────────────────────────────────────────────
export interface Conversation {
  id: UUID;
  business_id: UUID;
  participant_user_id: UUID | null;
  participant_name: string;
  participant_phone: string | null;
  kind: 'marketplace' | 'support' | 'whatsapp' | 'internal';
  subject: string | null;
  product_id: UUID | null;
  order_id: UUID | null;
  status: 'open' | 'pending' | 'resolved' | 'closed' | 'archived';
  unread_business: number;
  unread_user: number;
  last_message_at: string;
  last_message_preview: string | null;
  priority: string;
}

export interface Message {
  id: UUID;
  conversation_id: UUID;
  sender_id: UUID | null;
  sender_type: 'user' | 'business' | 'system' | 'ai';
  sender_name: string;
  body: string;
  attachment: Record<string, unknown> | null;
  reference_type: string | null;
  reference_id: UUID | null;
  is_read: boolean;
  created_at: string;
}

export type NotificationType =
  | 'order'
  | 'message'
  | 'payment'
  | 'quotation'
  | 'invoice'
  | 'stock'
  | 'review'
  | 'promotion'
  | 'security'
  | 'system'
  | 'document'
  | 'customer'
  | 'supplier';

export interface AppNotification {
  id: UUID;
  user_id: UUID;
  business_id: UUID | null;
  type: NotificationType;
  title: string;
  body: string | null;
  icon: string | null;
  action_url: string | null;
  entity_type: string | null;
  entity_id: UUID | null;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

// ── Marketing, subscriptions, AI ────────────────────────────────────────────
export interface Coupon {
  id: UUID;
  business_id: UUID;
  code: string;
  description: string | null;
  discount_type: 'percent' | 'fixed' | 'free_delivery' | 'bogo';
  discount_value: Money;
  max_discount: Money | null;
  min_subtotal: Money;
  applies_to: string;
  per_customer_limit: number | null;
  total_limit: number | null;
  usage_count: number;
  starts_at: string;
  ends_at: string | null;
  is_active: boolean;
  created_at: string;
}

export interface Plan {
  id: UUID;
  key: 'free' | 'starter' | 'business' | 'professional' | 'enterprise';
  name: string;
  tagline: string | null;
  description: string | null;
  price_monthly: Money;
  price_annual: Money;
  currency: string;
  price_overrides: Record<string, { monthly?: number; annual?: number }>;
  is_active: boolean;
  is_popular: boolean;
  sort_order: number;
  limits: Record<string, number | boolean | string>;
  features: { key: string; label: string; included: boolean }[];
}

export interface Subscription {
  id: UUID;
  business_id: UUID;
  plan_id: UUID;
  status: 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired';
  billing_cycle: 'monthly' | 'annual';
  currency: string;
  amount: Money;
  trial_ends_at: string | null;
  current_period_start: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  plan?: Plan;
}

export type AiImpact = 'low' | 'medium' | 'high' | 'financial' | 'destructive';

export interface AiAction {
  id: UUID;
  business_id: UUID;
  conversation_id: UUID | null;
  requested_by: UUID;
  action: string;
  impact: AiImpact;
  requires_approval: boolean;
  status: 'proposed' | 'approved' | 'rejected' | 'executed' | 'failed';
  payload: Record<string, unknown>;
  diff: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  explanation: string | null;
  approved_by: UUID | null;
  approved_at: string | null;
  rejected_reason: string | null;
  executed_at: string | null;
  created_at: string;
}

export interface AiConversation {
  id: UUID;
  business_id: UUID | null;
  user_id: UUID;
  title: string | null;
  assistant: string;
  message_count: number;
  last_message_at: string;
}

export interface AiMessage {
  id: UUID;
  conversation_id: UUID;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  data: Record<string, unknown>;
  feedback: number | null;
  created_at: string;
}

export interface BusinessInsight {
  id: UUID;
  business_id: UUID;
  kind: string;
  title: string;
  body: string;
  severity: 'info' | 'positive' | 'warning' | 'critical';
  metric: string | null;
  metric_value: Money | null;
  metric_change: Money | null;
  period_start: string | null;
  period_end: string | null;
  recommendations: { title: string; detail?: string; action?: string }[];
  is_read: boolean;
  is_dismissed: boolean;
  created_at: string;
}

export interface AutomationRule {
  id: UUID;
  business_id: UUID;
  name: string;
  description: string | null;
  trigger_type: string;
  trigger_config: Record<string, unknown>;
  actions: { type: string; [k: string]: unknown }[];
  requires_approval: boolean;
  is_active: boolean;
  run_count: number;
  last_run_at: string | null;
  next_run_at: string | null;
}

export interface AuditLog {
  id: number;
  business_id: UUID | null;
  actor_id: UUID | null;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: UUID | null;
  entity_label: string | null;
  changes: Record<string, { old: unknown; new: unknown }> | null;
  created_at: string;
}

// ── RPC shapes ──────────────────────────────────────────────────────────────
export interface SearchResult<T> {
  total: number;
  items: T[];
  has_more: boolean;
  limit?: number;
  offset?: number;
}

export interface ProductSearchRow extends Product {
  category_name: string | null;
  category_slug: string | null;
  category_path: string | null;
  business_id: UUID;
  business_name: string;
  business_slug: string;
  business_logo: string | null;
  business_city: string | null;
  business_country: string;
  verification_status: VerificationStatus;
  business_rating: Money;
  business_badges: string[];
  accepts_orders: boolean;
  delivery_enabled: boolean;
}

export interface BusinessSearchRow extends BusinessSummary {
  business_type: BusinessType;
  region: string | null;
  description: string | null;
  tagline: string | null;
  cover_url: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  website: string | null;
  opening_hours: OpeningHours;
  product_count: number;
  sales_count: number;
  is_featured: boolean;
  joined_at: string;
  category_name: string | null;
  category_slug: string | null;
  live_products: number;
  distance_km: Money | null;
}

export interface DashboardSummary {
  currency: string;
  symbol: string;
  from: string;
  to: string;
  today: { sales: Money; orders: number; payments: Money };
  period: { revenue: Money; orders: number; cogs: Money; profit: Money; items_sold: number };
  expenses: Money;
  receivable: Money;
  overdue: { amount: Money; count: number };
  payable: Money;
  available: Money;
  stock: { value: Money; units: number; low: number; out: number };
  counts: {
    products: number;
    published: number;
    drafts: number;
    customers: number;
    new_customers: number;
    orders_pending: number;
    quotations_open: number;
    invoices_unpaid: number;
    reviews: number;
    unread_messages: number;
    staff: number;
  };
  pending_approvals: {
    refunds: number;
    purchase_orders: number;
    expenses: number;
    ai_actions: number;
    returns: number;
  };
  verification: { status: VerificationStatus; badges: string[]; growth_score: number };
}

export interface GrowthScore {
  profile: number;
  catalogue: number;
  activity: number;
  inventory: number;
  reputation: number;
  total: number;
  level: 'excellent' | 'strong' | 'developing' | 'getting_started';
  next_steps: string[];
}

/** A line the UI hands to the document/order RPCs. */
export interface DraftLine {
  product_id?: UUID | null;
  variant_id?: UUID | null;
  service_id?: UUID | null;
  description?: string;
  name?: string;
  quantity: number;
  unit?: string;
  unit_price: number;
  discount_percent?: number;
  discount_amount?: number;
  tax_rate?: number;
  notes?: string;
  image_url?: string;
  sku?: string;
}

export interface CartLine extends DraftLine {
  key: string;
  product?: Product;
  business_id: UUID;
  business_name: string;
  business_slug: string;
  is_wholesale: boolean;
  tax_rate: number;
}

/* ── Community groups (Firestore: groups / group_members / group_messages) ── */

export interface Group {
  id: UUID;
  business_id: UUID | null;
  owner_id: UUID | null;
  name: string;
  slug: string | null;
  description: string | null;
  image: string | null;
  category: string | null;
  visibility: 'public' | 'private';
  country_code: string;
  member_count: number;
  is_approval_needed: boolean;
  created_at: string;
  updated_at: string;
}

export type GroupMemberRole = 'owner' | 'admin' | 'member' | 'moderator';
export type GroupMemberStatus = 'active' | 'invited' | 'banned' | 'left';

export interface GroupMember {
  id: UUID;
  group_id: UUID;
  user_id: UUID;
  role: GroupMemberRole;
  status: GroupMemberStatus;
  joined_at: string;
  profile?: { full_name: string | null; display_name: string | null; avatar_url: string | null } | null;
}

export interface GroupMessage {
  id: UUID;
  group_id: UUID;
  sender_id: UUID | null;
  sender_name: string;
  sender_role: string;
  body: string;
  attachment: Record<string, unknown> | null;
  reference_type: string | null;
  reference_id: UUID | null;
  reference_url: string | null;
  reference_title: string | null;
  reference_img: string | null;
  is_edited: boolean;
  created_at: string;
}
