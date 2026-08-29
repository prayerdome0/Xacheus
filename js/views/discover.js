/** Xacheus — Discover (trending videos, sounds, users) Phase 1 */

import { getTrending, searchUsers, searchVideos, watchTrendingVideos, watchTrendingSounds } from "../data.js";
import { esc, formatCount, avatar, emptyState } from "../ui.js";
import { videoCardHtml, bindVideoActions, hydrateVideoStates, userRowHtml } from "./components.js";

export function discoverView(ctx, { q = "", tab = "videos" } = {}) {
  const initialQuery = q || "";
  const initialTab = tab || (initialQuery.startsWith("#") ? "hashtags" : "videos");

  const html = `
    <div class="view-head">
      <h1>Discover</h1>
      <p class="view-sub">Trending videos, sounds and creators</p>
    </div>

    <form class="discover-search" id="discover-search">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12zm11 17-5.2-5.2"/></svg>
      <input type="search" name="q" placeholder="Search creators, #hashtags, sounds…" value="${esc(initialQuery)}" autocomplete="off" />
      <button class="btn btn-primary btn-sm" type="submit">Search</button>
    </form>

    <div class="tabs" role="tablist">
      <button class="tab ${initialTab === "videos" ? "is-active" : ""}" data-tab="videos">Trending videos</button>
      <button class="tab ${initialTab === "sounds" ? "is-active" : ""}" data-tab="sounds">Trending sounds</button>
      <button class="tab ${initialTab === "users" ? "is-active" : ""}" data-tab="users">Creators</button>
      <button class="tab ${initialTab === "hashtags" ? "is-active" : ""}" data-tab="hashtags">Hashtags</button>
    </div>

    <div class="discover-content" id="discover-content">
      <div class="loader-row"><span class="spinner"></span> Loading…</div>
    </div>
  `;

  let currentTab = initialTab;
  let unsubVideos = null;
  let unsubSounds = null;

  async function renderTab(root, tab, query = "") {
    const content = root.querySelector("#discover-content");
    currentTab = tab;
    root.querySelectorAll(".tabs .tab").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === tab));

    if (unsubVideos) { unsubVideos(); unsubVideos = null; }
    if (unsubSounds) { unsubSounds(); unsubSounds = null; }

    if (tab === "videos") {
      content.innerHTML = `<div class="loader-row"><span class="spinner"></span> Loading trending videos…</div>`;
      if (query) {
        const tag = query.replace(/^#/, "").trim();
        if (tag) {
          const vids = await searchVideos(tag, 20);
          if (!vids.length) {
            content.innerHTML = emptyState("🔍", "No videos for that tag", `Try another hashtag or browse trending.`, "");
          } else {
            content.innerHTML = `<div class="video-grid">${vids.map((v) => videoGridCard(v)).join("")}</div>`;
            content.querySelectorAll(".video-grid-card").forEach((c) => {
              c.addEventListener("click", () => ctx.navigate(`#/video/${c.dataset.videoId}`));
            });
          }
          return;
        }
      }
      unsubVideos = watchTrendingVideos((videos) => {
        if (!videos.length) {
          content.innerHTML = emptyState("🎬", "No trending videos yet", "Be first to post!", '<a class="btn btn-primary btn-sm" href="#/create">Create video</a>');
          return;
        }
        content.innerHTML = `<div class="video-grid">${videos.map((v) => videoGridCard(v)).join("")}</div>`;
        videos.forEach((v) => ctx.videoCache.set(v.id, v));
        content.querySelectorAll(".video-grid-card").forEach((card) => {
          card.addEventListener("click", () => ctx.navigate(`#/video/${card.dataset.videoId}`));
        });
      });
    } else if (tab === "sounds") {
      content.innerHTML = `<div class="loader-row"><span class="spinner"></span> Loading sounds…</div>`;
      unsubSounds = watchTrendingSounds((sounds) => {
        if (!sounds.length) {
          content.innerHTML = emptyState("🎵", "No sounds yet", "Upload a video with original sound.", "");
          return;
        }
        let filtered = sounds;
        if (query) {
          const qLower = query.toLowerCase();
          filtered = sounds.filter((s) => s.title.toLowerCase().includes(qLower) || (s.artist || "").toLowerCase().includes(qLower) || (s.genre || "").toLowerCase().includes(qLower));
        }
        content.innerHTML = filtered.map((s) => soundRow(s)).join("") || emptyState("🔍", "No sounds match", "Try another search.", "");
        content.querySelectorAll("[data-act='use-sound']").forEach((btn) => {
          btn.addEventListener("click", () => {
            ctx.navigate(`#/discover?q=${encodeURIComponent(btn.dataset.soundTitle || "")}&tab=videos`);
          });
        });
      });
    } else if (tab === "users") {
      if (!query) {
        content.innerHTML = `<p class="panel-empty">Type a name or handle to search creators.</p>`;
        return;
      }
      content.innerHTML = `<div class="loader-row"><span class="spinner"></span> Searching…</div>`;
      const users = await searchUsers(query, 20);
      if (!users.length) {
        content.innerHTML = emptyState("👤", "No creators found", `No results for "${esc(query)}"`, "");
      } else {
        content.innerHTML = users.map((u) => userRowHtml(u, { action: "" })).join("");
      }
    } else if (tab === "hashtags") {
      content.innerHTML = `<div class="loader-row"><span class="spinner"></span> Loading hashtags…</div>`;
      const trends = await getTrending(20);
      let list = trends;
      if (query) {
        const qLower = query.replace(/^#/, "").toLowerCase();
        list = trends.filter((t) => (t.tag || t.id).toLowerCase().includes(qLower));
      }
      if (!list.length) {
        content.innerHTML = emptyState("#️⃣", "No trending hashtags", "Post videos with #hashtags to start trends.", "");
      } else {
        content.innerHTML = list.map((tag) => `
          <a class="trend-row" href="#/discover?q=%23${esc(tag.tag || tag.id)}&tab=videos">
            <span class="trend-meta">
              <strong>#${esc(tag.tag || tag.id)}</strong>
              <em>${formatCount(tag.count)} videos</em>
            </span>
            <span class="trend-arrow">→</span>
          </a>
        `).join("");
      }
    }
  }

  function videoGridCard(video) {
    return `
      <div class="video-grid-card" data-video-id="${esc(video.id)}">
        <div class="grid-thumb">
          ${video.thumbnailUrl ? `<img src="${esc(video.thumbnailUrl)}" alt="" loading="lazy" />` : `<video src="${esc(video.videoUrl)}" muted preload="metadata"></video>`}
          <span class="grid-views">❤️ ${formatCount(video.likeCount)}</span>
        </div>
        <div class="grid-meta">
          <strong>@${esc(video.username)}</strong>
          <em>${esc((video.caption || "").slice(0, 60))}</em>
        </div>
      </div>
    `;
  }

  function soundRow(sound) {
    return `
      <div class="sound-row">
        <div class="sound-row-main">
          <span class="sound-cover">🎵</span>
          <span class="sound-meta">
            <strong>${esc(sound.title)}</strong>
            <em>${esc(sound.artist || "")} · ${esc(sound.genre || "")} · used ${sound.useCount || 0}</em>
          </span>
        </div>
        <audio src="${esc(sound.audioUrl)}" controls preload="none"></audio>
        <button class="btn btn-outline btn-sm" type="button" data-act="use-sound" data-sound-title="${esc(sound.title)}">View videos</button>
      </div>
    `;
  }

  return {
    html,
    title: "Discover",
    mount(root) {
      const searchForm = root.querySelector("#discover-search");
      const input = searchForm.querySelector("input");

      // initial render
      renderTab(root, currentTab, initialQuery);

      searchForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const q = input.value.trim();
        if (!q) return;
        // decide tab based on query
        let tab = currentTab;
        if (q.startsWith("#")) tab = "videos";
        else if (q.startsWith("@")) tab = "users";
        renderTab(root, tab, q);
        // update hash without reload
        history.replaceState(null, "", `#/discover?q=${encodeURIComponent(q)}&tab=${tab}`);
      });

      root.querySelectorAll(".tabs .tab").forEach((btn) => {
        btn.addEventListener("click", () => {
          const tab = btn.dataset.tab;
          const q = input.value.trim();
          renderTab(root, tab, q);
          history.replaceState(null, "", `#/discover?q=${encodeURIComponent(q)}&tab=${tab}`);
        });
      });

      bindVideoActions(root, ctx);
    },
    destroy() {
      if (unsubVideos) unsubVideos();
      if (unsubSounds) unsubSounds();
    },
  };
}
