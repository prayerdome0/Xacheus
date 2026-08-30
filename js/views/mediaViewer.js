/**
 * Xacheus — full-screen profile media viewer.
 *
 * This is what a profile picture, cover or gallery photo opens into: the image
 * at full size, with real reactions, real comments, replies, per-comment likes,
 * deletion of your own comment, a share sheet and a like/comment/view count
 * that comes straight from Firestore. Left/right arrows walk the album.
 *
 * Opened from a profile (or a `#/u/handle?media={id}` deep link), so a shared
 * link lands on the exact photo with its live counts.
 */

import {
  REACTIONS,
  REACTION_BY_KEY,
  addProfileMediaComment,
  deleteProfileMedia,
  deleteProfileMediaComment,
  bumpProfileMediaView,
  bumpProfileMediaShare,
  getLikedMediaCommentIds,
  getMediaReactionCount,
  listProfileMedia,
  reactToProfileMedia,
  setAsCurrentMedia,
  setProfileMediaCaption,
  watchProfileMediaComments,
  watchProfileMediaItem,
} from "../social.js";
import {
  avatar,
  confirmDialog,
  openModal,
  esc,
  formatCount,
  fullDate,
  gradientFor,
  richText,
  timeAgo,
  toast,
} from "../ui.js";
import { openReportModal, openShareModal } from "./components.js";

const state = { root: null, unsub: null, unsubComments: null, media: null, comments: [], list: [], index: 0, liked: new Set(), myUid: "" };

export function closeMediaViewer() {
  state.unsub?.();
  state.unsubComments?.();
  state.unsub = null;
  state.unsubComments = null;
  if (state.root) {
    const node = state.root;
    node.classList.remove("is-in");
    if (node._onKey) document.removeEventListener("keydown", node._onKey);
    node._onKey = null;
    state.root = null;
    state.media = null;
    document.body.classList.remove("no-scroll");
    setTimeout(() => node.remove(), 200);
    window.dispatchEvent(new CustomEvent("xacheus:media-viewer", { detail: { open: false } }));
  }
}

/**
 * @param {object} ctx            app context (state/navigate/requireAuth)
 * @param {string} mediaId        profileMedia doc id
 * @param {Array}  list           sibling media for prev/next (optional)
 * @param {object} media          already-loaded item (optional, avoids a flash)
 */
export async function openMediaViewer(ctx, mediaId, { list = [], media = null } = {}) {
  if (!mediaId && !media) return;

  // A viewer already open: just swap the item.
  if (state.root) {
    state.list = list.length ? list : state.list;
    state.index = Math.max(0, state.list.findIndex((m) => m.id === (media?.id || mediaId)));
    await loadInto(ctx, media || { id: mediaId });
    return;
  }

  const root = document.createElement("div");
  root.className = "media-viewer";
  root.id = "media-viewer";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "Profile photo viewer");
  root.innerHTML = shellHtml();
  document.body.appendChild(root);
  document.body.classList.add("no-scroll");
  requestAnimationFrame(() => root.classList.add("is-in"));

  state.root = root;
  state.myUid = ctx.state.profile?.uid || "";
  state.list = list.length ? list : media?.id ? [media] : await listProfileMedia(ctx.state.profile?.uid || "", { max: 60 }).catch(() => []);
  state.index = Math.max(0, state.list.findIndex((m) => m.id === (media?.id || mediaId)));

  wireViewer(ctx, root);
  window.dispatchEvent(new CustomEvent("xacheus:media-viewer", { detail: { open: true } }));
  await loadInto(ctx, media || { id: mediaId });
}

