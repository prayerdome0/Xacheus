-- ══════════════════════════════════════════════════════════════════════════════
--  SEEDWEL HUB — 0009 · Business logic: onboarding, stock ledger, documents,
--                        checkout, payments & receipts, search, dashboard,
--                        coupons, audit & notifications
--
--  Everything here is SECURITY DEFINER with a pinned search_path: these are the
--  operations that MUST be atomic and MUST NOT be re-implemented client-side.
--  RLS still governs direct table access (see 0008).
-- ══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- AUDIT + NOTIFICATION PRIMITIVES
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.log_audit(
  p_business_id uuid,
  p_action      text,
  p_entity_type text,
  p_entity_id   uuid,
  p_entity_label text default null,
  p_changes     jsonb default null,
  p_metadata    jsonb default '{}'::jsonb
) returns bigint
language plpgsql security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_name text;
begin
  insert into public.audit_logs
    (business_id, actor_id, actor_name, action, entity_type, entity_id, entity_label, changes, metadata)
  values
    (p_business_id, auth.uid(),
     (select coalesce(display_name, full_name, email) from public.profiles where id = auth.uid()),
     p_action, p_entity_type, p_entity_id, p_entity_label, p_changes, p_metadata)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.notify_user(
  p_user_id uuid,
  p_type    public.notification_type,
  p_title   text,
  p_body    text default null,
  p_action_url text default null,
  p_business_id uuid default null,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_priority text default 'normal'
) returns uuid
language plpgsql security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if p_user_id is null then return null; end if;

  -- Respect the user's channel preferences for in-app delivery.
  if exists (
    select 1 from public.notification_preferences np
    where np.user_id = p_user_id and np.type = p_type and not np.in_app
  ) then
    return null;
  end if;

  insert into public.notifications
    (user_id, business_id, type, title, body, action_url, entity_type, entity_id, priority, sent_at)
  values (p_user_id, p_business_id, p_type, p_title, p_body, p_action_url, p_entity_type, p_entity_id, p_priority, now())
  returning id into v_id;
  return v_id;
end $$;

-- Notify every owner/administrator of a business (approval requests etc.)
create or replace function public.notify_business_owners(
  p_business_id uuid,
  p_type        public.notification_type,
  p_title       text,
  p_body        text default null,
  p_action_url  text default null,
  p_priority    text default 'normal'
) returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  r record; n integer := 0;
begin
  for r in
    select distinct u.id
    from (
      select b.owner_id as id from public.businesses b where b.id = p_business_id
      union
      select m.user_id from public.business_members m
      where m.business_id = p_business_id and m.status = 'active'
        and (m.role in ('owner','administrator') or m.can_approve_ai_actions)
    ) u
    where u.id is not null
  loop
    perform public.notify_user(r.id, p_type, p_title, p_body, p_action_url, p_business_id, null, null, p_priority);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Server-side money formatting so exception messages and notifications read the
