/**
 * Xacheus — Profile.
 *
 * One page per account: cover, avatar, name/handle/bio, live follower + post
 * counts, follow / message / report / block, and tabs for Posts, Photos,
 * Videos, Reposts, Music, Activity, Saved, Liked, Followers, Following and
 * About — all read from Firestore, all realtime.
 *
 * The avatar and cover are clickable: they open the full-screen media viewer
 * (js/views/mediaViewer.js) where photos can be reacted to, commented on,
 * replied to, shared and deleted. Uploading a new picture writes a
 * `profileMedia` document too, so a profile keeps a real picture history.
 */

import {
  changeUsername,
  getFollowers,
  getFollowing,
  getLikedVideos,
  getProfileByUsername,
  getUserSounds,
  getMyPlayHistory,
  isFollowing,
  updateProfile,
  watchProfile,
  watchSavedVideos,
  watchUserVideos,
  getSound,
  toggleFollow,
} from "../data.js";
import {
  addProfileMedia,
  watchProfileMedia,
  blockUser,
  buildActivity,
  cancelFollowRequest,
  canMessage,
  getAccessState,
  getBlockList,
  getMyPostReactions,
  getRepostsByPeople,
  listActiveStories,
  listFollowRequests,
  listProfileMedia,
  reactToProfileMedia,
  removeFollower,
  requestFollow,
  setAsCurrentMedia,
  unblockUser,
  watchFollowRequests,
  watchMyReposts,
} from "../social.js";
import { avatar, confirmDialog, emptyState, esc, formatCount as fmt, fullDate, gradientFor, openModal, safeUrl, timeAgo, toast } from "../ui.js";
import { uploadImage } from "../storage.js";
import { openReportModal, userRowHtml, videoCardHtml, bindVideoActions, hydrateVideoStates } from "./components.js";
import { closeMediaViewer, openMediaViewer } from "./mediaViewer.js";
import { playQueue, toggleTrack, isCurrentTrack } from "../player.js";
import { brandSlotHtml } from "../brand.js";
import { watchPresence } from "../social.js";
import { soundRowHtml } from "./sounds.js";

const TABS = [
  { id: "posts", label: "Posts" },
  { id: "photos", label: "Photos" },
  { id: "videos", label: "Videos" },
  { id: "reposts", label: "Reposts", own: true },
  { id: "music", label: "Music" },
  { id: "activity", label: "Activity" },
  { id: "saved", label: "Saved", own: true },
  { id: "liked", label: "Liked" },
  { id: "followers", label: "Followers" },
  { id: "following", label: "Following" },
  { id: "about", label: "About" },
];

