/** Xacheus Social — Notifications. */

import { markNotificationsRead, watchNotifications } from "../data.js";
import { avatar, clear, emptyState, esc, skeletonPosts, timeAgo } from "../ui.js";

const ICONS = {
  like: "❤️",
  comment: "💬",
  follow: "👤",
  mention: "✳️",
  repost: "🔁",
  message: "✉️",
};

const COPY = {
  like: "liked your post",
  comment: "replied to your post",
  follow: "started following you",
  mention: "mentioned you",
  repost: "reposted your post",
  message: "sent you a message",
};

export function notificationsView(ctx) {
  let unsubscribe = null;
  let destroyed = false;

  const html = `
    <div class="view-head">
      <h1>Notifications</h1>
      <button class="link-btn" type="button" data-act="read-all">Mark all read</button>
    </div>
    <div class="notif-list" id="notif-list" aria-live="polite">${skeletonPosts(2)}</div>`;

  function render(root, items) {
    const list = root.querySelector("#notif-list");
    if (!list) return;
    clear(list);

    if (!items.length) {
      list.innerHTML = emptyState(
        "🔔",
        "Nothing here yet",
        "When someone likes, replies, follows or mentions you, it shows up here."
      );
      return;
    }

    list.innerHTML = items
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
    return `#/post/${item.postId}`;
  }

  return {
    html,
    title: "Notifications",
    mount(root) {
      const list = root.querySelector("#notif-list");
      clear(list);
      list.innerHTML = skeletonPosts(2);

      if (!ctx.state.profile) {
        list.innerHTML = emptyState(
          "🔒",
          "Log in to see notifications",
          "Your mentions, likes and follows live here once you're signed in."
        );
        return;
      }

      unsubscribe = watchNotifications(ctx.state.profile.uid, (items) => {
        if (destroyed) return;
        render(root, items);
        ctx.setNotificationCount(items.filter((item) => !item.read).length);
      });

      root.addEventListener("click", (event) => {
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