function shellHtml() {
  return `
  <div class="mv-backdrop" data-mv-close></div>
  <div class="mv-stage">
    <div class="mv-pane">
      <div class="mv-figure" data-mv-figure>
        <div class="loader-row"><span class="spinner"></span> Loading…</div>
      </div>
      <button class="mv-nav mv-prev" type="button" data-mv="prev" aria-label="Previous photo">
        <svg viewBox="0 0 24 24"><path d="M15 4l-8 8 8 8"/></svg>
      </button>
      <button class="mv-nav mv-next" type="button" data-mv="next" aria-label="Next photo">
        <svg viewBox="0 0 24 24"><path d="M9 4l8 8-8 8"/></svg>
      </button>
      <div class="mv-counter" data-mv="counter"></div>
    </div>

    <aside class="mv-side">
      <header class="mv-head">
        <div data-mv="author"></div>
        <div class="mv-head-actions">
          <button class="icon-btn" type="button" data-mv="report" title="Report">
            <svg viewBox="0 0 24 24"><path d="M5 3v18M5 4h11l-1.5 3L16 10H5"/></svg>
          </button>
          <button class="icon-btn" type="button" data-mv="close" aria-label="Close">✕</button>
        </div>
      </header>

      <div class="mv-counts" data-mv="counts"></div>
      <p class="mv-caption" data-mv="caption"></p>
      <div class="mv-licence" data-mv="licence" hidden></div>

      <div class="mv-reactions" data-mv="reactions">
        ${REACTIONS.map(
          (r) => `<button type="button" class="mv-rx" data-reaction="${r.key}" title="${esc(r.label)}" aria-pressed="false">
            <span class="mv-rx-emoji">${r.emoji}</span>
            <em data-rx-count="${r.key}">0</em>
          </button>`
        ).join("")}
      </div>

      <div class="mv-actions">
        <button class="btn btn-sm btn-outline" type="button" data-mv="share">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v10M12 3l-4 4M12 3l4 4M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/></svg>
          Share
        </button>
        <span data-mv="owner-actions"></span>
      </div>

      <section class="mv-comments">
        <h3>Comments <em data-mv="comment-count">0</em></h3>
        <div class="mv-comment-list" data-mv="comments">
          <div class="loader-row"><span class="spinner"></span> Loading…</div>
        </div>
        <form class="mv-comment-form" data-mv="form">
          <input type="text" maxlength="500" placeholder="${"Add a comment…"}" data-mv="input" autocomplete="off" />
          <button class="btn btn-primary btn-sm" type="submit">Post</button>
        </form>
        <p class="mv-reply-hint" data-mv="reply-hint" hidden></p>
      </section>
    </aside>
  </div>`;
}

