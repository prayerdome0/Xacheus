/** Xacheus — Video components (Phase 1) */

import {
  addVideoComment,
  bumpVideoShare,
  toggleVideoLike,
  toggleVideoSave,
  getLikedVideoIds,
  getSavedVideoIds,
  isFollowing,
  toggleFollow,
  toggleBlock,
  reportVideo,
} from "../data.js";
import { avatar, esc, formatCount, gradientFor, timeAgo, toast, openModal, confirmDialog, copyText, richText } from "../ui.js";
import { deliveryUrl, uploadAudio } from "../cloudinary.js";

export function liveThumb(live) {
  if (live?.thumbnailUrl) return `<img src="${esc(live.thumbnailUrl)}" alt="" loading="lazy" />`;
  const [from, to] = gradientFor(live?.username || live?.id || "live");
  return `<span class="live-thumb-fallback" style="background-image:linear-gradient(135deg,${from},${to})"></span>`;
}

export function postThumb(video) {
  return video.thumbnailUrl || (Array.isArray(video.images) ? video.images[0] : "") || "";
}

export function videoCardHtml(video, { liked = false, saved = false, isFollowingAuthor = false } = {}) {
  const captionHtml = video.caption ? richText(video.caption) : "";
  const soundTitle = esc(video.soundTitle || (video.soundId ? "Original sound" : "Original audio"));
  const isPhoto = video.mediaType === "photo";
  const author = {
    uid: video.uid,
    username: video.username,
    displayName: video.displayName,
    photoURL: video.photoURL,
  };

  const mediaHtml = isPhoto
    ? `
      <div class="photo-carousel" aria-label="Photo post">
        ${(video.images || []).map((src) => `<img src="${esc(src)}" alt="" loading="lazy" draggable="false" />`).join("")}
      </div>
      ${(video.images || []).length > 1
        ? `<div class="photo-dots" aria-hidden="true">${video.images.map((_, i) => `<span class="${i === 0 ? "is-on" : ""}"></span>`).join("")}</div>`
        : ""}`
    : `
      <video
        class="video-player"
        src="${esc(deliveryUrl(video.videoUrl, { dataSaver: localStorage.getItem("xacheus_dataSaver") === "1" }))}"
        poster="${esc(video.thumbnailUrl || "")}"
        loop
        playsinline
        preload="${localStorage.getItem("xacheus_dataSaver") === "1" ? "none" : "metadata"}"
        data-video-id="${esc(video.id)}"
      ></video>

      <div class="video-overlay-top">
        <div class="video-progress"><span></span></div>
      </div>

      <button class="video-play-toggle" type="button" aria-label="Play / Pause">
        <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
      </button>`;

  return `
  <article class="video-card ${isPhoto ? "is-photo" : ""}" data-video-id="${esc(video.id)}" tabindex="0" aria-label="${esc((isPhoto ? "Photo post" : "Video post") + " by @" + (video.username || "user") + (video.caption ? ": " + video.caption : ""))}">
    <div class="video-wrap">
      ${mediaHtml}

      <div class="video-right-actions">
        <a class="action-avatar" href="#/u/${esc(video.username)}" data-act="profile">
          ${avatar(author, "md")}
          ${isFollowingAuthor ? "" : `<span class="follow-plus" data-act="follow" title="Follow">+</span>`}
        </a>

        <button class="v-action ${liked ? "is-on" : ""}" type="button" data-act="like" aria-pressed="${liked}">
          <span class="v-icon"><svg viewBox="0 0 24 24"><path d="M12 21s-8-4.9-8-10.2A4.8 4.8 0 0 1 12 7a4.8 4.8 0 0 1 8 3.8C20 16.1 12 21 12 21z"/></svg></span>
          <em data-count="like">${formatCount(video.likeCount)}</em>
        </button>

        ${video.allowComments === false ? "" : `<button class="v-action" type="button" data-act="comment">
          <span class="v-icon"><svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1.5-4.5A8 8 0 1 1 21 12z"/></svg></span>
          <em data-count="comment">${formatCount(video.commentCount)}</em>
        </button>`}

        <button class="v-action ${saved ? "is-on" : ""}" type="button" data-act="save" aria-pressed="${saved}">
          <span class="v-icon"><svg viewBox="0 0 24 24"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/></svg></span>
          <em>Save</em>
        </button>

        <button class="v-action" type="button" data-act="share">
          <span class="v-icon"><svg viewBox="0 0 24 24"><path d="M12 3v10M12 3l-4 4M12 3l4 4M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/></svg></span>
          <em>Share</em>
        </button>

        <button class="v-action" type="button" data-act="report" aria-label="Report post">
          <span class="v-icon"><svg viewBox="0 0 24 24"><path d="M5 21V4m0 0c4-3 7 3 14 0v9c-7 3-10-3-14 0"/></svg></span>
          <em>Report</em>
        </button>

        <button class="v-action" type="button" data-act="block" aria-label="Block creator">
          <span class="v-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/></svg></span>
          <em>Block</em>
        </button>

        <button class="v-action" type="button" data-act="not-interested" aria-label="Not interested">
          <span class="v-icon">−</span><em>Not for me</em>
        </button>

        ${isPhoto ? "" : `
        <button class="v-action v-sound" type="button" data-act="sound">
          <span class="v-icon sound-disc"><span class="disc-inner">${avatar(author, "sm")}</span></span>
        </button>`}
      </div>

      <div class="video-bottom-meta">
        <a class="video-author" href="#/u/${esc(video.username)}">
          <strong>@${esc(video.username)}</strong>
          <span class="video-time">· ${timeAgo(video.createdAt)}</span>
        </a>
        ${captionHtml ? `<p class="video-caption">${captionHtml}</p>` : ""}
        ${isPhoto
          ? `<span class="video-sound is-static"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg><span class="marquee"><span>Photo post${video.images?.length > 1 ? ` · ${video.images.length} photos` : ""}</span></span></span>`
          : `<a class="video-sound" href="${video.soundId ? `#/sound/${esc(video.soundId)}` : "#/sounds"}" data-act="sound">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
          <span class="marquee"><span>${soundTitle} — @${esc(video.username)}</span></span>
        </a>`}
      </div>

      ${isPhoto ? "" : `
      <div class="video-volume" data-act="mute">
        <svg viewBox="0 0 24 24" class="vol-on"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M17.5 6.5a8 8 0 0 1 0 11"/></svg>
        <svg viewBox="0 0 24 24" class="vol-off"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>
      </div>`}
    </div>
  </article>`;
}

