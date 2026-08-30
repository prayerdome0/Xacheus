/**
 * Xacheus — Messages.
 *
 * Inbox + 1:1 threads, entirely Firestore-backed:
 *   conversations/{cid}              participants, preview, per-person unread,
 *                                    hiddenBy, typing, lastReadAt
 *   conversations/{cid}/messages/{}  text, attachment, readBy, reactions, unsent
 *
 * What is real here: presence dots and "typing…" read the presence/typing
 * documents; the double tick means the other participant wrote a `readBy`
 * stamp; attachments upload to Storage and store the download URL; unsending
 * tombstones the message for both people and deletes the file; hiding a thread
 * only changes your inbox. A single tick means "sent" — we can't observe
 * delivery from a browser, so we don't claim it.
 */

import {
  MESSAGE_REACTIONS,
  filterMessagesByTerm,
  getConversationMeta,
  getProfile,
  getProfileByUsername,
  hideConversation,
  markConversationRead,
  openConversation,
  reactToMessage,
  reportConversation,
  sendDirectMessage,
  unhideConversation,
  unsendDirectMessage,
  watchConversation,
  watchConversations,
  watchMessages,
} from "../data.js";
import {
  canMessage,
  listFollowRequests,
  setTyping,
  watchFollowRequests,
  watchPresence,
} from "../social.js";
import { uploadChatAttachment } from "../storage.js";
import { avatar, confirmDialog, copyText, emptyState, esc, fullDate, openModal, timeAgo, toast } from "../ui.js";
import { openMediaViewer } from "./mediaViewer.js";
import { playQueue } from "../player.js";
import { openReportModal } from "./components.js";

const DAY_FMT = { weekday: "short", month: "short", day: "numeric" };
const TIME_FMT = { hour: "numeric", minute: "2-digit" };

/* ------------------------------------------------------------------ */
/* inbox                                                              */
/* ------------------------------------------------------------------ */