function wireViewer(ctx, root) {
  root.addEventListener("click", (event) => {
    if (event.target.closest("[data-mv-close]") || event.target.closest('[data-mv="close"]')) {
      closeMediaViewer();
      return;
    }
  });

  const onKey = (event) => {
    if (!state.root) return;
    if (event.key === "Escape") closeMediaViewer();
    else if (event.key === "ArrowRight") step(ctx, 1);
    else if (event.key === "ArrowLeft") step(ctx, -1);
  };
  document.addEventListener("keydown", onKey);
  root._onKey = onKey;

  root.querySelector('[data-mv="prev"]').addEventListener("click", () => step(ctx, -1));
  root.querySelector('[data-mv="next"]').addEventListener("click", () => step(ctx, 1));

  root.querySelector('[data-mv="reactions"]').addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-reaction]");
    if (!btn) return;
    if (!ctx.state.profile) return ctx.requireAuth();
    const media = state.media;
    btn.classList.add("is-busy");
    try {
      const next = await reactToProfileMedia(ctx.state.profile.uid, ctx.state.profile, media, btn.dataset.reaction);
      paintReactionState(btn.dataset.reaction, next);
      await refreshCounts(ctx);
    } catch (err) {
      toast(err?.message || "Could not save that reaction", "error");
    } finally {
      btn.classList.remove("is-busy");
    }
  });

  root.querySelector('[data-mv="share"]').addEventListener("click", () => {
    const media = state.media;
    const url = `${location.origin}${location.pathname}#/u/${encodeURIComponent(media.username || ctx.state.profile?.username || "xacheus")}?media=${encodeURIComponent(media.id)}`;
    openShareModal(ctx, {
      title: `${media.displayName || media.username}'s photo on Xacheus`,
      text: media.caption ? String(media.caption).slice(0, 120) : "Photo on Xacheus",
      url,
      onShared: () => bumpProfileMediaShare(media.id),
    });
  });

  root.querySelector('[data-mv="report"]').addEventListener("click", () => {
    if (!ctx.state.profile) return ctx.requireAuth();
    const media = state.media;
    openReportModal(ctx, {
      targetType: "profileMedia",
      targetId: media.id,
      targetOwnerUid: media.uid,
      targetLabel: `Photo by @${media.username || "unknown"}`,
    });
  });

  const form = root.querySelector('[data-mv="form"]');
  const input = root.querySelector('[data-mv="input"]');
  const hint = root.querySelector('[data-mv="reply-hint"]');
  let replyTo = null;

  hint.addEventListener("click", (event) => {
    if (!event.target.closest("[data-cancel-reply]")) return;
    replyTo = null;
    hint.hidden = true;
    input.focus();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!ctx.state.profile) return ctx.requireAuth();
    const text = input.value.trim();
    if (!text) return;
    input.disabled = true;
    try {
      await addProfileMediaComment(ctx.state.profile.uid, ctx.state.profile, state.media, text, replyTo?.id || "");
      input.value = "";
      replyTo = null;
      hint.hidden = true;
    } catch (err) {
      toast(err?.message || "Could not post that comment", "error");
    } finally {
      input.disabled = false;
      input.focus();
    }
  });

  root.querySelector('[data-mv="comments"]').addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-comment-act]");
    if (!btn) return;
    const wrap = btn.closest("[data-comment-id]");
    const id = wrap?.dataset.commentId;
    const comment = (state.comments || []).find((c) => c.id === id);
    if (!comment) return;
    const action = btn.dataset.commentAct;

    if (action === "reply") {
      replyTo = comment;
      hint.hidden = false;
      hint.innerHTML = `Replying to <strong>@${esc(comment.username)}</strong> <button type="button" class="link-btn" data-cancel-reply>cancel</button>`;
      input.focus();
      return;
    }
    if (action === "like") {
      if (!ctx.state.profile) return ctx.requireAuth();
      const { likeProfileMediaComment } = await import("../social.js");
      try {
        const nowLiked = await likeProfileMediaComment(ctx.state.profile.uid, state.media.id, comment.id);
        if (nowLiked) state.liked.add(comment.id);
        else state.liked.delete(comment.id);
        renderComments(state.comments);
      } catch (err) {
        toast(err?.message || "Could not like that comment", "error");
      }
      return;
    }
    if (action === "delete") {
      if (!ctx.state.profile) return ctx.requireAuth();
      const ok = await confirmDialog({
        title: "Delete comment?",
        body: "This can't be undone.",
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      try {
        await deleteProfileMediaComment(ctx.state.profile.uid, state.media.id, comment.id);
        toast("Comment deleted", "success", 1800);
      } catch (err) {
        toast(err?.message || "Could not delete that comment", "error");
      }
    }
  });
}

function step(ctx, delta) {
  if (state.list.length < 2) return;
  state.index = (state.index + delta + state.list.length) % state.list.length;
  loadInto(ctx, state.list[state.index]);
}

async function loadInto(ctx, mediaOrId) {
  const media = mediaOrId?.url ? mediaOrId : await import("../social.js").then((m) => m.getProfileMediaItem(mediaOrId.id || mediaOrId));
  if (!media?.url) {
    if (state.root) state.root.querySelector("[data-mv-figure]").innerHTML = `<p class="mv-missing">This photo is no longer available.</p>`;
    return;
  }
  state.media = media;
  state.comments = [];
  paintShell(ctx, media);

  if (media.synthetic) {
    // The profile's current picture isn't a gallery item yet (it predates the
    // photo history, or was set before this feature). Rather than inventing a
    // document to count likes on, offer to add it — then it is fully live.
    renderSyntheticNote(ctx, media);
    return;
  }

  // Live document + live comments; both are torn down when the viewer closes.
  state.unsub?.();
  state.unsub = watchProfileMediaItem(media.id, (fresh) => {
    if (!fresh) return;
    state.media = fresh;
    paintShell(ctx, fresh, { keepInput: true });
  });

  state.unsubComments?.();
  state.liked = new Set();
  state.unsubComments = watchProfileMediaComments(media.id, (rows) => {
    state.comments = rows;
    renderComments(rows);
    getLikedMediaCommentIds(ctx.state.profile?.uid, media.id, rows.map((r) => r.id)).then((ids) => {
      ids.forEach((id) => state.liked.add(id));
      renderComments(rows);
    });
  });

  if (ctx.state.profile?.uid) {
    const mine = await getMediaReactionCount(ctx.state.profile.uid, media.id).catch(() => null);
    paintReactionState(null, mine);
  }
  bumpProfileMediaView(media.id);
}

