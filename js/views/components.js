/**
 * Xacheus — shared post components.
 *
 * One card, one behaviour set: reactions (with a picker), threaded comments
 * with likes/replies/deletion, reposts, saving, sharing to a conversation,
 * reporting, follow-from-card and the music chip that drives the global player.
 *
 * Everything here mutates Firestore through js/data.js + js/social.js and then
 * lets the live snapshot paint the UI, so the numbers you see are the numbers
 * in the database. Counts are never faked in the DOM: the immediate class
 * toggle is only feedback that a write is in flight.
 */

import {
  addVideoComment,
  bumpVideoShare,
  getLikedVideoIds,
  getProfile,
  getSavedVideoIds,
  getSound,
  openConversation,
  sendDirectMessage,
  submitReport,
  toggleFollow,
  toggleVideoLike,
  toggleVideoSave,
  watchConversations,
  REPORT_REASONS,
  getProfileByUsername,
} from "../data.js";
import {
  REACTIONS,
  REACTION_BY_KEY,
  reactToPost,
  getMyPostReactions,
  repostPost,
  getMyRepostedIds,
  watchPostComments,
  replyToPostComment,
  likePostComment,
  deletePostComment,
  getLikedCommentIds,
  canComment,
} from "../social.js";
import {
  avatar,
  closeModal,
  confirmDialog,
  copyText,
  esc,
  formatCount,
  gradientFor,
  openModal,
  richText,
  timeAgo,
  toast,
} from "../ui.js";
import { isCurrentTrack, isPlayingTrack, playQueue, toggleTrack } from "../player.js";
import { brandSlotHtml } from "../brand.js";

export function liveThumb(live) {
  if (live?.thumbnailUrl) return `<img src="${esc(live.thumbnailUrl)}" alt="" loading="lazy" />`;
  const [from, to] = gradientFor(live?.username || live?.id || "live");
  return `<span class="live-thumb-fallback" style="background-image:linear-gradient(135deg,${from},${to})"></span>`;
}

export function postThumb(video) {
  return video.thumbnailUrl || (Array.isArray(video.images) ? video.images[0] : "") || "";
}

