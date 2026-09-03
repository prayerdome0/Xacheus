import { db, nowIso, fetchRow, fetchList, addRow, patchRow, subscribeList, type DbWhere } from './db';
import { deleteDoc } from 'firebase/firestore';
import { docRef } from './db';
import type { Group, GroupMember, GroupMessage, UUID } from '@/types';

/**
 * Community groups — create / join / list / chat on Firestore.
 *
 * A group document keeps its display data; memberships live in
 * `group_members` keyed by (group, user) so joining is idempotent. Group
 * messages embed the sender snapshot and optionally a shared product/business
 * link preview. All images (group pictures) stay on Cloudinary.
 */

export type GroupInput = {
  name: string;
  description?: string | null;
  image?: string | null;
  category?: string | null;
  visibility?: 'public' | 'private';
  country_code?: string;
  is_approval_needed?: boolean;
  business_id?: UUID | null;
};

export async function createGroup(input: GroupInput, ownerId: UUID): Promise<Group> {
  const name = (input.name ?? '').trim();
  if (!name) throw new Error('Group name is required.');
  const id = db.newId();
  const now = nowIso();
  await addRow<Group>('groups', {
    business_id: input.business_id ?? null,
    owner_id: ownerId,
    name,
    slug: null,
    description: input.description ?? null,
    image: input.image ?? null,
    category: input.category ?? 'General',
    visibility: input.visibility ?? 'public',
    country_code: input.country_code ?? 'ZM',
    member_count: 0,
    is_approval_needed: input.is_approval_needed ?? false,
    created_at: now,
    updated_at: now,
  } as never, id);
  return { id, business_id: input.business_id ?? null, owner_id: ownerId, name, slug: null, description: input.description ?? null, image: input.image ?? null, category: input.category ?? 'General', visibility: input.visibility ?? 'public', country_code: input.country_code ?? 'ZM', member_count: 0, is_approval_needed: input.is_approval_needed ?? false, created_at: now, updated_at: now };
}

export async function updateGroup(groupId: UUID, patch: Partial<GroupInput>): Promise<void> {
  await patchRow('groups', groupId, { ...(patch as Record<string, unknown>), updated_at: nowIso() });
}

export async function listGroups(ownerId: UUID, businessId?: UUID): Promise<Group[]> {
  const where: DbWhere[] = [];
  if (businessId) {
    where.push(['business_id', '==', businessId] as DbWhere);
    where.push(['owner_id', '==', ownerId] as DbWhere);
  } else {
    where.push(['owner_id', '==', ownerId] as DbWhere);
  }
  return fetchList<Group>('groups', { where, orderByField: 'updated_at', orderDir: 'desc', limit: 200 });
}

export async function getGroup(groupId: UUID): Promise<Group | null> {
  return fetchRow<Group>('groups', groupId);
}

/** Join a group as the current user (as member). Idempotent per (group, user). */
export async function joinGroup(groupId: UUID, userId: UUID, role: GroupMember['role'] = 'member'): Promise<void> {
  const existing = await fetchList<{ id: string }>('group_members', {
    where: [['group_id', '==', groupId] as DbWhere, ['user_id', '==', userId] as DbWhere],
    limit: 1,
  });
  const now = nowIso();
  if (existing[0]) {
    await patchRow('group_members', existing[0].id, { role, status: 'active', joined_at: now, updated_at: now });
    return;
  }
  await addRow<{ id: string }>('group_members', {
    group_id: groupId,
    user_id: userId,
    role,
    status: 'active',
    joined_at: now,
    created_at: now,
    updated_at: now,
  });
  const group = await fetchRow<Group>('groups', groupId);
  if (group) {
    await patchRow('groups', groupId, { member_count: Math.max(0, toCount(group.member_count) + 1), updated_at: now });
  }
}

export async function leaveGroup(groupId: UUID, userId: UUID): Promise<void> {
  const existing = await fetchList<{ id: string }>('group_members', {
    where: [['group_id', '==', groupId] as DbWhere, ['user_id', '==', userId] as DbWhere],
    limit: 1,
  });
  if (existing[0]) {
    await deleteDoc(docRef('group_members', existing[0].id));
    const group = await fetchRow<Group>('groups', groupId);
    if (group) {
      await patchRow('groups', groupId, { member_count: Math.max(0, toCount(group.member_count) - 1), updated_at: nowIso() });
    }
  }
}

