/** Xacheus — Direct messages (private 1:1 chats over Firestore). */

import {
  getConversationMeta,
  getProfile,
  getProfileByUsername,
  markConversationRead,
  openConversation,
  sendDirectMessage,
  watchConversations,
  watchMessages,
} from "../data.js";
import { avatar, clear, emptyState, esc, timeAgo, toast, openModal, closeModal } from "../ui.js";

/* ------------------------------------------------------------------ */
/* inbox                                                               */
/* ------------------------------------------------------------------ */

export function messagesView(ctx) {
  let unsubscribe = null;
  let destroyed = false;
  let conversations = [];
  const peerCache = new Map(); // uid -> profile

  const html = `
    <div class="view-head">
      <h1>Messages</h1>
      <button class="icon-btn" type="button" data-act="new" aria-label="New message">✏️</button>
    </div>
    <div class="conv-search">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12zm11 17-5.2-5.2"/></svg>
      <input type="search" id="conv-filter" placeholder="Search conversations" aria-label="Search conversations" />
    </div>
    <div class="conv-list" id="conv-list" aria-live="polite">
      <div class="loader-row"><span class="spinner"></span> Loading conversations…</div>
    </div>`;

  function peerOf(conversation, myUid) {
    const otherUid = (conversation.participants || []).find((id) => id !== myUid) || "";
    return peerCache.get(otherUid) || null;
  }

  function render(root, filter = "") {
    const list = root.querySelector("#conv-list");
    if (!list || destroyed) return;
    const myUid = ctx.state.profile?.uid;
    const term = filter.trim().toLowerCase();

    const rows = conversations
      .map((conversation) => ({ conversation, other: peerOf(conversation, myUid) }))
      .filter(({ other }) => !term || `${other?.displayName || ""} ${other?.username || ""}`.toLowerCase().includes(term));

    clear(list);
    if (!rows.length) {
      list.innerHTML = emptyState(
        "✉️",
        conversations.length ? "No conversations match" : "No messages yet",
        conversations.length
          ? "Try a different name."
          : "Open someone's profile and tap Message to start a private chat.",
        '<a class="btn btn-primary btn-sm" href="#/discover">Find people to message</a>'
      );
      return;
    }

    list.innerHTML = rows
      .map(({ conversation, other }) => {
        const unread = conversation.unreadCount?.[myUid] || 0;
        const href = other?.username
          ? `#/dm/${esc(other.username)}`
          : `#/messages/${esc(conversation.id)}`;
        return `
        <a class="conv ${unread ? "is-unread" : ""}" href="${href}">
          ${avatar(other || {}, "md")}
          <span class="conv-body">
            <span class="conv-top">
              <strong>${esc(other?.displayName || "Xacheus user")}</strong>
              <em>${timeAgo(conversation.lastMessageAt)}</em>
            </span>
            <span class="conv-preview">${esc(conversation.lastMessage || "Say hello 👋")}</span>
          </span>
          ${unread ? `<span class="badge-count">${unread > 9 ? "9+" : unread}</span>` : ""}
        </a>`;
      })
      .join("");
  }

  function startNewChat(root) {
    if (!ctx.state.profile) return ctx.requireAuth();
    openModal({
      title: "New message",
      body: `
        <form id="new-chat-form" class="form-grid">
          <label class="field">
            <span>@handle</span>
            <input type="text" name="handle" maxlength="20" placeholder="e.g. zacheus" autocomplete="off" required />
          </label>
          <p class="field-hint" id="new-chat-hint">Who are you messaging? Enter their Xacheus handle.</p>
          <button class="btn btn-primary btn-block" type="submit">Start chat</button>
        </form>`,
      onMount(modal, close) {
        modal.querySelector("#new-chat-form").addEventListener("submit", async (event) => {
          event.preventDefault();
          const raw = new FormData(event.target).get("handle");
          const handle = String(raw || "").replace(/^@/, "").trim().toLowerCase();
          if (!handle) return;
          const hint = modal.querySelector("#new-chat-hint");
          const me = ctx.state.profile;
          try {
            if (handle === me.username) {
              hint.textContent = "That's you — pick a friend instead 🙂";
              return;
            }
            const other = await getProfileByUsername(handle);
            if (!other) {
              hint.textContent = `No one uses @${handle} yet.`;
              return;
            }
            closeModal(true);
            ctx.navigate(`#/dm/${other.username}`);
          } catch (error) {
            hint.textContent = error?.message || "Could not start that chat.";
          }
        });
      },
    });
  }

  return {
    html,
    title: "Messages",
    mount(root) {
      const list = root.querySelector("#conv-list");
      let filter = "";

      if (!ctx.state.profile) {
        clear(list);
        list.innerHTML = emptyState(
          "🔒",
          "Log in to use messages",
          "Direct messages are private 1:1 chats that update in real time."
        );
        return;
      }

      root.querySelector("#conv-filter").addEventListener("input", (event) => {
        filter = event.target.value;
        render(root, filter);
      });

      root.querySelector('[data-act="new"]').addEventListener("click", () => startNewChat(root));

      unsubscribe = watchConversations(ctx.state.profile.uid, async (items) => {
        if (destroyed) return;
        conversations = items;
        // Resolve peer profiles (once per user) for names, avatars and links.
        const myUid = ctx.state.profile.uid;
        await Promise.all(
          items.map(async (conversation) => {
            const otherUid = (conversation.participants || []).find((id) => id !== myUid);
            if (!otherUid || peerCache.has(otherUid)) return;
            const profile = await getProfile(otherUid).catch(() => null);
            peerCache.set(otherUid, profile);
          })
        );
        const totalUnread = conversations.reduce(
          (sum, conversation) => sum + (conversation.unreadCount?.[myUid] || 0),
          0
        );
        ctx.setMessageUnread(totalUnread);
        render(root, filter);
      });
    },
    destroy() {
      destroyed = true;
      if (unsubscribe) unsubscribe();
    },
  };
}

