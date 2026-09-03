import { db, nowIso, fetchRow, fetchList, addRow, patchRow, subscribeList, type DbWhere } from './db';
import { notifyBusinessMembers, notifyUser } from './notifications';
import type { Business, BusinessSummary, Conversation, Message, UUID } from '@/types';

/**
 * Messaging — conversations and messages on Firestore.
 *
 * A conversation document carries its display snapshots (`business`, and the
 * participant's name/phone), so both sides of a thread render from one read.
 * Unread counters and `last_message_*` are updated by the sender's write path
 * (the role the database triggers used to play). All media stays on Cloudinary
 * and only its URL is stored on the message.
 *
 * Auto-reply: when a buyer writes the very first user message of a
 * conversation and the seller has `chat.auto_reply` enabled in
 * `business_settings`, the business answers once automatically.
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

export interface ConversationWithBusiness extends Conversation {
  business?: Pick<BusinessSummary, 'id' | 'name' | 'slug' | 'logo_url' | 'verification_status' | 'rating_avg' | 'city' | 'country_code' | 'badges'> | null;
}

const CHAT_SETTINGS_KEY = 'chat.auto_reply';

/** Read the business's chat / auto-reply settings. */
export async function getChatSettings(businessId: UUID): Promise<ChatSettings> {
  if (!businessId) return DEFAULT_CHAT_SETTINGS;
  try {
    const doc = await fetchRow<{ id: string; value?: Partial<ChatSettings> }>('business_settings', settingDocId(businessId));
    const v = doc?.value;
    if (!v) return DEFAULT_CHAT_SETTINGS;
    return {
      autoReplyEnabled: v.autoReplyEnabled ?? DEFAULT_CHAT_SETTINGS.autoReplyEnabled,
      autoReplyMessage: v.autoReplyMessage?.trim() || DEFAULT_AUTO_REPLY,
    };
  } catch {
    return DEFAULT_CHAT_SETTINGS;
  }
}

/** Save the business's chat / auto-reply settings. */
export async function saveChatSettings(businessId: UUID, settings: ChatSettings): Promise<void> {
  if (!businessId) throw new Error('No business selected.');
  const res = await db.from('business_settings').upsert(
    {
      id: settingDocId(businessId),
      business_id: businessId,
      key: CHAT_SETTINGS_KEY,
      value: { ...settings, autoReplyMessage: settings.autoReplyMessage.trim() || DEFAULT_AUTO_REPLY },
      created_at: nowIso(),
      updated_at: nowIso(),
    },
    { onConflict: 'id' },
  );
  if (res.error) throw new Error(res.error.message);
}

function settingDocId(businessId: string): string {
  return `${businessId}__chat`;
}

async function businessSnapshot(businessId: string): Promise<Pick<BusinessSummary, 'id' | 'name' | 'slug' | 'logo_url' | 'verification_status' | 'rating_avg' | 'city' | 'country_code' | 'badges'> | null> {
  const b = await fetchRow<Business>('businesses', businessId).catch(() => null);
  if (!b) return null;
  return {
    id: b.id, name: b.name, slug: b.slug, logo_url: b.logo_url,
    verification_status: b.verification_status, rating_avg: b.rating_avg,
    city: b.city, country_code: b.country_code, badges: b.badges ?? [],
  };
}

function touchConversation(
  convId: string,
  fields: { last_message_at: string; last_message_preview: string; unread_business?: number; unread_user?: number },
): Promise<void> {
  return patchRow('conversations', convId, { ...fields, updated_at: nowIso() }).catch(() => undefined);
}

/** Conversations for a business (the seller's inbox), newest first. */
export async function listBusinessConversations(businessId: UUID): Promise<ConversationWithBusiness[]> {
  if (!businessId) return [];
  const rows = await fetchList<ConversationWithBusiness>('conversations', {
    where: [['business_id', '==', businessId] as DbWhere],
    orderByField: 'last_message_at', orderDir: 'desc', limit: 200,
  });
  // Attach the business snapshot (kept denormalised, refreshed lazily).
  const snap = await businessSnapshot(businessId);
  return rows.map((c) => ({ ...c, business: c.business ?? snap }));
}

/** Messages in a conversation, oldest first. */
export async function listConversationMessages(conversationId: UUID): Promise<Message[]> {
  return fetchList<Message>('messages', {
    where: [['conversation_id', '==', conversationId] as DbWhere],
    orderByField: 'created_at', orderDir: 'asc', limit: 500,
  });
}

/** Realtime: keep a conversation's messages fresh without polling. */
export function subscribeConversationMessages(
  conversationId: UUID,
  onChange: (messages: Message[]) => void,
  onError?: (message: string) => void,
): () => void {
  return subscribeList<Message>(
    'messages',
    { where: [['conversation_id', '==', conversationId] as DbWhere], orderByField: 'created_at', orderDir: 'asc', limit: 500 },
    onChange,
    onError,
  );
}

