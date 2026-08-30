/**
 * Xacheus — Inbox (notifications).
 *
 * Reads `notifications` (one doc per event, written by the actor's client
 * inside the same batch as the like/follow/comment itself) and lets you filter
 * by category, open the thing referenced, accept or decline a follow request
 * without leaving the list, mark everything read, and delete single items.
 * Nothing here is synthetic: if you have no notifications the list is empty.
 */

import { markNotificationsRead, setNotificationRead, watchNotifications } from "../data.js";
import { acceptFollowRequest, deleteNotification, declineFollowRequest } from "../social.js";
import { avatar, confirmDialog, emptyState, esc, timeAgo, toast } from "../ui.js";

const ICONS = {
  like: "❤️",
  reaction: "😊",
  comment: "💬",
  reply: "💭",
  follow: "👤",
  followRequest: "🔒",
  followAccepted: "✅",
  mention: "✳️",
  repost: "🔁",
  message: "✉️",
  gift: "🎁",
  live: "🔴",
  mediaLike: "🖼️",
  mediaComment: "📝",
  story: "⏱️",
};

const COPY = {
  like: "liked your post",
  reaction: "reacted to your post",
  comment: "commented on your post",
  reply: "replied to your comment",
  follow: "started following you",
  followRequest: "asked to follow you",
  followAccepted: "accepted your follow request",
  mention: "mentioned you",
  repost: "reposted your post",
  message: "sent you a message",
  gift: "sent you a gift on live",
  live: "went live",
  mediaLike: "reacted to your photo",
  mediaComment: "commented on your photo",
  story: "replied to your story",
};

const FILTERS = [
  { id: "all", label: "All", types: null },
  { id: "reactions", label: "Reactions", types: ["like", "reaction", "mediaLike"] },
  { id: "comments", label: "Comments", types: ["comment", "reply", "mediaComment"] },
  { id: "follows", label: "Followers", types: ["follow", "followRequest", "followAccepted"] },
  { id: "mentions", label: "Mentions & reposts", types: ["mention", "repost"] },
  { id: "messages", label: "Messages", types: ["message", "story"] },
  { id: "live", label: "Live", types: ["gift", "live"] },
];