/** "❤️ 12 · 🙏 3" summary line under a post. */
export function reactionSummaryHtml(post) {
  const counts = post.reactions || {};
  const total = REACTIONS.reduce((sum, r) => sum + (Number(counts[r.key]) || 0), 0) || Number(post.likeCount) || 0;
  if (!total) return "";
  const top = REACTIONS.map((r) => ({ key: r.key, n: Number(counts[r.key]) || 0, emoji: r.emoji }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, 3);
  return `<span class="rx-summary" data-rx-summary>
    <span class="rx-bubbles">${top.map((r) => `<i title="${esc(REACTION_BY_KEY[r.key].label)}">${r.emoji}</i>`).join("")}</span>
    <em>${formatCount(total)} reaction${total === 1 ? "" : "s"}</em>
  </span>`;
}

/** The reaction button (shows the active reaction, opens a picker on hold/click). */
export function reactionButtonHtml(post, myReaction) {
  const active = myReaction && REACTION_BY_KEY[myReaction] ? REACTION_BY_KEY[myReaction] : null;
  return `<button class="v-action rx-main ${active ? "is-on" : ""}" type="button" data-act="react"
      aria-pressed="${Boolean(active)}" title="React — ${active ? esc(active.label) : "choose a reaction"}">
    <span class="v-icon">${active ? `<span class="rx-emoji">${active.emoji}</span>` : `<svg viewBox="0 0 24 24"><path d="M12 21s-8-4.9-8-10.2A4.8 4.8 0 0 1 12 7a4.8 4.8 0 0 1 8 3.8C20 16.1 12 21 12 21z"/></svg>`}</span>
    <em data-count="like">${formatCount(post.likeCount)}</em>
  </button>`;
}

export function videoCardHtml(video, { saved = false, isFollowingAuthor = false, reaction = "", reposted = false, repostOf = null, myUid = "" } = {}) {
  const captionHtml = video.caption ? richText(video.caption) : "";
  const isPhoto = video.mediaType === "photo";
  const author = { uid: video.uid, username: video.username, displayName: video.displayName, photoURL: video.photoURL };
  const repostedBy = repostOf?.displayName || repostOf?.username;

  const mediaHtml = isPhoto
    ? `
      <div class="photo-carousel" aria-label="Photo post">
        ${(video.images || []).map((src) => `<img src="${esc(src)}" alt="" loading="lazy" draggable="false" data-zoom />`).join("")}
      </div>
      ${(video.images || []).length > 1
        ? `<div class="photo-dots" aria-hidden="true">${video.images.map((_, i) => `<span class="${i === 0 ? "is-on" : ""}"></span>`).join("")}</div>`
        : ""}`
    : `
      <video class="video-player" src="${esc(video.videoUrl)}" poster="${esc(video.thumbnailUrl || "")}" loop playsinline preload="metadata" data-video-id="${esc(video.id)}"></video>
      <div class="video-overlay-top"><div class="video-progress"><span></span></div></div>
      <button class="video-play-toggle" type="button" aria-label="Play / Pause"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>`;

  return `
  <article class="video-card ${isPhoto ? "is-photo" : ""} ${repostOf ? "is-repost" : ""}" data-video-id="${esc(video.id)}" tabindex="0">
    ${repostOf
      ? `<a class="repost-byline" href="#/u/${esc(repostOf.username || "")}">
          ${avatar({ photoURL: repostOf.photoURL, username: repostOf.username }, "xs")}
          <span>@${esc(repostBylineName(repostOf))} reposted · ${timeAgo(repostOf.createdAt)}</span>
        </a>`
      : ""}
    <div class="video-wrap">
      ${mediaHtml}

      <button class="video-report" type="button" data-act="report" aria-label="Report" title="Report">
        <svg viewBox="0 0 24 24"><path d="M5 3v18M5 4h11l-1.5 3L16 10H5"/></svg>
      </button>

      <div class="video-right-actions">
        <a class="action-avatar" href="#/u/${esc(video.username)}" data-act="profile">
          ${avatar(author, "md")}
          ${isFollowingAuthor || video.uid === myUid ? "" : `<span class="follow-plus" data-act="follow" title="Follow">+</span>`}
        </a>

        ${reactionButtonHtml(video, reaction)}

        <button class="v-action" type="button" data-act="comment">
          <span class="v-icon"><svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1.5-4.5A8 8 0 1 1 21 12z"/></svg></span>
          <em data-count="comment">${formatCount(video.commentCount)}</em>
        </button>

        <button class="v-action ${reposted ? "is-on" : ""}" type="button" data-act="repost" aria-pressed="${reposted}" title="Repost to your profile">
          <span class="v-icon"><svg viewBox="0 0 24 24"><path d="M4 9V7a3 3 0 0 1 3-3h9l-2-2m2 2-2 2m4 8v2a3 3 0 0 1-3 3H5l2 2m-2-2 2-2"/></svg></span>
          <em data-count="repost">${formatCount(video.repostCount)}</em>
        </button>

        <button class="v-action ${saved ? "is-on" : ""}" type="button" data-act="save" aria-pressed="${saved}">
          <span class="v-icon"><svg viewBox="0 0 24 24"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/></svg></span>
          <em>Save</em>
        </button>

        <button class="v-action" type="button" data-act="share">
          <span class="v-icon"><svg viewBox="0 0 24 24"><path d="M12 3v10M12 3l-4 4M12 3l4 4M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/></svg></span>
          <em>Share</em>
        </button>

        ${isPhoto ? "" : `
        <button class="v-action v-sound" type="button" data-act="sound-play" title="Play this track">
          <span class="v-icon sound-disc"><span class="disc-inner">${avatar(author, "sm")}</span></span>
        </button>`}
      </div>

      <div class="video-bottom-meta">
        <a class="video-author" href="#/u/${esc(video.username)}">
          <strong>@${esc(video.username)}</strong>
          <span class="video-time">· ${timeAgo(video.createdAt)}</span>
        </a>
        ${captionHtml ? `<p class="video-caption">${captionHtml}</p>` : ""}
        ${reactionSummaryHtml(video)}
        ${isPhoto
          ? `<span class="video-sound is-static"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg><span class="marquee"><span>Photo post${video.images?.length > 1 ? ` · ${video.images.length} photos` : ""}</span></span></span>`
          : `<span class="video-sound ${isPlayingTrack(video.soundId) ? "is-playing" : ""}" data-sound-row>
              <button class="sound-play-mini" type="button" data-act="sound-play" aria-label="Play track">
                <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
              </button>
              <a class="marquee" href="${video.soundId ? `#/sound/${esc(video.soundId)}` : "#/music"}">
                <span>${esc(video.soundTitle || "Original audio")}${video.licenceLabel ? ` · ${esc(video.licenceLabel)}` : ` — @${esc(video.username)}`}</span>
              </a>
            </span>`}
      </div>

      ${isPhoto ? "" : `
      <div class="video-volume" data-act="mute">
        <svg viewBox="0 0 24 24" class="vol-on"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M17.5 6.5a8 8 0 0 1 0 11"/></svg>
        <svg viewBox="0 0 24 24" class="vol-off"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
      </div>`}
    </div>
  </article>`;
}

function repostBylineName(repost) {
  return repost.displayName || repost.username || "someone";
}

/** Reaction picker anchored to a card. Closes on outside click or Escape. */
function openReactionPicker(anchor, onPick) {
  document.querySelector(".rx-picker")?.remove();
  const picker = document.createElement("div");
  picker.className = "rx-picker";
  picker.setAttribute("role", "menu");
  picker.innerHTML = REACTIONS.map(
    (r) => `<button type="button" role="menuitem" data-reaction="${r.key}" title="${esc(r.label)}">
      <span>${r.emoji}</span><em>${esc(r.label)}</em>
    </button>`
  ).join("");
  document.body.appendChild(picker);

  const rect = anchor.getBoundingClientRect();
  const width = picker.offsetWidth || 260;
  picker.style.top = `${Math.max(12, rect.top - picker.offsetHeight - 10)}px`;
  picker.style.left = `${Math.min(window.innerWidth - width - 12, Math.max(12, rect.left))}px`;

  const close = () => {
    picker.remove();
    document.removeEventListener("pointerdown", onDoc, true);
    document.removeEventListener("keydown", onKey, true);
  };
  const onDoc = (event) => {
    if (!picker.contains(event.target) && !anchor.contains(event.target)) close();
  };
  const onKey = (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    }
  };
  setTimeout(() => document.addEventListener("pointerdown", onDoc, true), 0);
  document.addEventListener("keydown", onKey, true);

  picker.addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-reaction]");
    if (!btn) return;
    close();
    await onPick(btn.dataset.reaction);
  });
}

