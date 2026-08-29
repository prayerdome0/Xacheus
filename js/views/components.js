/** Xacheus Social — post card, composer, user row and shared interactions. */

import {
  addComment,
  deletePost,
  getLikedIds,
  getRepostedIds,
  getSavedIds,
  toggleLike,
  toggleRepost,
  toggleSave,
} from "../data.js";
import { uploadImage } from "../cloudinary.js";
import {
  avatar,
  confirmDialog,
  copyText,
  esc,
  formatCount,
  openModal,
  richText,
  timeAgo,
  toast,
} from "../ui.js";

const MAX_CHARS = 500;

/* ------------------------------------------------------------------ */
/* post card                                                           */
/* ------------------------------------------------------------------ */

export function postCardHtml(post, { liked = false, reposted = false, saved = false, compact = false } = {}) {
  const author = {
    uid: post.uid,
    username: post.username,
    displayName: post.displayName,
    photoURL: post.photoURL,
  };
  const isOwn = false; // set per-render by caller through data-own
  const media = post.imageUrl
    ? `<div class="post-media">
         <img src="${esc(post.imageUrl)}" alt="Shared image" loading="lazy" data-zoom />
       </div>`
    : "";

  return `
  <article class="post ${compact ? "post-compact" : ""}" data-post-id="${esc(post.id)}" data-own="${isOwn}" tabindex="0" role="article">
    <div class="post-rail">
      <a class="post-avatar" href="#/u/${esc(post.username || post.uid)}" aria-label="${esc(post.displayName || "Profile")}">
        ${avatar(author, "md")}
      </a>
    </div>

    <div class="post-main">
      <header class="post-head">
        <a class="post-name" href="#/u/${esc(post.username || post.uid)}">${esc(post.displayName || "Xacheus user")}</a>
        ${post.verified ? '<span class="verified" title="Verified">✓</span>' : ""}
        <a class="post-handle" href="#/u/${esc(post.username || post.uid)}">@${esc(post.username || "user")}</a>
        <span class="post-dot" aria-hidden="true">·</span>
        <a class="post-time" href="#/post/${esc(post.id)}">${timeAgo(post.createdAt)}</a>
        <button class="icon-btn post-more" type="button" data-act="more" aria-label="Post options">⋯</button>
      </header>

      ${post.text ? `<div class="post-text">${richText(post.text)}</div>` : ""}
      ${media}

      <footer class="post-actions" role="group" aria-label="Post actions">
        <button class="action action-comment" type="button" data-act="comment" aria-label="Reply">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1.5-4.5A8 8 0 1 1 21 12z"/></svg>
          <span data-count="comment">${formatCount(post.commentCount)}</span>
        </button>

        <button class="action action-repost ${reposted ? "is-on" : ""}" type="button" data-act="repost" aria-pressed="${reposted}" aria-label="Repost">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 2l4 4-4 4v-3H8a4 4 0 0 0-4 4v2H2v-2a6 6 0 0 1 6-6h9V2zM7 22l-4-4 4-4v3h9a4 4 0 0 0 4-4v-2h2v2a6 6 0 0 1-6 6H7v3z"/></svg>
          <span data-count="repost">${formatCount(post.repostCount)}</span>
        </button>

        <button class="action action-like ${liked ? "is-on" : ""}" type="button" data-act="like" aria-pressed="${liked}" aria-label="Like">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-8-4.9-8-10.2A4.8 4.8 0 0 1 12 7a4.8 4.8 0 0 1 8 3.8C20 16.1 12 21 12 21z"/></svg>
          <span data-count="like">${formatCount(post.likeCount)}</span>
        </button>

        <button class="action action-save ${saved ? "is-on" : ""}" type="button" data-act="save" aria-pressed="${saved}" aria-label="Save">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/></svg>
        </button>

        <button class="action action-share" type="button" data-act="share" aria-label="Copy link">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v10M12 3l-4 4M12 3l4 4M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/></svg>
        </button>
      </footer>
    </div>
  </article>`;
}

