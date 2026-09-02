-- ═══════════════════════════════════════════════════════════════════════════
--  Seedwel Hub — 0013: messaging & community groups
--  A product of Seedwel Investment Limited
-- ═══════════════════════════════════════════════════════════════════════════
--  Why this migration exists
--  ─────────────────────────
--  Buyers and sellers already exchange one-to-one messages through
--  `conversations` / `messages` (0007). Two things were missing:
--
--    1. A seller-configured auto-reply. A buyer's very first message in a
--       conversation should be answered on the seller's behalf — once per
--       conversation — without the seller having to be online. The setting is
--       stored in `business_settings` under the key `chat.auto_reply` and a
--       database trigger answers the buyer when it is enabled.
--
--    2. Community groups. The blueprint calls for create / add-members / chat
--       with product & business link previews, but no `groups` table existed.
--       This migration adds `groups`, `group_members` and `group_messages`.
--
--  Idempotent: safe to re-run. Run AFTER 0012 (needs `can`, `has_business_access`).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. CONVERSATION ROLLUP ON EVERY MESSAGE
-- ─────────────────────────────────────────────────────────────────────────────
-- Keep the inbox list cheap to render: the conversation row already carries
-- `last_message_at`, `last_message_preview` and the unread counters, so bump
-- them here on every insert instead of making every client do two writes.
create or replace function public.tg_messages_bump_conversation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.conversations c
     set last_message_at     = new.created_at,
         last_message_preview = left(new.body, 120),
         unread_business     = c.unread_business + case when new.sender_type = 'user' then 1 else 0 end,
         unread_user         = c.unread_user + case when new.sender_type in ('business','system','ai') then 1 else 0 end,
         updated_at          = now()
   where c.id = new.conversation_id;
  return null;
end $$;

drop trigger if exists messages_bump_conversation on public.messages;
create trigger messages_bump_conversation
  after insert on public.messages
  for each row when (pg_trigger_depth() < 3)
  execute function public.tg_messages_bump_conversation();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. SELLER AUTO-REPLY (once per conversation)
-- ─────────────────────────────────────────────────────────────────────────────
-- When a buyer sends the first message to a business whose `chat.auto_reply`
-- setting is enabled, answer on the seller's behalf. Fires only for real buyer
-- messages (`sender_type = 'user'`) and only when the business has not already
-- replied in that conversation, so a conversation never gets two auto-replies.
create or replace function public.tg_messages_auto_reply()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_business_id uuid;
  v_business_name text;
  v_settings jsonb;
  v_reply text;
begin
  if new.sender_type <> 'user' or new.sender_id is null then
    return null;
  end if;

  select c.business_id, b.name
    into v_business_id, v_business_name
  from public.conversations c
  left join public.businesses b on b.id = c.business_id
  where c.id = new.conversation_id;

  if v_business_id is null or v_business_name is null then
    return null;
  end if;

  -- Read the seller's auto-reply configuration.
  select value into v_settings
  from public.business_settings
  where business_id = v_business_id and key = 'chat.auto_reply';

  if v_settings is null or not coalesce((v_settings ->> 'autoReplyEnabled')::boolean, false) then
    return null;
  end if;

  v_reply := nullif(trim(coalesce(v_settings ->> 'autoReplyMessage', '')), '');
  if v_reply is null then
    return null;
  end if;

  -- "Once per conversation": auto-reply only to the very first contact. Once
  -- the business has said anything (the auto-reply itself, or a human reply),
  -- no further auto-replies are sent to that conversation.
  if exists (
    select 1 from public.messages
    where conversation_id = new.conversation_id and sender_type = 'business'
  ) then
    return null;
  end if;

  insert into public.messages (conversation_id, sender_id, sender_type, sender_name, body, is_read)
  values (new.conversation_id, null, 'business', v_business_name, v_reply, false);

  return null;
end $$;

drop trigger if exists messages_auto_reply on public.messages;
create trigger messages_auto_reply
  after insert on public.messages
  for each row when (pg_trigger_depth() < 3 and new.sender_type = 'user')
  execute function public.tg_messages_auto_reply();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. COMMUNITY GROUPS
