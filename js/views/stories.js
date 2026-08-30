/**
 * Xacheus — Stories.
 *
 * 24-hour photo/video stories from the people you follow, with real
 * persistence: `stories/{id}` documents, per-viewer `views/{uid}` docs (so a
 * view counts once per person and the author can see who watched), reactions
 * on `stories/{id}/reactions`, and replies that arrive as a direct message
 * rather than a decorative input.
 *
 * A story expires because `expiresAt` is stored on the document and every
 * query filters on it — rules also bound it (1 minute … 30 days) so nothing
 * can be written as a "permanent story".
 */

import {
  REACTIONS,
  addStory,
  attachSeenState,
  deleteStory,
  getStoryViewers,
  listActiveStories,
  markStoryViewed,
  reactToStory,
} from "../social.js";
import { getFollowingIds, openConversation, sendDirectMessage } from "../data.js";
import { uploadStoryMedia } from "../storage.js";
import { avatar, confirmDialog, esc, formatCount, openModal, timeAgo, toast } from "../ui.js";

const PHOTO_MS = 5000;

/* ------------------------------------------------------------------ */
/* tray (mounted above the feed)                                       */
/* ------------------------------------------------------------------ */

export async function renderStoryTray(ctx, host) {
  if (!host) return () => {};
  const myUid = ctx.state.profile?.uid || "";
  let stopped = false;

  const paint = async () => {
    if (stopped || !host.isConnected) return;
    const following = myUid ? await getFollowingIds(myUid).catch(() => []) : [];
    // Guests have no follow graph, so they get every public active story.
    const raw = await listActiveStories(following, { includeUid: myUid, max: 40, everyone: !myUid });
    const stories = await attachSeenState(raw, myUid);
    const byOwner = groupByOwner(stories);
    const mine = byOwner.get(myUid) || [];

    if (!byOwner.size) {
      // Signed-in users keep the "Your story" composer bubble; guests see
      // nothing (no dead strip on the public feed).
      host.hidden = !ctx.state.profile;
      host.innerHTML = ctx.state.profile
        ? `<div class="story-strip is-empty">
             <button class="story-bubble is-mine" type="button" data-story-add>
               ${avatar(ctx.state.profile, "lg")}
               <span class="story-plus">+</span>
               <em>Your story</em>
             </button>
             <p class="story-strip-note">No active stories. Share a photo or clip — it disappears after 24 hours.</p>
           </div>`
        : `<div class="story-strip is-empty">
             <p class="story-strip-note">No active stories right now — check back soon, or <a href="#/discover">browse videos</a>.</p>
           </div>`;
      bindTray(ctx, host);
      return;
    }

    host.hidden = false;
    host.innerHTML = `
      <div class="story-strip">
        ${ctx.state.profile
          ? `<button class="story-bubble is-mine" type="button" data-story-add>
               ${avatar(ctx.state.profile, "lg")}
               <span class="story-plus">${mine.length ? "＋" : "＋"}</span>
               <em>Your story</em>
               ${mine.length ? `<span class="story-badge">${mine.length}</span>` : ""}
             </button>`
          : ""}
        ${[...byOwner.entries()]
          .filter(([uid]) => uid !== myUid)
          .map(([uid, list]) => {
            const owner = list[0];
            const unseen = list.some((s) => !s.viewedByMe);
            return `<button class="story-bubble ${unseen ? "has-unseen" : ""}" type="button" data-story-owner="${esc(uid)}">
              ${avatar({ photoURL: owner.photoURL, username: owner.username, displayName: owner.displayName }, "lg")}
              <span class="story-ring ${unseen ? "is-unseen" : ""}"></span>
              <em>@${esc(owner.username || "user")}</em>
              <span class="story-count">${list.length}</span>
            </button>`;
          })
          .join("")}
      </div>`;
    bindTray(ctx, host);
  };

  await paint();
  const timer = setInterval(paint, 60_000); // stories expire; refresh the ring state
  window.addEventListener("xacheus:story-posted", paint);
  return () => {
    stopped = true;
    clearInterval(timer);
    window.removeEventListener("xacheus:story-posted", paint);
  };
}

