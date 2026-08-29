/** Xacheus Social — Direct messages. */

import {
  conversationId,
  getProfileByUsername,
  markConversationRead,
  openConversation,
  sendMessage,
  watchConversations,
  watchMessages,
} from "../data.js";
import { avatar, clear, emptyState, esc, timeAgo, toast } from "../ui.js";

/* ------------------------------------------------------------------ */
/* inbox                                                               */
/* ------------------------------------------------------------------ */

export function messagesView(ctx) {
  let unsubscribe = null;
  let destroyed = false;

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

  function otherOf(conversation, uid) {
    const otherId = (conversation.participants || []).find((id) => id !== uid);
    return conversation.info?.[otherId] || { displayName: "Xacheus user", username: otherId, photoURL: "" };
  }

  function render(root, conversations, filter = "") {
    const list = root.querySelector("#conv-list");
    if (!list || destroyed) return;
    const me = ctx.state.profile?.uid;
    const term = filter.trim().toLowerCase();

    const rows = conversations
      .map((conversation) => ({ conversation, other: otherOf(conversation, me) }))
      .filter(({ other }) =>
        !term
          ? true
          : `${other.displayName} ${other.username}`.toLowerCase().includes(term)
      );

    clear(list);
    if (!rows.length) {
      list.innerHTML = emptyState(
        "✉️",
        term ? "No conversations match" : "No messages yet",
        term ? "Try a different name." : "Open someone's profile and tap Message to start a chat.",
        '<a class="btn btn-primary btn-sm" href="#/explore">Find someone to message</a>'
      );
      return;
    }

    list.innerHTML = rows
      .map(({ conversation, other }) => {
        const unread = conversation.unread?.[me] || 0;
        return `
        <a class="conv ${unread ? "is-unread" : ""}" href="#/messages/${esc(conversation.id)}">
          ${avatar(other, "md")}
          <span class="conv-body">
            <span class="conv-top">
              <strong>${esc(other.displayName || "Xacheus user")}</strong>
              <em>${timeAgo(conversation.lastMessageAt)}</em>
            </span>
            <span class="conv-preview">${esc(conversation.lastMessage || "Say hello 👋")}</span>
          </span>
          ${unread ? `<span class="badge-count">${unread > 9 ? "9+" : unread}</span>` : ""}
        </a>`;
      })
      .join("");

    ctx.setMessageUnread(
      conversations.reduce((total, conversation) => total + (conversation.unread?.[me] || 0), 0)
    );
  }

  return {
    html,
    title: "Messages",
    mount(root) {
      if (!ctx.state.profile) {
        const list = root.querySelector("#conv-list");
        clear(list);
        list.innerHTML = emptyState(
          "🔒",
          "Log in to use messages",
          "Direct messages are private 1:1 chats that update in real time."
        );
        return;
      }

      let filter = "";
      root.querySelector("#conv-filter").addEventListener("input", (event) => {
        filter = event.target.value;
        root.dispatchEvent(new CustomEvent("refilter"));
      });

      unsubscribe = watchConversations(ctx.state.profile.uid, (conversations) => {
        render(root, conversations, filter);
        root.dataset.convCount = String(conversations.length);
      });

      root.addEventListener("refilter", () => {
        // Re-render cached conversations with the new filter.
        root.querySelectorAll(".conv").forEach((node) => {
          const text = node.textContent.toLowerCase();
          node.style.display = !filter || text.includes(filter.toLowerCase()) ? "" : "none";
        });
      });

      root.querySelector('[data-act="new"]').addEventListener("click", () => {
        const username = window.prompt("Who do you want to message? Enter their @handle.");
        if (!username) return;
        getProfileByUsername(username)
          .then((profile) => {
            if (!profile) return toast(`No one uses @${username.replace(/^@/, "")} yet.`, "error");
            return openConversation(ctx.state.profile, profile).then((cid) =>
              ctx.navigate(`#/messages/${cid}`)
            );
          })
          .catch(() => toast("Could not start that conversation.", "error"));
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

export function conversationView(ctx, params) {
  let unsubscribe = null;
  let destroyed = false;
  const cid = params.cid;

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

  async function renderPeer(root) {
    const peer = document.querySelector("#chat-peer");
    if (!peer) return;
    const conversation = await ctx.loadConversation(cid);
    const otherId = (conversation?.participants || []).find((id) => id !== ctx.state.profile.uid);
    const info = conversation?.info?.[otherId] || {};
    peer.innerHTML = `
      <a href="#/u/${esc(info.username || otherId)}">
        ${avatar(info, "sm")}
        <span>
          <strong>${esc(info.displayName || "Xacheus user")}</strong>
          <em>@${esc(info.username || "user")}</em>
        </span>
      </a>`;
  }

  return {
    html,
    title: "Conversation",
    mount(root) {
      const log = root.querySelector("#chat-log");
      const form = root.querySelector("#chat-form");
      const input = root.querySelector("#chat-input");

      if (!ctx.state.profile) {
        clear(log);
        log.innerHTML = emptyState("🔒", "Log in to chat", "Messages are private and end-to-end visible only to you two.");
        return;
      }

      renderPeer(root);
      markConversationRead(cid, ctx.state.profile.uid).catch(() => {});

      unsubscribe = watchMessages(cid, (messages) => {
        if (destroyed) return;
        const atBottom =
          log.scrollHeight - log.scrollTop - log.clientHeight < 120 || !log.dataset.initialised;

        clear(log);
        if (!messages.length) {
          log.innerHTML = `<div class="chat-empty">No messages yet — say hello 👋</div>`;
        } else {
          log.innerHTML = messages
            .map((message) => {
              const mine = message.senderId === ctx.state.profile.uid;
              return `
              <div class="bubble-row ${mine ? "is-mine" : ""}">
                ${mine ? "" : avatar({ username: message.senderId, displayName: "User" }, "xs")}
                <div class="bubble">
                  <p>${esc(message.text)}</p>
                  <time>${timeAgo(message.createdAt)}</time>
                </div>
              </div>`;
            })
            .join("");
        }

        log.dataset.initialised = "1";
        if (atBottom) log.scrollTop = log.scrollHeight;
      });

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        input.value = "";
        try {
          const conversation = await ctx.loadConversation(cid);
          const recipients = conversation?.participants || [];
          await sendMessage(cid, ctx.state.profile, recipients, text);
          const log2 = root.querySelector("#chat-log");
          if (log2) log2.scrollTop = log2.scrollHeight;
        } catch (error) {
          toast(error?.message || "Message failed to send.", "error");
          input.value = text;
        }
      });

      setTimeout(() => input.focus(), 120);
    },
    destroy() {
      destroyed = true;
      if (unsubscribe) unsubscribe();
    },
  };
}

export { conversationId };