/** Paint the like/repost/save state on cards after a live update. */
export async function hydrateVideoStates(root, uid) {
  const cards = [...root.querySelectorAll(".video-card[data-video-id]")];
  if (!cards.length) return;
  const ids = cards.map((c) => c.dataset.videoId);
  if (!uid) {
    cards.forEach((card) => card.querySelectorAll("[data-act]").forEach((b) => b.removeAttribute("disabled")));
    return;
  }
  const [liked, saved, reactions, reposts] = await Promise.all([
    getLikedVideoIds(uid, ids).catch(() => new Set()),
    getSavedVideoIds(uid, ids).catch(() => new Set()),
    getMyPostReactions(uid, ids).catch(() => new Map()),
    getMyRepostedIds(uid, ids).catch(() => new Set()),
  ]);
  cards.forEach((card) => {
    const id = card.dataset.videoId;
    const likeBtn = card.querySelector('[data-act="react"]');
    const saveBtn = card.querySelector('[data-act="save"]');
    const repostBtn = card.querySelector('[data-act="repost"]');
    const mine = reactions.get(id) || (liked.has(id) ? "like" : "");
    if (likeBtn) {
      likeBtn.dataset.reaction = mine || "";
      likeBtn.classList.toggle("is-on", Boolean(mine));
      likeBtn.setAttribute("aria-pressed", String(Boolean(mine)));
      const icon = likeBtn.querySelector(".v-icon");
      if (icon) {
        icon.innerHTML = mine
          ? `<span class="rx-emoji">${REACTION_BY_KEY[mine]?.emoji || "👍"}</span>`
          : `<svg viewBox="0 0 24 24"><path d="M12 21s-8-4.9-8-10.2A4.8 4.8 0 0 1 12 7a4.8 4.8 0 0 1 8 3.8C20 16.1 12 21 12 21z"/></svg>`;
      }
    }
    if (saveBtn) {
      saveBtn.classList.toggle("is-on", saved.has(id));
      saveBtn.setAttribute("aria-pressed", String(saved.has(id)));
    }
    if (repostBtn) {
      repostBtn.classList.toggle("is-on", reposts.has(id));
      repostBtn.setAttribute("aria-pressed", String(reposts.has(id)));
    }
  });
}