export function profileView(ctx, { username, tab = "posts", media = "" } = {}) {
  const isOwn = ctx.state.profile && ctx.state.profile.username === username;
  // Skeleton mirrors the real hero's geometry (same classes) so the swap from
  // "shimmer" to "data" is close to pixel-stable — no big page shove.
  const html = `
    <div class="profile-head">
      <button class="icon-btn back-btn" type="button" data-act="back" aria-label="Back">←</button>
      <div class="view-head"><h1>${isOwn ? "Profile" : `@${esc(username || "")}`}</h1></div>
    </div>
    <div id="profile-root">
      <div class="profile-hero profile-skeleton" aria-hidden="true">
        <div class="sk sk-profile-cover"></div>
        <div class="profile-identity">
          <span class="sk sk-profile-avatar"></span>
          <div class="profile-actions">
            <span class="sk sk-profile-btn"></span>
            <span class="sk sk-profile-btn"></span>
          </div>
        </div>
        <div class="profile-meta">
          <span class="sk sk-line sk-line--name"></span>
          <span class="sk sk-line sk-line--w75"></span>
          <span class="sk sk-line sk-line--w55"></span>
          <span class="sk sk-line sk-line--w40"></span>
        </div>
      </div>
      <div class="tabs profile-tabs profile-skeleton" aria-hidden="true">
        <span class="sk sk-tab"></span>
        <span class="sk sk-tab"></span>
        <span class="sk sk-tab"></span>
        <span class="sk sk-tab"></span>
      </div>
    </div>
  `;

  let unsubProfile = null;
  let unsubVideos = null;
  let unsubReposts = null;
  let unsubRequests = null;
  let unsubPresence = null;
  let lastRenderedUid = "";
  // Paint bookkeeping: a profile doc update (view count, follow count, a bio
  // edit from another tab…) fires watchProfile with a fresh copy. The full
  // structure (hero + tabs + tab content) is painted once per uid; anything
  // after that is a hero-only repaint that leaves the tab content the user is
  // reading — and its live watchers — exactly where they are.
  let paintedUid = null;
  let paintedLocked = null;
  let mediaUid = null;
  let presenceUid = null;
  const cleanups = [];

  async function renderProfile(root, profile) {
    if (!profile) {
      paintedUid = null;
      paintedLocked = null;
      root.querySelector("#profile-root").innerHTML = emptyState(
        "👤",
        "Profile not found",
        username ? `No account uses @${esc(username)}.` : "Sign in to see your profile.",
        '<a class="btn btn-primary btn-sm" href="#/discover">Discover people</a>'
      );
      return;
    }

    const myUid = ctx.state.profile?.uid || "";
    const isMine = myUid === profile.uid;
    const access = isMine ? { locked: false } : await getAccessState(profile, myUid);

    const container = root.querySelector("#profile-root");
    // Full structure paint: first time for this uid (skeleton still up), the
    // access state flipped, or the hero slot is missing.
    const fullPaint =
      paintedUid !== profile.uid ||
      paintedLocked !== access.locked ||
      !container.querySelector("#profile-hero");

    // The media list feeds the viewer and the photo count. Fetch once per uid
    // and keep it on the container so a hero repaint on a profile-doc update
    // (view count, follow count, …) doesn't re-read 60 docs.
    if (fullPaint || mediaUid !== profile.uid || !container._media) {
      const [fetchedMedia, , , requests] = await Promise.all([
        access.locked ? Promise.resolve([]) : listProfileMedia(profile.uid, { max: 60 }),
        Promise.resolve([]),
        Promise.resolve([]),
        isMine ? listFollowRequests(myUid).catch(() => []) : Promise.resolve([]),
      ]);
      container._media = fetchedMedia;
      container._requests = requests;
      mediaUid = profile.uid;
    }
    const mediaAll = container._media || [];
    const photos = mediaAll.filter((m) => m.kind === "photo");
    const avatars = mediaAll.filter((m) => m.kind === "avatar");
    const covers = mediaAll.filter((m) => m.kind === "cover");
    const requests = container._requests || [];

    const websiteHref = safeUrl(profile.website || "");
    const websiteLabel = String(profile.website || "").replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/\/$/, "");
    const verified = profile.verified ? '<span class="verified" title="Verified account">✓</span>' : "";
    const roleBadge = profile.role && profile.role !== "user"
      ? `<span class="role-badge role-${esc(profile.role)}">${esc(profile.role)}</span>`
      : "";

    const heroInner = `
      <button class="cover cover-btn" type="button" data-act="open-cover" title="View cover photo"
        style="${profile.coverURL ? `background-image:url(${JSON.stringify(esc(profile.coverURL))});background-size:cover;background-position:center` : ""}">
        ${profile.coverURL ? "" : `<span class="cover-empty">Add a cover photo</span>`}
        ${isMine ? `<span class="cover-edit" data-act="edit-cover">Edit</span>` : ""}
        ${brandSlotHtml({ role: "mark", size: "md", linked: false, extraClass: "logo-plate--watermark profile-brand" })}
      </button>

      <div class="profile-identity">
        <button class="profile-avatar-btn" type="button" data-act="open-avatar" title="View profile photo">
          <span class="avatar avatar-xl">${avatar(profile, "xl")}</span>
        </button>
        <div class="profile-actions">
          ${isMine
            ? `<button class="btn btn-outline btn-sm" type="button" data-act="edit">Edit profile</button>
               <button class="btn btn-primary btn-sm" type="button" data-act="add-photo">Add photo</button>
               <button class="btn btn-ghost btn-sm" type="button" data-act="requests${requests.length ? " is-hot" : ""}">Requests${requests.length ? ` · ${requests.length}` : ""}</button>`
            : access.locked
              ? access.canRequest
                ? `<button class="btn btn-primary btn-sm" type="button" data-act="request-follow">Request to follow</button>`
                : access.requested
                  ? `<button class="btn btn-outline btn-sm" type="button" data-act="cancel-request">Requested</button>`
                  : `<span class="locked-chip">Private account</span>`
              : `<button class="btn btn-sm ${await isFollowing(myUid, profile.uid).catch(() => false) ? "btn-outline" : "btn-primary"}" type="button" data-act="follow">Follow</button>
                 <button class="btn btn-outline btn-sm" type="button" data-act="message">Message</button>`}
          <button class="icon-btn" type="button" data-act="more" aria-label="More">⋯</button>
        </div>
      </div>

      <div class="profile-meta">
        <h2>${esc(profile.displayName)} ${verified} ${roleBadge}
          <span class="presence-dot" data-presence hidden></span>
        </h2>
        <span class="profile-handle">@${esc(profile.username)}${profile.private ? ' <span class="private-chip" title="Private account">🔒 private</span>' : ""}</span>
        ${profile.bio ? `<p class="profile-bio">${esc(profile.bio)}</p>` : ""}
        <div class="profile-facts">
          ${profile.location ? `<span>📍 ${esc(profile.location)}</span>` : ""}
          ${profile.website && websiteHref
            ? `<span>🔗 <a class="link" href="${esc(websiteHref)}" target="_blank" rel="noopener noreferrer nofollow">${esc(websiteLabel)}</a></span>`
            : profile.website ? `<span class="muted" title="This link was rejected as unsafe">🔗 ${esc(profile.website)}</span>` : ""}
          <span>🗓 Joined ${new Date(profile.createdAt?.seconds ? profile.createdAt.seconds * 1000 : Date.now()).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
        </div>
        <div class="profile-stats">
          <span><strong data-stat="posts">${fmt(profile.videosCount || 0)}</strong> posts</span>
          <a href="#/u/${esc(profile.username)}?tab=followers"><strong data-stat="followers">${fmt(profile.followersCount || 0)}</strong> followers</a>
          <a href="#/u/${esc(profile.username)}?tab=following"><strong data-stat="following">${fmt(profile.followingCount || 0)}</strong> following</a>
          <a href="#/u/${esc(profile.username)}?tab=photos"><strong>${fmt(photos.length)}</strong> photos</a>
          ${isMine ? `<span title="Profile views"><strong>${fmt(profile.profileViewCount || 0)}</strong> profile views</span>` : ""}
          <button class="link-btn follow-state" type="button" data-act="follow" ${access.locked && !isMine ? "disabled" : ""}></button>
        </div>
      </div>`;

    if (fullPaint) {
      container.innerHTML = `
      <div id="profile-hero" class="profile-hero">
        ${heroInner}
      </div>

      ${access.locked
        ? `<div class="private-lock">
            <strong>This account is private</strong>
            <p>${esc(access.reason || "Follow to see their posts and photos.")}</p>
            ${access.canRequest ? `<button class="btn btn-primary btn-sm" type="button" data-act="request-follow">Request to follow</button>` : ""}
            <a class="btn btn-ghost btn-sm" href="#/u/${esc(profile.username)}?tab=about">About</a>
          </div>`
        : `
        <div class="story-strip" data-act="story-strip" hidden></div>

        <div class="tabs profile-tabs" role="tablist">
          ${visibleTabs(profile, isMine)
            .map((t) => `<button class="tab ${tab === t.id ? "is-active" : ""}" data-tab="${t.id}" role="tab" aria-selected="${tab === t.id}">${t.label}</button>`)
            .join("")}
        </div>

        <div class="profile-content" id="profile-content">
          <div class="loader-row"><span class="spinner"></span> Loading…</div>
        </div>`}
      `;
      paintedUid = profile.uid;
      paintedLocked = access.locked;
      wireStructure(ctx, container, profile);
    } else {
      // Same person, same access — repaint only the hero. The live tab content
      // (and the user's scroll position inside it) stays exactly where it is;
      // rebuilding it is what used to make the page bounce on every update.
      container.querySelector("#profile-hero").innerHTML = heroInner;
    }

    // gallery data stays on the element so the viewer can walk it
    container.dataset.uid = profile.uid;
    container._profile = profile;

    wireHero(ctx, container, profile, { isMine, access, avatars, covers, requests });
    await refreshFollowButton(ctx, container, profile);
    if (!isMine && myUid && presenceUid !== profile.uid) {
      presenceUid = profile.uid;
      unsubPresence?.();
      // Re-query the dot on every tick: the hero (and its dot) is re-painted on
      // each profile update, so a captured reference would go stale and the
      // dot would freeze.
      unsubPresence = watchPresence(profile.uid, (presence) => {
        const dot = container.querySelector("[data-presence]");
        if (!dot) return;
        dot.hidden = false;
        dot.className = `presence-dot ${presence.online ? "is-online" : "is-offline"}`;
        dot.title = presence.online ? "Active now" : presence.lastActiveAt ? `Last active ${timeAgo(presence.lastActiveAt)}` : "Recently offline";
      });
    }
    if (fullPaint) loadTabContent(ctx, container, profile, tab, { isMine, access });
  }

  function visibleTabs(profile, isMine) {
    return TABS.filter((t) => {
      if (t.own && !isMine) return false;
      if (t.id === "saved" && !isMine) return false;
      if (t.id === "liked" && !isMine && profile.showLiked === false) return false;
      return true;
    });
  }

  /* ---- wiring ----
     Two levels, matched to the two paint paths in renderProfile:
     wireStructure — once per uid paint (tab buttons, story strip, the
       container-level click delegation, deep-link open). It must never run
       twice on the same container or its delegation listener double-fires.
     wireHero — after every hero paint (the hero's buttons are fresh nodes
       each time). */
  function wireStructure(ctx, container, profile) {
    const isMineNow = ctx.state.profile?.uid === profile.uid;

    container.querySelectorAll(".profile-tabs .tab").forEach((t) => {
      t.addEventListener("click", () => {
        ctx.navigate(`#/u/${encodeURIComponent(profile.username)}?tab=${t.dataset.tab}`);
      });
    });
    container.querySelector('[data-act="story-strip"]')?.addEventListener("click", () => openStoryStrip(ctx, profile, isMineNow));

    // Photo / media grids open the viewer.
    container.addEventListener("click", (event) => {
      const mediaBtn = event.target.closest("[data-media-id]");
      if (mediaBtn) {
        const list = container._media || [];
        const id = mediaBtn.dataset.mediaId;
        const index = list.findIndex((m) => m.id === id);
        const subset = mediaBtn.dataset.kind ? list.filter((m) => m.kind === mediaBtn.dataset.kind) : list;
        openMediaViewer(ctx, id, { list: subset.length ? subset : list, media: list[index] });
        return;
      }
      const followBtn = event.target.closest("[data-user-follow]");
      if (followBtn) {
        toggleFromList(followBtn, profile);
        return;
      }
      const removeBtn = event.target.closest("[data-remove-follower]");
      if (removeBtn) {
        removeFollowerFromMe(removeBtn, profile);
      }
    });

    if (media) {
      const target = (container._media || []).find((m) => m.id === media);
      if (target) openMediaViewer(ctx, target.id, { list: container._media, media: target });
    }
  }

  function wireHero(ctx, container, profile, opts) {
    const { isMine, access, avatars, covers, requests } = opts;

    container.querySelector('[data-act="open-avatar"]')?.addEventListener("click", () => {
      const list = avatars.length ? avatars : [{ id: "current", uid: profile.uid, kind: "avatar", url: profile.photoURL, username: profile.username, displayName: profile.displayName, caption: "Current profile photo", likeCount: 0, commentCount: 0, viewCount: 0, shareCount: 0, reactions: {} }];
      openMediaViewer(ctx, list[0].id, { list, media: list[0] });
    });
    container.querySelector('[data-act="open-cover"]')?.addEventListener("click", () => {
      const list = covers.length ? covers : profile.coverURL
        ? [{ id: "cover-current", uid: profile.uid, kind: "cover", url: profile.coverURL, username: profile.username, displayName: profile.displayName, caption: "Current cover", likeCount: 0, commentCount: 0, viewCount: 0, shareCount: 0, reactions: {} }]
        : [];
      if (!list.length) {
        if (isMine) openMediaUploader(ctx, profile, "cover");
        return;
      }
      openMediaViewer(ctx, list[0].id, { list, media: list[0] });
    });

    container.querySelector('[data-act="add-photo"]')?.addEventListener("click", () => openMediaUploader(ctx, profile, "photo"));
    container.querySelector('[data-act="edit-cover"]')?.addEventListener("click", (event) => {
      event.stopPropagation();
      openMediaUploader(ctx, profile, "cover");
    });
    container.querySelector('[data-act="edit"]')?.addEventListener("click", () => openEditProfile(ctx, profile));

    container.querySelector('[data-act="follow"]')?.addEventListener("click", async (event) => {
      if (!ctx.state.profile) return ctx.requireAuth();
      const btn = event.currentTarget;
      btn.disabled = true;
      try {
        const followed = await toggleFollow(ctx.state.profile.uid, ctx.state.profile, profile);
        toast(followed ? `Following @${profile.username}` : `Unfollowed @${profile.username}`, "success");
        await refreshFollowButton(ctx, container, profile);
        ctx.refreshProfile?.();
      } catch (err) {
        toast(err?.message || "Could not update the follow", "error");
      } finally {
        btn.disabled = false;
      }
    });

    container.querySelector('[data-act="request-follow"]')?.addEventListener("click", async (event) => {
      if (!ctx.state.profile) return ctx.requireAuth();
      const btn = event.currentTarget;
      btn.disabled = true;
      try {
        await requestFollow(ctx.state.profile.uid, ctx.state.profile, profile);
        toast(`Follow request sent to @${profile.username}`, "success");
        btn.textContent = "Requested";
      } catch (err) {
        toast(err?.message || "Could not send that request", "error");
        btn.disabled = false;
      }
    });

    container.querySelector('[data-act="cancel-request"]')?.addEventListener("click", async () => {
      try {
        await cancelFollowRequest(ctx.state.profile.uid, profile.uid);
        toast("Request withdrawn", "success");
        renderProfile(container.closest("#view") || document.getElementById("view"), profile);
      } catch (err) {
        toast(err?.message || "Could not withdraw that request", "error");
      }
    });

    container.querySelector('[data-act="message"]')?.addEventListener("click", async () => {
      if (!ctx.state.profile) return ctx.requireAuth();
      const gate = await canMessage(profile);
      if (!gate.ok) {
        if (gate.needAuth) return ctx.requireAuth();
        toast(gate.reason, "error", 4200);
        return;
      }
      ctx.navigate(`#/dm/${encodeURIComponent(profile.username)}`);
    });

    container.querySelector('[data-act="more"]')?.addEventListener("click", () => openMoreMenu(ctx, profile, isMine, access));
    container.querySelector('[data-act="unblock"]')?.addEventListener("click", async () => {
      try {
        await unblockUser(ctx.state.profile.uid, profile.uid);
        toast(`Unblocked @${profile.username}`, "success");
      } catch (err) {
        toast(err?.message || "Could not unblock", "error");
      }
    });
    container.querySelector('[data-act="requests"]')?.addEventListener("click", () => openRequestsModal(ctx, profile, requests));
  }

  async function toggleFromList(btn, profile) {
    if (!ctx.state.profile) return ctx.requireAuth();
    const uid = btn.dataset.userFollow;
    btn.disabled = true;
    try {
      const { getProfile } = await import("../data.js");
      const target = await getProfile(uid);
      if (!target) throw new Error("Account not found.");
      const followed = await toggleFollow(ctx.state.profile.uid, ctx.state.profile, target);
      btn.textContent = followed ? "Following" : "Follow";
      btn.classList.toggle("btn-outline", followed);
      btn.classList.toggle("btn-primary", !followed);
      void profile;
    } catch (err) {
      toast(err?.message || "Could not update the follow", "error");
    } finally {
      btn.disabled = false;
    }
  }

  async function removeFollowerFromMe(btn, profile) {
    if (!ctx.state.profile) return ctx.requireAuth();
    const ok = await confirmDialog({
      title: "Remove this follower?",
      body: "They stop following you. They can follow again (or send a new request if you're private).",
      confirmLabel: "Remove follower",
      danger: true,
    });
    if (!ok) return;
    try {
      await removeFollower(profile.uid, btn.dataset.removeFollower);
      toast("Follower removed", "success");
      loadTabContent(ctx, btn.closest("#profile-root")?.querySelector("#profile-content") || btn.closest("#profile-content"), profile, "followers", { isMine: true, access: { locked: false } });
    } catch (err) {
      toast(err?.message || "Could not remove that follower", "error");
    }
  }

  async function refreshFollowButton(ctx, container, profile) {
    const buttons = container.querySelectorAll('[data-act="follow"]');
    if (!buttons.length) return;
    const myUid = ctx.state.profile?.uid;
    let following = false;
    if (myUid && myUid !== profile.uid) following = await isFollowing(myUid, profile.uid).catch(() => false);
    buttons.forEach((btn) => {
      if (myUid === profile.uid) {
        btn.remove();
        return;
      }
      btn.textContent = following ? "Following ✓" : "Follow";
      btn.classList.toggle("btn-outline", following);
      btn.classList.toggle("btn-primary", !following);
    });
  }

  /* ---- tabs ---- */
  async function loadTabContent(ctx, container, profile, currentTab, { isMine, access }) {
    const content = typeof container.querySelector === "function" ? container.querySelector("#profile-content") || container : container;
    if (!content || access?.locked) return;
    unsubVideos?.();
    unsubReposts?.();
    unsubVideos = null;
    unsubReposts = null;
    for (const off of cleanups.splice(0)) off();

    const tab = TABS.some((t) => t.id === currentTab) ? currentTab : "posts";
    content.innerHTML = `<div class="loader-row"><span class="spinner"></span> Loading…</div>`;

    if (tab === "posts" || tab === "videos" || tab === "photos") {
      const kind = tab;
      const showPhotos = kind === "posts" || kind === "photos";
      const showVideos = kind === "posts" || kind === "videos";
      const grid = `<div class="profile-mixed" data-mixed></div>`;
      content.innerHTML = `${kind === "posts" && isMine ? `<div class="composer-row"><button class="btn btn-sm btn-primary" type="button" data-quick="video">Post a video</button><button class="btn btn-sm btn-outline" type="button" data-quick="photo">Post photos</button><button class="btn btn-sm btn-outline" type="button" data-quick="story">Story</button></div>` : ""}${grid}`;
      const host = content.querySelector("[data-mixed]");

      const paint = async (videos) => {
        const filtered = videos.filter((v) => (v.mediaType === "photo" ? showPhotos : showVideos));
        const media = showPhotos && kind !== "videos" ? (container._media || []).filter((m) => m.kind === "photo") : [];
        if (!filtered.length && !media.length) {
          host.innerHTML = emptyState(
            "🎬",
            kind === "photos" ? "No photos yet" : kind === "videos" ? "No videos yet" : "Nothing posted yet",
            isMine ? "Posts, photos and videos you publish show up here." : `@${profile.username} hasn't posted anything yet.`,
            isMine ? '<a class="btn btn-primary btn-sm" href="#/create">Create a post</a>' : ""
          );
          return;
        }
        host.innerHTML = `
          ${media.length ? `<h3 class="strip-title">Profile photos</h3><div class="media-grid">${media.map((m) => photoTile(m)).join("")}</div>` : ""}
          ${filtered.length ? `<h3 class="strip-title">Posts</h3><div class="video-grid">${filtered.map((v) => postTile(v)).join("")}</div>` : ""}`;
        bindVideoActions(host, ctx);
        await hydrateVideoStates(host, ctx.state.profile?.uid);
        host.querySelectorAll("[data-video-tile]").forEach((tile) => {
          tile.addEventListener("click", (event) => {
            if (event.target.closest("[data-tile-action]")) return;
            ctx.navigate(`#/video/${tile.dataset.videoTile}`);
          });
        });
        content.querySelector('[data-quick="video"]')?.addEventListener("click", () => ctx.navigate("#/create"));
        content.querySelector('[data-quick="photo"]')?.addEventListener("click", () => ctx.navigate("#/create?tab=photos"));
        content.querySelector('[data-quick="story"]')?.addEventListener("click", () => openStoryComposer(ctx, profile));
      };

      if (kind === "photos") {
        // photos tab also streams media changes
        const stop = watchProfileMedia(profile.uid, (rows) => {
          container._media = rows;
          unsubVideos?.();
          unsubVideos = watchUserVideos(profile.uid, (videos) => paint(videos || []));
        });
        cleanups.push(stop);
      }
      unsubVideos = watchUserVideos(profile.uid, (videos) => paint(videos || []));
      return;
    }

    if (tab === "reposts") {
      if (!isMine) {
        content.innerHTML = emptyState("🔁", "Reposts are private", "Only the owner can browse their repost list.");
        return;
      }
      content.innerHTML = `<div class="loader-row"><span class="spinner"></span> Loading…</div>`;
      let painted = false;
      unsubReposts = watchMyReposts(profile.uid, (rows) => {
        painted = true;
        if (!rows.length) {
          content.innerHTML = emptyState("🔁", "No reposts yet", "Tap Repost on any post and it lands here.");
          return;
        }
        content.innerHTML = `<div class="video-grid">${rows.map((r) => repostTile(r)).join("")}</div>`;
        content.querySelectorAll("[data-video-tile]").forEach((tile) =>
          tile.addEventListener("click", () => ctx.navigate(`#/video/${tile.dataset.videoTile}`))
        );
      });
      setTimeout(() => {
        if (!painted) content.innerHTML = emptyState("🔁", "No reposts yet", "Tap Repost on any post and it lands here.");
      }, 4000);
      return;
    }

    if (tab === "music") {
      await renderMusicTab(ctx, content, profile, isMine);
      return;
    }

    if (tab === "activity") {
      const showComments = isMine || profile.showActivity !== false;
      const events = await buildActivity(profile.uid, { includeComments: showComments, max: 30 }).catch(() => []);
      if (!events.length) {
        content.innerHTML = emptyState("📈", "No activity yet", isMine ? "Post, comment or add a photo and it shows up here." : `Nothing public from @${profile.username} yet.`);
        return;
      }
      content.innerHTML = `<ol class="activity-list">${events.map(activityRow).join("")}</ol>`;
      content.querySelectorAll("[data-activity-video]").forEach((row) =>
        row.addEventListener("click", () => ctx.navigate(`#/video/${row.dataset.activityVideo}`))
      );
      content.querySelectorAll("[data-activity-media]").forEach((row) =>
        row.addEventListener("click", () => openMediaViewer(ctx, row.dataset.activityMedia, { list: container._media || [] }))
      );
      return;
    }

    if (tab === "saved") {
      if (!isMine) {
        content.innerHTML = emptyState("🔖", "Saved posts are private", "Only you can see what you saved.");
        return;
      }
      content.innerHTML = `<div class="loader-row"><span class="spinner"></span> Loading…</div>`;
      unsubSavedWatch(profile, content, ctx);
      return;
    }

    if (tab === "liked") {
      const rows = await getLikedVideos(profile.uid, 30).catch(() => []);
      if (!rows.length) {
        content.innerHTML = emptyState("❤️", "No liked posts yet", isMine ? "Tap a reaction on any post and it shows up here." : `Nothing to show.`);
        return;
      }
      content.innerHTML = `
        <p class="tab-note">${isMine ? "Posts you reacted to. Only you can see this list." : `Posts liked by @${esc(profile.username)}.`}</p>
        <div class="video-grid">${rows.map((v) => postTile(v)).join("")}</div>`;
      content.querySelectorAll("[data-video-tile]").forEach((tile) =>
        tile.addEventListener("click", () => ctx.navigate(`#/video/${tile.dataset.videoTile}`))
      );
      return;
    }

    if (tab === "followers" || tab === "following") {
      const list = (tab === "followers" ? await getFollowers(profile.uid, 60) : await getFollowing(profile.uid, 60)).filter(Boolean);
      if (!list.length) {
        content.innerHTML = emptyState("👥", `No ${tab} yet`, isMine ? "Share your profile so people can find you." : "");
        return;
      }
      content.innerHTML = `
        ${tab === "followers" && isMine ? `<p class="tab-note">Tap “Remove” to drop a follower — rules stop them re-following silently.</p>` : ""}
        <div class="user-list">${list.map((u) => userRowHtml(u, { action: !isMine && ctx.state.profile ? "Follow" : "" })).join("")}</div>`;
      content.querySelectorAll(".user-row").forEach((row, i) => {
        const u = list[i];
        const btn = row.querySelector('[data-act="follow"]');
        if (btn) {
          btn.dataset.userFollow = u.uid;
          btn.removeAttribute("href");
        }
        if (isMine && tab === "followers") {
          const remove = document.createElement("button");
          remove.className = "btn btn-sm btn-ghost danger";
          remove.type = "button";
          remove.textContent = "Remove";
          remove.dataset.removeFollower = u.uid;
          row.appendChild(remove);
        }
      });
      return;
    }

    if (tab === "about") {
      const viewers = isMine ? await import("../social.js").then((m) => m.listProfileViewers(profile.uid, 12)).catch(() => []) : [];
      content.innerHTML = `
        <div class="panel about-panel">
          <h3>About @${esc(profile.username)}</h3>
          <dl class="about-list">
            <div><dt>Display name</dt><dd>${esc(profile.displayName)}</dd></div>
            <div><dt>Handle</dt><dd>@${esc(profile.username)}</dd></div>
            <div><dt>Bio</dt><dd>${profile.bio ? esc(profile.bio) : `<span class="muted">Not filled in</span>`}</dd></div>
            <div><dt>Location</dt><dd>${profile.location ? esc(profile.location) : `<span class="muted">—</span>`}</dd></div>
            <div><dt>Website</dt><dd>${profile.website && safeUrl(profile.website) ? `<a class="link" href="${esc(safeUrl(profile.website))}" target="_blank" rel="noopener noreferrer">${esc(profile.website)}</a>` : `<span class="muted">—</span>`}</dd></div>
            <div><dt>Joined</dt><dd>${fullDate(profile.createdAt) || "—"}</dd></div>
            <div><dt>Account type</dt><dd>${esc(profile.role || "user")}${profile.verified ? " · verified" : ""}${profile.private ? " · private" : ""}</dd></div>
            ${isMine ? `<div><dt>Profile views</dt><dd>${fmt(profile.profileViewCount || 0)}${viewers.length ? ` · ${viewers.length} recent visitor${viewers.length === 1 ? "" : "s"}` : ""}</dd></div>` : ""}
          </dl>
          ${isMine && viewers.length
            ? `<h4>Recently viewed your profile</h4>
               <div class="visitor-row">${viewers.map((v) => `<a href="#/u/${esc(v.username)}" title="${esc(v.displayName)}">${avatar(v, "sm")}</a>`).join("")}</div>
               <p class="muted small">Only you can see this list.</p>`
            : ""}
          ${!isMine ? `<button class="btn btn-ghost btn-sm" type="button" data-act="report-user">Report account</button>` : ""}
        </div>`;
      content.querySelector('[data-act="report-user"]')?.addEventListener("click", () =>
        openReportModal(ctx, { targetType: "user", targetId: profile.uid, targetOwnerUid: profile.uid, targetLabel: `@${profile.username}` })
      );
      return;
    }

    content.innerHTML = emptyState("🧭", "Unknown tab", "Pick a tab above.");
  }

  function unsubSavedWatch(profile, content, ctx) {
    const stop = watchSavedVideos(profile.uid, (rows) => {
      if (!rows.length) {
        content.innerHTML = emptyState("🔖", "Nothing saved", "Use Save on a post to keep it here.");
        return;
      }
      content.innerHTML = `
        <p class="tab-note">Only you can see your saved posts. <a href="#/saved">Open saved</a></p>
        <div class="video-grid">${rows.map((v) => postTile(v)).join("")}</div>`;
      content.querySelectorAll("[data-video-tile]").forEach((tile) =>
        tile.addEventListener("click", () => ctx.navigate(`#/video/${tile.dataset.videoTile}`))
      );
    });
    cleanups.push(stop);
  }

  async function renderMusicTab(ctx, content, profile, isMine) {
    const [sounds, history, favourites] = await Promise.all([
      getUserSounds(profile.uid, 30).catch(() => []),
      isMine ? getMyPlayHistory(profile.uid, 12).catch(() => []) : Promise.resolve([]),
      isMine
        ? import("../data.js").then(({ getFavoriteSoundIds }) => getFavoriteSoundIds(profile.uid)).catch(() => new Set())
        : Promise.resolve(new Set()),
    ]);
    const postSounds = await postsWithSound(profile.uid);

    if (!sounds.length && !history.length && !postSounds.length) {
      content.innerHTML = emptyState(
        "🎵",
        "No music yet",
        isMine
          ? "Add a track from the Music page — either your own upload or a licensed release from the catalogue. Tracks you attach to posts appear here too."
          : `@${profile.username} hasn't added any music yet.`,
        isMine ? '<a class="btn btn-primary btn-sm" href="#/music">Browse music</a>' : ""
      );
      return;
    }

    const favouritesSet = favourites instanceof Set ? favourites : new Set();
    content.innerHTML = `
      ${postSounds.length ? `<h3 class="strip-title">In their posts</h3><div class="sound-list">${postSounds.map((s) => soundRowHtml(s, { isMine, favourite: false })).join("")}</div>` : ""}
      ${sounds.length ? `<h3 class="strip-title">Added to the library</h3><div class="sound-list">${sounds.map((s) => soundRowHtml(s, { isMine, favourite: favouritesSet.has(s.id) })).join("")}</div>` : ""}
      ${history.length ? `<h3 class="strip-title">Recently played</h3><div class="sound-list">${history.map((s) => soundRowHtml(s, { isMine: false, favourite: favouritesSet.has(s.id) })).join("")}</div>` : ""}
      <p class="tab-note muted">Music here is either uploaded by this member or imported from the Internet Archive with its licence recorded on the track.</p>`;

    const rows = [...content.querySelectorAll("[data-sound-row]")];
    rows.forEach((row) => {
      const id = row.dataset.soundRow;
      const sound = [...sounds, ...history, ...postSounds].find((s) => s.id === id);
      row.querySelector("[data-act='play']")?.addEventListener("click", () => {
        if (!sound) return;
        if (isCurrentTrack(id)) toggleTrack(sound);
        else playQueue([sound]);
      });
    });
    void ctx;
  }

  async function postsWithSound(uid) {
    const { getSoundsByIds } = await import("../data.js");
    const videos = await watchUserVideosOnce(uid);
    const ids = [...new Set(videos.map((v) => v.soundId).filter(Boolean))];
    const sounds = await getSoundsByIds(ids);
    return sounds.map((s) => ({
      ...s,
      extra: `${videos.filter((v) => v.soundId === s.id).length} post${videos.filter((v) => v.soundId === s.id).length === 1 ? "" : "s"}`,
    }));
  }

  function watchUserVideosOnce(uid) {
    return new Promise((resolve) => {
      const stop = watchUserVideos(uid, (videos) => {
        stop();
        resolve(videos || []);
      });
    });
  }

  /* ---- tiles ---- */
  function postTile(video) {
    const [from, to] = gradientFor(video.id);
    const thumb = video.thumbnailUrl || (Array.isArray(video.images) ? video.images[0] : "");
    const reactions = video.reactions || {};
    const total = Object.values(reactions).reduce((a, b) => a + (Number(b) || 0), 0) || Number(video.likeCount) || 0;
    return `
      <button class="video-grid-card" type="button" data-video-tile="${esc(video.id)}">
        <span class="grid-thumb">
          ${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy" />` : `<span class="grid-fallback" style="background-image:linear-gradient(135deg,${from},${to})"></span>`}
          ${video.mediaType === "photo" ? `<span class="grid-type-badge">🖼️ ${Array.isArray(video.images) ? video.images.length : ""}</span>` : `<span class="grid-type-badge">▶</span>`}
          ${video.soundTitle ? `<span class="grid-sound">🎵 ${esc(String(video.soundTitle).slice(0, 40))}</span>` : ""}
          <span class="grid-views">
            <span>❤️ ${fmt(total)}</span><span>💬 ${fmt(video.commentCount)}</span>
            ${Number(video.repostCount) > 0 ? `<span>🔁 ${fmt(video.repostCount)}</span>` : ""}
          </span>
        </span>
        <span class="grid-meta"><em>${esc((video.caption || "").slice(0, 70) || "Untitled post")}</em><span>${timeAgo(video.createdAt)}</span></span>
      </button>`;
  }

  function repostTile(row) {
    const video = row.reposted || {};
    return `
      <button class="video-grid-card is-repost" type="button" data-video-tile="${esc(video.id || "")}">
        <span class="grid-thumb">
          ${(video.thumbnailUrl || (Array.isArray(video.images) ? video.images[0] : "")) ? `<img src="${esc(video.thumbnailUrl || video.images?.[0])}" alt="" loading="lazy" />` : `<span class="grid-fallback"></span>`}
          <span class="grid-repost-badge">🔁 reposted ${timeAgo(row.createdAt)}</span>
        </span>
        <span class="grid-meta"><em>${esc((row.note || video.caption || "").slice(0, 70))}</em></span>
      </button>`;
  }

  function photoTile(media) {
    return `
      <button class="media-tile" type="button" data-media-id="${esc(media.id)}" data-kind="${esc(media.kind)}">
        <img src="${esc(media.url)}" alt="${esc(media.caption || "Profile photo")}" loading="lazy" />
        <span class="media-tile-stats">
          <span>❤️ ${fmt(media.likeCount)}</span><span>💬 ${fmt(media.commentCount)}</span>
        </span>
        ${media.isCurrent ? `<span class="media-tile-badge">current</span>` : ""}
      </button>`;
  }

  function activityRow(event) {
    const label = {
      video: "posted a video",
      photo_post: "posted photos",
      photo: "added a photo",
      avatar: "changed their profile photo",
      cover: "changed their cover photo",
      comment: "commented on a post",
    }[event.type] || event.type;
    return `
      <li class="activity-row" ${event.videoId ? `data-activity-video="${esc(event.videoId)}"` : ""} ${event.mediaId ? `data-activity-media="${esc(event.mediaId)}"` : ""}>
        ${event.thumb ? `<img src="${esc(event.thumb)}" alt="" loading="lazy" />` : `<span class="activity-dot"></span>`}
        <span class="activity-text">
          <strong>${esc(label)}</strong>
          ${event.text ? `<em>${esc(event.text)}</em>` : ""}
          <span class="activity-when">${timeAgo(event.at)}${event.counts?.likes ? ` · ${fmt(event.counts.likes)} reactions` : ""}</span>
        </span>
      </li>`;
  }

  function stopAll() {
    for (const off of cleanups.splice(0)) {
      try {
        off();
      } catch {
        /* listener already gone */
      }
    }
  }

  return {
    html,
    title: username ? `@${username}` : "Profile",
    mount(root) {
      root.querySelector("[data-act='back']")?.addEventListener("click", () => history.back());
      const load = async () => {
        if (!username) {
          if (!ctx.state.profile) {
            // A guest tapping the Profile tab gets the sign-in moment, not an
            // error — browsing everything else stays open without an account.
            root.querySelector("#profile-root").innerHTML = emptyState(
              "👋",
              "Sign in to Xacheus",
              "Create a free account to post videos, follow creators, comment and message — your profile lives here once you do.",
              '<button class="btn btn-primary btn-sm" type="button" data-act="login">Log in or sign up</button>' +
                '<a class="btn btn-ghost btn-sm" href="#/discover">Keep browsing as guest</a>'
            );
            root.querySelector("[data-act='login']")?.addEventListener("click", () => ctx.requireAuth());
            return;
          }
          renderProfile(root, ctx.state.profile);
          unsubProfile = watchProfile(ctx.state.profile.uid, (fresh) => fresh && renderProfile(root, fresh));
          return;
        }
        const profile = await getProfileByUsername(username).catch(() => null);
        if (!profile) {
          renderProfile(root, null);
          return;
        }
        if (lastRenderedUid && lastRenderedUid !== profile.uid) closeMediaViewer();
        lastRenderedUid = profile.uid;
        renderProfile(root, profile);
        unsubProfile?.();
        unsubProfile = watchProfile(profile.uid, (fresh) => fresh && renderProfile(root, fresh));
        if (ctx.state.profile?.uid === profile.uid) {
          unsubRequests?.();
          unsubRequests = watchFollowRequests(profile.uid, (rows) => {
            const btn = root.querySelector('[data-act="requests"]');
            if (!btn) return;
            btn.textContent = rows.length ? `Requests · ${rows.length}` : "Requests";
            btn.classList.toggle("is-hot", rows.length > 0);
          });
          cleanups.push(() => unsubRequests?.());
        }
      };
      load();
    },
    destroy() {
      closeMediaViewer();
      stopAll();
      unsubProfile?.();
      unsubVideos?.();
      unsubReposts?.();
      unsubRequests?.();
      unsubPresence?.();
      for (const off of cleanups.splice(0)) off();
    },
  };
}

/* ------------------------------------------------------------------ */
/* profile photo / cover uploader (writes profileMedia + the profile)   */
/* ------------------------------------------------------------------ */

function openMediaUploader(ctx, profile, kind) {
  if (!ctx.state.profile) return ctx.requireAuth();
  const label = kind === "cover" ? "cover photo" : kind === "avatar" ? "profile photo" : "photo";
  openModal({
    title: `Add ${label}`,
    size: "sm",
    body: `
      <form class="form-grid" data-upload-form>
        <label class="upload-drop" data-drop>
          <input type="file" accept="image/*" data-file hidden />
          <span class="upload-drop-inner">
            <strong>Choose an image</strong>
            <em>PNG, JPG, GIF or WebP · up to 10 MB</em>
          </span>
        </label>
        <img class="upload-preview" data-preview hidden alt="Preview" />
        <div class="upload-progress" data-progress hidden><div class="upload-progress-bar" data-bar></div></div>
        ${kind === "photo" ? `<label class="field"><span>Caption (optional)</span><input type="text" maxlength="300" data-caption placeholder="Say something about this photo…" /></label>` : ""}
        <button class="btn btn-primary btn-block" type="submit" disabled data-submit>Upload</button>
      </form>`,
    onMount(modal, close) {
      const input = modal.querySelector("[data-file]");
      const preview = modal.querySelector("[data-preview]");
      const submit = modal.querySelector("[data-submit]");
      const bar = modal.querySelector("[data-bar]");
      const progress = modal.querySelector("[data-progress]");
      let file = null;

      modal.querySelector("[data-drop]").addEventListener("click", () => input.click());
      input.addEventListener("change", () => {
        const picked = input.files?.[0];
        if (!picked) return;
        if (!picked.type.startsWith("image/")) return toast("Pick an image file.", "error");
        if (picked.size > 10 * 1024 * 1024) return toast("Images must be under 10 MB.", "error");
        file = picked;
        preview.src = URL.createObjectURL(picked);
        preview.hidden = false;
        submit.disabled = false;
      });

      modal.querySelector("[data-upload-form]").addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!file) return;
        submit.disabled = true;
        submit.textContent = "Uploading…";
        progress.hidden = false;
        try {
          const url = await uploadImage(file, { onProgress: (pct) => (bar.style.width = `${pct}%`) });
          if (!url) throw new Error("Upload failed — try again.");
          const caption = modal.querySelector("[data-caption]")?.value || "";
          if (kind !== "photo") {
            await updateProfile(profile.uid, { [kind === "cover" ? "coverURL" : "photoURL"]: url });
          }
          await addProfileMedia(ctx.state.profile, { kind, url, caption, takenAt: file.lastModified || 0 });
          if (kind !== "photo") await setAsCurrentMediaAfter(ctx, profile, kind, url);
          toast(`${label === "photo" ? "Photo" : "Profile image"} added`, "success");
          close();
          ctx.refreshProfile?.();
          const root = document.getElementById("view");
          if (root) profileRefresh(ctx, root);
        } catch (err) {
          toast(err?.message || "Upload failed", "error");
          submit.disabled = false;
          submit.textContent = "Upload";
        }
      });
    },
  });
}

/** Keep the profile field and the media doc pointing at the same file. */
async function setAsCurrentMediaAfter(ctx, profile, kind, url) {
  const { listProfileMedia: list } = await import("../social.js");
  const rows = await list(profile.uid, { kind, max: 3 }).catch(() => []);
  const fresh = rows.find((m) => m.url === url);
  if (fresh) await setAsCurrentMedia(profile.uid, fresh).catch(() => {});
}

function profileRefresh(ctx, root) {
  // `watchProfile` already repaints the header; nudge the counters too.
  ctx.refreshProfile?.();
  void root;
}

/* ------------------------------------------------------------------ */
/* edit profile                                                        */
/* ------------------------------------------------------------------ */

function openEditProfile(ctx, profile) {
  openModal({
    title: "Edit profile",
    body: `
      <form id="edit-profile-form" class="edit-form">
        <div class="edit-media">
          <label class="edit-avatar" title="Change avatar">
            <input type="file" id="avatar-input" accept="image/*" hidden />
            ${avatar(profile, "lg")}
            <span class="edit-overlay">Change</span>
          </label>
          <label class="edit-cover" title="Change cover">
            <input type="file" id="cover-input" accept="image/*" hidden />
            ${profile.coverURL ? `<img src="${esc(profile.coverURL)}" alt="Cover" />` : `<span class="edit-cover-empty">Add cover</span>`}
            <span class="edit-overlay">Change cover</span>
          </label>
        </div>
        <label class="field"><span>Display name</span>
          <input type="text" name="displayName" value="${esc(profile.displayName)}" maxlength="40" required /></label>
        <label class="field"><span>Handle</span>
          <span class="field-prefix-wrap"><span class="field-prefix">@</span>
          <input type="text" name="username" value="${esc(profile.username)}" maxlength="20" required /></span></label>
        <label class="field"><span>Bio</span>
          <textarea name="bio" rows="3" maxlength="160">${esc(profile.bio || "")}</textarea></label>
        <label class="field"><span>Location</span>
          <input type="text" name="location" value="${esc(profile.location || "")}" maxlength="40" /></label>
        <label class="field"><span>Website</span>
          <input type="text" name="website" value="${esc(profile.website || "")}" maxlength="100" placeholder="https://…" /></label>
        <label class="field field-check">
          <input type="checkbox" name="private" ${profile.private ? "checked" : ""} />
          <span>Private account — only approved followers see your posts, photos and stories</span>
        </label>
        <p class="field-hint">Role: ${esc(profile.role || "user")}. Only an admin can change roles, verification or bans.</p>
        <button class="btn btn-primary btn-block" type="submit">Save changes</button>
      </form>`,
    onMount(modalRoot, close) {
      const form = modalRoot.querySelector("#edit-profile-form");
      const avatarInput = modalRoot.querySelector("#avatar-input");
      const coverInput = modalRoot.querySelector("#cover-input");
      let photoURL = profile.photoURL || "";
      let coverURL = profile.coverURL || "";

      const validate = (file) => {
        if (!file) return "Choose an image file.";
        if (!file.type.startsWith("image/")) return "Pick an image file.";
        if (file.size > 10 * 1024 * 1024) return "Images must be under 10 MB.";
        return null;
      };

      modalRoot.querySelector(".edit-avatar").addEventListener("click", () => avatarInput.click());
      modalRoot.querySelector(".edit-cover").addEventListener("click", () => coverInput.click());

      avatarInput.addEventListener("change", async () => {
        const file = avatarInput.files?.[0];
        const problem = validate(file);
        if (problem) return toast(problem, "error");
        toast("Uploading avatar…", "info", 1500);
        try {
          photoURL = await uploadImage(file);
          if (!photoURL) throw new Error("Upload failed.");
          await addProfileMedia(ctx.state.profile, { kind: "avatar", url: photoURL, takenAt: file.lastModified || 0 });
          modalRoot.querySelector(".edit-avatar").classList.add("is-ready");
          toast("Avatar ready — save to keep it", "success", 2200);
        } catch (err) {
          toast(err?.message || "Could not upload avatar.", "error");
        }
      });

      coverInput.addEventListener("change", async () => {
        const file = coverInput.files?.[0];
        const problem = validate(file);
        if (problem) return toast(problem, "error");
        toast("Uploading cover…", "info", 1500);
        try {
          coverURL = await uploadImage(file);
          if (!coverURL) throw new Error("Upload failed.");
          await addProfileMedia(ctx.state.profile, { kind: "cover", url: coverURL, takenAt: file.lastModified || 0 });
          modalRoot.querySelector(".edit-cover").classList.add("is-ready");
          toast("Cover ready — save to keep it", "success", 2200);
        } catch (err) {
          toast(err?.message || "Could not upload cover.", "error");
        }
      });

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = new FormData(form);
        const displayName = String(data.get("displayName") || "").trim();
        const handle = String(data.get("username") || "").trim().toLowerCase();
        const bio = String(data.get("bio") || "").trim();
        const location = String(data.get("location") || "").trim();
        const website = String(data.get("website") || "").trim();
        const isPrivate = data.get("private") === "on";

        if (!displayName) return toast("Display name is required.", "error");
        if (website && !safeUrl(website)) return toast("Website must start with https:// (or http://).", "error");

        const submitBtn = form.querySelector("button[type='submit']");
        submitBtn.disabled = true;
        submitBtn.textContent = "Saving…";
        try {
          if (handle && handle !== profile.username) await changeUsername(profile.uid, handle);
          await updateProfile(profile.uid, {
            displayName,
            displayNameLower: displayName.toLowerCase(),
            bio,
            location,
            website,
            photoURL,
            coverURL,
            private: isPrivate,
          });
          toast("Profile saved", "success");
          closeModalAfter(close);
          await ctx.refreshProfile?.();
        } catch (err) {
          toast(err?.message || "Could not save your profile", "error");
          submitBtn.disabled = false;
          submitBtn.textContent = "Save changes";
        }
      });
    },
  });
}

function closeModalAfter(close) {
  close?.();
}

/* ------------------------------------------------------------------ */
/* overflow menu: share, block, report, saved collection shortcut       */
/* ------------------------------------------------------------------ */

async function openMoreMenu(ctx, profile, isMine, access) {
  const { isBlocking } = await import("../social.js");
  const status = ctx.state.profile && !isMine ? await isBlocking(ctx.state.profile.uid, profile.uid).catch(() => ({ blocked: false, blockedBy: false })) : { blocked: false, blockedBy: false };
  const blocked = Boolean(status.blocked);
  openModal({
    title: `@${profile.username}`,
    size: "sm",
    body: `
      <div class="menu-list">
        <button class="menu-item" type="button" data-menu="share">Share this profile</button>
        <button class="menu-item" type="button" data-menu="copy">Copy profile link</button>
        ${isMine
          ? `<a class="menu-item" href="#/settings">Account & privacy settings</a>
             <a class="menu-item" href="#/saved">Saved posts</a>
             <button class="menu-item" type="button" data-menu="history">Profile view history</button>`
          : `
            <button class="menu-item" type="button" data-menu="report">Report account</button>
            <button class="menu-item danger" type="button" data-menu="block">${blocked ? "Unblock" : "Block"} @${esc(profile.username)}</button>
            ${access?.locked ? "" : `<button class="menu-item" type="button" data-menu="mute">Mute notifications from this account</button>`}
          `}
      </div>`,
    onMount(modal, close) {
      modal.addEventListener("click", async (event) => {
        const btn = event.target.closest("[data-menu]");
        if (!btn) return;
        const action = btn.dataset.menu;
        if (action === "share" || action === "copy") {
          const url = `${location.origin}${location.pathname}#/u/${encodeURIComponent(profile.username)}`;
          if (action === "copy") {
            const { copyText } = await import("../ui.js");
            copyText(url);
            closeModalAfter(close);
            return;
          }
          const { openShareModal } = await import("./components.js");
          closeModalAfter(close);
          openShareModal(ctx, { title: `${profile.displayName} on Xacheus`, text: `Follow @${profile.username}`, url });
          return;
        }
        if (action === "report") {
          closeModalAfter(close);
          openReportModal(ctx, {
            targetType: "user",
            targetId: profile.uid,
            targetOwnerUid: profile.uid,
            targetLabel: `@${profile.username} (${profile.displayName})`,
          });
          return;
        }
        if (action === "block") {
          const ok = await confirmDialog({
            title: `Block @${profile.username}?`,
            body: "You won't see each other's content in feeds, you can't message each other, and the follow is removed. Unblock any time from Settings.",
            confirmLabel: "Block",
            danger: true,
          });
          if (!ok) return;
          try {
            await blockUser(ctx.state.profile.uid, profile);
            toast(`Blocked @${profile.username}`, "success");
            closeModalAfter(close);
          } catch (err) {
            toast(err?.message || "Could not block that account", "error");
          }
          return;
        }
        if (action === "unblock" || (action === "block" && blocked)) {
          try {
            await unblockUser(ctx.state.profile.uid, profile.uid);
            toast(`Unblocked @${profile.username}`, "success");
            closeModalAfter(close);
          } catch (err) {
            toast(err?.message || "Could not unblock", "error");
          }
          return;
        }
        if (action === "mute") {
          toast("Account-wide muting isn't built yet — blocking works today.", "info", 4200);
          closeModalAfter(close);
          return;
        }
        if (action === "history") {
          closeModalAfter(close);
          const { listProfileViewers } = await import("../social.js");
          const viewers = await listProfileViewers(profile.uid, 30).catch(() => []);
          openModal({
            title: "Who viewed your profile",
            size: "sm",
            body: viewers.length
              ? `<div class="user-list">${viewers.map((v) => userRowHtml(v)).join("")}</div>
                 <p class="tab-note muted">Views are counted once per visitor per day and stored on your account only.</p>`
              : `<p class="panel-empty">No recorded visits yet. This list starts filling once people open your profile.</p>`,
          });
        }
      });
    },
  });
}