export function messagesView(ctx) {
  const html = `
    <div class="inbox-head">
      <div class="view-head">
        <h1>Messages</h1>
        <p class="muted">Live 1:1 conversations, saved to your account — they survive a refresh and follow you between devices.</p>
      </div>
      <div class="inbox-tools">
        <input type="search" id="inbox-search" placeholder="Search chats…" autocomplete="off" />
        <button class="btn btn-primary btn-sm" type="button" data-act="new-chat">New message</button>
      </div>
    </div>
    <section class="panel request-panel" data-requests hidden></section>
    <section class="panel">
      <div class="conv-list" id="conv-list"><div class="loader-row"><span class="spinner"></span> Loading your inbox…</div></div>
    </section>
  `;

  let stopConversations = null;
  let stopRequests = null;
  let all = [];

  async function paintList(root, list, term = "") {
    const host = root.querySelector("#conv-list");
    if (!host) return;
    const query = term.trim().toLowerCase();
    const rows = await hydrateConversations(list, ctx.state.profile?.uid, query);

    if (!rows.length) {
      host.innerHTML = query
        ? emptyState("🔍", "No chats match", `Nothing in your inbox mentions “${esc(term)}”.`)
        : emptyState(
            "💬",
            "No conversations yet",
            "Open someone's profile and tap Message. Threads stay here across devices.",
            '<a class="btn btn-primary btn-sm" href="#/discover">Find people</a>'
          );
      return;
    }

    host.innerHTML = rows.map((row) => conversationRowHtml(row, ctx.state.profile?.uid)).join("");
    host.querySelectorAll("[data-conv]").forEach((row) => {
      row.addEventListener("click", (event) => {
        if (event.target.closest("[data-conv-act]")) return;
        ctx.navigate(`#/messages/${row.dataset.conv}`);
      });
    });
    host.querySelectorAll("[data-conv-act]").forEach((btn) => {
      btn.addEventListener("click", async (event) => {
        event.stopPropagation();
        const cid = btn.closest("[data-conv]").dataset.conv;
        const other = rows.find((r) => r.id === cid)?.other;
        const act = btn.dataset.convAct;
        if (act === "hide") {
          const ok = await confirmDialog({
            title: "Hide this chat?",
            body: "It leaves your inbox. The messages stay, and a new reply brings the thread back.",
            confirmLabel: "Hide",
          });
          if (!ok) return;
          await hideConversation(cid, ctx.state.profile.uid);
          toast("Chat hidden", "success");
          return;
        }
        if (act === "report") {
          openReportModal(ctx, {
            targetType: "conversation",
            targetId: cid,
            targetOwnerUid: other?.uid || "",
            targetLabel: `Conversation with @${other?.username || "user"}`,
          });
          return;
        }
        if (act === "open") {
          ctx.navigate(`#/u/${encodeURIComponent(other?.username || "")}`);
        }
      });
    });

    // Presence dots, live per visible row (one watcher each, torn down on leave).
    host.querySelectorAll("[data-conv-presence]").forEach((dot) => {
      const uid = dot.dataset.convPresence;
      if (!uid || uid === ctx.state.profile?.uid) {
        dot.remove();
        return;
      }
      const stop = watchPresence(uid, (presence) => {
        dot.className = `presence-dot ${presence.online ? "is-online" : "is-offline"}`;
        dot.title = presence.online ? "Active now" : presence.lastActiveAt ? `Active ${timeAgo(presence.lastActiveAt)}` : "Offline";
      });
      presenceStops.push(stop);
    });
  }

  const presenceStops = [];

  async function paintRequests(root) {
    const panel = root.querySelector("[data-requests]");
    if (!panel) return;
    if (!ctx.state.profile) {
      panel.hidden = true;
      return;
    }
    const requests = await listFollowRequests(ctx.state.profile.uid).catch(() => []);
    if (!requests.length) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    panel.innerHTML = `
      <header class="panel-head"><h2>Follow requests</h2><span class="chip">${requests.length}</span></header>
      <div class="request-list">${requests
        .map(
          (r) => `<div class="request-row" data-request="${esc(r.id)}">
            ${avatar(r, "md")}
            <span class="request-text"><strong>${esc(r.displayName || r.username)}</strong><em>@${esc(r.username)} · ${timeAgo(r.createdAt)}</em></span>
            <span class="request-actions">
              <button class="btn btn-sm btn-primary" type="button" data-req-act="accept">Accept</button>
              <button class="btn btn-sm btn-ghost" type="button" data-req-act="decline">Decline</button>
            </span>
          </div>`
        )
        .join("")}</div>`;
    panel.querySelectorAll("[data-req-act]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.closest("[data-request]").dataset.request;
        const request = requests.find((r) => r.id === id);
        if (!request) return;
        btn.disabled = true;
        try {
          const { acceptFollowRequest, declineFollowRequest } = await import("../social.js");
          if (btn.dataset.reqAct === "accept") {
            await acceptFollowRequest(ctx.state.profile.uid, request, { source: ctx.state.profile });
            toast(`@${request.username} now follows you`, "success");
          } else {
            await declineFollowRequest(ctx.state.profile.uid, request.uid);
            toast("Request declined", "success", 1800);
          }
          btn.closest("[data-request]").remove();
          if (!panel.querySelector(".request-row")) panel.hidden = true;
        } catch (err) {
          toast(err?.message || "Couldn't handle that request", "error");
          btn.disabled = false;
        }
      });
    });
  }

  function openNewChatModal() {
    openModal({
      title: "New message",
      size: "sm",
      body: `
        <form class="search-form" data-chat-search>
          <input type="search" placeholder="@username" data-chat-q maxlength="20" autocomplete="off" />
          <button class="btn btn-primary btn-sm" type="submit">Find</button>
        </form>
        <div class="chat-search-results" data-chat-results>
          <p class="panel-empty">Type a handle, or pick someone from your recent chats below.</p>
        </div>`,
      onMount(modal, close) {
        const results = modal.querySelector("[data-chat-results]");

        const bind = (host) => {
          host.querySelectorAll("[data-pick-user]").forEach((btn) => {
            btn.addEventListener("click", async () => {
              const target = await getProfile(btn.dataset.pickUser).catch(() => null);
              if (!target) return toast("That account is gone.", "error");
              const gate = await canMessage(target);
              if (!gate.ok) return toast(gate.reason, "error", 4200);
              try {
                const cid = await openConversation(ctx.state.profile, target);
                close();
                ctx.navigate(`#/messages/${cid}`);
              } catch (err) {
                toast(err?.message || "Couldn't open that conversation", "error");
              }
            });
          });
        };

        const recentIds = [...new Set(all.map((c) => (c.participants || []).find((u) => u !== ctx.state.profile?.uid)).filter(Boolean))];
        if (recentIds.length) {
          Promise.all(recentIds.slice(0, 6).map((uid) => getProfile(uid).catch(() => null))).then((people) => {
            const list = people.filter(Boolean);
            if (!list.length) return;
            results.innerHTML = `<p class="share-section-title">Recent chats</p>${list.map(personRow).join("")}`;
            bind(results);
          });
        }

        modal.querySelector("[data-chat-search]").addEventListener("submit", async (event) => {
          event.preventDefault();
          const term = modal.querySelector("[data-chat-q]").value.trim().replace(/^@/, "").toLowerCase();
          if (!term) return;
          results.innerHTML = `<div class="loader-row"><span class="spinner"></span> Looking up @${esc(term)}…</div>`;
          const profile = await getProfileByUsername(term).catch(() => null);
          if (!profile) {
            results.innerHTML = `<p class="panel-empty">No account uses @${esc(term)}.</p>`;
            return;
          }
          results.innerHTML = personRow(profile);
          bind(results);
        });
      },
    });
  }

  return {
    html,
    title: "Messages",
    mount(root) {
      if (!ctx.state.profile) {
        root.querySelector("#conv-list").innerHTML = emptyState(
          "🔒",
          "Sign in to chat",
          "Conversations belong to your account.",
          '<button class="btn btn-primary btn-sm" type="button" data-act="login">Log in</button>'
        );
        root.querySelector("[data-act='login']")?.addEventListener("click", () => ctx.requireAuth());
        return;
      }
      stopConversations = watchConversations(ctx.state.profile.uid, (list) => {
        all = list;
        paintList(root, list, root.querySelector("#inbox-search")?.value || "");
        const unread = list.reduce((sum, c) => sum + (Number(c.unreadCount?.[ctx.state.profile.uid]) || 0), 0);
        ctx.setMessageUnread(unread);
      });
      stopRequests = watchFollowRequests(ctx.state.profile.uid, () => paintRequests(root));
      root.querySelector("#inbox-search")?.addEventListener("input", (event) => paintList(root, all, event.target.value));
      root.querySelector('[data-act="new-chat"]')?.addEventListener("click", openNewChatModal);
      paintRequests(root);
    },
    destroy() {
      stopConversations?.();
      stopRequests?.();
      while (presenceStops.length) presenceStops.pop()?.();
    },
  };
}