export function bindVideoActions(root, ctx) {
  if (root.dataset.videoBound === "1") return;
  root.dataset.videoBound = "1";

  root.addEventListener(
    "scroll",
    (event) => {
      const carousel = event.target?.closest?.(".photo-carousel");
      if (!carousel) return;
      const card = carousel.closest(".video-card");
      if (!card) return;
      const index = Math.round(carousel.scrollLeft / Math.max(1, carousel.clientWidth));
      card.querySelectorAll(".photo-dots span").forEach((dot, i) => dot.classList.toggle("is-on", i === index));
    },
    true
  );

  root.addEventListener("contextmenu", (event) => {
    const btn = event.target.closest('[data-act="react"]');
    if (!btn) return;
    event.preventDefault();
    startReact(btn);
  });

  root.addEventListener("click", async (event) => {
    const card = event.target.closest(".video-card[data-video-id]");
    if (!card) return;
    const videoId = card.dataset.videoId;
    const video = ctx.videoCache.get(videoId) || { id: videoId };
    const btn = event.target.closest("[data-act]");
    const act = btn?.dataset.act;

    if (!act) {
      if (event.target.closest("a")) return;
      const vid = card.querySelector("video");
      if (vid) {
        if (vid.paused) vid.play().catch(() => {});
        else vid.pause();
      }
      return;
    }
    if (act === "profile") return;

    if (act === "react") {
      // A quick tap on an already-reacted post removes it; otherwise open the
      // picker (so "like" is never the only option, and never fake).
      if (!ctx.state.profile) return ctx.requireAuth();
      const isOn = btn.classList.contains("is-on");
      if (isOn && !event.shiftKey) {
        await commitReaction(video, btn, currentReaction(ctx, video, btn) || "like");
        return;
      }
      openReactionPicker(btn, (key) => commitReaction(video, btn, key));
      return;
    }

    if (act === "like") {
      if (!ctx.state.profile) return ctx.requireAuth();
      await commitReaction(video, card.querySelector('[data-act="react"]') || btn, "like");
      return;
    }

    if (act === "save") {
      if (!ctx.state.profile) return ctx.requireAuth();
      const wasOn = btn.classList.contains("is-on");
      btn.classList.toggle("is-on", !wasOn);
      try {
        const isSaved = await toggleVideoSave(ctx.state.profile.uid, video);
        toast(isSaved ? "Saved to your collection" : "Removed from saved", "success", 2000);
      } catch (err) {
        btn.classList.toggle("is-on", wasOn);
        toast(err?.message || "Could not save that", "error");
      }
      return;
    }

    if (act === "repost") {
      if (!ctx.state.profile) return ctx.requireAuth();
      if (video.uid === ctx.state.profile.uid) {
        toast("This is your post — it's already on your profile.", "info");
        return;
      }
      try {
        const didRepost = await repostPost(ctx.state.profile.uid, ctx.state.profile, video);
        btn.classList.toggle("is-on", Boolean(didRepost));
        const countNode = btn.querySelector('[data-count="repost"]');
        if (countNode) {
          const cur = Number(countNode.dataset.raw ?? readCount(countNode));
          countNode.dataset.raw = String(Math.max(0, cur + (didRepost ? 1 : -1)));
          countNode.textContent = formatCount(Math.max(0, cur + (didRepost ? 1 : -1)));
        }
        toast(didRepost ? "Reposted to your profile" : "Repost removed", "success", 2200);
      } catch (err) {
        toast(err?.message || "Could not repost", "error");
      }
      return;
    }

    if (act === "comment") {
      openCommentsModal(ctx, video);
      return;
    }

    if (act === "share") {
      openShareModal(ctx, {
        title: `@${video.username || "xacheus"} on Xacheus`,
        text: (video.caption || "Watch this on Xacheus").slice(0, 120),
        url: `${location.origin}${location.pathname}#/video/${videoId}`,
        onShared: () => bumpVideoShare(videoId).catch(() => {}),
      });
      return;
    }

    if (act === "sound-play" || act === "sound") {
      const full = await ctx.videoCache.get(video.id)?.sound ? ctx.videoCache.get(video.id) : video;
      const sound = await loadPostSound(full);
      if (!sound) {
        ctx.navigate(full.soundId ? `#/sound/${full.soundId}` : "#/music");
        return;
      }
      if (act === "sound-play" && isCurrentTrack(sound.id)) toggleTrack(sound);
      else playQueue([sound]);
      return;
    }

    if (act === "report") {
      if (!ctx.state.profile) return ctx.requireAuth();
      openReportModal(ctx, {
        targetType: "video",
        targetId: videoId,
        targetOwnerUid: video.uid || "",
        targetLabel: video.caption ? `@${video.username}: ${video.caption.slice(0, 80)}` : `@${video.username}'s post`,
      });
      return;
    }

    if (act === "follow") {
      if (!ctx.state.profile) return ctx.requireAuth();
      if (video.uid === ctx.state.profile.uid) return;
      event.preventDefault();
      btn.textContent = "…";
      try {
        const target = {
          uid: video.uid,
          username: video.username,
          displayName: video.displayName,
          photoURL: video.photoURL,
        };
        const followed = await toggleFollow(ctx.state.profile.uid, ctx.state.profile, target);
        toast(followed ? `Following @${video.username}` : `Unfollowed @${video.username}`, "success");
        if (followed) btn.remove();
        else btn.textContent = "+";
      } catch (err) {
        toast(err?.message || "Could not follow", "error");
        btn.textContent = "+";
      }
      return;
    }

    if (act === "mute") {
      const vid = card.querySelector("video");
      if (vid) {
        vid.muted = !vid.muted;
        card.classList.toggle("is-muted", vid.muted);
      }
      return;
    }
  });

  async function startReact(btn) {
    if (!ctx.state.profile) return ctx.requireAuth();
    const card = btn.closest(".video-card");
    const video = ctx.videoCache.get(card?.dataset.videoId) || {};
    openReactionPicker(btn, (key) => commitReaction(video, btn, key));
  }

  function currentReaction(_c2, video, btn) {
    return btn?.dataset.reaction || ctx.videoCache.get(video.id)?.myReaction || "";
  }

  /** One write, then let the snapshot re-render the number. */
  async function commitReaction(video, btn, key) {
    if (!ctx.state.profile) return ctx.requireAuth();
    if (!video?.id) return;
    if (btn?.dataset.busy === "1") return;
    btn.dataset.busy = "1";
    try {
      const next = await reactToPost(ctx.state.profile.uid, ctx.state.profile, video, key);
      if (btn) {
        btn.dataset.reaction = next || "";
        btn.classList.toggle("is-on", Boolean(next));
        const icon = btn.querySelector(".v-icon");
        if (icon) {
          icon.innerHTML = next
            ? `<span class="rx-emoji">${REACTION_BY_KEY[next].emoji}</span>`
            : `<svg viewBox="0 0 24 24"><path d="M12 21s-8-4.9-8-10.2A4.8 4.8 0 0 1 12 7a4.8 4.8 0 0 1 8 3.8C20 16.1 12 21 12 21z"/></svg>`;
        }
      }
      const cached = ctx.videoCache.get(video.id);
      if (cached) cached.myReaction = next || "";
      if (typeof ctx.refreshVideoCounts === "function") ctx.refreshVideoCounts(video.id);
    } catch (err) {
      toast(err?.message || "Could not save your reaction", "error");
    } finally {
      if (btn) btn.dataset.busy = "0";
    }
  }
}