export async function hydrateVideoStates(root, uid) {
  const cards = [...root.querySelectorAll(".video-card[data-video-id]")];
  if (!uid || !cards.length) return;
  const ids = cards.map((c) => c.dataset.videoId);
  const [liked, saved] = await Promise.all([
    getLikedVideoIds(uid, ids),
    getSavedVideoIds(uid, ids),
  ]);
  cards.forEach((card) => {
    const id = card.dataset.videoId;
    const likeBtn = card.querySelector('[data-act="like"]');
    const saveBtn = card.querySelector('[data-act="save"]');
    if (likeBtn) {
      likeBtn.classList.toggle("is-on", liked.has(id));
      likeBtn.setAttribute("aria-pressed", String(liked.has(id)));
    }
    if (saveBtn) {
      saveBtn.classList.toggle("is-on", saved.has(id));
      saveBtn.setAttribute("aria-pressed", String(saved.has(id)));
    }
  });
}

export function bindVideoActions(root, ctx) {
  if (root.dataset.videoBound === "1") return;
  root.dataset.videoBound = "1";

  // Photo carousels: sync the position dots as the user swipes/scrolls.
  root.addEventListener(
    "scroll",
    (event) => {
      const carousel = event.target?.closest?.(".photo-carousel");
      if (!carousel) return;
      const card = carousel.closest(".video-card");
      if (!card) return;
      const index = Math.round(carousel.scrollLeft / Math.max(1, carousel.clientWidth));
      card.querySelectorAll(".photo-dots span").forEach((dot, i) => {
        dot.classList.toggle("is-on", i === index);
      });
    },
    true
  );

  root.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest(".video-card[data-video-id]");
    if (!card || event.target.closest("button,a,input,textarea")) return;
    event.preventDefault();
    const vid = card.querySelector("video");
    if (vid) {
      if (vid.paused) vid.play().catch(() => {});
      else vid.pause();
    }
  });

  root.addEventListener("click", async (event) => {
    const card = event.target.closest(".video-card[data-video-id]");
    if (!card) return;
    const videoId = card.dataset.videoId;
    const video = ctx.videoCache.get(videoId) || { id: videoId, uid: null, caption: "" };
    const btn = event.target.closest("[data-act]");
    const act = btn?.dataset.act;

    if (!act) {
      // toggle play
      const vid = card.querySelector("video");
      if (vid) {
        if (vid.paused) vid.play().catch(() => {});
        else vid.pause();
      }
      return;
    }

    if (act === "profile") return;

    if (act === "like") {
      if (!ctx.state.profile) return ctx.requireAuth();
      const button = card.querySelector('[data-act="like"]');
      if (button.disabled) return;
      const wasOn = button.classList.contains("is-on");
      button.classList.toggle("is-on", !wasOn);
      const countNode = button.querySelector('[data-count="like"]');
      if (countNode) {
        const cur = parseInt((countNode.textContent || "0").replace(/[^0-9]/g, "") || "0", 10);
        countNode.textContent = formatCount(Math.max(0, cur + (wasOn ? -1 : 1)));
      }
      button.disabled = true;
      try {
        await toggleVideoLike(ctx.state.profile.uid, ctx.state.profile, video);
      } catch (e) {
        button.classList.toggle("is-on", wasOn);
        toast(e?.message || "Could not like video", "error");
      } finally {
        button.disabled = false;
      }
      return;
    }

    if (act === "save") {
      if (!ctx.state.profile) return ctx.requireAuth();
      const button = card.querySelector('[data-act="save"]');
      const wasOn = button.classList.contains("is-on");
      button.classList.toggle("is-on", !wasOn);
      try {
        const saved = await toggleVideoSave(ctx.state.profile.uid, video);
        toast(saved ? "Saved to bookmarks" : "Removed from bookmarks", "success", 2000);
      } catch {
        button.classList.toggle("is-on", wasOn);
        toast("Could not save", "error");
      }
      return;
    }

    if (act === "comment") {
      openCommentsModal(ctx, video);
      return;
    }

    if (act === "report") {
      if (!ctx.state.profile) return ctx.requireAuth();
      const ok = await confirmDialog({
        title: "Report this post?",
        body: "Report it for inappropriate content, spam, harassment, copyright or another concern. Our moderation team can review it.",
        confirmLabel: "Report post",
        danger: true,
      });
      if (!ok) return;
      try {
        await reportVideo(ctx.state.profile.uid, video, "other");
        toast("Report submitted. Thank you for helping keep Xacheus safe.", "success", 4000);
      } catch (error) {
        toast(error?.message || "Could not submit report", "error");
      }
      return;
    }

    if (act === "not-interested") {
      const hidden = new Set(JSON.parse(localStorage.getItem("xacheus_hiddenVideos") || "[]"));
      hidden.add(videoId);
      localStorage.setItem("xacheus_hiddenVideos", JSON.stringify([...hidden].slice(-300)));
      card.remove();
      toast("We’ll show you fewer posts like this", "success", 2500);
      return;
    }

    if (act === "block") {
      if (!ctx.state.profile) return ctx.requireAuth();
      if (video.uid === ctx.state.profile.uid) return toast("You cannot block yourself.", "error");
      const ok = await confirmDialog({ title: `Block @${video.username || "this creator"}?`, body: "Their posts will no longer appear in your feed. You can unblock them later from your settings.", confirmLabel: "Block", danger: true });
      if (!ok) return;
      try {
        await toggleBlock(ctx.state.profile.uid, video);
        card.remove();
        toast(`Blocked @${video.username}`, "success");
      } catch (error) { toast(error?.message || "Could not block creator", "error"); }
      return;
    }

    if (act === "share") {
      const shareUrl = `${location.origin}${location.pathname}#/video/${videoId}`;
      if (navigator.share) {
        navigator
          .share({
            title: `${video.displayName || video.username || "Xacheus"} on Xacheus`,
            text: (video.caption || "").slice(0, 100) || "Watch this video on Xacheus",
            url: shareUrl,
          })
          .then(() => bumpVideoShare(videoId).catch(() => {}))
          .catch(() => {}); // user dismissed the share sheet
      } else {
        copyText(shareUrl);
        bumpVideoShare(videoId).catch(() => {});
        toast("Link copied", "success");
      }
      return;
    }

    if (act === "follow") {
      if (!ctx.state.profile) return ctx.requireAuth();
      if (video.uid === ctx.state.profile.uid) return;
      const btn = card.querySelector('[data-act="follow"]');
      if (btn) btn.textContent = "…";
      try {
        const target = { uid: video.uid, username: video.username, displayName: video.displayName, photoURL: video.photoURL };
        const followed = await toggleFollow(ctx.state.profile.uid, ctx.state.profile, target);
        toast(followed ? `Following @${video.username}` : `Unfollowed @${video.username}`, "success");
        if (btn) {
          if (followed) btn.remove();
          else btn.textContent = "+";
        }
      } catch (e) {
        toast(e?.message || "Could not follow", "error");
        if (btn) btn.textContent = "+";
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

    if (act === "sound") {
      ctx.navigate(video.soundId ? `#/sound/${video.soundId}` : "#/sounds");
      return;
    }
  });
}

function openCommentsModal(ctx, video) {
  if (!ctx.state.profile) {
    ctx.requireAuth();
    return;
  }
  let unsub = null;
  openModal({
    title: `Comments · @${video.username}`,
    size: "sm",
    body: `
      <div class="comments-modal">
        <div class="comments-list" id="comments-list"><div class="loader-row"><span class="spinner"></span> Loading…</div></div>
        <form class="comment-form" id="comment-form">
          <input type="text" id="comment-input" maxlength="500" placeholder="Add a comment…" autocomplete="off" />
          <button class="btn btn-primary btn-sm" type="submit">Post</button>
        </form>
      </div>`,
    onMount(root, close) {
      const list = root.querySelector("#comments-list");
      const form = root.querySelector("#comment-form");
      const input = root.querySelector("#comment-input");

      const renderComments = (comments) => {
        if (!comments.length) {
          list.innerHTML = `<p class="panel-empty">No comments yet. Be first!</p>`;
          return;
        }
        list.innerHTML = comments.map((c) => `
          <div class="comment">
            <a href="#/u/${esc(c.username)}">${avatar({ username: c.username, displayName: c.displayName, photoURL: c.photoURL }, "sm")}</a>
            <div class="comment-body">
              <header><strong>${esc(c.displayName || c.username)}</strong> <em>@${esc(c.username)}</em> · <span>${timeAgo(c.createdAt)}</span></header>
              <p>${esc(c.text)}</p>
            </div>
          </div>
        `).join("");
        list.scrollTop = list.scrollHeight;
      };

      import("../data.js").then(({ watchVideoComments }) => {
        unsub = watchVideoComments(video.id, renderComments);
      });

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        input.disabled = true;
        try {
          await addVideoComment(ctx.state.profile.uid, ctx.state.profile, video, text);
          input.value = "";
          toast("Comment posted", "success", 1500);
        } catch (err) {
          toast(err?.message || "Could not comment", "error");
        } finally {
          input.disabled = false;
          input.focus();
        }
      });

      root.addEventListener("modal:close", () => unsub?.());
    },
  });
}

/* User row for discover/profile */
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