-- same way the UI does ("K1,250.00"). STABLE because the symbol comes from the
-- configurable currencies table, never from hard-coded values.
create or replace function public.format_money(p_amount numeric, p_currency text default 'ZMW')
returns text
language sql stable security definer set search_path = public as $$
  select coalesce(c.symbol,'') || to_char(coalesce(p_amount,0),
         'FM999,999,999,990.' || repeat('0', greatest(coalesce(c.decimal_places,2),0)::int))
    from public.currencies c
   where c.code = coalesce(nullif(p_currency,''),'ZMW');
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ONBOARDING: register as a seller → business + store + defaults in one call
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.create_business(p_input jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_name       text := nullif(trim(p_input->>'name'),'');
  v_slug       text := nullif(trim(p_input->>'slug'),'');
  v_base       text;
  v_business   uuid;
  v_store      uuid;
  v_branch     uuid;
  v_warehouse  uuid;
  v_plan       uuid;
  v_country    text := coalesce(nullif(p_input->>'country_code',''),'ZM');
  v_currency   text;
  v_tax        uuid;
  v_i          integer := 0;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if v_name is null then
    raise exception 'business_name_required';
  end if;

  -- One active business per account in Phase 1 (multi-business later).
  if exists (select 1 from public.businesses b where b.owner_id = v_uid and b.deleted_at is null) then
    raise exception 'business_already_exists';
  end if;

  select coalesce(c.currency,'ZMW') into v_currency from public.countries c where c.code = v_country;
  v_currency := coalesce(nullif(p_input->>'base_currency',''), v_currency);

  -- Slug: requested → derived from name → derived + suffix until unique.
  v_base := coalesce(nullif(public.slugify(v_slug),''), public.slugify(v_name), 'store');
  v_slug := v_base;
  while exists (select 1 from public.businesses b where b.slug = v_slug)
        or exists (select 1 from public.stores s where s.slug = v_slug)
  loop
    v_i := v_i + 1;
    v_slug := v_base || '-' || v_i::text;
  end loop;

  -- Default tax for the country.
  select t.id into v_tax
  from public.taxes t
  where t.business_id is null and t.country_code = v_country and t.is_default and t.is_active
  order by t.rate desc limit 1;

  -- Everything the onboarding wizard collects is written here so a new seller
  -- never has to re-enter it in Settings. Booleans are only honoured when the
  -- key is present, which keeps the defaults for API callers.
  insert into public.businesses (
    owner_id, name, slug, legal_name, description, tagline, business_type, category_id,
    registration_number, tax_number, tax_registered,
    email, phone, phone_country_code, whatsapp, website, social,
    address_line1, address_line2, city, region, postal_code, country_code,
    opening_hours, base_currency, time_zone, locale, default_tax_id,
    primary_color, accent_color, logo_url, cover_url,
    invoice_prefix, quotation_prefix, receipt_prefix, order_prefix,
    invoice_terms, payment_terms_days, quotation_validity_days,
    accepts_orders, accepts_wholesale, is_public, delivery_enabled, delivery_fee, free_delivery_over,
    delivery_radius_km, growth_score
  ) values (
    v_uid, v_name, v_slug,
    nullif(p_input->>'legal_name',''), nullif(p_input->>'description',''), nullif(p_input->>'tagline',''),
    coalesce((p_input->>'business_type')::public.business_type,'sole_proprietorship'),
    nullif(p_input->>'category_id','')::uuid,
    nullif(p_input->>'registration_number',''), nullif(p_input->>'tax_number',''),
    coalesce((p_input->>'tax_registered')::boolean, nullif(p_input->>'tax_number','') is not null),
    coalesce(nullif(p_input->>'email',''), (select email from public.profiles where id = v_uid)),
    nullif(p_input->>'phone',''),
    coalesce(nullif(p_input->>'phone_country_code',''),
             (select phone_country_code from public.profiles where id = v_uid), '+260'),
    nullif(p_input->>'whatsapp',''), nullif(p_input->>'website',''),
    coalesce(nullif(p_input->'social','{}')::jsonb, '{}'::jsonb),
    nullif(p_input->>'address_line1',''), nullif(p_input->>'address_line2',''),
    nullif(p_input->>'city',''), nullif(p_input->>'region',''), nullif(p_input->>'postal_code',''),
    v_country,
    coalesce(nullif(p_input->'opening_hours','{}')::jsonb, '{}'::jsonb),
    v_currency,
    coalesce(nullif(p_input->>'time_zone',''), (select time_zone from public.countries where code = v_country), 'Africa/Lusaka'),
    coalesce(nullif(p_input->>'locale',''), (select locale from public.countries where code = v_country), 'en-ZM'),
    v_tax,
    coalesce(nullif(p_input->>'primary_color',''),'#0f766e'),
    coalesce(nullif(p_input->>'accent_color',''),'#f59e0b'),
    nullif(p_input->>'logo_url',''), nullif(p_input->>'cover_url',''),
    coalesce(nullif(p_input->>'invoice_prefix',''),'INV'),
    coalesce(nullif(p_input->>'quotation_prefix',''),'QTN'),
    coalesce(nullif(p_input->>'receipt_prefix',''),'RCP'),
    coalesce(nullif(p_input->>'order_prefix',''),'ORD'),
    nullif(p_input->>'invoice_terms',''),
    coalesce((p_input->>'payment_terms_days')::smallint, 7),
    coalesce((p_input->>'quotation_validity_days')::smallint, 14),
    coalesce((p_input->>'accepts_orders')::boolean, true),
    coalesce((p_input->>'accepts_wholesale')::boolean, false),
    coalesce((p_input->>'is_public')::boolean, true),
    coalesce((p_input->>'delivery_enabled')::boolean, false),
    coalesce((p_input->>'delivery_fee')::numeric(14,2), 0),
    (p_input->>'free_delivery_over')::numeric(14,2),
    (p_input->>'delivery_radius_km')::numeric(8,2),
    10
  ) returning id into v_business;

  -- Owner membership + role.
  insert into public.business_members (business_id, user_id, role, status, joined_at, email)
  values (v_business, v_uid, 'owner', 'active', now(),
          (select email from public.profiles where id = v_uid));

  -- Head office + main warehouse.
  insert into public.branches (business_id, name, kind, is_primary, city, country_code)
  values (v_business, coalesce(nullif(p_input->>'branch_name',''),'Head Office'), 'head_office', true,
          nullif(p_input->>'city',''), v_country)
  returning id into v_branch;

  insert into public.warehouses (business_id, branch_id, name, kind, is_primary, city, country_code)
  values (v_business, v_branch, coalesce(nullif(p_input->>'warehouse_name',''),'Main Stock'), 'warehouse', true,
          nullif(p_input->>'city',''), v_country)
  returning id into v_warehouse;

  -- The automatic online store.
  insert into public.stores (
    business_id, slug, name, tagline, description, logo_url, banner_url,
    primary_color, accent_color, contact_email, contact_phone, whatsapp, is_published
  ) values (
    v_business, v_slug, v_name, nullif(p_input->>'tagline',''), nullif(p_input->>'description',''),
    coalesce(nullif(p_input->>'logo_url',''), nullif(p_input->>'store_logo_url','')),
    coalesce(nullif(p_input->>'banner_url',''), nullif(p_input->>'cover_url','')),
    coalesce(nullif(p_input->>'primary_color',''),'#0f766e'),
    coalesce(nullif(p_input->>'accent_color',''),'#f59e0b'),
    coalesce(nullif(p_input->>'email',''), (select email from public.profiles where id = v_uid)),
    nullif(p_input->>'phone',''), nullif(p_input->>'whatsapp',''), true
  ) returning id into v_store;

  -- Expense categories from the platform template.
  insert into public.expense_categories (business_id, name, icon, sort_order, is_system)
  select v_business, t.name, t.icon, t.sort_order, true
  from public.expense_category_templates t
  on conflict (business_id, name) do nothing;

  -- Business tax configuration (copied from the country default, editable).
  if v_tax is not null then
    insert into public.taxes (business_id, country_code, name, rate, is_inclusive, is_default, applies_to)
    select v_business, t.country_code, t.name, t.rate, t.is_inclusive, true, t.applies_to
    from public.taxes t where t.id = v_tax
    on conflict do nothing;
  end if;

  -- Free plan subscription + 14-day trial of Starter.
  select p.id into v_plan from public.plans p where p.key = 'free' limit 1;
  if v_plan is not null then
    insert into public.subscriptions (business_id, plan_id, status, billing_cycle, amount, trial_ends_at,
                                      current_period_start, current_period_end)
    values (v_business, v_plan, 'active', 'monthly', 0, now() + interval '14 days', now(), now() + interval '1 month');
  end if;

  -- Upgrade the account roles: buyer + seller + business.
  update public.profiles p
     set roles = (select array(select distinct r from unnest(p.roles || array['seller','business']::public.user_role[]) r)),
         primary_role = case when p.primary_role = 'buyer' then 'business' else p.primary_role end,
         default_business = v_business,
         updated_at = now()
   where p.id = v_uid;

  perform public.log_audit(v_business, 'business.created', 'business', v_business, v_name,
                           null, jsonb_build_object('slug', v_slug));

  perform public.notify_user(v_uid, 'system', 'Your Seedwel store is ready',
    format('“%s” is live at /store/%s. Add your first products to start selling.', v_name, v_slug),
    format('/business/%s', v_slug), v_business);

  return jsonb_build_object(
    'business_id', v_business, 'store_id', v_store, 'slug', v_slug,
    'branch_id', v_branch, 'warehouse_id', v_warehouse,
    'store_url', format('/store/%s', v_slug));
end $$;

-- Convenience wrapper used by the "Become a seller" flow.
create or replace function public.register_as_seller(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update public.profiles p
     set roles = (select array(select distinct r from unnest(p.roles || array['seller']::public.user_role[]) r)),
         updated_at = now()
   where p.id = auth.uid();

  if coalesce((p_input->>'create_business')::boolean, true) then
    return public.create_business(p_input);
  end if;
  return jsonb_build_object('seller', true);
end $$;

create or replace function public.is_slug_available(p_slug text)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.businesses b where b.slug = lower(p_slug))
     and not exists (select 1 from public.stores s where s.slug = lower(p_slug));
$$;

create or replace function public.suggest_slug(p_name text)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_base text := coalesce(nullif(public.slugify(p_name),''),'store');
  v_slug text := v_base;
  v_i integer := 0;
begin
  while not public.is_slug_available(v_slug) loop
    v_i := v_i + 1;
    v_slug := v_base || '-' || v_i::text;
  end loop;
  return v_slug;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- INVENTORY: the stock ledger. Never UPDATE inventory directly from the client.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.adjust_stock(
  p_business_id   uuid,
  p_product_id    uuid,
  p_quantity_change integer,
  p_movement_type public.movement_type,
  p_warehouse_id  uuid default null,
  p_variant_id    uuid default null,
  p_unit_cost     numeric default null,
  p_reference_type text default null,
  p_reference_id  uuid default null,
  p_reference_number text default null,
  p_reason        text default null,
  p_notes         text default null,
  p_to_warehouse_id uuid default null
) returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_warehouse  uuid;
  v_inv        public.inventory;
  v_before     integer;
  v_after      integer;
  v_cost       numeric(14,2);
  v_product    public.products;
  v_allow_neg  boolean;
  v_total      integer;
begin
  if p_quantity_change = 0 then
    return jsonb_build_object('skipped', true);
  end if;
  if not public.can(p_business_id, 'inventory.write')
     and not public.can(p_business_id, 'inventory.adjust') then
    -- POS cashiers and salespeople move stock by selling.
    if p_movement_type not in ('sale','return_in','return_out') or not public.can(p_business_id,'pos.use') then
      raise exception 'permission_denied: inventory.write';
    end if;
  end if;

  select * into v_product from public.products where id = p_product_id for update;
  if not found then raise exception 'product_not_found'; end if;
  v_allow_neg := v_product.allow_backorder;

  v_warehouse := coalesce(p_warehouse_id,
    (select w.id from public.warehouses w
      where w.business_id = p_business_id and w.is_active
      order by w.is_primary desc, w.created_at limit 1));
  if v_warehouse is null then
    insert into public.warehouses (business_id, name, kind, is_primary)
    values (p_business_id, 'Main Stock', 'warehouse', true)
    returning id into v_warehouse;
  end if;

  v_cost := coalesce(p_unit_cost, v_product.cost_price, 0);

  -- Lock or create the inventory row.
  select * into v_inv from public.inventory
   where warehouse_id = v_warehouse and product_id = p_product_id
     and variant_id is not distinct from p_variant_id
   for update;

  if not found then
    insert into public.inventory (business_id, warehouse_id, product_id, variant_id,
                                  quantity_on_hand, unit_cost, reorder_point)
    values (p_business_id, v_warehouse, p_product_id, p_variant_id, 0, v_cost,
            coalesce(v_product.stock_alert, 5))
    returning * into v_inv;
  end if;

  v_before := v_inv.quantity_on_hand;
  v_after  := v_before + p_quantity_change;

  if v_after < 0 and not v_allow_neg then
    raise exception 'insufficient_stock: % available for %', v_before, v_product.name
      using hint = 'Reduce the quantity, receive stock first, or enable backorders on this product.';
  end if;

  update public.inventory
     set quantity_on_hand = v_after,
         unit_cost = case when p_unit_cost is not null then p_unit_cost else unit_cost end,
         last_movement_at = now(),
         updated_at = now()
   where id = v_inv.id;

  insert into public.inventory_movements (
    business_id, warehouse_id, inventory_id, product_id, variant_id, movement_type,
    quantity_change, quantity_before, quantity_after, unit_cost, total_value,
    reference_type, reference_id, reference_number, to_warehouse_id, reason, notes,
    performed_by, performed_name)
  values (
    p_business_id, v_warehouse, v_inv.id, p_product_id, p_variant_id, p_movement_type,
    p_quantity_change, v_before, v_after, v_cost, v_cost * abs(p_quantity_change),
    p_reference_type, p_reference_id, p_reference_number, p_to_warehouse_id, p_reason, p_notes,
    auth.uid(),
    (select coalesce(display_name, full_name, email) from public.profiles where id = auth.uid()));

  -- Keep the product aggregate in sync across all warehouses.
  if v_product.track_inventory then
    select coalesce(sum(i.quantity_on_hand),0) into v_total
    from public.inventory i
    where i.product_id = p_product_id
      and (p_variant_id is null or i.variant_id = p_variant_id or i.variant_id is null);

    update public.products
       set stock = coalesce(v_total, v_after),
           status = case
             when status = 'archived' or status = 'blocked' then status
             when coalesce(v_total, v_after) <= 0 and is_published then 'out_of_stock'
             when coalesce(v_total, v_after) > 0 and status = 'out_of_stock' then 'active'
             else status end,
           updated_at = now()
     where id = p_product_id;

    if p_variant_id is not null then
      update public.product_variants set stock = v_after, updated_at = now() where id = p_variant_id;
    end if;
  end if;

  -- Low-stock alert to owners (throttled to one per day per product).
  if v_after <= coalesce(v_inv.reorder_point, v_product.stock_alert, 5) and v_after >= 0 then
    if not exists (
      select 1 from public.notifications n
      where n.business_id = p_business_id and n.type = 'stock'
        and n.entity_id = p_product_id and n.created_at > now() - interval '1 day'
    ) then
      perform public.notify_business_owners(p_business_id, 'stock',
        format('Low stock: %s', v_product.name),
        format('%s unit(s) left (reorder point %s).', v_after,
               coalesce(v_inv.reorder_point, v_product.stock_alert)),
        format('/business/inventory?product=%s', p_product_id), 'high');
    end if;
  end if;

  return jsonb_build_object(
    'product_id', p_product_id, 'warehouse_id', v_warehouse,
    'before', v_before, 'after', v_after, 'change', p_quantity_change,
    'low_stock', v_after <= coalesce(v_inv.reorder_point, v_product.stock_alert, 5));
end $$;

-- Transfer between warehouses/shops in one atomic step.
create or replace function public.transfer_stock(
  p_transfer_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_t   public.stock_transfers;
  v_i   record;
  v_n   integer := 0;
begin
  select * into v_t from public.stock_transfers where id = p_transfer_id for update;
  if not found then raise exception 'transfer_not_found'; end if;
  if not public.can(v_t.business_id,'inventory.transfer') then
    raise exception 'permission_denied: inventory.transfer';
  end if;

  for v_i in select * from public.stock_transfer_items where transfer_id = p_transfer_id loop
    perform public.adjust_stock(v_t.business_id, v_i.product_id, -(v_i.quantity_received),
      'transfer_out', v_t.from_warehouse_id, v_i.variant_id, v_i.unit_cost,
      'transfer', v_t.id, v_t.transfer_number, null,
      format('Transfer to %s', (select name from public.warehouses where id = v_t.to_warehouse_id)),
      v_t.to_warehouse_id);
    perform public.adjust_stock(v_t.business_id, v_i.product_id, v_i.quantity_received,
      'transfer_in', v_t.to_warehouse_id, v_i.variant_id, v_i.unit_cost,
      'transfer', v_t.id, v_t.transfer_number, null,
      format('Transfer from %s', (select name from public.warehouses where id = v_t.from_warehouse_id)),
      v_t.from_warehouse_id);
    v_n := v_n + 1;
  end loop;

  update public.stock_transfers
     set status = 'received', received_at = now(), received_by = auth.uid(), updated_at = now()
   where id = p_transfer_id;

  perform public.log_audit(v_t.business_id, 'inventory.transfer_received', 'stock_transfer',
                           p_transfer_id, v_t.transfer_number, null,
                           jsonb_build_object('items', v_n));

  return jsonb_build_object('transfer_id', p_transfer_id, 'items', v_n, 'status', 'received');
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- DOCUMENTS: share tokens, view tracking, verification
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.create_share_token(
  p_entity_type text,     -- invoice|quotation|receipt|document|payment_link|delivery_note
  p_entity_id   uuid,
  p_expires_in_days integer default 30
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_token text := encode(gen_random_bytes(16), 'hex');
  v_business uuid;
begin
  case p_entity_type
    when 'invoice' then
      select business_id into v_business from public.invoices where id = p_entity_id;
      update public.invoices set share_token = v_token,
        qr_token = coalesce(qr_token, v_token) where id = p_entity_id;
    when 'quotation' then
      select business_id into v_business from public.quotations where id = p_entity_id;
      update public.quotations set share_token = v_token where id = p_entity_id;
    when 'receipt' then
      select business_id into v_business from public.receipts where id = p_entity_id;
      update public.receipts set share_token = v_token,
        qr_token = coalesce(qr_token, v_token) where id = p_entity_id;
    when 'payment_link' then
      select business_id into v_business from public.payment_links where id = p_entity_id;
    when 'delivery_note' then
      select business_id into v_business from public.delivery_notes where id = p_entity_id;
      update public.delivery_notes set share_token = v_token where id = p_entity_id;
    when 'document' then
      select business_id into v_business from public.documents where id = p_entity_id;
      update public.documents set share_token = v_token,
        share_expires_at = now() + make_interval(days => p_expires_in_days) where id = p_entity_id;
    else raise exception 'unknown_entity_type: %', p_entity_type;
  end case;

  if v_business is null then raise exception 'entity_not_found'; end if;
  if not public.can(v_business, 'documents.send')
     and not public.can(v_business, 'invoices.send')
     and not public.can(v_business, 'payments.record') then
    raise exception 'permission_denied: documents.send';
  end if;

  return v_token;
end $$;

create or replace function public.mark_document_viewed(
  p_entity_type text,
  p_share_token text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_status text; v_business uuid;
begin
  case p_entity_type
    when 'invoice' then
      select id, status::text, business_id into v_id, v_status, v_business
        from public.invoices where share_token = p_share_token or qr_token = p_share_token;
      update public.invoices
         set viewed_at = now(), viewed_count = viewed_count + 1,
             status = case when status = 'sent' then 'viewed'::public.doc_status else status end
       where id = v_id;
    when 'quotation' then
      select id, status::text, business_id into v_id, v_status, v_business
        from public.quotations where share_token = p_share_token;
      update public.quotations set viewed_at = now(),
             status = case when status = 'sent' then 'viewed'::public.doc_status else status end
       where id = v_id;
    when 'receipt' then
      select id, business_id into v_id, v_business from public.receipts
       where share_token = p_share_token or qr_token = p_share_token;
    else raise exception 'unknown_entity_type: %', p_entity_type;
  end case;

  if v_id is null then
    return jsonb_build_object('found', false);
  end if;

  insert into public.document_events (document_id, event, actor_type, ip_address, user_agent)
  select d.id, 'viewed', 'customer', null, null
    from public.documents d
   where d.entity_type = p_entity_type and d.entity_id = v_id
   limit 1;

  perform public.notify_business_owners(v_business, 'invoice',
    format('%s %s was viewed', initcap(p_entity_type),
           coalesce((select invoice_number from public.invoices where id = v_id),
                    (select quotation_number from public.quotations where id = v_id), '')),
    'Your customer opened the document.',
    format('/business/%ss/%s', p_entity_type, v_id));

  return jsonb_build_object('found', true, 'entity_id', v_id, 'previous_status', v_status);
end $$;

-- Public document fetch for share links (token-gated, never exposes RLS rows).
create or replace function public.get_shared_document(p_entity_type text, p_share_token text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_doc jsonb;
  v_id  uuid;
begin
  case p_entity_type
    when 'invoice' then
      select i.id into v_id from public.invoices i
       where (i.share_token = p_share_token or i.qr_token = p_share_token) and i.deleted_at is null;
      if v_id is null then return jsonb_build_object('found', false); end if;
      select jsonb_build_object(
        'found', true, 'kind', 'invoice',
        'invoice', to_jsonb(i),
        'items', coalesce((select jsonb_agg(to_jsonb(ii) order by ii.sort_order, ii.created_at)
                            from public.invoice_items ii where ii.invoice_id = i.id),'[]'::jsonb),
        'business', (select jsonb_build_object('name',b.name,'logo_url',b.logo_url,'email',b.email,
                        'phone',b.phone,'address_line1',b.address_line1,'city',b.city,
                        'country_code',b.country_code,'tax_number',b.tax_number,'bank_details',b.bank_details,
                        'invoice_terms',b.invoice_terms,'invoice_footer',b.invoice_footer)
                      from public.businesses b where b.id = i.business_id),
        'customer', (select jsonb_build_object('name',c.name,'email',c.email,'phone',c.phone,
                        'address_line1',c.address_line1,'city',c.city,'tax_number',c.tax_number)
                      from public.customers c where c.id = i.customer_id),
        'payments', coalesce((select jsonb_agg(jsonb_build_object('amount',p.amount,'method',p.method,
                        'received_at',p.received_at,'reference',p.provider_reference) order by p.received_at)
                       from public.payments p where p.invoice_id = i.id and p.status = 'completed'),'[]'::jsonb)
      ) into v_doc
      from public.invoices i where i.id = v_id;

    when 'quotation' then
      select q.id into v_id from public.quotations q
       where q.share_token = p_share_token and q.deleted_at is null;
      if v_id is null then return jsonb_build_object('found', false); end if;
      select jsonb_build_object(
        'found', true, 'kind', q.kind,
        'quotation', to_jsonb(q),
        'items', coalesce((select jsonb_agg(to_jsonb(qi) order by qi.sort_order, qi.created_at)
                            from public.quotation_items qi where qi.quotation_id = q.id),'[]'::jsonb),
        'business', (select jsonb_build_object('name',b.name,'logo_url',b.logo_url,'email',b.email,
                        'phone',b.phone,'address_line1',b.address_line1,'city',b.city,
                        'country_code',b.country_code,'invoice_terms',b.invoice_terms)
                      from public.businesses b where b.id = q.business_id),
        'customer', (select jsonb_build_object('name',c.name,'email',c.email,'phone',c.phone,
                        'address_line1',c.address_line1,'city',c.city)
                      from public.customers c where c.id = q.customer_id)
      ) into v_doc
      from public.quotations q where q.id = v_id;

    when 'receipt' then
      select r.id into v_id from public.receipts r
       where (r.share_token = p_share_token or r.qr_token = p_share_token) and r.deleted_at is null;
      if v_id is null then return jsonb_build_object('found', false); end if;
      select jsonb_build_object(
        'found', true, 'kind', 'receipt',
        'receipt', to_jsonb(r),
        'business', (select jsonb_build_object('name',b.name,'logo_url',b.logo_url,'email',b.email,
                        'phone',b.phone,'city',b.city,'country_code',b.country_code)
                      from public.businesses b where b.id = r.business_id),
        'invoice_number', (select i.invoice_number from public.invoices i where i.id = r.invoice_id)
      ) into v_doc
      from public.receipts r where r.id = v_id;

    else raise exception 'unknown_entity_type: %', p_entity_type;
  end case;

  perform public.mark_document_viewed(p_entity_type, p_share_token);
  return v_doc;
end $$;

-- Customer responds to a quotation (accept / reject / request changes).
create or replace function public.respond_to_quotation(
  p_share_token text,
  p_response    text,        -- accepted|rejected|change_requested
  p_signer_name text default null,
  p_note        text default null,
  p_signature_image text default null   -- data URL of the drawn signature
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_q      public.quotations;
  v_sig    uuid;
  v_status public.doc_status;
begin
  select * into v_q from public.quotations where share_token = p_share_token for update;
  if not found then raise exception 'quotation_not_found'; end if;
  if v_q.expires_at is not null and v_q.expires_at < now() then
    raise exception 'quotation_expired';
  end if;

  v_status := case p_response
    when 'accepted' then 'accepted'::public.doc_status
    when 'rejected' then 'rejected'::public.doc_status
    when 'change_requested' then 'change_requested'::public.doc_status
    else raise exception 'invalid_response: %', p_response
  end;

  if p_signature_image is not null and p_response = 'accepted' then
    insert into public.signatures (business_id, signer_name, signer_email, method, image_data,
                                   intent_text, ip_address, signed_at)
    values (v_q.business_id, coalesce(p_signer_name, v_q.signer_name, 'Customer'),
            (select email from public.customers c where c.id = v_q.customer_id),
            'drawn', p_signature_image,
            format('Accepted %s %s', v_q.kind, v_q.quotation_number),
            null, now())
    returning id into v_sig;
  end if;

  update public.quotations
     set status = v_status, responded_at = now(), response_note = p_note,
         signature_id = coalesce(v_sig, signature_id),
         signed_at = case when v_sig is not null then now() else signed_at end,
         signer_name = coalesce(p_signer_name, signer_name)
   where id = v_q.id;

  perform public.notify_business_owners(v_q.business_id, 'quotation',
    format('%s %s', initcap(replace(p_response,'_',' ')), v_q.quotation_number),
    coalesce(p_note, format('Total %s', v_q.total)),
    format('/business/quotations/%s', v_q.id), 'high');

  return jsonb_build_object('quotation_id', v_q.id, 'status', v_status, 'signature_id', v_sig);
end $$;

-- Convert a quotation (or pro-forma) into a tax invoice — one button.
create or replace function public.convert_quotation_to_invoice(p_quotation_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_q     public.quotations;
  v_inv   uuid;
  v_items jsonb;
begin
  select * into v_q from public.quotations where id = p_quotation_id for update;
  if not found then raise exception 'quotation_not_found'; end if;
  if not public.can(v_q.business_id,'invoices.write') then
    raise exception 'permission_denied: invoices.write';
  end if;
  if v_q.converted_invoice_id is not null then
    return v_q.converted_invoice_id;   -- idempotent
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'product_id', qi.product_id, 'variant_id', qi.variant_id, 'service_id', qi.service_id,
      'description', qi.description, 'quantity', qi.quantity, 'unit', qi.unit,
      'unit_price', qi.unit_price, 'discount_percent', qi.discount_percent,
      'discount_amount', qi.discount_amount, 'tax_rate', qi.tax_rate, 'notes', qi.notes)
      order by qi.sort_order), '[]'::jsonb)
    into v_items
    from public.quotation_items qi where qi.quotation_id = p_quotation_id;

  v_inv := public.create_invoice(jsonb_build_object(
    'business_id', v_q.business_id,
    'customer_id', v_q.customer_id,
    'buyer_user_id', v_q.buyer_user_id,
    'quotation_id', v_q.id,
    'currency', v_q.currency,
    'kind', 'tax_invoice',
    'items', v_items,
    'notes', v_q.notes,
    'terms', v_q.terms,
    'delivery_fee', v_q.delivery_fee,
    'reference', v_q.quotation_number));

  update public.quotations
     set converted_invoice_id = v_inv, converted_at = now(), updated_at = now()
   where id = p_quotation_id;

  update public.invoices set quotation_id = v_q.id where id = v_inv;

  perform public.log_audit(v_q.business_id, 'quotation.converted_to_invoice', 'quotation',
                           p_quotation_id, v_q.quotation_number, null,
                           jsonb_build_object('invoice_id', v_inv));
  return v_inv;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- DOCUMENT CREATION (server-computed totals; client can never fake a total)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.create_invoice(p_input jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_business uuid := (p_input->>'business_id')::uuid;
  v_customer uuid := nullif(p_input->>'customer_id','')::uuid;
  v_order    uuid := nullif(p_input->>'order_id','')::uuid;
  v_items    jsonb := coalesce(p_input->'items','[]'::jsonb);
  v_inv      uuid;
  v_number   text;
  v_kind     text := coalesce(p_input->>'kind','tax_invoice');
  v_terms    smallint;
  v_item     jsonb;
  v_desc     text;
  v_qty      numeric;
  v_price    numeric;
  v_disc_pct numeric;
  v_disc_amt numeric;
  v_tax_rate numeric;
  v_subtotal numeric;
  v_tax_amt  numeric;
  v_line     numeric;
  v_sort     integer := 0;
  v_product  public.products;
  v_tax_id   uuid;
begin
  if v_business is null then raise exception 'business_id_required'; end if;
  if not public.can(v_business,'invoices.write') then
    raise exception 'permission_denied: invoices.write';
  end if;
  if jsonb_array_length(v_items) = 0 then raise exception 'invoice_items_required'; end if;

  select coalesce(b.payment_terms_days, 7) into v_terms from public.businesses b where b.id = v_business;
  v_terms := coalesce(nullif(p_input->>'terms_days','')::smallint, v_terms);

  -- Auto-create the customer from an inline object when none is supplied.
  if v_customer is null and p_input ? 'customer' then
    v_customer := public.upsert_customer(v_business, p_input->'customer');
  end if;

  v_number := coalesce(nullif(p_input->>'invoice_number',''),
                       public.next_document_number(v_business, 'invoice'));

  insert into public.invoices (
    business_id, invoice_number, kind, customer_id, buyer_user_id, order_id, quotation_id,
    branch_id, status, currency, exchange_rate, issue_date, due_date, terms_days, terms,
    notes, reference, created_by, created_by_name, qr_token, share_token, delivery_fee)
  values (
    v_business, v_number, v_kind, v_customer,
    nullif(p_input->>'buyer_user_id','')::uuid, v_order,
    nullif(p_input->>'quotation_id','')::uuid,
    nullif(p_input->>'branch_id','')::uuid,
    coalesce((p_input->>'status')::public.doc_status,'draft'),
    coalesce(nullif(p_input->>'currency',''),
             (select base_currency from public.businesses where id = v_business), 'ZMW'),
    coalesce((p_input->>'exchange_rate')::numeric, 1),
    coalesce((p_input->>'issue_date')::date, current_date),
    coalesce((p_input->>'due_date')::date, current_date + v_terms),
    v_terms,
    coalesce(nullif(p_input->>'terms',''), (select invoice_terms from public.businesses where id = v_business)),
    nullif(p_input->>'notes',''), nullif(p_input->>'reference',''),
    auth.uid(),
    (select coalesce(display_name, full_name, email) from public.profiles where id = auth.uid()),
    encode(gen_random_bytes(10),'hex'),
    case when coalesce((p_input->>'create_share_link')::boolean, false)
         then encode(gen_random_bytes(16),'hex') end,
    coalesce((p_input->>'delivery_fee')::numeric, 0))
  returning id into v_inv;

  for v_item in select * from jsonb_array_elements(v_items) loop
    v_sort := v_sort + 1;
    v_qty      := coalesce((v_item->>'quantity')::numeric, 1);
    v_price    := coalesce((v_item->>'unit_price')::numeric, 0);
    v_disc_pct := coalesce((v_item->>'discount_percent')::numeric, 0);
    v_disc_amt := coalesce((v_item->>'discount_amount')::numeric,
                           round(v_qty * v_price * v_disc_pct / 100.0, 2));
    v_desc     := nullif(v_item->>'description','');

    -- Pull name/price/tax from the product when only an id is given.
    if (v_item->>'product_id') is not null then
      select * into v_product from public.products where id = (v_item->>'product_id')::uuid;
      if found then
        v_desc := coalesce(v_desc, v_product.name);
        v_price := coalesce(nullif(v_item->>'unit_price','')::numeric, v_product.price);
        v_tax_id := v_product.tax_id;
      end if;
    end if;

    v_tax_rate := coalesce(
      (v_item->>'tax_rate')::numeric,
      (select t.rate from public.taxes t where t.id = v_tax_id and t.is_active),
      (select t.rate from public.taxes t where t.business_id = v_business and t.is_default and t.is_active limit 1),
      0);

    v_subtotal := round(v_qty * v_price - v_disc_amt, 2);
    v_tax_amt  := case when coalesce((v_item->>'tax_inclusive')::boolean, false)
                       then round(v_subtotal - (v_subtotal / (1 + v_tax_rate/100.0)), 2)
                       else round(v_subtotal * v_tax_rate / 100.0, 2) end;
    v_line     := v_subtotal + v_tax_amt;

    insert into public.invoice_items (
      invoice_id, product_id, variant_id, service_id, order_item_id, description,
      quantity, unit, unit_price, discount_amount, discount_percent, tax_rate,
      tax_amount, line_subtotal, line_total, sort_order, notes)
    values (
      v_inv, nullif(v_item->>'product_id','')::uuid, nullif(v_item->>'variant_id','')::uuid,
      nullif(v_item->>'service_id','')::uuid, nullif(v_item->>'order_item_id','')::uuid,
      coalesce(v_desc, 'Item'),
      v_qty, coalesce(v_item->>'unit','piece'), v_price, v_disc_amt, v_disc_pct, v_tax_rate,
      v_tax_amt, v_subtotal, v_line, v_sort, nullif(v_item->>'notes',''));
  end loop;

  perform public.recalculate_invoice_totals(v_inv);

  -- Mirror into the document centre so "My Documents" is one query.
  insert into public.documents (business_id, doc_number, doc_type, title, status, entity_type,
                                entity_id, customer_id, currency, total, issue_date, due_date,
                                requires_signature, created_by, created_by_name)
  select v_business, v_number,
         case v_kind when 'credit_note' then 'credit_note'::public.doc_type
                     when 'debit_note' then 'debit_note'::public.doc_type
                     when 'proforma' then 'proforma_invoice'::public.doc_type
                     else 'invoice'::public.doc_type end,
         format('%s %s', initcap(replace(v_kind,'_',' ')), v_number),
         (select status from public.invoices where id = v_inv),
         'invoice', v_inv, v_customer,
         (select currency from public.invoices where id = v_inv),
         (select total from public.invoices where id = v_inv),
         (select issue_date from public.invoices where id = v_inv),
         (select due_date from public.invoices where id = v_inv),
         false, auth.uid(),
         (select coalesce(display_name, full_name) from public.profiles where id = auth.uid())
  on conflict (business_id, doc_type, doc_number) do nothing;

  perform public.log_audit(v_business, 'invoice.created', 'invoice', v_inv, v_number);
  return v_inv;
end $$;

create or replace function public.create_quotation(p_input jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_business uuid := (p_input->>'business_id')::uuid;
  v_customer uuid := nullif(p_input->>'customer_id','')::uuid;
  v_items    jsonb := coalesce(p_input->'items','[]'::jsonb);
  v_qtn      uuid;
  v_number   text;
  v_kind     text := coalesce(p_input->>'kind','quotation');
  v_validity smallint;
  v_item     jsonb;
  v_desc     text;
  v_qty      numeric; v_price numeric; v_disc_pct numeric; v_disc_amt numeric;
  v_tax_rate numeric; v_subtotal numeric; v_tax_amt numeric; v_sort integer := 0;
  v_product  public.products;
  v_tax_id   uuid;
begin
  if v_business is null then raise exception 'business_id_required'; end if;
  if not public.can(v_business,'quotations.write') then
    raise exception 'permission_denied: quotations.write';
  end if;
  if jsonb_array_length(v_items) = 0 then raise exception 'quotation_items_required'; end if;

  if v_customer is null and p_input ? 'customer' then
    v_customer := public.upsert_customer(v_business, p_input->'customer');
  end if;

  select coalesce(b.quotation_validity_days,14) into v_validity from public.businesses b where b.id = v_business;
  v_validity := coalesce(nullif(p_input->>'validity_days','')::smallint, v_validity);
  v_number := coalesce(nullif(p_input->>'quotation_number',''),
                       public.next_document_number(v_business,'quotation'));

  insert into public.quotations (
    business_id, quotation_number, kind, customer_id, buyer_user_id, branch_id, status, title,
    currency, issue_date, validity_days, valid_until, terms, notes, delivery_method,
    shipping_address, created_by, created_by_name, share_token, delivery_fee)
  values (
    v_business, v_number, v_kind, v_customer,
    nullif(p_input->>'buyer_user_id','')::uuid, nullif(p_input->>'branch_id','')::uuid,
    coalesce((p_input->>'status')::public.doc_status,'draft'),
    nullif(p_input->>'title',''),
    coalesce(nullif(p_input->>'currency',''),
             (select base_currency from public.businesses where id = v_business),'ZMW'),
    coalesce((p_input->>'issue_date')::date, current_date), v_validity,
    coalesce((p_input->>'valid_until')::date, current_date + v_validity),
    coalesce(nullif(p_input->>'terms',''), (select invoice_terms from public.businesses where id = v_business)),
    nullif(p_input->>'notes',''), nullif(p_input->>'delivery_method',''),
    nullif(p_input->>'shipping_address',''),
    auth.uid(),
    (select coalesce(display_name, full_name, email) from public.profiles where id = auth.uid()),
    encode(gen_random_bytes(16),'hex'),
    coalesce((p_input->>'delivery_fee')::numeric,0))
  returning id into v_qtn;

  for v_item in select * from jsonb_array_elements(v_items) loop
    v_sort := v_sort + 1;
    v_qty := coalesce((v_item->>'quantity')::numeric,1);
    v_price := coalesce((v_item->>'unit_price')::numeric,0);
    v_disc_pct := coalesce((v_item->>'discount_percent')::numeric,0);
    v_disc_amt := coalesce((v_item->>'discount_amount')::numeric,
                           round(v_qty*v_price*v_disc_pct/100.0,2));
    v_desc := nullif(v_item->>'description','');

    if (v_item->>'product_id') is not null then
      select * into v_product from public.products where id = (v_item->>'product_id')::uuid;
      if found then
        v_desc := coalesce(v_desc, v_product.name);
        v_price := coalesce(nullif(v_item->>'unit_price','')::numeric, v_product.price);
        v_tax_id := v_product.tax_id;
      end if;
    elsif (v_item->>'service_id') is not null then
      select s.name, s.price into v_desc, v_price
        from public.services s where s.id = (v_item->>'service_id')::uuid;
      v_desc := coalesce(nullif(v_item->>'description',''), v_desc);
    end if;

    v_tax_rate := coalesce((v_item->>'tax_rate')::numeric,
      (select t.rate from public.taxes t where t.id = v_tax_id and t.is_active),
      (select t.rate from public.taxes t where t.business_id = v_business and t.is_default and t.is_active limit 1),
      0);

    v_subtotal := round(v_qty*v_price - v_disc_amt, 2);
    v_tax_amt := round(v_subtotal * v_tax_rate/100.0, 2);

    insert into public.quotation_items (
      quotation_id, product_id, variant_id, service_id, description, quantity, unit, unit_price,
      discount_amount, discount_percent, tax_rate, tax_amount, line_total, sort_order, is_optional, notes)
    values (
      v_qtn, nullif(v_item->>'product_id','')::uuid, nullif(v_item->>'variant_id','')::uuid,
      nullif(v_item->>'service_id','')::uuid, coalesce(v_desc,'Item'), v_qty,
      coalesce(v_item->>'unit','piece'), v_price, v_disc_amt, v_disc_pct, v_tax_rate, v_tax_amt,
      v_subtotal + v_tax_amt, v_sort, coalesce((v_item->>'is_optional')::boolean,false),
      nullif(v_item->>'notes',''));
  end loop;

  perform public.recalculate_quotation_totals(v_qtn);

  insert into public.documents (business_id, doc_number, doc_type, title, status, entity_type,
                                entity_id, customer_id, currency, total, issue_date, share_token,
                                created_by, created_by_name)
  select v_business, v_number,
         case v_kind when 'proforma' then 'proforma_invoice'::public.doc_type else 'quotation'::public.doc_type end,
         format('%s %s', case v_kind when 'proforma' then 'Pro-forma Invoice' else 'Quotation' end, v_number),
         (select status from public.quotations where id = v_qtn),
         'quotation', v_qtn, v_customer,
         (select currency from public.quotations where id = v_qtn),
         (select total from public.quotations where id = v_qtn),
         (select issue_date from public.quotations where id = v_qtn),
         (select share_token from public.quotations where id = v_qtn),
         auth.uid(), (select coalesce(display_name, full_name) from public.profiles where id = auth.uid())
  on conflict (business_id, doc_type, doc_number) do nothing;

  perform public.log_audit(v_business, 'quotation.created', 'quotation', v_qtn, v_number);
  return v_qtn;
end $$;

-- ── CUSTOMER upsert (used by every document flow: "Customer → Products → Total")
create or replace function public.upsert_customer(p_business_id uuid, p_input jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid := nullif(p_input->>'id','')::uuid;
  v_name text := nullif(trim(p_input->>'name'),'');
  v_phone text := nullif(trim(p_input->>'phone'),'');
  v_email text := nullif(lower(trim(p_input->>'email')),'');
  v_number text;
begin
  if not public.can(p_business_id,'customers.write') then
    raise exception 'permission_denied: customers.write';
  end if;

  if v_id is not null then
    update public.customers c
       set name = coalesce(v_name, c.name),
           phone = coalesce(v_phone, c.phone),
           email = coalesce(v_email, c.email),
           company_name = coalesce(nullif(p_input->>'company_name',''), c.company_name),
           city = coalesce(nullif(p_input->>'city',''), c.city),
           address_line1 = coalesce(nullif(p_input->>'address_line1',''), c.address_line1),
           customer_group = coalesce(nullif(p_input->>'customer_group',''), c.customer_group),
           notes = coalesce(nullif(p_input->>'notes',''), c.notes),
           updated_at = now()
     where c.id = v_id and c.business_id = p_business_id
     returning c.id into v_id;
    if v_id is not null then return v_id; end if;
  end if;

  -- Match an existing contact by phone or email before creating a duplicate.
  if v_phone is not null or v_email is not null then
    select c.id into v_id from public.customers c
     where c.business_id = p_business_id and c.deleted_at is null
       and ((v_phone is not null and c.phone = v_phone) or (v_email is not null and c.email = v_email))
     limit 1;
    if v_id is not null then
      update public.customers c
         set name = coalesce(nullif(c.name,''), v_name),
             email = coalesce(c.email, v_email),
             phone = coalesce(c.phone, v_phone),
             updated_at = now()
       where c.id = v_id;
      return v_id;
    end if;
  end if;

  if v_name is null then raise exception 'customer_name_required'; end if;

  select 'CUS-' || lpad((count(*)+1)::text, 5, '0') into v_number
    from public.customers where business_id = p_business_id;

  insert into public.customers (business_id, customer_number, name, company_name, email, phone,
    phone_country_code, city, region, address_line1, country_code, customer_group, notes, source,
    currency, created_by)
  values (p_business_id, v_number, v_name, nullif(p_input->>'company_name',''), v_email, v_phone,
    coalesce(nullif(p_input->>'phone_country_code',''),
             (select phone_country_code from public.businesses where id = p_business_id), '+260'),
    nullif(p_input->>'city',''), nullif(p_input->>'region',''), nullif(p_input->>'address_line1',''),
    coalesce(nullif(p_input->>'country_code',''),
             (select country_code from public.businesses where id = p_business_id), 'ZM'),
    coalesce(nullif(p_input->>'customer_group',''),'retail'),
    nullif(p_input->>'notes',''),
    coalesce(nullif(p_input->>'source',''),'manual'),
    coalesce(nullif(p_input->>'currency',''),
             (select base_currency from public.businesses where id = p_business_id), 'ZMW'),
    auth.uid())
  returning id into v_id;

  return v_id;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- CHECKOUT / POS: order → stock → invoice → payment → receipt
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.create_order(p_input jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_business  uuid := (p_input->>'business_id')::uuid;
  v_items     jsonb := coalesce(p_input->'items','[]'::jsonb);
  v_order     uuid;
  v_number    text;
  v_customer  uuid := nullif(p_input->>'customer_id','')::uuid;
  v_channel   public.order_channel := coalesce((p_input->>'channel')::public.order_channel,'marketplace');
  v_item      jsonb;
  v_product   public.products;
  v_variant   public.product_variants;
  v_pid       uuid;
  v_vid       uuid;
  v_sid       uuid;
  v_qty       integer;
  v_price     numeric;
  v_cost      numeric;
  v_disc_amt  numeric;
  v_tax_rate  numeric;
  v_line_sub  numeric;
  v_line_tax  numeric;
  v_line_tot  numeric;
  v_line_profit numeric;
  v_wholesale boolean;
  v_subtotal  numeric := 0;
  v_discount  numeric := 0;
  v_tax       numeric := 0;
  v_delivery  numeric := 0;
  v_tip       numeric := 0;
  v_total     numeric;
  v_currency  text;
  v_warehouse uuid;
  v_coupon    public.coupons;
  v_coupon_discount numeric := 0;
  v_free_over numeric;
  v_delivery_method text;
  v_name      text;
  v_sku       text;
  v_image     text;
  v_unit      text;
  v_status    public.order_status;
begin
  if jsonb_array_length(v_items) = 0 then raise exception 'order_items_required'; end if;

  -- Marketplace buyers place their own order; staff place orders on behalf of
  -- customers (POS / manual / store).
  if v_channel in ('pos','manual','store') then
    if not public.can(v_business,'orders.write') then
      raise exception 'permission_denied: orders.write';
    end if;
  elsif auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  select coalesce(b.base_currency,'ZMW') into v_currency
    from public.businesses b where b.id = v_business;
  v_currency := coalesce(nullif(p_input->>'currency',''), v_currency);

  select w.id into v_warehouse from public.warehouses w
   where w.business_id = v_business and w.is_active
   order by w.is_primary desc, w.created_at limit 1;
  v_warehouse := coalesce(nullif(p_input->>'warehouse_id','')::uuid, v_warehouse);

  if v_customer is null and p_input ? 'customer' then
    v_customer := public.upsert_customer(v_business, p_input->'customer');
  end if;
  if v_customer is null and coalesce((p_input->>'buyer_user_id'),'') <> '' then
    select c.id into v_customer from public.customers c
     where c.business_id = v_business and c.user_id = (p_input->>'buyer_user_id')::uuid limit 1;
  end if;

  v_delivery_method := coalesce(nullif(p_input->>'delivery_method',''),'pickup');
  v_status := coalesce((p_input->>'status')::public.order_status,
                       case when v_channel = 'pos' then 'confirmed'::public.order_status
                            else 'pending'::public.order_status end);
  v_number := coalesce(nullif(p_input->>'order_number',''),
                       public.next_document_number(v_business,'order'));

  insert into public.orders (
    business_id, order_number, customer_id, buyer_user_id, cart_id, branch_id, warehouse_id,
    served_by, served_by_name, channel, status, payment_status, currency, delivery_method,
    shipping_name, shipping_phone, shipping_line1, shipping_line2, shipping_city, shipping_region,
    shipping_postal_code, shipping_country, delivery_notes, notes, customer_note, reference,
    is_wholesale, quotation_id, placed_at)
  values (
    v_business, v_number, v_customer,
    coalesce(nullif(p_input->>'buyer_user_id','')::uuid, auth.uid()),
    nullif(p_input->>'cart_id','')::uuid, nullif(p_input->>'branch_id','')::uuid, v_warehouse,
    nullif(p_input->>'served_by','')::uuid, nullif(p_input->>'served_by_name',''),
    v_channel, v_status,
    -- Tolerate the friendly names the UI uses ('paid' / 'partially_paid').
    case lower(coalesce(nullif(p_input->>'payment_status',''),'pending'))
      when 'paid' then 'completed'::public.payment_status
      when 'completed' then 'completed'::public.payment_status
      when 'partially_paid' then 'processing'::public.payment_status
      when 'processing' then 'processing'::public.payment_status
      when 'refunded' then 'refunded'::public.payment_status
      when 'cancelled' then 'cancelled'::public.payment_status
      else 'pending'::public.payment_status
    end,
    v_currency, v_delivery_method,
    nullif(p_input->>'shipping_name',''), nullif(p_input->>'shipping_phone',''),
    nullif(p_input->>'shipping_line1',''), nullif(p_input->>'shipping_line2',''),
    nullif(p_input->>'shipping_city',''), nullif(p_input->>'shipping_region',''),
    nullif(p_input->>'shipping_postal_code',''),
    coalesce(nullif(p_input->>'shipping_country',''),'ZM'),
    nullif(p_input->>'delivery_notes',''), nullif(p_input->>'notes',''),
    nullif(p_input->>'customer_note',''), nullif(p_input->>'reference',''),
    coalesce((p_input->>'is_wholesale')::boolean, false),
    nullif(p_input->>'quotation_id','')::uuid,
    coalesce((p_input->>'placed_at')::timestamptz, now()))
  returning id into v_order;

  -- ── Line items ──────────────────────────────────────────────────────────────
  for v_item in select * from jsonb_array_elements(v_items) loop
    v_qty      := greatest(coalesce((v_item->>'quantity')::integer,1),1);
    v_price    := nullif(v_item->>'unit_price','')::numeric;
    v_disc_amt := coalesce((v_item->>'discount_amount')::numeric,0)
                + round(coalesce((v_item->>'quantity')::integer,1)
                        * coalesce(v_price,0)
                        * coalesce((v_item->>'discount_percent')::numeric,0)/100.0, 2);
    v_pid      := nullif(v_item->>'product_id','')::uuid;
    v_vid      := nullif(v_item->>'variant_id','')::uuid;
    v_sid      := nullif(v_item->>'service_id','')::uuid;
    v_wholesale := false;
    v_cost     := 0;
    v_name     := nullif(v_item->>'name','');
    v_sku      := nullif(v_item->>'sku','');
    v_image    := nullif(v_item->>'image_url','');
    v_unit     := coalesce(nullif(v_item->>'unit',''),'piece');

    if v_pid is not null then
      select * into v_product from public.products where id = v_pid for update;
      if not found or v_product.deleted_at is not null then
        raise exception 'product_not_found: %', v_pid;
      end if;
      if not v_product.is_published and not public.can(v_business,'products.read') then
        raise exception 'product_unavailable';
      end if;

      if v_vid is not null then
        select * into v_variant from public.product_variants where id = v_vid;
      else
        v_variant := null;
      end if;

      v_wholesale := v_product.is_wholesale
                     and v_product.wholesale_price is not null
                     and v_qty >= v_product.wholesale_min_qty;

      v_price := coalesce(v_price,
                  case when v_wholesale then v_product.wholesale_price else v_product.price end,
                  v_variant.price, 0);
      v_cost  := coalesce(v_variant.cost_price, v_product.cost_price, 0);
      v_name  := coalesce(v_name, v_product.name);
      v_sku   := coalesce(v_sku, v_variant.sku, v_product.sku);
      v_image := coalesce(v_image, v_variant.image_url, v_product.primary_image_url);
      v_unit  := coalesce(nullif(v_item->>'unit',''), v_product.unit, 'piece');
      v_tax_rate := coalesce(
        (v_item->>'tax_rate')::numeric,
        (select t.rate from public.taxes t where t.id = v_product.tax_id and t.is_active),
        (select t.rate from public.taxes t
          where t.business_id = v_business and t.is_default and t.is_active limit 1),
        case when v_product.is_taxable then 0 else 0 end, 0);
      if not v_product.is_taxable then v_tax_rate := 0; end if;
    else
      v_price := coalesce(v_price, 0);
      v_tax_rate := coalesce((v_item->>'tax_rate')::numeric,
        (select t.rate from public.taxes t
          where t.business_id = v_business and t.is_default and t.is_active limit 1), 0);
      v_name := coalesce(v_name, (select s.name from public.services s where s.id = v_sid), 'Item');
    end if;

    v_disc_amt  := least(v_disc_amt, round(v_qty * v_price, 2));
    v_line_sub  := round(v_qty * v_price - v_disc_amt, 2);
    v_line_tax  := round(v_line_sub * v_tax_rate / 100.0, 2);
    v_line_tot  := v_line_sub + v_line_tax;
    v_line_profit := round(v_line_tot - v_line_tax - (v_qty * v_cost), 2);

    insert into public.order_items (
      order_id, product_id, variant_id, service_id, warehouse_id, name, sku, image_url, unit,
      quantity, unit_price, unit_cost, discount_amount, discount_percent, tax_rate,
      tax_amount, line_subtotal, line_total, is_wholesale, notes)
    values (
      v_order, v_pid, v_vid, v_sid, case when v_pid is not null then v_warehouse end,
      v_name, v_sku, v_image, v_unit, v_qty, v_price, v_cost,
      v_disc_amt, coalesce((v_item->>'discount_percent')::numeric,0), v_tax_rate,
      v_line_tax, v_line_sub, v_line_tot, v_wholesale, nullif(v_item->>'notes',''));

    v_subtotal := v_subtotal + v_line_sub;
    v_discount := v_discount + v_disc_amt;
    v_tax      := v_tax + v_line_tax;
  end loop;

  -- ── Delivery ────────────────────────────────────────────────────────────────
  if v_delivery_method in ('delivery','shipping') then
    v_delivery := coalesce((p_input->>'delivery_fee')::numeric,
      (select coalesce(b.delivery_fee,0) from public.businesses b where b.id = v_business), 0);
    select b.free_delivery_over into v_free_over
      from public.businesses b where b.id = v_business;
    if v_free_over is not null and v_subtotal >= v_free_over then
      v_delivery := 0;
    end if;
  end if;
  v_tip := coalesce((p_input->>'tip_amount')::numeric, 0);

  -- ── Coupon ──────────────────────────────────────────────────────────────────
  if nullif(p_input->>'coupon_code','') is not null then
    select * into v_coupon from public.coupons
     where business_id = v_business
       and upper(code) = upper(trim(p_input->>'coupon_code'))
       and is_active and starts_at <= now() and (ends_at is null or ends_at > now())
       and (total_limit is null or usage_count < total_limit)
       and v_subtotal >= min_subtotal
     limit 1;
    if found then
      v_coupon_discount := case v_coupon.discount_type
        when 'percent' then least(round(v_subtotal * v_coupon.discount_value/100.0,2),
                                  coalesce(v_coupon.max_discount, v_subtotal))
        when 'fixed'   then least(v_coupon.discount_value, v_subtotal)
        when 'free_delivery' then v_delivery
        else 0 end;
      if v_coupon.discount_type = 'free_delivery' then v_delivery := 0; end if;
      update public.orders set coupon_id = v_coupon.id, coupon_code = v_coupon.code where id = v_order;
    end if;
  end if;

  v_total := round(v_subtotal - v_coupon_discount + v_tax + v_delivery + v_tip, 2);

  update public.orders
     set subtotal = v_subtotal,
         discount_total = v_discount + v_coupon_discount,
         tax_total = v_tax,
         delivery_fee = v_delivery,
         tip_amount = v_tip,
         total = v_total,
         delivery_fee_quoted = v_delivery,
         status_history = jsonb_build_array(jsonb_build_object(
           'status', v_status::text, 'at', now(),
           'by', coalesce((select coalesce(display_name, full_name) from public.profiles
                            where id = auth.uid()), 'System'),
           'channel', v_channel::text))
   where id = v_order;

  -- ── Stock ───────────────────────────────────────────────────────────────────
  if coalesce((p_input->>'deduct_stock')::boolean, v_channel in ('pos','manual','store')) then
    perform public.deduct_stock_for_order(v_order, v_warehouse);
  end if;

  if v_coupon_discount > 0 and v_coupon.id is not null then
    update public.coupons set usage_count = usage_count + 1 where id = v_coupon.id;
    insert into public.coupon_redemptions (coupon_id, customer_id, user_id, order_id, amount_saved)
    values (v_coupon.id, v_customer, auth.uid(), v_order, v_coupon_discount);
  end if;

  -- Cart conversion
  if nullif(p_input->>'cart_id','') is not null then
    update public.carts set status = 'converted', converted_order_id = v_order, updated_at = now()
     where id = (p_input->>'cart_id')::uuid;
  end if;

  perform public.log_audit(v_business, 'order.created', 'order', v_order, v_number, null,
    jsonb_build_object('total', v_total, 'channel', v_channel::text, 'items', jsonb_array_length(v_items)));

  perform public.notify_business_owners(v_business, 'order',
    format('New order %s — %s%s', v_number,
           (select coalesce(c.symbol,'') from public.currencies c where c.code = v_currency), v_total),
    format('%s item(s) via %s.', jsonb_array_length(v_items), replace(v_channel::text,'_',' ')),
    format('/business/orders/%s', v_order), 'high');

  return jsonb_build_object(
    'order_id', v_order, 'order_number', v_number, 'status', v_status::text,
    'subtotal', v_subtotal, 'discount', v_discount + v_coupon_discount,
    'tax', v_tax, 'delivery', v_delivery, 'tip', v_tip, 'total', v_total,
    'currency', v_currency, 'item_count', jsonb_array_length(v_items));
end $$;

-- Stock deduction helper written as a set-based loop (avoids jsonb record juggling).
create or replace function public.deduct_stock_for_order(
  p_order_id uuid,
  p_warehouse_id uuid default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_o   public.orders;
  v_i   record;
  v_n   integer := 0;
  v_wh  uuid;
begin
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  v_wh := coalesce(p_warehouse_id, v_o.warehouse_id);

  for v_i in select product_id, variant_id, quantity from public.order_items
              where order_id = p_order_id and product_id is not null
  loop
    perform public.adjust_stock(v_o.business_id, v_i.product_id, -v_i.quantity, 'sale',
      v_wh, v_i.variant_id, null, 'order', p_order_id, v_o.order_number);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function public.restock_order(p_order_id uuid, p_warehouse_id uuid default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_o  public.orders; v_i record; v_n integer := 0; v_wh uuid;
begin
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  v_wh := coalesce(p_warehouse_id, v_o.warehouse_id);
  for v_i in select product_id, variant_id, quantity from public.order_items
              where order_id = p_order_id and product_id is not null
  loop
    perform public.adjust_stock(v_o.business_id, v_i.product_id, v_i.quantity, 'return_in',
      v_wh, v_i.variant_id, null, 'order', p_order_id, v_o.order_number, 'order_cancelled');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ORDER OPERATIONS: fulfilment, delivery assignment, returns and refunds
--
-- Status changes go through these functions rather than a raw update so the
-- financial guard-rails live in one place: cancelling a paid order is refused
-- (it must be refunded), refunds above the owner-approval threshold need
-- payments.refund, and stock is only ever moved by adjust_stock so the
-- movement log stays complete.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.update_order_status(
  p_order_id uuid,
  p_status   public.order_status,
  p_note     text default null,
  p_restock  boolean default true
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_o     public.orders;
  v_uid   uuid := auth.uid();
  v_actor text;
  v_n     integer := 0;
begin
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if not public.can(v_o.business_id, 'orders.write')
     and not public.can(v_o.business_id, 'orders.fulfil') then
    raise exception 'permission_denied: orders.fulfil';
  end if;
  if v_o.status = p_status then
    return jsonb_build_object('order_id', v_o.id, 'status', v_o.status, 'changed', false);
  end if;

  select coalesce(display_name, full_name, email, 'System') into v_actor
    from public.profiles where id = v_uid;

  if p_status = 'cancelled' then
    -- Money already taken: refuse. The seller must refund first (or raise a
    -- credit note) so the ledger and the stock count always agree.
    if v_o.amount_paid > 0 then
      raise exception 'order_already_paid: refund % before cancelling',
        public.format_money(v_o.amount_paid, v_o.currency);
    end if;
    if coalesce(p_restock, true) and v_o.status not in ('cancelled','returned') then
      v_n := public.restock_order(v_o.id, v_o.warehouse_id);
    end if;
    update public.invoices set status = 'void', void_reason = 'Order ' || v_o.order_number || ' cancelled'
     where order_id = v_o.id and status in ('draft','sent','viewed') and deleted_at is null;
  end if;

  -- The before-update trigger writes status_history, stamps the timestamps and
  -- the after-update trigger notifies the buyer.
  update public.orders
     set status = p_status,
         notes  = case when nullif(trim(coalesce(p_note,'')),'') is null then notes
                       else trim(coalesce(notes || E'\n', '') || '[' || coalesce(v_actor,'System') || '] ' || trim(p_note)) end
   where id = p_order_id;

  perform public.log_audit(v_o.business_id, 'order.status_' || p_status::text, 'order', v_o.id,
                           v_o.order_number,
                           jsonb_build_object('status', jsonb_build_array(v_o.status::text, p_status::text)),
                           jsonb_build_object('note', p_note, 'restocked_lines', v_n));

  return jsonb_build_object('order_id', v_o.id, 'order_number', v_o.order_number,
                            'status', p_status, 'previous_status', v_o.status,
                            'changed', true, 'restocked_lines', v_n);
end $$;

create or replace function public.assign_delivery(
  p_order_id       uuid,
  p_method         text default null,
  p_driver_name    text default null,
  p_driver_phone   text default null,
  p_courier        text default null,
  p_tracking       text default null,
  p_eta            timestamptz default null,
  p_status         public.order_status default null,
  p_notify         boolean default true
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_o public.orders;
begin
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if not public.can(v_o.business_id, 'delivery.write')
     and not public.can(v_o.business_id, 'orders.fulfil') then
    raise exception 'permission_denied: delivery.write';
  end if;

  update public.orders set
    delivery_method       = coalesce(nullif(p_method,''), delivery_method)::public.delivery_method,
    driver_name           = coalesce(nullif(trim(p_driver_name),''), driver_name),
    driver_phone          = coalesce(nullif(trim(p_driver_phone),''), driver_phone),
    courier               = coalesce(nullif(trim(p_courier),''), courier),
    tracking_number       = coalesce(nullif(trim(p_tracking),''), tracking_number),
    estimated_delivery_at = coalesce(p_eta, estimated_delivery_at),
    fulfilment_status     = case
                              when nullif(trim(coalesce(p_tracking,'')),'') is not null then 'in_transit'
                              when nullif(trim(coalesce(p_driver_name,'')),'') is not null then 'assigned'
                              else fulfilment_status end
  where id = p_order_id;

  if p_status is not null and p_status <> v_o.status then
    perform public.update_order_status(p_order_id, p_status, 'Delivery assigned', false);
  end if;

  if coalesce(p_notify, true) and v_o.buyer_user_id is not null then
    perform public.notify_user(v_o.buyer_user_id, 'order',
      format('Order %s is on the way', v_o.order_number),
      trim(coalesce(p_driver_name,'Our driver') || ' is delivering your order'
           || case when nullif(trim(coalesce(p_tracking,'')),'') is not null
                   then ' · tracking ' || trim(p_tracking) else '' end),
      format('/orders/%s', v_o.id), v_o.business_id, 'order', v_o.id);
  end if;

  perform public.log_audit(v_o.business_id, 'order.delivery_assigned', 'order', v_o.id, v_o.order_number,
                           null, jsonb_build_object('driver', p_driver_name, 'courier', p_courier,
                                                    'tracking', p_tracking, 'method', p_method));

  return jsonb_build_object('order_id', v_o.id, 'ok', true);
end $$;

-- ── RETURNS & REFUNDS ────────────────────────────────────────────────────────
create or replace function public.next_return_number(p_business_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_n integer := 0; v_num text;
begin
  loop
    v_n := v_n + 1;
    v_num := format('RET-%s-%s', to_char(now(),'YYYY'), lpad(v_n::text, 5, '0'));
    exit when not exists (select 1 from public.returns r
                           where r.business_id = p_business_id and r.return_number = v_num);
  end loop;
  return v_num;
end $$;

create or replace function public.create_return(p_input jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_o        public.orders;
  v_business uuid;
  v_customer uuid;
  v_return   uuid;
  v_number   text;
  v_item     jsonb;
  v_oi       public.order_items;
  v_qty      integer;
  v_price    numeric(14,2);
  v_refund   numeric(14,2);
  v_total    numeric(14,2) := 0;
  v_uid      uuid := auth.uid();
  v_actor    text;
begin
  v_o.id := nullif(p_input->>'order_id','')::uuid;
  if v_o.id is not null then
    select * into v_o from public.orders where id = v_o.id;
    if not found then raise exception 'order_not_found'; end if;
    v_business := v_o.business_id;
    v_customer := v_o.customer_id;
  else
    v_business := nullif(p_input->>'business_id','')::uuid;
    v_customer := nullif(p_input->>'customer_id','')::uuid;
    if v_business is null then raise exception 'order_or_business_required'; end if;
  end if;

  -- A buyer opening their own return needs no staff permission; anyone acting
  -- for the business needs returns.write.
  if v_o.buyer_user_id is distinct from v_uid
     and not public.can(v_business, 'returns.write') then
    raise exception 'permission_denied: returns.write';
  end if;

  select coalesce(display_name, full_name, email, 'Customer') into v_actor
    from public.profiles where id = v_uid;

  v_number := public.next_return_number(v_business);

  insert into public.returns (
    business_id, return_number, order_id, invoice_id, customer_id, status, reason, reason_code,
    requested_by, requested_by_name, restock, warehouse_id, refund_method, images)
  values (
    v_business, v_number, v_o.id,
    coalesce(nullif(p_input->>'invoice_id','')::uuid,
             (select i.id from public.invoices i
               where i.order_id = v_o.id and i.deleted_at is null
               order by i.created_at desc limit 1)),
    v_customer, 'requested',
    nullif(trim(coalesce(p_input->>'reason','')),'') ,
    nullif(p_input->>'reason_code',''),
    v_uid, v_actor,
    coalesce((p_input->>'restock')::boolean, true),
    coalesce(nullif(p_input->>'warehouse_id','')::uuid, v_o.warehouse_id),
    nullif(p_input->>'refund_method',''),
    coalesce(nullif(p_input->'images','[]')::jsonb, '[]'::jsonb))
  returning id into v_return;

  for v_item in select * from jsonb_array_elements(coalesce(p_input->'items','[]'::jsonb))
  loop
    v_oi.id := nullif(v_item->>'order_item_id','')::uuid;
    if v_oi.id is not null then
      select * into v_oi from public.order_items where id = v_oi.id and order_id = v_o.id;
      if not found then raise exception 'order_item_not_found'; end if;
      v_qty   := least(greatest(coalesce((v_item->>'quantity')::integer, v_oi.quantity), 1), v_oi.quantity);
      v_price := coalesce((v_item->>'unit_price')::numeric(14,2), v_oi.unit_price);
    else
      v_oi := null;
      v_qty   := greatest(coalesce((v_item->>'quantity')::integer, 1), 1);
      v_price := coalesce((v_item->>'unit_price')::numeric(14,2), 0);
    end if;

    -- Never refund more than the line was charged.
    v_refund := least(round(coalesce((v_item->>'refund_amount')::numeric(14,2), v_qty * v_price), 2),
                      coalesce(v_oi.line_total, v_qty * v_price));

    insert into public.return_items (
      return_id, order_item_id, product_id, variant_id, name, quantity, unit_price, refund_amount, condition)
    values (
      v_return, v_oi.id,
      coalesce(v_oi.product_id, nullif(v_item->>'product_id','')::uuid),
      coalesce(v_oi.variant_id, nullif(v_item->>'variant_id','')::uuid),
      coalesce(nullif(v_item->>'name',''), v_oi.name, 'Returned item'),
      v_qty, v_price, v_refund,
      coalesce(nullif(v_item->>'condition',''), 'sellable'));

    v_total := v_total + v_refund;
  end loop;

  update public.returns set refund_amount = round(v_total, 2) where id = v_return;

  perform public.notify_business_owners(v_business, 'order',
    format('Return %s requested', v_number),
    format('%s requested a return%s for %s.', v_actor,
           case when v_total > 0 then ' of ' || public.format_money(v_total, coalesce(v_o.currency,'ZMW')) else '' end,
           coalesce(v_o.order_number, 'an order')),
    format('/business/returns/%s', v_return));

  if v_o.buyer_user_id is not null and v_o.buyer_user_id <> v_uid then
    perform public.notify_user(v_o.buyer_user_id, 'order', format('Return %s received', v_number),
      'We have your return request and will review it shortly.',
      format('/orders/%s', v_o.id), v_business, 'return', v_return);
  end if;

  perform public.log_audit(v_business, 'return.created', 'return', v_return, v_number, null,
                           jsonb_build_object('amount', v_total, 'order', v_o.order_number));

  return jsonb_build_object('return_id', v_return, 'return_number', v_number,
                            'refund_amount', round(v_total,2), 'status', 'requested');
end $$;

create or replace function public.process_return(
  p_return_id   uuid,
  p_action      text,                      -- approve | reject | receive | refund | close
  p_note        text default null,
  p_restock     boolean default true,
  p_refund_method text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_r        public.returns;
  v_o        public.orders;
  v_refund   uuid;
  v_credit   uuid;
  v_paid     numeric(14,2) := 0;
  v_method   public.payment_method;
  v_restocked integer := 0;
  v_row      record;
  v_uid      uuid := auth.uid();
begin
  select * into v_r from public.returns where id = p_return_id for update;
  if not found then raise exception 'return_not_found'; end if;
  if not public.can(v_r.business_id, 'returns.approve')
     and not public.can(v_r.business_id, 'returns.write') then
    raise exception 'permission_denied: returns.approve';
  end if;

  if v_r.order_id is not null then
    select * into v_o from public.orders where id = v_r.order_id;
    v_paid := coalesce(v_o.amount_paid, 0);
  end if;

  case p_action
    when 'approve' then
      update public.returns
         set status = 'approved', reviewed_by = v_uid, reviewed_at = now(),
             review_note = coalesce(nullif(trim(coalesce(p_note,'')),''), review_note)
       where id = p_return_id;

    when 'reject' then
      update public.returns
         set status = 'rejected', reviewed_by = v_uid, reviewed_at = now(),
             review_note = coalesce(nullif(trim(coalesce(p_note,'')),''), review_note),
             resolved_at = now()
       where id = p_return_id;

    when 'receive' then
      update public.returns set status = 'received' where id = p_return_id;
      if coalesce(v_r.restock, true) and coalesce(p_restock, true) then
        for v_row in
          select ri.product_id, ri.variant_id, ri.quantity
            from public.return_items ri
           where ri.return_id = p_return_id and ri.product_id is not null and not ri.restocked
        loop
          perform public.adjust_stock(v_r.business_id, v_row.product_id, v_row.quantity, 'return_in',
                                      v_r.warehouse_id, v_row.variant_id, null, 'return', p_return_id,
                                      v_r.return_number, coalesce(p_note, 'customer_return'));
          update public.return_items set restocked = true
           where id = v_row.item_id;
          v_restocked := v_restocked + v_row.quantity;
        end loop;
      end if;

    when 'refund' then
      -- Refunds move real money, so the approval gate applies.
      if not public.can(v_r.business_id, 'payments.refund') then
        raise exception 'owner_approval_required: refund of % needs payments.refund',
          public.format_money(v_r.refund_amount, coalesce(v_o.currency,'ZMW'));
      end if;
      if v_r.refund_amount <= 0 then raise exception 'nothing_to_refund'; end if;
      if v_paid > 0 and v_r.refund_amount > v_paid then
        raise exception 'refund_exceeds_paid: paid %, requested %',
          public.format_money(v_paid, coalesce(v_o.currency,'ZMW')),
          public.format_money(v_r.refund_amount, coalesce(v_o.currency,'ZMW'));
      end if;

      v_method := coalesce(nullif(p_refund_method,'')::public.payment_method,
                           nullif(v_r.refund_method,'')::public.payment_method,
                           (select p.method from public.payments p
                             where p.order_id = v_r.order_id
                            order by p.created_at desc limit 1),
                           'cash');

      insert into public.refunds (
        business_id, invoice_id, return_id, customer_id, amount, currency, method, reason,
        status, requires_approval, approved_by, approved_at, processed_by)
      values (
        v_r.business_id, v_r.invoice_id, v_r.id, v_r.customer_id, v_r.refund_amount,
        coalesce(v_o.currency, (select base_currency from public.businesses where id = v_r.business_id)),
        v_method, coalesce(v_r.reason, 'Customer return'), 'completed', false, v_uid, now(), v_uid)
      returning id into v_refund;

      -- Money that was already invoiced is reversed with a credit note, never by
      -- editing the original invoice.
      if v_r.invoice_id is not null then
        select i.id into v_credit from public.invoices i
         where i.business_id = v_r.business_id and i.kind = 'credit_note'
           and i.reference = v_r.return_number limit 1;
        if v_credit is null then
          insert into public.invoices (
            business_id, invoice_number, kind, customer_id, order_id, status, currency,
            subtotal, total, notes, reference, created_by, created_by_name, issue_date)
          select v_r.business_id,
                 public.next_document_number(v_r.business_id, 'credit_note'),
                 'credit_note', v_r.customer_id, v_r.order_id, 'sent',
                 coalesce(v_o.currency, b.base_currency),
                 -v_r.refund_amount, -v_r.refund_amount,
                 'Credit note for return ' || v_r.return_number || coalesce(': ' || v_r.reason, ''),
                 v_r.return_number, v_uid,
                 (select coalesce(display_name, full_name, email) from public.profiles where id = v_uid),
                 current_date
            from public.businesses b where b.id = v_r.business_id
          returning id into v_credit;

          -- quantity is constrained > 0, so the credit is carried as a
          -- negative unit price on a single line.
          insert into public.invoice_items (
            invoice_id, description, quantity, unit_price, line_subtotal, line_total, sort_order)
          values (v_credit, 'Return ' || v_r.return_number, 1, -v_r.refund_amount,
                  -v_r.refund_amount, -v_r.refund_amount, 1);

          update public.returns set credit_note_id = v_credit where id = p_return_id;
          update public.invoices
             set amount_credited = coalesce(amount_credited,0) + v_r.refund_amount
           where id = v_r.invoice_id;
        end if;
      end if;

      update public.returns
         set status = 'refunded', refund_method = v_method::text, resolved_at = now(),
             reviewed_by = coalesce(reviewed_by, v_uid), reviewed_at = coalesce(reviewed_at, now())
       where id = p_return_id;

      if v_o.id is not null then
        update public.orders
           set payment_status = case when coalesce(v_o.amount_paid,0) - v_r.refund_amount <= 0
                                     then 'refunded'::public.payment_status else payment_status end
         where id = v_o.id;
      end if;

    when 'close' then
      update public.returns set status = 'closed', resolved_at = now() where id = p_return_id;

    else
      raise exception 'unknown_return_action: %', p_action;
  end case;

  perform public.log_audit(v_r.business_id, 'return.' || p_action, 'return', p_return_id, v_r.return_number,
                           jsonb_build_object('status', jsonb_build_array(v_r.status::text, p_action)),
                           jsonb_build_object('note', p_note, 'amount', v_r.refund_amount));

  if v_o.buyer_user_id is not null then
    perform public.notify_user(v_o.buyer_user_id, 'order',
      format('Return %s — %s', v_r.return_number, p_action),
      coalesce(nullif(trim(coalesce(p_note,'')),''),
               case p_action
                 when 'approve' then 'Your return was approved.'
                 when 'reject'  then 'Your return was not approved.'
                 when 'receive' then 'We received the returned items.'
                 when 'refund'  then format('We refunded %s.', public.format_money(v_r.refund_amount, coalesce(v_o.currency,'ZMW')))
                 else 'Your return was closed.'
               end),
      case when v_o.id is not null then format('/orders/%s', v_o.id) else '/account' end,
      v_r.business_id, 'return', p_return_id);
  end if;

  return jsonb_build_object('return_id', p_return_id, 'action', p_action,
                            'refund_id', v_refund, 'credit_note_id', v_credit,
                            'restocked', coalesce(v_restocked, 0));
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- PAYMENTS: record → receipt → invoice/order status → ledgers
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.record_payment(p_input jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_business uuid := (p_input->>'business_id')::uuid;
  v_invoice  uuid := nullif(p_input->>'invoice_id','')::uuid;
  v_order    uuid := nullif(p_input->>'order_id','')::uuid;
  v_customer uuid := nullif(p_input->>'customer_id','')::uuid;
  v_supplier uuid := nullif(p_input->>'supplier_id','')::uuid;
  v_bill     uuid := nullif(p_input->>'bill_id','')::uuid;
  v_amount   numeric := round((p_input->>'amount')::numeric, 2);
  v_method   public.payment_method := coalesce((p_input->>'method')::public.payment_method,'cash');
  v_payment  uuid;
  v_receipt  uuid;
  v_number   text;
  v_balance  numeric;
  v_total    numeric;
  v_paid     numeric;
  v_currency text;
  v_name     text;
  v_auto_receipt boolean := coalesce((p_input->>'generate_receipt')::boolean, true);
begin
  if v_amount is null or v_amount <= 0 then raise exception 'invalid_amount'; end if;
  if v_business is null and v_invoice is not null then
    select business_id into v_business from public.invoices where id = v_invoice;
  end if;
  if v_business is null and v_order is not null then
    select business_id into v_business from public.orders where id = v_order;
  end if;
  if v_business is null then raise exception 'business_id_required'; end if;

  if not public.can(v_business,'payments.record') then
    raise exception 'permission_denied: payments.record';
  end if;

  select coalesce(base_currency,'ZMW') into v_currency from public.businesses where id = v_business;
  v_currency := coalesce(nullif(p_input->>'currency',''), v_currency);

  if v_invoice is not null then
    select total, amount_paid, currency, customer_id into v_total, v_paid, v_currency, v_customer
      from public.invoices where id = v_invoice for update;
    if not found then raise exception 'invoice_not_found'; end if;
    if v_amount > (v_total - v_paid) + 0.01 and not coalesce((p_input->>'allow_overpay')::boolean,false) then
      raise exception 'amount_exceeds_balance: balance is %', (v_total - v_paid);
    end if;
  elsif v_order is not null then
    select total, amount_paid, currency, customer_id into v_total, v_paid, v_currency, v_customer
      from public.orders where id = v_order for update;
  end if;

  v_number := coalesce(nullif(p_input->>'payment_number',''),
                       'PAY-' || to_char(now(),'YYYYMMDD') || '-' || lpad(floor(random()*100000)::text,5,'0'));

  insert into public.payments (
    business_id, invoice_id, order_id, quotation_id, customer_id, supplier_id, direction,
    payment_number, method, provider, provider_reference, status, currency, exchange_rate,
    amount, amount_base, fee_amount, payer_name, payer_phone, payer_email, received_at, notes,
    recorded_by, recorded_by_name, is_online, payment_link_id)
  values (
    v_business, v_invoice, v_order, nullif(p_input->>'quotation_id','')::uuid, v_customer, v_supplier,
    coalesce(nullif(p_input->>'direction',''),'inbound'),
    v_number, v_method, nullif(p_input->>'provider',''), nullif(p_input->>'provider_reference',''),
    coalesce((p_input->>'status')::public.payment_status,'completed'),
    v_currency, coalesce((p_input->>'exchange_rate')::numeric,1),
    v_amount, round(v_amount * coalesce((p_input->>'exchange_rate')::numeric,1),2),
    coalesce((p_input->>'fee_amount')::numeric,0),
    nullif(p_input->>'payer_name',''), nullif(p_input->>'payer_phone',''), nullif(p_input->>'payer_email',''),
    coalesce((p_input->>'received_at')::timestamptz, now()),
    nullif(p_input->>'notes',''), auth.uid(),
    (select coalesce(display_name, full_name, email) from public.profiles where id = auth.uid()),
    coalesce((p_input->>'is_online')::boolean,false),
    nullif(p_input->>'payment_link_id','')::uuid)
  returning id into v_payment;

  -- Update the invoice.
  if v_invoice is not null then
    update public.invoices
       set amount_paid = amount_paid + v_amount,
           status = case
             when amount_paid + v_amount >= total then 'paid'::public.doc_status
             when amount_paid + v_amount > 0 then 'partially_paid'::public.doc_status
             else status end,
           paid_at = case when amount_paid + v_amount >= total then now() else paid_at end,
           updated_at = now()
     where id = v_invoice
     returning balance_due, total into v_balance, v_total;

    select c.name into v_name from public.customers c where c.id = v_customer;

    insert into public.customer_transactions
      (business_id, customer_id, kind, direction, amount, currency, balance_after,
       reference_type, reference_id, reference_number, description)
    select v_business, v_customer, 'payment', 'credit', v_amount, v_currency, v_balance,
           'invoice', v_invoice, i.invoice_number, format('Payment via %s', v_method)
      from public.invoices i where i.id = v_invoice and v_customer is not null;
  end if;

  -- Update the order.
  if v_order is not null then
    update public.orders
       set amount_paid = amount_paid + v_amount,
           payment_status = case
             when amount_paid + v_amount >= total then 'completed'::public.payment_status
             when amount_paid + v_amount > 0 then 'processing'::public.payment_status
             else payment_status end,
           updated_at = now()
     where id = v_order;
  end if;

  -- Update a supplier bill (outbound payment).
  if v_bill is not null then
    update public.supplier_bills
       set amount_paid = amount_paid + v_amount,
           status = case when amount_paid + v_amount >= total then 'paid'::public.doc_status
                         else 'partially_paid'::public.doc_status end,
           paid_at = case when amount_paid + v_amount >= total then now() else paid_at end
     where id = v_bill;
    update public.suppliers
       set outstanding_amount = greatest(outstanding_amount - v_amount, 0)
     where id = v_supplier;
  end if;

  -- Receipt (automatic).
  if v_auto_receipt and v_amount > 0 and coalesce(p_input->>'direction','inbound') = 'inbound' then
    v_receipt := public.create_receipt(jsonb_build_object(
      'business_id', v_business, 'payment_id', v_payment, 'invoice_id', v_invoice,
      'order_id', v_order, 'customer_id', v_customer, 'amount', v_amount,
      'currency', v_currency, 'method', v_method,
      'balance_after', coalesce(v_balance, 0),
      'customer_name', v_name,
      'notes', nullif(p_input->>'notes',''),
      'is_automatic', true));
    update public.payments set receipt_id = v_receipt where id = v_payment;
  end if;

  perform public.log_audit(v_business, 'payment.recorded', 'payment', v_payment, v_number, null,
    jsonb_build_object('amount', v_amount, 'method', v_method, 'invoice_id', v_invoice, 'order_id', v_order));

  perform public.notify_business_owners(v_business, 'payment',
    format('Payment received — %s %s',
           (select symbol from public.currencies where code = v_currency), v_amount),
    format('%s via %s%s', v_number, replace(v_method::text,'_',' '),
           case when v_balance is not null and v_balance > 0 then format(' · balance %s', v_balance) else '' end),
    format('/business/payments/%s', v_payment));

  return jsonb_build_object('payment_id', v_payment, 'payment_number', v_number,
                            'receipt_id', v_receipt, 'amount', v_amount,
                            'balance_due', coalesce(v_balance, 0), 'currency', v_currency);
end $$;

create or replace function public.create_receipt(p_input jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_business uuid := (p_input->>'business_id')::uuid;
  v_payment  uuid := nullif(p_input->>'payment_id','')::uuid;
  v_number   text;
  v_receipt  uuid;
  v_customer uuid := nullif(p_input->>'customer_id','')::uuid;
begin
  if v_business is null then raise exception 'business_id_required'; end if;
  if not public.can(v_business,'receipts.create') then
    raise exception 'permission_denied: receipts.create';
  end if;

  -- One receipt per payment.
  if v_payment is not null then
    select r.id into v_receipt from public.receipts r where r.payment_id = v_payment;
    if v_receipt is not null then return v_receipt; end if;
  end if;

  v_number := coalesce(nullif(p_input->>'receipt_number',''),
                       public.next_document_number(v_business,'receipt'));

  insert into public.receipts (
    business_id, receipt_number, payment_id, invoice_id, order_id, customer_id, customer_name,
    amount, currency, method, balance_after, received_at, notes, qr_token, share_token,
    created_by, created_by_name, is_automatic, signed_by_name)
  values (
    v_business, v_number, v_payment, nullif(p_input->>'invoice_id','')::uuid,
    nullif(p_input->>'order_id','')::uuid, v_customer,
    coalesce(nullif(p_input->>'customer_name',''),
             (select c.name from public.customers c where c.id = v_customer),
             (select p.payer_name from public.payments p where p.id = v_payment),
             'Walk-in customer'),
    round((p_input->>'amount')::numeric,2),
    coalesce(nullif(p_input->>'currency',''),
             (select base_currency from public.businesses where id = v_business),'ZMW'),
    coalesce((p_input->>'method')::public.payment_method,
             (select method from public.payments where id = v_payment), 'cash'),
    coalesce((p_input->>'balance_after')::numeric,0),
    coalesce((p_input->>'received_at')::timestamptz,
             (select received_at from public.payments where id = v_payment), now()),
    nullif(p_input->>'notes',''),
    encode(gen_random_bytes(10),'hex'),
    case when coalesce((p_input->>'create_share_link')::boolean, true)
         then encode(gen_random_bytes(16),'hex') end,
    auth.uid(),
    (select coalesce(display_name, full_name, email) from public.profiles where id = auth.uid()),
    coalesce((p_input->>'is_automatic')::boolean,false),
    nullif(p_input->>'signed_by_name',''))
  returning id into v_receipt;

  insert into public.documents (business_id, doc_number, doc_type, title, status, entity_type,
                                entity_id, customer_id, currency, total, issue_date, qr_token,
                                share_token, created_by, created_by_name)
  select v_business, v_number, 'receipt', format('Receipt %s', v_number), 'paid', 'receipt', v_receipt,
         v_customer, (select currency from public.receipts where id = v_receipt),
         (select amount from public.receipts where id = v_receipt), current_date,
         (select qr_token from public.receipts where id = v_receipt),
         (select share_token from public.receipts where id = v_receipt),
         auth.uid(), (select coalesce(display_name, full_name) from public.profiles where id = auth.uid())
  on conflict (business_id, doc_type, doc_number) do nothing;

  perform public.log_audit(v_business, 'receipt.created', 'receipt', v_receipt, v_number);
  return v_receipt;
end $$;

-- Create an invoice for an order (one click from the order screen).
create or replace function public.create_invoice_from_order(p_order_id uuid, p_due_days integer default null)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_o     public.orders;
  v_items jsonb;
  v_inv   uuid;
begin
  select * into v_o from public.orders where id = p_order_id;
  if not found then raise exception 'order_not_found'; end if;
  if not public.can(v_o.business_id,'invoices.write') then
    raise exception 'permission_denied: invoices.write';
  end if;
  if v_o.invoice_id is not null then return v_o.invoice_id; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'product_id', oi.product_id, 'variant_id', oi.variant_id, 'service_id', oi.service_id,
      'order_item_id', oi.id, 'description', oi.name, 'quantity', oi.quantity, 'unit', oi.unit,
      'unit_price', oi.unit_price, 'discount_amount', oi.discount_amount,
      'discount_percent', oi.discount_percent, 'tax_rate', oi.tax_rate, 'notes', oi.notes)
      order by oi.created_at), '[]'::jsonb)
    into v_items from public.order_items oi where oi.order_id = p_order_id;

  v_inv := public.create_invoice(jsonb_build_object(
    'business_id', v_o.business_id, 'customer_id', v_o.customer_id,
    'buyer_user_id', v_o.buyer_user_id, 'order_id', v_o.id, 'items', v_items,
    'currency', v_o.currency, 'delivery_fee', v_o.delivery_fee,
    'terms_days', coalesce(p_due_days, 0), 'reference', v_o.order_number,
    'notes', v_o.notes));

  update public.orders set invoice_id = v_inv, updated_at = now() where id = p_order_id;
  return v_inv;
end $$;

-- Create a payment link ("Request K1,500" → shareable URL).
create or replace function public.create_payment_link(p_input jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_business uuid := (p_input->>'business_id')::uuid;
  v_code     text := lower(encode(gen_random_bytes(5),'hex'));
  v_id       uuid;
  v_customer uuid := nullif(p_input->>'customer_id','')::uuid;
begin
  if not public.can(v_business,'payments.record') then
    raise exception 'permission_denied: payments.record';
  end if;
  if coalesce((p_input->>'amount')::numeric,0) <= 0 then
    raise exception 'invalid_amount';
  end if;

  if v_customer is null and p_input ? 'customer' then
    v_customer := public.upsert_customer(v_business, p_input->'customer');
  end if;

  insert into public.payment_links (
    business_id, code, label, description, amount, currency, allow_custom_amount, min_amount,
    max_amount, invoice_id, order_id, quotation_id, customer_id, customer_name, customer_phone,
    customer_email, methods, message, expires_at, created_by)
  values (
    v_business, v_code, nullif(p_input->>'label',''), nullif(p_input->>'description',''),
    round((p_input->>'amount')::numeric,2),
    coalesce(nullif(p_input->>'currency',''),
             (select base_currency from public.businesses where id = v_business),'ZMW'),
    coalesce((p_input->>'allow_custom_amount')::boolean,false),
    nullif(p_input->>'min_amount','')::numeric, nullif(p_input->>'max_amount','')::numeric,
    nullif(p_input->>'invoice_id','')::uuid, nullif(p_input->>'order_id','')::uuid,
    nullif(p_input->>'quotation_id','')::uuid, v_customer,
    coalesce(nullif(p_input->>'customer_name',''), (select name from public.customers where id = v_customer)),
    nullif(p_input->>'customer_phone',''), nullif(p_input->>'customer_email',''),
    coalesce((select array_agg(m::public.payment_method) from jsonb_array_elements_text(
                coalesce(p_input->'methods','["mobile_money","card","cash","bank_transfer"]'::jsonb)) as m),
             array['mobile_money','card','cash','bank_transfer']::public.payment_method[]),
    nullif(p_input->>'message',''),
    nullif(p_input->>'expires_at','')::timestamptz, auth.uid())
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'code', v_code, 'url', format('/pay/%s', v_code));
end $$;

-- Public: resolve a payment link by its short code.
create or replace function public.get_payment_link(p_code text)
returns jsonb
language plpgsql security definer set search_path = public as $$
  select jsonb_build_object(
    'found', true, 'code', pl.code, 'label', pl.label, 'description', pl.description,
    'amount', pl.amount, 'currency', pl.currency, 'allow_custom_amount', pl.allow_custom_amount,
    'min_amount', pl.min_amount, 'max_amount', pl.max_amount, 'methods', to_jsonb(pl.methods),
    'message', pl.message, 'customer_name', pl.customer_name, 'status', pl.status,
    'expires_at', pl.expires_at,
    'invoice_number', (select i.invoice_number from public.invoices i where i.id = pl.invoice_id),
    'business', (select jsonb_build_object('name',b.name,'logo_url',b.logo_url,'slug',b.slug,
                     'phone',b.phone,'email',b.email,'city',b.city,'country_code',b.country_code,
                     'verification_status',b.verification_status,'rating_avg',b.rating_avg)
                   from public.businesses b where b.id = pl.business_id))
  from public.payment_links pl
  where pl.code = lower(p_code) and pl.status = 'active'
    and (pl.expires_at is null or pl.expires_at > now())
  limit 1;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- SEARCH
-- ─────────────────────────────────────────────────────────────────────────────
-- Full-text + trigram search with the complete blueprint filter set.
-- Temp tables are session-scoped and cleared on every call.
create or replace function public.search_products(p_input jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_q        text := nullif(trim(p_input->>'q'),'');
  v_limit    integer := least(coalesce((p_input->>'limit')::integer, 24), 100);
  v_offset   integer := greatest(coalesce((p_input->>'offset')::integer, 0), 0);
  v_sort     text := coalesce(p_input->>'sort','relevance');
  v_total    bigint;
  v_rows     jsonb;
begin
  create temporary table if not exists _search_ids (product_id uuid primary key) on commit delete rows;
  delete from _search_ids;

  insert into _search_ids
  select p.id
  from public.products p
  join public.businesses b on b.id = p.business_id
  left join public.categories c on c.id = p.category_id
  where p.is_published and p.deleted_at is null
    and b.is_public and b.deleted_at is null and b.suspended_at is null
    -- keyword: full text OR trigram similarity OR sku/barcode exact
    and (v_q is null or (
          p.search_vector @@ plainto_tsquery('english', v_q)
          or p.search_vector @@ websearch_to_tsquery('english', v_q)
          or p.name % v_q
          or similarity(p.name, v_q) > 0.15
          or p.sku ilike '%' || v_q || '%'
          or p.barcode ilike '%' || v_q || '%'
          or p.brand ilike '%' || v_q || '%'
          or c.name ilike '%' || v_q || '%'
          or c.path ilike '%' || public.slugify(v_q) || '%'
        ))
    -- price (supports "under 500" style filters from the client)
    and (nullif(p_input->>'min_price','') is null or p.price >= (p_input->>'min_price')::numeric)
    and (nullif(p_input->>'max_price','') is null or p.price <= (p_input->>'max_price')::numeric)
    -- category
    and (nullif(p_input->>'category_id','') is null or p.category_id = (p_input->>'category_id')::uuid)
    and (nullif(p_input->>'category_slug','') is null or c.slug = (p_input->>'category_slug')
         or c.path like '%/' || (p_input->>'category_slug') || '%')
    -- location
    and (nullif(p_input->>'country_code','') is null or b.country_code = (p_input->>'country_code'))
    and (nullif(p_input->>'city','') is null or lower(b.city) = lower(p_input->>'city'))
    -- seller / store
    and (nullif(p_input->>'business_id','') is null or p.business_id = (p_input->>'business_id')::uuid)
    and (nullif(p_input->>'store_slug','') is null or b.slug = (p_input->>'store_slug'))
    -- rating
    and (nullif(p_input->>'min_rating','') is null or p.rating_avg >= (p_input->>'min_rating')::numeric)
    -- availability
    and (coalesce((p_input->>'in_stock')::boolean,false) = false or p.stock > 0)
    -- brand / condition
    and (nullif(p_input->>'brand','') is null or lower(p.brand) = lower(p_input->>'brand'))
    and (nullif(p_input->>'condition','') is null or p.condition::text = (p_input->>'condition'))
    -- wholesale vs retail
    and (coalesce((p_input->>'wholesale_only')::boolean,false) = false or p.is_wholesale)
    and (coalesce((p_input->>'retail_only')::boolean,false) = false or not p.is_wholesale)
    and (nullif(p_input->>'new_or_used','') is null or p.condition::text = (p_input->>'new_or_used'))
    -- product type
    and (nullif(p_input->>'product_type','') is null or p.product_type::text = (p_input->>'product_type')
         or p.product_type = 'both')
    -- featured / deals
    and (coalesce((p_input->>'featured_only')::boolean,false) = false or p.is_featured)
  on conflict do nothing;

  select count(*) into v_total from _search_ids;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.rn), '[]'::jsonb)
    into v_rows
  from (
    select row_number() over (order by
             case v_sort
               when 'price_asc'  then 1 else 0 end,
             case when v_sort = 'price_asc' then p.price end asc,
             case when v_sort = 'price_desc' then p.price end desc,
             case when v_sort in ('newest','relevance') then p.created_at end desc,
             case when v_sort = 'rating' then p.rating_avg end desc nulls last,
             case when v_sort = 'popular' then p.sold_count end desc nulls last,
             case when v_sort = 'name' then lower(p.name) end asc,
             case when v_sort = 'relevance' and v_q is not null
                  then ts_rank(p.search_vector, plainto_tsquery('english', v_q)) end desc nulls last,
             p.sold_count desc) as rn,
           p.id, p.name, p.slug, p.sku, p.barcode, p.brand, p.short_description,
           p.price, p.compare_at_price, p.wholesale_price, p.wholesale_min_qty,
           p.currency, p.stock, p.unit, p.condition, p.product_type, p.is_wholesale,
           p.is_featured, p.primary_image_url, p.media, p.rating_avg, p.rating_count,
           p.sold_count, p.view_count, p.created_at, p.category_id,
           c.name as category_name, c.slug as category_slug, c.path as category_path,
           b.id as business_id, b.name as business_name, b.slug as business_slug,
           b.logo_url as business_logo, b.city as business_city, b.country_code as business_country,
           b.verification_status, b.rating_avg as business_rating, b.badges as business_badges,
           b.accepts_orders, b.delivery_enabled,
           b.delivery_fee, b.free_delivery_over, b.base_currency, b.tax_registered
    from _search_ids s
    join public.products p on p.id = s.product_id
    join public.businesses b on b.id = p.business_id
    left join public.categories c on c.id = p.category_id
  ) x
  where x.rn > v_offset and x.rn <= v_offset + v_limit;

  return jsonb_build_object(
    'total', v_total, 'limit', v_limit, 'offset', v_offset, 'items', v_rows,
    'has_more', (v_offset + v_limit) < v_total);
end $$;

create or replace function public.search_businesses(
  p_q text default null,
  p_category_id uuid default null,
  p_city text default null,
  p_country_code text default null,
  p_min_rating numeric default null,
  p_verified_only boolean default false,
  p_near_lat double precision default null,
  p_near_lng double precision default null,
  p_radius_km numeric default null,
  p_sort text default 'relevance',
  p_limit integer default 24,
  p_offset integer default 0
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_limit integer := least(coalesce(p_limit,24),100);
  v_offset integer := greatest(coalesce(p_offset,0),0);
  v_q text := nullif(trim(p_q),'');
  v_total bigint;
  v_rows jsonb;
begin
  create temporary table if not exists _sb_ids (business_id uuid primary key) on commit delete rows;
  delete from _sb_ids;

  insert into _sb_ids
  select b.id
  from public.businesses b
  left join public.categories c on c.id = b.category_id
  where b.is_public and b.deleted_at is null and b.suspended_at is null
    and (v_q is null or b.name % v_q or similarity(b.name, v_q) > 0.15
         or b.name ilike '%' || v_q || '%'
         or coalesce(b.description,'') ilike '%' || v_q || '%'
         or coalesce(b.tagline,'') ilike '%' || v_q || '%'
         or c.name ilike '%' || v_q || '%')
    and (p_category_id is null or b.category_id = p_category_id)
    and (p_city is null or lower(b.city) = lower(p_city))
    and (p_country_code is null or b.country_code = p_country_code)
    and (p_min_rating is null or b.rating_avg >= p_min_rating)
    and (not coalesce(p_verified_only,false) or b.verification_status = 'verified')
    -- "Nearby businesses": haversine on the stored {lat,lng}
    and (p_near_lat is null or p_near_lng is null or (
          b.location ? 'lat' and b.location ? 'lng'
          and 6371 * acos(least(1, greatest(-1,
                cos(radians(p_near_lat)) * cos(radians((b.location->>'lat')::float8))
                * cos(radians((b.location->>'lng')::float8) - radians(p_near_lng))
                + sin(radians(p_near_lat)) * sin(radians((b.location->>'lat')::float8))
              ))) <= coalesce(p_radius_km, 50)))
  on conflict do nothing;

  select count(*) into v_total from _sb_ids;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.rn), '[]'::jsonb) into v_rows
  from (
    select row_number() over (order by
              case when p_sort='rating' then b.rating_avg end desc nulls last,
              case when p_sort='newest' then b.joined_at end desc nulls last,
              case when p_sort='name' then lower(b.name) end asc,
              b.is_featured desc, b.rating_avg desc, b.sales_count desc) as rn,
           b.id, b.name, b.slug, b.logo_url, b.cover_url, b.tagline, b.description,
           b.business_type, b.city, b.region, b.country_code, b.location, b.phone,
           b.whatsapp, b.email, b.website, b.opening_hours, b.verification_status,
           b.badges, b.rating_avg, b.rating_count, b.sales_count, b.product_count,
           b.is_featured, b.delivery_enabled, b.accepts_wholesale, b.joined_at,
           c.name as category_name, c.slug as category_slug,
           (select count(*) from public.products p
             where p.business_id = b.id and p.is_published and p.deleted_at is null) as live_products,
           case when p_near_lat is not null and p_near_lng is not null
                 and b.location ? 'lat' and b.location ? 'lng' then
              round((6371 * acos(least(1, greatest(-1,
                cos(radians(p_near_lat)) * cos(radians((b.location->>'lat')::float8))
                * cos(radians((b.location->>'lng')::float8) - radians(p_near_lng))
                + sin(radians(p_near_lat)) * sin(radians((b.location->>'lat')::float8))
              ))))::numeric, 1)
           end as distance_km
    from _sb_ids s join public.businesses b on b.id = s.business_id
    left join public.categories c on c.id = b.category_id
  ) x
  where x.rn > v_offset and x.rn <= v_offset + v_limit;

  return jsonb_build_object('total', v_total, 'items', v_rows,
                            'has_more', (v_offset + v_limit) < v_total);
end $$;

create or replace function public.get_store(p_slug text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_store jsonb;
begin
  select jsonb_build_object(
    'store', to_jsonb(s),
    'business', (select to_jsonb(b) from public.businesses b where b.id = s.business_id),
    'category', (select jsonb_build_object('id',c.id,'name',c.name,'slug',c.slug)
                   from public.categories c
                   where c.id = (select b.category_id from public.businesses b where b.id = s.business_id)),
    'stats', (select jsonb_build_object(
        'products', count(*) filter (where p.is_published and p.deleted_at is null),
        'services', (select count(*) from public.services sv where sv.business_id = s.business_id and sv.is_published),
        'reviews', (select count(*) from public.reviews r where r.business_id = s.business_id and r.status='published'),
        'avg_rating', (select coalesce(round(avg(r.rating)::numeric,2),0) from public.reviews r
                        where r.business_id = s.business_id and r.status='published'))
      from public.products p where p.business_id = s.business_id)
  ) into v_store
  from public.stores s
  where s.slug = lower(p_slug)
    and (s.is_published or public.has_business_access(s.business_id) or public.is_admin())
  limit 1;

  if v_store is null then return jsonb_build_object('found', false); end if;

  update public.stores s set view_count = s.view_count + 1
   where s.slug = lower(p_slug);

  return v_store || jsonb_build_object('found', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- COUPONS
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.validate_coupon(p_code text, p_business_id uuid, p_subtotal numeric)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_c public.coupons; v_discount numeric := 0;
begin
  select * into v_c from public.coupons
   where upper(code) = upper(trim(p_code))
     and (p_business_id is null or business_id = p_business_id)
     and is_active and starts_at <= now() and (ends_at is null or ends_at > now())
   limit 1;

  if not found then return jsonb_build_object('valid', false, 'reason','not_found'); end if;
  if v_c.total_limit is not null and v_c.usage_count >= v_c.total_limit then
    return jsonb_build_object('valid', false, 'reason','exhausted');
  end if;
  if coalesce(p_subtotal,0) < v_c.min_subtotal then
    return jsonb_build_object('valid', false, 'reason','min_subtotal', 'required', v_c.min_subtotal);
  end if;
  if v_c.per_customer_limit is not null and auth.uid() is not null then
    if (select count(*) from public.coupon_redemptions r
         where r.coupon_id = v_c.id and r.user_id = auth.uid()) >= v_c.per_customer_limit then
      return jsonb_build_object('valid', false, 'reason','per_customer_limit');
    end if;
  end if;

  v_discount := case v_c.discount_type
    when 'percent' then least(round(coalesce(p_subtotal,0) * v_c.discount_value/100.0,2),
                            coalesce(v_c.max_discount, coalesce(p_subtotal,0)))
    when 'fixed'   then least(v_c.discount_value, coalesce(p_subtotal,0))
    when 'free_delivery' then 0
    else 0 end;

  return jsonb_build_object('valid', true, 'coupon_id', v_c.id, 'code', v_c.code,
    'discount_type', v_c.discount_type, 'discount_value', v_c.discount_value,
    'discount', v_discount, 'description', v_c.description, 'ends_at', v_c.ends_at);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- DASHBOARD & REPORTS
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.dashboard_summary(
  p_business_id uuid,
  p_from date default null,
  p_to   date default null,
  p_branch_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_from date := coalesce(p_from, date_trunc('month', current_date)::date);
  v_to   date := coalesce(p_to, current_date);
  v_cur  text;
  v_sym  text;
begin
  if not public.can(p_business_id,'dashboard.read') and not public.has_business_access(p_business_id) then
    raise exception 'permission_denied: dashboard.read';
  end if;

  select coalesce(b.base_currency,'ZMW'), coalesce(c.symbol,'K')
    into v_cur, v_sym
    from public.businesses b left join public.currencies c on c.code = b.base_currency
   where b.id = p_business_id;

  return jsonb_build_object(
    'currency', v_cur, 'symbol', v_sym, 'from', v_from, 'to', v_to,

    'today', (select jsonb_build_object(
        'sales', coalesce(sum(o.total),0),
        'orders', count(*),
        'payments', (select coalesce(sum(p.amount),0) from public.payments p
                      where p.business_id = p_business_id and p.direction='inbound'
                        and p.status='completed' and p.received_at::date = current_date))
      from public.orders o
      where o.business_id = p_business_id and o.placed_at::date = current_date
        and o.status not in ('cancelled','returned')
        and (p_branch_id is null or o.branch_id = p_branch_id)),

    'period', (select jsonb_build_object(
        'revenue', coalesce(sum(o.total),0),
        'orders', count(*),
        'cogs', coalesce(sum(oi.quantity * oi.unit_cost),0),
        'profit', coalesce(sum(oi.line_profit),0),
        'items_sold', coalesce(sum(oi.quantity),0))
      from public.orders o
      left join public.order_items oi on oi.order_id = o.id
      where o.business_id = p_business_id
        and o.placed_at::date between v_from and v_to
        and o.status not in ('cancelled','returned')
        and (p_branch_id is null or o.branch_id = p_branch_id)),

    'expenses', (select coalesce(sum(e.amount),0) from public.expenses e
                  where e.business_id = p_business_id
                    and e.expense_date between v_from and v_to
                    and e.status not in ('rejected')
                    and (p_branch_id is null or e.branch_id = p_branch_id)),

    'receivable', (select coalesce(sum(i.balance_due),0) from public.invoices i
                    where i.business_id = p_business_id and i.deleted_at is null
                      and i.status in ('sent','viewed','partially_paid')),

    'overdue', (select jsonb_build_object('amount', coalesce(sum(i.balance_due),0), 'count', count(*))
                  from public.invoices i
                  where i.business_id = p_business_id and i.deleted_at is null
                    and i.due_date < current_date
                    and i.status in ('sent','viewed','partially_paid')),

    'payable', (select coalesce(sum(sb.balance_due),0) from public.supplier_bills sb
                 where sb.business_id = p_business_id and sb.deleted_at is null
                   and sb.status in ('sent','viewed','partially_paid','approved')),

    'available', (select coalesce(sum(p.amount),0) from public.payments p
                   where p.business_id = p_business_id and p.direction='inbound'
                     and p.status='completed' and p.deleted_at is null),

    'stock', (select jsonb_build_object(
        'value', coalesce(sum(i.stock_value),0),
        'units', coalesce(sum(i.quantity_on_hand),0),
        'low', (select count(distinct i2.product_id) from public.inventory i2
                 where i2.business_id = p_business_id and i2.quantity_on_hand <= i2.reorder_point),
        'out', (select count(*) from public.products p2
                where p2.business_id = p_business_id and p2.deleted_at is null
                  and p2.track_inventory and p2.stock <= 0))
      from public.inventory i where i.business_id = p_business_id),

    'counts', (select jsonb_build_object(
        'products', (select count(*) from public.products p where p.business_id = p_business_id and p.deleted_at is null),
        'published', (select count(*) from public.products p where p.business_id = p_business_id and p.is_published and p.deleted_at is null),
        'drafts', (select count(*) from public.products p where p.business_id = p_business_id and p.status='draft' and p.deleted_at is null),
        'customers', (select count(*) from public.customers c where c.business_id = p_business_id and c.deleted_at is null),
        'new_customers', (select count(*) from public.customers c where c.business_id = p_business_id and c.created_at::date between v_from and v_to),
        'orders_pending', (select count(*) from public.orders o where o.business_id = p_business_id and o.status in ('pending','confirmed','processing')),
        'quotations_open', (select count(*) from public.quotations q where q.business_id = p_business_id and q.deleted_at is null and q.status in ('draft','sent','viewed')),
        'invoices_unpaid', (select count(*) from public.invoices i where i.business_id = p_business_id and i.deleted_at is null and i.status in ('sent','viewed','partially_paid')),
        'reviews', (select count(*) from public.reviews r where r.business_id = p_business_id),
        'unread_messages', (select coalesce(sum(c.unread_business),0) from public.conversations c where c.business_id = p_business_id and c.status='open'),
        'staff', (select count(*) from public.business_members m where m.business_id = p_business_id and m.status='active'))),

    'pending_approvals', (select jsonb_build_object(
        'refunds', (select count(*) from public.refunds r where r.business_id = p_business_id and r.requires_approval and r.approved_at is null),
        'purchase_orders', (select count(*) from public.purchase_orders po where po.business_id = p_business_id and po.requires_approval and po.approved_at is null),
        'expenses', (select count(*) from public.expenses e where e.business_id = p_business_id and e.requires_approval and e.approved_at is null),
        'ai_actions', (select count(*) from public.ai_actions a where a.business_id = p_business_id and a.status='proposed' and a.requires_approval),
        'returns', (select count(*) from public.returns rt where rt.business_id = p_business_id and rt.status='requested'))),

    'verification', (select jsonb_build_object('status', b.verification_status, 'badges', to_jsonb(b.badges),
                                               'growth_score', b.growth_score)
                       from public.businesses b where b.id = p_business_id));
end $$;

create or replace function public.sales_series(
  p_business_id uuid,
  p_from date,
  p_to date,
  p_granularity text default 'day'
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb;
begin
  if not public.can(p_business_id,'reports.read') and not public.has_business_access(p_business_id) then
    raise exception 'permission_denied: reports.read';
  end if;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.bucket), '[]'::jsonb) into v_rows
  from (
    select case p_granularity
             when 'month' then date_trunc('month', o.placed_at)::date
             when 'week'  then date_trunc('week', o.placed_at)::date
             else o.placed_at::date end as bucket,
           round(sum(o.total),2) as revenue,
           count(*)::integer as orders,
           round(coalesce(sum(oi.profit),0),2) as profit,
           coalesce(sum(oi.qty),0)::integer as items
    from public.orders o
    left join lateral (
      select sum(x.line_profit) as profit, sum(x.quantity) as qty
      from public.order_items x where x.order_id = o.id) oi on true
    where o.business_id = p_business_id
      and o.placed_at::date between p_from and p_to
      and o.status not in ('cancelled','returned')
    group by 1
  ) x;

  return jsonb_build_object('series', v_rows, 'granularity', p_granularity, 'from', p_from, 'to', p_to);
end $$;

create or replace function public.top_products(
  p_business_id uuid, p_from date, p_to date, p_limit integer default 10, p_order text default 'revenue'
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb;
begin
  if not public.can(p_business_id,'reports.read') and not public.has_business_access(p_business_id) then
    raise exception 'permission_denied: reports.read';
  end if;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.rn), '[]'::jsonb) into v_rows
  from (
    select row_number() over (order by
             case when p_order='quantity' then sum(oi.quantity) end desc,
             case when p_order='profit' then sum(oi.line_profit) end desc,
             sum(oi.line_total) desc) as rn,
           oi.product_id, max(oi.name) as name, max(oi.image_url) as image_url,
           max(oi.sku) as sku,
           sum(oi.quantity)::integer as quantity,
           round(sum(oi.line_total),2) as revenue,
           round(sum(oi.line_profit),2) as profit
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    where o.business_id = p_business_id
      and o.placed_at::date between p_from and p_to
      and o.status not in ('cancelled','returned')
    group by oi.product_id
    order by rn
    limit least(coalesce(p_limit,10), 100)
  ) x;
  return jsonb_build_object('items', v_rows);
end $$;

create or replace function public.top_customers(
  p_business_id uuid, p_limit integer default 10
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb;
begin
  if not public.can(p_business_id,'customers.read') then
    raise exception 'permission_denied: customers.read';
  end if;
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.total_spent desc), '[]'::jsonb) into v_rows
  from (select c.id, c.name, c.phone, c.email, c.city, c.customer_group, c.orders_count,
               c.total_spent, c.outstanding_balance, c.last_order_at, c.loyalty_points
        from public.customers c
        where c.business_id = p_business_id and c.deleted_at is null
        order by c.total_spent desc, c.orders_count desc
        limit least(coalesce(p_limit,10),100)) x;
  return jsonb_build_object('items', v_rows);
end $$;

create or replace function public.low_stock_alerts(p_business_id uuid, p_limit integer default 20)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb;
begin
  if not public.can(p_business_id,'inventory.read') then
    raise exception 'permission_denied: inventory.read';
  end if;
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.severity desc, x.stock asc), '[]'::jsonb) into v_rows
  from (
    select p.id as product_id, p.name, p.sku, p.primary_image_url, p.stock as product_stock,
           p.stock_alert, w.name as warehouse, w.id as warehouse_id,
           i.quantity_on_hand, i.quantity_reserved, i.reorder_point,
           i.unit_cost, i.stock_value, i.bin_location,
           (i.reorder_point - i.quantity_on_hand) as shortfall,
           case when i.quantity_on_hand <= 0 then 2 else 1 end as severity,
           case when i.quantity_on_hand <= 0 then 'out_of_stock' else 'low_stock' end as level
    from public.inventory i
    join public.products p on p.id = i.product_id
    join public.warehouses w on w.id = i.warehouse_id
    where i.business_id = p_business_id
      and i.quantity_on_hand <= i.reorder_point
      and p.deleted_at is null
    order by severity desc, i.quantity_on_hand asc
    limit least(coalesce(p_limit,20),200)
  ) x;
  return jsonb_build_object('items', v_rows, 'count', coalesce(jsonb_array_length(v_rows),0));
end $$;

create or replace function public.overdue_invoices(p_business_id uuid, p_limit integer default 50)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb;
begin
  if not public.can(p_business_id,'invoices.read') then
    raise exception 'permission_denied: invoices.read';
  end if;
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.days_overdue desc), '[]'::jsonb) into v_rows
  from (
    select i.id, i.invoice_number, i.issue_date, i.due_date, i.total, i.amount_paid, i.balance_due,
           i.currency, i.status, (current_date - i.due_date) as days_overdue,
           c.name as customer_name, c.phone as customer_phone, c.email as customer_email,
           i.share_token, i.reminders_sent
    from public.invoices i
    left join public.customers c on c.id = i.customer_id
    where i.business_id = p_business_id and i.deleted_at is null
      and i.due_date < current_date
      and i.status in ('sent','viewed','partially_paid')
    order by days_overdue desc
    limit least(coalesce(p_limit,50),500)
  ) x;
  return jsonb_build_object('items', v_rows,
    'total_outstanding', (select coalesce(sum(i.balance_due),0) from public.invoices i
                           where i.business_id = p_business_id and i.deleted_at is null
                             and i.due_date < current_date
                             and i.status in ('sent','viewed','partially_paid')));
end $$;

-- Statement of account for a customer (opening balance → documents → payments → closing).
create or replace function public.customer_statement(
  p_customer_id uuid, p_from date, p_to date
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_c public.customers;
  v_opening numeric;
  v_rows jsonb;
begin
  select * into v_c from public.customers where id = p_customer_id;
  if not found then raise exception 'customer_not_found'; end if;
  if not public.can(v_c.business_id,'customers.read') then
    raise exception 'permission_denied: customers.read';
  end if;

  select coalesce(sum(case when ct.direction='debit' then ct.amount else -ct.amount end),0)
    into v_opening
    from public.customer_transactions ct
   where ct.customer_id = p_customer_id and ct.occurred_at::date < p_from;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.occurred_at, x.id), '[]'::jsonb) into v_rows
  from (
    select ct.id, ct.occurred_at, ct.kind, ct.direction, ct.amount, ct.currency,
           ct.balance_after, ct.reference_number, ct.description
    from public.customer_transactions ct
    where ct.customer_id = p_customer_id
      and ct.occurred_at::date between p_from and p_to
  ) x;

  return jsonb_build_object(
    'customer', jsonb_build_object('id',v_c.id,'name',v_c.name,'email',v_c.email,'phone',v_c.phone,
                                   'address_line1',v_c.address_line1,'city',v_c.city,
                                   'country_code',v_c.country_code,'currency',v_c.currency,
                                   'tax_number',v_c.tax_number),
    'from', p_from, 'to', p_to,
    'opening_balance', v_opening,
    'entries', v_rows,
    'total_debits', (select coalesce(sum(ct.amount),0) from public.customer_transactions ct
                      where ct.customer_id = p_customer_id and ct.direction='debit'
                        and ct.occurred_at::date between p_from and p_to),
    'total_credits', (select coalesce(sum(ct.amount),0) from public.customer_transactions ct
                      where ct.customer_id = p_customer_id and ct.direction='credit'
                        and ct.occurred_at::date between p_from and p_to),
    'closing_balance', (select coalesce(ct.balance_after, v_opening)
                          from public.customer_transactions ct
                         where ct.customer_id = p_customer_id and ct.occurred_at::date <= p_to
                         order by ct.occurred_at desc, ct.id desc limit 1));
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- BUSINESS HEALTH / GROWTH SCORE (internal readiness indicator, not a credit score)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.compute_growth_score(p_business_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_profile smallint := 0;
  v_catalog smallint := 0;
  v_activity smallint := 0;
  v_inventory smallint := 0;
  v_reputation smallint := 0;
  v_total smallint;
  v_breakdown jsonb;
begin
  if not public.has_business_access(p_business_id) then
    raise exception 'permission_denied';
  end if;

  -- Profile completeness (0-25)
  select (
    (case when coalesce(logo_url,'') <> '' then 4 else 0 end) +
    (case when coalesce(cover_url,'') <> '' then 2 else 0 end) +
    (case when coalesce(description,'') <> '' and length(description) > 40 then 4 else 0 end) +
    (case when coalesce(phone,'') <> '' then 2 else 0 end) +
    (case when coalesce(email,'') <> '' then 2 else 0 end) +
    (case when coalesce(address_line1,'') <> '' then 2 else 0 end) +
    (case when coalesce(city,'') <> '' then 1 else 0 end) +
    (case when opening_hours <> '{}'::jsonb then 2 else 0 end) +
    (case when social <> '{}'::jsonb then 2 else 0 end) +
    (case when coalesce(website,'') <> '' then 1 else 0 end) +
    (case when verification_status = 'verified' then 3 else 0 end)
  )::smallint into v_profile
  from public.businesses where id = p_business_id;

  -- Catalogue (0-25)
  select least(25, (
    (select case when count(*) >= 1 then 5 else 0 end from public.products p where p.business_id = p_business_id and p.deleted_at is null) +
    (select case when count(*) >= 10 then 5 else 0 end from public.products p where p.business_id = p_business_id and p.deleted_at is null) +
    (select case when count(*) >= 5 then 5 else 0 end from public.products p where p.business_id = p_business_id and p.is_published and p.deleted_at is null) +
    (select case when count(*) >= 5 then 3 else 0 end from public.products p where p.business_id = p_business_id and p.primary_image_url is not null) +
    (select case when count(*) >= 3 then 3 else 0 end from public.categories c
       where c.id in (select p.category_id from public.products p where p.business_id = p_business_id)) +
    (select case when count(*) >= 1 then 2 else 0 end from public.services s where s.business_id = p_business_id) +
    (select case when count(*) >= 1 then 2 else 0 end from public.stores s where s.business_id = p_business_id and s.is_published)
  ))::smallint into v_catalog;

  -- Sales & customer activity in the last 30 days (0-20)
  select least(20, (
    (select case when count(*) >= 1 then 5 else 0 end from public.orders o where o.business_id = p_business_id and o.placed_at > now() - interval '30 days') +
    (select case when count(*) >= 10 then 5 else 0 end from public.orders o where o.business_id = p_business_id and o.placed_at > now() - interval '30 days') +
    (select case when count(*) >= 1 then 3 else 0 end from public.invoices i where i.business_id = p_business_id and i.created_at > now() - interval '30 days') +
    (select case when count(*) >= 1 then 3 else 0 end from public.customers c where c.business_id = p_business_id and c.created_at > now() - interval '30 days') +
    (select case when count(*) >= 1 then 2 else 0 end from public.quotations q where q.business_id = p_business_id and q.created_at > now() - interval '30 days') +
    (select case when count(*) >= 1 then 2 else 0 end from public.payments p2 where p2.business_id = p_business_id and p2.received_at > now() - interval '30 days')
  ))::smallint into v_activity;

  -- Inventory health (0-15)
  select least(15, (
    (select case when count(*) >= 1 then 5 else 0 end from public.inventory i where i.business_id = p_business_id) +
    (select case when coalesce(count(*) filter (where i.quantity_on_hand > i.reorder_point),0)::float
                      / nullif(count(*),0) >= 0.9 then 6
                 when coalesce(count(*) filter (where i.quantity_on_hand > i.reorder_point),0)::float
                      / nullif(count(*),0) >= 0.7 then 3 else 0 end
       from public.inventory i where i.business_id = p_business_id) +
    (select case when count(*) >= 1 then 4 else 0 end from public.csv_sources c where c.business_id = p_business_id and c.is_active)
  ))::smallint into v_inventory;

  -- Reputation & engagement (0-15)
  select least(15, (
    (select case when rating_avg >= 4.5 then 6 when rating_avg >= 4 then 4 when rating_avg >= 3 then 2 else 0 end
       from public.businesses where id = p_business_id) +
    (select case when count(*) >= 5 then 4 else 0 end from public.reviews r where r.business_id = p_business_id and r.status='published') +
    (select case when count(*) >= 1 then 3 else 0 end from public.follows f where f.business_id = p_business_id) +
    (select case when count(*) >= 1 then 2 else 0 end from public.conversations c where c.business_id = p_business_id)
  ))::smallint into v_reputation;

  v_total := least(100, v_profile + v_catalog + v_activity + v_inventory + v_reputation);
  v_breakdown := jsonb_build_object(
    'profile', v_profile, 'catalogue', v_catalog, 'activity', v_activity,
    'inventory', v_inventory, 'reputation', v_reputation, 'total', v_total,
    'level', case when v_total >= 85 then 'excellent' when v_total >= 65 then 'strong'
                  when v_total >= 40 then 'developing' else 'getting_started' end,
    'next_steps', (
      select coalesce(jsonb_agg(step order by priority), '[]'::jsonb)
      from (
        select 1 as priority, 'Add your business logo and cover image' as step
          where v_profile < 10
        union all select 2, 'Publish at least 5 products with photos' where v_catalog < 15
        union all select 3, 'Record your first sale' where v_activity < 5
        union all select 4, 'Set reorder points and receive stock into inventory' where v_inventory < 8
        union all select 5, 'Invite customers to leave a review' where v_reputation < 8
        union all select 6, 'Complete business verification to earn the Verified badge'
          where (select verification_status from public.businesses where id = p_business_id) <> 'verified'
        union all select 7, 'Connect a CSV source to keep stock in sync' where v_inventory < 15
      ) s
    ));

  update public.businesses set growth_score = v_total, updated_at = now() where id = p_business_id;
  return v_breakdown;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- CSV SYNCHRONISATION (preview → validate → import; scheduled re-sync)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.import_csv_rows(p_source_id uuid, p_rows jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_src    public.csv_sources;
  v_row    jsonb;
  v_map    jsonb;
  v_product public.products;
  v_id     uuid;
  v_created integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_failed  integer := 0;
  v_errors  jsonb := '[]'::jsonb;
  v_rownum  integer := 0;
  v_name    text; v_sku text; v_barcode text; v_price numeric; v_stock integer;
  v_desc    text; v_image text; v_category text; v_cat_id uuid; v_brand text;
  v_cost    numeric; v_wholesale numeric;
  v_log     uuid;
  v_stock_before integer;
begin
  select * into v_src from public.csv_sources where id = p_source_id for update;
  if not found then raise exception 'csv_source_not_found'; end if;
  if not public.can(v_src.business_id,'products.write') then
    raise exception 'permission_denied: products.write';
  end if;

  insert into public.sync_logs (csv_source_id, business_id, status, triggered_by, triggered_user, rows_total)
  values (p_source_id, v_src.business_id, 'running',
          case when v_src.sync_mode='scheduled' then 'schedule' else 'manual' end, auth.uid(),
          jsonb_array_length(p_rows))
  returning id into v_log;

  v_map := coalesce(v_src.column_mapping,'{}'::jsonb);

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_rownum := v_rownum + 1;
    begin
      -- Resolve mapped columns, falling back to common header names.
      v_name := nullif(trim(coalesce(
        v_row->>coalesce(v_map->>'name','name'), v_row->>'Product Name', v_row->>'product_name',
        v_row->>'Title', v_row->>'title', v_row->>'Item','')),'');
      v_sku := nullif(trim(coalesce(
        v_row->>coalesce(v_map->>'sku','sku'), v_row->>'SKU', v_row->>'Sku', v_row->>'Code','')),'');
      v_barcode := nullif(trim(coalesce(
        v_row->>coalesce(v_map->>'barcode','barcode'), v_row->>'Barcode', v_row->>'EAN','')),'');
      v_price := nullif(regexp_replace(coalesce(
        v_row->>coalesce(v_map->>'price','price'), v_row->>'Price', v_row->>'Selling Price',
        v_row->>'Retail Price','0'), '[^0-9.\-]', '', 'g'),'')::numeric;
      v_cost := nullif(regexp_replace(coalesce(
        v_row->>coalesce(v_map->>'cost','cost_price'), v_row->>'Cost', v_row->>'Cost Price','0'),
        '[^0-9.\-]','','g'),'')::numeric;
      v_wholesale := nullif(regexp_replace(coalesce(
        v_row->>coalesce(v_map->>'wholesale_price','wholesale_price'), v_row->>'Wholesale Price',''),
        '[^0-9.\-]','','g'),'')::numeric;
      v_stock := coalesce(nullif(regexp_replace(coalesce(
        v_row->>coalesce(v_map->>'stock','stock'), v_row->>'Stock', v_row->>'Quantity',
        v_row->>'Qty','0'), '[^0-9\-]','','g'),'')::integer, 0);
      v_desc := nullif(trim(coalesce(
        v_row->>coalesce(v_map->>'description','description'), v_row->>'Description','')),'');
      v_image := nullif(trim(coalesce(
        v_row->>coalesce(v_map->>'image','image'), v_row->>'Image URL', v_row->>'Image','')),'');
      v_category := nullif(trim(coalesce(
        v_row->>coalesce(v_map->>'category','category'), v_row->>'Category','')),'');
      v_brand := nullif(trim(coalesce(
        v_row->>coalesce(v_map->>'brand','brand'), v_row->>'Brand','')),'');

      if v_name is null and v_sku is null then
        raise exception 'row is missing both product name and SKU';
      end if;
      if v_price is null or v_price < 0 then
        raise exception 'invalid price';
      end if;

      -- Category: match by name (case-insensitive) or create it.
      if v_category is not null then
        select c.id into v_cat_id from public.categories c
         where lower(c.name) = lower(v_category) limit 1;
        if v_cat_id is null then
          insert into public.categories (name, slug, kind, path, depth, is_active)
          values (initcap(v_category), public.slugify(v_category), 'product',
                  '/' || public.slugify(v_category), 0, true)
          on conflict (slug) do update set name = excluded.name
          returning id into v_cat_id;
        end if;
      end if;

      -- Match an existing product per the configured strategy.
      v_id := null;
      case v_src.match_strategy
        when 'sku' then
          if v_sku is not null then
            select p.id into v_id from public.products p
             where p.business_id = v_src.business_id and p.sku = v_sku and p.deleted_at is null limit 1;
          end if;
        when 'barcode' then
          if v_barcode is not null then
            select p.id into v_id from public.products p
             where p.business_id = v_src.business_id and p.barcode = v_barcode and p.deleted_at is null limit 1;
          end if;
        when 'external_id' then
          select p.id into v_id from public.products p
           where p.business_id = v_src.business_id
             and p.external_id = coalesce(v_row->>'id', v_row->>'ID', v_sku) and p.deleted_at is null limit 1;
        else  -- name
          if v_name is not null then
            select p.id into v_id from public.products p
             where p.business_id = v_src.business_id and lower(p.name) = lower(v_name) and p.deleted_at is null
             limit 1;
          end if;
      end case;

      if v_id is not null and v_src.on_conflict <> 'create_new' then
        if v_src.on_conflict = 'skip' then
          v_skipped := v_skipped + 1;
          continue;
        end if;

        select * into v_product from public.products where id = v_id for update;
        v_stock_before := v_product.stock;

        update public.products p set
          name = coalesce(v_name, p.name),
          sku = coalesce(v_sku, p.sku),
          barcode = coalesce(v_barcode, p.barcode),
          description = case when 'description' = any(v_src.update_fields) then coalesce(v_desc, p.description) else p.description end,
          price = case when 'price' = any(v_src.update_fields) then coalesce(v_price, p.price) else p.price end,
          cost_price = coalesce(v_cost, p.cost_price),
          wholesale_price = coalesce(v_wholesale, p.wholesale_price),
          category_id = coalesce(v_cat_id, p.category_id),
          brand = coalesce(v_brand, p.brand),
          primary_image_url = case when 'image' = any(v_src.update_fields) then coalesce(v_image, p.primary_image_url) else p.primary_image_url end,
          media = case when v_image is not null and 'image' = any(v_src.update_fields)
                        and not exists (select 1 from jsonb_array_elements(p.media) m where m->>'url' = v_image)
                       then p.media || jsonb_build_array(jsonb_build_object('url', v_image, 'type','image', 'position', jsonb_array_length(p.media)))
                       else p.media end,
          source = case when p.source = 'manual' then 'csv' else p.source end,
          csv_source_id = p_source_id,
          last_synced_at = now(),
          updated_at = now()
        where p.id = v_id;

        -- Stock is applied through the ledger so movements stay auditable.
        if v_src.auto_adjust_stock and 'stock' = any(v_src.update_fields) and v_stock is not null then
          declare v_delta integer := v_stock - v_stock_before;
          begin
            if v_delta <> 0 then
              perform public.adjust_stock(v_src.business_id, v_id, v_delta, 'import',
                (select w.id from public.warehouses w where w.business_id = v_src.business_id and w.is_active
                  order by w.is_primary desc limit 1),
                null, null, 'csv_sync', p_source_id, v_src.name, 'csv_synchronisation');
            end if;
          end;
        end if;

        v_updated := v_updated + 1;
      else
        insert into public.products (
          business_id, store_id, name, slug, sku, barcode, description, price, cost_price,
          wholesale_price, category_id, brand, primary_image_url, media, status, is_published,
          stock, source, csv_source_id, external_id, last_synced_at, created_by)
        values (
          v_src.business_id,
          (select s.id from public.stores s where s.business_id = v_src.business_id limit 1),
          coalesce(v_name, 'Imported product'),
          coalesce(public.slugify(coalesce(v_name,'product')), 'product') || '-' || substr(encode(gen_random_bytes(3),'hex'),1,6),
          v_sku, v_barcode, v_desc, coalesce(v_price,0), coalesce(v_cost,0), v_wholesale,
          v_cat_id, v_brand, v_image,
          case when v_image is not null
               then jsonb_build_array(jsonb_build_object('url', v_image,'type','image','position',0))
               else '[]'::jsonb end,
          case when v_src.auto_publish then 'active' else 'draft' end,
          v_src.auto_publish,
          coalesce(v_stock,0), 'csv', p_source_id,
          coalesce(v_row->>'id', v_row->>'ID'), now(), auth.uid())
        returning id into v_id;

        if coalesce(v_stock,0) <> 0 then
          perform public.adjust_stock(v_src.business_id, v_id, v_stock, 'import',
            (select w.id from public.warehouses w where w.business_id = v_src.business_id and w.is_active
              order by w.is_primary desc limit 1),
            null, coalesce(v_cost,0), 'csv_sync', p_source_id, v_src.name, 'opening_stock_from_csv');
        end if;

        v_created := v_created + 1;
      end if;

    exception when others then
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object(
        'row', v_rownum, 'name', coalesce(v_name,''), 'sku', coalesce(v_sku,''),
        'message', sqlerrm);
      if jsonb_array_length(v_errors) >= 200 then
        -- keep the payload bounded
        null;
      end if;
    end;
  end loop;

  update public.sync_logs set
    status = case when v_failed = 0 then 'success'
                  when v_created + v_updated = 0 then 'failed' else 'partial' end,
    rows_created = v_created, rows_updated = v_updated, rows_skipped = v_skipped,
    rows_failed = v_failed, stock_changed = v_updated + v_created,
    errors = v_errors, finished_at = now(),
    duration_ms = greatest(0, (extract(epoch from clock_timestamp() - started_at)*1000)::integer)
   where id = v_log;

  update public.csv_sources set
    last_sync_at = now(), total_syncs = total_syncs + 1,
    last_sync_status = (select status from public.sync_logs where id = v_log),
    next_sync_at = case when sync_mode = 'scheduled' and sync_interval_minutes is not null
                        then now() + make_interval(mins => sync_interval_minutes) end,
    updated_at = now()
   where id = p_source_id;

  perform public.log_audit(v_src.business_id, 'csv.imported', 'csv_source', p_source_id, v_src.name, null,
    jsonb_build_object('created', v_created, 'updated', v_updated, 'failed', v_failed));

  if v_failed > 0 then
    perform public.notify_business_owners(v_src.business_id, 'system',
      format('CSV import finished with %s error(s)', v_failed),
      format('%s created, %s updated, %s failed.', v_created, v_updated, v_failed),
      '/business/import', 'high');
  end if;

  return jsonb_build_object('sync_log_id', v_log, 'created', v_created, 'updated', v_updated,
                            'skipped', v_skipped, 'failed', v_failed, 'errors', v_errors,
                            'status', (select status from public.sync_logs where id = v_log));
end $$;

-- Fetch a remote CSV and import it (scheduled sync entry point).
create or replace function public.sync_csv_source(p_source_id uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  -- The worker/edge function downloads the URL and passes parsed rows here so
  -- the database never performs outbound HTTP.
  return public.import_csv_rows(p_source_id, p_rows);
end $$;

create or replace function public.due_csv_sources(p_limit integer default 20)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'business_id', c.business_id,
      'name', c.name, 'source_url', c.source_url, 'delimiter', c.delimiter,
      'has_header', c.has_header, 'column_mapping', c.column_mapping,
      'last_sync_at', c.last_sync_at)), '[]'::jsonb)
  from (select * from public.csv_sources
         where sync_mode = 'scheduled' and is_active
           and (next_sync_at is null or next_sync_at <= now())
         order by next_sync_at nulls first
         limit least(coalesce(p_limit,20),100)) c;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- AI SAFETY GUARD
-- ─────────────────────────────────────────────────────────────────────────────
-- Impact classification drives whether an AI-proposed action needs the owner's
-- explicit approval. Financial, destructive and outward-facing actions always do
-- unless the owner deliberately enables automation for that rule.
create or replace function public.ai_action_impact(p_action text)
returns text language sql immutable set search_path = public as $$
  select case
    when p_action in ('delete_record','delete_product','delete_customer','delete_business','purge_data')
      then 'destructive'
    when p_action in ('refund','change_price','issue_credit_note','write_off','adjust_stock_value',
                      'make_payment','approve_purchase_order','change_bank_details','void_invoice')
      then 'financial'
    when p_action in ('send_invoice','send_reminder','send_email','send_sms','send_whatsapp',
                      'publish_product','share_document','create_payment_link','run_campaign')
      then 'high'
    when p_action in ('create_invoice','create_quotation','create_order','adjust_stock',
                      'create_product','update_product','create_customer','import_csv')
      then 'medium'
    else 'low'
  end;
$$;

create or replace function public.propose_ai_action(
  p_business_id uuid, p_action text, p_payload jsonb,
  p_explanation text default null, p_conversation_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_impact text := public.ai_action_impact(p_action);
  v_requires boolean;
  v_id uuid;
  v_auto boolean;
begin
  if not public.can(p_business_id,'ai.use') then
    raise exception 'permission_denied: ai.use';
  end if;

  -- Automation may be enabled only by an owner/administrator, per rule.
  select coalesce(bool_or(not ar.requires_approval), false) into v_auto
    from public.automation_rules ar
   where ar.business_id = p_business_id and ar.is_active
     and exists (select 1 from jsonb_array_elements(ar.actions) a where a->>'type' = p_action);

  v_requires := v_impact in ('financial','destructive','high') or not coalesce(v_auto,false);
  if v_impact = 'destructive' then v_requires := true; end if;   -- never fully automatic

  insert into public.ai_actions (business_id, conversation_id, requested_by, action, impact,
                                 requires_approval, status, payload, explanation)
  values (p_business_id, p_conversation_id, auth.uid(), p_action, v_impact,
          v_requires, case when v_requires then 'proposed' else 'proposed' end,
          p_payload, p_explanation)
  returning id into v_id;

  if v_requires then
    perform public.notify_business_owners(p_business_id, 'system',
      format('AI is waiting for approval: %s', replace(p_action,'_',' ')),
      coalesce(p_explanation, 'Review the proposed change before it is applied.'),
      format('/business/ai/actions/%s', v_id), 'high');
  end if;

  return jsonb_build_object('id', v_id, 'action', p_action, 'impact', v_impact,
                            'requires_approval', v_requires, 'status', 'proposed');
end $$;

create or replace function public.resolve_ai_action(
  p_action_id uuid, p_decision text, p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_a public.ai_actions;
  v_result jsonb := '{}'::jsonb;
begin
  select * into v_a from public.ai_actions where id = p_action_id for update;
  if not found then raise exception 'ai_action_not_found'; end if;
  if not (public.can(v_a.business_id,'ai.approve') or public.is_owner_or_admin(v_a.business_id)) then
    raise exception 'permission_denied: ai.approve';
  end if;

  case p_decision
    when 'approved' then
      update public.ai_actions
         set status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now()
       where id = p_action_id;
      v_result := jsonb_build_object('approved', true, 'execution', 'pending');
    when 'rejected' then
      update public.ai_actions
         set status = 'rejected', approved_by = auth.uid(), approved_at = now(),
             rejected_reason = p_reason, updated_at = now()
       where id = p_action_id;
      v_result := jsonb_build_object('rejected', true);
    when 'executed' then
      update public.ai_actions
         set status = 'executed', executed_at = now(), updated_at = now()
       where id = p_action_id;
    else raise exception 'invalid_decision: %', p_decision;
  end case;

  perform public.log_audit(v_a.business_id, 'ai_action.' || p_decision, 'ai_action', p_action_id,
                           v_a.action, null, jsonb_build_object('impact', v_a.impact, 'reason', p_reason));
  return v_result || jsonb_build_object('id', p_action_id, 'action', v_a.action);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- GRANTS
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in (
                'log_audit','notify_user','notify_business_owners','create_business',
                'register_as_seller','is_slug_available','suggest_slug','adjust_stock',
                'transfer_stock','create_share_token','mark_document_viewed',
                'get_shared_document','respond_to_quotation','convert_quotation_to_invoice',
                'create_invoice','create_quotation','upsert_customer','create_order',
                'deduct_stock_for_order','restock_order','record_payment','create_receipt',
                'update_order_status','assign_delivery','next_return_number','create_return',
                'process_return',
                'create_invoice_from_order','create_payment_link','get_payment_link',
                'search_products','search_businesses','get_store','validate_coupon',
                'dashboard_summary','sales_series','top_products','top_customers',
                'low_stock_alerts','overdue_invoices','customer_statement',
                'compute_growth_score','import_csv_rows','sync_csv_source','due_csv_sources',
                'ai_action_impact','propose_ai_action','resolve_ai_action')
  loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;

  -- Public/anon callable: browsing, share links and payment pages.
  for f in select p.oid::regprocedure as sig
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('search_products','search_businesses','get_store',
                                'get_shared_document','mark_document_viewed',
                                'get_payment_link','respond_to_quotation',
                                'is_slug_available','validate_coupon')
  loop
    execute format('grant execute on function %s to anon', f.sig);
  end loop;
end $$;

select 'seedwel_hub: 0009 business logic ok' as status;
