/** Xacheus Social — Explore: search, trending hashtags and people to follow. */

import {
  getSuggestedUsers,
  getTrending,
  searchUsers,
  toggleFollow,
  watchHashtag,
} from "../data.js";
import { avatar, bindZoom, clear, emptyState, esc, formatCount, skeletonPosts, toast } from "../ui.js";
import { bindPostActions, hydratePostStates, postCardHtml, userRowHtml } from "./components.js";

export function exploreView(ctx, params = {}) {
  let tab = params.tab || "foryou";
  let unsubscribe = null;
  let destroyed = false;

  const html = `
    <div class="view-head">
      <h1>Explore</h1>
      <form class="inline-search" id="explore-search" role="search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12zm11 17-5.2-5.2"/></svg>
        <input type="search" name="q" placeholder="Search people or #hashtags" autocomplete="off" aria-label="Search" />
      </form>
    </div>

    <div class="tabs" role="tablist">
      <button class="tab ${tab === "foryou" ? "is-active" : ""}" role="tab" type="button" data-tab="foryou">For you</button>
      <button class="tab ${tab === "trending" ? "is-active" : ""}" role="tab" type="button" data-tab="trending">Trending</button>
      <button class="tab ${tab === "people" ? "is-active" : ""}" role="tab" type="button" data-tab="people">People</button>
    </div>

    <div class="explore-body" id="explore-body">${skeletonPosts(2)}</div>`;

  /* ---------------------------------------------------------------- */

  async function renderForYou(root) {
    const body = root.querySelector("#explore-body");
    clear(body);
    body.innerHTML = `<div class="panel-grid">${skeletonPosts(2)}</div>`;

    const [trends, people] = await Promise.all([
      getTrending(6).catch(() => []),
      getSuggestedUsers(ctx.state.profile?.uid, 5).catch(() => []),
    ]);
    if (destroyed) return;

    clear(body);
    body.innerHTML = `
      ${
        trends.length
          ? `<section class="panel">
               <h2 class="panel-title">Trending now</h2>
               ${trends
                 .map(
                   (tag, index) => `
                 <a class="trend-row" href="#/tag/${esc(tag.tag || tag.id)}">
                   <span class="trend-rank">${index + 1}</span>
                   <span class="trend-meta">
                     <strong>#${esc(tag.tag || tag.id)}</strong>
                     <em>${formatCount(tag.count)} ${tag.count === 1 ? "post" : "posts"}</em>
                   </span>
                   <span class="trend-arrow" aria-hidden="true">→</span>
                 </a>`
                 )
                 .join("")}
             </section>`
          : ""
      }

      <section class="panel">
        <h2 class="panel-title">People to follow</h2>
        ${
          people.length
            ? people.map((user) => userRowHtml(user, { action: "Follow" })).join("")
            : `<p class="panel-empty">You're already following everyone here. Nice work.</p>`
        }
        <a class="panel-more" href="#/explore?tab=people">See more people →</a>
      </section>

      <section class="panel panel-tip">
        <h2 class="panel-title">Grow faster</h2>
        <ul class="tip-list">
          <li>Tag your posts with <code>#hashtags</code> so they show up in Trending.</li>
          <li>Mention people with <code>@handle</code> to send them a notification.</li>
          <li>Reply to others — conversations grow accounts faster than posts do.</li>
        </ul>
      </section>`;
  }

  async function renderTrending(root) {
    const body = root.querySelector("#explore-body");
    clear(body);
    body.innerHTML = skeletonPosts(2);

    const trends = await getTrending(12).catch(() => []);
    if (destroyed) return;

    clear(body);
    if (!trends.length) {
      body.innerHTML = emptyState(
        "#",
        "No trends yet",
        "Post something with a #hashtag and it will appear here."
      );
      return;
    }
    body.innerHTML = `
      <section class="panel">
        <h2 class="panel-title">What people are talking about</h2>
        ${trends
          .map(
            (tag, index) => `
          <a class="trend-row" href="#/tag/${esc(tag.tag || tag.id)}">
            <span class="trend-rank">${index + 1}</span>
            <span class="trend-meta">
              <strong>#${esc(tag.tag || tag.id)}</strong>
              <em>${formatCount(tag.count)} ${tag.count === 1 ? "post" : "posts"}</em>
            </span>
            <span class="trend-arrow" aria-hidden="true">→</span>
          </a>`
          )
          .join("")}
      </section>`;
  }

  async function renderPeople(root) {
    const body = root.querySelector("#explore-body");
    clear(body);
    body.innerHTML = skeletonPosts(2);
    const people = await getSuggestedUsers(ctx.state.profile?.uid, 24).catch(() => []);
    if (destroyed) return;
    clear(body);
    body.innerHTML = people.length
      ? `<section class="panel">${people
          .map((user) => userRowHtml(user, { action: "Follow" }))
          .join("")}</section>`
      : emptyState("👥", "Everyone's already connected", "Check back when new people join.");
  }

  async function renderSearch(root, term) {
    const body = root.querySelector("#explore-body");
    clear(body);
    body.innerHTML = skeletonPosts(2);

    if (term.startsWith("#")) {
      const tag = term.slice(1);
      unsubscribe?.();
      body.innerHTML = `<div class="tag-head"><h2>#${esc(tag)}</h2></div><div class="feed" id="tag-feed">${skeletonPosts(
        2
      )}</div>`;
      unsubscribe = watchHashtag(tag, (posts) => {
        const feed = body.querySelector("#tag-feed");
        if (!feed) return;
        clear(feed);
        feed.innerHTML = posts.length
          ? posts.map((post) => postCardHtml(post)).join("")
          : emptyState("#", `Nothing tagged #${tag} yet`, "Be the first to post with this hashtag.");
        posts.forEach((post) => ctx.postCache.set(post.id, post));
        hydratePostStates(feed, ctx.state.profile?.uid);
      });
      return;
    }

    const users = await searchUsers(term, 15).catch(() => []);
    if (destroyed) return;
    clear(body);
    body.innerHTML = users.length
      ? `<section class="panel"><h2 class="panel-title">People</h2>${users
          .map((user) => userRowHtml(user, { action: "Follow" }))
          .join("")}</section>`
      : emptyState("🔍", `No results for “${term}”`, "Try a different name, handle or #hashtag.");
  }

  function setTab(root, next, term = "") {
    tab = next;
    root.querySelectorAll(".tab").forEach((button) => {
      const active = button.dataset.tab === next;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
    if (term) return renderSearch(root, term);
    if (next === "trending") return renderTrending(root);
    if (next === "people") return renderPeople(root);
    return renderForYou(root);
  }

  return {
    html,
    title: "Explore",
    mount(root) {
      bindPostActions(root, ctx);
      bindZoom(root);

      root.querySelectorAll(".tab").forEach((button) => {
        button.addEventListener("click", () => {
          const term = root.querySelector('input[name="q"]').value.trim();
          setTab(root, button.dataset.tab, term);
          const next = new URLSearchParams();
          next.set("tab", button.dataset.tab);
          history.replaceState(null, "", `#/explore?${next}`);
        });
      });

      let timer;
      root.querySelector("#explore-search").addEventListener("submit", (event) => event.preventDefault());
      root.querySelector('input[name="q"]').addEventListener("input", (event) => {
        const term = event.target.value.trim();
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (!term) return setTab(root, tab);
          renderSearch(root, term);
        }, 350);
      });

      root.addEventListener("click", async (event) => {
        const followBtn = event.target.closest('[data-act="follow"]');
        if (!followBtn) return;
        if (!ctx.state.profile) return ctx.requireAuth();

        const row = followBtn.closest(".user-row");
        const uid = row?.dataset.uid;
        if (!uid) return;

        const target = {
          uid,
          username: row.querySelector("em")?.textContent.replace("@", "") || uid,
          displayName: row.querySelector("strong")?.textContent.trim() || "User",
        };
        const wasFollowing = followBtn.textContent.trim() === "Following";
        followBtn.disabled = true;

        const paint = (isFollowing) => {
          followBtn.textContent = isFollowing ? "Following" : "Follow";
          followBtn.classList.toggle("btn-outline", isFollowing);
          followBtn.classList.toggle("btn-primary", !isFollowing);
          followBtn.setAttribute("aria-pressed", String(isFollowing));
        };

        paint(!wasFollowing); // optimistic
        try {
          const isFollowing = await toggleFollow(ctx.state.profile.uid, ctx.state.profile, target);
          paint(isFollowing); // settle to the server's answer
          ctx.refreshProfile?.();
        } catch (error) {
          paint(wasFollowing);
          toast(error?.message || "Could not update that follow.", "error");
        } finally {
          followBtn.disabled = false;
        }
      });

      const term = params.q || "";
      if (term) {
        root.querySelector('input[name="q"]').value = term;
        renderSearch(root, term);
      } else if (tab === "trending") {
        renderTrending(root);
      } else if (tab === "people") {
        renderPeople(root);
      } else {
        renderForYou(root);
      }
    },
    destroy() {
      destroyed = true;
      if (unsubscribe) unsubscribe();
    },
  };
}
