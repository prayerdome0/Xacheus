-- ══════════════════════════════════════════════════════════════════════════════
--  SEEDWEL HUB — 0002 · Identity: profiles, sessions, security, businesses,
--                        members, roles & granular permissions, branches,
--                        warehouses, verification
-- ══════════════════════════════════════════════════════════════════════════════

-- ── PROFILES (extends auth.users — one account, multiple roles) ───────────────
create table if not exists public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  email            text not null,
  phone            text,
  phone_country_code text not null default '+260',
  full_name        text,
  display_name     text,
  avatar_url       text,
  country_code     text not null default 'ZM' references public.countries(code),
  language         text not null default 'en',
  currency         text not null default 'ZMW' references public.currencies(code),
  time_zone        text not null default 'Africa/Lusaka',

  -- A single person can hold several roles at once (buyer + seller + owner …).
  roles            public.user_role[] not null default array['buyer']::public.user_role[],
  primary_role     public.user_role not null default 'buyer',

  -- Business identity when acting as a supplier / service provider.
  headline         text,                     -- "Graphic designer · Lusaka"
  bio              text,
  website          text,
  social           jsonb not null default '{}'::jsonb,   -- {facebook,whatsapp,instagram,tiktok,x,youtube,linkedin}
  address_line1    text,
  address_line2    text,
  city             text,
  region           text,
  postal_code      text,
  location         jsonb,                    -- {lat,lng} for "near me" discovery
  default_business uuid,                     -- set once a business is created

  email_verified_at   timestamptz,
  phone_verified_at   timestamptz,
  two_factor_enabled  boolean not null default false,
  is_platform_admin   boolean not null default false,    -- Seedwel Hub staff
  is_suspended        boolean not null default false,
  marketing_opt_in    boolean not null default true,
  onboarding_completed_at timestamptz,
  last_seen_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists profiles_email_idx on public.profiles (email);
create index if not exists profiles_phone_idx on public.profiles (phone);
create index if not exists profiles_name_trgm_idx on public.profiles using gin (full_name gin_trgm_ops);
create index if not exists profiles_country_idx on public.profiles (country_code);

-- ── SESSIONS / LOGIN HISTORY (security module) ────────────────────────────────
create table if not exists public.login_history (
  id           bigserial primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  ip_address   inet,
  user_agent   text,
  device       text,
  location     text,
  method       text not null default 'password',  -- password | magic_link | oauth | refresh | recovery
  success      boolean not null default true,
  failure_reason text,
  created_at   timestamptz not null default now()
);
create index if not exists login_history_user_idx on public.login_history (user_id, created_at desc);

create table if not exists public.active_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  refresh_token_hash text not null,
  ip_address    inet,
  user_agent    text,
  device_label  text,
  is_current    boolean not null default false,
  last_active_at timestamptz not null default now(),
  expires_at    timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists active_sessions_user_idx on public.active_sessions (user_id, revoked_at);

