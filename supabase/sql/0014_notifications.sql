-- ═══════════════════════════════════════════════════════════════════════════
--  Seedwel Hub — 0014: notifications (Web Push + preferences)
--  A product of Seedwel Investment Limited
-- ═══════════════════════════════════════════════════════════════════════════
--  Why this migration exists
--  ─────────────────────────
--  The notification centre (table + `notify_user` / `notify_business_owners`)
--  already delivers in-app rows for orders, payments, messages, stock and AI
--  actions. Two things were missing for a complete notifications phase:
--
--    1. Web Push. There was no place to store a browser's push subscription,
--       so even a registered FCM/Web Push token could never be sent to. This
--       adds `push_tokens` (with the raw Web Push subscription and the FCM
--       token) and RLS so a user manages only their own devices.
--
--    2. Channel preferences were stored but never populated by `notify_user`,
--       so the `channel` array was always empty and email/push fan-out had no
--       signal. `notify_user` is replaced to fill `channel` from the user's
--       `notification_preferences` (in_app / email / sms / whatsapp / push).
--
--  Deliberately does NOT add a second message roll-up trigger: `message_rollup`
--  (0010) already bumps `conversations` unread counters and notifies the other
--  side, and a second `AFTER INSERT` trigger would double-count.
--
--  Idempotent: safe to re-run. Run AFTER 0013.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. PUSH TOKENS
-- ─────────────────────────────────────────────────────────────────────────────
-- A device (browser tab) the user has allowed to receive notifications. Stores
-- both the FCM registration token and the raw Web Push subscription so a future
-- Cloud Function can fan messages out over FCM or the Web Push protocol.
create table if not exists public.push_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  token       text not null,                             -- FCM registration token
  endpoint    text,                                      -- Web Push subscription endpoint (unique)
  subscription jsonb,                                    -- PushSubscription.toJSON()
  platform    text not null default 'web',               -- web|ios|android
  user_agent  text,
  is_active   boolean not null default true,
  last_used_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists push_tokens_user_idx on public.push_tokens (user_id, created_at desc);
create unique index if not exists push_tokens_token_uq on public.push_tokens (user_id, token);
create unique index if not exists push_tokens_endpoint_uq on public.push_tokens (endpoint) where endpoint is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────────────────────
select public.drop_policies('push_tokens');
create policy "push_tokens_self_read" on public.push_tokens
  for select using (user_id = auth.uid() or public.is_admin());
create policy "push_tokens_self_insert" on public.push_tokens
  for insert with check (user_id = auth.uid() or public.is_admin());
create policy "push_tokens_self_update" on public.push_tokens
  for update using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());
