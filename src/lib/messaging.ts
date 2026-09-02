import { supabase } from './supabase';
import type { Conversation, Message, UUID } from '@/types';

/**
 * Messaging helpers.
 *
 * Conversations and messages live in the legacy Supabase data layer
 * (`conversations` / `messages`), which already has RLS and triggers. The
 * business's chat / auto-reply configuration is stored in
 * `business_settings` under the key `chat.auto_reply` so that the database
 * trigger `messages_auto_reply` (0013) can read the same setting and answer a
 * buyer's very first message on the seller's behalf — once per conversation.
 */

export interface ChatSettings {
  autoReplyEnabled: boolean;
  autoReplyMessage: string;
}

export const DEFAULT_AUTO_REPLY =
  'Welcome to our business! Thank you for contacting us. We have received your message and will attend to you as soon as possible.';

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  autoReplyEnabled: false,
  autoReplyMessage: DEFAULT_AUTO_REPLY,
};

const CHAT_SETTINGS_KEY = 'chat.auto_reply';

/** Read the business's chat / auto-reply settings. */
export async function getChatSettings(businessId: UUID): Promise<ChatSettings> {
  if (!businessId) return DEFAULT_CHAT_SETTINGS;
  const { data, error } = await supabase
    .from('business_settings')
    .select('value')
    .eq('business_id', businessId)
    .eq('key', CHAT_SETTINGS_KEY)
    .maybeSingle();
  if (error || !data) return DEFAULT_CHAT_SETTINGS;
  const v = data.value as Partial<ChatSettings>;
  return {
    autoReplyEnabled: v.autoReplyEnabled ?? DEFAULT_CHAT_SETTINGS.autoReplyEnabled,
    autoReplyMessage: v.autoReplyMessage?.trim() || DEFAULT_AUTO_REPLY,
  };
}

/** Save the business's chat / auto-reply settings (upsert on business_id+key). */
export async function saveChatSettings(businessId: UUID, settings: ChatSettings): Promise<void> {
  if (!businessId) throw new Error('No business selected.');
  const { error } = await supabase.from('business_settings').upsert(
    {
      business_id: businessId,
      key: CHAT_SETTINGS_KEY,
      value: settings as unknown as Record<string, unknown>,
    },
    { onConflict: 'business_id,key' },
  );
  if (error) throw new Error(error.message);
}

/* ── Conversation / message queries ──────────────────────────────────────── */

export interface ConversationWithBusiness extends Conversation {
  business?: { name: string; slug: string; logo_url: string | null } | null;
}

/** Conversations for a business (the seller's inbox), newest first. */
export async function listBusinessConversations(businessId: UUID): Promise<ConversationWithBusiness[]> {
  const { data, error } = await supabase
    .from('conversations')
    .select('*, business:businesses(name,slug,logo_url)')
    .eq('business_id', businessId)
    .order('last_message_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data as unknown as ConversationWithBusiness[]) ?? [];
}

/** Messages in a conversation, oldest first. */
export async function listConversationMessages(conversationId: UUID): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data as unknown as Message[]) ?? [];
}

/** Send a message from a business (seller side). */
export async function sendBusinessMessage(params: {
  conversationId: UUID;
  businessId: UUID;
  businessName: string;
  body: string;
  attachment?: Record<string, unknown> | null;
  referenceType?: string | null;
  referenceId?: UUID | null;
}): Promise<void> {
  const { error } = await supabase.from('messages').insert({
    conversation_id: params.conversationId,
    sender_id: null, // a business is not an auth.users row
    sender_type: 'business',
    sender_name: params.businessName,
    body: params.body,
    attachment: params.attachment ?? null,
    reference_type: params.referenceType ?? null,
    reference_id: params.referenceId ?? null,
    is_read: false,
  });
  if (error) throw new Error(error.message);
}

/** Mark all user-sent messages in a conversation as read (seller viewed them). */
export async function markBusinessConversationRead(conversationId: UUID, businessId: UUID): Promise<void> {
  await Promise.all([
    supabase
      .from('messages')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('sender_type', 'user')
      .eq('is_read', false),
    supabase
      .from('conversations')
      .update({ unread_business: 0 })
      .eq('id', conversationId)
      .eq('business_id', businessId),
  ]);
}