-- ─────────────────────────────────────────────────────────────────────────────
-- A group is a public or private community. It may be opened by a business or
-- by an individual member (a seller's community on the "business community"
-- side of the blueprint). Membership is store in `group_members`.
create table if not exists public.groups (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid references public.businesses(id) on delete cascade,  -- organising business, if any
  owner_id       uuid references auth.users(id) on delete set null,
  name           text not null check (char_length(name) between 2 and 90),
  slug           text unique,
  description    text,
  image          text,                          -- Cloudinary flat public_id / url
  category       text default 'General',
  visibility     text not null default 'public' check (visibility in ('public','private')),
  country_code   text not null default 'ZM' references public.countries(code),
  member_count   integer not null default 0,
  is_approval_needed boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index if not exists groups_business_idx on public.groups (business_id, created_at desc);
create index if not exists groups_owner_idx on public.groups (owner_id, created_at desc);

create table if not exists public.group_members (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'member' check (role in ('owner','admin','member','moderator')),
  status     text not null default 'active' check (status in ('active','invited','banned','left')),
  joined_at  timestamptz not null default now(),
  unique (group_id, user_id)
);
create index if not exists group_members_group_idx on public.group_members (group_id);
create index if not exists group_members_user_idx on public.group_members (user_id, joined_at desc);

create table if not exists public.group_messages (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references public.groups(id) on delete cascade,
  sender_id      uuid references auth.users(id) on delete set null,
  sender_name    text not null,
  sender_role    text not null default 'member',
  body           text not null,
  attachment     jsonb,
  reference_type text,                          -- product|business|link
  reference_id   uuid,
  reference_url  text,                          -- link preview URL
  reference_title text,
  reference_img  text,
  is_edited      boolean not null default false,
  deleted_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists group_messages_group_idx on public.group_messages (group_id, created_at desc);

-- Keep member_count in sync.
create or replace function public.tg_group_members_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.groups g set member_count = g.member_count + 1, updated_at = now() where g.id = new.group_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.groups g set member_count = greatest(g.member_count - 1, 0), updated_at = now() where g.id = old.group_id;
    return old;
  end if;
  return null;
end $$;

drop trigger if exists group_members_count on public.group_members;
create trigger group_members_count
  after insert or delete on public.group_members
  for each row execute function public.tg_group_members_count();

-- Bump `groups.updated_at` on every message so group list ordering is cheap.
create or replace function public.tg_group_messages_bump()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.groups g set updated_at = now() where g.id = new.group_id;
  return null;
end $$;

drop trigger if exists group_messages_bump on public.group_messages;
create trigger group_messages_bump
  after insert on public.group_messages
  for each row execute function public.tg_group_messages_bump();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────────────────────
-- Business staff may mark buyer messages as read in the conversations they can
-- access (so the seller's inbox can clear its unread counter). The existing
-- `messages_update` policy only allows the message's sender, so we add one.
create policy "messages_mark_read" on public.messages
  for update using (sender_id = auth.uid() or public.is_admin()
    or exists (select 1 from public.conversations c where c.id = messages.conversation_id
                and public.has_business_access(c.business_id)))
  with check (sender_id = auth.uid() or public.is_admin()
    or exists (select 1 from public.conversations c where c.id = messages.conversation_id
                and public.has_business_access(c.business_id)));

-- Groups follow the rest of the schema: public groups are readable to everyone,
-- private groups only to their members. Creation / membership is user-scoped;
-- a business's organisers can manage groups attached to their business.
select public.drop_policies('groups');
create policy "groups_public_read" on public.groups
  for select using (
    (visibility = 'public' and deleted_at is null)
    or owner_id = auth.uid()
    or public.has_business_access(business_id)
    or public.is_admin()
  );
create policy "groups_insert" on public.groups
  for insert with check (
    owner_id = auth.uid()
    or (business_id is not null and public.has_business_access(business_id))
    or public.is_admin()
  );
create policy "groups_update" on public.groups
  for update using (
    owner_id = auth.uid()
    or public.has_business_access(business_id)
    or exists (select 1 from public.group_members m
                where m.group_id = groups.id and m.user_id = auth.uid() and m.role in ('owner','admin','moderator'))
    or public.is_admin()
  );
create policy "groups_delete" on public.groups
  for delete using (
    owner_id = auth.uid()
    or (business_id is not null and public.has_business_access(business_id))
    or public.is_admin()
  );

select public.drop_policies('group_members');
create policy "group_members_read" on public.group_members
  for select using (
    user_id = auth.uid()
    or exists (select 1 from public.groups g where g.id = group_members.group_id
                and (g.visibility = 'public' and g.deleted_at is null or public.has_business_access(g.business_id)))
    or public.is_admin()
  );
create policy "group_members_insert" on public.group_members
  for insert with check (
    user_id = auth.uid()
    or (exists (select 1 from public.groups g where g.id = group_members.group_id
                 and (g.owner_id = auth.uid() or public.has_business_access(g.business_id))))
    or public.is_admin()
  );
create policy "group_members_update" on public.group_members
  for update using (
    user_id = auth.uid()
    or exists (select 1 from public.groups g where g.id = group_members.group_id
                and (g.owner_id = auth.uid() or public.has_business_access(g.business_id)))
    or public.is_admin()
  );
create policy "group_members_delete" on public.group_members
  for delete using (
    user_id = auth.uid()
    or exists (select 1 from public.groups g where g.id = group_members.group_id
                and (g.owner_id = auth.uid() or public.has_business_access(g.business_id)))
    or public.is_admin()
  );

select public.drop_policies('group_messages');
create policy "group_messages_read" on public.group_messages
  for select using (
    exists (select 1 from public.groups g where g.id = group_messages.group_id
             and (g.visibility = 'public' and g.deleted_at is null or public.has_business_access(g.business_id)))
    or exists (select 1 from public.group_members m where m.group_id = group_messages.group_id and m.user_id = auth.uid())
    or public.is_admin()
  );
create policy "group_messages_insert" on public.group_messages
  for insert with check (
    sender_id = auth.uid()
    or (exists (select 1 from public.group_members m where m.group_id = group_messages.group_id and m.user_id = auth.uid()))
    or (exists (select 1 from public.groups g where g.id = group_messages.group_id and public.has_business_access(g.business_id)))
    or public.is_admin()
  );
create policy "group_messages_update" on public.group_messages
  for update using (sender_id = auth.uid() or public.is_admin())
  with check (sender_id = auth.uid() or public.is_admin());
create policy "group_messages_delete" on public.group_messages
  for delete using (sender_id = auth.uid() or public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. GROUPS HELPER FUNCTIONS
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.is_group_member(p_group_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.group_members m
                  where m.group_id = p_group_id and m.user_id = auth.uid() and m.status = 'active');
$$;

revoke all on function public.is_group_member(uuid) from public;
grant execute on function public.is_group_member(uuid) to authenticated;