function personRow(profile) {
  return `
    <button class="share-person" type="button" data-pick-user="${esc(profile.uid)}">
      ${avatar(profile, "md")}
      <span class="share-person-text">
        <strong>${esc(profile.displayName || profile.username)}</strong>
        <em>@${esc(profile.username)} · ${esc(profile.role || "user")}</em>
      </span>
      <span class="share-person-action">Message</span>
    </button>`;
}

async function hydrateConversations(list, myUid, term) {
  const rows = await Promise.all(
    (list || []).map(async (conv) => {
      const otherUid = (conv.participants || []).find((u) => u !== myUid);
      const other = otherUid ? await getProfile(otherUid).catch(() => null) : null;
      return { ...conv, myUid, otherUid, other };
    })
  );
  if (!term) return rows;
  return rows.filter((r) => `${r.other?.displayName || ""} ${r.other?.username || ""} ${r.lastMessage || ""}`.toLowerCase().includes(term));
}

function conversationRowHtml(row, myUid) {
  const other = row.other || {};
  const unread = Number(row.unreadCount?.[myUid]) || 0;
  const fromOther = row.lastSenderId && row.lastSenderId !== myUid;
  return `
    <div class="conv-row ${unread ? "is-unread" : ""}" data-conv="${esc(row.id)}">
      <div class="conv-avatar">
        ${avatar(other, "lg")}
        <span class="presence-dot" data-conv-presence="${esc(other.uid || "")}"></span>
      </div>
      <div class="conv-main">
        <div class="conv-top">
          <strong>${esc(other.displayName || other.username || "Xacheus user")}</strong>
          <span class="conv-time">${row.lastMessageAt ? timeAgo(row.lastMessageAt) : ""}</span>
        </div>
        <p class="conv-preview ${fromOther ? "is-other" : "is-mine"}">
          ${row.lastMessage ? `${fromOther ? "" : "You: "}${esc(String(row.lastMessage).slice(0, 90))}` : "<span class='muted'>No messages yet — say hello</span>"}
        </p>
        <div class="conv-meta">
          <span class="muted">@${esc(other.username || "user")}</span>
          ${unread ? `<span class="conv-badge">${unread > 99 ? "99+" : unread} new</span>` : ""}
        </div>
      </div>
      <div class="conv-actions">
        <button class="icon-btn" type="button" data-conv-act="open" title="Open profile">👤</button>
        <button class="icon-btn" type="button" data-conv-act="report" title="Report conversation">⚑</button>
        <button class="icon-btn" type="button" data-conv-act="hide" title="Hide from inbox">✕</button>
      </div>
    </div>`;
}

