-- ═══════════════════════════════════════════════════════════════════════════
--  Seedwel Hub — 0012: public payment links
--  A product of Seedwel Investment Limited
-- ═══════════════════════════════════════════════════════════════════════════
--  Why this migration exists
--  ─────────────────────────
--  A payment link is sent to someone who may not have an account: a customer on
--  WhatsApp, a tender respondent, a walk-in paying later. Everything they need
--  has to be reachable with the code in the URL and nothing else.
--
--  Two things were missing:
--    1. `get_payment_link` returned the seller's name and city but not how to
--       actually pay, so the public page had no mobile-money number or bank
--       account to show.
--    2. There was no way for an anonymous payer to tell the seller "I have paid".
--       Writing straight into `payments` from the public internet would let
--       anyone mark any invoice paid, so instead the payer's declaration lands
--       in `payment_link_submissions` — a queue the seller confirms, which then
--       records the real payment through `record_payment` and generates the
--       receipt. No money is ever marked received without the business agreeing.
--
--  Idempotent: safe to re-run. Run AFTER 0011.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. PAYMENT LINK SUBMISSIONS
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.payment_link_submissions (
  id               uuid primary key default gen_random_uuid(),
  payment_link_id  uuid not null references public.payment_links(id) on delete cascade,
  business_id      uuid not null references public.businesses(id) on delete cascade,
  invoice_id       uuid references public.invoices(id) on delete set null,
  order_id         uuid references public.orders(id) on delete set null,
  customer_id      uuid references public.customers(id) on delete set null,
  amount           numeric(14,2) not null check (amount > 0),
  currency         text not null default 'ZMW' references public.currencies(code),
  method           public.payment_method not null default 'mobile_money',
  provider         text,
  reference        text,
  payer_name       text,
  payer_phone      text,
  payer_email      text,
  status           text not null default 'submitted',   -- submitted|confirmed|rejected|duplicate
  payment_id       uuid references public.payments(id) on delete set null,
  receipt_id       uuid references public.receipts(id) on delete set null,
  note             text,
  reviewed_by      uuid references auth.users(id) on delete set null,
  reviewed_by_name text,
  reviewed_at      timestamptz,
  submitted_by     uuid references auth.users(id) on delete set null,
  ip_address       inet,
  user_agent       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.payment_link_submissions is
  'Payments declared by public payers through a payment link, awaiting business confirmation.';

create index if not exists payment_link_submissions_link_idx
  on public.payment_link_submissions (payment_link_id, created_at desc);
create index if not exists payment_link_submissions_business_idx
  on public.payment_link_submissions (business_id, status, created_at desc);
create index if not exists payment_link_submissions_pending_idx
  on public.payment_link_submissions (business_id, created_at desc) where status = 'submitted';

alter table public.payment_link_submissions enable row level security;

select public.drop_policies('payment_link_submissions');

-- Public payers may insert a declaration but never read or change one: reading
-- would leak other customers' amounts and phone numbers.
create policy "payment_link_submissions_insert" on public.payment_link_submissions
  for insert to anon, authenticated
  with check (true);

-- Members of the business see their own queue.
create policy "payment_link_submissions_read" on public.payment_link_submissions
  for select to authenticated
  using (public.is_business_member(business_id));

create policy "payment_link_submissions_write" on public.payment_link_submissions
  for update to authenticated
  using (public.can(business_id, 'payments.record'))
  with check (public.can(business_id, 'payments.record'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. get_payment_link — now includes how to pay and the thank-you text
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.get_payment_link(p_code text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_link public.payment_links;
begin
  select * into v_link
    from public.payment_links
   where code = lower(p_code)
   limit 1;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  if v_link.status <> 'active' then
    return jsonb_build_object(
      'found', false, 'reason', 'inactive', 'status', v_link.status,
      'message', case v_link.status
                   when 'paid'      then 'This link has already been paid.'
                   when 'expired'   then 'This link has expired.'
                   when 'cancelled' then 'This link was cancelled by the seller.'
                   when 'paused'    then 'This link is paused. Please contact the seller.'
                   else 'This link is no longer accepting payments.'
                 end);
  end if;

  if v_link.expires_at is not null and v_link.expires_at <= now() then
    return jsonb_build_object('found', false, 'reason', 'expired', 'status', 'expired',
                              'message', 'This link has expired.');
  end if;

  return jsonb_build_object(
    'found', true,
    'code', v_link.code,
    'label', v_link.label,
    'description', v_link.description,
    'amount', v_link.amount,
    'currency', v_link.currency,
    'allow_custom_amount', v_link.allow_custom_amount,
    'min_amount', v_link.min_amount,
    'max_amount', v_link.max_amount,
    'methods', to_jsonb(v_link.methods),
    'message', v_link.message,
    'thank_you_message', v_link.thank_you_message,
    'redirect_url', v_link.redirect_url,
    'customer_name', v_link.customer_name,
    'status', v_link.status,
    'expires_at', v_link.expires_at,
    'amount_collected', v_link.amount_collected,
    'balance', greatest(v_link.amount - coalesce(v_link.amount_collected, 0), 0),
    'submissions', (select count(*) from public.payment_link_submissions s
                     where s.payment_link_id = v_link.id and s.status = 'submitted'),
    'invoice_number', (select i.invoice_number from public.invoices i where i.id = v_link.invoice_id),
    'order_number',   (select o.order_number from public.orders o where o.id = v_link.order_id),
    'business', (select jsonb_build_object(
                   'name', b.name, 'logo_url', b.logo_url, 'slug', b.slug,
                   'phone', b.phone, 'email', b.email, 'city', b.city,
                   'country_code', b.country_code, 'address_line1', b.address_line1,
                   'verification_status', b.verification_status, 'rating_avg', b.rating_avg,
                   'bank_details', coalesce(b.bank_details, '{}'::jsonb))
                 from public.businesses b where b.id = v_link.business_id));
end;
$$;

revoke all on function public.get_payment_link(text) from public;
grant execute on function public.get_payment_link(text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. pay_via_link — an anonymous payer declares "I have paid"
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.pay_via_link(p_input jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_code   text := lower(nullif(trim(p_input->>'code'),''));
  v_link   public.payment_links;
  v_amount numeric(14,2);
  v_method public.payment_method;
  v_phone  text := nullif(trim(p_input->>'payer_phone'),'');
  v_email  text := nullif(trim(p_input->>'payer_email'),'');
  v_name   text := nullif(trim(p_input->>'payer_name'),'');
  v_ref    text := nullif(trim(p_input->>'reference'),'');
  v_prov   text := nullif(trim(p_input->>'provider'),'');
  v_id     uuid;
begin
  if v_code is null then
    raise exception 'A payment link code is required.';
  end if;

  select * into v_link from public.payment_links where code = v_code for update;
  if not found then
    raise exception 'This payment link does not exist.';
  end if;
  if v_link.status <> 'active' then
    raise exception 'This payment link is no longer accepting payments.';
  end if;
  if v_link.expires_at is not null and v_link.expires_at <= now() then
    raise exception 'This payment link has expired.';
  end if;
  if v_link.max_payments is not null and v_link.payments_count >= v_link.max_payments then
    raise exception 'This payment link has reached its payment limit.';
  end if;

  -- Amount: fixed unless the seller allowed the payer to choose.
  v_amount := greatest(v_link.amount - coalesce(v_link.amount_collected, 0), 0);
  if v_link.allow_custom_amount then
    v_amount := round(coalesce(nullif(trim(p_input->>'amount'),''), v_amount::text)::numeric, 2);
    if coalesce(v_link.min_amount, 0) > 0 and v_amount < v_link.min_amount then
      raise exception 'The minimum amount for this link is %.', public.format_money(v_link.min_amount, v_link.currency);
    end if;
    if v_link.max_amount is not null and v_amount > v_link.max_amount then
      raise exception 'The maximum amount for this link is %.', public.format_money(v_link.max_amount, v_link.currency);
    end if;
  end if;
  if v_amount <= 0 then
    raise exception 'Enter an amount greater than zero.';
  end if;

  -- Method must be one the seller enabled.
  begin
    v_method := coalesce(nullif(trim(p_input->>'method'),''), v_link.methods[1])::public.payment_method;
  exception when others then
    raise exception 'That payment method is not recognised.';
  end;
  if not (v_method = any (v_link.methods)) then
    raise exception 'The seller does not accept that payment method on this link.';
  end if;

  -- One declaration per payer per link; a second attempt is reported, not stored.
  if v_phone is not null and exists (
       select 1 from public.payment_link_submissions s
        where s.payment_link_id = v_link.id
          and s.status in ('submitted','confirmed')
          and s.payer_phone = v_phone) then
    return jsonb_build_object('ok', false, 'duplicate', true,
      'message', 'You have already told us about a payment on this link. The seller is working on confirming it.');
  end if;

  insert into public.payment_link_submissions (
    payment_link_id, business_id, invoice_id, order_id, customer_id,
    amount, currency, method, provider, reference,
    payer_name, payer_phone, payer_email, submitted_by, ip_address, user_agent)
  values (
    v_link.id, v_link.business_id, v_link.invoice_id, v_link.order_id, v_link.customer_id,
    v_amount, v_link.currency, v_method, v_prov, v_ref,
    coalesce(v_name, v_link.customer_name), v_phone, coalesce(v_email, v_link.customer_email),
    auth.uid(),
    nullif(coalesce(p_input->>'ip_address',
                    to_json(current_setting('request.headers', true))::jsonb->>'x-forwarded-for'), '')::inet,
    left(coalesce(p_input->>'user_agent',
                  to_json(current_setting('request.headers', true))::jsonb->>'user-agent', ''), 400))
  returning id into v_id;

  perform public.notify_business_owners(
    v_link.business_id, 'payment',
    'Payment declared on a link',
    format('%s declared %s by %s%s',
           coalesce(v_name, v_phone, v_link.customer_name, 'A payer'),
           public.format_money(v_amount, v_link.currency),
           v_method::text,
           coalesce(' (ref ' || v_ref || ')', '')),
    '/business/orders', 'high');

  perform public.log_audit(
    v_link.business_id, 'payment_link.submitted', 'payment_link', v_link.id, v_link.code,
    jsonb_build_object('amount', v_amount, 'method', v_method, 'reference', v_ref),
    jsonb_build_object('submission_id', v_id, 'source', 'public_pay_page',
                       'payer', coalesce(v_name, v_phone, 'Public payer')));

  return jsonb_build_object(
    'ok', true, 'duplicate', false, 'submission_id', v_id,
    'amount', v_amount, 'currency', v_link.currency, 'status', 'submitted',
    'message', coalesce(v_link.thank_you_message,
      'Thank you. The seller has been notified and will confirm your payment shortly.'));
exception
  when others then
    if sqlerrm like '%invalid input syntax for type inet%' then
      -- A malformed forwarded-for header must never lose a real payment.
      raise exception 'Please try again.';
    end if;
    raise;
end;
$$;

revoke all on function public.pay_via_link(jsonb) from public;
grant execute on function public.pay_via_link(jsonb) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. resolve_payment_submission — the business confirms or rejects it
-- ─────────────────────────────────────────────────────────────────────────────
--  Confirming runs the real `record_payment`, which writes the payment, updates
--  the invoice, settles the order, generates the receipt and marks the link
--  paid through the existing rollup trigger.
create or replace function public.resolve_payment_submission(
  p_submission_id uuid,
  p_action text,                    -- confirm | reject
  p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sub  public.payment_link_submissions;
  v_actor_name text;
  v_res  jsonb;
begin
  select * into v_sub from public.payment_link_submissions
   where id = p_submission_id for update;
  if not found then
    raise exception 'That payment declaration does not exist.';
  end if;
  if not public.can(v_sub.business_id, 'payments.record') then
    raise exception 'You do not have permission to record payments.';
  end if;
  if v_sub.status <> 'submitted' then
    raise exception 'This payment declaration has already been %.', v_sub.status;
  end if;
  if lower(coalesce(p_action,'')) not in ('confirm','reject') then
    raise exception 'Unknown action "%".', p_action;
  end if;

  select coalesce(p.display_name, p.full_name, p.email) into v_actor_name
    from public.profiles p where p.id = auth.uid();

  if lower(p_action) = 'reject' then
    update public.payment_link_submissions
       set status = 'rejected', note = nullif(trim(p_note),''),
           reviewed_by = auth.uid(), reviewed_by_name = v_actor_name,
           reviewed_at = now(), updated_at = now()
     where id = v_sub.id;

    perform public.notify_business_owners(
      v_sub.business_id, 'payment', 'Payment declaration rejected',
      format('%s was rejected%s', coalesce(v_sub.payer_name, v_sub.payer_phone, 'A declared payment'),
             coalesce(': ' || nullif(trim(p_note),''), '.')),
      '/business/orders', 'normal');

    return jsonb_build_object('ok', true, 'status', 'rejected', 'submission_id', v_sub.id);
  end if;

  -- Confirm → real payment, receipt, invoice and order updates.
  select public.record_payment(jsonb_build_object(
           'business_id', v_sub.business_id,
           'invoice_id', v_sub.invoice_id,
           'order_id', v_sub.order_id,
           'customer_id', v_sub.customer_id,
           'payment_link_id', v_sub.payment_link_id,
           'amount', v_sub.amount,
           'currency', v_sub.currency,
           'method', v_sub.method,
           'provider', v_sub.provider,
           'reference', v_sub.reference,
           'direction', 'inbound',
           'payer_name', v_sub.payer_name,
           'payer_phone', v_sub.payer_phone,
           'payer_email', v_sub.payer_email,
           'generate_receipt', true,
           'allow_overpay', false,
           'notes', format('Confirmed from payment link declaration%s%s',
                           coalesce(' by ' || v_sub.payer_name, ''),
                           coalesce(' — ' || nullif(trim(p_note),''), ''))))
    into v_res;

  update public.payment_link_submissions
     set status = 'confirmed',
         payment_id = nullif(v_res->>'payment_id','')::uuid,
         receipt_id = nullif(v_res->>'receipt_id','')::uuid,
         note = nullif(trim(p_note),''),
         reviewed_by = auth.uid(), reviewed_by_name = v_actor_name,
         reviewed_at = now(), updated_at = now()
   where id = v_sub.id;

  return jsonb_build_object(
    'ok', true, 'status', 'confirmed', 'submission_id', v_sub.id,
    'payment_id', v_res->>'payment_id', 'receipt_id', v_res->>'receipt_id',
    'amount', v_sub.amount, 'currency', v_sub.currency);
end;
$$;

revoke all on function public.resolve_payment_submission(uuid, text, text) from public;
grant execute on function public.resolve_payment_submission(uuid, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. updated_at trigger
-- ─────────────────────────────────────────────────────────────────────────────
drop trigger if exists payment_link_submissions_touch on public.payment_link_submissions;
create trigger payment_link_submissions_touch
  before update on public.payment_link_submissions
  for each row execute function public.tg_set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Grants
-- ─────────────────────────────────────────────────────────────────────────────
revoke all on public.payment_link_submissions from public;
grant select, insert, update on public.payment_link_submissions to authenticated;
grant insert on public.payment_link_submissions to anon;

select 'seedwel_hub: 0012 public payment links ok' as status;
