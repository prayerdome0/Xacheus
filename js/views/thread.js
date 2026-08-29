/** Xacheus Social — Single post thread. */

import { getPost, watchComments, watchPost } from "../data.js";
import { avatar, bindZoom, clear, emptyState, esc, fullDate, skeletonPosts, timeAgo } from "../ui.js";
import { bindPostActions, bindReplyBox, hydratePostStates, postCardHtml, replyBoxHtml } from "./components.js";

export function threadView(ctx, params) {
  let unsubscribePost = null;
  let unsubscribeComments = null;
  let destroyed = false;
  const postId = params.id;
  const focusReply = params.focus === "reply";

  const html = `
    <div class="view-head">
      <a class="icon-btn back-btn" href="#/home" aria-label="Back">←</a>
      <div><h1>Post</h1></div>
    </div>
    <div id="thread-root">${skeletonPosts(2)}</div>`;

  function renderPost(root, post) {
    const host = root.querySelector("#thread-root");
    if (!host) return;

    if (!post) {
      clear(host);
      host.innerHTML = emptyState(
        "🫥",
        "This post is gone",
        "It may have been deleted by its author.",
        '<a class="btn btn-primary btn-sm" href="#/home">Back to feed</a>'
      );
      return;
    }

    ctx.postCache.set(post.id, post);
    const existing = host.querySelector("#thread-post");
    if (existing) {
      existing.outerHTML = `<div id="thread-post">${postCardHtml(post, { compact: false })}</div>`;
    } else {
      clear(host);
      host.innerHTML = `
        <div id="thread-post">${postCardHtml(post)}</div>
        <div class="thread-stamp">${fullDate(post.createdAt)}</div>
        ${
          ctx.state.profile
            ? replyBoxHtml(ctx.state.profile)
            : `<div class="reply-locked">Log in to join the conversation. <button class="link-btn" type="button" data-act="login">Log in</button></div>`
        }
        <div class="thread-comments" id="thread-comments"><div class="loader-row"><span class="spinner"></span></div></div>`;
      hydratePostStates(host, ctx.state.profile?.uid);
      bindReplyBox(host, ctx, post);
      if (focusReply) setTimeout(() => host.querySelector("#reply-input")?.focus(), 120);
    }
  }

  function renderComments(root, comments) {
    const list = root.querySelector("#thread-comments");
    if (!list || destroyed) return;
    clear(list);

    if (!comments.length) {
      list.innerHTML = `<p class="thread-empty">No replies yet. Start the conversation 👇</p>`;
      return;
    }

    list.innerHTML = comments
      .map((comment) => {
        const user = {
          username: comment.username,
          displayName: comment.displayName,
          photoURL: comment.photoURL,
        };
        return `
        <article class="comment">
          <a href="#/u/${esc(comment.username || comment.uid)}">${avatar(user, "sm")}</a>
          <div class="comment-body">
            <header>
              <a href="#/u/${esc(comment.username || comment.uid)}"><strong>${esc(comment.displayName)}</strong></a>
              <a class="comment-handle" href="#/u/${esc(comment.username || comment.uid)}">@${esc(comment.username)}</a>
              <span aria-hidden="true">·</span>
              <time>${timeAgo(comment.createdAt)}</time>
            </header>
            <p>${esc(comment.text)}</p>
          </div>
        </article>`;
      })
      .join("");
  }

  return {
    html,
    title: "Post",
    mount(root) {
      bindPostActions(root, ctx);
      bindZoom(root);

      root.addEventListener("click", (event) => {
        if (event.target.closest('[data-act="login"]')) ctx.requireAuth();
      });

      unsubscribePost = watchPost(postId, (post) => renderPost(root, post));
      unsubscribeComments = watchComments(postId, (comments) => renderComments(root, comments));

      // Seed the cache so post menus work before the snapshot lands.
      getPost(postId)
        .then((post) => {
          if (post) ctx.postCache.set(post.id, post);
        })
        .catch(() => {});
    },
    destroy() {
      destroyed = true;
      if (unsubscribePost) unsubscribePost();
      if (unsubscribeComments) unsubscribeComments();
    },
  };
}