export async function listGroupMembers(groupId: UUID): Promise<GroupMember[]> {
  const rows = await fetchList<GroupMember>('group_members', {
    where: [['group_id', '==', groupId] as DbWhere, ['status', '==', 'active'] as DbWhere],
    orderByField: 'joined_at', orderDir: 'asc', limit: 200,
  });
  // Attach the public profile snapshot for avatars/names.
  const ids = rows.map((m) => m.user_id).filter(Boolean);
  const profiles = ids.length
    ? await fetchList<{ id: string; user_id: string; full_name: string | null; display_name: string | null; avatar_url: string | null }>(
        'public_profiles', { where: [['user_id', 'in', ids.slice(0, 30)] as DbWhere], limit: 100 },
      )
    : [];
  return rows.map((m) => {
    const p = profiles.find((x) => x.user_id === m.user_id);
    return {
      ...m,
      profile: p
        ? { full_name: p.full_name, display_name: p.display_name ?? p.full_name, avatar_url: p.avatar_url }
        : null,
    };
  });
}

export async function listGroupMessages(groupId: UUID): Promise<GroupMessage[]> {
  return fetchList<GroupMessage>('group_messages', {
    where: [['group_id', '==', groupId] as DbWhere],
    orderByField: 'created_at', orderDir: 'asc', limit: 500,
  });
}

/** Realtime group messages. */
export function subscribeGroupMessages(
  groupId: UUID,
  onChange: (messages: GroupMessage[]) => void,
  onError?: (message: string) => void,
): () => void {
  return subscribeList<GroupMessage>(
    'group_messages',
    { where: [['group_id', '==', groupId] as DbWhere], orderByField: 'created_at', orderDir: 'asc', limit: 500 },
    onChange,
    onError,
  );
}

export async function sendGroupMessage(params: {
  groupId: UUID;
  senderId: UUID | null;
  senderName: string;
  senderRole?: string;
  body: string;
  attachment?: Record<string, unknown> | null;
  reference?: { type: string; id?: UUID | null; url?: string | null; title?: string | null; image?: string | null } | null;
}): Promise<void> {
  const body = (params.body ?? '').trim();
  if (!body && !params.attachment && !params.reference) throw new Error('Write a message first.');
  await addRow<GroupMessage>('group_messages', {
    group_id: params.groupId,
    sender_id: params.senderId,
    sender_name: params.senderName,
    sender_role: params.senderRole ?? 'member',
    body,
    attachment: params.attachment ?? null,
    reference_type: params.reference?.type ?? null,
    reference_id: params.reference?.id ?? null,
    reference_url: params.reference?.url ?? null,
    reference_title: params.reference?.title ?? null,
    reference_img: params.reference?.image ?? null,
    is_edited: false,
    created_at: nowIso(),
  });
  await patchRow('groups', params.groupId, { updated_at: nowIso() }).catch(() => undefined);
}

/** Search users to invite — reads the public directory mirror of user profiles. */
export async function searchUsersForInvite(
  term: string,
): Promise<Array<{ id: UUID; full_name: string | null; display_name: string | null; avatar_url: string | null; email: string }>> {
  const trim = term.trim().toLowerCase();
  if (!trim) return [];
  const pool = await fetchList<{ id: string; user_id: string; full_name: string | null; display_name: string | null; avatar_url: string | null; email: string }>(
    'public_profiles',
    { limit: 300 },
  );
  return pool
    .filter((u) =>
      [u.full_name, u.display_name, u.email, u.id].filter(Boolean).some((v) => String(v).toLowerCase().includes(trim)),
    )
    .slice(0, 8)
    .map((u) => ({ id: u.user_id ?? u.id, full_name: u.full_name, display_name: u.display_name ?? u.full_name, avatar_url: u.avatar_url, email: u.email ?? '' }));
}

function toCount(v: unknown): number {
  return Math.max(0, Number(v ?? 0));
}