/* ------------------------------------------------------------------ */
/* follow requests                                                     */
/* ------------------------------------------------------------------ */

function openRequestsModal(ctx, profile, requests) {
  openModal({
    title: "Follow requests",
    size: "sm",
    body: requests.length
      ? `<div class="request-list">${requests
          .map(
            (r) => `<div class="request-row" data-request="${esc(r.id)}">
              ${avatar(r, "md")}
              <span class="request-text">
                <strong>${esc(r.displayName || r.username)}</strong>
                <em>@${esc(r.username)} · ${timeAgo(r.createdAt)}</em>
              </span>
              <span class="request-actions">
                <button class="btn btn-sm btn-primary" type="button" data-request-act="accept">Accept</button>
                <button class="btn btn-sm btn-ghost" type="button" data-request-act="decline">Decline</button>
              </span>
            </div>`
          )
          .join("")}</div>`
      : `<p class="panel-empty">No pending requests. When someone asks to follow a private account, they appear here.</p>`,
    onMount(modal, close) {
      modal.addEventListener("click", async (event) => {
        const btn = event.target.closest("[data-request-act]");
        if (!btn) return;
        const row = btn.closest("[data-request]");
        const request = requests.find((r) => r.id === row.dataset.request);
        if (!request) return;
        btn.disabled = true;
        try {
          if (btn.dataset.requestAct === "accept") {
            const { acceptFollowRequest } = await import("../social.js");
            await acceptFollowRequest(profile.uid, request, { source: ctx.state.profile });
            toast(`@${request.username} now follows you`, "success");
          } else {
            const { declineFollowRequest } = await import("../social.js");
            await declineFollowRequest(profile.uid, request.uid);
            toast("Request declined", "success", 1800);
          }
          row.remove();
          if (!modal.querySelector(".request-row")) close();
        } catch (err) {
          toast(err?.message || "Could not handle that request", "error");
          btn.disabled = false;
        }
      });
    },
  });
}

/* ------------------------------------------------------------------ */
/* story helpers (thin wrappers so the profile can drive them)         */
/* ------------------------------------------------------------------ */

async function openStoryStrip(ctx, profile, isMine) {
  const { openStoryViewer } = await import("./stories.js");
  const followingIds = ctx.state.profile ? await import("../data.js").then((m) => m.getFollowingIds(ctx.state.profile.uid)).catch(() => []) : [];
  const stories = await listActiveStories(followingIds, { includeUid: profile.uid, max: 40 });
  const mine = stories.filter((s) => s.uid === profile.uid);
  if (!mine.length) {
    if (isMine) openStoryComposer(ctx, profile);
    else toast("No active stories from this account.", "info");
    return;
  }
  openStoryViewer(ctx, mine, { list: stories });
}

function openStoryComposer(ctx, profile) {
  import("./stories.js").then((m) => m.openStoryComposer(ctx, profile));
}

/* re-exported for the app shell's "react from notification" shortcut */
export { reactToProfileMedia, getSound, getMyPostReactions, videoCardHtml, getRepostsByPeople };