function bindTray(ctx, host) {
  host.querySelectorAll("[data-story-owner]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openStoryViewerForOwner(ctx, btn.dataset.storyOwner);
    });
  });
  host.querySelector("[data-story-add]")?.addEventListener("click", () => {
    if (!ctx.state.profile) return ctx.requireAuth();
    openStoryComposer(ctx, ctx.state.profile);
  });
}

async function openStoryViewerForOwner(ctx, uid) {
  const following = ctx.state.profile ? await getFollowingIds(ctx.state.profile.uid).catch(() => []) : [];
  // Guest path mirrors the tray: no follow graph, so pull every public story.
  const stories = await attachSeenState(
    await listActiveStories(following, { max: 60, everyone: !ctx.state.profile }),
    ctx.state.profile?.uid || ""
  );
  const mine = stories.filter((s) => s.uid === uid);
  if (!mine.length) {
    toast("Those stories just expired.", "info");
    return;
  }
  openStoryViewer(ctx, mine, { list: stories });
}

function groupByOwner(stories) {
  const map = new Map();
  for (const story of stories) {
    if (!map.has(story.uid)) map.set(story.uid, []);
    map.get(story.uid).push(story);
  }
  for (const list of map.values()) list.sort((a, b) => timeStamp(a.createdAt) - timeStamp(b.createdAt));
  return map;
}

function timeStamp(value) {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (value.toMillis) return value.toMillis();
  if (value.seconds) return value.seconds * 1000;
  return Date.parse(String(value)) || 0;
}

/* ------------------------------------------------------------------ */
/* viewer                                                              */
/* ------------------------------------------------------------------ */

let viewer = null;

export function openStoryViewer(ctx, stories, { list = stories } = {}) {
  closeStoryViewer();
  if (!stories.length) return;

  const root = document.createElement("div");
  root.className = "story-viewer";
  root.innerHTML = `
    <div class="sv-stages" data-sv-stage></div>
    <div class="sv-bars" data-sv-bars></div>
    <header class="sv-head">
      <span data-sv-author></span>
      <span class="sv-time" data-sv-time></span>
      <span class="sv-head-actions">
        <button class="icon-btn" type="button" data-sv="mute" title="Mute / unmute">🔊</button>
        <button class="icon-btn" type="button" data-sv="views" title="Viewers">👁</button>
        <button class="icon-btn" type="button" data-sv="delete" title="Delete story" hidden>🗑</button>
        <button class="icon-btn" type="button" data-sv="close" aria-label="Close">✕</button>
      </span>
    </header>
    <div class="sv-reactions" data-sv-reactions>
      ${REACTIONS.slice(0, 4)
        .map((r) => `<button type="button" class="sv-rx" data-sv-reaction="${r.key}" title="${esc(r.label)}">${r.emoji}</button>`)
        .join("")}
    </div>
    <form class="sv-reply" data-sv-reply>
      <input type="text" maxlength="500" placeholder="Send a message…" data-sv-input autocomplete="off" />
      <button class="btn btn-sm btn-primary" type="submit">Send</button>
    </form>
    <button class="sv-nav sv-prev" type="button" data-sv="prev" aria-label="Previous">‹</button>
    <button class="sv-nav sv-next" type="button" data-sv="next" aria-label="Next">›</button>`;
  document.body.appendChild(root);
  document.body.classList.add("no-scroll");

  viewer = { root, ctx, stories, list, index: 0, timer: null, paused: false, muted: false };
  document.addEventListener("keydown", onKey);
  wireViewer(ctx, root);
  showStory(0);
  window.dispatchEvent(new CustomEvent("xacheus:story-viewer", { detail: { open: true } }));
}

export function closeStoryViewer() {
  if (!viewer) return;
  clearTimeout(viewer.timer);
  document.removeEventListener("keydown", onKey);
  const node = viewer.root;
  viewer = null;
  document.body.classList.remove("no-scroll");
  node.remove();
  window.dispatchEvent(new CustomEvent("xacheus:story-viewer", { detail: { open: false } }));
}

function onKey(event) {
  if (!viewer) return;
  if (event.key === "Escape") closeStoryViewer();
  else if (event.key === "ArrowRight") next();
  else if (event.key === "ArrowLeft") prev();
  else if (event.key === " ") {
    event.preventDefault();
    togglePause();
  }
}

