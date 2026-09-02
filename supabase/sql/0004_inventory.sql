-- ══════════════════════════════════════════════════════════════════════════════
--  SEEDWEL HUB — 0004 · Inventory: stock per warehouse, movements, transfers,
--                        counts, adjustments, CSV sources & sync logs
-- ══════════════════════════════════════════════════════════════════════════════

-- ── INVENTORY (one row per product/variant per warehouse) ─────────────────────
create table if not exists public.inventory (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  warehouse_id   uuid not null references public.warehouses(id) on delete cascade,
  product_id     uuid not null references public.products(id) on delete cascade,
  variant_id     uuid references public.product_variants(id) on delete cascade,

  quantity_on_hand  integer not null default 0,
  quantity_reserved integer not null default 0,   -- allocated to open orders
  quantity_available integer generated always as (quantity_on_hand - quantity_reserved) stored,
  reorder_point  integer not null default 5,
  reorder_qty    integer not null default 0,
  max_quantity   integer,
  unit_cost      numeric(14,2) not null default 0,
  stock_value    numeric(16,2) generated always as (quantity_on_hand * unit_cost) stored,
  bin_location   text,
  batch_number   text,
  expiry_date    date,
  last_counted_at timestamptz,
  last_movement_at timestamptz,
  created_at     timestamptz not null default now(),
  -- Negative on-hand is allowed only where products.allow_backorder is true;
  -- that rule is enforced in the stock-movement function, not here.
  updated_at     timestamptz not null default now()
);
-- One row per product (or variant) per warehouse. NULLS NOT DISTINCT needs PG15+.
create unique index if not exists inventory_location_uq
  on public.inventory (warehouse_id, product_id, variant_id) nulls not distinct;
create index if not exists inventory_business_idx on public.inventory (business_id, warehouse_id);
create index if not exists inventory_product_idx on public.inventory (product_id);
create index if not exists inventory_low_stock_idx
  on public.inventory (business_id) where quantity_on_hand <= reorder_point;

alter table public.products
  drop constraint if exists products_csv_source_fk;

-- ── INVENTORY MOVEMENTS (immutable ledger — stock value truth) ────────────────
create table if not exists public.inventory_movements (
  id             bigserial primary key,
  business_id    uuid not null references public.businesses(id) on delete cascade,
  warehouse_id   uuid not null references public.warehouses(id) on delete restrict,
  inventory_id   uuid references public.inventory(id) on delete set null,
  product_id     uuid not null references public.products(id) on delete restrict,
  variant_id     uuid references public.product_variants(id) on delete set null,
  movement_type  public.movement_type not null,
  quantity_change integer not null,               -- +in / -out
  quantity_before integer not null,
  quantity_after  integer not null,
  unit_cost      numeric(14,2) not null default 0,
  total_value    numeric(16,2) not null default 0,
  reference_type text,                            -- order|invoice|purchase_order|transfer|count|adjustment|return|csv_sync|pos
  reference_id   uuid,
  reference_number text,                          -- INV-00052, PO-00007
  to_warehouse_id uuid references public.warehouses(id) on delete set null,
  reason         text,
  notes          text,
  performed_by   uuid references auth.users(id) on delete set null,
  performed_name text,
  is_reversal    boolean not null default false,
  reversed_by_id bigint references public.inventory_movements(id),
  created_at     timestamptz not null default now()
);
create index if not exists movements_business_time_idx on public.inventory_movements (business_id, created_at desc);
create index if not exists movements_product_idx on public.inventory_movements (product_id, created_at desc);
create index if not exists movements_warehouse_idx on public.inventory_movements (warehouse_id, created_at desc);
create index if not exists movements_reference_idx on public.inventory_movements (reference_type, reference_id);
create index if not exists movements_type_idx on public.inventory_movements (business_id, movement_type, created_at desc);