function readCount(node) {
  const text = String(node?.textContent || "0").replace(/[^0-9]/g, "");
  return Number(text || 0);
}

/** Resolve the sound attached to a post (Firestore `sounds` doc). */
async function loadPostSound(video) {
  if (!video?.soundId) return null;
  const sound = await getSound(video.soundId).catch(() => null);
  if (!sound) return null;
  return {
    id: video.soundId,
    title: sound.title || video.soundTitle || "Sound",
    artist: sound.artist || `@${video.username}`,
    album: sound.album || "",
    audioUrl: sound.audioUrl,
    duration: sound.duration || 0,
    artwork: sound.coverUrl || "",
    licenceUrl: sound.licenceUrl || "",
    licenceLabel: sound.licenceLabel || "",
    itemUrl: sound.sourceUrl || "",
    attribution: video.attribution || "",
    soundId: video.soundId,
    source: sound.source || "xacheus",
  };
}

/* ------------------------------------------------------------------ */
/* comments: threads, likes, replies, deletion                         */
/* ------------------------------------------------------------------ */

export function openCommentsModal(ctx, video) {
  // Guests can read the whole thread; posting, replying and liking prompt
  // sign-in (the security rules allow public reads of the comments).
  let unsub = null;
  let comments = [];
  const myUid = ctx.state.profile?.uid || "";
  const isGuest = !ctx.state.profile;

  const modal = openModal({
    title: `Comments · @${video.username || "xacheus"}`,
    size: "md",
    body: `
      <div class="comments-modal">
        <div class="comments-list" data-comments>
          <div class="loader-row"><span class="spinner"></span> Loading…</div>
        </div>
        ${
          isGuest
            ? `<div class="comment-form comment-form--guest">
                 <button class="btn btn-primary btn-sm btn-block" type="button" data-comment-login>Log in to comment</button>
               </div>`
            : `<form class="comment-form" data-comment-form>
                 <input type="text" data-comment-input maxlength="500" placeholder="Add a comment…" autocomplete="off" />
                 <button class="btn btn-primary btn-sm" type="submit">Post</button>
               </form>`
        }
        <p class="comment-reply-hint" data-reply-hint hidden></p>
      </div>`,
    onClose() {
      unsub?.();
    },
    onMount(root) {
      const list = root.querySelector("[data-comments]");
      const form = root.querySelector("[data-comment-form]");
      const input = root.querySelector("[data-comment-input]");
      const hint = root.querySelector("[data-reply-hint]");
      let replyTo = null;

      root.querySelector("[data-comment-login]")?.addEventListener("click", () => ctx.requireAuth());

      const setReplyTarget = (comment) => {
        replyTo = comment;
        hint.hidden = !comment;
        if (comment) hint.innerHTML = `Replying to <strong>@${esc(comment.username)}</strong> <button type="button" class="link-btn" data-cancel-reply>cancel</button>`;
        input?.focus();
      };
      hint.addEventListener("click", (event) => {
        if (event.target.closest("[data-cancel-reply]")) setReplyToNull();
      });
      function setReplyToNull() {
        replyTo = null;
        hint.hidden = true;
        input?.focus();
      }

      const render = (rows) => {
        comments = rows;
        if (!rows.length) {
          list.innerHTML = `<p class="panel-empty">No comments yet — be the first.</p>`;
          return;
        }
        const roots = rows.filter((c) => !c.parentId);
        const kidsOf = (id) => rows.filter((c) => c.parentId === id).sort((a, b) => timeAgo(a.createdAt).localeCompare(timeAgo(b.createdAt)));
        list.innerHTML = roots
          .map((c) => commentHtml(c, kidsOf(c.id), { myUid, video, liked: likedSet.has(c.id) }))
          .join("");
      };

      const likedSet = new Set();

      form?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        if (video.uid && video.uid !== myUid) {
          const gate = await canComment({ uid: video.uid });
          if (!gate.ok) {
            toast(gate.reason, "error");
            return;
          }
        }
        input.disabled = true;
        try {
          if (replyTo) await replyToPostComment(myUid, ctx.state.profile, video, replyTo.parentIdFor, text);
          else await addVideoComment(myUid, ctx.state.profile, video, text);
          input.value = "";
          replyTo = null;
          hint.hidden = true;
          // The snapshot listener repaints; no client-side count fudging.
        } catch (err) {
          toast(err?.message || "Could not post that comment", "error");
        } finally {
          input.disabled = false;
          input.focus();
        }
      });

      list.addEventListener("click", async (event) => {
        const actionEl = event.target.closest("[data-comment-act]");
        if (!actionEl) {
          const avatarLink = event.target.closest("a[data-open-user]");
          if (avatarLink) closeModal();
          return;
        }
        const id = actionEl.closest("[data-comment-id]")?.dataset.commentId;
        const comment = comments.find((c) => c.id === id);
        if (!comment) return;
        const action = actionEl.dataset.commentAct;

        if (action === "reply") {
          if (!ctx.state.profile) return ctx.requireAuth();
          setReplyTarget({ ...comment, parentIdFor: comment.parentId || comment.id });
          return;
        }
        if (action === "like") {
          if (!ctx.state.profile) return ctx.requireAuth();
          try {
            const nowLiked = await likePostComment(myUid, ctx.state.profile, video, comment.id);
            if (nowLiked) likedSet.add(comment.id);
            else likedSet.delete(comment.id);
            render(comments);
          } catch (err) {
            toast(err?.message || "Could not like that comment", "error");
          }
          return;
        }
        if (action === "report-comment") {
          openReportModal(ctx, {
            targetType: "comment",
            targetId: comment.id,
            targetOwnerUid: comment.uid,
            targetLabel: `${comment.displayName || comment.username}: ${(comment.text || "").slice(0, 80)}`,
          });
          return;
        }
        if (action === "delete") {
          const ok = await confirmDialog({
            title: "Delete comment?",
            body: "This removes the comment (and its replies from the thread) for everyone.",
            confirmLabel: "Delete",
            danger: true,
          });
          if (!ok) return;
          try {
            await deletePostComment(myUid, video, comment.id);
            toast("Comment deleted", "success", 1800);
          } catch (err) {
            toast(err?.message || "Could not delete that comment", "error");
          }
        }
      });

      // Hydrate which comments I liked, then paint.
      getLikedCommentIds(myUid, video.id, comments.map((c) => c.id)).then((ids) => {
        ids.forEach((id) => likedSet.add(id));
        render(comments);
      });

      unsub = watchPostComments(video.id, (rows) => {
        render(rows);
        if (typeof ctx.refreshVideoCounts === "function") ctx.refreshVideoCounts(video.id);
      });
    },
  });
  return modal;
}

