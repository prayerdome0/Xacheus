import { supabase } from './supabase';
import type { Group, GroupMember, GroupMessage, UUID } from '@/types';

/**
 * Community groups — create / join / list / chat.
 *
 * Backed by `supabase/sql/0013_messaging.sql` (groups, group_members,
 * group_messages). A group is a public or private community that may be opened
 * by a business (business_id set) or by an individual member.
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
  const { data, error } = await supabase
    .from('groups')
    .insert({
      owner_id: ownerId,
      business_id: input.business_id ?? null,
      name: input.name,
      description: input.description ?? null,
      image: input.image ?? null,
      category: input.category ?? 'General',
      visibility: input.visibility ?? 'public',
      country_code: input.country_code ?? 'ZM',
      is_approval_needed: input.is_approval_needed ?? false,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as unknown as Group;
}

export async function updateGroup(groupId: UUID, patch: Partial<GroupInput>): Promise<void> {
  const { error } = await supabase.from('groups').update(patch).eq('id', groupId);
  if (error) throw new Error(error.message);
}

export async function listGroups(ownerId: UUID, businessId?: UUID): Promise<Group[]> {
  let q = supabase
    .from('groups')
    .select('*')
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });
  if (businessId) {
    q = q.eq('business_id', businessId);
  } else {
    q = q.eq('owner_id', ownerId);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data as unknown as Group[]) ?? [];
}

export async function getGroup(groupId: UUID): Promise<Group | null> {
  const { data, error } = await supabase.from('groups').select('*').eq('id', groupId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as unknown as Group) ?? null;
}

/** Join a group as the current user (as member). */
export async function joinGroup(groupId: UUID, userId: UUID, role: GroupMember['role'] = 'member'): Promise<void> {
  const { error } = await supabase
    .from('group_members')
    .insert({ group_id: groupId, user_id: userId, role, status: 'active' });
  if (error) throw new Error(error.message);
}

export async function leaveGroup(groupId: UUID, userId: UUID): Promise<void> {
  const { error } = await supabase
    .from('group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('user_id', userId);
  if (error) throw new Error(error.message);
}

export async function listGroupMembers(groupId: UUID): Promise<GroupMember[]> {
  const { data, error } = await supabase
    .from('group_members')
    .select('*, profile:profiles(full_name, display_name, avatar_url)')
    .eq('group_id', groupId);
  if (error) throw new Error(error.message);
  return (data as unknown as GroupMember[]) ?? [];
}

export async function listGroupMessages(groupId: UUID): Promise<GroupMessage[]> {
  const { data, error } = await supabase
    .from('group_messages')
    .select('*')
    .eq('group_id', groupId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data as unknown as GroupMessage[]) ?? [];
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
  const { error } = await supabase.from('group_messages').insert({
    group_id: params.groupId,
    sender_id: params.senderId,
    sender_name: params.senderName,
    sender_role: params.senderRole ?? 'member',
    body: params.body,
    attachment: params.attachment ?? null,
    reference_type: params.reference?.type ?? null,
    reference_id: params.reference?.id ?? null,
    reference_url: params.reference?.url ?? null,
    reference_title: params.reference?.title ?? null,
    reference_img: params.reference?.image ?? null,
  });
  if (error) throw new Error(error.message);
}

/** Search users to invite — narrow by name or email prefix. */
export async function searchUsersForInvite(term: string): Promise<Array<{ id: UUID; full_name: string | null; display_name: string | null; avatar_url: string | null; email: string }>> {
  const trim = term.trim();
  if (!trim) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, display_name, avatar_url, email')
    .or(`full_name.ilike.%${trim}%,display_name.ilike.%${trim}%,email.ilike.%${trim}%`)
    .limit(8);
  if (error) throw new Error(error.message);
  return (data as unknown as Array<{ id: UUID; full_name: string | null; display_name: string | null; avatar_url: string | null; email: string }>) ?? [];
}