/** Hydrate like/repost/save state for a batch of freshly rendered posts. */
export async function hydratePostStates(root, uid) {
  const cards = [...root.querySelectorAll(".post[data-post-id]")];
  if (!uid || !cards.length) return;
  const ids = cards.map((card) => card.dataset.postId);
  const [liked, reposted, saved] = await Promise.all([
    getLikedIds(uid, ids),
    getRepostedIds(uid, ids),
    getSavedIds(uid, ids),
  ]);
  cards.forEach((card) => {
    const id = card.dataset.postId;
    card.querySelector('[data-act="like"]')?.classList.toggle("is-on", liked.has(id));
    card.querySelector('[data-act="like"]')?.setAttribute("aria-pressed", String(liked.has(id)));
    card.querySelector('[data-act="repost"]')?.classList.toggle("is-on", reposted.has(id));
    card.querySelector('[data-act="repost"]')?.setAttribute("aria-pressed", String(reposted.has(id)));
    card.querySelector('[data-act="save"]')?.classList.toggle("is-on", saved.has(id));
    card.querySelector('[data-act="save"]')?.setAttribute("aria-pressed", String(saved.has(id)));
  });
}

/**
 * Wire every post card inside `root`.
 * `ctx` = { state, navigate, onPostsChanged }
 */
export function bindPostActions(root, ctx) {
  if (root.dataset.postsBound === "1") return;
  root.dataset.postsBound = "1";

  root.addEventListener("click", async (event) => {
    const actionBtn = event.target.closest("[data-act]");
    const card = event.target.closest(".post[data-post-id]");
    if (!card) return;

    const postId = card.dataset.postId;
    const post = findPost(ctx, postId);

    if (!actionBtn) {
      if (event.target.closest("a")) return;
      ctx.navigate(`#/post/${postId}`);
      return;
    }

    const act = actionBtn.dataset.act;
    if (act === "comment") return ctx.navigate(`#/post/${postId}?focus=reply`);
    if (act === "share") {
      copyText(`${location.origin}${location.pathname}#/post/${postId}`);
      return;
    }

    if (!ctx.state.profile) return ctx.requireAuth();

    if (act === "like") return onLike(card, postId, post, ctx);
    if (act === "repost") return onRepost(card, postId, post, ctx);
    if (act === "save") return onSave(card, postId, post, ctx);
    if (act === "more") return openPostMenu(actionBtn, postId, post, ctx);
  });

  root.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const card = event.target.closest(".post[data-post-id]");
    if (card && event.target === card) ctx.navigate(`#/post/${card.dataset.postId}`);
  });
}

function findPost(ctx, postId) {
  return (
    (ctx.postCache && ctx.postCache.get(postId)) || { id: postId, uid: null, text: "" }
  );
}

function bump(card, key, delta) {
  const node = card.querySelector(`[data-count="${key}"]`);
  if (!node) return;
  const next = Math.max(0, parseInt(node.textContent.replace(/[^\d]/g, "") || "0", 10) + delta);
  node.textContent = next ? formatCount(next) : "";
}

async function onLike(card, postId, post, ctx) {
  const button = card.querySelector('[data-act="like"]');
  if (button.disabled) return;
  const wasOn = button.classList.contains("is-on");
  button.classList.toggle("is-on", !wasOn);
  button.setAttribute("aria-pressed", String(!wasOn));
  bump(card, "like", wasOn ? -1 : 1);
  button.disabled = true;
  try {
    await toggleLike(ctx.state.profile.uid, ctx.state.profile, post);
  } catch (error) {
    button.classList.toggle("is-on", wasOn);
    bump(card, "like", wasOn ? 1 : -1);
    toast(error?.message || "Could not like that post.", "error");
  } finally {
    button.disabled = false;
  }
}