-- ── STOCK ADJUSTMENTS (damaged, expired, counted, written off) ────────────────
create table if not exists public.stock_adjustments (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  warehouse_id  uuid not null references public.warehouses(id) on delete restrict,
  adjustment_number text not null,
  reason        text not null,                    -- damaged|expired|theft|count_variance|sample|other
  notes         text,
  status        text not null default 'draft',    -- draft|approved|posted
  total_value   numeric(16,2) not null default 0,
  approved_by   uuid references auth.users(id) on delete set null,
  approved_at   timestamptz,
  created_by    uuid not null references auth.users(id) on delete restrict,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (business_id, adjustment_number)
);

create table if not exists public.stock_adjustment_items (
  id            uuid primary key default gen_random_uuid(),
  adjustment_id uuid not null references public.stock_adjustments(id) on delete cascade,
  product_id    uuid not null references public.products(id) on delete restrict,
  variant_id    uuid references public.product_variants(id) on delete set null,
  quantity_before integer not null default 0,
  quantity_change integer not null,               -- + or -
  quantity_after integer not null default 0,
  unit_cost     numeric(14,2) not null default 0,
  value_change  numeric(16,2) not null default 0,
  reason        text,
  created_at    timestamptz not null default now()
);
create index if not exists adjustment_items_adj_idx on public.stock_adjustment_items (adjustment_id);

-- ── STOCK TRANSFERS (warehouse A → warehouse B / shop → shop) ─────────────────
create table if not exists public.stock_transfers (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses(id) on delete cascade,
  transfer_number  text not null,
  from_warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  to_warehouse_id  uuid not null references public.warehouses(id) on delete restrict,
  status           text not null default 'draft', -- draft|in_transit|received|cancelled
  reference        text,
  notes            text,
  total_items      integer not null default 0,
  total_value      numeric(16,2) not null default 0,
  shipped_at       timestamptz,
  received_at      timestamptz,
  created_by       uuid not null references auth.users(id) on delete restrict,
  received_by      uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (business_id, transfer_number),
  check (from_warehouse_id <> to_warehouse_id)
);

