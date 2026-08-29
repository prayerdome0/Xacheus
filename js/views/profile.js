/** Xacheus — Profile (video grid) Phase 1 */

import { getProfileByUsername, watchUserVideos, getFollowers, getFollowing, isFollowing, toggleFollow, watchProfile, isAdminProfile } from "../data.js";
import { avatar, esc, formatCount, emptyState, toast, openModal } from "../ui.js";
import { uploadImage } from "../cloudinary.js";
import { updateProfile, changeUsername } from "../data.js";

export function profileView(ctx, { username, tab = "videos" } = {}) {
  const isOwn = ctx.state.profile && ctx.state.profile.username === username;
  const html = `
    <div class="profile-head">
      <button class="icon-btn back-btn" type="button" data-act="back" aria-label="Back">←</button>
      <div class="view-head">
        <h1>${isOwn ? "Profile" : `@${esc(username || "")}`}</h1>
      </div>
    </div>

    <div id="profile-root">
      <div class="loader-row"><span class="spinner"></span> Loading profile…</div>
    </div>
  `;

  let unsubVideos = null;
  let unsubProfile = null;

  async function renderProfile(root, profile) {
    const container = root.querySelector("#profile-root");
    if (!profile) {
      container.innerHTML = emptyState("👤", "Profile not found", `No user @${esc(username)}`, '<a class="btn btn-primary btn-sm" href="#/discover">Discover creators</a>');
      return;
    }

    const isOwnProfile = ctx.state.profile?.uid === profile.uid;
    const roleBadge = `<span class="role-badge role-${esc(profile.role || "user")}">${esc(profile.role || "user")}</span>`;
    const verified = profile.verified ? '<span class="verified">✓</span>' : "";

    container.innerHTML = `
      <div class="profile-hero">
        <div class="cover" style="${profile.coverURL ? `background-image:url(${esc(profile.coverURL)});background-size:cover;background-position:center` : ""}"></div>
        <div class="profile-identity">
          <span class="avatar avatar-xl">${avatar(profile, "xl")}</span>
          <div class="profile-actions">
            ${isOwnProfile ? `<button class="btn btn-outline btn-sm" type="button" data-act="edit">Edit profile</button>` : `<button class="btn btn-primary btn-sm" type="button" data-act="follow" data-uid="${esc(profile.uid)}">Follow</button><a class="btn btn-outline btn-sm" href="#/discover?q=${esc(profile.username)}">Videos</a>`}
          </div>
        </div>

        <div class="profile-meta">
          <h2>${esc(profile.displayName)} ${verified} ${roleBadge}</h2>
          <span class="profile-handle">@${esc(profile.username)}</span>
          ${profile.bio ? `<p class="profile-bio">${esc(profile.bio)}</p>` : ""}
          <div class="profile-facts">
            ${profile.location ? `<span>📍 ${esc(profile.location)}</span>` : ""}
            ${profile.website ? `<span>🔗 <a class="link" href="${esc(profile.website)}" target="_blank" rel="noopener">${esc(profile.website.replace(/^https?:\/\//, ""))}</a></span>` : ""}
          </div>
          <div class="profile-stats">
            <a href="#/u/${esc(profile.username)}?tab=followers"><strong>${formatCount(profile.followersCount || 0)}</strong> <span>followers</span></a>
            <a href="#/u/${esc(profile.username)}?tab=following"><strong>${formatCount(profile.followingCount || 0)}</strong> <span>following</span></a>
            <span><strong>${formatCount(profile.videosCount || 0)}</strong> videos</span>
            <span><strong>${formatCount(profile.likesCount || 0)}</strong> likes</span>
          </div>
          ${isAdminProfile(profile) ? `<span class="admin-badge">Admin</span>` : ""}
        </div>
      </div>

      <div class="tabs profile-tabs" role="tablist">
        <button class="tab ${tab === "videos" ? "is-active" : ""}" data-tab="videos">Videos</button>
        <button class="tab ${tab === "liked" ? "is-active" : ""}" data-tab="liked">Liked</button>
        <button class="tab ${tab === "followers" ? "is-active" : ""}" data-tab="followers">Followers</button>
        <button class="tab ${tab === "following" ? "is-active" : ""}" data-tab="following">Following</button>
      </div>

      <div class="profile-content" id="profile-content">
        <div class="loader-row"><span class="spinner"></span> Loading…</div>
      </div>
    `;

    // follow button state
    if (!isOwnProfile && ctx.state.profile) {
      const following = await isFollowing(ctx.state.profile.uid, profile.uid).catch(() => false);
      const btn = container.querySelector('[data-act="follow"]');
      if (btn) {
        btn.textContent = following ? "Following" : "Follow";
        btn.classList.toggle("btn-outline", following);
        btn.classList.toggle("btn-primary", !following);
      }
    }

    container.querySelector("[data-act='back']")?.addEventListener("click", () => history.back());
    container.querySelector("[data-act='edit']")?.addEventListener("click", () => openEditProfile(ctx, profile));
    container.querySelector("[data-act='follow']")?.addEventListener("click", async (e) => {
      if (!ctx.state.profile) return ctx.requireAuth();
      const btn = e.target;
      btn.disabled = true;
      try {
        const followed = await toggleFollow(ctx.state.profile.uid, ctx.state.profile, profile);
        btn.textContent = followed ? "Following" : "Follow";
        btn.classList.toggle("btn-outline", followed);
        btn.classList.toggle("btn-primary", !followed);
        toast(followed ? `Following @${profile.username}` : `Unfollowed`, "success");
      } catch (err) {
        toast(err?.message || "Could not follow", "error");
      } finally {
        btn.disabled = false;
      }
    });

    container.querySelectorAll(".profile-tabs .tab").forEach((t) => {
      t.addEventListener("click", () => {
        const newTab = t.dataset.tab;
        ctx.navigate(`#/u/${esc(profile.username)}?tab=${newTab}`);
      });
    });

    loadTabContent(container, profile, tab);
  }

  async function loadTabContent(root, profile, currentTab) {
    const content = root.querySelector("#profile-content");
    if (!content) return;
    if (unsubVideos) { unsubVideos(); unsubVideos = null; }

    if (currentTab === "videos" || !currentTab) {
      content.innerHTML = `<div class="loader-row"><span class="spinner"></span> Loading videos…</div>`;
      unsubVideos = watchUserVideos(profile.uid, (videos) => {
        if (!videos.length) {
          content.innerHTML = emptyState("🎬", "No videos yet", `${profile.uid === ctx.state.profile?.uid ? "Post your first video!" : `@${profile.username} hasn't posted yet.`}`, profile.uid === ctx.state.profile?.uid ? '<a class="btn btn-primary btn-sm" href="#/create">Create video</a>' : "");
          return;
        }
        content.innerHTML = `<div class="video-grid">${videos.map((v) => gridCard(v)).join("")}</div>`;
        content.querySelectorAll(".video-grid-card").forEach((card) => {
          card.addEventListener("click", () => ctx.navigate(`#/video/${card.dataset.videoId}`));
        });
      });
    } else if (currentTab === "liked") {
      content.innerHTML = `<div class="loader-row"><span class="spinner"></span> Loading liked…</div>`;
      const { watchSavedVideos, getLikedVideoIds } = await import("../data.js");
      // For liked, we need to fetch liked videos via users/{uid}/likedVideos
      // We'll use watchSavedVideos as placeholder but actually liked
      const { getDocs, query, collection, orderBy, limit } = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js");
      const { db } = await import("../firebase.js");
      const { getVideo } = await import("../data.js");
      try {
        const snap = await getDocs(query(collection(db, "users", profile.uid, "likedVideos"), orderBy("createdAt", "desc"), limit(30)));
        const vids = await Promise.all(snap.docs.map(async (d) => await getVideo(d.id)));
        const videos = vids.filter(Boolean);
        if (!videos.length) {
          content.innerHTML = emptyState("❤️", "No liked videos", "Videos you like will appear here.", "");
        } else {
          content.innerHTML = `<div class="video-grid">${videos.map((v) => gridCard(v)).join("")}</div>`;
          content.querySelectorAll(".video-grid-card").forEach((card) => {
            card.addEventListener("click", () => ctx.navigate(`#/video/${card.dataset.videoId}`));
          });
        }
      } catch {
        content.innerHTML = emptyState("❤️", "No liked videos", "", "");
      }
    } else if (currentTab === "followers" || currentTab === "following") {
      content.innerHTML = `<div class="loader-row"><span class="spinner"></span> Loading…</div>`;
      try {
        const list = currentTab === "followers" ? await getFollowers(profile.uid) : await getFollowing(profile.uid);
        if (!list.length) {
          content.innerHTML = emptyState("👥", `No ${currentTab} yet`, "", "");
        } else {
          const { userRowHtml } = await import("./components.js");
          content.innerHTML = list.filter(Boolean).map((u) => userRowHtml(u)).join("");
        }
      } catch {
        content.innerHTML = `<p class="panel-empty">Could not load ${currentTab}.</p>`;
      }
    }
  }

  function gridCard(video) {
    return `
      <div class="video-grid-card" data-video-id="${esc(video.id)}">
        <div class="grid-thumb">
          ${video.thumbnailUrl ? `<img src="${esc(video.thumbnailUrl)}" alt="" loading="lazy" />` : `<video src="${esc(video.videoUrl)}" muted preload="metadata"></video>`}
          <span class="grid-views">❤️ ${formatCount(video.likeCount)} · 💬 ${formatCount(video.commentCount)}</span>
        </div>
        <div class="grid-meta">
          <em>${esc((video.caption || "").slice(0, 60))}</em>
        </div>
      </div>
    `;
  }

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
              ${profile.coverURL ? `<img src="${esc(profile.coverURL)}" alt="Cover" style="width:80px;height:40px;object-fit:cover;border-radius:8px" />` : "Change cover"}
            </label>
          </div>
          <label class="field">
            <span>Display name</span>
            <input type="text" name="displayName" value="${esc(profile.displayName)}" maxlength="40" required />
          </label>
          <label class="field">
            <span>Handle</span>
            <span class="field-prefix-wrap">
              <span class="field-prefix">@</span>
              <input type="text" name="username" value="${esc(profile.username)}" maxlength="20" required />
            </span>
          </label>
          <label class="field">
            <span>Bio</span>
            <textarea name="bio" rows="3" maxlength="160">${esc(profile.bio || "")}</textarea>
          </label>
          <label class="field">
            <span>Location</span>
            <input type="text" name="location" value="${esc(profile.location || "")}" maxlength="40" />
          </label>
          <label class="field">
            <span>Website</span>
            <input type="text" name="website" value="${esc(profile.website || "")}" maxlength="100" placeholder="https://…" />
          </label>
          <div class="field">
            <span>Role: ${esc(profile.role || "user")} ${profile.role === "admin" ? "(admin)" : ""}</span>
            <small class="field-hint">Role can only be changed by admin. Contact admin if you need business/church/creator upgrade.</small>
          </div>
          <button class="btn btn-primary btn-block" type="submit">Save changes</button>
        </form>
      `,
      onMount(modalRoot, close) {
        const form = modalRoot.querySelector("#edit-profile-form");
        const avatarInput = modalRoot.querySelector("#avatar-input");
        const coverInput = modalRoot.querySelector("#cover-input");
        let newPhotoURL = profile.photoURL;
        let newCoverURL = profile.coverURL;

        modalRoot.querySelector(".edit-avatar").addEventListener("click", () => avatarInput.click());
        modalRoot.querySelector(".edit-cover").addEventListener("click", () => coverInput.click());

        avatarInput.addEventListener("change", async () => {
          const file = avatarInput.files?.[0];
          if (!file) return;
          toast("Uploading avatar…", "info");
          const url = await uploadImage(file);
          newPhotoURL = url;
          modalRoot.querySelector(".edit-avatar").innerHTML = `<img src="${esc(url)}" alt="Avatar" style="width:60px;height:60px;border-radius:50%;object-fit:cover" /><span class="edit-overlay">Change</span><input type="file" id="avatar-input" accept="image/*" hidden />`;
          toast("Avatar updated — save to keep", "success");
        });

        coverInput.addEventListener("change", async () => {
          const file = coverInput.files?.[0];
          if (!file) return;
          toast("Uploading cover…", "info");
          const url = await uploadImage(file);
          newCoverURL = url;
          toast("Cover updated — save to keep", "success");
        });

        form.addEventListener("submit", async (e) => {
          e.preventDefault();
          const data = new FormData(form);
          const displayName = String(data.get("displayName") || "").trim();
          const username = String(data.get("username") || "").trim();
          const bio = String(data.get("bio") || "").trim();
          const location = String(data.get("location") || "").trim();
          const website = String(data.get("website") || "").trim();

          if (!displayName) return toast("Display name required", "error");

          const submitBtn = form.querySelector("button[type='submit']");
          submitBtn.disabled = true;
          submitBtn.textContent = "Saving…";

          try {
            if (username !== profile.username) {
              await changeUsername(profile.uid, username);
            }
            await updateProfile(profile.uid, {
              displayName,
              displayNameLower: displayName.toLowerCase(),
              bio,
              location,
              website,
              photoURL: newPhotoURL,
              coverURL: newCoverURL,
            });
            toast("Profile saved", "success");
            close();
            ctx.refreshProfile();
          } catch (err) {
            toast(err?.message || "Could not save", "error");
            submitBtn.disabled = false;
            submitBtn.textContent = "Save changes";
          }
        });
      },
    });
  }

  return {
    html,
    title: username ? `@${username}` : "Profile",
    mount(root) {
      root.querySelector("[data-act='back']")?.addEventListener("click", () => history.back());

      if (!username && ctx.state.profile) {
        // own profile via /profile
        renderProfile(root, ctx.state.profile);
        unsubProfile = watchProfile(ctx.state.profile.uid, (fresh) => {
          if (fresh) renderProfile(root, fresh);
        });
        return;
      }

      if (!username) {
        root.querySelector("#profile-root").innerHTML = emptyState("👤", "No profile", "Log in to see your profile.", '<button class="btn btn-primary btn-sm" type="button" data-act="login">Log in</button>');
        root.querySelector("[data-act='login']")?.addEventListener("click", () => ctx.requireAuth());
        return;
      }

      getProfileByUsername(username).then((profile) => {
        renderProfile(root, profile);
        if (profile) {
          unsubProfile = watchProfile(profile.uid, (fresh) => {
            if (fresh) renderProfile(root, fresh);
          });
        }
      });
    },
    destroy() {
      if (unsubVideos) unsubVideos();
      if (unsubProfile) unsubProfile();
    },
  };
}
