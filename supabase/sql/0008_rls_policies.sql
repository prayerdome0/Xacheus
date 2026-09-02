-- ══════════════════════════════════════════════════════════════════════════════
--  SEEDWEL HUB — 0008 · Security: RLS helper functions, role permission matrix,
--                        and Row Level Security policies for every table
--
--  Design rules
--   1. The publishable/anon key is public. NOTHING is readable unless a policy
--      says so. Every table has RLS enabled; no policy = no access.
--   2. Marketplace reads (published products, stores, businesses, categories,
--      reviews, help) are public — that is the shop window.
--   3. Everything else is scoped by business membership + granular permission.
--   4. A cashier can create receipts but cannot read company expenses.
--   5. Helpers are STABLE SECURITY DEFINER with a pinned search_path so policies
--      cannot be hijacked by a caller-supplied search_path.
--   6. Write rules that must stay atomic (stock, invoice balances, numbering)
--      live in SECURITY DEFINER functions, not in the client.
-- ══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. HELPER FUNCTIONS
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.is_platform_admin(p_uid uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = p_uid and is_platform_admin and not is_suspended
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(public.is_platform_admin(auth.uid()), false);
$$;

-- The caller's membership row for a business (null when not a member).
create or replace function public.business_member(p_business_id uuid)
returns public.business_members
language sql stable security definer
set search_path = public
as $$
  select m.*
  from public.business_members m
  where m.business_id = p_business_id
    and m.user_id = auth.uid()
    and m.status = 'active'
  limit 1;
$$;

create or replace function public.is_business_member(p_business_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.business_member(p_business_id));
$$;

create or replace function public.business_role(p_business_id uuid)
returns public.member_role
language sql stable security definer
set search_path = public
as $$
  select (public.business_member(p_business_id)).role;
$$;

create or replace function public.business_roles(p_uid uuid)
returns table(business_id uuid, role public.member_role)
language sql stable security definer
set search_path = public
as $$
  select m.business_id, m.role
  from public.business_members m
  where m.user_id = p_uid and m.status = 'active';
$$;

create or replace function public.my_business_ids()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select m.business_id
  from public.business_members m
  where m.user_id = auth.uid() and m.status = 'active';
$$;

create or replace function public.my_member_role(p_business_id uuid)
returns public.member_role
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select m.role from public.business_members m
      where m.business_id = p_business_id and m.user_id = auth.uid() and m.status = 'active'),
    (select b.owner_id::text::public.member_role from public.businesses b
      where b.id = p_business_id and b.owner_id = auth.uid())
  );
$$;