create table if not exists public.stock_transfer_items (
  id             uuid primary key default gen_random_uuid(),
  transfer_id    uuid not null references public.stock_transfers(id) on delete cascade,
  product_id     uuid not null references public.products(id) on delete restrict,
  variant_id     uuid references public.product_variants(id) on delete set null,
  quantity_sent  integer not null default 0 check (quantity_sent >= 0),
  quantity_received integer not null default 0 check (quantity_received >= 0),
  unit_cost      numeric(14,2) not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists transfer_items_transfer_idx on public.stock_transfer_items (transfer_id);

-- ── STOCK COUNTS (cycle counts / stocktakes) ──────────────────────────────────
create table if not exists public.stock_counts (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  warehouse_id   uuid not null references public.warehouses(id) on delete restrict,
  count_number   text not null,
  status         text not null default 'in_progress', -- in_progress|completed|cancelled
  counted_by     uuid references auth.users(id) on delete set null,
  started_at     timestamptz not null default now(),
  completed_at   timestamptz,
  variance_items integer not null default 0,
  variance_value numeric(16,2) not null default 0,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (business_id, count_number)
);

create table if not exists public.stock_count_items (
  id              uuid primary key default gen_random_uuid(),
  count_id        uuid not null references public.stock_counts(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete restrict,
  variant_id      uuid references public.product_variants(id) on delete set null,
  expected_qty    integer not null default 0,
  counted_qty     integer,
  variance        integer generated always as (coalesce(counted_qty,0) - expected_qty) stored,
  unit_cost       numeric(14,2) not null default 0,
  notes           text,
  counted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists count_items_count_idx on public.stock_count_items (count_id);

-- ── CSV SOURCES & SYNCHRONISATION ─────────────────────────────────────────────
-- The seller uploads a CSV, pastes a CSV URL, or (later) connects an external
-- inventory system. The platform maps columns, previews, validates and imports.
create table if not exists public.csv_sources (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  name           text not null,
  kind           text not null default 'upload',   -- upload|url|api|integration
  source_url     text,                             -- remote CSV, polled on schedule
  file_path      text,                             -- storage path of the uploaded CSV
  file_name      text,
  delimiter      text not null default ',',
  has_header     boolean not null default true,
  encoding       text not null default 'utf-8',

  -- Column mapping: target field → source column name/index
  column_mapping jsonb not null default '{}'::jsonb,
  -- {"name":"Product Name","sku":"SKU","price":"Price","stock":"Stock",
  --  "category":"Category","image":"Image URL","description":"Description"}
  transform_rules jsonb not null default '{}'::jsonb,
  -- {"price":{"strip":"K ","type":"number"},"stock":{"type":"integer","default":0}}
  default_values jsonb not null default '{}'::jsonb,
  -- {"currency":"ZMW","category_id":"…","warehouse_id":"…","tax_id":"…"}

  sync_mode      text not null default 'one_time', -- one_time|scheduled
  sync_interval_minutes integer,                    -- e.g. 30
  match_strategy text not null default 'sku',       -- sku|barcode|name|external_id
  on_conflict    text not null default 'update',    -- skip|update|create_new
  update_fields  text[] not null default array['price','stock','description','image'],
  auto_publish   boolean not null default false,
  auto_adjust_stock boolean not null default true,   -- write inventory movements

  is_active      boolean not null default true,
  last_sync_at   timestamptz,
  last_sync_status text,                            -- success|partial|failed|never
  next_sync_at   timestamptz,
  total_syncs    integer not null default 0,
  created_by     uuid not null references auth.users(id) on delete restrict,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists csv_sources_business_idx on public.csv_sources (business_id, is_active);
create index if not exists csv_sources_due_idx on public.csv_sources (next_sync_at)
  where sync_mode = 'scheduled' and is_active;

alter table public.products
  add constraint products_csv_source_fk foreign key (csv_source_id)
    references public.csv_sources(id) on delete set null;

create table if not exists public.sync_logs (
  id             uuid primary key default gen_random_uuid(),
  csv_source_id  uuid not null references public.csv_sources(id) on delete cascade,
  business_id    uuid not null references public.businesses(id) on delete cascade,
  status         text not null default 'running',  -- running|success|partial|failed
  triggered_by   text not null default 'manual',   -- manual|schedule|api
  triggered_user uuid references auth.users(id) on delete set null,

  rows_total     integer not null default 0,
  rows_created   integer not null default 0,
  rows_updated   integer not null default 0,
  rows_skipped   integer not null default 0,
  rows_failed    integer not null default 0,
  stock_changed  integer not null default 0,

  errors         jsonb not null default '[]'::jsonb,
  -- [{"row":12,"field":"price","value":"abc","message":"Not a number"}]
  warnings       jsonb not null default '[]'::jsonb,
  preview        jsonb,                            -- first N parsed rows for the UI
  duration_ms    integer,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists sync_logs_source_idx on public.sync_logs (csv_source_id, started_at desc);
create index if not exists sync_logs_business_idx on public.sync_logs (business_id, started_at desc);

-- ── BARCODE / QR LOOKUPS (scan → product) ─────────────────────────────────────
create table if not exists public.barcode_lookups (
  id           bigserial primary key,
  business_id  uuid not null references public.businesses(id) on delete cascade,
  code         text not null,
  code_type    text not null default 'barcode',    -- barcode|qr
  product_id   uuid references public.products(id) on delete cascade,
  variant_id   uuid references public.product_variants(id) on delete cascade,
  scanned_by   uuid references auth.users(id) on delete set null,
  context      text,                               -- pos|inventory|receiving|lookup
  created_at   timestamptz not null default now()
);
create index if not exists barcode_lookups_business_code_idx on public.barcode_lookups (business_id, code, created_at desc);

-- ── updated_at triggers ───────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'inventory','stock_adjustments','stock_adjustment_items','stock_transfers',
    'stock_transfer_items','stock_counts','stock_count_items','csv_sources','sync_logs'
  ] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function public.tg_set_updated_at()', t);
  end loop;
end $$;

select 'seedwel_hub: 0004 inventory ok' as status;
