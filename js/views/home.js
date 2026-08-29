/** Xacheus — Home vertical video feed (Phase 1) */

import { bumpVideoView, fetchVideoPage, getFollowingIds, watchVideoFeed } from "../data.js";
import { emptyState, toast } from "../ui.js";
import { bindVideoActions, hydrateVideoStates, videoCardHtml } from "./components.js";

// Count a view after this much continuous playback, so drive-by scrolls
// through the feed don't inflate the counter.
const VIEW_COUNT_DELAY = 2000;

export function homeView(ctx, { focusVideoId = null } = {}) {
  let mode = ctx.state.feedMode || "foryou";
  let unsubscribe = null;
  let lastDocs = [];
  let loadingMore = false;
  let followingIds = [];
  let destroyed = false;
  let observer = null;

  const html = `
    <div class="video-feed-head">
      <div class="feed-tabs">
        <button class="feed-tab ${mode === "foryou" ? "is-active" : ""}" data-mode="foryou">For You</button>
        <button class="feed-tab ${mode === "following" ? "is-active" : ""}" data-mode="following">Following</button>
      </div>
      <button class="icon-btn" type="button" data-act="refresh" aria-label="Refresh">⟳</button>
    </div>

    <div class="video-feed" id="video-feed" aria-live="polite">
      <div class="loader-row"><span class="spinner"></span> Loading videos…</div>
    </div>

    <div class="feed-foot" id="feed-foot"></div>
  `;

  function renderVideos(root, videos) {
    const feed = root.querySelector("#video-feed");
    if (!feed) return;

    if (!videos.length) {
      feed.innerHTML =
        mode === "following"
          ? emptyState("🛰️", "Your following feed is quiet", "Follow creators and their videos will appear here.", '<a class="btn btn-primary btn-sm" href="#/discover">Find creators</a>')
          : emptyState("🎬", "No videos yet", "Be the first to post a vertical video — it will show up here instantly.", '<a class="btn btn-primary btn-sm" href="#/create">Create video</a>');
      root.querySelector("#feed-foot").innerHTML = "";
      return;
    }

    // If focusVideoId, bring it to top
    let ordered = videos;
    if (focusVideoId) {
      const idx = videos.findIndex((v) => v.id === focusVideoId);
      if (idx > 0) {
        const focused = videos[idx];
        ordered = [focused, ...videos.slice(0, idx), ...videos.slice(idx + 1)];
      }
    }

    feed.innerHTML = ordered.map((v) => videoCardHtml(v)).join("");
    ordered.forEach((v) => ctx.videoCache.set(v.id, v));
    hydrateVideoStates(feed, ctx.state.profile?.uid);
    setupIntersection(feed);
    root.querySelector("#feed-foot").innerHTML =
      ordered.length >= 6
        ? '<button class="btn btn-ghost btn-block" type="button" data-act="more">Load more videos</button>'
        : `<p class="feed-end">You're all caught up 🎉</p>`;
  }

  function scheduleViewCount(video) {
    const videoId = video.dataset.videoId;
    if (!videoId || ctx.countedViews.has(videoId)) return;
    clearTimeout(video._viewTimer);
    video._viewTimer = setTimeout(() => {
      ctx.countedViews.add(videoId);
      bumpVideoView(videoId).catch(() => {});
    }, VIEW_COUNT_DELAY);
  }

  function cancelViewCount(video) {
    clearTimeout(video._viewTimer);
  }

  function setupIntersection(feed) {
    if (observer) observer.disconnect();
    const vids = feed.querySelectorAll("video");
    if (!vids.length) return;

    observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const video = entry.target;
          const card = video.closest(".video-card");
          if (entry.isIntersecting && entry.intersectionRatio >= 0.7) {
            // pause others
            feed.querySelectorAll("video").forEach((v) => {
              if (v !== video) {
                v.pause();
                cancelViewCount(v);
                v.closest(".video-card")?.classList.remove("is-playing");
              }
            });
            video.play().catch(() => {});
            card?.classList.add("is-playing");
            scheduleViewCount(video);
            // progress
            const progress = card?.querySelector(".video-progress span");
            if (progress) {
              video.ontimeupdate = () => {
                if (video.duration) {
                  progress.style.width = `${(video.currentTime / video.duration) * 100}%`;
                }
              };
            }
          } else {
            video.pause();
            cancelViewCount(video);
            card?.classList.remove("is-playing");
          }
        });
      },
      { threshold: [0, 0.5, 0.7, 1] }
    );

    vids.forEach((v) => observer.observe(v));
  }

  async function start(root) {
    if (unsubscribe) unsubscribe();
    const feed = root.querySelector("#video-feed");
    feed.innerHTML = `<div class="loader-row"><span class="spinner"></span> Loading videos…</div>`;

    if (mode === "following") {
      if (!ctx.state.profile) {
        feed.innerHTML = emptyState("🔒", "Log in to see following", "Create a free account to follow creators.", '<button class="btn btn-primary btn-sm" type="button" data-act="login">Log in</button>');
        return;
      }
      followingIds = await getFollowingIds(ctx.state.profile.uid).catch(() => []);
      if (!followingIds.length) {
        feed.innerHTML = emptyState("🛰️", "You aren't following anyone yet", "Follow creators to build your feed.", '<a class="btn btn-primary btn-sm" href="#/discover">Find creators</a>');
        return;
      }
    }

    if (destroyed) return;
    unsubscribe = watchVideoFeed({
      mode,
      uid: ctx.state.profile?.uid,
      followingIds,
      onData: (videos, docs) => {
        lastDocs = docs || [];
        renderVideos(root, videos);
      },
    });
  }

  return {
    html,
    title: mode === "following" ? "Following" : "For You",
    mount(root) {
      bindVideoActions(root, ctx);

      root.addEventListener("click", async (event) => {
        const trigger = event.target.closest("[data-act],[data-mode]");
        if (!trigger) return;

        if (trigger.dataset.mode) {
          mode = trigger.dataset.mode;
          ctx.state.feedMode = mode;
          localStorage.setItem("xacheus_feedMode", mode);
          root.querySelectorAll(".feed-tab").forEach((tab) => {
            tab.classList.toggle("is-active", tab.dataset.mode === mode);
          });
          // also sync topbar tabs
          document.querySelectorAll(".top-tab").forEach((t) => t.classList.toggle("is-active", t.dataset.feed === mode));
          start(root);
          return;
        }

        if (trigger.dataset.act === "login") return ctx.requireAuth();
        if (trigger.dataset.act === "refresh") return start(root);

        if (trigger.dataset.act === "more") {
          if (loadingMore || !lastDocs.length) return;
          loadingMore = true;
          trigger.disabled = true;
          trigger.textContent = "Loading…";
          try {
            const { items, docs } = await fetchVideoPage({
              mode,
              uid: ctx.state.profile?.uid,
              followingIds,
              afterDoc: lastDocs[lastDocs.length - 1],
            });
            const feed = root.querySelector("#video-feed");
            if (items.length) {
              const frag = document.createElement("div");
              frag.innerHTML = items.map((v) => videoCardHtml(v)).join("");
              feed.appendChild(frag);
              items.forEach((v) => ctx.videoCache.set(v.id, v));
              await hydrateVideoStates(frag, ctx.state.profile?.uid);
              setupIntersection(feed);
              lastDocs = docs;
            }
            trigger.disabled = false;
            trigger.textContent = "Load more videos";
            if (!items.length) toast("That's everything for now", "info", 2000);
          } catch (e) {
            console.warn("[xacheus] load more", e);
            toast("Could not load more videos", "error");
            trigger.disabled = false;
            trigger.textContent = "Load more videos";
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
      if (observer) observer.disconnect();
      // pause all videos and drop pending view timers
      document.querySelectorAll(".video-player").forEach((v) => {
        clearTimeout(v._viewTimer);
        v.pause();
      });
    },
  };
}
