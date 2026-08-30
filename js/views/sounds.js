/** Xacheus — Sounds & songs library (real APIs, free catalogue + originals). */

import {
  CURATED_FREE_SOUNDS,
  bumpSoundUse,
  createSound,
  deleteSound,
  formatSoundDuration,
  getFavoriteSoundIds,
  getSound,
  getSoundGenres,
  getSounds,
  getSoundsByGenre,
  getUserSounds,
  getVideosBySound,
  searchSounds,
  toggleSoundFavorite,
  watchFavoriteSounds,
  watchSounds,
  watchTrendingSounds,
} from "../data.js";
import { uploadAudio, uploadImage } from "../storage.js";
import { avatar, clear, emptyState, esc, formatCount, toast } from "../ui.js";
import { postThumb, openReportModal } from "./components.js";

/* ------------------------------------------------------------------ */
/* shared row markup                                                   */
/* ------------------------------------------------------------------ */

function soundCover(sound) {
  if (sound.coverUrl) {
    return `<img class="sound-cover-img" src="${esc(sound.coverUrl)}" alt="" loading="lazy" />`;
  }
  const emoji =
    sound.genre === "gospel"
      ? "🙏"
      : sound.genre === "afrobeat" || sound.genre === "afro"
        ? "🥁"
        : sound.genre === "lofi"
          ? "🎧"
          : sound.genre === "dance" || sound.genre === "electronic"
            ? "⚡"
            : sound.isOriginal
              ? "🎤"
              : "🎵";
  return `<span class="sound-cover-emoji">${emoji}</span>`;
}

function soundRowHtml(sound, { favorited = false, showUse = true, canDelete = false } = {}) {
  const duration = sound.duration ? formatSoundDuration(sound.duration) : "";
  return `
    <article class="sound-row" data-sound-id="${esc(sound.id)}">
      <a class="sound-row-main" href="#/sound/${esc(sound.id)}">
        <span class="sound-cover">${soundCover(sound)}</span>
        <span class="sound-meta">
          <strong>${esc(sound.title)}</strong>
          <em>
            ${esc(sound.artist || "Unknown")}
            ${sound.genre ? ` · ${esc(sound.genre)}` : ""}
            ${duration ? ` · ${duration}` : ""}
            ${sound.bpm ? ` · ${sound.bpm} BPM` : ""}
            · used ${formatCount(sound.useCount || 0)}
            ${sound.isFree ? " · free" : ""}
            ${sound.isOriginal ? " · original" : ""}
          </em>
        </span>
      </a>
      <audio class="sound-audio" src="${esc(sound.audioUrl)}" controls preload="none" controlsList="nodownload"></audio>
      <div class="sound-actions">
        <button class="icon-btn sound-fav ${favorited ? "is-on" : ""}" type="button" data-act="fav" data-sound-id="${esc(sound.id)}" aria-label="Favorite" title="Save">
          ${favorited ? "★" : "☆"}
        </button>
        ${showUse ? `<a class="btn btn-primary btn-sm" href="#/create?sound=${esc(sound.id)}">Use</a>` : ""}
        <a class="btn btn-outline btn-sm" href="#/sound/${esc(sound.id)}">Open</a>
        ${canDelete ? `<button class="btn btn-ghost btn-sm" type="button" data-act="delete-sound" data-sound-id="${esc(sound.id)}">Delete</button>` : ""}
      </div>
    </article>`;
}

function genreChipsHtml(active = "all") {
  const genres = getSoundGenres();
  return `
    <div class="genre-chips" role="list">
      ${genres
        .map(
          (g) => `
        <button class="genre-chip ${g === active ? "is-active" : ""}" type="button" data-genre="${esc(g)}" role="listitem">
          ${g === "all" ? "All" : esc(g)}
        </button>`
        )
        .join("")}
    </div>`;
}

/* ------------------------------------------------------------------ */
/* library view                                                        */
/* ------------------------------------------------------------------ */