create or replace function public.is_owner_or_admin(p_business_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.is_admin()
      or exists (select 1 from public.businesses b
                  where b.id = p_business_id and b.owner_id = auth.uid())
      or coalesce(public.business_role(p_business_id) in ('owner','administrator'), false);
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. PERMISSION MATRIX
-- ─────────────────────────────────────────────────────────────────────────────
-- '*' = every permission. Role definitions can be overridden per business via
-- public.roles + business_members.permissions_override / denied_permissions.
create or replace function public.role_permissions(p_role public.member_role)
returns text[]
language sql immutable
set search_path = public
as $$
  select case p_role
    when 'owner' then array['*']
    when 'administrator' then array['*']
    when 'manager' then array[
      'dashboard.read','reports.read','reports.export',
      'products.read','products.write','products.delete',
      'services.read','services.write',
      'inventory.read','inventory.write','inventory.adjust','inventory.transfer','inventory.count',
      'orders.read','orders.write','orders.fulfil',
      'customers.read','customers.write','customers.delete',
      'suppliers.read','suppliers.write',
      'purchases.read','purchases.write','purchases.approve',
      'quotations.read','quotations.write','quotations.send','quotations.approve',
      'invoices.read','invoices.write','invoices.send','invoices.void',
      'receipts.read','receipts.create',
      'payments.read','payments.record','payments.refund',
      'expenses.read','expenses.write','expenses.approve',
      'documents.read','documents.write','documents.send',
      'delivery.read','delivery.write',
      'returns.read','returns.write','returns.approve',
      'marketing.read','marketing.write',
      'pos.use',
      'ai.use','ai.approve',
      'staff.read','staff.invite',
      'settings.read',
      'audit.read'
    ]
    when 'accountant' then array[
      'dashboard.read','reports.read','reports.export',
      'invoices.read','invoices.write','invoices.send','invoices.void',
      'quotations.read','quotations.write','quotations.send',
      'receipts.read','receipts.create',
      'payments.read','payments.record',
      'expenses.read','expenses.write','expenses.approve',
      'purchases.read','purchases.write',
      'suppliers.read','suppliers.write',
      'customers.read','customers.write',
      'documents.read','documents.write','documents.send',
      'returns.read','returns.approve',
      'orders.read',
      'ai.use',
      'settings.read','audit.read'
    ]
    when 'salesperson' then array[
      'dashboard.read',
      'products.read','services.read',
      'inventory.read',
      'customers.read','customers.write',
      'quotations.read','quotations.write','quotations.send',
      'orders.read','orders.write',
      'invoices.read','invoices.write','invoices.send',
      'receipts.read','receipts.create',
      'payments.read','payments.record',
      'documents.read','documents.write',
      'delivery.read',
      'marketing.read',
      'pos.use',
      'ai.use',
      'suppliers.read'
    ]
    when 'cashier' then array[
      -- Deliberately narrow: can sell and take money, cannot see company
      -- expenses, costs, profits, staff or settings.
      'products.read','services.read',
      'inventory.read',
      'customers.read','customers.write',
      'orders.read','orders.write',
      'receipts.read','receipts.create',
      'payments.read','payments.record',
      'invoices.read',
      'pos.use',
      'documents.read'
    ]
    when 'inventory_manager' then array[
      'dashboard.read','reports.read',
      'products.read','products.write',
      'services.read',
      'inventory.read','inventory.write','inventory.adjust','inventory.transfer','inventory.count',
      'suppliers.read','suppliers.write',
      'purchases.read','purchases.write',
      'orders.read','orders.fulfil',
      'delivery.read','delivery.write',
      'returns.read','returns.write',
      'pos.use',
      'ai.use',
      'customers.read',
      'documents.read'
    ]
    when 'warehouse_manager' then array[
      'products.read',
      'inventory.read','inventory.write','inventory.adjust','inventory.transfer','inventory.count',
      'purchases.read',
      'orders.read','orders.fulfil',
      'delivery.read','delivery.write',
      'returns.read','returns.write',
      'suppliers.read',
      'pos.use',
      'documents.read'
    ]
    else array[]::text[]   -- unknown role → no permissions
  end;
$$;

-- Custom roles (per business) can refine the matrix.
create or replace function public.member_permissions(p_business_id uuid)
returns text[]
language sql stable security definer
set search_path = public
as $$
  select coalesce(
    (select array(
        select distinct p
        from unnest(
               coalesce(cr.permissions, public.role_permissions(m.role))
             || m.permissions_override) as p
        where p <> all (m.denied_permissions)
     )
     from public.business_members m
     left join public.roles cr on cr.id = m.custom_role_id
     where m.business_id = p_business_id
       and m.user_id = auth.uid()
       and m.status = 'active'),
    array[]::text[]);
$$;

-- THE permission check used by every write policy.
create or replace function public.can(p_business_id uuid, p_permission text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select
    public.is_admin()
    or exists (select 1 from public.businesses b
                where b.id = p_business_id and b.owner_id = auth.uid())
    or exists (
      select 1
      from unnest(public.member_permissions(p_business_id)) as p
      where p = '*' or p = p_permission
    );
$$;

-- Convenience: any of several permissions.
create or replace function public.can_any(p_business_id uuid, p_permissions text[])
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from unnest(p_permissions) as required
    where public.can(p_business_id, required)
  );
$$;

-- Can this user act for the business at all (any membership)?
create or replace function public.has_business_access(p_business_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.is_admin()
      or exists (select 1 from public.businesses b
                  where b.id = p_business_id and b.owner_id = auth.uid())
      or public.is_business_member(p_business_id);
$$;

-- Is this a published, public storefront row? (marketplace reads)
create or replace function public.is_public_business(p_business_id uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.businesses b
    where b.id = p_business_id and b.is_public and b.deleted_at is null
  );
$$;

revoke all on function public.is_platform_admin(uuid) from public;
revoke all on function public.business_member(uuid) from public;
revoke all on function public.is_business_member(uuid) from public;
revoke all on function public.business_role(uuid) from public;
revoke all on function public.business_roles(uuid) from public;
revoke all on function public.my_business_ids() from public;
revoke all on function public.my_member_role(uuid) from public;
revoke all on function public.is_owner_or_admin(uuid) from public;
revoke all on function public.member_permissions(uuid) from public;
revoke all on function public.can(uuid, text) from public;
revoke all on function public.can_any(uuid, text[]) from public;
revoke all on function public.has_business_access(uuid) from public;
revoke all on function public.is_public_business(uuid) from public;
revoke all on function public.role_permissions(public.member_role) from public;

grant execute on function public.is_admin() to authenticated, anon;
grant execute on function public.is_platform_admin(uuid) to authenticated, anon;
grant execute on function public.business_member(uuid) to authenticated;
grant execute on function public.is_business_member(uuid) to authenticated;
grant execute on function public.business_role(uuid) to authenticated;
grant execute on function public.business_roles(uuid) to authenticated;
grant execute on function public.my_business_ids() to authenticated;
grant execute on function public.my_member_role(uuid) to authenticated;
grant execute on function public.is_owner_or_admin(uuid) to authenticated;
grant execute on function public.member_permissions(uuid) to authenticated;
grant execute on function public.can(uuid, text) to authenticated;
grant execute on function public.can_any(uuid, text[]) to authenticated;
grant execute on function public.has_business_access(uuid) to authenticated;
grant execute on function public.is_public_business(uuid) to authenticated, anon;
grant execute on function public.role_permissions(public.member_role) to authenticated, anon;

-- Seed system role definitions so the UI can render the permission matrix.
insert into public.roles (business_id, key, name, description, is_system, permissions) values
  (null,'owner','Owner','Full control of the business, billing, staff and data.',true,array['*']),
  (null,'administrator','Administrator','Everything except transferring ownership or deleting the business.',true,array['*']),
  (null,'manager','Manager','Runs day-to-day operations: sales, stock, documents and staff oversight.',true,public.role_permissions('manager')),
  (null,'salesperson','Salesperson','Sells: customers, quotations, orders, invoices and payments.',true,public.role_permissions('salesperson')),
  (null,'cashier','Cashier','Takes money at the counter. No access to costs, expenses or reports.',true,public.role_permissions('cashier')),
  (null,'accountant','Accountant','Books: invoices, payments, expenses, purchases, statements and reports.',true,public.role_permissions('accountant')),
  (null,'inventory_manager','Inventory Manager','Stock, warehouses, suppliers, purchasing and stocktaking.',true,public.role_permissions('inventory_manager')),
  (null,'warehouse_manager','Warehouse Manager','Receiving, picking, transfers, delivery notes and counts.',true,public.role_permissions('warehouse_manager'))
on conflict (business_id, key) do update set
  name = excluded.name, description = excluded.description, permissions = excluded.permissions;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. ENABLE RLS EVERYWHERE
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare r record;
begin
  for r in select c.relname as tbl
             from pg_class c
             join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public'
              and c.relkind in ('r','p')
  loop
    execute format('alter table public.%I enable row level security', r.tbl);
    execute format('alter table public.%I force row level security', r.tbl);
  end loop;
end $$;

-- Drop helper: keep this script re-runnable.
create or replace function public.drop_policies(p_table text)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select polname from pg_policy
            where polrelid = format('public.%I', p_table)::regclass
  loop
    execute format('drop policy if exists %I on public.%I', r.polname, p_table);
  end loop;
end $$;

-- ═════════════════════════ POLICIES ═══════════════════════════════════════════

-- ── REFERENCE DATA (public read; Seedwel admins write) ────────────────────────
do $$
declare t text;
begin
  foreach t in array array['countries','currencies','exchange_rates','plans',
                           'help_articles','academy_courses','expense_category_templates']
  loop
    perform public.drop_policies(t);
    execute format('create policy "%1$s_public_read" on public.%1$I
                    for select using (true)', t);
    execute format('create policy "%1$s_admin_write" on public.%1$I
                    for all using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- ── PROFILES: own row; businesses see their members; directory reads are limited
select public.drop_policies('profiles');
create policy "profiles_self_select" on public.profiles
  for select using (
    id = auth.uid()
    or public.is_admin()
    -- members of a shared business can see each other
    or exists (
      select 1 from public.business_members mine
      join public.business_members theirs on theirs.business_id = mine.business_id
      where mine.user_id = auth.uid() and mine.status = 'active'
        and theirs.user_id = profiles.id and theirs.status = 'active'
    )
    -- public reviewer/seller identity
    or exists (select 1 from public.reviews r where r.reviewer_id = profiles.id and r.status = 'published')
  );
create policy "profiles_self_insert" on public.profiles
  for insert with check (id = auth.uid());
create policy "profiles_self_update" on public.profiles
  for update using (id = auth.uid() or public.is_admin())
  with check (
    (id = auth.uid() and (
      -- a user may not promote or suspend themselves
      is_platform_admin = profiles.is_platform_admin or public.is_admin()
    ))
    or public.is_admin()
  );
create policy "profiles_admin_delete" on public.profiles
  for delete using (public.is_admin());

-- ── SECURITY TABLES: strictly self ────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['login_history','active_sessions']
  loop
    perform public.drop_policies(t);
    execute format('create policy "%1$s_self_read" on public.%1$I
                    for select using (user_id = auth.uid() or public.is_admin())', t);
    execute format('create policy "%1$s_self_write" on public.%1$I
                    for insert with check (user_id = auth.uid())', t);
    execute format('create policy "%1$s_self_update" on public.%1$I
                    for update using (user_id = auth.uid() or public.is_admin())
                    with check (user_id = auth.uid() or public.is_admin())', t);
    execute format('create policy "%1$s_self_delete" on public.%1$I
                    for delete using (user_id = auth.uid() or public.is_admin())', t);
  end loop;
end $$;

select public.drop_policies('two_factor_secrets');
create policy "2fa_self" on public.two_factor_secrets
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── BUSINESSES ────────────────────────────────────────────────────────────────
select public.drop_policies('businesses');
-- Public directory: verified/listed businesses only, and never suspended/deleted.
create policy "businesses_public_read" on public.businesses
  for select using (
    (is_public and deleted_at is null and suspended_at is null)
    or public.has_business_access(id)
    or public.is_admin()
  );
create policy "businesses_insert" on public.businesses
  for insert with check (
    owner_id = auth.uid()
    and not exists (select 1 from public.businesses b where b.owner_id = auth.uid() and b.deleted_at is null)
       or public.is_admin()
  );
-- Members can update operational fields; only owner/admin can change ownership,
-- verification status or badges (verification is granted by Seedwel staff).
create policy "businesses_update" on public.businesses
  for update using (public.has_business_access(id))
  with check (public.has_business_access(id));
create policy "businesses_delete" on public.businesses
  for delete using (
    (owner_id = auth.uid() and public.can(id,'settings.write')) or public.is_admin()
  );

select public.drop_policies('business_verifications');
create policy "verifications_read" on public.business_verifications
  for select using (
    public.is_admin() or public.can(business_id,'settings.read') or submitted_by = auth.uid()
  );
create policy "verifications_insert" on public.business_verifications
  for insert with check (submitted_by = auth.uid() and public.has_business_access(business_id));
create policy "verifications_update" on public.business_verifications
  for update using (public.is_admin() or (submitted_by = auth.uid() and status = 'submitted'))
  with check (public.is_admin() or submitted_by = auth.uid());

select public.drop_policies('business_documents');
create policy "business_documents_read" on public.business_documents
  for select using (
    public.is_admin()
    or (is_private and public.can(business_id,'documents.read'))
    or (not is_private and public.has_business_access(business_id))
  );
create policy "business_documents_insert" on public.business_documents
  for insert with check (public.can(business_id,'documents.write') and uploaded_by = auth.uid());
create policy "business_documents_update" on public.business_documents
  for update using (public.can(business_id,'documents.write')) with check (public.can(business_id,'documents.write'));
create policy "business_documents_delete" on public.business_documents
  for delete using (public.can(business_id,'documents.delete') or public.is_admin());

select public.drop_policies('business_settings');
create policy "business_settings_read" on public.business_settings
  for select using (public.has_business_access(business_id) or public.is_admin());
create policy "business_settings_write" on public.business_settings
  for all using (public.can(business_id,'settings.write'))
  with check (public.can(business_id,'settings.write'));

-- ── MEMBERS, ROLES, BRANCHES, WAREHOUSES ──────────────────────────────────────
select public.drop_policies('business_members');
create policy "members_read" on public.business_members
  for select using (
    user_id = auth.uid()
    or public.can(business_id,'staff.read')
    or public.has_business_access(business_id)   -- colleagues can see each other
    or public.is_admin()
  );
create policy "members_insert" on public.business_members
  for insert with check (public.can(business_id,'staff.invite'));
create policy "members_update" on public.business_members
  for update using (
    public.can(business_id,'staff.manage')
    or (user_id = auth.uid() and status <> 'removed')   -- accept/leave
  ) with check (
    public.can(business_id,'staff.manage') or user_id = auth.uid()
  );
create policy "members_delete" on public.business_members
  for delete using (public.can(business_id,'staff.manage') or public.is_admin());

select public.drop_policies('roles');
create policy "roles_read" on public.roles
  for select using (business_id is null or public.has_business_access(business_id) or public.is_admin());
create policy "roles_write" on public.roles
  for all using (public.can(business_id,'staff.manage'))
  with check (public.can(business_id,'staff.manage'));

do $$
declare t text;
begin
  foreach t in array array['branches','warehouses']
  loop
    perform public.drop_policies(t);
    execute format('create policy "%1$s_read" on public.%1$I
                    for select using (public.has_business_access(business_id) or public.is_admin()
                                      or public.is_public_business(business_id))', t);
    execute format('create policy "%1$s_write" on public.%1$I
                    for all using (public.can(business_id,''settings.write''))
                    with check (public.can(business_id,''settings.write''))', t);
  end loop;
end $$;

select public.drop_policies('addresses');
create policy "addresses_self" on public.addresses
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

select public.drop_policies('data_requests');
create policy "data_requests_self" on public.data_requests
  for all using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- ── AUDIT LOG ─────────────────────────────────────────────────────────────────
select public.drop_policies('audit_logs');
create policy "audit_read" on public.audit_logs
  for select using (
    public.is_admin()
    or public.can(business_id,'audit.read')
    or actor_id = auth.uid()
  );
-- Written by SECURITY DEFINER functions; no direct client writes.
create policy "audit_admin_write" on public.audit_logs
  for all using (public.is_admin()) with check (public.is_admin());

-- ── CATEGORIES ────────────────────────────────────────────────────────────────
select public.drop_policies('categories');
create policy "categories_public_read" on public.categories for select using (is_active or public.is_admin());
create policy "categories_admin_write" on public.categories
  for all using (public.is_admin()) with check (public.is_admin());

-- ── STORES ────────────────────────────────────────────────────────────────────
select public.drop_policies('stores');
create policy "stores_public_read" on public.stores
  for select using (
    (is_published and public.is_public_business(business_id))
    or public.has_business_access(business_id)
    or public.is_admin()
  );
create policy "stores_insert" on public.stores
  for insert with check (public.has_business_access(business_id));
create policy "stores_update" on public.stores
  for update using (public.can(business_id,'settings.write'))
  with check (public.can(business_id,'settings.write'));
create policy "stores_delete" on public.stores
  for delete using (public.is_owner_or_admin(business_id) or public.is_admin());

-- ── PRODUCTS ──────────────────────────────────────────────────────────────────
select public.drop_policies('products');
create policy "products_public_read" on public.products
  for select using (
    -- Shop window: published, live, not deleted.
    (is_published and deleted_at is null and public.is_public_business(business_id))
    -- Staff: everything in their own business, including drafts and costs.
    or public.can(business_id,'products.read')
    or public.is_admin()
  );
create policy "products_insert" on public.products
  for insert with check (
    public.can(business_id,'products.write') and coalesce(created_by, auth.uid()) = auth.uid()
  );
create policy "products_update" on public.products
  for update using (public.can(business_id,'products.write'))
  with check (public.can(business_id,'products.write'));
create policy "products_delete" on public.products
  for delete using (public.can(business_id,'products.delete') or public.is_admin());

select public.drop_policies('product_variants');
create policy "variants_read" on public.product_variants
  for select using (
    exists (select 1 from public.products p
             where p.id = product_variants.product_id
               and ((p.is_published and p.deleted_at is null and public.is_public_business(p.business_id))
                    or public.can(p.business_id,'products.read')))
    or public.is_admin()
  );
create policy "variants_write" on public.product_variants
  for all using (
    exists (select 1 from public.products p
             where p.id = product_variants.product_id and public.can(p.business_id,'products.write'))
  ) with check (
    exists (select 1 from public.products p
             where p.id = product_variants.product_id and public.can(p.business_id,'products.write'))
  );

select public.drop_policies('services');
create policy "services_public_read" on public.services
  for select using (
    (is_published and deleted_at is null and public.is_public_business(business_id))
    or public.can(business_id,'services.read')
    or public.is_admin()
  );
create policy "services_write" on public.services
  for all using (public.can(business_id,'services.write'))
  with check (public.can(business_id,'services.write'));

select public.drop_policies('product_stats');
create policy "product_stats_read" on public.product_stats
  for select using (
    exists (select 1 from public.products p where p.id = product_stats.product_id
             and (p.is_published or public.can(p.business_id,'reports.read')))
    or public.is_admin()
  );
create policy "product_stats_write" on public.product_stats
  for all using (public.is_admin()) with check (public.is_admin());

-- ── REVIEWS ───────────────────────────────────────────────────────────────────
select public.drop_policies('reviews');
create policy "reviews_public_read" on public.reviews
  for select using (status = 'published' or reviewer_id = auth.uid()
                    or public.can(business_id,'settings.read') or public.is_admin());
create policy "reviews_insert" on public.reviews
  for insert with check (reviewer_id = auth.uid() and status = 'published');
create policy "reviews_update" on public.reviews
  for update using (
    reviewer_id = auth.uid()                    -- edit your own review
    or public.can(business_id,'settings.write') -- seller reply / hide
    or public.is_admin()
  ) with check (
    reviewer_id = auth.uid() or public.can(business_id,'settings.write') or public.is_admin()
  );
create policy "reviews_delete" on public.reviews
  for delete using (reviewer_id = auth.uid() or public.is_admin());

-- ── WISHLIST & FOLLOWS: strictly self ─────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['wishlist_items','follows']
  loop
    perform public.drop_policies(t);
    execute format('create policy "%1$s_self" on public.%1$I for all
                    using (%2$I = auth.uid()) with check (%2$I = auth.uid())',
                   t, case when t = 'follows' then 'follower_id' else 'user_id' end);
  end loop;
end $$;

-- ── DEALS ─────────────────────────────────────────────────────────────────────
select public.drop_policies('deals');
create policy "deals_public_read" on public.deals
  for select using (
    (is_active and public.is_public_business(business_id))
    or public.can(business_id,'marketing.read') or public.is_admin()
  );
create policy "deals_write" on public.deals
  for all using (public.can(business_id,'marketing.write'))
  with check (public.can(business_id,'marketing.write'));

-- ── INVENTORY ─────────────────────────────────────────────────────────────────
select public.drop_policies('inventory');
create policy "inventory_read" on public.inventory
  for select using (public.can(business_id,'inventory.read') or public.is_admin());
create policy "inventory_write" on public.inventory
  for all using (public.can(business_id,'inventory.write'))
  with check (public.can(business_id,'inventory.write'));

select public.drop_policies('inventory_movements');
create policy "movements_read" on public.inventory_movements
  for select using (public.can(business_id,'inventory.read') or public.is_admin());
-- The ledger is append-only for clients; corrections are reversal rows.
create policy "movements_insert" on public.inventory_movements
  for insert with check (public.can(business_id,'inventory.write'));
create policy "movements_admin_update" on public.inventory_movements
  for update using (public.is_admin()) with check (public.is_admin());

do $$
declare t text;
begin
  foreach t in array array['stock_adjustments','stock_adjustment_items','stock_transfers',
                           'stock_transfer_items','stock_counts','stock_count_items',
                           'barcode_lookups']
  loop
    perform public.drop_policies(t);
    if t = 'barcode_lookups' then
      execute format('create policy "%1$s_read" on public.%1$I
                      for select using (public.can(business_id,''inventory.read'') or public.is_admin())', t);
      execute format('create policy "%1$s_insert" on public.%1$I
                      for insert with check (public.can(business_id,''inventory.write''))', t);
    elsif t in ('stock_adjustment_items') then
      execute format('create policy "%1$s_access" on public.%1$I for all
                      using (exists (select 1 from public.stock_adjustments a
                                      where a.id = %1$I.adjustment_id
                                        and public.can(a.business_id,''inventory.adjust'')))
                      with check (exists (select 1 from public.stock_adjustments a
                                      where a.id = %1$I.adjustment_id
                                        and public.can(a.business_id,''inventory.adjust'')))', t);
    elsif t in ('stock_transfer_items') then
      execute format('create policy "%1$s_access" on public.%1$I for all
                      using (exists (select 1 from public.stock_transfers s
                                      where s.id = %1$I.transfer_id
                                        and public.can(s.business_id,''inventory.transfer'')))
                      with check (exists (select 1 from public.stock_transfers s
                                      where s.id = %1$I.transfer_id
                                        and public.can(s.business_id,''inventory.transfer'')))', t);
    elsif t in ('stock_count_items') then
      execute format('create policy "%1$s_access" on public.%1$I for all
                      using (exists (select 1 from public.stock_counts c
                                      where c.id = %1$I.count_id
                                        and public.can(c.business_id,''inventory.count'')))
                      with check (exists (select 1 from public.stock_counts c
                                      where c.id = %1$I.count_id
                                        and public.can(c.business_id,''inventory.count'')))', t);
    else
      execute format('create policy "%1$s_read" on public.%1$I
                      for select using (public.can(business_id,''inventory.read'') or public.is_admin())', t);
      execute format('create policy "%1$s_write" on public.%1$I for all
                      using (public.can_any(business_id, array[''inventory.write'',''inventory.adjust'',''inventory.transfer'',''inventory.count'']))
                      with check (public.can_any(business_id, array[''inventory.write'',''inventory.adjust'',''inventory.transfer'',''inventory.count'']))', t);
    end if;
  end loop;
end $$;

-- ── CSV SOURCES & SYNC LOGS ───────────────────────────────────────────────────
select public.drop_policies('csv_sources');
create policy "csv_sources_read" on public.csv_sources
  for select using (public.can(business_id,'products.read') or public.is_admin());
create policy "csv_sources_write" on public.csv_sources
  for all using (public.can(business_id,'products.write'))
  with check (public.can(business_id,'products.write'));

select public.drop_policies('sync_logs');
create policy "sync_logs_read" on public.sync_logs
  for select using (public.can(business_id,'products.read') or public.is_admin());
create policy "sync_logs_write" on public.sync_logs
  for all using (public.can(business_id,'products.write'))
  with check (public.can(business_id,'products.write'));

-- ── TAXES ─────────────────────────────────────────────────────────────────────
select public.drop_policies('taxes');
create policy "taxes_read" on public.taxes
  for select using (
    business_id is null                                     -- platform defaults are public
    or public.has_business_access(business_id)
    or public.is_admin()
  );
create policy "taxes_write" on public.taxes
  for all using (business_id is not null and public.can(business_id,'settings.write'))
  with check (business_id is not null and public.can(business_id,'settings.write'));
create policy "taxes_admin" on public.taxes
  for all using (public.is_admin()) with check (public.is_admin());

select public.drop_policies('tax_exemptions');
create policy "tax_exemptions_access" on public.tax_exemptions
  for all using (public.can(business_id,'settings.write'))
  with check (public.can(business_id,'settings.write'));

-- ── CUSTOMERS (CRM) ───────────────────────────────────────────────────────────
select public.drop_policies('customers');
create policy "customers_read" on public.customers
  for select using (
    user_id = auth.uid()                       -- "my profile at this business"
    or public.can(business_id,'customers.read')
    or public.is_admin()
  );
create policy "customers_write" on public.customers
  for all using (public.can(business_id,'customers.write'))
  with check (public.can(business_id,'customers.write'));

select public.drop_policies('customer_addresses');
create policy "customer_addresses_read" on public.customer_addresses
  for select using (
    exists (select 1 from public.customers c where c.id = customer_addresses.customer_id
             and (c.user_id = auth.uid() or public.can(c.business_id,'customers.read')))
    or public.is_admin()
  );
create policy "customer_addresses_write" on public.customer_addresses
  for all using (
    exists (select 1 from public.customers c where c.id = customer_addresses.customer_id
             and (c.user_id = auth.uid() or public.can(c.business_id,'customers.write')))
  ) with check (
    exists (select 1 from public.customers c where c.id = customer_addresses.customer_id
             and (c.user_id = auth.uid() or public.can(c.business_id,'customers.write')))
  );

select public.drop_policies('customer_notes');
create policy "customer_notes_read" on public.customer_notes
  for select using (public.can(business_id,'customers.read') or author_id = auth.uid() or public.is_admin());
create policy "customer_notes_write" on public.customer_notes
  for all using (public.can(business_id,'customers.write'))
  with check (public.can(business_id,'customers.write'));

do $$
declare t text;
begin
  foreach t in array array['customer_transactions','supplier_transactions','customer_segments']
  loop
    perform public.drop_policies(t);
    execute format('create policy "%1$s_read" on public.%1$I
                    for select using (public.can(business_id,''customers.read'')
                                      or public.can(business_id,''suppliers.read'')
                                      or public.can(business_id,''reports.read'')
                                      or public.is_admin())', t);
    execute format('create policy "%1$s_write" on public.%1$I for all
                    using (public.can_any(business_id, array[''customers.write'',''suppliers.write'',''payments.record'']))
                    with check (public.can_any(business_id, array[''customers.write'',''suppliers.write'',''payments.record'']))', t);
  end loop;
end $$;

-- ── CARTS ─────────────────────────────────────────────────────────────────────
select public.drop_policies('carts');
-- Guest carts are held in the browser and converted through the checkout RPC
-- (SECURITY DEFINER), so no anon read policy is needed here.
create policy "carts_owner_read" on public.carts
  for select using (user_id = auth.uid() or public.is_admin());
create policy "carts_owner_write" on public.carts
  for all using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or user_id is null);

select public.drop_policies('cart_items');
create policy "cart_items_owner" on public.cart_items
  for all using (exists (select 1 from public.carts c where c.id = cart_items.cart_id
                          and (c.user_id = auth.uid() or public.is_admin())))
  with check (exists (select 1 from public.carts c where c.id = cart_items.cart_id
                          and (c.user_id = auth.uid() or c.user_id is null)));

-- ── ORDERS: seller side by permission, buyer side by ownership ────────────────
select public.drop_policies('orders');
create policy "orders_read" on public.orders
  for select using (
    buyer_user_id = auth.uid()
    or exists (select 1 from public.customers c where c.id = orders.customer_id and c.user_id = auth.uid())
    or public.can(business_id,'orders.read')
    or public.is_admin()
  );
create policy "orders_insert" on public.orders
  for insert with check (
    buyer_user_id = auth.uid()                       -- marketplace checkout
    or buyer_user_id is null                         -- guest checkout (token verified)
    or public.can(business_id,'orders.write')        -- POS / manual order by staff
  );
create policy "orders_update" on public.orders
  for update using (
    public.can_any(business_id, array['orders.write','orders.fulfil','payments.record'])
    or (buyer_user_id = auth.uid() and status in ('pending','confirmed'))  -- cancel own order
    or public.is_admin()
  ) with check (
    public.can_any(business_id, array['orders.write','orders.fulfil','payments.record'])
    or buyer_user_id = auth.uid()
    or public.is_admin()
  );
create policy "orders_delete" on public.orders
  for delete using (public.is_owner_or_admin(business_id) or public.is_admin());

select public.drop_policies('order_items');
create policy "order_items_read" on public.order_items
  for select using (
    exists (select 1 from public.orders o where o.id = order_items.order_id
             and (o.buyer_user_id = auth.uid() or public.can(o.business_id,'orders.read')))
    or public.is_admin()
  );
create policy "order_items_write" on public.order_items
  for all using (
    exists (select 1 from public.orders o where o.id = order_items.order_id
             and (o.buyer_user_id = auth.uid() or public.can(o.business_id,'orders.write')))
  ) with check (
    exists (select 1 from public.orders o where o.id = order_items.order_id
             and (o.buyer_user_id = auth.uid() or o.buyer_user_id is null
                  or public.can(o.business_id,'orders.write')))
  );

-- ── QUOTATIONS / PRO-FORMA ────────────────────────────────────────────────────
select public.drop_policies('quotations');
create policy "quotations_read" on public.quotations
  for select using (
    public.can(business_id,'quotations.read')
    or buyer_user_id = auth.uid()
    or exists (select 1 from public.customers c where c.id = quotations.customer_id and c.user_id = auth.uid())
    or public.is_admin()
    -- Public share links are resolved by an RPC that verifies the token; the row
    -- itself is never exposed to anon by token.
  );
create policy "quotations_insert" on public.quotations
  for insert with check (public.can(business_id,'quotations.write') and created_by = auth.uid());
create policy "quotations_update" on public.quotations
  for update using (public.can(business_id,'quotations.write') or buyer_user_id = auth.uid())
  with check (public.can(business_id,'quotations.write') or buyer_user_id = auth.uid());
create policy "quotations_delete" on public.quotations
  for delete using (public.can(business_id,'quotations.approve') or public.is_admin());

select public.drop_policies('quotation_items');
create policy "quotation_items_read" on public.quotation_items
  for select using (
    exists (select 1 from public.quotations q where q.id = quotation_items.quotation_id
             and (q.buyer_user_id = auth.uid() or public.can(q.business_id,'quotations.read')))
    or public.is_admin()
  );
create policy "quotation_items_write" on public.quotation_items
  for all using (
    exists (select 1 from public.quotations q where q.id = quotation_items.quotation_id
             and public.can(q.business_id,'quotations.write'))
  ) with check (
    exists (select 1 from public.quotations q where q.id = quotation_items.quotation_id
             and public.can(q.business_id,'quotations.write'))
  );

-- ── INVOICES ──────────────────────────────────────────────────────────────────
select public.drop_policies('invoices');
create policy "invoices_read" on public.invoices
  for select using (
    public.can(business_id,'invoices.read')
    or buyer_user_id = auth.uid()
    or exists (select 1 from public.customers c where c.id = invoices.customer_id and c.user_id = auth.uid())
    or public.is_admin()
  );
create policy "invoices_insert" on public.invoices
  for insert with check (public.can(business_id,'invoices.write') and created_by = auth.uid());
create policy "invoices_update" on public.invoices
  for update using (public.can(business_id,'invoices.write') or buyer_user_id = auth.uid())
  with check (public.can(business_id,'invoices.write') or buyer_user_id = auth.uid());
create policy "invoices_delete" on public.invoices
  for delete using (public.can(business_id,'invoices.void') or public.is_admin());

select public.drop_policies('invoice_items');
create policy "invoice_items_read" on public.invoice_items
  for select using (
    exists (select 1 from public.invoices i where i.id = invoice_items.invoice_id
             and (i.buyer_user_id = auth.uid() or public.can(i.business_id,'invoices.read')))
    or public.is_admin()
  );
create policy "invoice_items_write" on public.invoice_items
  for all using (
    exists (select 1 from public.invoices i where i.id = invoice_items.invoice_id
             and public.can(i.business_id,'invoices.write'))
  ) with check (
    exists (select 1 from public.invoices i where i.id = invoice_items.invoice_id
             and public.can(i.business_id,'invoices.write'))
  );

-- ── PAYMENTS & RECEIPTS (cashier can do this; cannot see expenses) ────────────
select public.drop_policies('payments');
create policy "payments_read" on public.payments
  for select using (
    public.can(business_id,'payments.read')
    or exists (select 1 from public.invoices i where i.id = payments.invoice_id and i.buyer_user_id = auth.uid())
    or exists (select 1 from public.orders o where o.id = payments.order_id and o.buyer_user_id = auth.uid())
    or public.is_admin()
  );
create policy "payments_insert" on public.payments
  for insert with check (
    public.can(business_id,'payments.record')
    or direction = 'inbound'   -- a customer paying their own invoice via a link
  );
create policy "payments_update" on public.payments
  for update using (public.can(business_id,'payments.record') or public.is_admin())
  with check (public.can(business_id,'payments.record') or public.is_admin());
create policy "payments_delete" on public.payments
  for delete using (public.can(business_id,'payments.refund') or public.is_admin());

select public.drop_policies('receipts');
create policy "receipts_read" on public.receipts
  for select using (
    public.can(business_id,'receipts.read')
    or exists (select 1 from public.invoices i where i.id = receipts.invoice_id and i.buyer_user_id = auth.uid())
    or exists (select 1 from public.orders o where o.id = receipts.order_id and o.buyer_user_id = auth.uid())
    or exists (select 1 from public.customers c where c.id = receipts.customer_id and c.user_id = auth.uid())
    or public.is_admin()
  );
create policy "receipts_insert" on public.receipts
  for insert with check (public.can(business_id,'receipts.create'));
create policy "receipts_update" on public.receipts
  for update using (public.can(business_id,'receipts.create') or public.is_admin())
  with check (public.can(business_id,'receipts.create') or public.is_admin());
create policy "receipts_delete" on public.receipts
  for delete using (public.is_owner_or_admin(business_id) or public.is_admin());

-- ── RETURNS & REFUNDS (refunds require owner approval) ────────────────────────
select public.drop_policies('returns');
create policy "returns_read" on public.returns
  for select using (
    public.can(business_id,'returns.read')
    or requested_by = auth.uid()
    or exists (select 1 from public.orders o where o.id = returns.order_id and o.buyer_user_id = auth.uid())
    or public.is_admin()
  );
create policy "returns_insert" on public.returns
  for insert with check (
    public.can(business_id,'returns.write')
    or requested_by = auth.uid()
    or exists (select 1 from public.orders o where o.id = returns.order_id and o.buyer_user_id = auth.uid())
  );
create policy "returns_update" on public.returns
  for update using (public.can(business_id,'returns.write') or public.can(business_id,'returns.approve'))
  with check (public.can(business_id,'returns.write') or public.can(business_id,'returns.approve'));

select public.drop_policies('return_items');
create policy "return_items_read" on public.return_items
  for select using (
    exists (select 1 from public.returns r where r.id = return_items.return_id
             and (r.requested_by = auth.uid() or public.can(r.business_id,'returns.read')))
    or public.is_admin()
  );
create policy "return_items_write" on public.return_items
  for all using (exists (select 1 from public.returns r where r.id = return_items.return_id
                          and public.can(r.business_id,'returns.write')))
  with check (exists (select 1 from public.returns r where r.id = return_items.return_id
                          and (public.can(r.business_id,'returns.write') or r.requested_by = auth.uid())));

select public.drop_policies('refunds');
create policy "refunds_read" on public.refunds
  for select using (public.can(business_id,'payments.read') or public.is_admin());
create policy "refunds_insert" on public.refunds
  for insert with check (public.can(business_id,'payments.refund'));
-- A refund only becomes completed once an owner/administrator approves it.
create policy "refunds_update" on public.refunds
  for update using (public.is_owner_or_admin(business_id) or public.can(business_id,'payments.refund'))
  with check (public.is_owner_or_admin(business_id) or public.can(business_id,'payments.refund'));

-- ── DELIVERY ──────────────────────────────────────────────────────────────────
select public.drop_policies('delivery_notes');
create policy "delivery_notes_read" on public.delivery_notes
  for select using (
    public.can(business_id,'delivery.read')
    or driver_id = auth.uid()
    or exists (select 1 from public.orders o where o.id = delivery_notes.order_id and o.buyer_user_id = auth.uid())
    or public.is_admin()
  );
create policy "delivery_notes_write" on public.delivery_notes
  for all using (public.can(business_id,'delivery.write') or driver_id = auth.uid())
  with check (public.can(business_id,'delivery.write') or driver_id = auth.uid());

select public.drop_policies('delivery_note_items');
create policy "delivery_note_items_access" on public.delivery_note_items
  for all using (exists (select 1 from public.delivery_notes d where d.id = delivery_note_items.delivery_note_id
                          and (public.can(d.business_id,'delivery.write') or d.driver_id = auth.uid())))
  with check (exists (select 1 from public.delivery_notes d where d.id = delivery_note_items.delivery_note_id
                          and public.can(d.business_id,'delivery.write')));

-- ── SUPPLIERS & PURCHASING ────────────────────────────────────────────────────
select public.drop_policies('suppliers');
create policy "suppliers_read" on public.suppliers
  for select using (public.can(business_id,'suppliers.read') or user_id = auth.uid() or public.is_admin());
create policy "suppliers_write" on public.suppliers
  for all using (public.can(business_id,'suppliers.write'))
  with check (public.can(business_id,'suppliers.write'));

select public.drop_policies('supplier_products');
create policy "supplier_products_read" on public.supplier_products
  for select using (
    exists (select 1 from public.suppliers s where s.id = supplier_products.supplier_id
             and public.can(s.business_id,'suppliers.read'))
    or public.is_admin()
  );
create policy "supplier_products_write" on public.supplier_products
  for all using (exists (select 1 from public.suppliers s where s.id = supplier_products.supplier_id
                          and public.can(s.business_id,'suppliers.write')))
  with check (exists (select 1 from public.suppliers s where s.id = supplier_products.supplier_id
                          and public.can(s.business_id,'suppliers.write')));

select public.drop_policies('purchase_orders');
create policy "po_read" on public.purchase_orders
  for select using (public.can(business_id,'purchases.read') or public.is_admin());
create policy "po_insert" on public.purchase_orders
  for insert with check (public.can(business_id,'purchases.write') and created_by = auth.uid());
create policy "po_update" on public.purchase_orders
  for update using (public.can(business_id,'purchases.write')
                    or (public.can(business_id,'purchases.approve') and requires_approval))
  with check (public.can(business_id,'purchases.write') or public.can(business_id,'purchases.approve'));
create policy "po_delete" on public.purchase_orders
  for delete using (public.is_owner_or_admin(business_id) or public.is_admin());

select public.drop_policies('purchase_items');
create policy "purchase_items_read" on public.purchase_items
  for select using (exists (select 1 from public.purchase_orders p where p.id = purchase_items.purchase_order_id
                             and public.can(p.business_id,'purchases.read')) or public.is_admin());
create policy "purchase_items_write" on public.purchase_items
  for all using (exists (select 1 from public.purchase_orders p where p.id = purchase_items.purchase_order_id
                          and public.can(p.business_id,'purchases.write')))
  with check (exists (select 1 from public.purchase_orders p where p.id = purchase_items.purchase_order_id
                          and public.can(p.business_id,'purchases.write')));

do $$
declare t text;
begin
  foreach t in array array['goods_received','goods_received_items','supplier_bills']
  loop
    perform public.drop_policies(t);
    execute format('create policy "%1$s_read" on public.%1$I
                    for select using (public.can(business_id,''purchases.read'')
                                      or public.can(business_id,''inventory.read'')
                                      or public.is_admin())', t);
    execute format('create policy "%1$s_write" on public.%1$I for all
                    using (public.can_any(business_id, array[''purchases.write'',''inventory.write'']))
                    with check (public.can_any(business_id, array[''purchases.write'',''inventory.write'']))', t);
  end loop;
end $$;

-- ── EXPENSES (a cashier must NOT see these) ───────────────────────────────────
select public.drop_policies('expense_categories');
create policy "expense_categories_read" on public.expense_categories
  for select using (public.can(business_id,'expenses.read') or public.is_admin());
create policy "expense_categories_write" on public.expense_categories
  for all using (public.can(business_id,'expenses.write'))
  with check (public.can(business_id,'expenses.write'));

select public.drop_policies('expenses');
create policy "expenses_read" on public.expenses
  for select using (
    public.can(business_id,'expenses.read')
    or (created_by = auth.uid() and public.can(business_id,'expenses.write'))  -- see your own submissions
    or public.is_admin()
  );
create policy "expenses_insert" on public.expenses
  for insert with check (public.can(business_id,'expenses.write') and created_by = auth.uid());
create policy "expenses_update" on public.expenses
  for update using (public.can(business_id,'expenses.write')
                    or (created_by = auth.uid() and status in ('recorded','pending_approval')))
  with check (public.can(business_id,'expenses.write') or created_by = auth.uid());
create policy "expenses_delete" on public.expenses
  for delete using (public.can(business_id,'expenses.approve') or public.is_admin());

select public.drop_policies('financial_records');
create policy "financial_records_read" on public.financial_records
  for select using (public.can(business_id,'reports.read') or public.is_admin());
create policy "financial_records_write" on public.financial_records
  for all using (public.can(business_id,'reports.read') or public.is_admin())
  with check (public.can(business_id,'reports.read') or public.is_admin());

-- ── DOCUMENTS & SIGNATURES ────────────────────────────────────────────────────
select public.drop_policies('documents');
create policy "documents_read" on public.documents
  for select using (
    public.can(business_id,'documents.read')
    or exists (select 1 from public.customers c where c.id = documents.customer_id and c.user_id = auth.uid())
    or exists (select 1 from public.suppliers s where s.id = documents.supplier_id and s.user_id = auth.uid())
    or public.is_admin()
  );
create policy "documents_insert" on public.documents
  for insert with check (public.can(business_id,'documents.write') and created_by = auth.uid());
create policy "documents_update" on public.documents
  for update using (public.can(business_id,'documents.write') or public.is_admin())
  with check (public.can(business_id,'documents.write') or public.is_admin());
create policy "documents_delete" on public.documents
  for delete using (public.can(business_id,'documents.delete') or public.is_admin());

select public.drop_policies('document_versions');
create policy "document_versions_read" on public.document_versions
  for select using (exists (select 1 from public.documents d where d.id = document_versions.document_id
                             and public.can(d.business_id,'documents.read')) or public.is_admin());
create policy "document_versions_write" on public.document_versions
  for all using (exists (select 1 from public.documents d where d.id = document_versions.document_id
                          and public.can(d.business_id,'documents.write')))
  with check (exists (select 1 from public.documents d where d.id = document_versions.document_id
                          and public.can(d.business_id,'documents.write')));

select public.drop_policies('document_events');
create policy "document_events_read" on public.document_events
  for select using (exists (select 1 from public.documents d where d.id = document_events.document_id
                             and public.can(d.business_id,'documents.read'))
                    or actor_id = auth.uid() or public.is_admin());
create policy "document_events_insert" on public.document_events
  for insert with check (
    exists (select 1 from public.documents d where d.id = document_events.document_id
             and public.has_business_access(d.business_id))
    or actor_id = auth.uid()
  );

select public.drop_policies('signatures');
create policy "signatures_read" on public.signatures
  for select using (user_id = auth.uid() or public.can(business_id,'documents.read') or public.is_admin());
create policy "signatures_insert" on public.signatures
  for insert with check (user_id = auth.uid() or public.has_business_access(business_id));
create policy "signatures_update" on public.signatures
  for update using (user_id = auth.uid() and is_saved_template) with check (user_id = auth.uid());

select public.drop_policies('document_signatures');
create policy "document_signatures_read" on public.document_signatures
  for select using (
    exists (select 1 from public.documents d where d.id = document_signatures.document_id
             and public.can(d.business_id,'documents.read'))
    or exists (select 1 from public.signatures s where s.id = document_signatures.signature_id
             and s.user_id = auth.uid())
    or public.is_admin()
  );
create policy "document_signatures_write" on public.document_signatures
  for all using (
    exists (select 1 from public.documents d where d.id = document_signatures.document_id
             and public.can(d.business_id,'documents.write'))
    or exists (select 1 from public.signatures s where s.id = document_signatures.signature_id
             and s.user_id = auth.uid())
  ) with check (true);

select public.drop_policies('document_templates');
create policy "document_templates_read" on public.document_templates
  for select using (business_id is null or public.has_business_access(business_id) or public.is_admin());
create policy "document_templates_write" on public.document_templates
  for all using (public.can(business_id,'settings.write'))
  with check (public.can(business_id,'settings.write'));

-- ── MESSAGING & NOTIFICATIONS ─────────────────────────────────────────────────
select public.drop_policies('conversations');
create policy "conversations_read" on public.conversations
  for select using (
    participant_user_id = auth.uid()
    or public.can(business_id,'orders.read')
    or assigned_to = auth.uid()
    or public.is_admin()
  );
create policy "conversations_insert" on public.conversations
  for insert with check (
    participant_user_id = auth.uid() or public.has_business_access(business_id)
  );
create policy "conversations_update" on public.conversations
  for update using (participant_user_id = auth.uid() or public.has_business_access(business_id))
  with check (participant_user_id = auth.uid() or public.has_business_access(business_id));

select public.drop_policies('messages');
create policy "messages_read" on public.messages
  for select using (
    exists (select 1 from public.conversations c where c.id = messages.conversation_id
             and (c.participant_user_id = auth.uid() or public.has_business_access(c.business_id)))
    or sender_id = auth.uid()
    or public.is_admin()
  );
create policy "messages_insert" on public.messages
  for insert with check (
    exists (select 1 from public.conversations c where c.id = messages.conversation_id
             and (c.participant_user_id = auth.uid() or public.has_business_access(c.business_id)))
  );
create policy "messages_update" on public.messages
  for update using (sender_id = auth.uid() or public.is_admin())
  with check (sender_id = auth.uid() or public.is_admin());
create policy "messages_delete" on public.messages
  for delete using (sender_id = auth.uid() or public.is_admin());

select public.drop_policies('notifications');
create policy "notifications_self" on public.notifications
  for select using (user_id = auth.uid() or public.is_admin());
create policy "notifications_insert" on public.notifications
  for insert with check (true);   -- created by SECURITY DEFINER functions/triggers
create policy "notifications_update" on public.notifications
  for update using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());
create policy "notifications_delete" on public.notifications
  for delete using (user_id = auth.uid() or public.is_admin());

select public.drop_policies('notification_preferences');
create policy "notification_preferences_self" on public.notification_preferences
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

select public.drop_policies('email_logs');
create policy "email_logs_read" on public.email_logs
  for select using (public.can(business_id,'documents.read') or public.is_admin());
create policy "email_logs_write" on public.email_logs
  for all using (public.has_business_access(business_id) or public.is_admin())
  with check (public.has_business_access(business_id) or business_id is null);

select public.drop_policies('sms_logs');
create policy "sms_logs_read" on public.sms_logs
  for select using (public.can(business_id,'documents.read') or public.is_admin());
create policy "sms_logs_write" on public.sms_logs
  for all using (public.has_business_access(business_id) or public.is_admin())
  with check (public.has_business_access(business_id) or business_id is null);

-- ── MARKETING ─────────────────────────────────────────────────────────────────
select public.drop_policies('coupons');
-- Active coupons must be redeemable by shoppers: validation happens through the
-- RPC in 0009, which is SECURITY DEFINER, so this read stays member-only.
create policy "coupons_read" on public.coupons
  for select using (public.can(business_id,'marketing.read') or public.is_admin());
create policy "coupons_write" on public.coupons
  for all using (public.can(business_id,'marketing.write'))
  with check (public.can(business_id,'marketing.write'));

select public.drop_policies('coupon_redemptions');
create policy "coupon_redemptions_read" on public.coupon_redemptions
  for select using (
    user_id = auth.uid()
    or exists (select 1 from public.coupons c where c.id = coupon_redemptions.coupon_id
                and public.can(c.business_id,'marketing.read'))
    or public.is_admin()
  );
create policy "coupon_redemptions_write" on public.coupon_redemptions
  for all using (
    exists (select 1 from public.coupons c where c.id = coupon_redemptions.coupon_id
             and public.can(c.business_id,'marketing.write'))
    or user_id = auth.uid()
  ) with check (true);

do $$
declare t text;
begin
  foreach t in array array['campaigns','promotions','advertisements','loyalty_rules']
  loop
    perform public.drop_policies(t);
    execute format('create policy "%1$s_read" on public.%1$I
                    for select using (public.can(business_id,''marketing.read'') or public.is_admin()
                                      or public.is_public_business(business_id))', t);
    execute format('create policy "%1$s_write" on public.%1$I for all
                    using (public.can(business_id,''marketing.write''))
                    with check (public.can(business_id,''marketing.write''))', t);
  end loop;
end $$;

select public.drop_policies('loyalty_transactions');
create policy "loyalty_transactions_read" on public.loyalty_transactions
  for select using (
    public.can(business_id,'customers.read')
    or exists (select 1 from public.customers c where c.id = loyalty_transactions.customer_id and c.user_id = auth.uid())
    or public.is_admin()
  );
create policy "loyalty_transactions_write" on public.loyalty_transactions
  for all using (public.can(business_id,'customers.write'))
  with check (public.can(business_id,'customers.write'));

-- Advertisements that are live are visible to everyone (they are the ads).
create policy "advertisements_public_read" on public.advertisements
  for select using (status = 'active' and starts_at <= now() and (ends_at is null or ends_at > now()));

-- ── SUBSCRIPTIONS ─────────────────────────────────────────────────────────────
select public.drop_policies('subscriptions');
create policy "subscriptions_read" on public.subscriptions
  for select using (public.can(business_id,'settings.read') or public.is_admin());
create policy "subscriptions_write" on public.subscriptions
  for all using (public.is_owner_or_admin(business_id) or public.is_admin())
  with check (public.is_owner_or_admin(business_id) or public.is_admin());

select public.drop_policies('invoices_platform');
create policy "invoices_platform_read" on public.invoices_platform
  for select using (public.can(business_id,'settings.read') or public.is_admin());
create policy "invoices_platform_write" on public.invoices_platform
  for all using (public.is_owner_or_admin(business_id) or public.is_admin())
  with check (public.is_owner_or_admin(business_id) or public.is_admin());

select public.drop_policies('feature_limits');
create policy "feature_limits_read" on public.feature_limits
  for select using (public.has_business_access(business_id) or public.is_admin());
create policy "feature_limits_write" on public.feature_limits
  for all using (public.is_owner_or_admin(business_id) or public.is_admin())
  with check (public.is_owner_or_admin(business_id) or public.is_admin());

-- ── PAYMENT LINKS ─────────────────────────────────────────────────────────────
select public.drop_policies('payment_links');
create policy "payment_links_read" on public.payment_links
  for select using (
    public.can(business_id,'payments.read')
    or exists (select 1 from public.customers c where c.id = payment_links.customer_id and c.user_id = auth.uid())
    or public.is_admin()
  );
create policy "payment_links_write" on public.payment_links
  for all using (public.can(business_id,'payments.record'))
  with check (public.can(business_id,'payments.record'));

-- ── AI ────────────────────────────────────────────────────────────────────────
select public.drop_policies('ai_conversations');
create policy "ai_conversations_self" on public.ai_conversations
  for all using (user_id = auth.uid() and (business_id is null or public.can(business_id,'ai.use')))
  with check (user_id = auth.uid());

select public.drop_policies('ai_messages');
create policy "ai_messages_self" on public.ai_messages
  for all using (exists (select 1 from public.ai_conversations c where c.id = ai_messages.conversation_id
                          and c.user_id = auth.uid()))
  with check (exists (select 1 from public.ai_conversations c where c.id = ai_messages.conversation_id
                          and c.user_id = auth.uid()));

select public.drop_policies('ai_actions');
create policy "ai_actions_read" on public.ai_actions
  for select using (public.can(business_id,'ai.use') or requested_by = auth.uid() or public.is_admin());
create policy "ai_actions_insert" on public.ai_actions
  for insert with check (requested_by = auth.uid() and public.can(business_id,'ai.use'));
-- Only a permitted approver may approve/reject; the impact column drives whether
-- approval is required at all (see 0009 helpers).
create policy "ai_actions_update" on public.ai_actions
  for update using (
    public.can(business_id,'ai.approve') or public.is_owner_or_admin(business_id) or public.is_admin()
  ) with check (
    public.can(business_id,'ai.approve') or public.is_owner_or_admin(business_id) or public.is_admin()
  );

select public.drop_policies('ai_usage');
create policy "ai_usage_read" on public.ai_usage
  for select using (user_id = auth.uid() or public.can(business_id,'reports.read') or public.is_admin());
create policy "ai_usage_insert" on public.ai_usage
  for insert with check (true);   -- written by SECURITY DEFINER functions

select public.drop_policies('automation_rules');
create policy "automation_rules_read" on public.automation_rules
  for select using (public.can(business_id,'ai.use') or public.is_admin());
create policy "automation_rules_write" on public.automation_rules
  for all using (public.can(business_id,'ai.approve') or public.is_owner_or_admin(business_id))
  with check (public.can(business_id,'ai.approve') or public.is_owner_or_admin(business_id));

select public.drop_policies('automation_runs');
create policy "automation_runs_read" on public.automation_runs
  for select using (public.can(business_id,'ai.use') or public.is_admin());
create policy "automation_runs_insert" on public.automation_runs
  for insert with check (true);   -- written by SECURITY DEFINER automation

select public.drop_policies('business_insights');
create policy "insights_read" on public.business_insights
  for select using (public.can(business_id,'dashboard.read') or public.is_admin());
create policy "insights_update" on public.business_insights
  for update using (public.has_business_access(business_id))
  with check (public.has_business_access(business_id));
create policy "insights_insert" on public.business_insights
  for insert with check (true);   -- generated by AI/report functions

select public.drop_policies('reports');
create policy "reports_read" on public.reports
  for select using (public.can(business_id,'reports.read') or public.is_admin());
create policy "reports_write" on public.reports
  for all using (public.can(business_id,'reports.read'))
  with check (public.can(business_id,'reports.read'));

-- ── HELP, ACADEMY & SUPPORT ───────────────────────────────────────────────────
select public.drop_policies('academy_progress');
create policy "academy_progress_self" on public.academy_progress
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

select public.drop_policies('support_tickets');
create policy "support_tickets_read" on public.support_tickets
  for select using (user_id = auth.uid() or assigned_to = auth.uid() or public.is_admin());
create policy "support_tickets_insert" on public.support_tickets
  for insert with check (user_id = auth.uid());
create policy "support_tickets_update" on public.support_tickets
  for update using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

select public.drop_policies('support_ticket_messages');
create policy "support_messages_read" on public.support_ticket_messages
  for select using (
    exists (select 1 from public.support_tickets t where t.id = support_ticket_messages.ticket_id
             and (t.user_id = auth.uid() or t.assigned_to = auth.uid() or public.is_admin()))
    or author_id = auth.uid()
  );
create policy "support_messages_insert" on public.support_ticket_messages
  for insert with check (
    author_id = auth.uid()
    and exists (select 1 from public.support_tickets t where t.id = support_ticket_messages.ticket_id
                 and (t.user_id = auth.uid() or public.is_admin()))
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. VERIFY: every table must have RLS enabled
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  missing text[];
begin
  select array_agg(c.relname order by c.relname)
    into missing
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r','p')
     and not c.relrowsecurity;

  if missing is not null then
    raise warning 'tables still without RLS: %', array_to_string(missing, ', ');
  else
    raise notice 'RLS enabled on every public table ✔';
  end if;
end $$;

select 'seedwel_hub: 0008 security & RLS ok' as status;
