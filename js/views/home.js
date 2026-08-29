/** Xacheus Social — Home feed. */

import { fetchFeedPage, getFollowingIds, watchFeed } from "../data.js";
import { avatar, bindZoom, clear, emptyState, esc, skeletonPosts, toast } from "../ui.js";
import { bindPostActions, hydratePostStates, openComposer, postCardHtml } from "./components.js";

export function homeView(ctx) {
  let mode = ctx.state.feedMode || "foryou";
  let unsubscribe = null;
  let lastDocs = [];
  let loadingMore = false;
  let followingIds = [];
  let destroyed = false;

  const html = `
    <div class="view-head">
      <h1>Home</h1>
      <button class="icon-btn" type="button" data-act="refresh" aria-label="Refresh feed">⟳</button>
    </div>

    <div class="composer-prompt">
      ${ctx.state.profile ? avatar(ctx.state.profile, "md") : avatar({ username: "guest" }, "md")}
      <button class="composer-prompt-input" type="button" data-act="compose">
        ${esc(ctx.state.profile ? "What's happening?" : "Sign in to post")}
      </button>
      <button class="btn btn-primary btn-sm" type="button" data-act="compose">Post</button>
    </div>

    <div class="tabs" role="tablist">
      <button class="tab ${mode === "foryou" ? "is-active" : ""}" role="tab" type="button" data-mode="foryou" aria-selected="${mode === "foryou"}">For you</button>
      <button class="tab ${mode === "following" ? "is-active" : ""}" role="tab" type="button" data-mode="following" aria-selected="${mode === "following"}">Following</button>
    </div>

    <div class="feed" id="feed" aria-live="polite">${skeletonPosts(3)}</div>

    <div class="feed-foot" id="feed-foot"></div>`;

  function renderFeed(root, posts) {
    const feed = root.querySelector("#feed");
    clear(feed);

    if (!posts.length) {
      feed.innerHTML =
        mode === "following"
          ? emptyState(
              "🛰️",
              "Your following feed is quiet",
              "Follow a few people and their posts will land here.",
              '<a class="btn btn-primary btn-sm" href="#/explore">Find people to follow</a>'
            )
          : emptyState(
              "✍️",
              "No posts yet",
              "Be the first to say something — your post will show up here instantly.",
              '<button class="btn btn-primary btn-sm" type="button" data-act="compose">Write the first post</button>'
            );
      return;
    }

    const me = ctx.state.profile;
    const frag = document.createElement("div");
    frag.innerHTML = posts.map((post) => postCardHtml(post)).join("");
    feed.appendChild(frag);
    posts.forEach((post) => ctx.postCache.set(post.id, post));

    hydratePostStates(feed, me?.uid);
    root.querySelector("#feed-foot").innerHTML =
      posts.length >= 20
        ? '<button class="btn btn-ghost btn-block" type="button" data-act="more">Load more posts</button>'
        : `<p class="feed-end">You're all caught up 🎉</p>`;
  }

  async function start(root) {
    if (unsubscribe) unsubscribe();
    const feed = root.querySelector("#feed");
    clear(feed);
    feed.innerHTML = skeletonPosts(3);

    if (mode === "following") {
      if (!ctx.state.profile) {
        feed.innerHTML = emptyState(
          "🔒",
          "Log in to see your following feed",
          "Create a free account to follow people and build a personal timeline.",
          '<button class="btn btn-primary btn-sm" type="button" data-act="login">Log in</button>'
        );
        return;
      }
      followingIds = await getFollowingIds(ctx.state.profile.uid).catch(() => []);
      if (!followingIds.length) {
        feed.innerHTML = emptyState(
          "🛰️",
          "You aren't following anyone yet",
          "Follow a few accounts to build a personal timeline.",
          '<a class="btn btn-primary btn-sm" href="#/explore">Find people to follow</a>'
        );
        return;
      }
    }

    if (destroyed) return;
    unsubscribe = watchFeed({
      authors: mode === "following" ? followingIds : null,
      onData: (posts, docs) => {
        lastDocs = docs || [];
        renderFeed(root, posts);
      },
    });
  }

  return {
    html,
    title: "Home",
    mount(root) {
      bindPostActions(root, ctx);
      bindZoom(root);

      root.addEventListener("click", async (event) => {
        const trigger = event.target.closest("[data-act],[data-mode]");
        if (!trigger) return;

        if (trigger.dataset.mode) {
          mode = trigger.dataset.mode;
          ctx.state.feedMode = mode;
          root.querySelectorAll(".tab").forEach((tab) => {
            const active = tab.dataset.mode === mode;
            tab.classList.toggle("is-active", active);
            tab.setAttribute("aria-selected", String(active));
          });
          start(root);
          return;
        }

        if (trigger.dataset.act === "compose") {
          if (!ctx.state.profile) return ctx.requireAuth();
          return openComposer(ctx, { onPosted: () => start(root) });
        }
        if (trigger.dataset.act === "login") return ctx.requireAuth();
        if (trigger.dataset.act === "refresh") return start(root);

        if (trigger.dataset.act === "more") {
          if (loadingMore || !lastDocs.length) return;
          loadingMore = true;
          trigger.disabled = true;
          trigger.textContent = "Loading…";
          try {
            const { items, docs } = await fetchFeedPage({
              authors: mode === "following" ? followingIds : null,
              afterDoc: lastDocs[lastDocs.length - 1],
            });
            const feed = root.querySelector("#feed");
            if (items.length) {
              const frag = document.createElement("div");
              frag.innerHTML = items.map((post) => postCardHtml(post)).join("");
              feed.appendChild(frag);
              items.forEach((post) => ctx.postCache.set(post.id, post));
              await hydratePostStates(frag, ctx.state.profile?.uid);
              lastDocs = docs;
            }
            trigger.disabled = false;
            trigger.textContent = "Load more posts";
            if (!items.length) toast("That's everything for now", "info", 2000);
          } catch (error) {
            console.warn("[xacheus] load more", error);
            toast("Could not load more posts.", "error");
            trigger.disabled = false;
            trigger.textContent = "Load more posts";
          } finally {
            loadingMore = false;
          }
        }
      });

      start(root);
    },
    destroy() {
      destroyed = true;
      if (unsubscribe) unsubscribe();
    },
  };
}