async function onRepost(card, postId, post, ctx) {
  const button = card.querySelector('[data-act="repost"]');
  if (button.disabled) return;
  const wasOn = button.classList.contains("is-on");
  button.classList.toggle("is-on", !wasOn);
  button.setAttribute("aria-pressed", String(!wasOn));
  bump(card, "repost", wasOn ? -1 : 1);
  button.disabled = true;
  try {
    const result = await toggleRepost(ctx.state.profile.uid, ctx.state.profile, post);
    toast(result ? "Reposted" : "Repost removed", "success", 2200);
  } catch (error) {
    button.classList.toggle("is-on", wasOn);
    bump(card, "repost", wasOn ? 1 : -1);
    toast(error?.message || "Could not repost.", "error");
  } finally {
    button.disabled = false;
  }
}

async function onSave(card, postId, post, ctx) {
  const button = card.querySelector('[data-act="save"]');
  const wasOn = button.classList.contains("is-on");
  button.classList.toggle("is-on", !wasOn);
  button.setAttribute("aria-pressed", String(!wasOn));
  try {
    const saved = await toggleSave(ctx.state.profile.uid, post);
    toast(saved ? "Saved to your bookmarks" : "Removed from bookmarks", "success", 2200);
  } catch (error) {
    button.classList.toggle("is-on", wasOn);
    toast("Could not update your bookmarks.", "error");
  }
}

function openPostMenu(anchor, postId, post, ctx) {
  const isOwn = post?.uid && ctx.state.profile?.uid === post.uid;
  const items = [
    `<button class="menu-item" type="button" data-menu="link">Copy link to post</button>`,
    isOwn
      ? `<button class="menu-item danger" type="button" data-menu="delete">Delete post</button>`
      : `<button class="menu-item" type="button" data-menu="mute">Mute @${esc(post?.username || "user")}</button>`,
  ].join("");

  const menu = document.createElement("div");
  menu.className = "pop-menu";
  menu.innerHTML = items;
  document.body.appendChild(menu);

  const rect = anchor.getBoundingClientRect();
  const width = 210;
  menu.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 120)}px`;
  menu.style.left = `${Math.max(8, Math.min(rect.left - width + rect.width, window.innerWidth - width - 8))}px`;

  const close = () => {
    document.removeEventListener("click", onOutside, true);
    document.removeEventListener("scroll", close, true);
    menu.remove();
  };
  const onOutside = (event) => {
    if (!menu.contains(event.target)) close();
  };

  setTimeout(() => document.addEventListener("click", onOutside, true), 0);
  document.addEventListener("scroll", close, true);

  menu.addEventListener("click", async (event) => {
    const choice = event.target.closest("[data-menu]")?.dataset.menu;
    if (!choice) return;
    close();
    if (choice === "link") copyText(`${location.origin}${location.pathname}#/post/${postId}`);
    if (choice === "mute") toast(`Muted @${post?.username || "user"}`, "success");
    if (choice === "delete") {
      const ok = await confirmDialog({
        title: "Delete this post?",
        body: "It will be removed from the feed and from everyone's replies view. This can't be undone.",
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      try {
        await deletePost(postId, ctx.state.profile.uid);
        toast("Post deleted", "success");
        ctx.onPostsChanged?.();
      } catch (error) {
        toast(error?.message || "Could not delete that post.", "error");
      }
    }
  });
}

/* ------------------------------------------------------------------ */
/* composer                                                            */
/* ------------------------------------------------------------------ */

const QUICK_EMOJI = ["🙌", "🔥", "😂", "❤️", "🚀", "💡", "🙏", "🌍", "🎶", "📸", "☕", "⚽"];

