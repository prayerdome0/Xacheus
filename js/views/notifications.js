/** Xacheus — Notifications (video platform) */

import { markNotificationsRead, watchNotifications } from "../data.js";
import { avatar, clear, emptyState, esc, timeAgo } from "../ui.js";

const ICONS = {
  like: "❤️",
  comment: "💬",
  follow: "👤",
  mention: "✳️",
  repost: "🔁",
  message: "✉️",
};

const COPY = {
  like: "liked your video",
  comment: "commented on your video",
  follow: "started following you",
  mention: "mentioned you in a video",
  repost: "reposted your video",
  message: "sent you a message",
};

export function notificationsView(ctx) {
  let unsubscribe = null;
  let destroyed = false;

  const html = `
    <div class="view-head">
      <h1>Inbox</h1>
      <button class="link-btn" type="button" data-act="read-all">Mark all read</button>
    </div>
    <div class="tabs" role="tablist">
      <button class="tab is-active" data-tab="all">All</button>
      <button class="tab" data-tab="likes">Likes</button>
      <button class="tab" data-tab="comments">Comments</button>
      <button class="tab" data-tab="follows">Follows</button>
    </div>
    <div class="notif-list" id="notif-list" aria-live="polite">
      <div class="loader-row"><span class="spinner"></span> Loading…</div>
    </div>`;

  let allItems = [];
  let currentTab = "all";

  function render(root, items) {
    const list = root.querySelector("#notif-list");
    if (!list) return;
    clear(list);

    let filtered = items;
    if (currentTab !== "all") {
      const map = { likes: "like", comments: "comment", follows: "follow" };
      filtered = items.filter((i) => i.type === map[currentTab]);
    }

    if (!filtered.length) {
      list.innerHTML = emptyState(
        "🔔",
        currentTab === "all" ? "Nothing here yet" : `No ${currentTab} yet`,
        "When someone likes, comments, follows or mentions you, it shows up here."
      );
      return;
    }

    list.innerHTML = filtered
      .map((item) => {
        const href = notificationHref(item);
        const user = { username: item.fromUsername, displayName: item.fromName, photoURL: item.fromPhoto };
        return `
        <a class="notif ${item.read ? "" : "is-unread"}" href="${esc(href)}" data-id="${esc(item.id)}">
          <span class="notif-icon" aria-hidden="true">${ICONS[item.type] || "🔔"}</span>
          <span class="notif-avatar">${avatar(user, "md")}</span>
          <span class="notif-body">
            <strong>${esc(item.fromName || "Someone")}</strong> ${esc(COPY[item.type] || "interacted with you")}
            ${item.text ? `<em class="notif-quote">${esc(item.text)}</em>` : ""}
            <span class="notif-time">${timeAgo(item.createdAt)}</span>
          </span>
        </a>`;
      })
      .join("");

    const unread = items.filter((item) => !item.read);
    if (unread.length) {
      setTimeout(() => markNotificationsRead(ctx.state.profile.uid, unread).catch(() => {}), 1500);
    }
  }

  function notificationHref(item) {
    if (item.type === "follow" || item.type === "message") return `#/u/${item.fromUsername || item.fromUid}`;
    if (item.videoId) return `#/video/${item.videoId}`;
    if (item.postId) return `#/video/${item.postId}`;
    return `#/u/${item.fromUsername || item.fromUid}`;
  }

  return {
    html,
    title: "Inbox",
    mount(root) {
      const list = root.querySelector("#notif-list");
      clear(list);
      list.innerHTML = `<div class="loader-row"><span class="spinner"></span> Loading…</div>`;

      if (!ctx.state.profile) {
        list.innerHTML = emptyState("🔒", "Log in to see inbox", "Your likes, comments and follows live here once you're signed in.");
        return;
      }

      unsubscribe = watchNotifications(ctx.state.profile.uid, (items) => {
        if (destroyed) return;
        allItems = items;
        render(root, items);
        ctx.setNotificationCount(items.filter((item) => !item.read).length);
      });

      root.addEventListener("click", (event) => {
        const tabBtn = event.target.closest("[data-tab]");
        if (tabBtn) {
          currentTab = tabBtn.dataset.tab;
          root.querySelectorAll(".tabs .tab").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === currentTab));
          render(root, allItems);
          return;
        }
        if (event.target.closest('[data-act="read-all"]')) {
          const nodes = [...root.querySelectorAll(".notif.is-unread")];
          if (!nodes.length) return;
          markNotificationsRead(
            ctx.state.profile.uid,
            nodes.map((node) => ({ id: node.dataset.id, read: false }))
          ).catch(() => {});
          nodes.forEach((node) => node.classList.remove("is-unread"));
          ctx.setNotificationCount(0);
        }
      });
    },
    destroy() {
      destroyed = true;
      if (unsubscribe) unsubscribe();
    },
  };
}