/* ------------------------------------------------------------------ */
/* thread                                                             */
/* ------------------------------------------------------------------ */

export function chatView(ctx, { cid = "", username = "" } = {}) {
  const html = `
    <div class="chat-shell" id="chat-shell">
      <div class="loader-row"><span class="spinner"></span> Opening conversation…</div>
    </div>
  `;

  let stopMessages = null;
  let stopConversation = null;
  let stopPresence = null;
  let typingTimer = null;
  let currentCid = cid;
  let other = null;
  let messages = [];
  let searchTerm = "";
  const cleanups = [];

  async function resolveTarget() {
    if (username) {
      const profile = await getProfileByUsername(username).catch(() => null);
      if (!profile) return null;
      const gate = await canMessage(profile);
      if (!gate.ok) return { blocked: gate.reason, needAuth: gate.needAuth, profile };
      const id = await openConversation(ctx.state.profile, profile);
      return { cid: id, profile };
    }
    const meta = await getConversationMeta(cid).catch(() => null);
    if (!meta) return null;
    const otherUid = (meta.participants || []).find((u) => u !== ctx.state.profile?.uid);
    const profile = otherUid ? await getProfile(otherUid).catch(() => null) : null;
    return { cid, profile, meta };
  }

  function renderShell(root, target) {
    const shell = root.querySelector("#chat-shell");
    if (!target) {
      shell.innerHTML = emptyState(
        "💬",
        "Conversation unavailable",
        "This thread doesn't exist, or it isn't yours.",
        '<a class="btn btn-primary btn-sm" href="#/messages">Back to inbox</a>'
      );
      return;
    }
    if (target.blocked) {
      shell.innerHTML = `<div class="chat-blocked">${emptyState(
        "🔒",
        "You can't message this account",
        target.blocked,
        target.needAuth
          ? '<button class="btn btn-primary btn-sm" type="button" data-act="login">Log in</button>'
          : '<a class="btn btn-sm btn-ghost" href="#/messages">Back to inbox</a>'
      )}</div>`;
      shell.querySelector("[data-act='login']")?.addEventListener("click", () => ctx.requireAuth());
      return;
    }
    currentCid = target.cid;
    other = target.profile;

    shell.innerHTML = `
      <header class="chat-head">
        <button class="icon-btn" type="button" data-chat="back" aria-label="Back">←</button>
        <a class="chat-head-user" href="#/u/${esc(other?.username || "")}">
          ${avatar(other, "md")}
          <span>
            <strong>${esc(other?.displayName || other?.username || "Conversation")}</strong>
            <em data-chat-status>checking…</em>
          </span>
        </a>
        <div class="chat-head-actions">
          <button class="icon-btn" type="button" data-chat="search" title="Search this conversation" aria-pressed="false">🔍</button>
          <button class="icon-btn" type="button" data-chat="info" title="Conversation options" aria-label="More">⋯</button>
        </div>
      </header>
      <div class="chat-search" data-chat-searchbar hidden>
        <input type="search" placeholder="Filter the ${300} most recent messages in this thread…" data-chat-filter />
        <span class="muted" data-chat-filter-count></span>
      </div>
      <div class="chat-log" id="chat-log" aria-live="polite">
        <div class="loader-row"><span class="spinner"></span> Loading messages…</div>
      </div>
      <div class="chat-typing" data-chat-typing hidden></div>
      <div class="chat-attach-progress" data-chat-progress hidden><div class="upload-progress-bar" data-chat-bar></div></div>
      <form class="chat-composer" id="chat-composer">
        <button class="icon-btn" type="button" data-chat="attach" title="Attach a photo, video, audio or file" aria-label="Attach">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5 12.6 20a5 5 0 0 1-7-7l8.5-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.4 8.5a1.8 1.8 0 0 1-2.5-2.5l7.8-7.8"/></svg>
        </button>
        <input type="file" hidden data-chat-file accept="image/*,video/*,audio/*,.pdf,.zip,.txt,.csv,.doc,.docx,.ppt,.pptx,.epub" />
        <textarea id="chat-input" rows="1" maxlength="1000" placeholder="Message @${esc(other?.username || "user")}…" autocomplete="off"></textarea>
        <button class="btn btn-primary btn-sm" type="submit" data-chat-send disabled>Send</button>
      </form>`;

    wireChat(shell);
  }

  function wireChat(shell) {
    const input = shell.querySelector("#chat-input");
    const send = shell.querySelector("[data-chat-send]");
    const file = shell.querySelector("[data-chat-file]");
    const myUid = ctx.state.profile.uid;

    shell.querySelector('[data-chat="back"]').addEventListener("click", () => ctx.navigate("#/messages"));
    shell.querySelector('[data-chat="info"]').addEventListener("click", () => openConversationMenu(shell));

    const searchbar = shell.querySelector("[data-chat-searchbar]");
    shell.querySelector('[data-chat="search"]').addEventListener("click", (event) => {
      const open = searchbar.hidden;
      searchbar.hidden = !open;
      event.currentTarget.setAttribute("aria-pressed", String(open));
      if (open) searchbar.querySelector("[data-chat-filter]").focus();
      else {
        searchTerm = "";
        renderMessages(shell);
      }
    });
    searchbar.querySelector("[data-chat-filter]").addEventListener("input", (event) => {
      searchTerm = event.target.value;
      renderMessages(shell);
    });

    const syncSend = () => {
      send.disabled = !input.value.trim();
      input.style.height = "auto";
      input.style.height = `${Math.min(140, input.scrollHeight)}px`;
    };
    input.addEventListener("input", () => {
      syncSend();
      setTyping(currentCid, myUid, true);
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => setTyping(currentCid, myUid, false), 2600);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        shell.querySelector("#chat-composer").requestSubmit();
      }
    });

    shell.querySelector('[data-chat="attach"]').addEventListener("click", () => file.click());
    file.addEventListener("change", () => {
      const picked = file.files?.[0];
      file.value = "";
      if (picked) uploadAttachment(shell, picked);
    });

    shell.querySelector("#chat-composer").addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      send.disabled = true;
      try {
        await sendDirectMessage(currentCid, ctx.state.profile, other?.uid, text);
        input.value = "";
        syncSend();
        setTyping(currentCid, myUid, false);
        scrollToEnd(shell, true);
      } catch (err) {
        toast(err?.message || "Couldn't send that message", "error");
        syncSend();
      }
    });

    stopMessages?.();
    stopMessages = watchMessages(currentCid, (rows) => {
      messages = rows;
      renderMessages(shell);
      const hasUnreadForMe = rows.some((m) => m.senderId !== myUid && !m.unsent && !m.readBy?.[myUid]);
      if (hasUnreadForMe && document.hasFocus()) {
        markConversationRead(currentCid, myUid).catch(() => {});
      }
    });

    stopConversation?.();
    stopConversation = watchConversation(currentCid, (conv) => {
      if (!conv) return;
      const typingNode = shell.querySelector("[data-chat-typing]");
      const typing = isTypingNow(conv, myUid);
      typingNode.hidden = !typing;
      if (typing) typingNode.innerHTML = `<span class="typing-dots"><i></i><i></i><i></i></span> @${esc(other?.username || "someone")} is typing…`;
    });

    if (other?.uid) {
      stopPresence?.();
      const status = shell.querySelector("[data-chat-status]");
      stopPresence = watchPresence(other.uid, (presence) => {
        status.textContent = presence.online ? "Active now" : presence.lastActiveAt ? `Active ${timeAgo(presence.lastActiveAt)}` : "Offline";
        status.classList.toggle("is-online", presence.online);
      });
    }

    shell.addEventListener("click", async (event) => {
      const btn = event.target.closest("[data-msg-act]");
      if (!btn) return;
      event.preventDefault();
      const id = btn.closest("[data-msg]")?.dataset.msg;
      const message = messages.find((m) => m.id === id);
      if (!message) return;
      await handleBubbleAction(shell, message, btn.dataset.msgAct, btn.dataset.emoji);
    });

    const onFocus = () => markConversationRead(currentCid, myUid).catch(() => {});
    window.addEventListener("focus", onFocus);
    cleanups.push(() => window.removeEventListener("focus", onFocus));

    input.focus();
  }

  async function handleBubbleAction(shell, message, act, emoji) {
    const myUid = ctx.state.profile?.uid;
    if (act === "react") {
      if (!myUid) return ctx.requireAuth();
      try {
        await reactToMessage(currentCid, myUid, message.id, emoji);
        // The message snapshot repaints the chips.
      } catch (err) {
        toast(err?.message || "Couldn't save that reaction", "error");
      }
      return;
    }
    if (act === "menu") {
      openBubbleMenu(shell, message);
      return;
    }
    if (act === "expand") {
      openMediaViewer(ctx, `chat_${message.id}`, {
        list: [],
        media: {
          id: `chat_${message.id}`,
          synthetic: true,
          kind: "photo",
          url: message.attachment.url,
          caption: message.text || "",
          uid: message.senderId,
          username: other?.username || message.senderUsername,
          displayName: message.senderName || other?.displayName,
          createdAt: message.createdAt,
          likeCount: 0,
          commentCount: 0,
          viewCount: 0,
          shareCount: 0,
          reactions: {},
        },
      });
      return;
    }
    if (act === "play-audio") {
      playQueue([
        {
          id: `chat_${message.id}`,
          title: message.attachment.name || "Voice message",
          artist: `@${message.senderUsername || "xacheus"}`,
          audioUrl: message.attachment.url,
          duration: message.attachment.duration || 0,
          source: "xacheus",
        },
      ]);
      return;
    }
    if (act === "download") {
      window.open(message.attachment.url, "_blank", "noopener");
      return;
    }
    if (act === "copy") {
      copyText(message.text || "");
      return;
    }
    if (act === "unsend") {
      const ok = await confirmDialog({
        title: "Unsend message?",
        body: "Both of you will see “Message unsent”, and any attachment is deleted from storage.",
        confirmLabel: "Unsend",
        danger: true,
      });
      if (!ok) return;
      try {
        await unsendDirectMessage(currentCid, myUid, message.id);
        toast("Message unsent", "success");
      } catch (err) {
        toast(err?.message || "Couldn't unsend that", "error");
      }
    }
  }

  function openBubbleMenu(shell, message) {
    const mine = message.senderId === ctx.state.profile?.uid;
    openModal({
      title: "Message",
      size: "sm",
      body: `
        <div class="menu-list">
          ${MESSAGE_REACTIONS.map((e) => `<button class="menu-item" type="button" data-bubble-act="react" data-emoji="${e}">React ${e}</button>`).join("")}
          ${message.text ? `<button class="menu-item" type="button" data-bubble-act="copy">Copy text</button>` : ""}
          ${message.attachment ? `<button class="menu-item" type="button" data-bubble-act="download">Open attachment</button>` : ""}
          ${mine && !message.unsent ? `<button class="menu-item danger" type="button" data-bubble-act="unsend">Unsend</button>` : ""}
          ${!mine ? `<button class="menu-item danger" type="button" data-bubble-act="report">Report message</button>` : ""}
        </div>`,
      onMount(modal, close) {
        modal.addEventListener("click", async (event) => {
          const btn = event.target.closest("[data-bubble-act]");
          if (!btn) return;
          close();
          if (btn.dataset.bubbleAct === "report") {
            try {
              await reportConversation(currentCid, ctx.state.profile, "Harassment", (message.text || "").slice(0, 400), other?.uid || "");
              toast("Reported to moderation", "success", 2600);
            } catch (err) {
              toast(err?.message || "Could not submit report", "error");
            }
            return;
          }
          await handleBubbleAction(shell, message, btn.dataset.bubbleAct, btn.dataset.emoji);
        });
      },
    });
  }

  async function uploadAttachment(shell, file) {
    if (file.size > 30 * 1024 * 1024) {
      toast("Attachments must be under 30 MB.", "error");
      return;
    }
    const progress = shell.querySelector("[data-chat-progress]");
    const bar = shell.querySelector("[data-chat-bar]");
    progress.hidden = false;
    bar.style.width = "4%";
    try {
      const uploaded = await uploadChatAttachment(file, { onProgress: (pct) => (bar.style.width = `${Math.max(4, pct)}%`) });
      const input = shell.querySelector("#chat-input");
      await sendDirectMessage(currentCid, ctx.state.profile, other?.uid, input.value.trim(), uploaded);
      input.value = "";
      scrollToEnd(shell, true);
    } catch (err) {
      toast(err?.message || "Upload failed", "error");
    } finally {
      progress.hidden = true;
      bar.style.width = "0%";
    }
  }

  function renderMessages(shell) {
    const log = shell.querySelector("#chat-log");
    if (!log) return;
    const rows = searchTerm.trim() ? filterMessagesByTerm(messages, searchTerm) : messages;
    const countNode = shell.querySelector("[data-chat-filter-count]");
    if (countNode) countNode.textContent = searchTerm.trim() ? `${rows.length} of ${messages.length}` : "";

    if (!rows.length) {
      log.innerHTML = searchTerm.trim()
        ? `<p class="panel-empty">No message in this thread matches “${esc(searchTerm)}” (searching the ${messages.length} most recent).</p>`
        : `<div class="chat-empty">
             <strong>No messages yet</strong>
             <p>Say hello — @${esc(other?.username || "this person")} gets a notification unless they muted messages.</p>
           </div>`;
      return;
    }

    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 180;
    log.innerHTML = rows.map((m, i) => bubbleHtml(m, rows[i - 1], ctx.state.profile?.uid)).join("");
    if (nearBottom || rows.length >= messages.length) scrollToEnd(shell, true);
  }

  function openConversationMenu(shell) {
    openModal({
      title: `@${other?.username || "conversation"}`,
      size: "sm",
      body: `
        <div class="menu-list">
          <a class="menu-item" href="#/u/${esc(other?.username || "")}">View profile</a>
          <button class="menu-item" type="button" data-conv-menu="unhide">Show this chat in my inbox</button>
          <button class="menu-item" type="button" data-conv-menu="hide">Hide conversation</button>
          <button class="menu-item" type="button" data-conv-menu="report">Report conversation</button>
          <button class="menu-item danger" type="button" data-conv-menu="block">Block @${esc(other?.username || "user")}</button>
        </div>`,
      onMount(modal, close) {
        modal.addEventListener("click", async (event) => {
          const btn = event.target.closest("[data-conv-menu]");
          if (!btn) return;
          const action = btn.dataset.convMenu;
          if (action === "unhide") {
            await unhideConversation(currentCid, ctx.state.profile.uid);
            toast("Conversation restored to your inbox", "success");
            close();
            return;
          }
          if (action === "hide") {
            await hideConversation(currentCid, ctx.state.profile.uid);
            close();
            ctx.navigate("#/messages");
            return;
          }
          if (action === "report") {
            close();
            openReportModal(ctx, {
              targetType: "conversation",
              targetId: currentCid,
              targetOwnerUid: other?.uid || "",
              targetLabel: `Conversation with @${other?.username || "user"}`,
            });
            return;
          }
          if (action === "block") {
            const ok = await confirmDialog({
              title: `Block @${other?.username || "user"}?`,
              body: "Neither of you can message, follow or comment on the other's content. Unblock any time from Settings.",
              confirmLabel: "Block",
              danger: true,
            });
            if (!ok) return;
            try {
              const { blockUser } = await import("../social.js");
              await blockUser(ctx.state.profile.uid, other);
              toast(`Blocked @${other?.username}`, "success");
              close();
              ctx.navigate("#/messages");
            } catch (err) {
              toast(err?.message || "Could not block that account", "error");
            }
          }
        });
      },
    });
    void shell;
  }

  return {
    html,
    title: "Chat",
    async mount(root) {
      if (!ctx.state.profile) {
        root.querySelector("#chat-shell").innerHTML = emptyState(
          "🔒",
          "Sign in to message",
          "Conversations belong to your account.",
          '<button class="btn btn-primary btn-sm" type="button" data-act="login">Log in</button>'
        );
        root.querySelector("[data-act='login']")?.addEventListener("click", () => ctx.requireAuth());
        return;
      }
      const target = await resolveTarget();
      renderShell(root, target);
      if (target?.cid) markConversationRead(target.cid, ctx.state.profile.uid).catch(() => {});
    },
    destroy() {
      stopMessages?.();
      stopConversation?.();
      stopPresence?.();
      clearTimeout(typingTimer);
      if (currentCid && ctx.state.profile?.uid) setTyping(currentCid, ctx.state.profile.uid, false);
      while (cleanups.length) cleanups.pop()?.();
    },
  };
}