function wireViewer(ctx, root) {
  root.querySelector('[data-sv="close"]').addEventListener("click", closeStoryViewer);
  root.querySelector('[data-sv="next"]').addEventListener("click", () => {
    if (viewer.index < viewer.stories.length - 1) next();
    else advanceOwner(ctx);
  });
  root.querySelector('[data-sv="prev"]').addEventListener("click", prev);
  root.querySelector('[data-sv="mute"]').addEventListener("click", (event) => {
    viewer.muted = !viewer.muted;
    event.currentTarget.textContent = viewer.muted ? "🔇" : "🔊";
    const video = root.querySelector("video");
    if (video) video.muted = viewer.muted;
  });
  root.querySelector('[data-sv="views"]').addEventListener("click", async () => {
    const story = current();
    const rows = await getStoryViewers(story.id, 50).catch(() => []);
    const { getProfile } = await import("../data.js");
    const people = (await Promise.all(rows.map((r) => getProfile(r.uid).catch(() => null)))).filter(Boolean);
    openModal({
      title: `Seen by ${rows.length}`,
      size: "sm",
      body: people.length
        ? `<div class="user-list">${people
            .map((p) => `<div class="user-row"><div class="user-row-main">${avatar(p, "sm")}<span class="user-row-text"><strong>${esc(p.displayName || p.username)}</strong><em>@${esc(p.username)}</em></span></div></div>`)
            .join("")}</div>`
        : `<p class="panel-empty">${story.uid === ctx.state.profile?.uid ? "Nobody has opened this story yet." : "Viewer lists are only visible to the story author."}</p>`,
    });
  });
  root.querySelector('[data-sv="delete"]').addEventListener("click", async () => {
    const story = current();
    const ok = await confirmDialog({ title: "Delete this story?", body: "It disappears for everyone immediately.", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    try {
      await deleteStory(ctx.state.profile.uid, story.id);
      toast("Story deleted", "success");
      viewer.stories = viewer.stories.filter((s) => s.id !== story.id);
      if (!viewer.stories.length) closeStoryViewer();
      else showStory(Math.min(viewer.index, viewer.stories.length - 1));
    } catch (err) {
      toast(err?.message || "Could not delete that story", "error");
    }
  });

  root.querySelector("[data-sv-reactions]").addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-sv-reaction]");
    if (!btn) return;
    if (!ctx.state.profile) return ctx.requireAuth();
    try {
      await reactToStory(ctx.state.profile.uid, ctx.state.profile, current(), btn.dataset.svReaction);
      btn.classList.add("is-fired");
      setTimeout(() => btn.classList.remove("is-fired"), 700);
      await refreshStoryCounts();
    } catch (err) {
      toast(err?.message || "Could not send that reaction", "error");
    }
  });

  root.querySelector("[data-sv-reply]").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!ctx.state.profile) return ctx.requireAuth();
    const input = root.querySelector("[data-sv-input]");
    const text = input.value.trim();
    const story = current();
    if (!text) return;
    if (story.uid === ctx.state.profile.uid) {
      toast("You can't reply to your own story.", "info");
      return;
    }
    input.disabled = true;
    try {
      const cid = await openConversation(ctx.state.profile, { uid: story.uid, username: story.username });
      await sendDirectMessage(cid, ctx.state.profile, story.uid, text);
      input.value = "";
      toast(`Sent to @${story.username}`, "success", 2000);
      pause(false);
    } catch (err) {
      toast(err?.message || "Couldn't send that reply", "error");
    } finally {
      input.disabled = false;
    }
  });

  // tap halves + press-and-hold to pause
  const stage = root.querySelector("[data-sv-stage]");
  let holdTimer = null;
  stage.addEventListener("pointerdown", (event) => {
    if (event.target.closest("button, input, a, form")) return;
    holdTimer = setTimeout(() => pause(true), 320);
  });
  const release = (event) => {
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
      if (viewer?.paused) pause(false);
      return;
    }
    if (event.target.closest("button, input, a, form")) return;
    const rect = stage.getBoundingClientRect();
    if (event.clientX - rect.left < rect.width / 3) prev();
    else next();
  };
  stage.addEventListener("pointerup", release);
  stage.addEventListener("pointercancel", () => {
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
    pause(false);
  });
}

