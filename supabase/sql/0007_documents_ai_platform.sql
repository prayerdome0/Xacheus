-- ══════════════════════════════════════════════════════════════════════════════
--  SEEDWEL HUB — 0007 · Document centre, signatures, messaging, notifications,
--                        marketing, subscriptions, advertising, AI, reports,
--                        help & support  + all remaining cross-module FKs
-- ══════════════════════════════════════════════════════════════════════════════

-- ══════════════════════════ DOCUMENTS & SIGNATURES ════════════════════════════
create table if not exists public.documents (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  doc_number    text not null,
  doc_type      public.doc_type not null,
  title         text not null,
  status        public.doc_status not null default 'draft',

  -- One document row always points at its authoritative record so nothing is
  -- ever duplicated out of sync. entity_type mirrors doc_type for the generic
  -- rows (contracts, agreements, expense evidence…).
  entity_type   text not null,
  entity_id     uuid,

  customer_id   uuid references public.customers(id) on delete set null,
  supplier_id   uuid references public.suppliers(id) on delete set null,
  branch_id     uuid references public.branches(id) on delete set null,

  currency      text not null default 'ZMW',
  total         numeric(14,2) not null default 0,
  issue_date    date not null default current_date,
  due_date      date,
  file_url      text,                             -- generated PDF
  file_name     text,
  file_size     bigint,
  mime_type     text not null default 'application/pdf',
  page_count    smallint,
  checksum      text,                             -- tamper evidence (sha256 of PDF)
  qr_token      text unique,
  share_token   text unique,
  share_expires_at timestamptz,
  view_count    integer not null default 0,
  last_viewed_at timestamptz,
  download_count integer not null default 0,
  requires_signature boolean not null default false,
  is_signed     boolean not null default false,
  signed_at     timestamptz,
  is_archived   boolean not null default false,
  search_text   text,                             -- flattened text for the doc centre search
  metadata      jsonb not null default '{}'::jsonb,
  created_by    uuid not null references auth.users(id) on delete restrict,
  created_by_name text,
  sent_at       timestamptz,
  sent_channel  text,
  deleted_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (business_id, doc_type, doc_number)
);
create index if not exists documents_business_idx on public.documents (business_id, doc_type, issue_date desc);
create index if not exists documents_entity_idx on public.documents (entity_type, entity_id);
create index if not exists documents_status_idx on public.documents (business_id, status);
create index if not exists documents_customer_idx on public.documents (customer_id, issue_date desc);
create index if not exists documents_supplier_idx on public.documents (supplier_id, issue_date desc);
create index if not exists documents_share_idx on public.documents (share_token);
create index if not exists documents_search_idx on public.documents using gin (to_tsvector('english', coalesce(search_text,'')));

create table if not exists public.document_versions (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.documents(id) on delete cascade,
  version      integer not null,
  file_url     text,
  checksum     text,
  change_note  text,
  changed_by   uuid references auth.users(id) on delete set null,
  changed_by_name text,
  snapshot     jsonb not null default '{}'::jsonb,  -- full doc payload at that version
  created_at   timestamptz not null default now(),
  unique (document_id, version)
);
create index if not exists document_versions_doc_idx on public.document_versions (document_id, version desc);