/** Realtime: the seller's conversation list. */
export function subscribeBusinessConversations(
  businessId: UUID,
  onChange: (rows: ConversationWithBusiness[]) => void,
  onError?: (message: string) => void,
): () => void {
  return subscribeList<ConversationWithBusiness>(
    'conversations',
    { where: [['business_id', '==', businessId] as DbWhere], orderByField: 'last_message_at', orderDir: 'desc', limit: 200 },
    (rows) => {
      void businessSnapshot(businessId).then((snap) => onChange(rows.map((c) => ({ ...c, business: c.business ?? snap }))));
    },
    onError,
  );
}

/**
 * Find (or create) the conversation between a buyer and a business.
 * One thread per (business, buyer, subject) — the same rule the old schema
 * enforced — so repeated "contact seller" taps reopen the existing chat.
 */
export async function findOrCreateConversation(input: {
  business: { id: UUID; name: string; slug: string; logo_url?: string | null };
  buyer: { id: UUID; name: string; phone?: string | null };
  subject?: string | null;
  productId?: UUID | null;
  orderId?: UUID | null;
  kind?: Conversation['kind'];
}): Promise<{ conversation: Conversation & { business?: unknown }; created: boolean }> {
  const where: DbWhere[] = [
    ['business_id', '==', input.business.id] as DbWhere,
    ['participant_user_id', '==', input.buyer.id] as DbWhere,
  ];
  if (input.subject) where.push(['subject', '==', input.subject] as DbWhere);
  const existing = await fetchList<Conversation>('conversations', { where, limit: 1 });
  if (existing[0] && !['closed', 'archived'].includes(existing[0].status)) {
    return { conversation: existing[0] as Conversation & { business?: unknown }, created: false };
  }
  if (existing[0]) {
    // Reopen the old thread instead of duplicating it.
    await patchRow('conversations', existing[0].id, { status: 'open', updated_at: nowIso() });
    return { conversation: existing[0] as Conversation & { business?: unknown }, created: false };
  }
  const id = db.newId();
  const now = nowIso();
  const row: Record<string, unknown> = {
    business_id: input.business.id,
    participant_user_id: input.buyer.id,
    participant_name: input.buyer.name,
    participant_phone: input.buyer.phone ?? null,
    kind: input.kind ?? 'marketplace',
    subject: input.subject ?? null,
    product_id: input.productId ?? null,
    order_id: input.orderId ?? null,
    status: 'open',
    unread_business: 0,
    unread_user: 0,
    last_message_at: now,
    last_message_preview: null,
    priority: 'normal',
    business: input.business.logo_url
      ? { id: input.business.id, name: input.business.name, slug: input.business.slug, logo_url: input.business.logo_url }
      : { id: input.business.id, name: input.business.name, slug: input.business.slug, logo_url: null },
    created_at: now,
    updated_at: now,
  };
  await addRow<{ id: string }>('conversations', row as never, id);
  return { conversation: { ...(row as unknown as Conversation), id }, created: true };
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
  const conversation = await fetchRow<Conversation>('conversations', params.conversationId);
  if (!conversation) throw new Error('That conversation no longer exists.');
  const body = (params.body ?? '').trim();
  if (!body && !params.attachment) throw new Error('Write a message first.');
  await addRow<Message>('messages', {
    conversation_id: params.conversationId,
    sender_id: null,
    sender_type: 'business',
    sender_name: params.businessName,
    body,
    attachment: params.attachment ?? null,
    reference_type: params.referenceType ?? null,
    reference_id: params.referenceId ?? null,
    is_read: false,
    created_at: nowIso(),
  });
  await touchConversation(params.conversationId, {
    last_message_at: nowIso(),
    last_message_preview: body.slice(0, 120) || 'Sent an attachment.',
    unread_user: toUnread(conversation.unread_user) + 1,
  });
  // Notify the buyer (their bell + personal feed).
  if (conversation.participant_user_id) {
    await notifyUser(conversation.participant_user_id, {
      type: 'message',
      title: params.businessName,
      body,
      icon: 'mail',
      action_url: '/account/messages',
      entity_type: 'conversation',
      entity_id: conversation.id,
      priority: 'normal',
    });
  }
}

function toUnread(v: unknown): number {
  return Math.max(0, Number(v ?? 0));
}

/** Send a message from a buyer (marketplace side). Creates the conversation on
 *  first contact and fires the seller's auto-reply once per conversation. */
