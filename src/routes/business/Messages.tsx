import { useCallback, useEffect, useState } from 'react';
import { Button, Notice, Skeleton, Textarea, Switch, Input } from '@/components/ui';
import { PageHeader } from '@/components/layout/BusinessShell';
import { BusinessAvatar, Avatar } from '@/components/ui';
import { useBusiness } from '@/context/BusinessContext';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { cloudinaryUpload } from '@/lib/cloudinary';
import { formatDateTime, relativeTime } from '@/lib/dates';
import { displayName } from '@/lib/format';
import {
  DEFAULT_CHAT_SETTINGS,
  getChatSettings,
  listBusinessConversations,
  listConversationMessages,
  markBusinessConversationRead,
  saveChatSettings,
  sendBusinessMessage,
  type ChatSettings,
} from '@/lib/messaging';
import {
  createGroup,
  joinGroup,
  leaveGroup,
  listGroupMembers,
  listGroupMessages,
  listGroups,
  searchUsersForInvite,
  sendGroupMessage,
  type GroupInput,
} from '@/lib/groups';
import type { ConversationWithBusiness } from '@/lib/messaging';
import type { Group, GroupMember, GroupMessage, Message, UUID } from '@/types';

/**
 * Messages — the seller's inbox and community groups.
 *
 * Conversations and messages reuse the same Supabase `conversations` /
 * `messages` tables the buyer's "My Messages" page writes to, so a buyer and a
 * seller share one thread. The seller can reply (text, image, link), turn on
 * an auto-reply that the database fires once per new conversation, and run
 * public community groups with product / business link previews.
 */

type Tab = 'inbox' | 'groups';

export default function MessagesModule() {
  const { user } = useAuth();
  const { activeBusiness } = useBusiness();
  const [tab, setTab] = useState<Tab>('inbox');

  return (
    <div className="space-y-4">
      <PageHeader
        title="Messages"
        subtitle="Buyer conversations, auto-reply and community groups."
        icon="send"
        actions={
          <div className="sh-rail">
            <button type="button" onClick={() => setTab('inbox')}
              className={`sh-pill ${tab === 'inbox' ? 'sh-pill-brand' : 'sh-pill-neutral hover:bg-ink-200'}`}>
              <span aria-hidden className="text-sm">💬</span> Inbox
            </button>
            <button type="button" onClick={() => setTab('groups')}
              className={`sh-pill ${tab === 'groups' ? 'sh-pill-brand' : 'sh-pill-neutral hover:bg-ink-200'}`}>
              <span aria-hidden className="text-sm">👥</span> Groups
            </button>
          </div>
        }
      />
      {tab === 'inbox' ? (
        <Inbox businessId={activeBusiness?.id ?? null} businessName={activeBusiness?.name ?? 'Business'} />
      ) : (
        <GroupsPanel businessId={activeBusiness?.id ?? null} ownerId={user?.id ?? null} />
      )}
    </div>
  );
}

/* ── Inbox ──────────────────────────────────────────────────────────────────── */

