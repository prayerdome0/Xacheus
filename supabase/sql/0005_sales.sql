-- ══════════════════════════════════════════════════════════════════════════════
--  SEEDWEL HUB — 0005 · Sales: taxes, customers, carts, orders, invoices,
--                        quotations & pro-forma, payments, receipts, refunds,
--                        returns, delivery notes
--
--  The chain that makes Seedwel Hub a business platform and not a listing site:
--      Customer → Quotation → (Pro-forma) → Order → Invoice → Payment → Receipt
--  Any document can be converted to the next with one action.
--
--  Cross-module FKs (signatures, suppliers, coupons, payment_links) are attached
--  in 0006/0007 where those tables are defined. Deferrable FKs break the
--  orders ↔ invoices cycle.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── DOCUMENT NUMBERING (atomic, per business, zero-padded) ────────────────────
create or replace function public.next_document_number(
  p_business_id uuid,
  p_kind        text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_number integer;
  v_number_col text;
  v_prefix_col text;
begin
  v_number_col := case p_kind
    when 'invoice'        then 'next_invoice_number'
    when 'quotation'      then 'next_quotation_number'
    when 'receipt'        then 'next_receipt_number'
    when 'order'          then 'next_order_number'
    when 'purchase_order' then 'next_po_number'
    when 'credit_note'    then 'next_credit_note_number'
    when 'debit_note'     then 'next_debit_note_number'
    else null
  end;
  v_prefix_col := case p_kind
    when 'invoice'        then 'invoice_prefix'
    when 'quotation'      then 'quotation_prefix'
    when 'receipt'        then 'receipt_prefix'
    when 'order'          then 'order_prefix'
    when 'purchase_order' then 'po_prefix'
    when 'credit_note'    then 'credit_note_prefix'
    when 'debit_note'     then 'debit_note_prefix'
    else null
  end;

  if v_number_col is null then
    raise exception 'unknown document kind: %', p_kind;
  end if;

  execute format(
    'update public.businesses
        set %1$I = %1$I + 1
      where id = $1
      returning %1$I - 1', v_number_col)
    into v_number
    using p_business_id;

  if v_number is null then
    raise exception 'business % not found', p_business_id;
  end if;

  execute format('select %I from public.businesses where id = $1', v_prefix_col)
    into v_prefix
    using p_business_id;

  return format('%s-%s', coalesce(nullif(v_prefix,''), upper(left(p_kind,3))), lpad(v_number::text, 5, '0'));
end $$;

revoke all on function public.next_document_number(uuid, text) from public;
grant execute on function public.next_document_number(uuid, text) to authenticated;

-- ── TAXES (configurable, never hard-coded) ────────────────────────────────────
create table if not exists public.taxes (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid references public.businesses(id) on delete cascade,  -- null = platform default
  country_code  text not null default 'ZM' references public.countries(code),
  name          text not null,                       -- VAT | Sales Tax | Withholding
  rate          numeric(6,3) not null default 0 check (rate >= 0 and rate <= 100),
  is_inclusive  boolean not null default false,      -- price already contains tax
  applies_to    text not null default 'both',        -- products|services|both
  is_default    boolean not null default false,
  account_code  text,                                -- for accounting exports
  is_active     boolean not null default true,
  effective_from date not null default current_date,
  effective_to   date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists taxes_business_idx on public.taxes (business_id) where is_active;
create index if not exists taxes_country_idx on public.taxes (country_code, is_default) where is_active;

alter table public.businesses
  drop constraint if exists businesses_default_tax_fk,
  add constraint businesses_default_tax_fk foreign key (default_tax_id)
    references public.taxes(id) on delete set null;

alter table public.products
  drop constraint if exists products_tax_fk,
  add constraint products_tax_fk foreign key (tax_id)
    references public.taxes(id) on delete set null;

-- Platform defaults (businesses can override; rates change with regulation).
insert into public.taxes (business_id, country_code, name, rate, is_inclusive, is_default)
select null, c.code, c.tax_name, c.default_tax_rate, false, true
from public.countries c
where c.default_tax_rate > 0
on conflict do nothing;

create table if not exists public.tax_exemptions (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  product_id   uuid references public.products(id) on delete cascade,
  category_id  uuid references public.categories(id) on delete cascade,
  customer_id  uuid,                                 -- fk added below (customers)
  reason       text not null,
  certificate  text,
  valid_from   date not null default current_date,
  valid_to     date,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (product_id is not null or category_id is not null or customer_id is not null)
);

-- ── CUSTOMERS (CRM) ───────────────────────────────────────────────────────────
create table if not exists public.customers (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  user_id        uuid references auth.users(id) on delete set null,   -- set when they have an account
  customer_number text,
  name           text not null,
  company_name   text,
  is_company     boolean not null default false,
  email          text,
  phone          text,
  phone_country_code text not null default '+260',
  whatsapp       text,
  tax_number     text,
  customer_group text,                                -- retail|wholesale|vip|walk_in|corporate
  tags           text[] not null default '{}',
  address_line1  text,
  address_line2  text,
  city           text,
  region         text,
  postal_code    text,
  country_code   text not null default 'ZM' references public.countries(code),
  location       jsonb,
  currency       text not null default 'ZMW' references public.currencies(code),
  credit_limit   numeric(14,2) not null default 0,
  payment_terms_days smallint not null default 0,     -- 0 = due on receipt
  default_tax_id uuid references public.taxes(id) on delete set null,
  notes          text,
  source         text,                                -- marketplace|pos|referral|walk_in|import|whatsapp

  -- Denormalised totals kept in sync by 0006 triggers
  orders_count   integer not null default 0,
  total_spent    numeric(16,2) not null default 0,
  outstanding_balance numeric(16,2) not null default 0,
  credit_balance numeric(16,2) not null default 0,
  loyalty_points integer not null default 0,
  last_order_at  timestamptz,
  first_order_at timestamptz,

  marketing_opt_in boolean not null default false,
  is_active      boolean not null default true,
  created_by     uuid references auth.users(id) on delete set null,
  deleted_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (business_id, customer_number)
);
create index if not exists customers_business_idx on public.customers (business_id, is_active) where deleted_at is null;
create index if not exists customers_user_idx on public.customers (user_id);
create index if not exists customers_name_trgm_idx on public.customers using gin (name gin_trgm_ops);
create index if not exists customers_phone_idx on public.customers (business_id, phone);
create index if not exists customers_email_idx on public.customers (business_id, email);
create index if not exists customers_top_idx on public.customers (business_id, total_spent desc);
create index if not exists customers_dormant_idx on public.customers (business_id, last_order_at);

alter table public.tax_exemptions
  drop constraint if exists tax_exemptions_customer_fk,
  add constraint tax_exemptions_customer_fk foreign key (customer_id)
    references public.customers(id) on delete cascade;

create table if not exists public.customer_addresses (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.customers(id) on delete cascade,
  label        text not null default 'Home',          -- Home|Work|Billing|Delivery
  is_default_billing  boolean not null default false,
  is_default_delivery boolean not null default false,
  recipient_name text,
  phone        text,
  address_line1 text not null,
  address_line2 text,
  city         text,
  region       text,
  postal_code  text,
  country_code text not null default 'ZM' references public.countries(code),
  location     jsonb,
  delivery_instructions text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists customer_addresses_idx on public.customer_addresses (customer_id);

create table if not exists public.customer_notes (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.customers(id) on delete cascade,
  business_id  uuid not null references public.businesses(id) on delete cascade,
  author_id    uuid references auth.users(id) on delete set null,
  author_name  text,
  body         text not null,
  is_pinned    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists customer_notes_idx on public.customer_notes (customer_id, created_at desc);

-- ── CARTS ─────────────────────────────────────────────────────────────────────
create table if not exists public.carts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete cascade,
  session_key  text,                                  -- guest carts
  business_id  uuid references public.businesses(id) on delete cascade,
  currency     text not null default 'ZMW' references public.currencies(code),
  coupon_code  text,
  subtotal     numeric(14,2) not null default 0,
  discount     numeric(14,2) not null default 0,
  tax_total    numeric(14,2) not null default 0,
  delivery_fee numeric(14,2) not null default 0,
  total        numeric(14,2) not null default 0,
  item_count   integer not null default 0,
  status       text not null default 'active',        -- active|converted|abandoned
  converted_order_id uuid,
  expires_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (user_id is not null or session_key is not null)
);
create index if not exists carts_user_idx on public.carts (user_id, status);
create unique index if not exists carts_user_active_uq on public.carts (user_id) where status = 'active';
create index if not exists carts_session_idx on public.carts (session_key) where session_key is not null;

create table if not exists public.cart_items (
  id           uuid primary key default gen_random_uuid(),
  cart_id      uuid not null references public.carts(id) on delete cascade,
  product_id   uuid not null references public.products(id) on delete cascade,
  variant_id   uuid references public.product_variants(id) on delete set null,
  quantity     integer not null default 1 check (quantity > 0),
  unit_price   numeric(14,2) not null default 0,
  is_wholesale boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (cart_id, product_id, variant_id)
);

-- ── ORDERS ────────────────────────────────────────────────────────────────────
create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  order_number    text not null,
  customer_id     uuid references public.customers(id) on delete set null,
  buyer_user_id   uuid references auth.users(id) on delete set null,   -- marketplace buyer
  cart_id         uuid references public.carts(id) on delete set null,
  branch_id       uuid references public.branches(id) on delete set null,
  warehouse_id    uuid references public.warehouses(id) on delete set null,
  served_by       uuid references auth.users(id) on delete set null,   -- POS cashier
  served_by_name  text,

  channel         public.order_channel not null default 'marketplace',
  status          public.order_status not null default 'pending',
  payment_status  public.payment_status not null default 'pending',
  fulfilment_status text not null default 'unfulfilled', -- unfulfilled|partial|fulfilled
  is_wholesale    boolean not null default false,

  currency        text not null default 'ZMW' references public.currencies(code),
  exchange_rate   numeric(18,8) not null default 1,
  subtotal        numeric(14,2) not null default 0,
  discount_total  numeric(14,2) not null default 0,
  tax_total       numeric(14,2) not null default 0,
  delivery_fee    numeric(14,2) not null default 0,
  tip_amount      numeric(14,2) not null default 0,
  total           numeric(14,2) not null default 0,
  amount_paid     numeric(14,2) not null default 0,
  balance_due     numeric(14,2) generated always as (total - amount_paid) stored,
  coupon_id       uuid,                              -- fk added in 0007 (coupons)
  coupon_code     text,

  -- Delivery / collection
  delivery_method text not null default 'pickup',    -- pickup|delivery|shipping|digital
  delivery_address_id uuid references public.customer_addresses(id) on delete set null,
  shipping_name   text,
  shipping_phone  text,
  shipping_line1  text,
  shipping_line2  text,
  shipping_city   text,
  shipping_region text,
  shipping_postal_code text,
  shipping_country text not null default 'ZM',
  shipping_location jsonb,
  delivery_notes  text,
  delivery_fee_quoted numeric(14,2),
  driver_id       uuid references auth.users(id) on delete set null,
  driver_name     text,
  driver_phone    text,
  tracking_number text,
  courier         text,
  estimated_delivery_at timestamptz,
  shipped_at      timestamptz,
  delivered_at    timestamptz,
  proof_of_delivery_url text,

  notes           text,
  customer_note   text,
  internal_note   text,
  reference       text,
  ip_address      inet,
  user_agent      text,

  invoice_id      uuid,                              -- fk added below (cyclic)
  quotation_id    uuid,                              -- fk added below (cyclic)
  cancelled_at    timestamptz,
  cancellation_reason text,
  completed_at    timestamptz,
  placed_at       timestamptz not null default now(),
  status_history  jsonb not null default '[]'::jsonb,
  -- [{"status":"confirmed","at":"…","by":"John","note":"…"}]
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (business_id, order_number)
);
create index if not exists orders_business_idx on public.orders (business_id, placed_at desc);
create index if not exists orders_status_idx on public.orders (business_id, status);
create index if not exists orders_buyer_idx on public.orders (buyer_user_id, placed_at desc);
create index if not exists orders_customer_idx on public.orders (customer_id, placed_at desc);
create index if not exists orders_payment_status_idx on public.orders (business_id, payment_status);
create index if not exists orders_channel_idx on public.orders (business_id, channel, placed_at desc);
create index if not exists orders_number_idx on public.orders (order_number);

create table if not exists public.order_items (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.orders(id) on delete cascade,
  product_id     uuid references public.products(id) on delete set null,
  variant_id     uuid references public.product_variants(id) on delete set null,
  service_id     uuid references public.services(id) on delete set null,
  warehouse_id   uuid references public.warehouses(id) on delete set null,

  name           text not null,                    -- snapshot at time of sale
  sku            text,
  image_url      text,
  unit           text not null default 'piece',
  quantity       integer not null check (quantity > 0),
  quantity_fulfilled integer not null default 0,
  quantity_returned  integer not null default 0,
  unit_price     numeric(14,2) not null default 0,
  unit_cost      numeric(14,2) not null default 0,
  discount_amount numeric(14,2) not null default 0,
  discount_percent numeric(5,2) not null default 0,
  tax_rate       numeric(6,3) not null default 0,
  tax_amount     numeric(14,2) not null default 0,
  line_subtotal  numeric(14,2) not null default 0,
  line_total     numeric(14,2) not null default 0,
  line_profit    numeric(14,2) generated always as
                 (line_total - tax_amount - (quantity * unit_cost)) stored,
  is_wholesale   boolean not null default false,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (product_id is not null or service_id is not null)
);
create index if not exists order_items_order_idx on public.order_items (order_id);
create index if not exists order_items_product_idx on public.order_items (product_id);

alter table public.reviews
  drop constraint if exists reviews_order_fk,
  add constraint reviews_order_fk foreign key (order_id)
    references public.orders(id) on delete set null;

-- ── INVOICES ──────────────────────────────────────────────────────────────────
create table if not exists public.invoices (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  invoice_number text not null,
  kind           text not null default 'tax_invoice', -- tax_invoice|proforma|credit_note|debit_note
  customer_id    uuid references public.customers(id) on delete set null,
  buyer_user_id  uuid references auth.users(id) on delete set null,
  order_id       uuid references public.orders(id) on delete set null,
  quotation_id   uuid,                             -- fk added below (cyclic)
  branch_id      uuid references public.branches(id) on delete set null,
  status         public.doc_status not null default 'draft',

  currency       text not null default 'ZMW' references public.currencies(code),
  exchange_rate  numeric(18,8) not null default 1,
  subtotal       numeric(14,2) not null default 0,
  discount_total numeric(14,2) not null default 0,
  tax_total      numeric(14,2) not null default 0,
  delivery_fee   numeric(14,2) not null default 0,
  total          numeric(14,2) not null default 0,
  amount_paid    numeric(14,2) not null default 0,
  amount_credited numeric(14,2) not null default 0,
  balance_due    numeric(14,2) generated always as
                 (total - amount_paid - amount_credited) stored,

  issue_date     date not null default current_date,
  due_date       date,
  paid_at        timestamptz,
  terms_days     smallint not null default 7,
  terms          text,
  notes          text,
  reference      text,
  is_recurring   boolean not null default false,
  recurrence     text,                             -- weekly|monthly|quarterly|annual
  parent_invoice_id uuid references public.invoices(id) on delete set null,

  viewed_at      timestamptz,
  viewed_count   integer not null default 0,
  signature_id   uuid,                             -- fk added in 0006 (signatures)
  signed_at      timestamptz,
  qr_token       text unique,                      -- verification QR payload
  share_token    text unique,                      -- public view/pay link
  payment_link   text,
  reminders_sent integer not null default 0,
  last_reminder_at timestamptz,

  created_by     uuid not null references auth.users(id) on delete restrict,
  created_by_name text,
  approved_by    uuid references auth.users(id) on delete set null,
  sent_at        timestamptz,
  sent_channel   text,
  voided_at      timestamptz,
  void_reason    text,
  deleted_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (business_id, invoice_number)
);
create index if not exists invoices_business_idx on public.invoices (business_id, issue_date desc);
create index if not exists invoices_status_idx on public.invoices (business_id, status);
create index if not exists invoices_customer_idx on public.invoices (customer_id, issue_date desc);
create index if not exists invoices_order_idx on public.invoices (order_id);
create index if not exists invoices_overdue_idx
  on public.invoices (business_id, due_date)
  where status in ('sent','viewed','partially_paid');
create index if not exists invoices_number_idx on public.invoices (invoice_number);
create index if not exists invoices_share_idx on public.invoices (share_token);

create table if not exists public.invoice_items (
  id             uuid primary key default gen_random_uuid(),
  invoice_id     uuid not null references public.invoices(id) on delete cascade,
  product_id     uuid references public.products(id) on delete set null,
  variant_id     uuid references public.product_variants(id) on delete set null,
  service_id     uuid references public.services(id) on delete set null,
  order_item_id  uuid references public.order_items(id) on delete set null,
  description    text not null,
  quantity       numeric(12,3) not null default 1 check (quantity > 0),
  unit           text not null default 'piece',
  unit_price     numeric(14,2) not null default 0,
  discount_amount numeric(14,2) not null default 0,
  discount_percent numeric(5,2) not null default 0,
  tax_rate       numeric(6,3) not null default 0,
  tax_amount     numeric(14,2) not null default 0,
  line_subtotal  numeric(14,2) not null default 0,
  line_total     numeric(14,2) not null default 0,
  sort_order     integer not null default 0,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists invoice_items_idx on public.invoice_items (invoice_id, sort_order);

-- Break the orders ↔ invoices ↔ quotations cycle.
alter table public.orders
  drop constraint if exists orders_invoice_fk,
  add constraint orders_invoice_fk foreign key (invoice_id)
    references public.invoices(id) on delete set null deferrable initially deferred;

-- ── QUOTATIONS (pro-forma invoices share this table, flagged by kind) ─────────
create table if not exists public.quotations (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  quotation_number text not null,
  kind           text not null default 'quotation', -- quotation|proforma
  customer_id    uuid references public.customers(id) on delete set null,
  buyer_user_id  uuid references auth.users(id) on delete set null,
  branch_id      uuid references public.branches(id) on delete set null,
  status         public.doc_status not null default 'draft',
  title          text,
  currency       text not null default 'ZMW' references public.currencies(code),
  exchange_rate  numeric(18,8) not null default 1,
  subtotal       numeric(14,2) not null default 0,
  discount_total numeric(14,2) not null default 0,
  tax_total      numeric(14,2) not null default 0,
  delivery_fee   numeric(14,2) not null default 0,
  total          numeric(14,2) not null default 0,
  validity_days  smallint not null default 14,
  valid_until    date,
  terms          text,
  notes          text,
  issue_date     date not null default current_date,
  delivery_method text,
  shipping_address text,

  -- Customer response + digital signature
  viewed_at      timestamptz,
  responded_at   timestamptz,
  response_note  text,
  signature_id   uuid,                             -- fk added in 0006 (signatures)
  signed_at      timestamptz,
  signer_name    text,

  converted_order_id   uuid references public.orders(id) on delete set null,
  converted_invoice_id uuid references public.invoices(id) on delete set null,
  converted_at   timestamptz,
  created_by     uuid not null references auth.users(id) on delete restrict,
  created_by_name text,
  sent_at        timestamptz,
  sent_channel   text,                             -- whatsapp|email|link|sms
  share_token    text unique,                      -- public view/accept/sign link
  expires_at     timestamptz,
  deleted_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (business_id, quotation_number)
);
create index if not exists quotations_business_idx on public.quotations (business_id, status, issue_date desc);
create index if not exists quotations_customer_idx on public.quotations (customer_id, created_at desc);
create index if not exists quotations_kind_idx on public.quotations (business_id, kind, status);
create index if not exists quotations_share_idx on public.quotations (share_token);

create table if not exists public.quotation_items (
  id             uuid primary key default gen_random_uuid(),
  quotation_id   uuid not null references public.quotations(id) on delete cascade,
  product_id     uuid references public.products(id) on delete set null,
  variant_id     uuid references public.product_variants(id) on delete set null,
  service_id     uuid references public.services(id) on delete set null,
  description    text not null,
  quantity       numeric(12,3) not null default 1 check (quantity > 0),
  unit           text not null default 'piece',
  unit_price     numeric(14,2) not null default 0,
  discount_amount numeric(14,2) not null default 0,
  discount_percent numeric(5,2) not null default 0,
  tax_rate       numeric(6,3) not null default 0,
  tax_amount     numeric(14,2) not null default 0,
  line_total     numeric(14,2) not null default 0,
  sort_order     integer not null default 0,
  is_optional    boolean not null default false,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (product_id is not null or service_id is not null or description <> '')
);
create index if not exists quotation_items_idx on public.quotation_items (quotation_id, sort_order);

alter table public.orders
  drop constraint if exists orders_quotation_fk,
  add constraint orders_quotation_fk foreign key (quotation_id)
    references public.quotations(id) on delete set null;

alter table public.invoices
  drop constraint if exists invoices_quotation_fk,
  add constraint invoices_quotation_fk foreign key (quotation_id)
    references public.quotations(id) on delete set null;

-- ── PAYMENTS ──────────────────────────────────────────────────────────────────
create table if not exists public.payments (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  invoice_id     uuid references public.invoices(id) on delete set null,
  order_id       uuid references public.orders(id) on delete set null,
  quotation_id   uuid references public.quotations(id) on delete set null,
  customer_id    uuid references public.customers(id) on delete set null,
  supplier_id    uuid,                             -- fk added in 0006 (suppliers) — outgoing payments
  direction      text not null default 'inbound',  -- inbound|outbound
  payment_number text,
  method         public.payment_method not null default 'cash',
  provider       text,                             -- seedwel_pay|stripe|flutterwave|dpo|airtel|mtn|zamtel|bank
  provider_reference text,                         -- transaction id from the provider
  status         public.payment_status not null default 'completed',
  currency       text not null default 'ZMW' references public.currencies(code),
  exchange_rate  numeric(18,8) not null default 1,
  amount         numeric(14,2) not null check (amount > 0),
  amount_base    numeric(14,2) not null default 0, -- converted to business base currency
  fee_amount     numeric(14,2) not null default 0,
  bank_account   text,
  payer_name     text,
  payer_phone    text,
  payer_email    text,
  received_at    timestamptz not null default now(),
  notes          text,
  recorded_by    uuid references auth.users(id) on delete set null,
  recorded_by_name text,
  receipt_id     uuid,                             -- fk added below (cyclic)
  is_online      boolean not null default false,
  payment_link_id uuid,                            -- fk added in 0007
  refunded_amount numeric(14,2) not null default 0,
  metadata       jsonb not null default '{}'::jsonb,
  deleted_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (business_id, payment_number)
);
create index if not exists payments_business_idx on public.payments (business_id, received_at desc);
create index if not exists payments_invoice_idx on public.payments (invoice_id);
create index if not exists payments_order_idx on public.payments (order_id);
create index if not exists payments_customer_idx on public.payments (customer_id, received_at desc);
create index if not exists payments_supplier_idx on public.payments (supplier_id, received_at desc);
create index if not exists payments_method_idx on public.payments (business_id, method, received_at desc);
create index if not exists payments_provider_ref_idx on public.payments (provider, provider_reference);
create index if not exists payments_direction_idx on public.payments (business_id, direction, received_at desc);

-- ── RECEIPTS (auto-generated when a payment lands) ────────────────────────────
create table if not exists public.receipts (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  receipt_number text not null,
  payment_id     uuid not null unique references public.payments(id) on delete cascade,
  invoice_id     uuid references public.invoices(id) on delete set null,
  order_id       uuid references public.orders(id) on delete set null,
  customer_id    uuid references public.customers(id) on delete set null,
  customer_name  text,
  amount         numeric(14,2) not null,
  currency       text not null default 'ZMW' references public.currencies(code),
  method         public.payment_method not null default 'cash',
  balance_after  numeric(14,2) not null default 0,
  received_at    timestamptz not null default now(),
  notes          text,
  qr_token       text unique,
  share_token    text unique,
  signed_by_name text,
  created_by     uuid references auth.users(id) on delete set null,
  created_by_name text,
  is_automatic   boolean not null default false,
  deleted_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (business_id, receipt_number)
);
create index if not exists receipts_business_idx on public.receipts (business_id, received_at desc);
create index if not exists receipts_invoice_idx on public.receipts (invoice_id);
create index if not exists receipts_customer_idx on public.receipts (customer_id, received_at desc);

alter table public.payments
  drop constraint if exists payments_receipt_fk,
  add constraint payments_receipt_fk foreign key (receipt_id)
    references public.receipts(id) on delete set null deferrable initially deferred;

-- ── REFUNDS & RETURNS ─────────────────────────────────────────────────────────
create table if not exists public.returns (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  return_number  text not null,
  order_id       uuid references public.orders(id) on delete set null,
  invoice_id     uuid references public.invoices(id) on delete set null,
  customer_id    uuid references public.customers(id) on delete set null,
  status         public.return_status not null default 'requested',
  reason         text not null,
  reason_code    text,                              -- damaged|wrong_item|not_as_described|late|changed_mind|other
  requested_by   uuid references auth.users(id) on delete set null,
  requested_by_name text,
  reviewed_by    uuid references auth.users(id) on delete set null,
  reviewed_at    timestamptz,
  review_note    text,
  restock        boolean not null default true,     -- return stock to inventory?
  warehouse_id   uuid references public.warehouses(id) on delete set null,
  refund_method  text,                              -- original|cash|credit_note|bank_transfer|store_credit
  refund_amount  numeric(14,2) not null default 0,
  credit_note_id uuid references public.invoices(id) on delete set null,
  images         jsonb not null default '[]'::jsonb,
  resolved_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (business_id, return_number)
);
create index if not exists returns_business_idx on public.returns (business_id, status, created_at desc);
create index if not exists returns_order_idx on public.returns (order_id);

create table if not exists public.return_items (
  id           uuid primary key default gen_random_uuid(),
  return_id    uuid not null references public.returns(id) on delete cascade,
  order_item_id uuid references public.order_items(id) on delete set null,
  product_id   uuid references public.products(id) on delete set null,
  variant_id   uuid references public.product_variants(id) on delete set null,
  name         text not null,
  quantity     integer not null check (quantity > 0),
  unit_price   numeric(14,2) not null default 0,
  refund_amount numeric(14,2) not null default 0,
  condition    text not null default 'sellable',    -- sellable|damaged|defective|missing
  restocked    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists return_items_idx on public.return_items (return_id);

create table if not exists public.refunds (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  payment_id     uuid references public.payments(id) on delete set null,
  invoice_id     uuid references public.invoices(id) on delete set null,
  return_id      uuid references public.returns(id) on delete set null,
  customer_id    uuid references public.customers(id) on delete set null,
  amount         numeric(14,2) not null check (amount > 0),
  currency       text not null default 'ZMW' references public.currencies(code),
  method         public.payment_method not null default 'cash',
  reason         text not null,
  status         public.payment_status not null default 'completed',
  provider_reference text,
  requires_approval boolean not null default true,  -- high-impact → owner approval
  approved_by    uuid references auth.users(id) on delete set null,
  approved_at    timestamptz,
  processed_by   uuid references auth.users(id) on delete set null,
  processed_at   timestamptz not null default now(),
  credit_note_id uuid references public.invoices(id) on delete set null,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists refunds_business_idx on public.refunds (business_id, processed_at desc);
create index if not exists refunds_pending_approval_idx on public.refunds (business_id) where requires_approval and approved_at is null;

-- ── DELIVERY NOTES & PROOF OF DELIVERY ────────────────────────────────────────
create table if not exists public.delivery_notes (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  note_number    text not null,
  order_id       uuid references public.orders(id) on delete set null,
  invoice_id     uuid references public.invoices(id) on delete set null,
  customer_id    uuid references public.customers(id) on delete set null,
  status         text not null default 'draft',     -- draft|in_transit|delivered|failed|returned
  driver_id      uuid references auth.users(id) on delete set null,
  driver_name    text,
  driver_phone   text,
  vehicle        text,
  tracking_code  text unique,
  address        text not null,
  city           text,
  country_code   text not null default 'ZM',
  location       jsonb,
  delivery_fee   numeric(14,2) not null default 0,
  dispatched_at  timestamptz,
  delivered_at   timestamptz,
  recipient_name text,
  recipient_signature_id uuid,                      -- fk added in 0006 (signatures)
  proof_url      text,                              -- photo of delivery
  notes          text,
  share_token    text unique,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (business_id, note_number)
);
create index if not exists delivery_notes_business_idx on public.delivery_notes (business_id, status, created_at desc);
create index if not exists delivery_notes_order_idx on public.delivery_notes (order_id);

create table if not exists public.delivery_note_items (
  id            uuid primary key default gen_random_uuid(),
  delivery_note_id uuid not null references public.delivery_notes(id) on delete cascade,
  order_item_id uuid references public.order_items(id) on delete set null,
  product_id    uuid references public.products(id) on delete set null,
  name          text not null,
  quantity      integer not null check (quantity > 0),
  unit          text not null default 'piece',
  created_at    timestamptz not null default now()
);
create index if not exists delivery_note_items_idx on public.delivery_note_items (delivery_note_id);

-- ── updated_at triggers ───────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'taxes','tax_exemptions','customers','customer_addresses','customer_notes',
    'carts','cart_items','orders','order_items','quotations','quotation_items',
    'invoices','invoice_items','payments','receipts','returns','return_items',
    'refunds','delivery_notes'
  ] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function public.tg_set_updated_at()', t);
  end loop;
end $$;

select 'seedwel_hub: 0005 sales ok' as status;