export function notificationsView(ctx) {
  let unsubscribe = null;
  let allItems = [];
  let filter = "all";

  const html = `
    <div class="view-head notif-head">
      <div>
        <h1>Inbox</h1>
        <p class="muted">Everything people did to your content. Read state is saved to your account.</p>
      </div>
      <div class="notif-tools">
        <button class="btn btn-ghost btn-sm" type="button" data-act="read-all">Mark all read</button>
        <a class="btn btn-outline btn-sm" href="#/messages">Open messages</a>
      </div>
    </div>
    <nav class="tabs notif-tabs" role="tablist">
      ${FILTERS.map((f) => `<button class="tab ${f.id === filter ? "is-active" : ""}" type="button" data-filter="${f.id}">${f.label}<span class="tab-badge" data-badge="${f.id}" hidden></span></button>`).join("")}
    </nav>
    <div class="notif-list" id="notif-list" aria-live="polite">
      <div class="loader-row"><span class="spinner"></span> Loading…</div>
    </div>
  `;

  function href(item) {
    if (item.cid) return `#/messages/${item.cid}`;
    if (item.mediaId) {
      const handle = item.fromUsername && item.type === "story" ? item.fromUsername : item.ownerUsername || "";
      return handle ? `#/u/${encodeURIComponent(handle)}?media=${encodeURIComponent(item.mediaId)}` : `#/media/${encodeURIComponent(item.mediaId)}`;
    }
    if (item.videoId) return `#/video/${encodeURIComponent(item.videoId)}`;
    if (item.commentId && item.videoId) return `#/video/${encodeURIComponent(item.videoId)}`;
    if (item.liveId) return `#/live/${encodeURIComponent(item.liveId)}`;
    if (item.type === "follow" || item.type === "followRequest" || item.type === "followAccepted") {
      return item.fromUsername ? `#/u/${encodeURIComponent(item.fromUsername)}` : "";
    }
    if (item.tag) return `#/tag/${encodeURIComponent(item.tag)}`;
    return item.fromUsername ? `#/u/${encodeURIComponent(item.fromUsername)}` : "";
  }

  function paintBadges() {
    for (const f of FILTERS) {
      const node = document.querySelector(`[data-badge="${f.id}"]`);
      if (!node) continue;
      const rows = f.types ? allItems.filter((i) => f.types.includes(i.type) && !i.read) : allItems.filter((i) => !i.read);
      node.hidden = rows.length === 0;
      node.textContent = String(rows.length > 99 ? "99+" : rows.length);
    }
    ctx.setNotificationCount(allItems.filter((i) => !i.read).length);
  }

  function render(root) {
    const list = root.querySelector("#notif-list");
    if (!list) return;
    const active = FILTERS.find((f) => f.id === filter) || FILTERS[0];
    const items = active.types ? allItems.filter((i) => active.types.includes(i.type)) : allItems;

    if (!items.length) {
      list.innerHTML = emptyState(
        "🔔",
        allItems.length ? `No ${active.label.toLowerCase()} yet` : "Nothing here yet",
        allItems.length
          ? "Try another tab above."
          : "Likes, comments, follows, reposts, messages and story replies land here the moment they happen.",
        '<a class="btn btn-primary btn-sm" href="#/discover">Find people to follow</a>'
      );
      paintBadges();
      return;
    }

    list.innerHTML = items
      .map((item) => {
        const link = href(item);
        const user = { username: item.fromUsername, displayName: item.fromName, photoURL: item.fromPhoto };
        const when = timeAgo(item.createdAt);
        const isRequest = item.type === "followRequest";
        return `
        <a class="notif ${item.read ? "" : "is-unread"}" href="${link ? esc(link) : "javascript:void(0)"}" data-id="${esc(item.id)}" ${link ? "" : 'aria-disabled="true"'}>
          <span class="notif-kind">
            <span class="notif-icon" aria-hidden="true">${ICONS[item.type] || "🔔"}</span>
            <em>${esc(COPY[item.type] || "interacted with you")}</em>
          </span>
          <span class="notif-avatar">${avatar(user, "md")}</span>
          <span class="notif-body">
            <strong>${esc(item.fromName || item.fromUsername || "Someone")}</strong>
            <em>@${esc(item.fromUsername || "user")} · ${esc(when)}</em>
            ${item.text ? `<span class="notif-quote">${esc(item.text)}</span>` : ""}
            ${item.thumbnailUrl ? `<img class="notif-thumb" src="${esc(item.thumbnailUrl)}" alt="" loading="lazy" />` : ""}
          </span>
          <span class="notif-side">
            ${isRequest ? `<span class="notif-request" data-request-row><button class="btn btn-sm btn-primary" type="button" data-req="accept">Accept</button><button class="btn btn-sm btn-ghost" type="button" data-req="decline">Decline</button></span>` : ""}
            <button class="icon-btn" type="button" data-act="toggle-read" title="${item.read ? "Mark as unread" : "Mark as read"}" aria-label="${item.read ? "Mark as unread" : "Mark as read"}">${item.read ? "◌" : "●"}</button>
            <button class="icon-btn" type="button" data-act="delete-notif" title="Delete" aria-label="Delete notification">🗑</button>
          </span>
          <span class="notif-flag" ${item.read ? "hidden" : ""} title="Unread"></span>
        </a>`;
      })
      .join("");

    items.forEach((item, i) => {
      const node = list.querySelectorAll(".notif")[i];
      if (!node) return;
      node.addEventListener("click", (event) => {
        if (event.target.closest("[data-req],[data-act]")) event.preventDefault();
      });
      node.querySelectorAll("[data-req]").forEach((btn) => {
        btn.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          await handleRequest(btn.dataset.req, item, node);
        });
      });
      node.querySelector('[data-act="toggle-read"]').addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const next = !item.read;
        // Paint straight away: the bell badge and the unread dot follow the
        // same local state, so the toggle feels instant and the snapshot
        // confirms it a moment later.
        item.read = next;
        node.classList.toggle("is-unread", !next);
        node.querySelector(".notif-flag").hidden = next;
        const btn = node.querySelector('[data-act="toggle-read"]');
        btn.textContent = next ? "◌" : "●";
        btn.title = next ? "Mark as unread" : "Mark as read";
        btn.setAttribute("aria-label", btn.title);
        paintBadges();
        try {
          await setNotificationRead(ctx.state.profile.uid, item.id, next);
        } catch (err) {
          item.read = !next;
          toast(err?.message || "Could not update that", "error");
          render(root);
        }
      });
      node.querySelector('[data-act="delete-notif"]').addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const ok = await confirmDialog({ title: "Delete this notification?", body: "It is removed from your inbox only — nothing else changes.", confirmLabel: "Delete", danger: true });
        if (!ok) return;
        try {
          await deleteNotification(ctx.state.profile.uid, item.id);
          allItems = allItems.filter((r) => r.id !== item.id);
          render(root);
        } catch (err) {
          toast(err?.message || "Could not delete that", "error");
        }
      });
      // Opening a notification marks it read (only when it actually navigates).
      if (!item.read && link) {
        node.addEventListener("click", () => {
          markNotificationsRead(ctx.state.profile?.uid, [item]).catch(() => {});
        });
      }
    });
    paintBadges();
  }

  async function handleRequest(action, item, node) {
    if (!ctx.state.profile) return ctx.requireAuth();
    const buttons = [...node.querySelectorAll("[data-req]")];
    buttons.forEach((b) => (b.disabled = true));
    try {
      if (action === "accept") {
        await acceptFollowRequest(ctx.state.profile.uid, { uid: item.fromUid, username: item.fromUsername, displayName: item.fromName }, { source: ctx.state.profile });
        toast(`@${item.fromUsername} now follows you`, "success");
      } else {
        await declineFollowRequest(ctx.state.profile.uid, item.fromUid);
        toast("Request declined", "success", 1800);
      }
      node.closest(".notif").classList.add("is-resolved");
      node.querySelectorAll("[data-req]").forEach((b) => b.remove());
      window.dispatchEvent(new CustomEvent("xacheus:follow-changed", { detail: { uid: item.fromUid } }));
    } catch (err) {
      toast(err?.message || "Could not handle that request", "error");
      buttons.forEach((b) => (b.disabled = false));
    }
  }

  return {
    html,
    title: "Inbox",
    mount(root) {
      if (!ctx.state.profile) {
        root.querySelector("#notif-list").innerHTML = emptyState("🔒", "Sign in to see your inbox", "Notifications are tied to your account.");
        return;
      }
      root.querySelectorAll("[data-filter]").forEach((btn) => {
        btn.addEventListener("click", () => {
          filter = btn.dataset.filter;
          root.querySelectorAll("[data-filter]").forEach((b) => b.classList.toggle("is-active", b === btn));
          render(root);
        });
      });
      root.querySelector('[data-act="read-all"]').addEventListener("click", async () => {
        const unread = allItems.filter((i) => !i.read);
        if (!unread.length) return toast("Nothing unread", "info", 1600);
        try {
          await markNotificationsRead(ctx.state.profile.uid, unread);
          toast(`${unread.length} marked read`, "success", 1800);
        } catch (err) {
          toast(err?.message || "Could not update your inbox", "error");
        }
      });
      unsubscribe = watchNotifications(ctx.state.profile.uid, (rows) => {
        allItems = rows;
        render(root);
      });
    },
    destroy() {
      unsubscribe?.();
      ctx.setNotificationCount(allItems.filter((i) => !i.read).length);
    },
  };
}