export function openComposer(ctx, { placeholder = "What's happening?", replyTo = null, onPosted = null } = {}) {
  if (!ctx.state.profile) return ctx.requireAuth();

  const me = ctx.state.profile;
  openModal({
    title: replyTo ? "Reply" : "New post",
    body: `
      <form class="composer" id="composer-form" novalidate>
        <div class="composer-row">
          ${avatar(me, "md")}
          <textarea
            id="composer-text"
            maxlength="${MAX_CHARS}"
            rows="4"
            placeholder="${esc(placeholder)}"
            aria-label="Post text"
          ></textarea>
        </div>

        <div class="composer-preview" id="composer-preview" hidden>
          <img alt="Attachment preview" />
          <button class="icon-btn remove-media" type="button" data-act="remove-media" aria-label="Remove image">✕</button>
          <div class="upload-progress" id="upload-progress" hidden><span></span></div>
        </div>

        <div class="composer-tags" id="composer-tags"></div>

        <div class="composer-foot">
          <div class="composer-tools">
            <label class="tool-btn" title="Add a photo">
              <input type="file" id="composer-file" accept="image/*" hidden />
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm2 12h12l-4-5-3 4-2-2-3 3z"/></svg>
            </label>
            <button class="tool-btn" type="button" data-act="emoji" title="Emoji">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 4a1.2 1.2 0 1 1 0 2.4A1.2 1.2 0 0 1 12 6zm-3.5 3a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4zm7 0a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4zM12 18a5 5 0 0 1-4.6-3h9.2A5 5 0 0 1 12 18z"/></svg>
            </button>
            <span class="tool-hint">#hashtags and @handles are linked automatically</span>
          </div>
          <div class="composer-submit">
            <span class="char-count" id="char-count">${MAX_CHARS}</span>
            <button class="btn btn-primary" type="submit" id="composer-post">${replyTo ? "Reply" : "Post"}</button>
          </div>
        </div>
      </form>`,
    onMount(root, close) {
      const textarea = root.querySelector("#composer-text");
      const counter = root.querySelector("#char-count");
      const fileInput = root.querySelector("#composer-file");
      const preview = root.querySelector("#composer-preview");
      const previewImg = preview.querySelector("img");
      const progress = root.querySelector("#upload-progress");
      const form = root.querySelector("#composer-form");
      const submit = root.querySelector("#composer-post");
      const tagsRow = root.querySelector("#composer-tags");

      let selectedFile = null;
      let imageUrl = "";
      let uploading = false;

      if (replyTo) textarea.placeholder = `Reply to @${replyTo.username}…`;
      setTimeout(() => textarea.focus(), 40);

      const syncCounter = () => {
        const remaining = MAX_CHARS - textarea.value.length;
        counter.textContent = remaining;
        counter.classList.toggle("is-low", remaining <= 40);
        counter.classList.toggle("is-over", remaining < 0);
        submit.disabled = uploading || (remaining === MAX_CHARS && !imageUrl);
        renderTagPreview();
      };

      function renderTagPreview() {
        const tags = [...textarea.value.matchAll(/#([a-z0-9_]{2,30})/gi)].map((m) => m[0]);
        const mentions = [...textarea.value.matchAll(/@([a-z0-9_]{3,20})/gi)].map((m) => m[0]);
        const all = [...new Set([...tags, ...mentions])].slice(0, 6);
        tagsRow.innerHTML = all.length
          ? all.map((tag) => `<span class="tag-chip">${esc(tag)}</span>`).join("")
          : "";
      }

      textarea.addEventListener("input", () => {
        autoGrow(textarea);
        syncCounter();
      });
      textarea.addEventListener("keydown", (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") form.requestSubmit();
      });

      fileInput.addEventListener("change", async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        if (!file.type.startsWith("image/")) return toast("Only image files can be attached.", "error");
        if (file.size > 8 * 1024 * 1024) return toast("Images must be under 8 MB.", "error");

        selectedFile = file;
        imageUrl = "";
        previewImg.src = URL.createObjectURL(file);
        preview.hidden = false;
        progress.hidden = false;
        progress.querySelector("span").style.width = "8%";
        uploading = true;
        submit.disabled = true;

        const url = await uploadImage(file, {
          onProgress: (value) => {
            progress.querySelector("span").style.width = `${Math.max(8, value)}%`;
          },
        });
        uploading = false;
        progress.hidden = true;
        imageUrl = url || "";
        if (url && url.startsWith("blob:")) {
          toast("Uploaded locally — Cloudinary preset not reachable.", "info", 5000);
        }
        syncCounter();
      });

      root.addEventListener("click", (event) => {
        const act = event.target.closest("[data-act]")?.dataset.act;
        if (act === "remove-media") {
          selectedFile = null;
          imageUrl = "";
          preview.hidden = true;
          fileInput.value = "";
          syncCounter();
        }
        if (act === "emoji") {
          const palette = root.querySelector(".emoji-palette");
          if (palette) return palette.remove();
          const node = document.createElement("div");
          node.className = "emoji-palette";
          node.innerHTML = QUICK_EMOJI.map(
            (emoji) => `<button type="button" class="emoji" data-emoji="${emoji}">${emoji}</button>`
          ).join("");
          root.querySelector(".composer-tools").appendChild(node);
          node.addEventListener("click", (inner) => {
            const picked = inner.target.closest("[data-emoji]")?.dataset.emoji;
            if (!picked) return;
            insertAtCursor(textarea, picked);
            node.remove();
            syncCounter();
          });
        }
      });

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (uploading) return toast("Hang on — image still uploading.", "info");
        const text = textarea.value.trim();
        if (!text && !imageUrl) return toast("Write something or add a photo.", "error");

        submit.disabled = true;
        const original = submit.textContent;
        submit.textContent = "Posting…";
        try {
          const { createPost } = await import("../data.js");
          const id = await createPost(ctx.state.profile, { text, imageUrl, replyTo });
          toast(replyTo ? "Reply sent" : "Posted", "success");
          close();
          if (onPosted) onPosted(id);
          else {
            ctx.onPostsChanged?.();
            if (!replyTo) ctx.navigate("#/home");
          }
        } catch (error) {
          submit.disabled = false;
          submit.textContent = original;
          toast(error?.message || "Could not post right now.", "error", 5000);
        }
      });

      syncCounter();
    },
  });
}