export async function sendUserMessage(params: {
  business: { id: UUID; name: string; slug: string; logo_url?: string | null };
  buyer: { id: UUID; name: string; phone?: string | null; email?: string | null };
  body: string;
  subject?: string | null;
  productId?: UUID | null;
  orderId?: UUID | null;
  attachment?: Record<string, unknown> | null;
}): Promise<Conversation & { business?: unknown }> {
  const body = (params.body ?? '').trim();
  if (!body && !params.attachment) throw new Error('Write a message first.');
  const { conversation, created } = await findOrCreateConversation({
    business: params.business,
    buyer: params.buyer,
    subject: params.subject,
    productId: params.productId,
    orderId: params.orderId,
  });
  const now = nowIso();
  await addRow<Message>('messages', {
    conversation_id: conversation.id,
    sender_id: params.buyer.id,
    sender_type: 'user',
    sender_name: params.buyer.name,
    body,
    attachment: params.attachment ?? null,
    reference_type: null,
    reference_id: null,
    is_read: false,
    created_at: now,
  });
  await touchConversation(conversation.id, {
    last_message_at: now,
    last_message_preview: body.slice(0, 120) || 'Sent an attachment.',
    unread_business: toUnread((conversation as Conversation).unread_business) + 1,
  });

  // Seller notification.
  await notifyBusinessMembers(params.business.id, {
    type: 'message',
    title: `New message from ${params.buyer.name}`,
    body,
    icon: 'mail',
    action_url: '/business/messages',
    entity_type: 'conversation',
    entity_id: conversation.id,
  });

  // Auto-reply: once per conversation, when enabled.
  if (created) {
    const settings = await getChatSettings(params.business.id);
    if (settings.autoReplyEnabled && settings.autoReplyMessage) {
      await addRow<Message>('messages', {
        conversation_id: conversation.id,
        sender_id: null,
        sender_type: 'business',
        sender_name: params.business.name,
        body: settings.autoReplyMessage,
        attachment: null,
        reference_type: null,
        reference_id: null,
        is_read: false,
        created_at: nowIso(),
      });
      await touchConversation(conversation.id, {
        last_message_at: nowIso(),
        last_message_preview: settings.autoReplyMessage.slice(0, 120),
        unread_user: 1,
      });
    }
  }
  return conversation;
}

/** Mark all user-sent messages in a conversation as read (seller viewed them). */
export async function markBusinessConversationRead(conversationId: UUID, _businessId: UUID): Promise<void> {
  const rows = await fetchList<{ id: string }>('messages', {
    where: [
      ['conversation_id', '==', conversationId] as DbWhere,
      ['sender_type', '==', 'user'] as DbWhere,
      ['is_read', '==', false] as DbWhere,
    ],
    limit: 300,
  });
  if (rows.length) {
    await Promise.all(rows.map((m) => patchRow('messages', m.id, { is_read: true, read_at: nowIso() }).catch(() => undefined)));
  }
  await patchRow('conversations', conversationId, { unread_business: 0, updated_at: nowIso() }).catch(() => undefined);
}

/** Mark all business-sent messages read (the buyer opened the thread). */
export async function markUserConversationRead(conversationId: UUID): Promise<void> {
  const rows = await fetchList<{ id: string }>('messages', {
    where: [
      ['conversation_id', '==', conversationId] as DbWhere,
      ['sender_type', '==', 'business'] as DbWhere,
      ['is_read', '==', false] as DbWhere,
    ],
    limit: 300,
  });
  if (rows.length) {
    await Promise.all(rows.map((m) => patchRow('messages', m.id, { is_read: true, read_at: nowIso() }).catch(() => undefined)));
  }
  await patchRow('conversations', conversationId, { unread_user: 0, updated_at: nowIso() }).catch(() => undefined);
}

/** Reply from the buyer inside an existing conversation. */
export async function sendUserReply(params: {
  conversationId: UUID;
  buyer: { id: UUID; name: string };
  body: string;
  attachment?: Record<string, unknown> | null;
}): Promise<void> {
  const conversation = await fetchRow<Conversation>('conversations', params.conversationId);
  if (!conversation) throw new Error('That conversation no longer exists.');
  if (conversation.participant_user_id !== params.buyer.id) {
    throw new Error('You are not a participant in that conversation.');
  }
  const body = (params.body ?? '').trim();
  if (!body && !params.attachment) throw new Error('Write a message first.');
  await addRow<Message>('messages', {
    conversation_id: conversation.id,
    sender_id: params.buyer.id,
    sender_type: 'user',
    sender_name: params.buyer.name,
    body,
    attachment: params.attachment ?? null,
    reference_type: null,
    reference_id: null,
    is_read: false,
    created_at: nowIso(),
  });
  await touchConversation(conversation.id, {
    last_message_at: nowIso(),
    last_message_preview: body.slice(0, 120) || 'Sent an attachment.',
    unread_business: toUnread(conversation.unread_business) + 1,
  });
  if (conversation.business_id) {
    await notifyBusinessMembers(conversation.business_id, {
      type: 'message',
      title: `New message from ${params.buyer.name}`,
      body,
      icon: 'mail',
      action_url: '/business/messages',
      entity_type: 'conversation',
      entity_id: conversation.id,
    });
  }
}
