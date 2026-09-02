-- ══════════════════════════════════════════════════════════════════════════════
--  SEEDWEL HUB — 0010 · Triggers: totals, counters, ledgers, ratings, audit
--                        trail, slugs, verification QR tokens, stock bootstrap
--
--  Rule: anything that must stay consistent across tables is enforced here, not
--  in the client. The client can be wrong; the database cannot.
-- ══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. DOCUMENT TOTALS (server-computed — the client can never fake a total)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.recalculate_invoice_totals(p_invoice_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_sub numeric; v_disc numeric; v_tax numeric; v_total numeric; v_cur text; v_del numeric;
  v_business uuid;
begin
  select coalesce(sum(ii.line_subtotal),0), coalesce(sum(ii.discount_amount),0),
         coalesce(sum(ii.tax_amount),0), coalesce(i.currency,'ZMW'),
         coalesce(i.delivery_fee,0), i.business_id
    into v_sub, v_disc, v_tax, v_cur, v_del, v_business
    from public.invoice_items ii, public.invoices i
   where ii.invoice_id = p_invoice_id and i.id = p_invoice_id
   group by i.currency, i.delivery_fee, i.business_id;

  if v_business is null then return; end if;

  v_total := round(coalesce(v_sub,0) + coalesce(v_tax,0) + coalesce(v_del,0), 2);

  update public.invoices i
     set subtotal = coalesce(v_sub,0),
         tax_total = coalesce(v_tax,0),
         discount_total = coalesce(v_disc,0),
         total = v_total,
         updated_at = now()
   where i.id = p_invoice_id;

  -- Keep the document-centre mirror in step.
  update public.documents d
     set total = v_total, currency = v_cur, updated_at = now()
   where d.entity_type = 'invoice' and d.entity_id = p_invoice_id;

  -- Mirror the paid amount onto a linked order.
  update public.orders o
     set amount_paid = i.amount_paid,
         payment_status = case when i.amount_paid >= i.total and i.total > 0 then 'completed'::public.payment_status
                               when i.amount_paid > 0 then 'processing'::public.payment_status
                               else 'pending'::public.payment_status end
    from public.invoices i
   where o.invoice_id = i.id and i.id = p_invoice_id;
end $$;

create or replace function public.recalculate_quotation_totals(p_quotation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_sub numeric; v_disc numeric; v_tax numeric; v_total numeric; v_cur text; v_business uuid;
begin
  select coalesce(sum(qi.line_total - qi.tax_amount),0), coalesce(sum(qi.discount_amount),0),
         coalesce(sum(qi.tax_amount),0), q.currency, q.business_id
    into v_sub, v_disc, v_tax, v_cur, v_business
    from public.quotation_items qi, public.quotations q
   where qi.quotation_id = p_quotation_id and q.id = p_quotation_id
   group by q.currency, q.business_id;

  if v_business is null then return; end if;

  v_total := round(coalesce(v_sub,0) + coalesce(v_tax,0)
                   + coalesce((select delivery_fee from public.quotations where id = p_quotation_id),0), 2);

  update public.quotations q
     set subtotal = coalesce(v_sub,0), tax_total = coalesce(v_tax,0),
         discount_total = coalesce(v_disc,0), total = v_total, updated_at = now()
   where q.id = p_quotation_id;

  update public.documents d set total = v_total, currency = v_cur, updated_at = now()
   where d.entity_type = 'quotation' and d.entity_id = p_quotation_id;
end $$;

create or replace function public.tg_invoice_items_totals()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.recalculate_invoice_totals(coalesce(new.invoice_id, old.invoice_id));
  return null;
end $$;

create or replace function public.tg_quotation_items_totals()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.recalculate_quotation_totals(coalesce(new.quotation_id, old.quotation_id));
  return null;
end $$;

create or replace function public.tg_order_items_totals()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_order uuid := coalesce(new.order_id, old.order_id);
  v_coupon_discount numeric;
begin
  select coalesce(
    case cp.discount_type
      when 'percent' then least(round(s.sub * cp.discount_value/100.0,2), coalesce(cp.max_discount, s.sub))
      when 'fixed'   then least(cp.discount_value, s.sub)
      when 'free_delivery' then 0
      else 0 end, 0)
    into v_coupon_discount
  from public.orders o
  left join public.coupons cp on cp.id = o.coupon_id
  left join lateral (select coalesce(sum(oi.line_subtotal),0) as sub
                       from public.order_items oi where oi.order_id = o.id) s on true
  where o.id = v_order;

  update public.orders o
     set subtotal = s.sub,
         tax_total = s.tax,
         discount_total = s.disc + coalesce(v_coupon_discount,0),
         total = round(s.sub + s.tax + coalesce(o.delivery_fee,0) + coalesce(o.tip_amount,0)
                       - coalesce(v_coupon_discount,0), 2),
         updated_at = now()
    from (select coalesce(sum(oi.line_subtotal),0) sub, coalesce(sum(oi.tax_amount),0) tax,
                 coalesce(sum(oi.discount_amount),0) disc
            from public.order_items oi where oi.order_id = v_order) s
   where o.id = v_order;
  return null;
end $$;

drop trigger if exists invoice_items_totals on public.invoice_items;
create trigger invoice_items_totals
  after insert or update or delete on public.invoice_items
  for each row execute function public.tg_invoice_items_totals();

drop trigger if exists quotation_items_totals on public.quotation_items;
create trigger quotation_items_totals
  after insert or update or delete on public.quotation_items
  for each row execute function public.tg_quotation_items_totals();

drop trigger if exists order_items_totals on public.order_items;
create trigger order_items_totals
  after insert or update or delete on public.order_items
  for each row execute function public.tg_order_items_totals();

-- Purchase order totals
create or replace function public.tg_purchase_items_totals()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_po uuid := coalesce(new.purchase_order_id, old.purchase_order_id);
begin
  update public.purchase_orders po
     set subtotal = s.sub, tax_total = s.tax, discount_total = s.disc,
         total = round(s.sub + s.tax + coalesce(po.delivery_fee,0) - s.disc, 2),
         updated_at = now()
    from (select coalesce(sum(pi.line_total - pi.tax_amount),0) sub,
                 coalesce(sum(pi.tax_amount),0) tax,
                 coalesce(sum(pi.discount_amount),0) disc
            from public.purchase_items pi where pi.purchase_order_id = v_po) s
   where po.id = v_po;
  return null;
end $$;

drop trigger if exists purchase_items_totals on public.purchase_items;
create trigger purchase_items_totals
  after insert or update or delete on public.purchase_items
  for each row execute function public.tg_purchase_items_totals();

-- Supplier bill totals are set on insert by the client/RPC; keep balance_due in step.
create or replace function public.tg_supplier_bills_supplier_totals()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.suppliers s
     set outstanding_amount = coalesce((
           select sum(b.balance_due) from public.supplier_bills b
            where b.supplier_id = coalesce(new.supplier_id, old.supplier_id)
              and b.deleted_at is null and b.status not in ('paid','cancelled','void')),0),
         updated_at = now()
   where s.id = coalesce(new.supplier_id, old.supplier_id);
  return null;
end $$;

drop trigger if exists supplier_bills_totals on public.supplier_bills;
create trigger supplier_bills_totals
  after insert or update or delete on public.supplier_bills
  for each row execute function public.tg_supplier_bills_supplier_totals();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. INVOICE LEDGER + OVERDUE STATUS
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.tg_invoice_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.customer_id is null then return null; end if;

  -- Credit notes reduce what the customer owes; everything else increases it.
  insert into public.customer_transactions
    (business_id, customer_id, kind, direction, amount, currency, balance_after,
     reference_type, reference_id, reference_number, description)
  values (
    new.business_id, new.customer_id,
    case new.kind when 'credit_note' then 'credit_note' when 'debit_note' then 'debit_note' else 'invoice' end,
    case new.kind when 'credit_note' then 'credit' else 'debit' end,
    new.total, new.currency, new.balance_due,
    'invoice', new.id, new.invoice_number,
    format('%s issued', initcap(replace(new.kind,'_',' '))))
  on conflict do nothing;

  -- Roll the outstanding balance up onto the customer record.
  update public.customers c
     set outstanding_balance = coalesce((
           select sum(case when i.kind = 'credit_note' then -i.balance_due else i.balance_due end)
             from public.invoices i
            where i.customer_id = c.id and i.deleted_at is null
              and i.status in ('sent','viewed','partially_paid','overdue')),0),
         credit_balance = coalesce((
           select sum(i.balance_due) from public.invoices i
            where i.customer_id = c.id and i.deleted_at is null and i.kind = 'credit_note'
              and i.status in ('sent','viewed','partially_paid')),0),
         updated_at = now()
   where c.id = new.customer_id;

  return null;
end $$;

drop trigger if exists invoice_ledger on public.invoices;
create trigger invoice_ledger
  after insert on public.invoices
  for each row when (pg_trigger_depth() < 3)
  execute function public.tg_invoice_ledger();

create or replace function public.tg_invoice_status_refresh()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- A payment landing on the invoice keeps status/balance authoritative.
  if new.amount_paid is distinct from old.amount_paid then
    new.status := case
      when new.kind = 'credit_note' and new.amount_credited >= new.total then 'paid'::public.doc_status
      when new.amount_paid + new.amount_credited >= new.total and new.total > 0 then 'paid'::public.doc_status
      when new.amount_paid + new.amount_credited > 0 then 'partially_paid'::public.doc_status
      when new.due_date is not null and new.due_date < current_date
           and new.status in ('sent','viewed') then 'overdue'::public.doc_status
      else new.status end;
    if new.status = 'paid'::public.doc_status and new.paid_at is null then
      new.paid_at := now();
    end if;
  end if;

  -- Auto-overdue regardless of payments.
  if new.due_date is not null and new.due_date < current_date
     and new.status in ('sent','viewed') and new.balance_due > 0 then
    new.status := 'overdue'::public.doc_status;
  end if;

  return new;
end $$;

drop trigger if exists invoice_status_refresh on public.invoices;
create trigger invoice_status_refresh
  before update on public.invoices
  for each row execute function public.tg_invoice_status_refresh();

-- Daily sweep: flip unpaid invoices past due date to 'overdue'.
create or replace function public.refresh_overdue_invoices()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with u as (
    update public.invoices i
       set status = 'overdue'::public.doc_status
     where i.due_date < current_date
       and i.deleted_at is null
       and i.balance_due > 0
       and i.status in ('sent','viewed','partially_paid')
    returning i.id)
  select count(*) into n from u;
  return n;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. CUSTOMER / SUPPLIER ROLLUPS
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.refresh_customer_stats(p_customer_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_customer_id is null then return; end if;
  update public.customers c
     set orders_count = s.orders_count,
         total_spent = s.total_spent,
         first_order_at = s.first_order_at,
         last_order_at = s.last_order_at,
         outstanding_balance = coalesce((
             select sum(case when i.kind='credit_note' then -i.balance_due else i.balance_due end)
               from public.invoices i
              where i.customer_id = c.id and i.deleted_at is null
                and i.status in ('sent','viewed','partially_paid','overdue')),0),
         updated_at = now()
    from (select count(*)::integer as orders_count,
                 coalesce(sum(o.total),0) as total_spent,
                 min(o.placed_at) as first_order_at,
                 max(o.placed_at) as last_order_at
            from public.orders o
           where o.customer_id = p_customer_id and o.status not in ('cancelled','returned')) s
   where c.id = p_customer_id;
end $$;

create or replace function public.tg_order_customer_stats()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_customer_stats(coalesce(new.customer_id, old.customer_id));
  return null;
end $$;

drop trigger if exists order_customer_stats on public.orders;
create trigger order_customer_stats
  after insert or update or delete on public.orders
  for each row when (pg_trigger_depth() < 4)
  execute function public.tg_order_customer_stats();

create or replace function public.tg_payment_customer_stats()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_customer_stats(coalesce(new.customer_id, old.customer_id));
  return null;
end $$;

drop trigger if exists payment_customer_stats on public.payments;
create trigger payment_customer_stats
  after insert or update on public.payments
  for each row when (pg_trigger_depth() < 4)
  execute function public.tg_payment_customer_stats();

create or replace function public.refresh_supplier_stats(p_supplier_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_supplier_id is null then return; end if;
  update public.suppliers s
     set orders_count = coalesce((select count(*)::integer from public.purchase_orders po
                                   where po.supplier_id = p_supplier_id
                                     and po.status not in ('draft','cancelled')),0),
         total_purchased = coalesce((select sum(po.total) from public.purchase_orders po
                                      where po.supplier_id = p_supplier_id
                                        and po.status not in ('draft','cancelled')),0),
         outstanding_amount = coalesce((select sum(b.balance_due) from public.supplier_bills b
                                         where b.supplier_id = p_supplier_id and b.deleted_at is null
                                           and b.status not in ('paid','cancelled','void')),0),
         last_order_at = (select max(po.order_date) from public.purchase_orders po
                           where po.supplier_id = p_supplier_id),
         updated_at = now()
   where s.id = p_supplier_id;
end $$;

create or replace function public.tg_purchase_supplier_stats()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.refresh_supplier_stats(coalesce(new.supplier_id, old.supplier_id));
  return null;
end $$;

drop trigger if exists purchase_supplier_stats on public.purchase_orders;
create trigger purchase_supplier_stats
  after insert or update or delete on public.purchase_orders
  for each row when (pg_trigger_depth() < 4)
  execute function public.tg_purchase_supplier_stats();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RATINGS ROLL-UP (products, services, businesses)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.tg_review_rollup()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_review public.reviews := coalesce(new, old);
begin
  if v_review.product_id is not null then
    update public.products p
       set rating_avg = coalesce(r.avg_rating,0), rating_count = coalesce(r.n,0), updated_at = now()
      from (select round(avg(rating)::numeric,2) avg_rating, count(*)::integer n
              from public.reviews where product_id = v_review.product_id and status = 'published') r
     where p.id = v_review.product_id;
  end if;

  if v_review.service_id is not null then
    update public.services s
       set rating_avg = coalesce(r.avg_rating,0), rating_count = coalesce(r.n,0), updated_at = now()
      from (select round(avg(rating)::numeric,2) avg_rating, count(*)::integer n
              from public.reviews where service_id = v_review.service_id and status = 'published') r
     where s.id = v_review.service_id;
  end if;

  if v_review.target_type = 'business' or (v_review.product_id is null and v_review.service_id is null) then
    update public.businesses b
       set rating_avg = coalesce(r.avg_rating,0), rating_count = coalesce(r.n,0), updated_at = now()
      from (select round(avg(rating)::numeric,2) avg_rating, count(*)::integer n
              from public.reviews where business_id = v_review.business_id and status = 'published') r
     where b.id = v_review.business_id;
  end if;

  update public.stores st
     set rating_avg = coalesce(r.avg_rating,0), rating_count = coalesce(r.n,0), updated_at = now()
    from (select round(avg(rating)::numeric,2) avg_rating, count(*)::integer n
            from public.reviews where business_id = v_review.business_id and status = 'published') r
   where st.business_id = v_review.business_id;

  return null;
end $$;

drop trigger if exists review_rollup on public.reviews;
create trigger review_rollup
  after insert or update or delete on public.reviews
  for each row when (pg_trigger_depth() < 4)
  execute function public.tg_review_rollup();

-- Verified-purchase flag: only orders that were actually delivered count.
create or replace function public.tg_review_verified_flag()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.order_id is not null and not new.is_verified_purchase then
    if exists (select 1 from public.orders o
                where o.id = new.order_id and o.status in ('delivered','shipped','ready')
                  and (o.buyer_user_id = new.reviewer_id)) then
      new.is_verified_purchase := true;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists review_verified_flag on public.reviews;
create trigger review_verified_flag
  before insert on public.reviews
  for each row execute function public.tg_review_verified_flag();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. PRODUCT / BUSINESS COUNTERS
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.tg_product_counters()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_business uuid := coalesce(new.business_id, old.business_id);
begin
  update public.businesses b
     set product_count = coalesce((select count(*)::integer from public.products p
                                    where p.business_id = v_business and p.deleted_at is null
                                      and p.is_published),0),
         updated_at = now()
   where b.id = v_business;

  update public.categories c
     set product_count = coalesce((select count(*)::integer from public.products p
                                    where p.category_id = coalesce(new.category_id, old.category_id)
                                      and p.is_published and p.deleted_at is null),0),
         updated_at = now()
   where c.id = coalesce(new.category_id, old.category_id);

  return null;
end $$;

drop trigger if exists product_counters on public.products;
create trigger product_counters
  after insert or update of is_published, deleted_at, category_id or delete on public.products
  for each row when (pg_trigger_depth() < 4)
  execute function public.tg_product_counters();

create or replace function public.tg_business_member_counter()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_business uuid := coalesce(new.business_id, old.business_id);
begin
  update public.businesses b
     set member_count = coalesce((select count(*)::integer from public.business_members m
                                   where m.business_id = v_business and m.status = 'active'),0),
         updated_at = now()
   where b.id = v_business;
  return null;
end $$;

drop trigger if exists business_member_counter on public.business_members;
create trigger business_member_counter
  after insert or update or delete on public.business_members
  for each row when (pg_trigger_depth() < 4)
  execute function public.tg_business_member_counter();

-- Sold counters on products
create or replace function public.tg_order_sold_counter()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = old.status then return null; end if;
  if new.status in ('delivered','ready','shipped') and old.status not in ('delivered','ready','shipped') then
    update public.products p
       set sold_count = p.sold_count + oi.qty, updated_at = now()
      from (select product_id, sum(quantity) qty from public.order_items
             where order_id = new.id and product_id is not null group by product_id) oi
     where p.id = oi.product_id;
    update public.businesses b set sales_count = b.sales_count + 1, updated_at = now()
     where b.id = new.business_id;
  end if;
  return null;
end $$;

drop trigger if exists order_sold_counter on public.orders;
create trigger order_sold_counter
  after update of status on public.orders
  for each row when (pg_trigger_depth() < 4)
  execute function public.tg_order_sold_counter();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. SLUGS, TOKENS & DEFAULTS ON INSERT
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.tg_business_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_base text; v_i integer := 0;
begin
  if new.slug is null or new.slug = '' then
    v_base := coalesce(nullif(public.slugify(new.name),''), 'business');
  else
    v_base := public.slugify(new.slug);
  end if;
  new.slug := v_base;
  while exists (select 1 from public.businesses b where b.slug = new.slug) loop
    v_i := v_i + 1;
    new.slug := v_base || '-' || v_i::text;
  end loop;

  new.joined_at := coalesce(new.joined_at, now());
  return new;
end $$;

drop trigger if exists business_before_insert on public.businesses;
create trigger business_before_insert
  before insert on public.businesses
  for each row execute function public.tg_business_before_insert();

create or replace function public.tg_store_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_base text; v_i integer := 0;
begin
  v_base := coalesce(nullif(public.slugify(new.slug),''), nullif(public.slugify(new.name),''), 'store');
  new.slug := v_base;
  while exists (select 1 from public.stores s where s.slug = new.slug) loop
    v_i := v_i + 1;
    new.slug := v_base || '-' || v_i::text;
  end loop;
  return new;
end $$;

drop trigger if exists store_before_insert on public.stores;
create trigger store_before_insert
  before insert on public.stores
  for each row execute function public.tg_store_before_insert();

create or replace function public.tg_product_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_base text; v_i integer := 0;
begin
  v_base := coalesce(nullif(public.slugify(new.slug),''), nullif(public.slugify(new.name),''), 'product');
  new.slug := v_base;
  while exists (select 1 from public.products p
                 where p.store_id is not distinct from new.store_id and p.slug = new.slug) loop
    v_i := v_i + 1;
    new.slug := v_base || '-' || v_i::text;
  end loop;

  if new.primary_image_url is null then
    select m->>'url' into new.primary_image_url
      from jsonb_array_elements(new.media) m
     where coalesce(m->>'type','image') = 'image'
     order by coalesce((m->>'position')::integer, 0) limit 1;
  end if;

  if new.published_at is null and new.is_published then new.published_at := now(); end if;
  return new;
end $$;

drop trigger if exists product_before_insert on public.products;
create trigger product_before_insert
  before insert on public.products
  for each row execute function public.tg_product_before_insert();

create or replace function public.tg_product_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_published and old.published_at is null then new.published_at := now(); end if;
  if new.primary_image_url is null and jsonb_array_length(new.media) > 0 then
    select m->>'url' into new.primary_image_url
      from jsonb_array_elements(new.media) m
     where coalesce(m->>'type','image') = 'image'
     order by coalesce((m->>'position')::integer,0) limit 1;
  end if;
  -- Auto-derive status from stock when the seller is tracking inventory.
  if new.track_inventory and new.status not in ('draft','archived','blocked') then
    if new.stock <= 0 then new.status := 'out_of_stock'::public.product_status;
    elsif old.status = 'out_of_stock' and new.stock > 0 then new.status := 'active'::public.product_status;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists product_before_update on public.products;
create trigger product_before_update
  before update on public.products
  for each row execute function public.tg_product_before_update();

-- QR / verification tokens for receipts and invoices issued without one.
create or replace function public.tg_document_tokens()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.qr_token is null then new.qr_token := encode(gen_random_bytes(10),'hex'); end if;
  return new;
end $$;

drop trigger if exists invoice_tokens on public.invoices;
create trigger invoice_tokens before insert on public.invoices
  for each row execute function public.tg_document_tokens();
drop trigger if exists receipt_tokens on public.receipts;
create trigger receipt_tokens before insert on public.receipts
  for each row execute function public.tg_document_tokens();

-- Uppercase coupon codes so lookups are consistent.
create or replace function public.tg_coupon_upper()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.code := upper(trim(new.code));
  return new;
end $$;
drop trigger if exists coupon_upper on public.coupons;
create trigger coupon_upper before insert or update of code on public.coupons
  for each row execute function public.tg_coupon_upper();

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. CATEGORY PATH MAINTENANCE
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.tg_category_path()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_parent_path text := '/';
begin
  if new.parent_id is not null then
    select path into v_parent_path from public.categories where id = new.parent_id;
    v_parent_path := coalesce(v_parent_path,'/');
    new.depth := coalesce((select depth + 1 from public.categories where id = new.parent_id), 1);
  else
    new.depth := 0;
  end if;

  if new.slug is null or new.slug = '' then new.slug := public.slugify(new.name); end if;
  new.path := rtrim(v_parent_path,'/') || '/' || new.slug;

  -- Children follow their parent.
  if tg_op = 'UPDATE' and (old.path is distinct from new.path or old.slug is distinct from new.slug) then
    update public.categories
       set path = replace(path, old.path || '/', new.path || '/'), updated_at = now()
     where path like old.path || '/%';
  end if;
  return new;
end $$;

drop trigger if exists category_path on public.categories;
create trigger category_path
  before insert or update of name, slug, parent_id on public.categories
  for each row execute function public.tg_category_path();

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. INVENTORY BOOTSTRAP (first row per product)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.tg_product_inventory_bootstrap()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_wh uuid;
begin
  if not new.track_inventory then return null; end if;
  if coalesce(new.stock,0) = 0 then return null; end if;

  select w.id into v_wh from public.warehouses w
   where w.business_id = new.business_id and w.is_active
   order by w.is_primary desc, w.created_at limit 1;

  if v_wh is null then
    insert into public.warehouses (business_id, name, kind, is_primary)
    values (new.business_id, 'Main Stock', 'warehouse', true)
    returning id into v_wh;
  end if;

  insert into public.inventory (business_id, warehouse_id, product_id, quantity_on_hand,
                                unit_cost, reorder_point)
  values (new.business_id, v_wh, new.id, new.stock, coalesce(new.cost_price,0),
          coalesce(new.stock_alert,5))
  on conflict do nothing;

  return null;
end $$;

drop trigger if exists product_inventory_bootstrap on public.products;
create trigger product_inventory_bootstrap
  after insert on public.products
  for each row when (pg_trigger_depth() < 4)
  execute function public.tg_product_inventory_bootstrap();

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. VERIFICATION WORKFLOW
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.tg_verification_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'verified' and old.status is distinct from 'verified' then
    new.verified_at := now();
    new.badges := (select array(select distinct b from unnest(new.badges || array['verified']) b));
  end if;
  if new.verification_status = 'suspended' and new.suspended_at is null then
    new.suspended_at := now();
  end if;
  if new.verification_status <> 'suspended' then
    new.suspended_at := null;
    new.suspension_reason := null;
  end if;
  return new;
end $$;

drop trigger if exists verification_status on public.businesses;
create trigger verification_status
  before update of verification_status on public.businesses
  for each row execute function public.tg_verification_status();

create or replace function public.tg_verification_review()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('verified','rejected') and new.reviewed_at is null then
    new.reviewed_at := now();
    new.reviewed_by := coalesce(new.reviewed_by, auth.uid());
    update public.businesses b
       set verification_status = new.status::public.verification_status, updated_at = now()
     where b.id = new.business_id;
    perform public.notify_user(
      (select owner_id from public.businesses where id = new.business_id),
      'security',
      case new.status when 'verified' then 'Your business is verified ✓'
                      else 'Verification needs attention' end,
      coalesce(new.rejection_reason, 'Your Seedwel Hub business verification was approved.'),
      '/business/settings/verification', new.business_id);
  end if;
  return new;
end $$;

drop trigger if exists verification_review on public.business_verifications;
create trigger verification_review
  before update of status on public.business_verifications
  for each row execute function public.tg_verification_review();

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. AUDIT TRAIL on high-value changes
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.tg_audit_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_business uuid;
  v_label    text;
  v_changes  jsonb := '{}'::jsonb;
  v_field    text;
  v_old      jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  v_new      jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  v_action   text;
begin
  if tg_op = 'DELETE' then
    v_business := old.business_id;
    v_label := coalesce(old.name, old.invoice_number, old.order_number, old.quotation_number,
                        old.po_number, old.title, old.id::text);
    v_action := tg_table_name || '.deleted';
  else
    v_business := new.business_id;
    v_label := coalesce(new.name, new.invoice_number, new.order_number, new.quotation_number,
                        new.po_number, new.title, new.id::text);
    v_action := case tg_op when 'INSERT' then tg_table_name || '.created' else tg_table_name || '.updated' end;
  end if;

  if tg_op = 'UPDATE' then
    for v_field in select key from jsonb_each(v_new) loop
      if v_field = any (array['updated_at','created_at','search_vector','stock_value',
                              'quantity_available','balance_due','branch_scope','business_scope']) then
        continue;
      end if;
      if v_old->v_field is distinct from v_new->v_field then
        v_changes := v_changes || jsonb_build_object(v_field,
          jsonb_build_object('old', v_old->v_field, 'new', v_new->v_field));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then return null; end if;   -- nothing meaningful changed
  end if;

  insert into public.audit_logs (business_id, actor_id, actor_name, action, entity_type, entity_id,
                                 entity_label, changes, metadata)
  values (v_business, auth.uid(),
          (select coalesce(display_name, full_name, email) from public.profiles where id = auth.uid()),
          v_action, tg_table_name, coalesce(new.id, old.id), v_label, v_changes,
          jsonb_build_object('op', tg_op));
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['products','orders','invoices','quotations','payments','customers',
                           'suppliers','expenses','purchase_orders','business_members',
                           'stock_adjustments','refunds','returns','coupons','businesses']
  loop
    execute format('drop trigger if exists audit_change on public.%I', t);
    execute format(
      'create trigger audit_change after insert or update or delete on public.%I
       for each row when (pg_trigger_depth() < 5) execute function public.tg_audit_change()', t);
  end loop;
end $$;

-- Price changes get their own explicit audit entry (the spec calls this out).
create or replace function public.tg_product_price_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.price is distinct from old.price then
    insert into public.audit_logs (business_id, actor_id, actor_name, action, entity_type,
                                   entity_id, entity_label, changes)
    values (new.business_id, auth.uid(),
            (select coalesce(display_name, full_name, email) from public.profiles where id = auth.uid()),
            'product.price_changed', 'product', new.id, new.name,
            jsonb_build_object('price', jsonb_build_object('old', old.price, 'new', new.price)));
  end if;
  return null;
end $$;

drop trigger if exists product_price_audit on public.products;
create trigger product_price_audit
  after update of price on public.products
  for each row when (pg_trigger_depth() < 5)
  execute function public.tg_product_price_audit();

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. CONVERSATION ROLLUPS + NOTIFICATIONS
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.tg_message_rollup()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_c public.conversations;
begin
  select * into v_c from public.conversations where id = new.conversation_id;
  if not found then return null; end if;

  update public.conversations
     set last_message_at = new.created_at,
         last_message_preview = left(regexp_replace(new.body, '\s+', ' ', 'g'), 140),
         unread_business = case when new.sender_type = 'user' then unread_business + 1 else unread_business end,
         unread_user = case when new.sender_type = 'business' then unread_user + 1 else unread_user end,
         updated_at = now()
   where id = new.conversation_id;

  -- Notify the other side.
  if new.sender_type = 'user' then
    perform public.notify_business_owners(v_c.business_id, 'message',
      format('New message from %s', v_c.participant_name),
      left(regexp_replace(new.body,'\s+',' ','g'), 120),
      format('/business/messages/%s', v_c.id));
  elsif v_c.participant_user_id is not null then
    perform public.notify_user(v_c.participant_user_id, 'message',
      format('%s replied', coalesce((select name from public.businesses where id = v_c.business_id),'Seller')),
      left(regexp_replace(new.body,'\s+',' ','g'), 120),
      format('/messages/%s', v_c.id), v_c.business_id);
  end if;
  return null;
end $$;

drop trigger if exists message_rollup on public.messages;
create trigger message_rollup
  after insert on public.messages
  for each row when (pg_trigger_depth() < 4)
  execute function public.tg_message_rollup();

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. ORDER STATUS HISTORY + CUSTOMER NOTIFICATIONS
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.tg_order_status_history()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_actor text;
  v_msg text;
begin
  if new.status = old.status then return new; end if;

  select coalesce(display_name, full_name, email, 'System') into v_actor
    from public.profiles where id = auth.uid();

  new.status_history := coalesce(new.status_history,'[]'::jsonb) || jsonb_build_array(
    jsonb_build_object('status', new.status::text, 'at', now(), 'by', coalesce(v_actor,'System'),
                       'previous', old.status::text));

  case new.status
    when 'confirmed'   then v_msg := 'Your order has been confirmed.';
    when 'processing'  then v_msg := 'We are preparing your order.';
    when 'ready'       then v_msg := 'Your order is ready for collection.';
    when 'shipped'     then v_msg := 'Your order is on the way'
                              || case when new.tracking_number is not null
                                      then ' (tracking ' || new.tracking_number || ')' else '' end || '.';
    when 'delivered'   then v_msg := 'Your order was delivered. Thank you!';
    when 'cancelled'   then v_msg := 'Your order was cancelled.';
    else v_msg := null;
  end case;

  new.updated_at := now();
  if new.status = 'delivered' then new.delivered_at := coalesce(new.delivered_at, now()); end if;
  if new.status = 'shipped' then new.shipped_at := coalesce(new.shipped_at, now()); end if;
  if new.status = 'cancelled' then new.cancelled_at := coalesce(new.cancelled_at, now()); end if;
  if new.status in ('delivered','completed') then new.completed_at := coalesce(new.completed_at, now()); end if;

  return new;
end $$;

drop trigger if exists order_status_history on public.orders;
create trigger order_status_history
  before update of status on public.orders
  for each row execute function public.tg_order_status_history();

create or replace function public.tg_order_notify_buyer()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_msg text; v_title text; v_seller text;
begin
  if new.status = old.status then return null; end if;
  if new.buyer_user_id is null then return null; end if;

  select name into v_seller from public.businesses where id = new.business_id;

  v_title := format('Order %s — %s', new.order_number, replace(new.status::text,'_',' '));
  v_msg := case new.status
    when 'confirmed'  then format('%s confirmed your order.', v_seller)
    when 'processing' then format('%s is preparing your order.', v_seller)
    when 'ready'      then 'Your order is ready for collection.'
    when 'shipped'    then 'Your order has shipped'
                            || case when new.tracking_number is not null
                                    then ' — tracking ' || new.tracking_number else '' end || '.'
    when 'delivered'  then 'Your order was delivered. Please leave a review.'
    when 'cancelled'  then format('Your order was cancelled. %s', coalesce(new.cancellation_reason,''))
    else format('Your order status changed to %s.', new.status::text)
  end;

  perform public.notify_user(new.buyer_user_id, 'order', v_title, v_msg,
    format('/orders/%s', new.id), new.business_id, 'order', new.id,
    case when new.status in ('cancelled','delivered') then 'high' else 'normal' end);
  return null;
end $$;

drop trigger if exists order_notify_buyer on public.orders;
create trigger order_notify_buyer
  after update of status on public.orders
  for each row when (pg_trigger_depth() < 5)
  execute function public.tg_order_notify_buyer();

-- Cancelling an order puts the stock back.
create or replace function public.tg_order_cancel_restock()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled'
     and new.channel in ('pos','manual','store') then
    perform public.restock_order(new.id, new.warehouse_id);
  end if;
  return null;
end $$;

drop trigger if exists order_cancel_restock on public.orders;
create trigger order_cancel_restock
  after update of status on public.orders
  for each row when (pg_trigger_depth() < 5)
  execute function public.tg_order_cancel_restock();

-- ─────────────────────────────────────────────────────────────────────────────
-- 13. RETURNS → restock → refund record
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.tg_return_approve()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_item record; v_wh uuid;
begin
  if new.status = old.status then return null; end if;

  if new.status = 'approved' then
    new.reviewed_at := now();
    new.reviewed_by := coalesce(new.reviewed_by, auth.uid());
    perform public.notify_business_owners(new.business_id, 'order',
      format('Return approved — %s', new.return_number), new.reason,
      format('/business/returns/%s', new.id));
  end if;

  if new.status = 'received' and new.restock then
    v_wh := coalesce(new.warehouse_id,
      (select w.id from public.warehouses w where w.business_id = new.business_id and w.is_active
        order by w.is_primary desc limit 1));
    for v_item in select * from public.return_items where return_id = new.id loop
      if v_item.product_id is not null and not v_item.restocked then
        perform public.adjust_stock(new.business_id, v_item.product_id, v_item.quantity,
          'return_in', v_wh, v_item.variant_id, null, 'return', new.id, new.return_number,
          'customer_return', v_item.condition);
        update public.return_items set restocked = true where id = v_item.id;
      end if;
    end loop;
    update public.order_items oi
       set quantity_returned = quantity_returned + ri.quantity
      from public.return_items ri
     where ri.return_id = new.id and ri.order_item_id = oi.id;
  end if;

  if new.status in ('refunded','closed') then
    new.resolved_at := coalesce(new.resolved_at, now());
  end if;

  return new;
end $$;

drop trigger if exists return_approve on public.returns;
create trigger return_approve
  before update of status on public.returns
  for each row execute function public.tg_return_approve();

-- ─────────────────────────────────────────────────────────────────────────────
-- 14. PAYMENT LINKS → auto-complete when paid
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.tg_payment_link_rollup()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_link public.payment_links;
begin
  if new.payment_link_id is null then return null; end if;
  select * into v_link from public.payment_links where id = new.payment_link_id for update;
  if not found then return null; end if;

  -- Every right-hand side here reads the row *before* this update — assignments
  -- in one UPDATE do not see each other — so the status test has to add
  -- new.amount itself. Reading `amount_collected` alone would leave a link that
  -- has just been settled in full stuck on 'active'.
  update public.payment_links
     set payments_count = payments_count + 1,
         amount_collected = amount_collected + new.amount,
         status = case when amount_collected + new.amount >= amount then 'paid' else status end,
         updated_at = now()
   where id = v_link.id;
  return null;
end $$;

drop trigger if exists payment_link_rollup on public.payments;
create trigger payment_link_rollup
  after insert on public.payments
  for each row when (pg_trigger_depth() < 5)
  execute function public.tg_payment_link_rollup();

-- ─────────────────────────────────────────────────────────────────────────────
-- 15. GRANTS for the trigger helpers invoked from functions
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname='public'
              and p.proname in ('recalculate_invoice_totals','recalculate_quotation_totals',
                                'refresh_customer_stats','refresh_supplier_stats',
                                'refresh_overdue_invoices')
  loop
    execute format('revoke all on function %s from public', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

select 'seedwel_hub: 0010 triggers ok' as status;