function togglePause() {
  pause(!viewer.paused);
}

function pause(on) {
  if (!viewer) return;
  viewer.paused = on;
  clearTimeout(viewer.timer);
  const video = viewer.root.querySelector("video");
  if (video) {
    if (on) video.pause();
    else video.play().catch(() => {});
  }
  if (!on) runTimer();
  viewer.root.querySelector(".sv-stages").classList.toggle("is-paused", on);
}

function advanceOwner(ctx) {
  // Move on to the next person's story set when this one is finished.
  const byOwner = groupByOwner(viewer.list.filter((s) => s.uid !== current()?.uid && !s.viewedByMe));
  const nextOwner = [...byOwner.entries()][0];
  if (!nextOwner) {
    closeStoryViewer();
    return;
  }
  viewer.stories = nextOwner[1];
  viewer.index = 0;
  showStory(0);
  void ctx;
}

function next() {
  if (!viewer) return;
  if (viewer.index < viewer.stories.length - 1) showStory(viewer.index + 1);
  else closeStoryViewer();
}

function prev() {
  if (!viewer) return;
  if (viewer.index > 0) showStory(viewer.index - 1);
}

function current() {
  return viewer?.stories[viewer.index] || null;
}

async function showStory(i) {
  if (!viewer) return;
  viewer.index = Math.max(0, Math.min(i, viewer.stories.length - 1));
  const story = current();
  if (!story) return closeStoryViewer();

  const root = viewer.root;
  const stage = root.querySelector("[data-sv-stage]");
  stage.innerHTML =
    story.kind === "video"
      ? `<video src="${esc(story.url)}" autoplay playsinline ${viewer.muted ? "muted" : ""} class="sv-media"></video>${story.text ? `<p class="sv-text">${esc(story.text)}</p>` : ""}`
      : `<img src="${esc(story.url)}" alt="" class="sv-media" />${story.text ? `<p class="sv-text">${esc(story.text)}</p>` : ""}`;

  const video = stage.querySelector("video");
  if (video) {
    video.muted = viewer.muted;
    video.addEventListener("ended", () => next());
    video.addEventListener("loadedmetadata", () => {
      runTimer(video.duration * 1000 || PHOTO_MS);
    });
    video.play().catch(() => {
      /* autoplay blocked — the timer still advances */
    });
  }

  const author = { photoURL: story.photoURL, username: story.username, displayName: story.displayName };
  root.querySelector("[data-sv-author]").innerHTML = `<a class="sv-author" href="#/u/${esc(story.username)}">${avatar(author, "sm")}<span><strong>${esc(story.displayName || story.username)}</strong><em>@${esc(story.username)}</em></span></a>`;
  root.querySelector('[data-sv-author] a').addEventListener("click", () => closeStoryViewer());
  root.querySelector("[data-sv-time]").textContent = timeAgo(story.createdAt);
  root.querySelector('[data-sv="delete"]').hidden = story.uid !== (viewer.ctx?.state?.profile?.uid || "");
  root.querySelector("[data-sv-reply]").hidden = story.uid === (viewer.ctx?.state?.profile?.uid || "");

  renderBars();
  if (!video) runTimer(PHOTO_MS);

  // Mark the view once per person (rules: one doc per viewer per story).
  const myUid = viewer.ctx?.state?.profile?.uid || "";
  if (myUid && myUid !== story.uid) {
    markStoryViewed(story.id, myUid).then((isNew) => {
      if (isNew) {
        story.viewedByMe = true;
        const at = viewer.list.findIndex((s) => s.id === story.id);
        if (at >= 0) viewer.list[at].viewedByMe = true;
        refreshStoryCounts();
      }
    });
  }
}

function renderBars() {
  const root = viewer?.root;
  if (!root) return;
  const bars = root.querySelector("[data-sv-bars]");
  bars.innerHTML = viewer.stories
    .map((s, i) => `<span class="sv-bar ${i < viewer.index ? "is-done" : ""}"><i style="width:${i < viewer.index ? 100 : 0}%"></i></span>`)
    .join("");
}

