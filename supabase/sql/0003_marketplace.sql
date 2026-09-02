-- ══════════════════════════════════════════════════════════════════════════════
--  SEEDWEL HUB — 0003 · Marketplace: categories, stores, products, variants,
--                        media, services, reviews, wishlists, follows, deals
-- ══════════════════════════════════════════════════════════════════════════════

-- ── HELPER: array → text for the search vector ────────────────────────────────
create or replace function public.tags_text(arr text[])
returns text language sql immutable as $$
  select coalesce(array_to_string(arr, ' '), '');
$$;

-- ── CATEGORIES (products & services share one tree) ───────────────────────────
create table if not exists public.categories (
  id           uuid primary key default gen_random_uuid(),
  parent_id    uuid references public.categories(id) on delete cascade,
  name         text not null,
  slug         text not null unique,
  description  text,
  icon         text,                              -- emoji or icon key
  image_url    text,
  kind         text not null default 'product',   -- product | service | both
  path         text not null default '/',         -- materialised: /electronics/phones
  depth        smallint not null default 0,
  sort_order   integer not null default 100,
  is_active    boolean not null default true,
  is_featured  boolean not null default false,
  commission_rate numeric(6,3),                   -- platform take-rate per category
  product_count integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists categories_parent_idx on public.categories (parent_id, sort_order);
create index if not exists categories_kind_idx on public.categories (kind) where is_active;
create index if not exists categories_path_idx on public.categories (path text_pattern_ops);
create index if not exists categories_name_trgm_idx on public.categories using gin (name gin_trgm_ops);

alter table public.businesses
  drop constraint if exists businesses_category_fk,
  add constraint businesses_category_fk foreign key (category_id)
    references public.categories(id) on delete set null;

-- ── STORES (the automatic online store created on seller registration) ────────
create table if not exists public.stores (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null unique references public.businesses(id) on delete cascade,
  slug          text not null unique,            -- seedwelhub.com/store/<slug>
  name          text not null,
  tagline       text,
  description   text,
  logo_url      text,
  banner_url    text,
  theme         text not null default 'modern',
  primary_color text not null default '#0f766e',
  accent_color  text not null default '#f59e0b',
  font_family   text not null default 'Inter',
  layout        text not null default 'grid',    -- grid | list | catalog
  show_prices   boolean not null default true,
  show_stock    boolean not null default true,
  allow_reviews boolean not null default true,
  allow_wishlist boolean not null default true,
  allow_enquiries boolean not null default true,
  allow_checkout boolean not null default true,
  custom_domain text,
  domain_status text not null default 'none',    -- none|pending|verified|failed
  featured_categories uuid[] not null default '{}',
  featured_product_ids  uuid[] not null default '{}',
  announcement  text,
  social        jsonb not null default '{}'::jsonb,
  contact_email text,
  contact_phone text,
  whatsapp      text,
  seo_title     text,
  seo_description text,
  seo_keywords  text[],
  is_published  boolean not null default true,
  password      text,                            -- optional private-store password hash
  view_count    integer not null default 0,
  rating_avg    numeric(3,2) not null default 0,
  rating_count  integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
create index if not exists stores_published_idx on public.stores (is_published) where is_published;

-- ── PRODUCTS ──────────────────────────────────────────────────────────────────
create table if not exists public.products (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  store_id       uuid references public.stores(id) on delete set null,
  branch_id      uuid references public.branches(id) on delete set null,
  created_by     uuid references auth.users(id) on delete set null,

  name           text not null,
  slug           text not null,
  sku            text,
  barcode        text,                            -- EAN/UPC/Code128 value
  barcode_format text not null default 'code128', -- code128|ean13|upca|qr
  description    text,
  short_description text,
  brand          text,
  model          text,
  category_id    uuid references public.categories(id) on delete set null,
  tags           text[] not null default '{}',

  product_type   public.product_type not null default 'product',
  condition      public.product_condition not null default 'new',
  status         public.product_status not null default 'draft',
  is_published   boolean not null default false,
  is_featured    boolean not null default false,
  is_wholesale   boolean not null default false,
  is_digital     boolean not null default false,
  is_taxable     boolean not null default true,
  tax_id         uuid,                            -- fk added in 0005 (taxes)

  -- Money (base currency of the business)
  currency       text not null default 'ZMW' references public.currencies(code),
  price          numeric(14,2) not null default 0 check (price >= 0),
  compare_at_price numeric(14,2) check (compare_at_price is null or compare_at_price >= 0),
  cost_price     numeric(14,2) not null default 0 check (cost_price >= 0),
  wholesale_price numeric(14,2) check (wholesale_price >= 0),
  wholesale_min_qty integer not null default 1 check (wholesale_min_qty > 0),
  discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100),

  -- Inventory (aggregate; per-location rows live in inventory)
  stock          integer not null default 0,
  stock_alert    integer not null default 5,
  stock_max      integer,
  allow_backorder boolean not null default false,
  track_inventory boolean not null default true,

  -- Logistics
  weight_kg      numeric(10,3),
  length_cm      numeric(10,2),
  width_cm       numeric(10,2),
  height_cm      numeric(10,2),
  requires_delivery boolean not null default true,
  delivery_days  smallint,
  warranty       text,
  unit           text not null default 'piece',   -- piece|kg|litre|metre|box|bag|pack|hour|day|job

  -- Variants
  has_variants   boolean not null default false,
  variant_options jsonb not null default '[]'::jsonb,
  -- [{ "name":"Size", "values":["S","M","L"] }, { "name":"Color", "values":["Black"] }]

  -- Services
  service_duration_minutes integer,
  service_area   text,
  is_quotation_only boolean not null default false,   -- "Contact for price"

  media          jsonb not null default '[]'::jsonb,
  -- [{ url, type:'image'|'video', alt, position, thumb_url }]
  primary_image_url text,

  -- Search
  search_vector  tsvector generated always as (
      setweight(to_tsvector('english', coalesce(name,'')), 'A')
   || setweight(to_tsvector('english', coalesce(brand,'')), 'B')
   || setweight(to_tsvector('english', coalesce(sku,'')), 'B')
   || setweight(to_tsvector('english', coalesce(tags_text(tags),'')), 'B')
   || setweight(to_tsvector('english', coalesce(short_description,'')), 'C')
   || setweight(to_tsvector('english', coalesce(description,'')), 'D')
  ) stored,

  -- CSV import provenance
  source         text not null default 'manual',  -- manual|csv|ai|api|external
  external_id    text,
  csv_source_id  uuid,                            -- fk added in 0004
  last_synced_at timestamptz,

  view_count     integer not null default 0,
  sold_count     integer not null default 0,
  rating_avg     numeric(3,2) not null default 0,
  rating_count   integer not null default 0,
  min_purchase_qty integer not null default 1,
  max_purchase_qty integer,
  published_at   timestamptz,
  deleted_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (business_id, sku),
  unique (store_id, slug)
);

create index if not exists products_business_idx on public.products (business_id, status);
create index if not exists products_store_idx on public.products (store_id) where deleted_at is null;
create index if not exists products_category_idx on public.products (category_id) where deleted_at is null;
create index if not exists products_search_idx on public.products using gin (search_vector);
create index if not exists products_name_trgm_idx on public.products using gin (name gin_trgm_ops);
create index if not exists products_barcode_idx on public.products (barcode) where barcode is not null;
create index if not exists products_sku_idx on public.products (sku) where sku is not null;
create index if not exists products_price_idx on public.products (price);
create index if not exists products_marketplace_idx
  on public.products (is_published, is_featured desc, sold_count desc)
  where deleted_at is null and is_published;
create index if not exists products_low_stock_idx
  on public.products (business_id, stock)
  where deleted_at is null and track_inventory;

-- ── PRODUCT VARIANTS ──────────────────────────────────────────────────────────
create table if not exists public.product_variants (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references public.products(id) on delete cascade,
  sku           text,
  barcode       text,
  name          text not null,                    -- "Black / XL"
  option_values jsonb not null default '{}'::jsonb, -- {"Size":"XL","Color":"Black"}
  price         numeric(14,2) check (price >= 0),
  compare_at_price numeric(14,2),
  cost_price    numeric(14,2) not null default 0,
  wholesale_price numeric(14,2),
  stock         integer not null default 0,
  stock_alert   integer not null default 0,
  weight_kg     numeric(10,3),
  image_url     text,
  is_active     boolean not null default true,
  is_default    boolean not null default false,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (product_id, sku),
  unique (product_id, barcode)
);
create index if not exists product_variants_product_idx on public.product_variants (product_id, is_active);

-- ── SERVICES (bookable / professional offerings) ──────────────────────────────
create table if not exists public.services (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  store_id       uuid references public.stores(id) on delete set null,
  name           text not null,
  slug           text not null,
  description    text,
  category_id    uuid references public.categories(id) on delete set null,
  service_type   text not null default 'fixed',   -- fixed|hourly|daily|per_job|quote
  price          numeric(14,2) not null default 0,
  currency       text not null default 'ZMW' references public.currencies(code),
  min_price      numeric(14,2),
  max_price      numeric(14,2),
  duration_minutes integer,
  unit           text not null default 'job',     -- hour|day|job|visit|session|km
  coverage_area  text,
  travel_radius_km numeric(8,2),
  is_remote      boolean not null default false,
  media          jsonb not null default '[]'::jsonb,
  primary_image_url text,
  tags           text[] not null default '{}',
  search_vector  tsvector generated always as (
      setweight(to_tsvector('english', coalesce(name,'')), 'A')
   || setweight(to_tsvector('english', coalesce(tags_text(tags),'')), 'B')
   || setweight(to_tsvector('english', coalesce(description,'')), 'C')
  ) stored,
  status         public.product_status not null default 'draft',
  is_published   boolean not null default false,
  rating_avg     numeric(3,2) not null default 0,
  rating_count   integer not null default 0,
  jobs_completed integer not null default 0,
  view_count     integer not null default 0,
  deleted_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (business_id, slug)
);
create index if not exists services_business_idx on public.services (business_id, is_published);
create index if not exists services_search_idx on public.services using gin (search_vector);
create index if not exists services_category_idx on public.services (category_id) where is_published;

-- ── REVIEWS (products, services and businesses) ───────────────────────────────
create table if not exists public.reviews (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  product_id     uuid references public.products(id) on delete cascade,
  service_id     uuid references public.services(id) on delete cascade,
  order_id       uuid,                            -- fk added in 0004 (orders)
  reviewer_id    uuid not null references auth.users(id) on delete cascade,
  reviewer_name  text not null,
  target_type    text not null default 'product', -- product|service|business
  rating         smallint not null check (rating between 1 and 5),
  title          text,
  body           text,
  images         jsonb not null default '[]'::jsonb,
  is_verified_purchase boolean not null default false,
  helpful_count  integer not null default 0,
  seller_reply   text,
  seller_reply_at timestamptz,
  status         text not null default 'published', -- published|hidden|reported|removed
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (reviewer_id, product_id),
  unique (reviewer_id, service_id),
  check (
    (target_type = 'product' and product_id is not null) or
    (target_type = 'service' and service_id is not null) or
    (target_type = 'business' and (product_id is null and service_id is null))
  )
);
create index if not exists reviews_product_idx on public.reviews (product_id, status, created_at desc);
create index if not exists reviews_service_idx on public.reviews (service_id, status, created_at desc);
create index if not exists reviews_business_idx on public.reviews (business_id, target_type, status, created_at desc);
create index if not exists reviews_reviewer_idx on public.reviews (reviewer_id);

-- ── WISHLISTS & FOLLOWS ───────────────────────────────────────────────────────
create table if not exists public.wishlist_items (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  product_id   uuid references public.products(id) on delete cascade,
  service_id   uuid references public.services(id) on delete cascade,
  business_id  uuid references public.businesses(id) on delete cascade,
  note         text,
  price_at_save numeric(14,2),
  notify_on_price_drop boolean not null default true,
  notify_on_back_in_stock boolean not null default true,
  created_at   timestamptz not null default now(),
  check (product_id is not null or service_id is not null or business_id is not null)
);
create unique index if not exists wishlist_user_product_uq on public.wishlist_items (user_id, product_id) where product_id is not null;
create unique index if not exists wishlist_user_service_uq on public.wishlist_items (user_id, service_id) where service_id is not null;
create unique index if not exists wishlist_user_business_uq on public.wishlist_items (user_id, business_id) where business_id is not null;

create table if not exists public.follows (
  id           uuid primary key default gen_random_uuid(),
  follower_id  uuid not null references auth.users(id) on delete cascade,
  business_id  uuid not null references public.businesses(id) on delete cascade,
  notify_new_products boolean not null default true,
  notify_deals boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (follower_id, business_id)
);
create index if not exists follows_business_idx on public.follows (business_id);

-- ── DEALS / FLASH SALES ───────────────────────────────────────────────────────
create table if not exists public.deals (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  product_id    uuid references public.products(id) on delete cascade,
  category_id   uuid references public.categories(id) on delete cascade,
  title         text not null,
  description   text,
  deal_type     text not null default 'discount',  -- discount|flash|bundle|bogo|clearance
  discount_percent numeric(5,2),
  discount_amount numeric(14,2),
  deal_price    numeric(14,2),
  min_qty       integer,
  quantity_limit integer,                           -- per customer
  total_quantity integer,                           -- stock allocated to the deal
  sold_quantity integer not null default 0,
  starts_at     timestamptz not null default now(),
  ends_at       timestamptz,
  is_platform_featured boolean not null default false,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists deals_active_idx on public.deals (is_active, starts_at, ends_at);
create index if not exists deals_product_idx on public.deals (product_id) where is_active;

-- ── TRENDING / RECOMMENDATIONS ────────────────────────────────────────────────
create table if not exists public.product_stats (
  product_id     uuid primary key references public.products(id) on delete cascade,
  views_7d       integer not null default 0,
  views_30d      integer not null default 0,
  orders_7d      integer not null default 0,
  orders_30d     integer not null default 0,
  revenue_30d    numeric(14,2) not null default 0,
  wishlist_count integer not null default 0,
  search_impressions integer not null default 0,
  trending_score numeric(10,4) not null default 0,
  computed_at    timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists product_stats_trending_idx on public.product_stats (trending_score desc);

-- ── updated_at triggers ───────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'categories','stores','products','product_variants','services','reviews',
    'deals','product_stats'
  ] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function public.tg_set_updated_at()', t);
  end loop;
end $$;

select 'seedwel_hub: 0003 marketplace ok' as status;
