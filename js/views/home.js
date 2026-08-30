/**
 * Xacheus — Home.
 *
 * The vertical feed: stories on top, then one card per post with real counts.
 * Autoplay is driven by IntersectionObserver, and playback pauses whenever the
 * story viewer or a modal is open so audio never doubles up.
 */

import { bumpVideoView, fetchVideoPage, getFollowingIds, watchVideoFeed } from "../data.js";
import { emptyState, formatCount, toast } from "../ui.js";
import { bindVideoActions, hydrateVideoStates, videoCardHtml } from "./components.js";
import { renderStoryTray, storyViewerOpen } from "./stories.js";
import { getPlayerOptions } from "../player.js";
import { getMutedIds } from "../social.js";

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
  let storyStop = null;
  let mutedIds = new Set();
  // New-post handling: the feed is a live Firestore snapshot, so a brand-new
  // post arrives while you're reading. Shoving it in under the reader would
  // move the post they're on, so instead we hold it and offer a pill.
  let renderedIds = new Set();
  let pending = null; // videos waiting behind the "N new posts" pill
  let footObserver = null;
  let exhausted = false;
  const onVideoUpdated = (event) => applyCounts(event.detail);

  const html = `
    <div class="video-feed-head">
      <div class="feed-tabs">
        <button class="feed-tab ${mode === "foryou" ? "is-active" : ""}" data-mode="foryou">For You</button>
        <button class="feed-tab ${mode === "following" ? "is-active" : ""}" data-mode="following">Following</button>
      </div>
      <button class="icon-btn" type="button" data-act="refresh" aria-label="Refresh">⟳</button>
    </div>

    <section class="story-strip-host" data-story-tray hidden></section>

    <div class="feed-newpill-host">
      <button class="feed-newpill" type="button" data-act="new-posts" hidden>
        <span class="feed-newpill-icon" aria-hidden="true">↑</span>
        <span data-new-count>New posts</span>
      </button>
    </div>

    <div class="feed-pull" id="feed-pull" aria-hidden="true">
      <span class="feed-pull-arrow">↓</span><span class="feed-pull-text">Pull to refresh</span>
    </div>

    <div class="video-feed" id="video-feed" aria-live="polite">
      <div class="loader-row"><span class="spinner"></span> Loading videos…</div>
    </div>

    <div class="feed-foot" id="feed-foot"></div>
  `;

  /** Data saver: don't pre-download feed video bytes until asked. */
  function applyPlaybackPrefs(host) {
    const opts = getPlayerOptions();
    host.querySelectorAll("video.video-player").forEach((v) => {
      v.preload = opts.dataSaver ? "none" : "metadata";
    });
    if (opts.autoplayPreviews === false) host.classList.add("is-no-autoplay");
    else host.classList.remove("is-no-autoplay");
  }

  /** Tap a video (or its photo slide) to start/stop it. */
  function wireTapToPlay(root) {
    root.addEventListener("click", (event) => {
      const video = event.target.closest("video.video-player");
      if (!video) return;
      const card = video.closest(".video-card");
      if (event.target.closest("[data-act]")) return;
      if (video.paused) {
        root.querySelectorAll("video.video-player").forEach((other) => {
          if (other !== video) other.pause();
        });
        video.play().catch(() => {});
        card?.classList.remove("is-taptoplay");
        scheduleViewCount(video);
      } else {
        video.pause();
        cancelViewCount(video);
      }
    });
  }

  /** Muted accounts are dropped from my feed (their posts still exist for
   *  everyone else). Blocked accounts are already filtered by the rules. */
  function visible(videos) {
    if (!mutedIds.size) return videos;
    return videos.filter((v) => !mutedIds.has(v.uid));
  }

  /**
   * Paint the feed — or hold the update back behind the "new posts" pill.
   *
   * `force` is used by the refresh button, the pill and pull-to-refresh, so
   * an explicit request always paints what Firestore just returned instead of
   * queueing it.
   */
  function renderVideos(root, videos, { force = false, append = false } = {}) {
    const feed = root.querySelector("#video-feed");
    if (!feed) return;

    const list = visible(videos);

    if (!force && !append && renderedIds.size) {
      const fresh = list.filter((v) => !renderedIds.has(v.id));
      if (fresh.length && window.scrollY > 400) {
        pending = list;
        showNewPill(root, fresh.length);
        return;
      }
    }
    pending = null;
    hideNewPill(root);

    if (!append && !list.length) {
      feed.innerHTML =
        mode === "following"
          ? emptyState("🛰️", "Your following feed is quiet", "Follow creators and their videos will appear here.", '<a class="btn btn-primary btn-sm" href="#/discover">Find creators</a>')
          : emptyState("🎬", "No videos yet", "Be the first to post a vertical video — it will show up here instantly.", '<a class="btn btn-primary btn-sm" href="#/create">Create video</a>');
      renderedIds = new Set();
      root.querySelector("#feed-foot").innerHTML = "";
      return;
    }

    // If focusVideoId, bring it to top
    let ordered = list;
    if (focusVideoId && !append) {
      const idx = list.findIndex((v) => v.id === focusVideoId);
      if (idx > 0) {
        const focused = list[idx];
        ordered = [focused, ...list.slice(0, idx), ...list.slice(idx + 1)];
      }
    }

    if (append) {
      const frag = document.createElement("div");
      frag.innerHTML = ordered.map((v) => videoCardHtml(v, { myUid: ctx.state.profile?.uid || "" })).join("");
      feed.appendChild(frag);
      ordered.forEach((v) => {
        ctx.videoCache.set(v.id, v);
        renderedIds.add(v.id);
      });
      applyPlaybackPrefs(feed);
      hydrateVideoStates(frag, ctx.state.profile?.uid);
      setupIntersection(feed);
      return;
    }

    feed.innerHTML = ordered.map((v) => videoCardHtml(v, { myUid: ctx.state.profile?.uid || "" })).join("");
    renderedIds = new Set();
    ordered.forEach((v) => {
      ctx.videoCache.set(v.id, v);
      renderedIds.add(v.id);
    });
    applyPlaybackPrefs(feed);
    hydrateVideoStates(feed, ctx.state.profile?.uid);
    setupIntersection(feed);
    paintFoot(root);
  }

  /**
   * The bottom of the feed: a sentinel for infinite scroll, plus a real
   * button so paging still works for keyboard users and anywhere
   * IntersectionObserver isn't available.
   *
   * `paintFoot` rewrites the foot, so the sentinel is a new node every time —
   * which is why observing happens here rather than once at mount.
   */
  function paintFoot(root) {
    const foot = root.querySelector("#feed-foot");
    if (!foot) return;
    foot.innerHTML = exhausted
      ? `<p class="feed-end">You're all caught up 🎉</p>`
      : `<button class="btn btn-ghost btn-block" type="button" data-act="more">Load more videos</button>
         <div class="feed-sentinel" data-feed-sentinel aria-hidden="true"></div>`;
    setupFootObserver(root);
  }

  function showNewPill(root, count) {
    const pill = root.querySelector("[data-act=\"new-posts\"]");
    if (!pill) return;
    pill.querySelector("[data-new-count]").textContent = `${count} new ${count === 1 ? "post" : "posts"}`;
    pill.hidden = false;
  }

  function hideNewPill(root) {
    const pill = root.querySelector("[data-act=\"new-posts\"]");
    if (pill) pill.hidden = true;
  }

  /** Scroll-driven paging: hitting the sentinel loads the next page. */
  function setupFootObserver(root) {
    footObserver?.disconnect();
    const sentinel = root.querySelector("[data-feed-sentinel]");
    if (!sentinel || loadingMore || !lastDocs.length) return;
    footObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore(root, false);
      },
      { rootMargin: "400px 0px" }
    );
    footObserver.observe(sentinel);
  }

  async function loadMore(root, fromButton) {
    if (loadingMore || exhausted || !lastDocs.length) return;
    const trigger = root.querySelector('[data-act="more"]');
    loadingMore = true;
    if (trigger && fromButton) {
      trigger.disabled = true;
      trigger.textContent = "Loading…";
    }
    try {
      const { items, docs } = await fetchVideoPage({
        mode,
        uid: ctx.state.profile?.uid,
        followingIds,
        afterDoc: lastDocs[lastDocs.length - 1],
      });
      const fresh = visible(items);
      if (fresh.length) renderVideos(root, fresh, { append: true, force: true });
      // A page with nothing in it is the only reliable end-of-feed signal.
      // (A page that came back *short* isn't: with mute filtering, ten posts
      // can all belong to muted authors while more pages still exist — so the
      // button stays and the reader can ask again.)
      if (!items.length) exhausted = true;
      else lastDocs = docs;
    } catch (e) {
      console.warn("[xacheus] load more", e);
      toast("Could not load more videos", "error");
    } finally {
      loadingMore = false;
      // Repaint (and therefore re-observe the sentinel) only once
      // `loadingMore` is false, or the guard would skip the observer.
      paintFoot(root);
      if (trigger && !exhausted) {
        trigger.disabled = false;
        trigger.textContent = "Load more videos";
      }
    }
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

  const homeCleanups = [];

  /** Patch one card's counters without re-rendering (keeps playback alive). */
  function applyCounts(detail) {
    const video = detail?.video;
    if (!video?.id) return;
    const card = document.querySelector(`#video-feed .video-card[data-video-id="${CSS.escape(video.id)}"]`);
    if (!card) return;
    const set = (key, value) => {
      card.querySelectorAll(`[data-count="${key}"]`).forEach((node) => (node.textContent = formatCount(value || 0)));
    };
    set("like", video.likeCount);
    set("comment", video.commentCount);
    set("repost", video.repostCount);
  }

  /** Anything that must own the audio: story viewer, media viewer, any modal. */
  function overlayOpen() {
    if (storyViewerOpen()) return true;
    return Boolean(document.querySelector(".modal-backdrop, .mv-backdrop, .story-viewer"));
  }

  function setupIntersection(feed) {
    if (observer) observer.disconnect();
    const cards = feed.querySelectorAll(".video-card[data-video-id]");
    if (!cards.length) return;

    observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const card = entry.target;
          const video = card.querySelector("video");
          if (overlayOpen()) {
            // A modal, the media viewer or the story viewer owns the sound.
            const v = entry.target.querySelector("video");
            if (v) {
              v.pause();
              cancelViewCount(v);
            }
            return;
          }
          if (entry.isIntersecting && entry.intersectionRatio >= 0.7) {
            // pause others
            feed.querySelectorAll(".video-card").forEach((other) => {
              if (other === card) return;
              const v = other.querySelector("video");
              if (v) {
                v.pause();
                cancelViewCount(v);
              }
              clearTimeout(other._viewTimer);
              other.classList.remove("is-playing");
            });
            card.classList.add("is-playing");
            if (video) {
              // Feed autoplay is a preference, not a certainty.
              if (getPlayerOptions().autoplayPreviews === false) {
                card.classList.add("is-taptoplay");
                video.pause();
              } else {
                video.play().catch(() => {});
              }
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
              // photo post: count a view on dwell too
              scheduleViewCount(card);
            }
          } else {
            if (video) {
              video.pause();
              cancelViewCount(video);
            }
            clearTimeout(card._viewTimer);
            card.classList.remove("is-playing");
          }
        });
      },
      { threshold: [0, 0.5, 0.7, 1] }
    );

    cards.forEach((card) => observer.observe(card));
  }

  /**
   * Modals are mounted outside the feed, so re-evaluate whenever the overlay
   * count changes: opening one pauses the video, closing it resumes the card
   * under the viewport (re-observing re-fires the callback for every card).
   */
  function watchOverlays(root) {
    let lastOpen = overlayOpen();
    const check = () => {
      const open = overlayOpen();
      if (open === lastOpen) return;
      lastOpen = open;
      const feed = root.querySelector("#video-feed");
      if (feed) setupIntersection(feed);
    };
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true });
    const timer = setInterval(check, 900);
    homeCleanups.push(() => {
      mo.disconnect();
      clearInterval(timer);
    });
  }

  async function start(root) {
    if (unsubscribe) unsubscribe();
    const feed = root.querySelector("#video-feed");
    feed.innerHTML = `<div class="loader-row"><span class="spinner"></span> Loading videos…</div>`;
    renderedIds = new Set();
    pending = null;
    exhausted = false;
    hideNewPill(root);

    // Mutes are read once per feed start (and refreshed by the mute event),
    // not per card — it's one small query either way.
    mutedIds = ctx.state.profile?.uid
      ? await getMutedIds(ctx.state.profile.uid).catch(() => new Set())
      : new Set();

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

  /**
   * Pull-to-refresh. Only armed at the very top of the page, only for touch,
   * and it never hijacks scrolling inside a photo carousel or a comment list.
   */
  function wirePullToRefresh(root) {
    const pull = root.querySelector("#feed-pull");
    if (!pull) return;
    let startY = null;
    let pulling = false;
    const THRESHOLD = 70;

    const reset = () => {
      pulling = false;
      startY = null;
      pull.classList.remove("is-armed", "is-ready");
      pull.style.height = "0px";
      pull.querySelector(".feed-pull-text").textContent = "Pull to refresh";
      pull.querySelector(".feed-pull-arrow").textContent = "↓";
    };

    const onStart = (event) => {
      if (window.scrollY > 0 || event.touches.length !== 1) return;
      if (overlayOpen()) return;
      startY = event.touches[0].clientY;
      pulling = true;
      pull.classList.add("is-armed");
    };

    const onMove = (event) => {
      if (!pulling || startY === null) return;
      const dy = event.touches[0].clientY - startY;
      if (dy <= 0) {
        if (pull.classList.contains("is-ready")) reset();
        return;
      }
      const distance = Math.min(110, dy * 0.5);
      pull.style.height = `${distance}px`;
      const ready = dy > THRESHOLD;
      pull.classList.toggle("is-ready", ready);
      pull.querySelector(".feed-pull-text").textContent = ready ? "Release to refresh" : "Pull to refresh";
      pull.querySelector(".feed-pull-arrow").textContent = ready ? "↑" : "↓";
    };

    const onEnd = () => {
      if (!pulling) return;
      const wasReady = pull.classList.contains("is-ready");
      reset();
      if (wasReady) start(root);
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", reset, { passive: true });
    homeCleanups.push(() => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", reset);
    });
  }

  return {
    html,
    title: mode === "following" ? "Following" : "For You",
    mount(root) {
      bindVideoActions(root, ctx);
      wireTapToPlay(root);

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

        // The "N new posts" pill: paint the posts Firestore has been holding.
        if (trigger.dataset.act === "new-posts") {
          const queued = pending;
          hideNewPill(root);
          pending = null;
          window.scrollTo({ top: 0, behavior: "smooth" });
          if (queued) renderVideos(root, queued, { force: true });
          else start(root);
          return;
        }

        if (trigger.dataset.act === "more") loadMore(root, true);
      });

      // Pull-to-refresh on touch, and the scroll-driven page loader.
      wirePullToRefresh(root);

      // Stories: the tray is real (24h media). Signed-in users see stories from
      // the people they follow (+ their own); guests see every public story.
      // renderStoryTray owns the host's visibility and hides it when empty.
      const trayHost = root.querySelector("[data-story-tray]");
      if (trayHost) {
        renderStoryTray(ctx, trayHost).then((stop) => {
          if (destroyed) {
            stop?.();
            return;
          }
          storyStop = stop;
        });
      }

      // Fresh counts from an action taken in a modal (comment, share, save).
      watchOverlays(root);
      window.addEventListener("xacheus:video-updated", onVideoUpdated);
      const onFeedRefresh = () => start(root);
      window.addEventListener("xacheus:feed-refresh", onFeedRefresh);
      // Muting someone from their profile takes effect here without a reload.
      const onMuteChanged = () => start(root);
      window.addEventListener("xacheus:mute-changed", onMuteChanged);
      // A post deleted from its own card: forget it, so the next snapshot
      // update doesn't treat the still-cached id as "already rendered".
      const onVideoDeleted = (event) => {
        const id = event.detail?.videoId;
        if (!id) return;
        renderedIds.delete(id);
        ctx.videoCache.delete(id);
      };
      window.addEventListener("xacheus:video-deleted", onVideoDeleted);
      homeCleanups.push(() => {
        window.removeEventListener("xacheus:video-updated", onVideoUpdated);
        window.removeEventListener("xacheus:feed-refresh", onFeedRefresh);
        window.removeEventListener("xacheus:mute-changed", onMuteChanged);
        window.removeEventListener("xacheus:video-deleted", onVideoDeleted);
      });

      start(root);
    },
    destroy() {
      destroyed = true;
      storyStop?.();
      storyStop = null;
      footObserver?.disconnect();
      footObserver = null;
      while (homeCleanups.length) homeCleanups.pop()?.();
      if (unsubscribe) unsubscribe();
      if (observer) observer.disconnect();
      // pause all videos and drop pending view timers
      document.querySelectorAll(".video-player").forEach((v) => {
        clearTimeout(v._viewTimer);
        v.pause();
      });
      document.querySelectorAll(".video-card[data-video-id]").forEach((c) => clearTimeout(c._viewTimer));
    },
  };
}