function runTimer(ms = PHOTO_MS) {
  if (!viewer) return;
  clearTimeout(viewer.timer);
  const bar = viewer.root.querySelectorAll(".sv-bar i")[viewer.index];
  const started = Date.now();
  const tick = () => {
    if (!viewer || viewer.paused) return;
    const ratio = Math.min(1, (Date.now() - started) / ms);
    if (bar) bar.style.width = `${ratio * 100}%`;
    if (ratio >= 1) {
      next();
      return;
    }
    viewer.timer = requestAnimationFrame(tick);
  };
  viewer.timer = requestAnimationFrame(tick);
}

async function refreshStoryCounts() {
  const story = current();
  if (!story || !viewer) return;
  const node = viewer.root.querySelector("[data-sv-time]");
  const rows = story.uid === (viewer.ctx?.state?.profile?.uid || "") ? await getStoryViewers(story.id, 1).catch(() => []) : [];
  const reactions = Object.values(story.reactions || {}).reduce((a, b) => a + (Number(b) || 0), 0);
  node.textContent = `${timeAgo(story.createdAt)}${reactions ? ` · ${formatCount(reactions)}` : ""}${rows.length ? ` · ${formatCount(story.viewCount || 0)} views` : ""}`;
}

/* ------------------------------------------------------------------ */
/* composer                                                            */
/* ------------------------------------------------------------------ */

export function openStoryComposer(ctx) {
  if (!ctx.state.profile) return ctx.requireAuth();
  openModal({
    title: "Add to your story",
    size: "sm",
    body: `
      <form class="form-grid" data-story-form>
        <label class="create-drop" data-story-drop>
          <input type="file" accept="image/*,video/*" data-story-file hidden />
          <span class="upload-drop-inner">
            <strong>Choose a photo or video</strong>
            <em>Up to 40 MB · video up to 60 seconds plays best</em>
          </span>
        </label>
        <div class="story-preview" data-story-preview hidden></div>
        <div class="upload-progress" data-story-progress hidden><div class="upload-progress-bar" data-story-bar></div></div>
        <label class="field"><span>Text on story (optional)</span>
          <input type="text" maxlength="280" data-story-text placeholder="Say something…" /></label>
        <button class="btn btn-primary btn-block" type="submit" disabled data-story-submit>Add to story</button>
        <p class="field-hint">Stories disappear 24 hours after you post them and are only shown to people who can see your profile.</p>
      </form>`,
    onMount(modal, close) {
      const input = modal.querySelector("[data-story-file]");
      const preview = modal.querySelector("[data-story-preview]");
      const submit = modal.querySelector("[data-story-submit]");
      const bar = modal.querySelector("[data-story-bar]");
      const progress = modal.querySelector("[data-story-progress]");
      let file = null;

      modal.querySelector("[data-story-drop]").addEventListener("click", () => input.click());
      input.addEventListener("change", () => {
        const picked = input.files?.[0];
        if (!picked) return;
        if (!/^(image|video)\//.test(picked.type)) return toast("Pick a photo or video file.", "error");
        if (picked.size > 40 * 1024 * 1024) return toast("Stories must be under 40 MB.", "error");
        file = picked;
        const url = URL.createObjectURL(picked);
        preview.hidden = false;
        preview.innerHTML = picked.type.startsWith("video/")
          ? `<video src="${url}" controls playsinline muted></video>`
          : `<img src="${url}" alt="Story preview" />`;
        submit.disabled = false;
      });

      modal.querySelector("[data-story-form]").addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!file) return;
        submit.disabled = true;
        submit.textContent = "Uploading…";
        progress.hidden = false;
        try {
          const uploaded = await uploadStoryMedia(file, { onProgress: (pct) => (bar.style.width = `${pct}%`) });
          const id = await addStory(ctx.state.profile, {
            kind: uploaded.kind,
            url: uploaded.url,
            storagePath: uploaded.path,
            text: modal.querySelector("[data-story-text]").value.trim(),
          });
          toast("Story posted", "success");
          close();
          window.dispatchEvent(new CustomEvent("xacheus:story-posted", { detail: { id } }));
        } catch (err) {
          toast(err?.message || "Couldn't post that story", "error");
          submit.disabled = false;
          submit.textContent = "Add to story";
        }
      });
    },
  });
}

/** The feed asks this before autoplaying a video behind the viewer. */
export function storyViewerOpen() {
  return Boolean(viewer);
}
