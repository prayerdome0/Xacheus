-- ══════════════════════════════════════════════════════════════════════════════
--  SEEDWEL HUB — 0006 · Suppliers, purchasing, bills & expenses (finance)
--
--  Purchasing workflow:
--    Purchase Order → Supplier → Goods Received → Inventory Updated
--                 → Supplier Bill → Payment
-- ══════════════════════════════════════════════════════════════════════════════

-- ── SUPPLIERS ─────────────────────────────────────────────────────────────────
create table if not exists public.suppliers (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  user_id        uuid references auth.users(id) on delete set null,  -- if they are also a Seedwel seller
  supplier_number text,
  name           text not null,
  company_name   text,
  contact_person text,
  email          text,
  phone          text,
  phone_country_code text not null default '+260',
  whatsapp       text,
  website        text,
  tax_number     text,
  address_line1  text,
  address_line2  text,
  city           text,
  region         text,
  country_code   text not null default 'ZM' references public.countries(code),
  currency       text not null default 'ZMW' references public.currencies(code),
  payment_terms_days smallint not null default 30,
  credit_limit   numeric(14,2) not null default 0,
  bank_details   jsonb not null default '{}'::jsonb,
  lead_time_days smallint,
  min_order_value numeric(14,2),
  rating         smallint,
  notes          text,
  tags           text[] not null default '{}',
  is_active      boolean not null default true,

  -- Denormalised totals (maintained by 0008 triggers)
  orders_count   integer not null default 0,
  total_purchased numeric(16,2) not null default 0,
  outstanding_amount numeric(16,2) not null default 0,
  last_order_at  timestamptz,
  created_by     uuid references auth.users(id) on delete set null,
  deleted_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (business_id, supplier_number)
);
create index if not exists suppliers_business_idx on public.suppliers (business_id, is_active) where deleted_at is null;
create index if not exists suppliers_name_trgm_idx on public.suppliers using gin (name gin_trgm_ops);
create index if not exists suppliers_outstanding_idx on public.suppliers (business_id, outstanding_amount desc);

-- Which products each supplier provides, at what cost.
create table if not exists public.supplier_products (
  id             uuid primary key default gen_random_uuid(),
  supplier_id    uuid not null references public.suppliers(id) on delete cascade,
  product_id     uuid not null references public.products(id) on delete cascade,
  supplier_sku   text,
  unit_cost      numeric(14,2) not null default 0,
  min_order_qty  integer not null default 1,
  lead_time_days smallint,
  is_preferred   boolean not null default false,
  currency       text not null default 'ZMW' references public.currencies(code),
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (supplier_id, product_id)
);
create index if not exists supplier_products_product_idx on public.supplier_products (product_id);

alter table public.payments
  drop constraint if exists payments_supplier_fk,
  add constraint payments_supplier_fk foreign key (supplier_id)
    references public.suppliers(id) on delete set null;

-- ── PURCHASE ORDERS ───────────────────────────────────────────────────────────
create table if not exists public.purchase_orders (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  po_number      text not null,
  supplier_id    uuid not null references public.suppliers(id) on delete restrict,
  warehouse_id   uuid references public.warehouses(id) on delete set null,  -- receiving location
  branch_id      uuid references public.branches(id) on delete set null,
  status         text not null default 'draft',
  -- draft|sent|acknowledged|partially_received|received|billed|paid|cancelled
  currency       text not null default 'ZMW' references public.currencies(code),
  exchange_rate  numeric(18,8) not null default 1,
  subtotal       numeric(14,2) not null default 0,
  discount_total numeric(14,2) not null default 0,
  tax_total      numeric(14,2) not null default 0,
  delivery_fee   numeric(14,2) not null default 0,
  total          numeric(14,2) not null default 0,
  amount_paid    numeric(14,2) not null default 0,
  balance_due    numeric(14,2) generated always as (total - amount_paid) stored,
  order_date     date not null default current_date,
  expected_date  date,
  received_at    timestamptz,
  terms          text,
  notes          text,
  supplier_reference text,
  bill_id        uuid,                             -- fk added below (supplier_bills)
  signature_id   uuid,                             -- fk added in 0007
  signed_at      timestamptz,
  share_token    text unique,
  created_by     uuid not null references auth.users(id) on delete restrict,
  created_by_name text,
  approved_by    uuid references auth.users(id) on delete set null,
  approved_at    timestamptz,
  requires_approval boolean not null default true, -- high-impact: spending money
  sent_at        timestamptz,
  deleted_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (business_id, po_number)
);
create index if not exists purchase_orders_business_idx on public.purchase_orders (business_id, status, order_date desc);
create index if not exists purchase_orders_supplier_idx on public.purchase_orders (supplier_id, created_at desc);
create index if not exists purchase_orders_awaiting_idx
  on public.purchase_orders (business_id, expected_date)
  where status in ('sent','acknowledged','partially_received');