function Inbox({ businessId, businessName }: { businessId: UUID | null; businessName: string }) {
  const { success, error: toastError } = useToast();
  const [activeId, setActiveId] = useState<UUID | null>(null);
  const [conversations, setConversations] = useState<ConversationWithBusiness[] | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [settings, setSettings] = useState<ChatSettings>(DEFAULT_CHAT_SETTINGS);
  const [draft, setDraft] = useState('');
  const [link, setLink] = useState('');
  const [sending, setSending] = useState(false);

  const loadConversations = useCallback(async () => {
    if (!businessId) { setConversations([]); return; }
    try { setConversations(await listBusinessConversations(businessId)); }
    catch (e) { toastError('Could not load inbox', e instanceof Error ? e.message : undefined); setConversations([]); }
  }, [businessId, toastError]);

  const loadMessages = useCallback(async (conversationId: UUID) => {
    setMessages(null);
    try { setMessages(await listConversationMessages(conversationId)); }
    catch (e) { toastError('Could not load thread', e instanceof Error ? e.message : undefined); setMessages([]); }
  }, [toastError]);

  const loadSettings = useCallback(async () => {
    if (!businessId) return;
    try { setSettings(await getChatSettings(businessId)); }
    catch { setSettings(DEFAULT_CHAT_SETTINGS); }
  }, [businessId]);

  useEffect(() => { void loadConversations(); }, [loadConversations]);
  useEffect(() => { void loadSettings(); }, [loadSettings]);

  useEffect(() => {
    if (!activeId) { setMessages(null); return; }
    void loadMessages(activeId);
    if (businessId) void markBusinessConversationRead(activeId, businessId).catch(() => {});
  }, [activeId, businessId, loadMessages]);

  const open = (id: UUID) => {
    setActiveId(id);
    setConversations((c) => (c ?? []).map((row) => (row.id === id ? { ...row, unread_business: 0 } : row)));
  };

  const send = async () => {
    if (!activeId || !businessId || !draft.trim()) return;
    setSending(true);
    try {
      await sendBusinessMessage({ conversationId: activeId, businessId, businessName, body: draft.trim() });
      setDraft('');
      setLink('');
      await Promise.all([loadMessages(activeId), loadConversations()]);
    } catch (e) {
      toastError('Could not send', e instanceof Error ? e.message : undefined);
    } finally {
      setSending(false);
    }
  };

  const sendWithImage = async (file: File | null) => {
    if (!activeId || !businessId || !file) return;
    setSending(true);
    try {
      const upload = await cloudinaryUpload(file);
      await sendBusinessMessage({
        conversationId: activeId, businessId, businessName, body: 'Sent an image.',
        attachment: { type: 'image', url: upload.url, name: upload.name, thumb: upload.url },
      });
      await Promise.all([loadMessages(activeId), loadConversations()]);
    } catch (e) {
      toastError('Could not send image', e instanceof Error ? e.message : undefined);
    } finally {
      setSending(false);
    }
  };

  const sendLink = async () => {
    const url = link.trim();
    if (!activeId || !businessId || !url) return;
    setSending(true);
    try {
      await sendBusinessMessage({
        conversationId: activeId, businessId, businessName, body: url,
        referenceType: 'link', attachment: { type: 'link', url, name: url },
      });
      setLink('');
      await Promise.all([loadMessages(activeId), loadConversations()]);
    } catch (e) {
      toastError('Could not send link', e instanceof Error ? e.message : undefined);
    } finally {
      setSending(false);
    }
  };

  const saveSettings = async (next: ChatSettings) => {
    if (!businessId) return;
    setSettings(next);
    try {
      await saveChatSettings(businessId, next);
      success('Auto-reply updated', next.autoReplyEnabled
        ? 'New conversations will be answered automatically — once per conversation.'
        : 'Auto-reply is off.');
    } catch (e) {
      toastError('Could not save auto-reply', e instanceof Error ? e.message : undefined);
    }
  };

  return (
    <div className="grid gap-3 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <div className="space-y-3">
        <AutoReplyCard settings={settings} onChange={saveSettings} />

        <div className="sh-card-flat overflow-hidden">
          <h2 className="border-b border-ink-100 px-4 py-3 text-sm font-extrabold">Conversations</h2>
          {conversations === null ? (
            <div className="space-y-2 p-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
          ) : conversations.length === 0 ? (
            <p className="p-4 text-sm text-ink-500">
              No conversations yet. When a buyer messages you from a store or product page it appears here.
            </p>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-ink-100 overflow-y-auto">
              {conversations.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => open(c.id)}
                    className={`flex w-full items-start gap-2.5 px-3.5 py-3 text-left hover:bg-ink-50 ${activeId === c.id ? 'bg-brand-50' : ''}`}>
                    <BusinessAvatar business={c.business} size={34} showVerified={false} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[13px] font-bold">{c.participant_name ?? 'Buyer'}</span>
                        {c.unread_business > 0 && <span className="rounded-full bg-brand-500 px-1.5 text-[10px] font-bold text-white">{c.unread_business}</span>}
                      </span>
                      <span className="block truncate text-xs text-ink-500">{c.last_message_preview ?? c.subject ?? '—'}</span>
                      <span className="mt-0.5 block text-[11px] text-ink-400">{relativeTime(c.last_message_at)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="sh-card-flat flex min-h-[24rem] flex-col">
        {!activeId ? (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-ink-500">
            Select a conversation to read and reply.
          </div>
        ) : (
          <>
            <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-4">
              {messages === null ? (
                <div className="space-y-2.5">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-2xl" />)}</div>
              ) : messages.length === 0 ? (
                <p className="p-4 text-center text-sm text-ink-500">No messages in this conversation yet.</p>
              ) : (
                messages.map((m) => <Bubble key={m.id} message={m} />)
              )}
            </div>

            <div className="space-y-2 border-t border-ink-100 p-3">
              <div className="flex items-end gap-2">
                <Textarea
                  rows={2}
                  placeholder="Type a reply…"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
                  className="flex-1"
                />
                <label className="shrink-0 cursor-pointer rounded-xl border border-ink-200 px-3 py-2 text-ink-600 hover:bg-ink-50">
                  <span aria-hidden>📎</span>
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0] ?? null; e.target.value = ''; void sendWithImage(f); }} />
                </label>
                <Button icon="send" loading={sending} onClick={() => void send()}>Send</Button>
              </div>
              <div className="flex items-center gap-2">
                <Input placeholder="Paste a link to share (optional)" value={link} onChange={(e) => setLink(e.target.value)} className="flex-1" />
                <Button variant="outline" size="sm" icon="link" disabled={!link.trim() || sending} onClick={() => void sendLink()}>Share</Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Bubble({ message }: { message: Message }) {
  const isBusiness = message.sender_type === 'business';
  const att = message.attachment as Record<string, unknown> | null;
  const imageUrl = typeof att?.url === 'string' ? (att.url as string) : null;
  return (
    <div className={`flex ${isBusiness ? 'justify-start' : 'justify-end'}`}>
      <div className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm ${isBusiness ? 'bg-ink-100 text-ink-800' : 'bg-brand-600 text-white'}`}>
        {imageUrl && (
          <img src={imageUrl} alt={String(att?.name ?? 'attachment')} className="mb-1.5 max-h-52 rounded-lg object-cover" />
        )}
        {message.body && <p className="whitespace-pre-wrap break-words">{message.body}</p>}
        <p className={`mt-1 text-[10px] ${isBusiness ? 'text-ink-400' : 'text-white/70'}`}>
          {isBusiness ? 'You' : message.sender_name} · {formatDateTime(message.created_at)}
        </p>
      </div>
    </div>
  );
}

function AutoReplyCard({ settings, onChange }: { settings: ChatSettings; onChange: (s: ChatSettings) => void }) {
  return (
    <div className="sh-card-flat p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-extrabold text-ink-950">Auto-reply</h3>
          <p className="text-[11px] text-ink-500">Answer a buyer's first message, once per conversation.</p>
        </div>
        <Switch checked={settings.autoReplyEnabled} onChange={(v) => onChange({ ...settings, autoReplyEnabled: v })} />
      </div>
      {settings.autoReplyEnabled && (
        <div className="mt-3 space-y-2.5">
          <Textarea rows={3} label="Message" value={settings.autoReplyMessage}
            onChange={(e) => onChange({ ...settings, autoReplyMessage: e.target.value })} />
          <p className="text-[11px] text-ink-400">Saved automatically. A new conversation is answered just once — the seller can still reply manually at any time.</p>
        </div>
      )}
    </div>
  );
}

/* ── Groups ─────────────────────────────────────────────────────────────────── */

function GroupsPanel({ businessId, ownerId }: { businessId: UUID | null; ownerId: UUID | null }) {
  const { user } = useAuth();
  const { success, error: toastError } = useToast();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [activeGroup, setActiveGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[] | null>(null);
  const [groupMessages, setGroupMessages] = useState<GroupMessage[] | null>(null);
  const [draft, setDraft] = useState('');
  const [link, setLink] = useState('');
  const [sending, setSending] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const loadGroups = useCallback(async () => {
    if (!ownerId) { setGroups([]); return; }
    try { setGroups(await listGroups(ownerId, businessId ?? undefined)); }
    catch (e) { toastError('Could not load groups', e instanceof Error ? e.message : undefined); setGroups([]); }
  }, [ownerId, businessId, toastError]);

  useEffect(() => { void loadGroups(); }, [loadGroups]);

  const refreshActive = useCallback(async (g: Group) => {
    try {
      const [m, gm] = await Promise.all([listGroupMembers(g.id), listGroupMessages(g.id)]);
      setMembers(m);
      setGroupMessages(gm);
    } catch (e) {
      toastError('Could not load group', e instanceof Error ? e.message : undefined);
      setMembers([]);
      setGroupMessages([]);
    }
  }, [toastError]);

  const openGroup = (g: Group) => { setActiveGroup(g); setMembers(null); setGroupMessages(null); void refreshActive(g); };

  const handleCreate = async (input: GroupInput) => {
    if (!ownerId) { toastError('You must be signed in'); return; }
    try {
      const g = await createGroup(input, ownerId);
      await joinGroup(g.id, ownerId, 'owner');
      success('Group created', g.name);
      setShowCreate(false);
      await loadGroups();
      if (!activeGroup) openGroup(g);
    } catch (e) { toastError('Could not create group', e instanceof Error ? e.message : undefined); }
  };

  const send = async (ref?: { url: string; title: string }) => {
    if (!activeGroup || !ownerId) return;
    const body = (ref ? link.trim() : draft.trim());
    if (!body && !ref) return;
    setSending(true);
    try {
      await sendGroupMessage({
        groupId: activeGroup.id,
        senderId: ownerId,
        senderName: user?.user_metadata?.display_name ? String(user.user_metadata.display_name) : displayName({ email: user?.email }),
        senderRole: members?.find((m) => m.user_id === ownerId)?.role ?? 'member',
        body: body || ref!.title,
        reference: ref ? { type: ref.url.startsWith('/store/') || ref.url.startsWith('/business/') ? 'business' : 'link', url: ref.url, title: ref.title } : null,
      });
      setDraft('');
      setLink('');
      await refreshActive(activeGroup);
      await loadGroups();
    } catch (e) { toastError('Could not send', e instanceof Error ? e.message : undefined); }
    finally { setSending(false); }
  };

  const shareProduct = (url: string, title: string) => void send({ url, title });

  return (
    <div className="grid gap-3 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <div className="sh-card-flat overflow-hidden">
        <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
          <h2 className="text-sm font-extrabold">Community groups</h2>
          <Button variant="outline" size="sm" icon="plus" onClick={() => setShowCreate(true)}>New</Button>
        </div>
        {groups === null ? (
          <div className="space-y-2 p-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
        ) : groups.length === 0 ? (
          <p className="p-4 text-sm text-ink-500">Create a public group to gather customers around a topic, product or community.</p>
        ) : (
          <ul className="max-h-[60vh] divide-y divide-ink-100 overflow-y-auto">
            {groups.map((g) => (
              <li key={g.id}>
                <button type="button" onClick={() => openGroup(g)}
                  className={`flex w-full items-center gap-2.5 px-3.5 py-3 text-left hover:bg-ink-50 ${activeGroup?.id === g.id ? 'bg-brand-50' : ''}`}>
                  {g.image ? <img src={g.image} alt="" className="h-10 w-10 rounded-xl object-cover" /> : <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-lg">👥</span>}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold">{g.name}</span>
                    <span className="block truncate text-xs text-ink-500">{g.description ?? g.category ?? 'Group'}</span>
                    <span className="mt-0.5 block text-[11px] text-ink-400">{g.member_count} members · {g.visibility}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="sh-card-flat flex min-h-[24rem] flex-col">
        {!activeGroup ? (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-ink-500">
            Select a group to read and post. Share a product or business link and it shows as a preview card.
          </div>
        ) : (
          <>
            <GroupHeader group={activeGroup} ownerId={ownerId} onLeave={async () => { await leaveGroup(activeGroup.id, ownerId!); success('Left group'); await loadGroups(); setActiveGroup(null); }} toastError={toastError} />
            <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-4">
              {groupMessages === null ? (
                <div className="space-y-2.5">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 rounded-2xl" />)}</div>
              ) : groupMessages.length === 0 ? (
                <p className="p-4 text-center text-sm text-ink-500">Be the first to post in this group.</p>
              ) : (
                groupMessages.map((m) => <GroupBubble key={m.id} message={m} />)
              )}
            </div>
            <div className="space-y-2 border-t border-ink-100 p-3">
              <div className="flex items-end gap-2">
                <Textarea rows={2} placeholder="Post to the group…" value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
                  className="flex-1" />
                <Button icon="send" loading={sending} onClick={() => void send()}>Post</Button>
              </div>
              <div className="flex items-center gap-2">
                <Input placeholder="Share a product or business link…" value={link} onChange={(e) => setLink(e.target.value)} className="flex-1" />
                <Button variant="outline" size="sm" icon="link" disabled={!link.trim() || sending}
                  onClick={() => void shareProduct(link.trim(), link.trim().split('/').pop()?.replace(/[-_]/g, ' ') || 'Shared link')}>Share link</Button>
              </div>
            </div>
          </>
        )}
      </div>

      {showCreate && <CreateGroupModal open={showCreate} onClose={() => setShowCreate(false)} onSubmit={handleCreate} />}
    </div>
  );
}

function GroupHeader({ group, ownerId, onLeave, toastError }: {
  group: Group; ownerId: UUID | null; onLeave: () => Promise<void>; toastError: (t: string, d?: string) => string;
}) {
  const [inviteOpen, setInviteOpen] = useState(false);
  const isOwner = ownerId === group.owner_id;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 p-4">
      <div className="flex items-center gap-3">
        {group.image ? <img src={group.image} alt="" className="h-11 w-11 rounded-xl object-cover" /> : <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-xl">👥</span>}
        <div>
          <h3 className="text-sm font-extrabold text-ink-950">{group.name}</h3>
          <p className="text-[11px] text-ink-500">{group.category ?? 'General'} · {group.member_count} member{group.member_count === 1 ? '' : 's'}</p>
          {group.description && <p className="mt-0.5 max-w-md text-xs text-ink-600">{group.description}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {!isOwner && <Button variant="outline" size="sm" icon="users" onClick={() => setInviteOpen(true)}>Invite</Button>}
        <Button variant="outline" size="sm" icon="close" onClick={() => void onLeave()}>Leave</Button>
      </div>
      {inviteOpen && <InviteModal group={group} open={inviteOpen} onClose={() => setInviteOpen(false)} toastError={toastError} />}
    </div>
  );
}

function InviteModal({ group, open, onClose, toastError }: {
  group: Group; open: boolean; onClose: () => void; toastError: (t: string, d?: string) => string;
}) {
  const { user } = useAuth();
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<Array<{ id: UUID; full_name: string | null; display_name: string | null; avatar_url: string | null; email: string }>>([]);
  const [busy, setBusy] = useState<UUID | null>(null);

  useEffect(() => {
    if (!term.trim()) { setResults([]); return; }
    const t = setTimeout(() => { void searchUsersForInvite(term).then(setResults).catch(() => setResults([])); }, 250);
    return () => clearTimeout(t);
  }, [term]);

  if (!open) return null;
  const invite = async (u: { id: UUID }) => {
    if (!user) return;
    setBusy(u.id);
    try { await joinGroup(group.id, u.id); toastError('Invited', undefined); void searchUsersForInvite(term).then(setResults); }
    catch (e) { toastError('Invite failed', e instanceof Error ? e.message : undefined); }
    finally { setBusy(null); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-extrabold">Invite to {group.name}</h3>
          <button type="button" className="text-ink-400 hover:text-ink-700" onClick={onClose}>✕</button>
        </div>
        <Input placeholder="Search by name or email…" value={term} onChange={(e) => setTerm(e.target.value)} />
        <ul className="mt-3 max-h-72 divide-y divide-ink-100 overflow-y-auto">
          {results.length === 0 ? <li className="p-3 text-sm text-ink-500">Type to search Seedwel members.</li> : results.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-2 py-2.5">
              <div className="flex items-center gap-2.5">
                <Avatar src={u.avatar_url} name={u.full_name ?? u.display_name ?? u.email} size={32} />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold">{u.full_name ?? u.display_name ?? u.email}</span>
                  <span className="block truncate text-[11px] text-ink-400">{u.email}</span>
                </span>
              </div>
              <Button variant="outline" size="sm" icon="plus" loading={busy === u.id} onClick={() => void invite(u)}>Invite</Button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function GroupBubble({ message }: { message: GroupMessage }) {
  const refImg = message.reference_img;
  return (
    <div className="flex justify-start">
      <div className="max-w-[78%] rounded-2xl rounded-bl-sm bg-ink-100 px-3.5 py-2.5 text-sm text-ink-800">
        <p className="text-[11px] font-bold text-brand-700">{message.sender_name}</p>
        {refImg && <img src={refImg} alt={message.reference_title ?? 'preview'} className="mb-1.5 max-h-40 rounded-lg object-cover" />}
        {message.reference_title && <p className="mb-0.5 font-semibold text-ink-900">{message.reference_title}</p>}
        {message.body && <p className="whitespace-pre-wrap break-words">{message.body}</p>}
        {message.reference_url && <a href={message.reference_url} target="_blank" rel="noreferrer" className="mt-1 block text-[11px] font-semibold text-brand-700 underline">{message.reference_url}</a>}
        <p className="mt-1 text-[10px] text-ink-400">{formatDateTime(message.created_at)}</p>
      </div>
    </div>
  );
}

function CreateGroupModal({ open, onClose, onSubmit }: {
  open: boolean; onClose: () => void; onSubmit: (input: GroupInput) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('General');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!open) return null;
  const submit = async () => {
    if (!name.trim()) { setErr('Give the group a name.'); return; }
    setBusy(true); setErr(null);
    try { await onSubmit({ name: name.trim(), description: description.trim() || null, category, visibility }); setName(''); setDescription(''); setCategory('General'); setVisibility('public'); }
    catch { /* errors surfaced by parent */ }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-extrabold">Create a group</h3>
          <button type="button" className="text-ink-400 hover:text-ink-700" onClick={onClose}>✕</button>
        </div>
        <div className="space-y-3">
          {err && <Notice tone="danger" title="Cannot create group">{err}</Notice>}
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lusaka Market Traders" />
          <Textarea label="Description (optional)" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this community about?" />
          <Input label="Category" value={category} onChange={(e) => setCategory(e.target.value)} />
          <div className="flex items-center justify-between gap-3 rounded-xl bg-ink-50 p-3">
            <div>
              <p className="text-sm font-bold">Public</p>
              <p className="text-[11px] text-ink-500">Anyone can see and join.</p>
            </div>
            <Switch checked={visibility === 'public'} onChange={(v) => setVisibility(v ? 'public' : 'private')} />
          </div>
          <Button block icon="plus" loading={busy} onClick={() => void submit()}>Create group</Button>
        </div>
      </div>
    </div>
  );
}