function commentHtml(comment, replies, { myUid, video, liked }) {
  const mine = comment.uid === myUid;
  const canDelete = Boolean(myUid) && (mine || video.uid === myUid);
  return `
  <div class="comment ${replies.length ? "has-replies" : ""}" data-comment-id="${esc(comment.id)}">
    <a href="#/u/${esc(comment.username)}" data-open-user>${avatar({ username: comment.username, displayName: comment.displayName, photoURL: comment.photoURL }, "sm")}</a>
    <div class="comment-body">
      <header>
        <strong>${esc(comment.displayName || comment.username)}</strong>
        <em>@${esc(comment.username)}</em> · <span>${timeAgo(comment.createdAt)}</span>
      </header>
      <p>${richText(comment.text)}</p>
      <div class="comment-actions">
        <button type="button" class="comment-act ${liked ? "is-on" : ""}" data-comment-act="like" title="Like comment">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-8-4.9-8-10.2A4.8 4.8 0 0 1 12 7a4.8 4.8 0 0 1 8 3.8C20 16.1 12 21 12 21z"/></svg>
          <span>${Number(comment.likeCount) > 0 ? formatCount(comment.likeCount) : ""}</span>
        </button>
        <button type="button" class="comment-act" data-comment-act="reply">Reply</button>
        ${canDelete ? `<button type="button" class="comment-act danger" data-comment-act="delete">Delete</button>` : ""}
        ${!mine ? `<button type="button" class="comment-act" data-comment-act="report-comment">Report</button>` : ""}
      </div>
      ${Number(comment.replyCount) > 0 && !replies.length ? `<span class="comment-reply-count">${comment.replyCount} ${comment.replyCount === 1 ? "reply" : "replies"} loading…</span>` : ""}
      ${replies.length ? `<div class="comment-replies">${replies.map((r) => replyHtml(r, myUid, video)).join("")}</div>` : ""}
    </div>
  </div>`;
}

