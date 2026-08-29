/** Xacheus Social — Profile pages and profile editing. */

import {
  changeUsername,
  getFollowers,
  getFollowing,
  getProfile,
  getProfileByUsername,
  isFollowing,
  openConversation,
  toggleFollow,
  updateProfile,
  watchSaved,
  watchUserPosts,
} from "../data.js";
import { uploadImage } from "../cloudinary.js";
import {
  avatar,
  bindZoom,
  clear,
  copyText,
  emptyState,
  esc,
  formatCount,
  fullDate,
  gradientFor,
  openModal,
  skeletonPosts,
  toast,
} from "../ui.js";
import { bindPostActions, hydratePostStates, postCardHtml, userRowHtml } from "./components.js";

export function profileView(ctx, params) {
  let unsubscribe = null;
  let destroyed = false;
  let profile = null;
  let tab = params.tab || "posts";
  let following = false;
  const username = params.username;

  const html = `
    <div class="view-head profile-head">
      <a class="icon-btn back-btn" href="#/home" aria-label="Back">←</a>
      <div>
        <h1 id="profile-name">Profile</h1>
        <p id="profile-sub" class="view-sub">Loading…</p>
      </div>
    </div>
    <div id="profile-root"><div class="loader-row"><span class="spinner"></span> Loading profile…</div></div>`;

  /* ---------------------------------------------------------------- */

  function coverStyle(user) {
    const [from, to] = gradientFor(user?.username || user?.uid || "xacheus");
    if (user?.coverURL) return `background-image:linear-gradient(180deg,rgba(0,0,0,.15),rgba(0,0,0,.35)),url(${esc(
      user.coverURL
    )});background-size:cover;background-position:center;`;
    return `background-image:linear-gradient(120deg,${from},${to});`;
  }

  function renderShell(root) {
    const isMe = ctx.state.profile?.uid === profile.uid;
    const host = root.querySelector("#profile-root");
    clear(host);

    host.innerHTML = `
      <div class="cover" style="${coverStyle(profile)}"></div>

      <div class="profile-identity">
        <div class="profile-avatar">${avatar(profile, "xl")}</div>
        <div class="profile-actions" id="profile-actions"></div>
      </div>

      <div class="profile-meta">
        <h2>
          ${esc(profile.displayName || profile.username)}
          ${profile.verified ? '<span class="verified" title="Verified">✓</span>' : ""}
        </h2>
        <p class="profile-handle">@${esc(profile.username)}</p>
        ${profile.bio ? `<p class="profile-bio">${esc(profile.bio)}</p>` : ""}
        <div class="profile-facts">
          ${
            profile.location
              ? `<span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7zm0 4.5A2.5 2.5 0 1 0 12 11a2.5 2.5 0 0 0 0-4.5z"/></svg>${esc(
                  profile.location
                )}</span>`
              : ""
          }
          ${
            profile.website
              ? `<span><a class="link" href="${esc(
                  normaliseUrl(profile.website)
                )}" target="_blank" rel="noopener noreferrer">${esc(
                  profile.website.replace(/^https?:\/\//, "")
                )}</a></span>`
              : ""
          }
          <span>📅 Joined ${fullDate(profile.createdAt) || "recently"}</span>
        </div>
        <div class="profile-stats">
          <a href="#/u/${esc(profile.username)}?tab=following" data-stat="following">
            <strong>${formatCount(profile.followingCount)}</strong> <span>Following</span>
          </a>
          <a href="#/u/${esc(profile.username)}?tab=followers" data-stat="followers">
            <strong>${formatCount(profile.followersCount)}</strong> <span>Followers</span>
          </a>
          <span><strong>${formatCount(profile.postsCount)}</strong> <span>Posts</span></span>
        </div>
      </div>

      ${
        isMe
          ? `<div class="profile-self-actions">
               <button class="btn btn-outline btn-sm" type="button" data-act="edit">Edit profile</button>
               <button class="btn btn-outline btn-sm" type="button" data-act="share-profile">Share profile</button>
             </div>`
          : ""
      }

      <div class="tabs profile-tabs" role="tablist">
        <button class="tab ${tab === "posts" ? "is-active" : ""}" role="tab" data-tab="posts">Posts</button>
        <button class="tab ${tab === "media" ? "is-active" : ""}" role="tab" data-tab="media">Media</button>
        <button class="tab ${tab === "likes" ? "is-active" : ""}" role="tab" data-tab="likes">Likes</button>
      </div>

      <div class="feed" id="profile-feed">${skeletonPosts(2)}</div>`;

    root.querySelector("#profile-name").textContent = profile.displayName || `@${profile.username}`;
    root.querySelector("#profile-sub").textContent = `${formatCount(profile.postsCount)} posts`;

    const actions = host.querySelector("#profile-actions");
    if (isMe) {
      actions.innerHTML = `<a class="btn btn-outline btn-sm" href="#/settings">Settings</a>`;
    } else {
      actions.innerHTML = `
        <button class="btn btn-outline btn-sm" type="button" data-act="message">Message</button>
        <button class="btn ${following ? "btn-outline" : "btn-primary"} btn-sm" type="button" data-act="follow">
          ${following ? "Following" : "Follow"}
        </button>`;
    }
  }

  async function renderTab(root) {
    const feed = root.querySelector("#profile-feed");
    if (!feed) return;
    if (unsubscribe) unsubscribe();
    clear(feed);
    feed.innerHTML = skeletonPosts(2);

    if (tab === "followers" || tab === "following") {
      const list = tab === "followers" ? await getFollowers(profile.uid, 60) : await getFollowing(profile.uid, 60);
      if (destroyed) return;
      const people = list.filter(Boolean);
      clear(feed);
      feed.innerHTML = people.length
        ? `<section class="panel">${people
            .map((user) => userRowHtml(user, { action: "Follow" }))
            .join("")}</section>`
        : emptyState("👥", tab === "followers" ? "No followers yet" : "Not following anyone yet", "");
      return;
    }

    if (tab === "likes") {
      unsubscribe = watchSaved(profile.uid, (posts) => {
        if (destroyed) return;
        clear(feed);
        feed.innerHTML = posts.length
          ? posts.map((post) => postCardHtml(post)).join("")
          : emptyState("🔖", "No saved posts", "Bookmark posts and they'll collect here.");
        posts.forEach((post) => ctx.postCache.set(post.id, post));
        hydratePostStates(feed, ctx.state.profile?.uid);
      });
      return;
    }

    unsubscribe = watchUserPosts(profile.uid, (posts) => {
      if (destroyed) return;
      const visible = tab === "media" ? posts.filter((post) => !!post.imageUrl) : posts;
      clear(feed);
      feed.innerHTML = visible.length
        ? visible.map((post) => postCardHtml(post)).join("")
        : emptyState(
            tab === "media" ? "🖼️" : "✍️",
            tab === "media" ? "No photos yet" : "No posts yet",
            tab === "media" ? "Photos they share will appear here." : "When they post, it shows up here."
          );
      visible.forEach((post) => ctx.postCache.set(post.id, post));
      hydratePostStates(feed, ctx.state.profile?.uid);
    });
  }

  return {
    html,
    title: `@${username}`,
    async mount(root) {
      bindPostActions(root, ctx);
      bindZoom(root);

      profile = username
        ? await getProfileByUsername(username).catch(() => null)
        : await getProfile(ctx.state.profile?.uid).catch(() => null);

      if (destroyed) return;
      if (!profile) {
        const host = root.querySelector("#profile-root");
        clear(host);
        host.innerHTML = emptyState(
          "🙈",
          "That profile doesn't exist",
          `We couldn't find @${username}. The handle may have changed.`,
          '<a class="btn btn-primary btn-sm" href="#/explore">Browse people</a>'
        );
        return;
      }

      if (ctx.state.profile && ctx.state.profile.uid !== profile.uid) {
        following = await isFollowing(ctx.state.profile.uid, profile.uid).catch(() => false);
      }

      renderShell(root);
      renderTab(root);

      root.addEventListener("click", async (event) => {
        const tabBtn = event.target.closest("[data-tab]");
        if (tabBtn) {
          tab = tabBtn.dataset.tab;
          root.querySelectorAll(".tab").forEach((node) => {
            const active = node.dataset.tab === tab;
            node.classList.toggle("is-active", active);
            node.setAttribute("aria-selected", String(active));
          });
          return renderTab(root);
        }

        const statLink = event.target.closest("[data-stat]");
        if (statLink) {
          event.preventDefault();
          tab = statLink.dataset.stat;
          root.querySelectorAll(".tab").forEach((node) => node.classList.toggle("is-active", false));
          return renderTab(root);
        }

        const trigger = event.target.closest("[data-act]");
        if (!trigger) return;
        const act = trigger.dataset.act;

        if (act === "edit") return openEditProfile(ctx);

        if (act === "share-profile") {
          return copyText(`${location.origin}${location.pathname}#/u/${profile.username}`);
        }

        if (act === "message") {
          if (!ctx.state.profile) return ctx.requireAuth();
          const cid = await openConversation(ctx.state.profile, profile).catch(() => null);
          if (cid) ctx.navigate(`#/messages/${cid}`);
          return;
        }

        if (act === "follow") {
          if (!ctx.state.profile) return ctx.requireAuth();
          const wasFollowing = trigger.textContent.trim() === "Following";
          trigger.disabled = true;
          trigger.textContent = wasFollowing ? "Follow" : "Following";
          trigger.classList.toggle("btn-outline", !wasFollowing);
          trigger.classList.toggle("btn-primary", wasFollowing);
          try {
            await toggleFollow(ctx.state.profile.uid, ctx.state.profile, profile);
            following = !wasFollowing;
            ctx.refreshProfile?.();
          } catch (error) {
            trigger.textContent = wasFollowing ? "Following" : "Follow";
            toast(error?.message || "Could not update that follow.", "error");
          } finally {
            trigger.disabled = false;
          }
        }
      });
    },
    destroy() {
      destroyed = true;
      if (unsubscribe) unsubscribe();
    },
  };
}

function normaliseUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "#";
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

/* ------------------------------------------------------------------ */
/* edit profile                                                        */
/* ------------------------------------------------------------------ */

export function openEditProfile(ctx) {
  const me = ctx.state.profile;
  if (!me) return ctx.requireAuth();

  openModal({
    title: "Edit profile",
    body: `
      <form class="edit-profile" id="edit-profile-form">
        <div class="edit-media">
          <label class="edit-avatar" title="Change profile photo">
            ${avatar(me, "xl")}
            <span class="edit-overlay">Change</span>
            <input type="file" id="edit-avatar-file" accept="image/*" hidden />
          </label>
          <label class="edit-cover" title="Change cover photo">
            <span>Cover</span>
            <input type="file" id="edit-cover-file" accept="image/*" hidden />
          </label>
        </div>

        <label class="field">
          <span>Display name</span>
          <input type="text" name="displayName" value="${esc(me.displayName || "")}" maxlength="40" required />
        </label>
        <label class="field">
          <span>Handle</span>
          <span class="field-prefix-wrap">
            <span class="field-prefix">@</span>
            <input type="text" name="username" value="${esc(me.username || "")}" maxlength="20" required />
          </span>
        </label>
        <label class="field">
          <span>Bio</span>
          <textarea name="bio" rows="3" maxlength="160" placeholder="Tell people who you are…">${esc(
            me.bio || ""
          )}</textarea>
        </label>
        <div class="field-row">
          <label class="field">
            <span>Location</span>
            <input type="text" name="location" value="${esc(me.location || "")}" maxlength="40" placeholder="Chipata, Zambia" />
          </label>
          <label class="field">
            <span>Website</span>
            <input type="text" name="website" value="${esc(me.website || "")}" maxlength="80" placeholder="xacheus.ai" />
          </label>
        </div>

        <div class="modal-actions">
          <button class="btn btn-ghost" type="button" data-act="cancel">Cancel</button>
          <button class="btn btn-primary" type="submit">Save changes</button>
        </div>
      </form>`,
    onMount(root, close) {
      const form = root.querySelector("#edit-profile-form");
      const submit = form.querySelector('button[type="submit"]');
      let avatarFile = null;
      let coverFile = null;

      root.querySelector("#edit-avatar-file").addEventListener("change", (event) => {
        avatarFile = event.target.files?.[0] || null;
        if (avatarFile) toast("Photo selected — save to apply", "info", 2500);
      });
      root.querySelector("#edit-cover-file").addEventListener("change", (event) => {
        coverFile = event.target.files?.[0] || null;
        if (coverFile) toast("Cover selected — save to apply", "info", 2500);
      });
      root.querySelector('[data-act="cancel"]').addEventListener("click", close);

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = new FormData(form);
        const displayName = String(data.get("displayName") || "").trim();
        const username = String(data.get("username") || "").trim();
        if (!displayName) return toast("Display name can't be empty.", "error");

        submit.disabled = true;
        submit.textContent = "Saving…";
        try {
          const patch = {
            displayName,
            displayNameLower: displayName.toLowerCase(),
            bio: String(data.get("bio") || "").trim(),
            location: String(data.get("location") || "").trim(),
            website: String(data.get("website") || "").trim(),
          };

          if (username !== me.username) await changeUsername(me.uid, username);
          if (avatarFile) patch.photoURL = (await uploadImage(avatarFile)) || me.photoURL || "";
          if (coverFile) patch.coverURL = (await uploadImage(coverFile)) || me.coverURL || "";

          await updateProfile(me.uid, patch);
          await ctx.refreshProfile?.();
          toast("Profile updated", "success");
          close();
          ctx.navigate(`#/u/${username}`);
        } catch (error) {
          submit.disabled = false;
          submit.textContent = "Save changes";
          toast(error?.message || "Could not save your profile.", "error", 5000);
        }
      });
    },
  });
}