export function soundsView(ctx, { q = "", tab = "free" } = {}) {
  let currentTab = tab || "free";
  let currentGenre = "all";
  let unsub = null;
  let destroyed = false;
  let catalog = [];
  let favoriteIds = new Set();

  const html = `
    <div class="view-head">
      <div>
        <h1>Sounds & songs</h1>
        <p class="view-sub">Royalty-free catalogue + original uploads. No copyrighted YouTube tracks.</p>
      </div>
      <button class="btn btn-primary btn-sm" type="button" data-act="upload-sound">↑ Upload sound</button>
    </div>

    <form class="discover-search" id="sounds-search">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
      <input type="search" name="q" placeholder="Search songs, artists, genres…" value="${esc(q)}" autocomplete="off" />
      <button class="btn btn-primary btn-sm" type="submit">Search</button>
    </form>

    ${genreChipsHtml("all")}

    <div class="tabs" role="tablist">
      <button class="tab ${currentTab === "free" ? "is-active" : ""}" data-tab="free">Free music</button>
      <button class="tab ${currentTab === "trending" ? "is-active" : ""}" data-tab="trending">Trending</button>
      <button class="tab ${currentTab === "original" ? "is-active" : ""}" data-tab="original">Originals</button>
      <button class="tab ${currentTab === "saved" ? "is-active" : ""}" data-tab="saved">Saved</button>
      <button class="tab ${currentTab === "mine" ? "is-active" : ""}" data-tab="mine">My sounds</button>
      <button class="tab ${currentTab === "all" ? "is-active" : ""}" data-tab="all">All</button>
    </div>

    <div class="sounds-content" id="sounds-content">
      <div class="loader-row"><span class="spinner"></span> Loading sounds…</div>
    </div>
  `;

  function paint(list, { emptyTitle, emptyBody } = {}) {
    const content = document.querySelector("#sounds-content");
    if (!content || destroyed) return;
    if (!list.length) {
      content.innerHTML = emptyState("🎵", emptyTitle || "No sounds found", emptyBody || "Try another search or genre.", "");
      return;
    }
    content.innerHTML = list
      .map((s) =>
        soundRowHtml(s, {
          favorited: favoriteIds.has(s.id),
          canDelete: Boolean(ctx.state.profile && s.artistUid === ctx.state.profile.uid && s.isOriginal),
        })
      )
      .join("");
  }

  function applyLocalFilter(list, query) {
    let out = list;
    if (currentGenre && currentGenre !== "all") {
      if (currentGenre === "original") out = out.filter((s) => s.isOriginal);
      else out = out.filter((s) => String(s.genre || "").toLowerCase() === currentGenre);
    }
    if (query) {
      const qLower = query.toLowerCase();
      out = out.filter((s) => {
        const hay = `${s.title} ${s.artist || ""} ${s.genre || ""} ${s.id}`.toLowerCase();
        return hay.includes(qLower);
      });
    }
    return out;
  }

  async function refreshFavorites() {
    if (!ctx.state.profile) {
      favoriteIds = new Set();
      return;
    }
    favoriteIds = await getFavoriteSoundIds(ctx.state.profile.uid).catch(() => new Set());
  }

  async function loadTab(tab, filter = "") {
    currentTab = tab;
    document.querySelectorAll(".tabs .tab").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === tab));
    const content = document.querySelector("#sounds-content");
    if (content) content.innerHTML = `<div class="loader-row"><span class="spinner"></span> Loading…</div>`;

    if (unsub) {
      unsub();
      unsub = null;
    }

    await refreshFavorites();

    if (tab === "free") {
      catalog = await getSounds({ onlyFree: true, limitCount: 80, includeCurated: true });
      paint(applyLocalFilter(catalog, filter));
    } else if (tab === "trending") {
      unsub = watchTrendingSounds((sounds) => {
        catalog = sounds;
        paint(applyLocalFilter(catalog, filter));
      }, 50);
    } else if (tab === "original") {
      unsub = watchSounds((sounds) => {
        catalog = sounds.filter((s) => s.isOriginal);
        paint(applyLocalFilter(catalog, filter), {
          emptyTitle: "No original sounds yet",
          emptyBody: "Upload your beat or song — it shows up here for everyone to use.",
        });
      }, 60);
    } else if (tab === "saved") {
      if (!ctx.state.profile) {
        paint([], { emptyTitle: "Log in to save sounds", emptyBody: "Star a track to keep it here." });
        return;
      }
      unsub = watchFavoriteSounds(ctx.state.profile.uid, (sounds) => {
        catalog = sounds;
        paint(applyLocalFilter(catalog, filter), {
          emptyTitle: "No saved sounds",
          emptyBody: "Tap ☆ on any track to save it.",
        });
      });
    } else if (tab === "mine") {
      if (!ctx.state.profile) {
        paint([], { emptyTitle: "Log in to see your sounds", emptyBody: "Upload originals to manage them here." });
        return;
      }
      catalog = await getUserSounds(ctx.state.profile.uid, 80);
      paint(applyLocalFilter(catalog, filter), {
        emptyTitle: "You haven't uploaded sounds yet",
        emptyBody: "Tap Upload sound to add a beat or song.",
      });
    } else {
      unsub = watchSounds((sounds) => {
        catalog = sounds.length ? sounds : CURATED_FREE_SOUNDS;
        paint(applyLocalFilter(catalog, filter));
      }, 80);
    }
  }

  function openUploadModal() {
    if (!ctx.state.profile) return ctx.requireAuth();

    const host = document.createElement("div");
    host.className = "modal-backdrop is-in";
    host.innerHTML = `
      <div class="modal modal-sm" role="dialog" aria-modal="true" aria-label="Upload sound">
        <header class="modal-head">
          <h2>Upload a sound</h2>
          <button class="icon-btn" type="button" data-close aria-label="Close">✕</button>
        </header>
        <div class="modal-body">
          <form class="form-grid" id="upload-sound-form">
            <label class="field">
              <span>Title</span>
              <input type="text" id="us-title" maxlength="80" required placeholder="e.g. Lusaka Groove" />
            </label>
            <label class="field">
              <span>Genre</span>
              <select id="us-genre">
                ${getSoundGenres()
                  .filter((g) => g !== "all")
                  .map((g) => `<option value="${esc(g)}" ${g === "original" ? "selected" : ""}>${esc(g)}</option>`)
                  .join("")}
              </select>
            </label>
            <label class="field">
              <span>Audio file <em>(MP3, WAV, M4A · max 20MB)</em></span>
              <input type="file" id="us-audio" accept="audio/*" required />
            </label>
            <label class="field">
              <span>Cover image <em>(optional)</em></span>
              <input type="file" id="us-cover" accept="image/*" />
            </label>
            <label class="field field-check">
              <input type="checkbox" id="us-free" />
              <span>Mark as free for everyone to use</span>
            </label>
            <div class="upload-progress-bar" id="us-progress" hidden>
              <span id="us-progress-fill" style="width:0%"></span>
              <em id="us-progress-text">0%</em>
            </div>
            <button class="btn btn-primary btn-block" type="submit" id="us-submit">Upload & publish</button>
            <p class="fine-print">Only upload audio you own or have rights to. No copyrighted tracks.</p>
          </form>
        </div>
      </div>`;
    document.body.appendChild(host);
    document.body.classList.add("no-scroll");

    const close = () => {
      host.remove();
      document.body.classList.remove("no-scroll");
    };
    host.addEventListener("click", (e) => {
      if (e.target === host || e.target.closest("[data-close]")) close();
    });

    host.querySelector("#upload-sound-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const title = host.querySelector("#us-title").value.trim();
      const genre = host.querySelector("#us-genre").value;
      const audioFile = host.querySelector("#us-audio").files?.[0];
      const coverFile = host.querySelector("#us-cover").files?.[0];
      const isFree = host.querySelector("#us-free").checked;
      if (!audioFile) return toast("Choose an audio file", "error");
      if (audioFile.size > 20 * 1024 * 1024) return toast("Audio must be under 20MB", "error");

      const btn = host.querySelector("#us-submit");
      const bar = host.querySelector("#us-progress");
      const fill = host.querySelector("#us-progress-fill");
      const text = host.querySelector("#us-progress-text");
      btn.disabled = true;
      bar.hidden = false;

      try {
        const audioRes = await uploadAudio(audioFile, {
          onProgress: (p) => {
            fill.style.width = `${p}%`;
            text.textContent = `${p}%`;
          },
        });
        let coverUrl = "";
        if (coverFile) {
          coverUrl = (await uploadImage(coverFile, { strict: true }).catch(() => "")) || "";
        }
        const created = await createSound(ctx.state.profile, {
          title,
          audioUrl: audioRes.url,
          storagePath: audioRes.path || "",
          coverUrl,
          duration: audioRes.duration || 0,
          genre,
          isFree,
        });
        toast(`Published “${created.title}”`, "success");
        close();
        loadTab("mine", "");
      } catch (error) {
        console.warn("[xacheus] sound upload", error);
        toast(error?.message || "Couldn't upload that sound.", "error", 6000);
        btn.disabled = false;
        bar.hidden = true;
      }
    });
  }

  return {
    html,
    title: "Sounds",
    mount(root) {
      const searchForm = root.querySelector("#sounds-search");
      const input = searchForm.querySelector("input");

      loadTab(currentTab, q);

      searchForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const query = input.value.trim();
        if (!query) {
          loadTab(currentTab, "");
          return;
        }
        const content = root.querySelector("#sounds-content");
        content.innerHTML = `<div class="loader-row"><span class="spinner"></span> Searching…</div>`;
        const results = await searchSounds(query, {
          limitCount: 60,
          genre: currentGenre === "all" || currentGenre === "original" ? "" : currentGenre,
        });
        catalog = results;
        await refreshFavorites();
        paint(applyLocalFilter(catalog, ""), {
          emptyTitle: "No matches",
          emptyBody: `Nothing found for “${query}”.`,
        });
        history.replaceState(null, "", `#/sounds?q=${encodeURIComponent(query)}&tab=${currentTab}`);
      });

      root.querySelectorAll(".tabs .tab").forEach((btn) => {
        btn.addEventListener("click", () => {
          loadTab(btn.dataset.tab, input.value.trim());
          history.replaceState(
            null,
            "",
            `#/sounds?q=${encodeURIComponent(input.value.trim())}&tab=${btn.dataset.tab}`
          );
        });
      });

      root.querySelectorAll("[data-genre]").forEach((chip) => {
        chip.addEventListener("click", async () => {
          currentGenre = chip.dataset.genre;
          root.querySelectorAll("[data-genre]").forEach((c) => c.classList.toggle("is-active", c === chip));
          if (input.value.trim()) {
            searchForm.requestSubmit();
            return;
          }
          if (currentGenre !== "all" && currentGenre !== "original") {
            const content = root.querySelector("#sounds-content");
            content.innerHTML = `<div class="loader-row"><span class="spinner"></span> Loading ${esc(currentGenre)}…</div>`;
            catalog = await getSoundsByGenre(currentGenre, 80);
            await refreshFavorites();
            paint(catalog);
          } else {
            loadTab(currentTab, "");
          }
        });
      });

      root.addEventListener("click", async (event) => {
        const act = event.target.closest("[data-act]")?.dataset.act;
        if (act === "upload-sound") return openUploadModal();

        if (act === "fav") {
          if (!ctx.state.profile) return ctx.requireAuth();
          const id = event.target.closest("[data-sound-id]")?.dataset.soundId;
          const sound = catalog.find((s) => s.id === id) || (await getSound(id));
          if (!sound) return;
          const btn = event.target.closest("[data-act='fav']");
          try {
            const on = await toggleSoundFavorite(ctx.state.profile.uid, sound);
            if (on) favoriteIds.add(id);
            else favoriteIds.delete(id);
            btn.classList.toggle("is-on", on);
            btn.textContent = on ? "★" : "☆";
            toast(on ? "Saved to your sounds" : "Removed from saved", "success", 1800);
            if (currentTab === "saved" && !on) loadTab("saved", input.value.trim());
          } catch (error) {
            toast(error?.message || "Couldn't save that.", "error");
          }
          return;
        }

        if (act === "delete-sound") {
          if (!ctx.state.profile) return ctx.requireAuth();
          const id = event.target.closest("[data-sound-id]")?.dataset.soundId;
          if (!id || !confirm("Delete this sound permanently?")) return;
          try {
            await deleteSound(id, ctx.state.profile.uid);
            toast("Sound deleted", "success");
            loadTab(currentTab, input.value.trim());
          } catch (error) {
            toast(error?.message || "Couldn't delete.", "error");
          }
        }
      });

      // Pause other audio when one plays
      root.addEventListener(
        "play",
        (event) => {
          if (event.target.tagName !== "AUDIO") return;
          root.querySelectorAll("audio").forEach((a) => {
            if (a !== event.target) a.pause();
          });
        },
        true
      );
    },
    destroy() {
      destroyed = true;
      if (unsub) unsub();
    },
  };
}