/* ------------------------------------------------------------------ */
/* bubbles                                                            */
/* ------------------------------------------------------------------ */

function bubbleHtml(message, previous, myUid) {
  const mine = message.senderId === myUid;
  const grouped = previous && previous.senderId === message.senderId && stamp(message.createdAt) - stamp(previous.createdAt) < 5 * 60 * 1000;
  const att = message.attachment || null;
  const otherUid = mine ? Object.keys(message.readBy || {}).find((uid) => uid !== message.senderId) : "";
  const reactions = Object.entries(message.reactions || {}).filter(([, emoji]) => emoji);
  const unsent = Boolean(message.unsent);

  return `
  <div class="msg-row ${mine ? "is-mine" : "is-other"} ${grouped ? "is-grouped" : ""}" data-msg="${esc(message.id)}">
    <span class="msg-avatar">${!grouped && !mine ? avatar({ username: message.senderUsername, photoURL: message.senderPhoto }, "xs") : ""}</span>
    <div class="msg-body">
      ${!grouped ? `<div class="msg-day">${new Date(stamp(message.createdAt)).toLocaleDateString(undefined, DAY_FMT)} · ${new Date(stamp(message.createdAt)).toLocaleTimeString(undefined, TIME_FMT)}</div>` : ""}
      <div class="bubble ${att ? `has-attachment kind-${att.kind}` : ""} ${unsent ? "is-unsent" : ""}">
        ${unsent ? `<p class="msg-unsent">Message unsent${message.unsentAt ? ` · ${timeAgo(message.unsentAt)}` : ""}</p>` : att ? attachmentHtml(att) : ""}
        ${!unsent && message.text ? `<p>${esc(message.text)}</p>` : ""}
        ${reactions.length ? reactionChips(reactions, myUid) : ""}
        <div class="msg-foot">
          <span class="msg-time">${new Date(stamp(message.createdAt)).toLocaleTimeString(undefined, TIME_FMT)}</span>
          ${mine ? (otherUid ? `<span class="msg-read" title="Read ${esc(fullDate(message.readBy?.[otherUid]) || "")}">✓✓ read</span>` : `<span class="msg-sent" title="Sent">✓</span>`) : ""}
          ${unsent ? "" : `
            <button class="msg-more" type="button" data-msg-act="react" data-emoji="❤️" title="Love">❤</button>
            <button class="msg-more" type="button" data-msg-act="menu" aria-label="Message options">⋯</button>`}
        </div>
      </div>
    </div>
  </div>`;
}

