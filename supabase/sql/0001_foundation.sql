-- ══════════════════════════════════════════════════════════════════════════════
--  SEEDWEL HUB — 0001 · Extensions, enums, countries & currencies
--  Buy. Sell. Manage. Grow. — A product of Seedwel Investment Limited
--
--  Apply in order (Supabase SQL Editor, or `supabase db push`):
--    0001 → 0002 → 0003 → 0004 → 0005 → 0006 → 0007 → 0008
--
--  Conventions
--    · ids        : uuid, gen_random_uuid()
--    · money      : numeric(14,2) — never float
--    · timestamps : timestamptz, created_at/updated_at on every table
--    · soft delete: deleted_at where records must remain auditable
--    · multi-country / multi-currency / configurable tax are structural, not
--      hard-coded. Zambia (ZMW) is the seeded launch market only.
-- ══════════════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";      -- fuzzy search on names/slugs
create extension if not exists "unaccent";     -- accent-insensitive search
create extension if not exists "btree_gin";    -- composite search indexes

-- ── ENUMS ─────────────────────────────────────────────────────────────────────
do $$ begin
  create type public.user_role as enum ('buyer','seller','business','employee','supplier','service_provider','admin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.business_type as enum
    ('sole_proprietorship','partnership','llc','company','cooperative','ngo','informal','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.verification_status as enum
    ('unverified','submitted','under_review','verified','rejected','suspended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.member_role as enum
    ('owner','administrator','manager','salesperson','cashier','accountant','inventory_manager','warehouse_manager');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.member_status as enum ('invited','active','suspended','removed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.product_type as enum ('product','service','wholesale','both');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.product_status as enum ('draft','active','out_of_stock','archived','blocked');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.product_condition as enum ('new','used','refurbished');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.order_status as enum
    ('pending','confirmed','processing','ready','shipped','delivered','cancelled','returned');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.order_channel as enum ('marketplace','pos','store','wholesale','manual','api');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.doc_status as enum
    ('draft','sent','viewed','accepted','rejected','change_requested','signed',
     'partially_paid','paid','overdue','cancelled','void','approved');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.doc_type as enum
    ('quotation','proforma_invoice','invoice','receipt','purchase_order','delivery_note',
     'contract','agreement','statement','credit_note','debit_note','payment_voucher',
     'expense_document','return_note','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_method as enum
    ('cash','bank_transfer','card','mobile_money','online','cheque','credit','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_status as enum ('pending','processing','completed','failed','refunded','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.movement_type as enum
    ('purchase','sale','adjustment','transfer_in','transfer_out','return_in','return_out',
     'damaged','expired','counted','opening','import');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.return_status as enum ('requested','approved','rejected','received','refunded','closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.notification_type as enum
    ('order','message','payment','quotation','invoice','stock','review','promotion',
     'security','system','document','customer','supplier');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.subscription_status as enum ('trialing','active','past_due','cancelled','expired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.ai_action_status as enum ('proposed','approved','rejected','executed','failed');
exception when duplicate_object then null; end $$;

-- ── COUNTRIES (multi-country from day one) ────────────────────────────────────
create table if not exists public.countries (
  code            text primary key,                 -- ISO 3166-1 alpha-2
  name            text not null,
  currency        text not null,                    -- ISO 4217
  currency_symbol text not null,
  phone_code      text not null,                    -- e.g. +260
  phone_pattern   text,                             -- national-number regex
  address_format  text not null default 'street, city, region, country',
  default_tax_rate numeric(6,3) not null default 0, -- e.g. 16.000 = 16% VAT
  tax_name        text not null default 'VAT',
  time_zone       text not null default 'UTC',
  locale          text not null default 'en',
  is_active       boolean not null default true,
  sort_order      integer not null default 100,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ── CURRENCIES + configurable exchange rates ──────────────────────────────────
create table if not exists public.currencies (
  code           text primary key,
  name           text not null,
  symbol         text not null,
  decimal_places smallint not null default 2,
  is_active      boolean not null default true,
  sort_order     integer not null default 100,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Rates are CONFIGURABLE and always relative to a base currency. Displayed
-- conversions are estimates; settlement amounts are stored on each transaction
-- in the transaction's own currency so books never depend on a live rate.
create table if not exists public.exchange_rates (
  id           uuid primary key default gen_random_uuid(),
  base_currency text not null references public.currencies(code) on delete cascade,
  quote_currency text not null references public.currencies(code) on delete cascade,
  rate         numeric(18,8) not null check (rate > 0),
  effective_at timestamptz not null default now(),
  source       text not null default 'manual',      -- manual | provider | central_bank
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (base_currency, quote_currency, effective_at)
);

create index if not exists exchange_rates_lookup_idx
  on public.exchange_rates (base_currency, quote_currency, is_active, effective_at desc);

-- ── SEED: launch markets ──────────────────────────────────────────────────────
insert into public.currencies (code, name, symbol, decimal_places, sort_order) values
  ('ZMW','Zambian Kwacha','K',2,1),
  ('USD','US Dollar','$',2,2),
  ('ZAR','South African Rand','R',2,3),
  ('BWP','Botswana Pula','P',2,4),
  ('MWK','Malawian Kwacha','MK',2,5),
  ('TZS','Tanzanian Shilling','TSh',0,6),
  ('KES','Kenyan Shilling','KSh',2,7),
  ('GBP','Pound Sterling','£',2,8),
  ('EUR','Euro','€',2,9)
on conflict (code) do update set name = excluded.name, symbol = excluded.symbol;

insert into public.countries
  (code, name, currency, currency_symbol, phone_code, phone_pattern, address_format,
   default_tax_rate, tax_name, time_zone, locale, sort_order) values
  ('ZM','Zambia','ZMW','K','+260','^[0-9]{9}$','street, city, province, country',16.000,'VAT','Africa/Lusaka','en-ZM',1),
  ('ZW','Zimbabwe','USD','$','+263','^[0-9]{9}$','street, city, country',15.000,'VAT','Africa/Harare','en-ZW',2),
  ('MW','Malawi','MWK','MK','+265','^[0-9]{9}$','street, city, country',16.500,'VAT','Africa/Blantyre','en-MW',3),
  ('BW','Botswana','BWP','P','+267','^[0-9]{7,8}$','street, city, country',14.000,'VAT','Africa/Gaborone','en-BW',4),
  ('ZA','South Africa','ZAR','R','+27','^[0-9]{9}$','street, suburb, city, province, postal_code',15.000,'VAT','Africa/Johannesburg','en-ZA',5),
  ('TZ','Tanzania','TZS','TSh','+255','^[0-9]{9}$','street, city, region, country',18.000,'VAT','Africa/Dar_es_Salaam','sw-TZ',6),
  ('KE','Kenya','KES','KSh','+254','^[0-9]{9}$','street, city, county, country',16.000,'VAT','Africa/Nairobi','en-KE',7),
  ('US','United States','USD','$','+1','^[0-9]{10}$','street, city, state, zip, country',0.000,'Sales Tax','America/New_York','en-US',20),
  ('GB','United Kingdom','GBP','£','+44','^[0-9]{9,10}$','street, town, county, postcode, country',20.000,'VAT','Europe/London','en-GB',21)
on conflict (code) do update set
  name = excluded.name, currency = excluded.currency, currency_symbol = excluded.currency_symbol,
  phone_code = excluded.phone_code, default_tax_rate = excluded.default_tax_rate,
  tax_name = excluded.tax_name, time_zone = excluded.time_zone;

-- Reference rates, base ZMW. Clearly marked manual/estimated — replace with a
-- provider feed in Phase 7. Settlement amounts are stored per-transaction.
insert into public.exchange_rates (base_currency, quote_currency, rate, source) values
  ('ZMW','USD',0.0370,'manual'),
  ('USD','ZMW',27.0000,'manual'),
  ('ZMW','ZAR',0.6800,'manual'),
  ('ZAR','ZMW',1.4700,'manual'),
  ('ZMW','BWP',0.5000,'manual'),
  ('BWP','ZMW',2.0000,'manual'),
  ('ZMW','MWK',64.5000,'manual'),
  ('MWK','ZMW',0.0155,'manual'),
  ('ZMW','KES',4.8000,'manual'),
  ('KES','ZMW',0.2080,'manual')
on conflict (base_currency, quote_currency, effective_at) do update
  set rate = excluded.rate, source = excluded.source;

-- ── updated_at trigger helper ─────────────────────────────────────────────────
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ── slug helper ───────────────────────────────────────────────────────────────
create or replace function public.slugify(input text)
returns text language sql immutable strict as $$
  select trim(both '-' from
    regexp_replace(
      regexp_replace(lower(unaccent(coalesce(input,''))), '[^a-z0-9]+', '-', 'g'),
      '-{2,}', '-', 'g'));
$$;

-- ── generic "is this user a platform admin" (set in 0006 RLS helpers) ─────────
-- defined later to keep this file dependency-free.

select 'seedwel_hub: 0001 foundation ok' as status;