create index if not exists purchase_orders_approval_idx
  on public.purchase_orders (business_id) where requires_approval and approved_at is null;

create table if not exists public.purchase_items (
  id             uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  product_id     uuid references public.products(id) on delete set null,
  variant_id     uuid references public.product_variants(id) on delete set null,
  description    text not null,
  supplier_sku   text,
  quantity_ordered integer not null check (quantity_ordered > 0),
  quantity_received integer not null default 0 check (quantity_received >= 0),
  quantity_rejected integer not null default 0 check (quantity_rejected >= 0),
  unit           text not null default 'piece',
  unit_cost      numeric(14,2) not null default 0,
  tax_rate       numeric(6,3) not null default 0,
  tax_amount     numeric(14,2) not null default 0,
  discount_amount numeric(14,2) not null default 0,
  line_total     numeric(14,2) not null default 0,
  received_at    timestamptz,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists purchase_items_po_idx on public.purchase_items (purchase_order_id);
create index if not exists purchase_items_product_idx on public.purchase_items (product_id);

-- Goods received note (GRN) — receiving updates inventory.
create table if not exists public.goods_received (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  grn_number     text not null,
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  supplier_id    uuid references public.suppliers(id) on delete set null,
  warehouse_id   uuid not null references public.warehouses(id) on delete restrict,
  status         text not null default 'received',  -- received|inspected|accepted|rejected|partial
  received_at    timestamptz not null default now(),
  received_by    uuid references auth.users(id) on delete set null,
  received_by_name text,
  delivery_note_ref text,
  condition_notes text,
  signature_id   uuid,                              -- fk added in 0007
  total_items    integer not null default 0,
  total_value    numeric(16,2) not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (business_id, grn_number)
);
create index if not exists goods_received_po_idx on public.goods_received (purchase_order_id);
create index if not exists goods_received_business_idx on public.goods_received (business_id, received_at desc);

create table if not exists public.goods_received_items (
  id             uuid primary key default gen_random_uuid(),
  goods_received_id uuid not null references public.goods_received(id) on delete cascade,
  purchase_item_id uuid references public.purchase_items(id) on delete set null,
  product_id     uuid references public.products(id) on delete set null,
  variant_id     uuid references public.product_variants(id) on delete set null,
  name           text not null,
  quantity_ordered integer not null default 0,
  quantity_received integer not null default 0,
  quantity_rejected integer not null default 0,
  unit_cost      numeric(14,2) not null default 0,
  batch_number   text,
  expiry_date    date,
  bin_location   text,
  condition      text not null default 'good',      -- good|damaged|expired|wrong_item
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists goods_received_items_idx on public.goods_received_items (goods_received_id);

-- ── SUPPLIER BILLS (accounts payable) ─────────────────────────────────────────
create table if not exists public.supplier_bills (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  bill_number    text not null,
  supplier_id    uuid not null references public.suppliers(id) on delete restrict,
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  goods_received_id uuid references public.goods_received(id) on delete set null,
  supplier_invoice_ref text,
  status         public.doc_status not null default 'draft',
  currency       text not null default 'ZMW' references public.currencies(code),
  exchange_rate  numeric(18,8) not null default 1,
  subtotal       numeric(14,2) not null default 0,
  tax_total      numeric(14,2) not null default 0,
  discount_total numeric(14,2) not null default 0,
  total          numeric(14,2) not null default 0,
  amount_paid    numeric(14,2) not null default 0,
  balance_due    numeric(14,2) generated always as (total - amount_paid) stored,
  bill_date      date not null default current_date,
  due_date       date,
  paid_at        timestamptz,
  terms_days     smallint not null default 30,
  notes          text,
  attachment_url text,
  created_by     uuid references auth.users(id) on delete set null,
  deleted_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (business_id, bill_number)
);
create index if not exists supplier_bills_business_idx on public.supplier_bills (business_id, status, due_date);
create index if not exists supplier_bills_supplier_idx on public.supplier_bills (supplier_id, bill_date desc);
create index if not exists supplier_bills_payable_idx
  on public.supplier_bills (business_id, due_date)
  where status in ('sent','viewed','partially_paid','approved');

alter table public.purchase_orders
  drop constraint if exists purchase_orders_bill_fk,
  add constraint purchase_orders_bill_fk foreign key (bill_id)
    references public.supplier_bills(id) on delete set null;

-- ── EXPENSES ──────────────────────────────────────────────────────────────────
create table if not exists public.expense_categories (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  name         text not null,
  icon         text,
  color        text,
  account_code text,
  is_system    boolean not null default false,
  budget_monthly numeric(14,2),
  sort_order   integer not null default 100,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (business_id, name)
);
create index if not exists expense_categories_business_idx on public.expense_categories (business_id, is_active);

create table if not exists public.expenses (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  branch_id      uuid references public.branches(id) on delete set null,
  warehouse_id   uuid references public.warehouses(id) on delete set null,
  category_id    uuid references public.expense_categories(id) on delete set null,
  supplier_id    uuid references public.suppliers(id) on delete set null,
  expense_number text,
  title          text not null,
  description    text,
  amount         numeric(14,2) not null check (amount >= 0),
  tax_amount     numeric(14,2) not null default 0,
  currency       text not null default 'ZMW' references public.currencies(code),
  exchange_rate  numeric(18,8) not null default 1,
  amount_base    numeric(14,2) not null default 0,
  method         public.payment_method not null default 'cash',
  status         text not null default 'recorded',  -- recorded|pending_approval|approved|rejected|reimbursed|recurring
  expense_date   date not null default current_date,
  is_reimbursable boolean not null default false,
  reimbursed_at  timestamptz,
  is_recurring   boolean not null default false,
  recurrence     text,                              -- weekly|monthly|quarterly|annual
  attachment_urls jsonb not null default '[]'::jsonb,  -- receipt/evidence uploads
  receipt_url    text,
  reference      text,
  approved_by    uuid references auth.users(id) on delete set null,
  approved_at    timestamptz,
  requires_approval boolean not null default false,
  created_by     uuid not null references auth.users(id) on delete restrict,
  created_by_name text,
  notes          text,
  deleted_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (business_id, expense_number)
);
create index if not exists expenses_business_idx on public.expenses (business_id, expense_date desc);
create index if not exists expenses_category_idx on public.expenses (business_id, category_id, expense_date desc);
create index if not exists expenses_branch_idx on public.expenses (branch_id, expense_date desc);
create index if not exists expenses_status_idx on public.expenses (business_id, status);
create index if not exists expenses_approval_idx on public.expenses (business_id) where requires_approval and approved_at is null;

-- ── FINANCIAL RECORDS (period snapshots powering reports) ─────────────────────
create table if not exists public.financial_records (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  branch_id    uuid references public.branches(id) on delete cascade,
  period_start date not null,
  period_end   date not null,
  granularity  text not null default 'day',         -- day|week|month|quarter|year
  currency     text not null default 'ZMW',
  revenue      numeric(16,2) not null default 0,
  cogs         numeric(16,2) not null default 0,
  gross_profit numeric(16,2) not null default 0,
  expenses     numeric(16,2) not null default 0,
  net_profit   numeric(16,2) not null default 0,
  tax_collected numeric(16,2) not null default 0,
  tax_paid     numeric(16,2) not null default 0,
  discounts    numeric(16,2) not null default 0,
  refunds      numeric(16,2) not null default 0,
  payments_received numeric(16,2) not null default 0,
  receivables  numeric(16,2) not null default 0,
  payables     numeric(16,2) not null default 0,
  orders_count integer not null default 0,
  customers_count integer not null default 0,
  stock_value  numeric(16,2) not null default 0,
  breakdown    jsonb not null default '{}'::jsonb,  -- by category, product, method…
  -- coalesce() is not immutable, so a sentinel generated column gives us the
  -- "per branch (or business-wide)" uniqueness key we need for upserts.
  branch_scope uuid generated always as
                 (coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored,
  computed_at  timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (business_id, branch_scope, period_start, granularity)
);
create index if not exists financial_records_business_idx
  on public.financial_records (business_id, granularity, period_start desc);

-- ── DEFAULT EXPENSE CATEGORIES for new businesses (applied by trigger 0008) ───
create table if not exists public.expense_category_templates (
  key          text primary key,
  name         text not null,
  icon         text not null default '🧾',
  sort_order   integer not null default 100
);
insert into public.expense_category_templates (key, name, icon, sort_order) values
  ('rent','Rent','🏠',1),
  ('salaries','Salaries & Wages','👥',2),
  ('transport','Transport','🚚',3),
  ('fuel','Fuel','⛽',4),
  ('electricity','Electricity','💡',5),
  ('water','Water','🚰',6),
  ('internet','Internet & Airtime','📶',7),
  ('advertising','Advertising & Marketing','📣',8),
  ('packaging','Packaging','📦',9),
  ('repairs','Repairs & Maintenance','🔧',10),
  ('supplies','Office & Shop Supplies','🖇️',11),
  ('bank_charges','Bank & Mobile Money Charges','🏦',12),
  ('licenses','Licences & Permits','📜',13),
  ('taxes','Taxes & Duties','🧾',14),
  ('insurance','Insurance','🛡️',15),
  ('training','Training','🎓',16),
  ('other','Other','➕',99)
on conflict (key) do update set name = excluded.name, icon = excluded.icon, sort_order = excluded.sort_order;

-- ── updated_at triggers ───────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'suppliers','supplier_products','purchase_orders','purchase_items',
    'goods_received','goods_received_items','supplier_bills','expense_categories',
    'expenses','financial_records'
  ] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function public.tg_set_updated_at()', t);
  end loop;
end $$;

select 'seedwel_hub: 0006 purchasing & finance ok' as status;