function reactionChips(reactions, myUid) {
  const counts = new Map();
  for (const [uid, emoji] of reactions) {
    const entry = counts.get(emoji) || { n: 0, mine: false };
    entry.n += 1;
    if (uid === myUid) entry.mine = true;
    counts.set(emoji, entry);
  }
  return `<div class="msg-reactions">${[...counts.entries()]
    .map(([emoji, entry]) => `<span class="msg-reaction ${entry.mine ? "is-mine" : ""}">${emoji}<em>${entry.n > 1 ? entry.n : ""}</em></span>`)
    .join("")}</div>`;
}

function attachmentHtml(att) {
  const url = String(att.url || "");
  if (att.kind === "image") {
    return `<button class="msg-att msg-att-image" type="button" data-msg-act="expand"><img src="${esc(url)}" alt="${esc(att.name || "Photo")}" loading="lazy" /></button>`;
  }
  if (att.kind === "video") {
    return `<video class="msg-att msg-att-video" src="${esc(url)}" controls playsinline preload="metadata"></video>`;
  }
  if (att.kind === "audio") {
    return `<div class="msg-att msg-att-audio"><audio src="${esc(url)}" controls preload="metadata"></audio>${att.duration ? `<em>${Math.round(att.duration)}s</em>` : ""}</div>`;
  }
  return `
    <button class="msg-att msg-att-file" type="button" data-msg-act="download">
      <span class="msg-att-icon">📎</span>
      <span class="msg-att-text">
        <strong>${esc(att.name || "Attachment")}</strong>
        <em>${att.size ? `${Math.max(1, Math.round(att.size / 1024))} KB` : "file"}${att.mimeType ? ` · ${esc(att.mimeType)}` : ""}</em>
      </span>
      <span class="msg-att-open">Open</span>
    </button>`;
}

function isTypingNow(conversation, myUid) {
  const typing = conversation?.typing || {};
  return Object.keys(typing).some((uid) => uid !== myUid && stamp(typing[uid]) && Date.now() - stamp(typing[uid]) < 7000);
}

function stamp(value) {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (value.toMillis) return value.toMillis();
  if (value.seconds) return value.seconds * 1000;
  return Date.parse(String(value)) || 0;
}

function scrollToEnd(shell, force = false) {
  const log = shell.querySelector("#chat-log");
  if (!log) return;
  const close = log.scrollHeight - log.scrollTop - log.clientHeight < 300;
  if (force || close) requestAnimationFrame(() => (log.scrollTop = log.scrollHeight));
}