function autoGrow(node) {
  node.style.height = "auto";
  node.style.height = `${Math.min(node.scrollHeight, 320)}px`;
}

function insertAtCursor(node, value) {
  const start = node.selectionStart ?? node.value.length;
  const end = node.selectionEnd ?? node.value.length;
  node.value = node.value.slice(0, start) + value + node.value.slice(end);
  node.selectionStart = node.selectionEnd = start + value.length;
  node.focus();
}

/* ------------------------------------------------------------------ */
/* user row                                                            */
/* ------------------------------------------------------------------ */

export function userRowHtml(user, { action = "", trailing = "" } = {}) {
  return `
    <div class="user-row" data-uid="${esc(user.uid || user.id)}">
      <a class="user-row-main" href="#/u/${esc(user.username || user.uid)}">
        ${avatar(user, "md")}
        <span class="user-row-text">
          <strong>${esc(user.displayName || user.username || "Xacheus user")}${
            user.verified ? ' <span class="verified" title="Verified">✓</span>' : ""
          }</strong>
          <em>@${esc(user.username || "user")}</em>
          ${user.bio ? `<span class="user-row-bio">${esc(user.bio)}</span>` : ""}
        </span>
      </a>
      ${trailing || (action ? `<button class="btn btn-sm ${action === "Following" ? "btn-outline" : "btn-primary"}" type="button" data-act="follow">${esc(action)}</button>` : "")}
    </div>`;
}

/* ------------------------------------------------------------------ */
/* reply box (thread view)                                             */
/* ------------------------------------------------------------------ */

export function replyBoxHtml(me) {
  return `
    <form class="reply-box" id="reply-form">
      ${avatar(me, "sm")}
      <input type="text" id="reply-input" maxlength="500" placeholder="Post your reply" aria-label="Write a reply" autocomplete="off" />
      <button class="btn btn-primary btn-sm" type="submit">Reply</button>
    </form>`;
}

export function bindReplyBox(root, ctx, post) {
  const form = root.querySelector("#reply-form");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!ctx.state.profile) return ctx.requireAuth();
    const input = root.querySelector("#reply-input");
    const text = input.value.trim();
    if (!text) return;
    input.disabled = true;
    try {
      await addComment(ctx.state.profile.uid, ctx.state.profile, post, text);
      input.value = "";
      toast("Reply posted", "success", 2000);
    } catch (error) {
      toast(error?.message || "Could not post that reply.", "error");
    } finally {
      input.disabled = false;
      input.focus();
    }
  });
}

export { MAX_CHARS };