create policy "push_tokens_self_delete" on public.push_tokens
  for delete using (user_id = auth.uid() or public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. PUSH TOKEN HELPERS
-- ─────────────────────────────────────────────────────────────────────────────
-- Idempotently store a device. Upserts on (user_id, token); if the browser
-- rotated its endpoint (subscription refresh) the stale row is deactivated.
create or replace function public.register_push_token(
  p_user_id     uuid,
  p_token       text,
  p_endpoint    text default null,
  p_subscription jsonb default null,
  p_platform    text default 'web',
  p_user_agent  text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_user_id is null or nullif(trim(p_token), '') is null then return null; end if;

  -- A browser may refresh its subscription (endpoint stays, token rotates).
  -- Deactivate the stale row for this same endpoint so we never send twice;
  -- every OTHER device (different endpoint) is left untouched.
  if p_endpoint is not null then
    update public.push_tokens
       set is_active = false, updated_at = now()
     where user_id = p_user_id and endpoint = p_endpoint and token is distinct from p_token;
  end if;

  insert into public.push_tokens
    (user_id, token, endpoint, subscription, platform, user_agent, is_active, last_used_at)
  values (p_user_id, p_token, p_endpoint, p_subscription, p_platform, p_user_agent, true, now())
  on conflict (user_id, token) do update
     set endpoint = coalesce(excluded.endpoint, push_tokens.endpoint),
         subscription = coalesce(excluded.subscription, push_tokens.subscription),
         platform = excluded.platform,
         user_agent = excluded.user_agent,
         is_active = true,
         last_used_at = now(),
         updated_at = now()
  returning id into v_id;
  return v_id;
end $$;

-- Deactivate a device when the user disables notifications on this browser.
create or replace function public.unregister_push_token(
  p_user_id  uuid,
  p_token    text default null,
  p_endpoint text default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.push_tokens
     set is_active = false, updated_at = now()
   where user_id = p_user_id
     and (p_token is not null and token = p_token
          or p_endpoint is not null and endpoint = p_endpoint);
end $$;

revoke all on function public.register_push_token(uuid, text, text, jsonb, text, text) from public;
revoke all on function public.unregister_push_token(uuid, text, text) from public;
grant execute on function public.register_push_token(uuid, text, text, jsonb, text, text) to authenticated;
grant execute on function public.unregister_push_token(uuid, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. CHANNEL-FILLING NOTIFY
-- ─────────────────────────────────────────────────────────────────────────────
-- Replaces `notify_user` (0009) so the `channel` array reflects the user's
-- preference row. In-app delivery is still skipped when in_app is disabled.
create or replace function public.notify_user(
  p_user_id    uuid,
  p_type       public.notification_type,
  p_title      text,
  p_body       text default null,
  p_action_url text default null,
  p_business_id uuid default null,
  p_entity_type text default null,
  p_entity_id  uuid default null,
  p_priority   text default 'normal'
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_channel text[]; v_pref record;
begin
  if p_user_id is null then return null; end if;

  -- Respect the user's channel preferences for in-app delivery.
  if exists (
    select 1 from public.notification_preferences np
    where np.user_id = p_user_id and np.type = p_type and not np.in_app
  ) then
    return null;
  end if;

  -- Default channels; override with any preference row for this type.
  v_channel := array['in_app']::text[];
  select * into v_pref from public.notification_preferences np
  where np.user_id = p_user_id and np.type = p_type and np.business_scope
        = coalesce(p_business_id, '00000000-0000-0000-0000-000000000000'::uuid);
  if v_pref.user_id is not null then
    v_channel := array[]::text[];
    if v_pref.in_app then v_channel := array_append(v_channel, 'in_app'); end if;
    if v_pref.push   then v_channel := array_append(v_channel, 'push'); end if;
    if v_pref.email  then v_channel := array_append(v_channel, 'email'); end if;
    if v_pref.sms    then v_channel := array_append(v_channel, 'sms'); end if;
    if v_pref.whatsapp then v_channel := array_append(v_channel, 'whatsapp'); end if;
  end if;
  if array_length(v_channel, 1) is null then return null; end if;

  insert into public.notifications
    (user_id, business_id, type, title, body, action_url, entity_type, entity_id, priority, channel, sent_at)
  values (p_user_id, p_business_id, p_type, p_title, p_body, p_action_url, p_entity_type, p_entity_id, p_priority, v_channel, now())
  returning id into v_id;
  return v_id;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. NOTIFICATION PREFERENCE HELPERS
-- ─────────────────────────────────────────────────────────────────────────────
-- Upsert a single notification preference for a user (returns the stored row).
create or replace function public.set_notification_preference(
  p_user_id     uuid,
  p_type        public.notification_type,
  p_business_id uuid default null,
  p_in_app      boolean default true,
  p_email       boolean default true,
  p_sms         boolean default false,
  p_whatsapp    boolean default false,
  p_push        boolean default true,
  p_quiet_hours jsonb default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user_id is null then return; end if;
  insert into public.notification_preferences
    (user_id, business_id, type, in_app, email, sms, whatsapp, push, quiet_hours)
  values (p_user_id, p_business_id, p_type, p_in_app, p_email, p_sms, p_whatsapp, p_push, p_quiet_hours)
  on conflict (user_id, type, business_scope) do update
     set in_app = excluded.in_app, email = excluded.email, sms = excluded.sms,
         whatsapp = excluded.whatsapp, push = excluded.push,
         quiet_hours = excluded.quiet_hours, updated_at = now();
end $$;

revoke all on function public.set_notification_preference(uuid, public.notification_type, uuid, boolean, boolean, boolean, boolean, boolean, jsonb) from public;
grant execute on function public.set_notification_preference(uuid, public.notification_type, uuid, boolean, boolean, boolean, boolean, boolean, jsonb) to authenticated;