/* ------------------------------------------------------------------ */
/* conversation                                                        */
/* ------------------------------------------------------------------ */

/**
 * Chat thread. Open with either a peer handle (`#/dm/zacheus`) or an
 * existing conversation id (`#/messages/{cid}`).
 */
export function chatView(ctx, { username = "", cid: cidParam = "" } = {}) {
  let unsubscribe = null;
  let destroyed = false;
  let conversationId = cidParam;
  let peer = null;
  let lastMarkedId = "";

  const html = `
    <div class="view-head chat-head">
      <a class="icon-btn back-btn" href="#/messages" aria-label="Back to messages">←</a>
      <div class="chat-peer" id="chat-peer"><span class="loader-row"><span class="spinner"></span></span></div>
    </div>
    <div class="chat-log" id="chat-log" aria-live="polite"></div>
    <form class="chat-form" id="chat-form">
      <input type="text" id="chat-input" placeholder="Write a message…" maxlength="1000" autocomplete="off" aria-label="Message" />
      <button class="btn btn-primary btn-sm" type="submit">Send</button>
    </form>`;

  function renderPeer() {
    const host = document.querySelector("#chat-peer");
    if (!host || !peer) return;
    host.innerHTML = `
      <a href="#/u/${esc(peer.username || "")}">
        ${avatar(peer, "sm")}
        <span>
          <strong>${esc(peer.displayName || "Xacheus user")}</strong>
          <em>@${esc(peer.username || "user")}</em>
        </span>
      </a>`;
  }

  function bubbleHtml(message, myUid) {
    const mine = message.senderId === myUid;
    const who = mine
      ? null
      : { photoURL: message.senderPhoto, displayName: message.senderName, username: message.senderUsername };
    return `
      <div class="bubble-row ${mine ? "is-mine" : ""}">
        ${mine ? "" : avatar(who || {}, "xs")}
        <div class="bubble">
          <p>${esc(message.text)}</p>
          <time>${timeAgo(message.createdAt)}</time>
        </div>
      </div>`;
  }

  return {
    html,
    title: "Chat",
    mount(root) {
      const log = root.querySelector("#chat-log");
      const form = root.querySelector("#chat-form");
      const input = root.querySelector("#chat-input");
      const me = ctx.state.profile;

      if (!me) {
        clear(log);
        form.hidden = true;
        log.innerHTML = emptyState("🔒", "Log in to chat", "Messages are private and visible only to you two.");
        return;
      }

      async function boot() {
        try {
          if (!conversationId) {
            const handle = String(username || "").replace(/^@/, "").trim().toLowerCase();
            const found = await getProfileByUsername(handle);
            if (destroyed) return;
            if (!found) {
              form.hidden = true;
              clear(log);
              log.innerHTML = emptyState(
                "🤔",
                `@${handle || "?"} isn't on Xacheus yet`,
                "Check the handle and try again.",
                '<a class="btn btn-primary btn-sm" href="#/discover">Find creators</a>'
              );
              return;
            }
            if (found.uid === me.uid) {
              form.hidden = true;
              clear(log);
              log.innerHTML = emptyState(
                "🪞",
                "That's you",
                "Share one of your videos instead — hit Share on any post.",
                '<a class="btn btn-primary btn-sm" href="#/home">Back to feed</a>'
              );
              return;
            }
            peer = found;
            conversationId = await openConversation(me, found);
          } else {
            const meta = await getConversationMeta(conversationId);
            if (destroyed) return;
            const otherUid = (meta?.participants || []).find((id) => id !== me.uid);
            peer = otherUid ? await getProfile(otherUid).catch(() => null) : null;
          }

          if (destroyed) return;
          renderPeer();
          document.title = `${peer?.displayName || "Chat"} · Xacheus`;
          markConversationRead(conversationId, me.uid);

          unsubscribe = watchMessages(conversationId, (messages) => {
            if (destroyed) return;
            const atBottom =
              log.scrollHeight - log.scrollTop - log.clientHeight < 120 || !log.dataset.initialised;

            clear(log);
            if (!messages.length) {
              log.innerHTML = `<div class="chat-empty">No messages yet — say hello 👋</div>`;
            } else {
              log.innerHTML = messages.map((message) => bubbleHtml(message, me.uid)).join("");
            }
            log.dataset.initialised = "1";
            if (atBottom) log.scrollTop = log.scrollHeight;

            // Seen: clear my unread whenever a new message from them lands.
            const newest = messages[messages.length - 1];
            if (newest && newest.senderId !== me.uid && newest.id !== lastMarkedId) {
              lastMarkedId = newest.id;
              markConversationRead(conversationId, me.uid);
            }
          });
        } catch (error) {
          console.warn("[xacheus] chat open failed", error);
          clear(log);
          log.innerHTML = emptyState("⚠️", "Couldn't open this chat", error?.message || "Try again in a moment.");
        }
      }

      boot();

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const text = input.value.trim();
        if (!text || !conversationId) return;
        input.value = "";
        const btn = form.querySelector("button");
        btn.disabled = true;
        try {
          const otherUid =
            peer?.uid ||
            String(conversationId).split("__").find((id) => id !== me.uid) ||
            "";
          await sendDirectMessage(conversationId, me, otherUid, text);
        } catch (error) {
          toast(error?.message || "Message failed to send.", "error");
          input.value = text;
        } finally {
          btn.disabled = false;
          input.focus();
        }
      });

      setTimeout(() => input.focus(), 150);
    },
    destroy() {
      destroyed = true;
      if (unsubscribe) unsubscribe();
    },
  };
}