create table if not exists public.two_factor_secrets (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  secret       text not null,
  is_confirmed boolean not null default false,
  backup_codes text[] not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ── BUSINESSES ────────────────────────────────────────────────────────────────
create table if not exists public.businesses (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references auth.users(id) on delete restrict,
  name              text not null,
  slug              text not null unique,          -- seedwelhub.com/store/<slug>
  legal_name        text,
  logo_url          text,
  cover_url         text,
  description       text,
  tagline           text,
  category_id       uuid,                          -- fk added in 0003 (categories)
  business_type     public.business_type not null default 'sole_proprietorship',
  registration_number text,                        -- PACRA / company reg no.
  tax_number        text,
  tax_registered    boolean not null default false,

  email             text,
  phone             text,
  phone_country_code text not null default '+260',
  whatsapp          text,
  website           text,
  social            jsonb not null default '{}'::jsonb,

  address_line1     text,
  address_line2     text,
  city              text,
  region            text,
  postal_code       text,
  country_code      text not null default 'ZM' references public.countries(code),
  location          jsonb,                         -- {lat,lng}
  map_url           text,
  opening_hours     jsonb not null default '{}'::jsonb,
  -- { "mon": {"open":"08:00","close":"17:00","closed":false}, ... }

  base_currency     text not null default 'ZMW' references public.currencies(code),
  fiscal_year_start smallint not null default 1,   -- month 1-12
  time_zone         text not null default 'Africa/Lusaka',
  locale            text not null default 'en-ZM',

  -- Store / brand customisation (the "automatic online store")
  primary_color     text not null default '#0f766e',
  accent_color      text not null default '#f59e0b',
  custom_domain     text,
  domain_verified_at timestamptz,
  store_theme       text not null default 'modern',

  -- Document numbering prefixes
  invoice_prefix    text not null default 'INV',
  quotation_prefix  text not null default 'QTN',
  receipt_prefix    text not null default 'RCP',
  order_prefix      text not null default 'ORD',
  po_prefix         text not null default 'PO',
  credit_note_prefix text not null default 'CN',
  debit_note_prefix text not null default 'DN',
  next_invoice_number  integer not null default 1,
  next_quotation_number integer not null default 1,
  next_receipt_number   integer not null default 1,
  next_order_number     integer not null default 1,
  next_po_number        integer not null default 1,
  next_credit_note_number integer not null default 1,
  next_debit_note_number  integer not null default 1,

  invoice_terms     text,
  invoice_footer    text,
  quotation_validity_days smallint not null default 14,
  payment_terms_days smallint not null default 7,
  default_tax_id    uuid,                          -- fk added in 0005 (taxes)
  bank_details      jsonb not null default '{}'::jsonb,
  -- { bank, branch, account_name, account_number, swift, mobile_money: [{provider,number,name}] }

  verification_status public.verification_status not null default 'unverified',
  verified_at       timestamptz,
  badges            text[] not null default '{}'::text[],
  -- verified | trusted_seller | premium_business | established_business
  is_featured       boolean not null default false,
  is_public         boolean not null default true, -- listed in the marketplace
  accepts_orders    boolean not null default true,
  accepts_wholesale boolean not null default false,
  delivery_enabled  boolean not null default false,
  delivery_radius_km numeric(8,2),
  delivery_fee      numeric(14,2) not null default 0,
  free_delivery_over numeric(14,2),

  rating_avg        numeric(3,2) not null default 0,
  rating_count      integer not null default 0,
  sales_count       integer not null default 0,
  response_time_minutes integer,
  growth_score      smallint not null default 0,   -- 0-100 internal readiness score
  response_rate     smallint not null default 0,

  member_count      integer not null default 1,
  product_count     integer not null default 0,
  joined_at         timestamptz not null default now(),
  suspended_at      timestamptz,
  suspension_reason text,
  deleted_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  check (rating_avg >= 0 and rating_avg <= 5)
);

create index if not exists businesses_owner_idx on public.businesses (owner_id);
create index if not exists businesses_country_idx on public.businesses (country_code) where deleted_at is null;
create index if not exists businesses_public_idx on public.businesses (is_public, is_featured, rating_avg desc) where deleted_at is null;
create index if not exists businesses_name_trgm_idx on public.businesses using gin (name gin_trgm_ops);
create index if not exists businesses_city_idx on public.businesses (city) where deleted_at is null;

-- ── BUSINESS VERIFICATION ─────────────────────────────────────────────────────
create table if not exists public.business_verifications (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  submitted_by   uuid not null references auth.users(id) on delete restrict,
  reviewed_by    uuid references auth.users(id) on delete set null,
  status         public.verification_status not null default 'submitted',
  documents      jsonb not null default '[]'::jsonb,
  -- [{type:'registration_certificate', name, url, uploaded_at}]
  notes          text,
  rejection_reason text,
  submitted_at   timestamptz not null default now(),
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists business_verifications_business_idx
  on public.business_verifications (business_id, submitted_at desc);
create index if not exists business_verifications_status_idx
  on public.business_verifications (status, submitted_at);

-- ── ROLES & GRANULAR PERMISSIONS ──────────────────────────────────────────────
-- Permissions are strings checked by the app and by RLS, e.g.
--   products.read / products.write / inventory.adjust / invoices.create
--   receipts.create / expenses.read / reports.read / settings.write …
-- A cashier can hold receipts.create but NOT expenses.read.
create table if not exists public.roles (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid references public.businesses(id) on delete cascade,  -- null = system role
  key          text not null,                     -- owner|administrator|manager|…
  name         text not null,
  description  text,
  is_system    boolean not null default false,
  permissions  text[] not null default '{}'::text[],
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (business_id, key)
);

create table if not exists public.business_members (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          public.member_role not null default 'salesperson',
  custom_role_id uuid references public.roles(id) on delete set null,
  status        public.member_status not null default 'invited',
  job_title     text,
  phone         text,
  email         text,
  branch_id     uuid,                             -- fk added below (branches)
  permissions_override text[] not null default '{}'::text[],
  denied_permissions   text[] not null default '{}'::text[],
  can_approve_ai_actions boolean not null default false,
  invited_by    uuid references auth.users(id) on delete set null,
  invited_at    timestamptz not null default now(),
  joined_at     timestamptz,
  last_active_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (business_id, user_id)
);
create index if not exists business_members_user_idx on public.business_members (user_id, status);
create index if not exists business_members_business_idx on public.business_members (business_id, status);

-- ── BRANCHES (head office, branch 1, branch 2 …) ──────────────────────────────
create table if not exists public.branches (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  name          text not null,
  code          text,
  kind          text not null default 'branch',    -- head_office|branch|shop|warehouse
  is_primary    boolean not null default false,
  email         text,
  phone         text,
  address_line1 text,
  address_line2 text,
  city          text,
  region        text,
  postal_code   text,
  country_code  text not null default 'ZM' references public.countries(code),
  location      jsonb,
  opening_hours jsonb not null default '{}'::jsonb,
  manager_id    uuid references auth.users(id) on delete set null,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (business_id, name)
);
create index if not exists branches_business_idx on public.branches (business_id, is_active);

alter table public.business_members
  drop constraint if exists business_members_branch_fk,
  add constraint business_members_branch_fk foreign key (branch_id)
    references public.branches(id) on delete set null;

-- ── WAREHOUSES (each holds its own inventory) ─────────────────────────────────
create table if not exists public.warehouses (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  branch_id    uuid references public.branches(id) on delete set null,
  name         text not null,                     -- Warehouse A / Shop 1
  code         text,
  kind         text not null default 'warehouse', -- warehouse|shop|van|consignment
  is_primary   boolean not null default false,
  address_line1 text,
  city         text,
  country_code text not null default 'ZM' references public.countries(code),
  manager_id   uuid references auth.users(id) on delete set null,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (business_id, name)
);
create index if not exists warehouses_business_idx on public.warehouses (business_id, is_active);

alter table public.businesses
  drop constraint if exists businesses_default_branch_fk;

-- ── BUSINESS DOCUMENTS (registration certs, licences, contracts) ──────────────
create table if not exists public.business_documents (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  uploaded_by  uuid not null references auth.users(id) on delete restrict,
  title        text not null,
  kind         text not null default 'other',
  -- registration_certificate|tax_certificate|licence|contract|agreement|policy|other
  file_url     text not null,
  file_name    text,
  file_size    bigint,
  mime_type    text,
  is_private   boolean not null default true,     -- private = owner/admin only
  expires_at   date,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index if not exists business_documents_business_idx on public.business_documents (business_id, kind);

-- ── AUDIT LOG (who did what, when) ────────────────────────────────────────────
create table if not exists public.audit_logs (
  id           bigserial primary key,
  business_id  uuid references public.businesses(id) on delete cascade,
  actor_id     uuid references auth.users(id) on delete set null,
  actor_name   text,
  action       text not null,                     -- product.price_changed
  entity_type  text not null,                     -- product|invoice|inventory|…
  entity_id    uuid,
  entity_label text,                              -- "INV-00052"
  branch_id    uuid,
  changes      jsonb,                             -- {field:{old,new}}
  ip_address   inet,
  user_agent   text,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists audit_logs_business_idx on public.audit_logs (business_id, created_at desc);
create index if not exists audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index if not exists audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);

-- ── SETTINGS (per-business key/value, non-sensitive) ──────────────────────────
create table if not exists public.business_settings (
  business_id  uuid not null references public.businesses(id) on delete cascade,
  key          text not null,
  value        jsonb not null,
  updated_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (business_id, key)
);

-- ── BUYER ADDRESS BOOK ────────────────────────────────────────────────────────
-- Delivery addresses belong to the shopper (profiles), not to a business.
-- Sellers keep their own per-customer addresses in public.customer_addresses
-- (0005) because a seller's copy must survive even if the buyer deletes theirs.
create table if not exists public.addresses (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  label         text not null default 'Home',        -- Home | Work | Mum's house
  recipient_name text,
  phone         text,
  line1         text not null,
  line2         text,
  city          text,
  region        text,
  postal_code   text,
  country_code  text not null default 'ZM' references public.countries(code),
  location      jsonb,                               -- {lat,lng} for delivery routing
  delivery_notes text,
  is_default    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists addresses_user_idx on public.addresses (user_id, is_default desc, created_at desc);
-- Only one default per person: a partial unique index keeps the rule in the
-- database instead of relying on the client to clear the old flag.
create unique index if not exists addresses_one_default_uq
  on public.addresses (user_id) where is_default;

-- ── DATA EXPORT / ACCOUNT DELETION REQUESTS (privacy) ─────────────────────────
create table if not exists public.data_requests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  business_id  uuid references public.businesses(id) on delete cascade,
  kind         text not null,                     -- export | delete_account | delete_business
  status       text not null default 'requested', -- requested|processing|completed|cancelled
  file_url     text,
  notes        text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ── AUTO-CREATE A PROFILE ON SIGNUP ───────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_country text;
begin
  select coalesce(new.raw_user_meta_data->>'country_code','ZM') into v_country;

  insert into public.profiles (id, email, phone, full_name, display_name, avatar_url,
                               country_code, roles, primary_role, headline)
  values (
    new.id,
    new.email,
    new.phone,
    nullif(new.raw_user_meta_data->>'full_name',''),
    nullif(coalesce(new.raw_user_meta_data->>'display_name',
                    new.raw_user_meta_data->>'full_name',
                    split_part(new.email,'@',1)),''),
    new.raw_user_meta_data->>'avatar_url',
    v_country,
    coalesce(
      (select array_agg(r::public.user_role)
         from jsonb_array_elements_text(coalesce(new.raw_user_meta_data->'roles','["buyer"]'::jsonb)) as r),
      array['buyer']::public.user_role[]),
    coalesce((new.raw_user_meta_data->>'primary_role')::public.user_role,'buyer'),
    new.raw_user_meta_data->>'headline'
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    updated_at = now();

  if new.email_confirmed_at is not null then
    update public.profiles set email_verified_at = new.email_confirmed_at where id = new.id;
  end if;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── updated_at triggers ───────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','active_sessions','two_factor_secrets','businesses','business_verifications',
    'roles','business_members','branches','warehouses','business_documents',
    'business_settings','addresses','data_requests','countries','currencies','exchange_rates'
  ] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function public.tg_set_updated_at()', t);
  end loop;
end $$;

select 'seedwel_hub: 0002 identity ok' as status;