/* ------------------------------------------------------------------ */
/* single sound detail                                                 */
/* ------------------------------------------------------------------ */

export function soundDetailView(ctx, { soundId }) {
  let destroyed = false;

  const html = `
    <div class="view-head">
      <a class="link-btn" href="#/sounds">← Sounds</a>
    </div>
    <div id="sound-detail">
      <div class="loader-row"><span class="spinner"></span> Loading sound…</div>
    </div>`;

  return {
    html,
    title: "Sound",
    async mount(root) {
      const host = root.querySelector("#sound-detail");
      const sound = await getSound(soundId);
      if (destroyed) return;
      if (!sound) {
        host.innerHTML = emptyState("🎵", "Sound not found", "It may have been removed.", '<a class="btn btn-primary btn-sm" href="#/sounds">Browse sounds</a>');
        return;
      }

      document.title = `${sound.title} · Xacheus`;
      let favorited = false;
      if (ctx.state.profile) {
        favorited = (await getFavoriteSoundIds(ctx.state.profile.uid).catch(() => new Set())).has(sound.id);
      }

      const videos = await getVideosBySound(sound.id, 24).catch(() => []);

      host.innerHTML = `
        <div class="sound-detail-card">
          <div class="sound-detail-cover">${soundCover(sound)}</div>
          <div class="sound-detail-meta">
            <h1>${esc(sound.title)}</h1>
            <p class="sound-detail-artist">
              ${sound.artistUsername ? `<a class="link" href="#/u/${esc(sound.artistUsername)}">` : ""}
              ${esc(sound.artist || "Unknown artist")}
              ${sound.artistUsername ? "</a>" : ""}
              ${sound.isFree ? '<span class="badge">Free</span>' : ""}
              ${sound.isOriginal ? '<span class="badge">Original</span>' : ""}
            </p>
            <p class="sound-detail-stats">
              ${sound.genre ? `<span>${esc(sound.genre)}</span>` : ""}
              ${sound.duration ? `<span>${formatSoundDuration(sound.duration)}</span>` : ""}
              ${sound.bpm ? `<span>${sound.bpm} BPM</span>` : ""}
              <span>${formatCount(sound.useCount || 0)} uses</span>
              ${sound.favoriteCount ? `<span>${formatCount(sound.favoriteCount)} saves</span>` : ""}
            </p>
            <audio class="sound-detail-audio" src="${esc(sound.audioUrl)}" controls preload="metadata" controlsList="nodownload"></audio>
            <div class="sound-detail-actions">
              <a class="btn btn-primary" href="#/create?sound=${esc(sound.id)}">Use this sound</a>
              <button class="btn btn-outline" type="button" data-act="fav-detail">${favorited ? "★ Saved" : "☆ Save"}</button>
              <button class="btn btn-ghost" type="button" data-act="share-sound">Share</button>
              <button class="btn btn-ghost" type="button" data-act="report-sound">Report</button>
            </div>
          </div>
        </div>

        <h2 class="section-title">Videos using this sound</h2>
        <div class="video-grid" id="sound-videos">
          ${
            videos.length
              ? videos
                  .map((v) => {
                    const thumb = postThumb(v);
                    return `
                <a class="video-grid-card" href="#/video/${esc(v.id)}">
                  <div class="grid-thumb">
                    ${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy" />` : v.videoUrl ? `<video src="${esc(v.videoUrl)}" muted preload="metadata"></video>` : `<span class="grid-fallback"></span>`}
                    ${v.mediaType === "photo" ? `<span class="grid-type-badge">🖼️</span>` : ""}
                    <span class="grid-views">❤️ ${formatCount(v.likeCount || 0)}</span>
                  </div>
                  <div class="grid-meta">
                    <strong>@${esc(v.username)}</strong>
                    <em>${esc((v.caption || "").slice(0, 60))}</em>
                  </div>
                </a>`;
                  })
                  .join("")
              : emptyState("🎬", "No videos yet", "Be the first to post with this sound.", `<a class="btn btn-primary btn-sm" href="#/create?sound=${esc(sound.id)}">Create</a>`)
          }
        </div>`;

      root.addEventListener("click", async (event) => {
        const act = event.target.closest("[data-act]")?.dataset.act;
        if (act === "fav-detail") {
          if (!ctx.state.profile) return ctx.requireAuth();
          try {
            const on = await toggleSoundFavorite(ctx.state.profile.uid, sound);
            event.target.closest("[data-act]").textContent = on ? "★ Saved" : "☆ Save";
            toast(on ? "Saved" : "Removed", "success", 1600);
          } catch (error) {
            toast(error?.message || "Couldn't save.", "error");
          }
        }
        if (act === "share-sound") {
          const url = `${location.origin}${location.pathname}#/sound/${sound.id}`;
          if (navigator.share) {
            navigator.share({ title: sound.title, text: `${sound.title} on Xacheus`, url }).catch(() => {});
          } else if (navigator.clipboard) {
            navigator.clipboard.writeText(url).then(() => toast("Link copied", "success"));
          }
        }
        if (act === "report-sound") {
          if (!ctx.state.profile) return ctx.requireAuth();
          openReportModal(ctx, {
            targetType: "sound",
            targetId: sound.id,
            targetOwnerUid: sound.artistUid || "",
            targetLabel: `${sound.title} by ${sound.artist || "Unknown"}`,
          });
        }
      });
    },
    destroy() {
      destroyed = true;
    },
  };
}