-- ── DIGITAL SIGNATURES (draw / upload / saved) with audit trail ───────────────
create table if not exists public.signatures (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid references public.businesses(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null,
  signer_name   text not null,
  signer_email  text,
  signer_phone  text,
  signer_role   text,                              -- customer|supplier|owner|manager|employee
  method        text not null default 'drawn',     -- drawn|uploaded|typed|saved
  image_url     text,                              -- storage path of the signature image
  image_data    text,                              -- inline data URL fallback
  typed_text    text,
  is_saved_template boolean not null default false,
  ip_address    inet,
  user_agent    text,
  geolocation   jsonb,
  signed_at     timestamptz not null default now(),
  intent_text   text,                              -- what they agreed to
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists signatures_business_idx on public.signatures (business_id, signed_at desc);
create index if not exists signatures_user_idx on public.signatures (user_id) where is_saved_template;

alter table public.quotations
  drop constraint if exists quotations_signature_fk,
  add constraint quotations_signature_fk foreign key (signature_id)
    references public.signatures(id) on delete set null;

alter table public.invoices
  drop constraint if exists invoices_signature_fk,
  add constraint invoices_signature_fk foreign key (signature_id)
    references public.signatures(id) on delete set null;

alter table public.purchase_orders
  drop constraint if exists purchase_orders_signature_fk,
  add constraint purchase_orders_signature_fk foreign key (signature_id)
    references public.signatures(id) on delete set null;

alter table public.goods_received
  drop constraint if exists goods_received_signature_fk,
  add constraint goods_received_signature_fk foreign key (signature_id)
    references public.signatures(id) on delete set null;

alter table public.delivery_notes
  drop constraint if exists delivery_notes_signature_fk,
  add constraint delivery_notes_signature_fk foreign key (recipient_signature_id)
    references public.signatures(id) on delete set null;

create table if not exists public.document_signatures (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.documents(id) on delete cascade,
  signature_id uuid not null references public.signatures(id) on delete cascade,
  signer_order smallint not null default 1,
  role         text not null default 'signer',      -- signer|witness|approver
  status       text not null default 'signed',      -- pending|signed|declined
  ip_address   inet,
  user_agent   text,
  signed_at    timestamptz,
  created_at   timestamptz not null default now(),
  unique (document_id, signature_id)
);

-- Audit trail: who signed / viewed / sent what, and when.
create table if not exists public.document_events (
  id           bigserial primary key,
  document_id  uuid not null references public.documents(id) on delete cascade,
  event        text not null,   -- created|sent|viewed|signed|declined|downloaded|reminded|paid|cancelled
  actor_id     uuid references auth.users(id) on delete set null,
  actor_name   text,
  actor_type   text,            -- staff|customer|supplier|system
  ip_address   inet,
  user_agent   text,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists document_events_idx on public.document_events (document_id, created_at desc);

-- ── DOCUMENT TEMPLATES (branded PDF layouts) ──────────────────────────────────
create table if not exists public.document_templates (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid references public.businesses(id) on delete cascade,  -- null = platform template
  doc_type     public.doc_type not null,
  name         text not null,
  layout       jsonb not null default '{}'::jsonb,
  -- { header:{show_logo,show_tagline}, colors:{primary,accent}, sections:[…],
  --   footer:{text,show_qr,show_bank_details}, paper:'a4'|'letter'|'receipt80' }
  is_default   boolean not null default false,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (business_id, doc_type, name)
);

-- ═════════════════════════ COMMUNICATION ══════════════════════════════════════
create table if not exists public.conversations (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  participant_user_id uuid references auth.users(id) on delete cascade,
  participant_customer_id uuid references public.customers(id) on delete set null,
  participant_name text not null,
  participant_phone text,
  participant_email text,
  kind           text not null default 'marketplace', -- marketplace|support|whatsapp|internal
  subject        text,
  product_id     uuid references public.products(id) on delete set null,
  order_id       uuid references public.orders(id) on delete set null,
  status         text not null default 'open',        -- open|pending|resolved|closed|archived
  unread_business integer not null default 0,
  unread_user    integer not null default 0,
  last_message_at timestamptz not null default now(),
  last_message_preview text,
  assigned_to    uuid references auth.users(id) on delete set null,
  priority       text not null default 'normal',      -- low|normal|high|urgent
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists conversations_business_idx
  on public.conversations (business_id, last_message_at desc);
create index if not exists conversations_user_idx
  on public.conversations (participant_user_id, last_message_at desc);
create index if not exists conversations_status_idx on public.conversations (business_id, status);

create table if not exists public.messages (
  id             uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id      uuid references auth.users(id) on delete set null,
  sender_type    text not null default 'user',        -- user|business|system|ai
  sender_name    text not null,
  body           text not null,
  attachment     jsonb,                               -- {type:'image'|'document'|'product'|'order'|'invoice'|'quotation', url, id, name, thumb}
  reference_type text,                                -- product|order|invoice|quotation|receipt|document
  reference_id   uuid,
  is_read        boolean not null default false,
  read_at        timestamptz,
  is_edited      boolean not null default false,
  deleted_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists messages_conversation_idx on public.messages (conversation_id, created_at desc);
create index if not exists messages_unread_idx on public.messages (conversation_id) where not is_read;

create table if not exists public.notifications (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  business_id    uuid references public.businesses(id) on delete cascade,
  type           public.notification_type not null,
  title          text not null,
  body           text,
  icon           text,
  action_url     text,
  entity_type    text,
  entity_id      uuid,
  priority       text not null default 'normal',      -- low|normal|high|urgent
  channel        text[] not null default array['in_app'], -- in_app|email|sms|whatsapp|push
  is_read        boolean not null default false,
  read_at        timestamptz,
  is_archived    boolean not null default false,
  sent_at        timestamptz,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, is_read, created_at desc);
create index if not exists notifications_business_idx on public.notifications (business_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where not is_read;

create table if not exists public.notification_preferences (
  user_id      uuid not null references auth.users(id) on delete cascade,
  business_id  uuid references public.businesses(id) on delete cascade,
  -- coalesce() is not immutable, so a generated sentinel column forms the key.
  business_scope uuid generated always as
                 (coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid)) stored,
  type         public.notification_type not null,
  in_app       boolean not null default true,
  email        boolean not null default true,
  sms          boolean not null default false,
  whatsapp     boolean not null default false,
  push         boolean not null default true,
  quiet_hours  jsonb,                                 -- {start:"21:00",end:"06:00",tz:"Africa/Lusaka"}
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, type, business_scope)
);

create table if not exists public.email_logs (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid references public.businesses(id) on delete cascade,
  recipient    text not null,
  recipient_name text,
  subject      text not null,
  template     text,                                  -- invoice|quotation|receipt|statement|promotion|notification
  body_preview text,
  entity_type  text,
  entity_id    uuid,
  attachments  jsonb not null default '[]'::jsonb,
  provider     text not null default 'supabase',
  provider_id  text,
  status       text not null default 'queued',        -- queued|sent|delivered|bounced|failed|opened
  opened_at    timestamptz,
  bounced_reason text,
  sent_by      uuid references auth.users(id) on delete set null,
  sent_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists email_logs_business_idx on public.email_logs (business_id, created_at desc);
create index if not exists email_logs_status_idx on public.email_logs (status, created_at);

create table if not exists public.sms_logs (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid references public.businesses(id) on delete cascade,
  recipient    text not null,
  message      text not null,
  kind         text not null default 'notification',  -- notification|invoice|receipt|payment_link|otp|marketing
  entity_type  text,
  entity_id    uuid,
  provider     text,
  provider_id  text,
  status       text not null default 'queued',
  credits_used numeric(8,2) not null default 0,
  sent_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists sms_logs_business_idx on public.sms_logs (business_id, created_at desc);

-- ═════════════════════════ MARKETING ══════════════════════════════════════════
create table if not exists public.coupons (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  code           text not null,
  description    text,
  discount_type  text not null default 'percent',     -- percent|fixed|free_delivery|bogo
  discount_value numeric(14,2) not null default 0,
  max_discount   numeric(14,2),                       -- cap for percent coupons
  min_subtotal   numeric(14,2) not null default 0,
  applies_to     text not null default 'all',         -- all|products|services|category|collection
  target_ids     uuid[] not null default '{}',        -- category or product ids
  per_customer_limit integer,
  total_limit    integer,
  usage_count    integer not null default 0,
  starts_at      timestamptz not null default now(),
  ends_at        timestamptz,
  is_active      boolean not null default true,
  is_stackable   boolean not null default false,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (business_id, code)
);
create index if not exists coupons_active_idx on public.coupons (business_id, is_active, ends_at);
create unique index if not exists coupons_code_lookup_idx on public.coupons (code) where is_active;

alter table public.orders
  drop constraint if exists orders_coupon_fk,
  add constraint orders_coupon_fk foreign key (coupon_id)
    references public.coupons(id) on delete set null;

create table if not exists public.coupon_redemptions (
  id           uuid primary key default gen_random_uuid(),
  coupon_id    uuid not null references public.coupons(id) on delete cascade,
  customer_id  uuid references public.customers(id) on delete set null,
  user_id      uuid references auth.users(id) on delete set null,
  order_id     uuid references public.orders(id) on delete set null,
  amount_saved numeric(14,2) not null default 0,
  redeemed_at  timestamptz not null default now()
);
create index if not exists coupon_redemptions_idx on public.coupon_redemptions (coupon_id, redeemed_at desc);

create table if not exists public.campaigns (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  name          text not null,
  kind          text not null default 'promotion',    -- promotion|flash_sale|email|sms|whatsapp|social|loyalty
  channel       text[] not null default array['in_app'],
  status        text not null default 'draft',        -- draft|scheduled|running|paused|completed
  audience      jsonb not null default '{}'::jsonb,
  -- {segment:'all'|'top_customers'|'dormant_90d'|'wholesale'|'new', customer_ids:[…], tags:[…]}
  message       text,
  subject       text,
  media         jsonb not null default '[]'::jsonb,
  coupon_id     uuid references public.coupons(id) on delete set null,
  product_ids   uuid[] not null default '{}',
  starts_at     timestamptz,
  ends_at       timestamptz,
  budget        numeric(14,2),
  spent         numeric(14,2) not null default 0,
  sent_count    integer not null default 0,
  open_count    integer not null default 0,
  click_count   integer not null default 0,
  conversion_count integer not null default 0,
  revenue_attributed numeric(14,2) not null default 0,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists campaigns_business_idx on public.campaigns (business_id, status, starts_at desc);

create table if not exists public.promotions (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  name           text not null,
  description    text,
  promo_type     text not null default 'discount',    -- discount|bundle|bogo|free_gift|flash|loyalty
  target_type    text not null default 'product',     -- product|category|collection|store
  target_ids     uuid[] not null default '{}',
  discount_percent numeric(5,2),
  discount_amount numeric(14,2),
  buy_qty        integer,
  get_qty        integer,
  starts_at      timestamptz not null default now(),
  ends_at        timestamptz,
  is_active      boolean not null default true,
  banner_url     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists promotions_active_idx on public.promotions (business_id, is_active, starts_at, ends_at);

create table if not exists public.advertisements (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  campaign_name  text not null,
  placement      text not null default 'featured_product',
  -- featured_seller|featured_product|homepage_promotion|category_promotion|search_top|store_banner
  product_id     uuid references public.products(id) on delete cascade,
  category_id    uuid references public.categories(id) on delete set null,
  headline       text,
  body           text,
  image_url      text,
  landing_url    text,
  budget_total   numeric(14,2) not null default 0,
  budget_daily   numeric(14,2),
  spent          numeric(14,2) not null default 0,
  bid_cpc        numeric(10,4),
  impressions    integer not null default 0,
  clicks         integer not null default 0,
  conversions    integer not null default 0,
  starts_at      timestamptz not null default now(),
  ends_at        timestamptz,
  status         text not null default 'draft',        -- draft|pending_review|active|paused|rejected|expired
  reviewed_by    uuid references auth.users(id) on delete set null,
  rejection_reason text,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists advertisements_active_idx
  on public.advertisements (placement, status, starts_at, ends_at) where status = 'active';
create index if not exists advertisements_business_idx on public.advertisements (business_id, status);

-- Loyalty
create table if not exists public.loyalty_transactions (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  customer_id  uuid not null references public.customers(id) on delete cascade,
  points_change integer not null,
  reason       text not null,      -- purchase|redemption|referral|birthday|bonus|adjustment|expiry
  reference_type text,
  reference_id uuid,
  balance_after integer not null default 0,
  value_amount numeric(14,2) not null default 0,
  notes        text,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists loyalty_transactions_idx
  on public.loyalty_transactions (customer_id, created_at desc);

create table if not exists public.loyalty_rules (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  name          text not null,
  earn_rate     numeric(8,4) not null default 1,     -- points per currency unit spent
  redeem_rate   numeric(14,4) not null default 100,  -- points needed per currency unit
  min_redeem    integer not null default 100,
  points_expiry_days integer,
  tiers         jsonb not null default '[]'::jsonb,
  -- [{name:"Bronze",min:0,discount:0},{name:"Silver",min:500,discount:3}]
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ═════════════════════════ LEDGERS & SEGMENTS ═════════════════════════════════
-- One append-only transaction ledger per relationship so customer and supplier
-- statements can always be rebuilt (opening balance → documents → payments →
-- credits → closing balance) without trusting denormalised counters.
create table if not exists public.customer_transactions (
  id             bigserial primary key,
  business_id    uuid not null references public.businesses(id) on delete cascade,
  customer_id    uuid not null references public.customers(id) on delete cascade,
  kind           text not null,
  -- invoice|payment|credit_note|debit_note|refund|order|adjustment|opening_balance|loyalty
  direction      text not null,                    -- debit|credit
  amount         numeric(14,2) not null,
  currency       text not null default 'ZMW',
  balance_after  numeric(16,2) not null default 0, -- outstanding balance after this row
  reference_type text,
  reference_id   uuid,
  reference_number text,                            -- INV-00052
  description    text,
  occurred_at    timestamptz not null default now(),
  created_at     timestamptz not null default now()
);
create index if not exists customer_transactions_idx
  on public.customer_transactions (customer_id, occurred_at, id);
create index if not exists customer_transactions_business_idx
  on public.customer_transactions (business_id, occurred_at desc);

create table if not exists public.supplier_transactions (
  id             bigserial primary key,
  business_id    uuid not null references public.businesses(id) on delete cascade,
  supplier_id    uuid not null references public.suppliers(id) on delete cascade,
  kind           text not null,                    -- purchase_order|bill|payment|debit_note|adjustment|opening_balance
  direction      text not null,                    -- debit|credit
  amount         numeric(14,2) not null,
  currency       text not null default 'ZMW',
  balance_after  numeric(16,2) not null default 0,
  reference_type text,
  reference_id   uuid,
  reference_number text,
  description    text,
  occurred_at    timestamptz not null default now(),
  created_at     timestamptz not null default now()
);
create index if not exists supplier_transactions_idx
  on public.supplier_transactions (supplier_id, occurred_at, id);
create index if not exists supplier_transactions_business_idx
  on public.supplier_transactions (business_id, occurred_at desc);

-- Saved customer segments used by campaigns, reports and the AI assistant
-- ("customers who haven't purchased in 90 days").
create table if not exists public.customer_segments (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  name         text not null,
  description  text,
  rules        jsonb not null default '{}'::jsonb,
  -- {days_since_last_order:{gte:90}, total_spent:{gte:1000}, tags:['wholesale'], city:'Lusaka'}
  is_system    boolean not null default false,
  member_count integer not null default 0,
  computed_at  timestamptz,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (business_id, name)
);

-- ═════════════════════════ SUBSCRIPTIONS & BILLING ════════════════════════════
create table if not exists public.plans (
  id            uuid primary key default gen_random_uuid(),
  key           text not null unique,                -- free|starter|business|professional|enterprise
  name          text not null,
  tagline       text,
  description   text,
  price_monthly numeric(14,2) not null default 0,
  price_annual  numeric(14,2) not null default 0,
  currency      text not null default 'ZMW' references public.currencies(code),
  -- Regional pricing so the platform is affordable across markets.
  price_overrides jsonb not null default '{}'::jsonb, -- {"MW":{"monthly":250,"annual":2500}}
  is_active     boolean not null default true,
  is_popular    boolean not null default false,
  sort_order    integer not null default 100,
  limits        jsonb not null default '{}'::jsonb,
  -- {products:50, staff:1, branches:1, warehouses:1, invoices_per_month:100,
  --  csv_sync:true, ai_credits:20, api:false, custom_domain:false, commission_rate:0}
  features      jsonb not null default '[]'::jsonb,
  -- [{key:"online_store",label:"Automatic online store",included:true}]
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

insert into public.plans (key, name, tagline, price_monthly, price_annual, is_popular, sort_order, limits) values
  ('free','Free','Basic marketplace & store',0,0,false,1,
   '{"products":50,"staff":1,"branches":1,"warehouses":1,"invoices_per_month":20,"quotations_per_month":20,"csv_sync":false,"barcode":false,"ai_credits":10,"api":false,"custom_domain":false,"reports":"basic","pos":false,"commission_rate":2.0}'),
  ('starter','Starter','Inventory, quotations & invoices',150,1500,false,2,
   '{"products":500,"staff":2,"branches":1,"warehouses":2,"invoices_per_month":500,"quotations_per_month":500,"csv_sync":true,"barcode":true,"ai_credits":100,"api":false,"custom_domain":false,"reports":"standard","pos":true,"commission_rate":1.0}'),
  ('business','Business','Advanced business tools',450,4500,true,3,
   '{"products":5000,"staff":8,"branches":3,"warehouses":5,"invoices_per_month":5000,"quotations_per_month":5000,"csv_sync":true,"barcode":true,"ai_credits":600,"api":false,"custom_domain":true,"reports":"advanced","pos":true,"commission_rate":0.5}'),
  ('professional','Professional','Automation, staff & reports',1200,12000,false,4,
   '{"products":50000,"staff":30,"branches":10,"warehouses":20,"invoices_per_month":-1,"quotations_per_month":-1,"csv_sync":true,"barcode":true,"ai_credits":3000,"api":true,"custom_domain":true,"reports":"advanced","pos":true,"automation":true,"commission_rate":0.0}'),
  ('enterprise','Enterprise','Multi-branch, integrations & API',0,0,false,5,
   '{"products":-1,"staff":-1,"branches":-1,"warehouses":-1,"invoices_per_month":-1,"quotations_per_month":-1,"csv_sync":true,"barcode":true,"ai_credits":-1,"api":true,"custom_domain":true,"reports":"enterprise","pos":true,"automation":true,"sla":true,"commission_rate":0.0}')
on conflict (key) do update set
  name = excluded.name, tagline = excluded.tagline,
  price_monthly = excluded.price_monthly, price_annual = excluded.price_annual,
  is_popular = excluded.is_popular, limits = excluded.limits;

create table if not exists public.subscriptions (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  plan_id       uuid not null references public.plans(id) on delete restrict,
  status        public.subscription_status not null default 'trialing',
  billing_cycle text not null default 'monthly',    -- monthly|annual
  currency      text not null default 'ZMW' references public.currencies(code),
  amount        numeric(14,2) not null default 0,
  seats         integer not null default 1,
  trial_ends_at timestamptz,
  current_period_start timestamptz not null default now(),
  current_period_end   timestamptz,
  cancel_at_period_end boolean not null default false,
  cancelled_at  timestamptz,
  provider      text,
  provider_subscription_id text,
  limits_override jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists subscriptions_business_idx on public.subscriptions (business_id, status);
create unique index if not exists subscriptions_active_uq on public.subscriptions (business_id)
  where status in ('trialing','active','past_due');

create table if not exists public.invoices_platform (
  id            uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  business_id   uuid not null references public.businesses(id) on delete cascade,
  invoice_number text not null unique,
  period_start  date not null,
  period_end    date not null,
  amount        numeric(14,2) not null,
  tax_amount    numeric(14,2) not null default 0,
  total         numeric(14,2) not null,
  currency      text not null default 'ZMW',
  status        text not null default 'open',        -- open|paid|void|refunded
  paid_at       timestamptz,
  method        public.payment_method,
  provider_reference text,
  line_items    jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists invoices_platform_business_idx on public.invoices_platform (business_id, created_at desc);

create table if not exists public.feature_limits (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  period_start  date not null default date_trunc('month', current_date)::date,
  metric        text not null,                       -- products|invoices_per_month|ai_credits|staff…
  used          numeric(16,3) not null default 0,
  allowed       numeric(16,3) not null default 0,    -- -1 = unlimited
  updated_at    timestamptz not null default now(),
  unique (business_id, period_start, metric)
);

-- ═════════════════════════ AI ═════════════════════════════════════════════════
create table if not exists public.ai_conversations (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid references public.businesses(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  title         text,
  assistant     text not null default 'seedwel_business',  -- business|support|marketing|import
  context       jsonb not null default '{}'::jsonb,
  message_count integer not null default 0,
  is_pinned     boolean not null default false,
  last_message_at timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists ai_conversations_idx on public.ai_conversations (user_id, business_id, last_message_at desc);

create table if not exists public.ai_messages (
  id             uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  role           text not null,                       -- user|assistant|system|tool
  content        text not null,
  data           jsonb not null default '{}'::jsonb,  -- charts, tables, citations
  tokens_in      integer,
  tokens_out     integer,
  model          text,
  latency_ms     integer,
  feedback       smallint,                            -- -1 | 1
  created_at     timestamptz not null default now()
);
create index if not exists ai_messages_idx on public.ai_messages (conversation_id, created_at);

-- Every AI-proposed change is a ROW here first. High-impact actions never run
-- without explicit approval unless the owner deliberately enables automation.
create table if not exists public.ai_actions (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  conversation_id uuid references public.ai_conversations(id) on delete set null,
  requested_by   uuid not null references auth.users(id) on delete cascade,
  action         text not null,
  -- create_invoice|adjust_stock|change_price|send_reminder|generate_description|
  -- create_quotation|refund|delete_record|publish_product|create_payment_link|…
  impact         text not null default 'low',         -- low|medium|high|financial|destructive
  requires_approval boolean not null default true,
  status         public.ai_action_status not null default 'proposed',
  payload        jsonb not null default '{}'::jsonb,  -- proposed values
  diff           jsonb,                               -- what would change
  result         jsonb,                               -- created ids/numbers
  explanation    text,
  approved_by    uuid references auth.users(id) on delete set null,
  approved_at    timestamptz,
  rejected_reason text,
  executed_at    timestamptz,
  error          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists ai_actions_business_idx on public.ai_actions (business_id, status, created_at desc);
create index if not exists ai_actions_pending_idx on public.ai_actions (business_id, created_at)
  where status = 'proposed' and requires_approval;
create index if not exists ai_actions_impact_idx on public.ai_actions (business_id, impact);

create table if not exists public.ai_usage (
  id            bigserial primary key,
  business_id   uuid references public.businesses(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null,
  feature       text not null,       -- assistant|description|marketing|import|insight|report
  model         text,
  tokens_in     integer not null default 0,
  tokens_out    integer not null default 0,
  credits_used  numeric(10,3) not null default 0,
  latency_ms    integer,
  success       boolean not null default true,
  error         text,
  created_at    timestamptz not null default now()
);
create index if not exists ai_usage_business_idx on public.ai_usage (business_id, created_at desc);
create index if not exists ai_usage_feature_idx on public.ai_usage (business_id, feature, created_at desc);

create table if not exists public.automation_rules (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  name           text not null,
  description    text,
  trigger_type   text not null,
  -- stock_low|invoice_overdue|payment_received|order_created|message_received|
  -- csv_due|review_received|customer_dormant|schedule|birthday
  trigger_config jsonb not null default '{}'::jsonb,  -- {threshold:5, days_overdue:7, cron:"0 8 * * 1"}
  actions        jsonb not null default '[]'::jsonb,
  -- [{type:"notify",channel:"in_app",to:"owner"},{type:"generate_receipt"},{type:"send_email",template:"reminder"}]
  conditions     jsonb not null default '[]'::jsonb,
  requires_approval boolean not null default true,    -- for financial/destructive actions
  is_active      boolean not null default true,
  run_count      integer not null default 0,
  last_run_at    timestamptz,
  last_run_status text,
  next_run_at    timestamptz,
  created_by     uuid not null references auth.users(id) on delete restrict,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists automation_rules_business_idx on public.automation_rules (business_id, is_active);
create index if not exists automation_rules_due_idx on public.automation_rules (next_run_at) where is_active;

create table if not exists public.automation_runs (
  id            uuid primary key default gen_random_uuid(),
  rule_id       uuid not null references public.automation_rules(id) on delete cascade,
  business_id   uuid not null references public.businesses(id) on delete cascade,
  status        text not null default 'success',      -- success|failed|skipped|awaiting_approval
  trigger_data  jsonb not null default '{}'::jsonb,
  actions_taken jsonb not null default '[]'::jsonb,
  error         text,
  duration_ms   integer,
  created_at    timestamptz not null default now()
);
create index if not exists automation_runs_idx on public.automation_runs (business_id, created_at desc);

-- Business insights (the AI explaining the charts, not just showing them)
create table if not exists public.business_insights (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  kind          text not null,      -- sales_trend|stock_alert|customer_churn|profit|anomaly|monthly_report
  title         text not null,
  body          text not null,
  severity      text not null default 'info',  -- info|positive|warning|critical
  metric        text,
  metric_value  numeric(18,4),
  metric_change numeric(10,4),
  period_start  date,
  period_end    date,
  data          jsonb not null default '{}'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  is_read       boolean not null default false,
  is_dismissed  boolean not null default false,
  generated_by  text not null default 'ai',   -- ai|rule|system
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists business_insights_idx
  on public.business_insights (business_id, is_dismissed, created_at desc);

-- ═════════════════════════ REPORTS, HELP & SUPPORT ════════════════════════════
create table if not exists public.reports (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  name          text not null,
  kind          text not null,
  -- sales|inventory|customers|finance|tax|employees|products|suppliers|custom
  config        jsonb not null default '{}'::jsonb,  -- {range, group_by, filters, columns}
  schedule      text,                                -- daily|weekly|monthly|never
  recipients    jsonb not null default '[]'::jsonb,
  last_run_at   timestamptz,
  last_result   jsonb,
  file_url      text,
  created_by    uuid references auth.users(id) on delete set null,
  is_system     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists reports_business_idx on public.reports (business_id, kind);

create table if not exists public.help_articles (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  title        text not null,
  summary      text,
  body         text not null,                        -- markdown
  section      text not null default 'getting_started',
  -- getting_started|selling|inventory|invoicing|payments|ai|security|wholesale|pos|account
  tags         text[] not null default '{}',
  icon         text,
  video_url    text,
  audience     text not null default 'all',          -- all|buyer|seller|business|admin
  language     text not null default 'en',
  author       text,
  view_count   integer not null default 0,
  helpful_count integer not null default 0,
  is_published boolean not null default true,
  sort_order   integer not null default 100,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists help_articles_section_idx on public.help_articles (section, sort_order) where is_published;
create index if not exists help_articles_search_idx on public.help_articles using gin (to_tsvector('english', title || ' ' || coalesce(body,'')));

create table if not exists public.academy_courses (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  title        text not null,
  description  text,
  level        text not null default 'beginner',     -- beginner|intermediate|advanced
  category     text not null default 'business_basics',
  cover_url    text,
  duration_minutes integer,
  lessons      jsonb not null default '[]'::jsonb,
  -- [{title, body, video_url, duration_minutes, quiz:[…]}]
  is_published boolean not null default true,
  is_premium   boolean not null default false,
  sort_order   integer not null default 100,
  enrolled_count integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.academy_progress (
  id           uuid primary key default gen_random_uuid(),
  course_id    uuid not null references public.academy_courses(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  completed_lessons integer not null default 0,
  total_lessons integer not null default 0,
  progress_percent smallint not null default 0,
  completed_at timestamptz,
  certificate_url text,
  last_lesson_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (course_id, user_id)
);

create table if not exists public.support_tickets (
  id            uuid primary key default gen_random_uuid(),
  ticket_number text not null unique,
  user_id       uuid not null references auth.users(id) on delete cascade,
  business_id   uuid references public.businesses(id) on delete cascade,
  subject       text not null,
  body          text not null,
  category      text not null default 'general',     -- general|billing|technical|verification|report_abuse|feature_request
  status        text not null default 'open',        -- open|pending|in_progress|resolved|closed
  priority      text not null default 'normal',      -- low|normal|high|urgent
  assigned_to   uuid references auth.users(id) on delete set null,
  tags          text[] not null default '{}',
  resolved_at   timestamptz,
  rating        smallint,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists support_tickets_user_idx on public.support_tickets (user_id, created_at desc);
create index if not exists support_tickets_status_idx on public.support_tickets (status, priority, created_at);

create table if not exists public.support_ticket_messages (
  id           uuid primary key default gen_random_uuid(),
  ticket_id    uuid not null references public.support_tickets(id) on delete cascade,
  author_id    uuid references auth.users(id) on delete set null,
  author_type  text not null default 'user',         -- user|staff|system|ai
  author_name  text not null,
  body         text not null,
  attachments  jsonb not null default '[]'::jsonb,
  is_internal  boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists support_ticket_messages_idx on public.support_ticket_messages (ticket_id, created_at);

-- ═════════════════════════ PAYMENT LINKS ══════════════════════════════════════
create table if not exists public.payment_links (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  code           text not null unique,               -- short public code in the URL
  label          text,
  description    text,
  amount         numeric(14,2) not null check (amount > 0),
  currency       text not null default 'ZMW' references public.currencies(code),
  allow_custom_amount boolean not null default false,
  min_amount     numeric(14,2),
  max_amount     numeric(14,2),
  invoice_id     uuid references public.invoices(id) on delete set null,
  order_id       uuid references public.orders(id) on delete set null,
  quotation_id   uuid references public.quotations(id) on delete set null,
  customer_id    uuid references public.customers(id) on delete set null,
  customer_name  text,
  customer_phone text,
  customer_email text,
  methods        public.payment_method[] not null default array['mobile_money','card','cash','bank_transfer'],
  status         text not null default 'active',      -- active|paid|expired|cancelled|paused
  expires_at     timestamptz,
  max_payments   integer,
  payments_count integer not null default 0,
  amount_collected numeric(14,2) not null default 0,
  message        text,                                 -- shown on the pay page
  thank_you_message text,
  redirect_url   text,
  auto_generate_receipt boolean not null default true,
  auto_update_invoice   boolean not null default true,
  created_by     uuid not null references auth.users(id) on delete restrict,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists payment_links_business_idx on public.payment_links (business_id, status, created_at desc);
create index if not exists payment_links_code_idx on public.payment_links (code) where status = 'active';

alter table public.payments
  drop constraint if exists payments_payment_link_fk,
  add constraint payments_payment_link_fk foreign key (payment_link_id)
    references public.payment_links(id) on delete set null;

alter table public.carts
  drop constraint if exists carts_order_fk,
  add constraint carts_order_fk foreign key (converted_order_id)
    references public.orders(id) on delete set null;

-- ═════════════════════════ updated_at triggers ════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array[
    'documents','signatures','document_templates','conversations','messages',
    'notifications','notification_preferences','email_logs','coupons','campaigns',
    'promotions','advertisements','loyalty_rules','plans','subscriptions',
    'invoices_platform','feature_limits','ai_conversations','automation_rules',
    'business_insights','reports','help_articles','academy_courses','academy_progress',
    'support_tickets','payment_links'
  ] loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function public.tg_set_updated_at()', t);
  end loop;
end $$;

select 'seedwel_hub: 0007 documents, AI & platform ok' as status;