function replyHtml(reply, myUid, video) {
  const mine = reply.uid === myUid;
  return `
  <div class="comment is-reply" data-comment-id="${esc(reply.id)}">
    <a href="#/u/${esc(reply.username)}" data-open-user>${avatar({ username: reply.username, displayName: reply.displayName, photoURL: reply.photoURL }, "xs")}</a>
    <div class="comment-body">
      <header>
        <strong>${esc(reply.displayName || reply.username)}</strong>
        ${reply.replyToUsername ? `<em class="reply-to">→ @${esc(reply.replyToUsername)}</em>` : ""}
        <span>· ${timeAgo(reply.createdAt)}</span>
      </header>
      <p>${richText(reply.text)}</p>
      <div class="comment-actions">
        <button type="button" class="comment-act" data-comment-act="like"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-8-4.9-8-10.2A4.8 4.8 0 0 1 12 7a4.8 4.8 0 0 1 8 3.8C20 16.1 12 21 12 21z"/></svg><span>${Number(reply.likeCount) > 0 ? formatCount(reply.likeCount) : ""}</span></button>
        <button type="button" class="comment-act" data-comment-act="reply">Reply</button>
        ${mine || video.uid === myUid ? `<button type="button" class="comment-act danger" data-comment-act="delete">Delete</button>` : ""}
      </div>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ */
/* share sheet: system share, copy link, or send it to a conversation   */
/* ------------------------------------------------------------------ */

export function openShareModal(ctx, { title = "Xacheus", text = "", url, onShared }) {
  const shareUrl = url || location.href;
  openModal({
    title: "Share",
    size: "sm",
    body: `
      <div class="share-sheet">
        <div class="share-preview">
          <div class="share-preview-brand">
            ${brandSlotHtml({ role: "mark", size: "sm", linked: false })}
            <em>xacheus · create · watch · connect</em>
          </div>
          <strong>${esc(title)}</strong>
          <p>${esc(text || shareUrl)}</p>
          <code>${esc(shareUrl)}</code>
        </div>
        <div class="share-row">
          <button class="btn btn-primary" type="button" data-share="copy">Copy link</button>
          <button class="btn btn-outline" type="button" data-share="system" ${navigator.share ? "" : "disabled"}>Device share</button>
        </div>
        <div class="share-dm" data-share-dm>
          <p class="share-section-title">Send in a message</p>
          <div class="share-people" data-people><div class="loader-row"><span class="spinner"></span> Loading your chats…</div></div>
          <form class="share-search" data-share-search>
            <input type="search" placeholder="Search a username…" data-q maxlength="20" autocomplete="off" />
            <button class="btn btn-sm btn-outline" type="submit">Find</button>
          </form>
          <div class="share-people share-search-results" data-search-people hidden></div>
        </div>
      </div>`,
    onMount(root, close) {
      const people = root.querySelector("[data-people]");
      const searchPeople = root.querySelector("[data-search-people]");
      let conversations = [];

      const paint = (list, target) => {
        if (!list.length) {
          target.innerHTML = `<p class="panel-empty">No conversations yet.</p>`;
          return;
        }
        target.innerHTML = list.map((p) => `
          <button class="share-person" type="button" data-send="${esc(p.uid)}" data-name="${esc(p.displayName || p.username)}">
            ${avatar(p, "sm")}
            <span class="share-person-text">
              <strong>${esc(p.displayName || p.username)}</strong>
              <em>@${esc(p.username)}</em>
            </span>
            <span class="share-person-action">Send</span>
          </button>`).join("");
      };

      let stopWatch = null;
      root._closeShare = () => stopWatch?.();
      if (!ctx.state.profile) {
        people.innerHTML = `<p class="panel-empty">Sign in to send this in a message.</p>`;
        root.querySelector("[data-share-search]")?.remove();
      }
      stopWatch = ctx.state.profile
        ? watchConversations(ctx.state.profile.uid, async (list) => {
        conversations = list;
        const uids = [...new Set(list.map((c) => (c.participants || []).find((u) => u !== ctx.state.profile.uid)).filter(Boolean))];
        const profiles = (await Promise.all(uids.slice(0, 6).map((uid) => getProfile(uid).catch(() => null)))).filter(Boolean);
        paint(profiles, people);
        })
        : () => {};

      root.querySelector("[data-share='copy']").addEventListener("click", () => {
        copyText(shareUrl);
        onShared?.();
        close();
      });

      root.querySelector("[data-share='system']")?.addEventListener("click", async () => {
        try {
          await navigator.share({ title, text, url: shareUrl });
          onShared?.();
          close();
        } catch {
          /* the user dismissed the sheet */
        }
      });

      root.querySelector("[data-share-search]").addEventListener("submit", async (event) => {
        event.preventDefault();
        const term = root.querySelector("[data-q]").value.trim().replace(/^@/, "");
        if (!term) return;
        searchPeople.hidden = false;
        searchPeople.innerHTML = `<div class="loader-row"><span class="spinner"></span> Searching…</div>`;
        const profile = await getProfileByUsername(term.toLowerCase()).catch(() => null);
        paint(profile ? [profile] : [], searchPeople);
        if (!profile) searchPeople.innerHTML = `<p class="panel-empty">No @${esc(term)} found.</p>`;
      });

      const sendTo = async (targetUid, name) => {
        if (!ctx.state.profile) return ctx.requireAuth();
        const button = root.querySelector(`[data-send="${targetUid}"]`);
        if (button) {
          button.disabled = true;
          button.querySelector(".share-person-action").textContent = "Sending…";
        }
        try {
          const cid = await openConversation(ctx.state.profile, { uid: targetUid });
          const { sendDirectMessage } = await import("../data.js");
          await sendDirectMessage(cid, ctx.state.profile, targetUid, `${text ? `${text}\n` : ""}${shareUrl}`);
          onShared?.();
          toast(`Sent to @${name}`, "success", 2200);
          close();
        } catch (err) {
          toast(err?.message || "Couldn't send that", "error");
          if (button) {
            button.disabled = false;
            button.querySelector(".share-person-action").textContent = "Send";
          }
        }
      };

      root.addEventListener("click", (event) => {
        const btn = event.target.closest("[data-send]");
        if (!btn) return;
        sendTo(btn.dataset.send, btn.dataset.name);
      });

    },
    onClose() {
      stopWatch?.();
    },
  });
}

/** Report anything: post, profile, comment, sound, live, conversation. */
export function openReportModal(ctx, { targetType, targetId, targetOwnerUid = "", targetLabel = "" }) {
  if (!ctx.state.profile) return ctx.requireAuth();
  const reasons = REPORT_REASONS || [];
  openModal({
    title: "Report",
    size: "sm",
    body: `
      <form id="report-form" class="form-grid">
        <p class="modal-text">Report this ${esc(targetType.replace(/([A-Z])/g, " $1").toLowerCase())}. Our moderation team reviews every report.</p>
        ${targetLabel ? `<p class="notice-info">${esc(targetLabel)}</p>` : ""}
        <label class="field">
          <span>Reason</span>
          <select id="report-reason" required>
            <option value="" disabled selected>Choose a reason…</option>
            ${reasons.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span>Details <em>(optional)</em></span>
          <textarea id="report-details" rows="3" maxlength="500" placeholder="Anything that helps us review this…"></textarea>
        </label>
        <button class="btn btn-primary btn-block" type="submit">Submit report</button>
      </form>`,
    onMount(root, close) {
      const form = root.querySelector("#report-form");
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const reason = root.querySelector("#report-reason").value;
        const details = root.querySelector("#report-details").value.trim();
        if (!reason) return toast("Pick a reason to report.", "error");
        const btn = form.querySelector("button[type='submit']");
        btn.disabled = true;
        btn.textContent = "Submitting…";
        try {
          await submitReport({
            reporterUid: ctx.state.profile.uid,
            reporterName: ctx.state.profile.displayName,
            reporterUsername: ctx.state.profile.username,
            targetType,
            targetId,
            targetOwnerUid,
            reason,
            details,
          });
          toast("Thanks — our team will review this.", "success", 4000);
          close();
        } catch (error) {
          toast(error?.message || "Could not submit report.", "error", 5000);
          btn.disabled = false;
          btn.textContent = "Submit report";
        }
      });
    },
  });
}

export function userRowHtml(user, { action = "" } = {}) {
  return `
    <div class="user-row" data-uid="${esc(user.uid || user.id)}">
      <a class="user-row-main" href="#/u/${esc(user.username || user.uid)}">
        ${avatar(user, "md")}
        <span class="user-row-text">
          <strong>${esc(user.displayName || user.username || "Xacheus user")}${user.verified ? ' <span class="verified">✓</span>' : ""}</strong>
          <em>@${esc(user.username || "user")} · ${esc(user.role || "user")}</em>
          ${user.bio ? `<span class="user-row-bio">${esc(user.bio)}</span>` : ""}
        </span>
      </a>
      ${action ? `<button class="btn btn-sm ${action === "Following" ? "btn-outline" : "btn-primary"}" type="button" data-act="follow">${esc(action)}</button>` : ""}
    </div>`;
}