function paintShell(ctx, media, { keepInput = false } = {}) {
  const root = state.root;
  if (!root) return;
  const isMine = Boolean(ctx.state.profile?.uid && ctx.state.profile.uid === media.uid);
  const [from, to] = gradientFor(media.username || media.uid || "xacheus");

  const figure = root.querySelector("[data-mv-figure]");
  figure.innerHTML = `
    <img src="${esc(media.url)}" alt="${esc(media.caption || `Photo by ${media.displayName || media.username || "Xacheus"}`)}"
         style="background-image:linear-gradient(135deg,${from},${to})" draggable="false" />
    <div class="mv-figure-foot">
      <span class="mv-kind">${esc(kindLabel(media.kind))}${media.isCurrent ? " · current" : ""}</span>
      <span>${timeAgo(media.createdAt)}${media.takenAt ? ` · taken ${new Date(media.takenAt).toLocaleDateString()}` : ""}</span>
    </div>`;

  root.querySelector('[data-mv="author"]').innerHTML = `
    <a class="mv-author" href="#/u/${esc(media.username || "")}" data-mv-open-profile>
      ${avatar({ username: media.username, displayName: media.displayName, photoURL: ctx.state.profile?.photoURL }, "sm")}
      <span>
        <strong>${esc(media.displayName || media.username || "Xacheus user")}</strong>
        <em>@${esc(media.username || "user")} · ${fullDate(media.createdAt)}</em>
      </span>
    </a>`;
  root.querySelector('[data-mv-open-profile]')?.addEventListener("click", () => closeMediaViewer());

  root.querySelector('[data-mv="counts"]').innerHTML = `
    <span title="Reactions"><strong data-count="likes">${formatCount(media.likeCount)}</strong> reactions</span>
    <span title="Comments"><strong data-count="comments">${formatCount(media.commentCount)}</strong> comments</span>
    <span title="Views"><strong data-count="views">${formatCount(media.viewCount)}</strong> views</span>
    <span title="Shares"><strong data-count="shares">${formatCount(media.shareCount)}</strong> shares</span>`;

  const captionNode = root.querySelector('[data-mv="caption"]');
  captionNode.innerHTML = media.caption ? richText(media.caption) : `<em class="muted">No caption</em>`;

  const counter = root.querySelector('[data-mv="counter"]');
  counter.textContent = state.list.length > 1 ? `${state.index + 1} / ${state.list.length}` : "";

  const reactions = media.reactions || {};
  for (const r of REACTIONS) {
    const node = root.querySelector(`[data-rx-count="${r.key}"]`);
    if (node) node.textContent = formatCount(Number(reactions[r.key]) || 0);
  }

  const ownerActions = root.querySelector('[data-mv="owner-actions"]');
  ownerActions.innerHTML = isMine
    ? `${media.kind === "photo" ? `<button class="btn btn-sm btn-outline" type="button" data-mv="make-current">Use as profile photo</button>` : ""}
       <button class="btn btn-sm btn-ghost" type="button" data-mv="edit-caption">Edit caption</button>
       <button class="btn btn-sm btn-ghost danger" type="button" data-mv="delete">Delete</button>`
    : "";

  ownerActions.onclick = async (event) => {
    const btn = event.target.closest("[data-mv]");
    if (!btn) return;
    const act = btn.dataset.mv;
    if (act === "make-current") {
      btn.disabled = true;
      try {
        await setAsCurrentMedia(ctx.state.profile.uid, media);
        toast("Profile photo updated", "success");
        ctx.refreshProfile?.();
      } catch (err) {
        toast(err?.message || "Could not update your profile photo", "error");
      } finally {
        btn.disabled = false;
      }
      return;
    }
    if (act === "edit-caption") {
      openModal({
        title: "Edit caption",
        size: "sm",
        body: `<form class="form-grid" data-caption-form>
            <label class="field"><span>Caption</span>
              <textarea maxlength="300" rows="3" data-caption-input placeholder="Say something about this photo…"></textarea>
            </label>
            <button class="btn btn-primary btn-block" type="submit">Save caption</button>
          </form>`,
        onMount(modal, close) {
          const input = modal.querySelector("[data-caption-input]");
          input.value = media.caption || "";
          input.focus();
          modal.querySelector("[data-caption-form]").addEventListener("submit", async (event) => {
            event.preventDefault();
            try {
              await setProfileMediaCaption(ctx.state.profile.uid, media.id, input.value.trim());
              toast("Caption saved", "success", 1800);
              close();
            } catch (err) {
              toast(err?.message || "Could not save that caption", "error");
            }
          });
        },
      });
      return;
    }
    if (act === "delete") {
      const ok = await confirmDialog({
        title: "Delete this photo?",
        body: "It disappears from your gallery and any link to it stops working.",
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      try {
        await deleteProfileMedia(ctx.state.profile.uid, {}, media.id);
        toast("Photo deleted", "success");
        ctx.refreshProfile?.();
        const removed = state.list.findIndex((m) => m.id === media.id);
        state.list.splice(removed, 1);
        if (state.list.length) loadInto(ctx, state.list[Math.max(0, removed - 1)]);
        else closeMediaViewer();
      } catch (err) {
        toast(err?.message || "Could not delete that photo", "error");
      }
    }
  };

  if (!keepInput) root.querySelector('[data-mv="input"]').value = "";
  root.querySelector('[data-mv="input"]').placeholder = ctx.state.profile ? "Add a comment…" : "Sign in to comment";
}

function renderSyntheticNote(ctx, media) {
  const root = state.root;
  if (!root) return;
  const isMine = ctx.state.profile?.uid === media.uid;
  root.querySelector('[data-mv="counts"]').innerHTML = `<p class="mv-note">
    This is the account's current ${kindLabel(media.kind).toLowerCase()}. It isn't in the photo history yet, so it has no
    separate reactions or comments. ${isMine ? "Add it to the gallery to turn on likes, comments and replies." : ""}
  </p>`;
  const list = root.querySelector('[data-mv="comments"]');
  list.innerHTML = `<p class="panel-empty">${isMine ? "Add this photo to the gallery to start a conversation on it." : "No comments — this picture isn't in the gallery."}</p>`;
  root.querySelector('[data-mv="form"]').hidden = !isMine || media.kind === undefined;
  root.querySelector('[data-mv="reactions"]').hidden = true;
  root.querySelectorAll("[data-reaction]").forEach((b) => (b.disabled = true));
  const ownerActions = root.querySelector('[data-mv="owner-actions"]');
  ownerActions.innerHTML = isMine ? `<button class="btn btn-sm btn-primary" type="button" data-mv="adopt">Add to my photos</button>` : "";
  ownerActions.onclick = async (event) => {
    if (!event.target.closest('[data-mv="adopt"]')) return;
    const btn = event.target;
    btn.disabled = true;
    try {
      const { addProfileMedia } = await import("../social.js");
      const id = await addProfileMedia({ uid: media.uid, username: media.username, displayName: media.displayName }, {
        kind: media.kind,
        url: media.url,
        caption: media.caption || "",
      });
      toast("Added to your photo history", "success");
      const fresh = { ...media, id, synthetic: false };
      state.list = [fresh, ...state.list.filter((m) => m.id !== media.id)];
      state.index = 0;
      await loadInto(ctx, fresh);
    } catch (err) {
      toast(err?.message || "Could not add that photo", "error");
      btn.disabled = false;
    }
  };
}

function paintReactionState(pressedKey, activeKey) {
  const root = state.root;
  if (!root) return;
  root.querySelectorAll("[data-reaction]").forEach((btn) => {
    const isOn = btn.dataset.reaction === activeKey;
    btn.classList.toggle("is-on", isOn);
    btn.setAttribute("aria-pressed", String(isOn));
    btn.title = isOn ? `${REACTION_BY_KEY[btn.dataset.reaction].label} — tap to remove` : REACTION_BY_KEY[btn.dataset.reaction].label;
  });
  void pressedKey;
}

async function refreshCounts(ctx) {
  if (!state.media?.id || !state.root) return;
  const { getProfileMediaItem } = await import("../social.js");
  const fresh = await getProfileMediaItem(state.media.id).catch(() => null);
  if (fresh) paintShell(ctx, fresh, { keepInput: true });
}

function renderComments(rows) {
  const root = state.root;
  if (!root) return;
  const list = root.querySelector('[data-mv="comments"]');
  const countNode = root.querySelector('[data-mv="comment-count"]');
  if (countNode) countNode.textContent = rows.length ? String(rows.length) : "0";
  if (!rows.length) {
    list.innerHTML = `<p class="panel-empty">No comments yet. Be the first.</p>`;
    return;
  }
  const mine = state.myUid || "";
  const roots = rows.filter((c) => !c.parentId);
  const repliesOf = (id) => rows.filter((c) => c.parentId === id);
  list.innerHTML = roots
    .map(
      (c) => `
      <div class="mv-comment" data-comment-id="${esc(c.id)}">
        ${avatar({ username: c.username, displayName: c.displayName, photoURL: c.photoURL }, "sm")}
        <div class="mv-comment-body">
          <header>
            <a href="#/u/${esc(c.username)}"><strong>${esc(c.displayName || c.username)}</strong></a>
            <em>@${esc(c.username)}</em><span>· ${timeAgo(c.createdAt)}</span>
          </header>
          <p>${richText(c.text)}</p>
          <div class="mv-comment-actions">
            <button type="button" class="link-btn ${state.liked.has(c.id) ? "is-on" : ""}" data-comment-act="like">
              Like${Number(c.likeCount) > 0 ? ` · ${formatCount(c.likeCount)}` : ""}
            </button>
            <button type="button" class="link-btn" data-comment-act="reply">Reply</button>
            ${c.uid === mine || state.media?.uid === mine ? `<button type="button" class="link-btn danger" data-comment-act="delete">Delete</button>` : ""}
          </div>
          ${repliesOf(c.id).length
            ? `<div class="mv-comment-replies">${repliesOf(c.id)
                .map(
                  (r) => `<div class="mv-comment is-reply" data-comment-id="${esc(r.id)}">
                    ${avatar({ username: r.username, photoURL: r.photoURL }, "xs")}
                    <div class="mv-comment-body">
                      <header><strong>${esc(r.displayName || r.username)}</strong><span>· ${timeAgo(r.createdAt)}</span></header>
                      <p>${richText(r.text)}</p>
                      <div class="mv-comment-actions">
                        <button type="button" class="link-btn ${state.liked.has(r.id) ? "is-on" : ""}" data-comment-act="like">Like${Number(r.likeCount) > 0 ? ` · ${formatCount(r.likeCount)}` : ""}</button>
                        <button type="button" class="link-btn" data-comment-act="reply">Reply</button>
                        ${r.uid === mine || state.media?.uid === mine ? `<button type="button" class="link-btn danger" data-comment-act="delete">Delete</button>` : ""}
                      </div>
                    </div>
                  </div>`
                )
                .join("")}</div>`
            : ""}
        </div>
      </div>`
    )
    .join("");
  list.scrollTop = list.scrollHeight;
}

function kindLabel(kind) {
  return kind === "avatar" ? "Profile photo" : kind === "cover" ? "Cover photo" : "Photo";
}

/** Exposed for the profile view: the list the viewer walks through. */
export function viewerListHas(id) {
  return state.list.some((m) => m.id === id);
}
