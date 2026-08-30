/**
 * Xacheus — Music.
 *
 * Two halves, one page:
 *   1. The **library**: `sounds` documents in Firestore — members' uploads and
 *      catalogue tracks that were imported. Every number on a row (uses,
 *      plays, favourites) is read from the database.
 *   2. The **catalogue**: live search of the Internet Archive's open-licence
 *      music (js/music.js). Tracks play from archive.org, show their real
 *      artist/title/licence, and can be attached to a post or added to the
 *      library. Only licences that allow reuse (CC0 / PDM / CC BY / CC BY-SA)
 *      can be attached — non-commercial and no-derivatives items are
 *      listen-and-credit only, and the UI says so.
 *
 * Playback always goes through the global player (js/player.js), so a track
 * keeps playing while you navigate, and the queue/volume/seek are real.
 */

import {
  attachCatalogueSound,
  bumpSoundUse,
  createSound,
  deleteSound,
  getFavoriteSoundIds,
  getMyPlayHistory,
  getSound,
  getSoundGenres,
  getVideosBySound,
  getUserSounds,
  toggleSoundFavorite,
  watchFavoriteSounds,
  watchTrendingSounds,
} from "../data.js";
import {
  CATALOGUE_MOODS,
  CATALOGUE_PROVIDER,
  attributionLine,
  describeLicence,
  loadItemTracks,
  searchCatalogue,
} from "../music.js";
import { uploadAudio } from "../storage.js";
import { SOUND_GENRES } from "../data.js";
import { esc, emptyState, formatCount, openModal, timeAgo, toast } from "../ui.js";
import { isCurrentTrack, playQueue, toggleTrack } from "../player.js";
import { openReportModal } from "./components.js";

const TABS = [
  { id: "library", label: "Library" },
  { id: "discover", label: "Discover" },
  { id: "uploads", label: "Your uploads" },
  { id: "favourites", label: "Favourites" },
  { id: "history", label: "Recently played", own: true },
];

/** One row in a sound list. `data-act` is handled by the hosting view. */
export function soundRowHtml(sound, { isMine = false, favourite = false, contextIndex = -1 } = {}) {
  const duration = sound.duration ? formatClock(sound.duration) : "";
  const licence = sound.licenceUrl ? describeLicence(sound.licenceUrl) : null;
  const external = Boolean(sound.external);
  const title = sound.title || "Untitled";
  return `
  <div class="sound-row ${isCurrentTrack(sound.id) ? "is-playing" : ""}" data-sound-row="${esc(sound.id)}" data-index="${contextIndex}">
    <button class="sound-play" type="button" data-act="play" data-play-track="${esc(sound.id)}" data-title="${esc(title)}" aria-label="Play ${esc(title)}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
    </button>
    <span class="sound-art">${sound.coverUrl ? `<img src="${esc(sound.coverUrl)}" alt="" loading="lazy" />` : `<span class="sound-art-fallback">${esc((title || "S").slice(0, 1).toUpperCase())}</span>`}</span>
    <a class="sound-main" href="#/sound/${esc(sound.id)}">
      <strong>${esc(title)}</strong>
      <em>${esc(sound.artist || "Unknown artist")}${sound.album && sound.album !== title ? ` · ${esc(sound.album)}` : ""}${sound.genre ? ` · ${esc(sound.genre)}` : ""}</em>
      <span class="sound-sub">
        ${duration ? `<span>${duration}</span>` : ""}
        <span>${formatCount(sound.useCount || 0)} use${Number(sound.useCount) === 1 ? "" : "s"}</span>
        ${Number(sound.playCount) > 0 ? `<span>${formatCount(sound.playCount)} plays</span>` : ""}
        ${Number(sound.favoriteCount) > 0 ? `<span>${formatCount(sound.favoriteCount)} ♥</span>` : ""}
        ${sound.bpm ? `<span>${sound.bpm} BPM</span>` : ""}
        ${sound.extra ? `<span>${esc(sound.extra)}</span>` : ""}
      </span>
    </a>
    <span class="sound-flags">
      ${external ? `<a class="licence-chip" href="${esc(sound.licenceUrl || "#")}" target="_blank" rel="noopener noreferrer" title="${esc(licence?.note || "Licence recorded on import")}">${esc(sound.licenceLabel || licence?.label || "Licensed")}</a>` : `<span class="sound-badge ${sound.isOriginal ? "is-original" : ""}">${sound.isOriginal ? "Original" : "Upload"}</span>`}
    </span>
    <span class="sound-actions">
      <button class="btn btn-sm ${favourite ? "btn-primary" : "btn-outline"}" type="button" data-act="fav" aria-pressed="${favourite}">${favourite ? "Saved" : "Save"}</button>
      ${isMine ? `<button class="btn btn-sm btn-ghost" type="button" data-act="use">Use in post</button>
                  <button class="btn btn-sm btn-ghost danger" type="button" data-act="delete-sound">Delete</button>` : `<button class="btn btn-sm btn-outline" type="button" data-act="use">Use</button>`}
      <button class="icon-btn" type="button" data-act="share-sound" title="Copy link">🔗</button>
      ${!isMine ? `<button class="icon-btn" type="button" data-act="report-sound" title="Report">⚑</button>` : ""}
    </span>
  </div>`;
}

function formatClock(seconds) {
  const n = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}

export function soundsView(ctx, { q = "", tab = "library" } = {}) {
  const activeTab = TABS.some((t) => t.id === tab) ? tab : "library";
  let unsub = null;
  const cleanups = [];
  let catalogueState = { items: [], loading: false, error: "", total: 0, page: 1, query: q, mood: "", sort: "popular", licenceOnly: true, expanded: new Map() };
  let visibleSounds = [];

  const html = `
    <div class="view-head music-head">
      <div>
        <h1>Music</h1>
        <p class="muted">${esc(CATALOGUE_PROVIDER.name)} · open-licence catalogue. Every track shows its licence and links to the original.</p>
      </div>
      <div class="music-tools">
        <form class="search-form" data-music-search>
          <input type="search" name="q" placeholder="Search artist, album, label…" value="${esc(q)}" autocomplete="off" />
          <button class="btn btn-primary btn-sm" type="submit">Search</button>
        </form>
        <button class="btn btn-outline btn-sm" type="button" data-act="upload-open">Upload your own</button>
      </div>
    </div>

    <nav class="tabs music-tabs" role="tablist">
      ${TABS.filter((t) => !t.own || ctx.state.profile)
        .map((t) => `<button class="tab ${t.id === activeTab ? "is-active" : ""}" role="tab" aria-selected="${t.id === activeTab}" data-tab="${t.id}">${t.label}</button>`)
        .join("")}
    </nav>

    <div id="music-body" class="music-body">
      <div class="loader-row"><span class="spinner"></span> Loading…</div>
    </div>
  `;

  async function paint(root) {
    const body = root.querySelector("#music-body");
    unsub?.();
    unsub = null;
    for (const off of cleanups.splice(0)) off();

    if (activeTab === "discover") {
      await paintCatalogue(root, body);
      return;
    }

    if (activeTab === "library") {
      body.innerHTML = `
        <div class="music-toolbar">
          <p class="tab-note">${ctx.state.profile ? "Sounds members added, ranked by uses. Click play and it keeps going while you browse." : "Browse the shared library. Sign in to save tracks or use them in a post."}</p>
          <div class="chip-row" data-genre-chips></div>
        </div>
        <div class="sound-list" data-sound-list><div class="loader-row"><span class="spinner"></span> Loading library…</div></div>`;
      let genre = "";
      const listHost = body.querySelector("[data-sound-list]");
      const chips = body.querySelector("[data-genre-chips]");
      const favIds = ctx.state.profile ? await getFavoriteSoundIds(ctx.state.profile.uid).catch(() => new Set()) : new Set();
      let visibleAll = [];

      const chipRow = (rows) => {
        const present = [...new Set(rows.map((r) => r.genre).filter(Boolean))];
        const options = [...new Set(["all", ...SOUND_GENRES.filter((g) => g !== "all").slice(0, 8), ...present])].slice(0, 14);
        chips.innerHTML = options
          .map((g) => `<button class="chip ${g === (genre || "all") ? "is-on" : ""}" type="button" data-genre="${esc(g)}">${esc(g)}</button>`)
          .join("");
      };

      const render = (rows) => {
        visibleAll = rows;
        visibleSounds = genre ? rows.filter((s) => s.genre === genre) : rows;
        chipRow(rows);
        chips.onclick = (event) => {
          const btn = event.target.closest("[data-genre]");
          if (!btn) return;
          genre = btn.dataset.genre === "all" ? "" : btn.dataset.genre;
          render(visibleAll);
        };
        if (!visibleSounds.length) {
          listHost.innerHTML = emptyState(
            "🎵",
            genre ? `No ${esc(genre)} sounds yet` : "The library is empty",
            ctx.state.profile
              ? "Upload a track of yours, or import one from the Discover tab."
              : "Sign in to add the first track.",
            '<a class="btn btn-primary btn-sm" href="#/music?tab=discover">Browse the catalogue</a>'
          );
          return;
        }
        listHost.innerHTML = visibleSounds
          .map((s, i) => soundRowHtml(s, { isMine: ctx.state.profile?.uid === s.artistUid, favourite: favIds.has(s.id), contextIndex: i }))
          .join("");
      };

      unsub = watchTrendingSounds((rows) => render(rows), 60);
      bindSoundList(ctx, listHost, () => visibleSounds);
      return;
    }


    if (activeTab === "uploads") {
      await paintUploads(root, body);
      return;
    }

    if (activeTab === "favourites") {
      if (!ctx.state.profile) {
        body.innerHTML = emptyState("🔒", "Sign in to save music", "Favourites live on your account.");
        return;
      }
      body.innerHTML = `<div class="sound-list" data-sound-list><div class="loader-row"><span class="spinner"></span> Loading favourites…</div></div>`;
      const listHost = body.querySelector("[data-sound-list]");
      unsub = watchFavoriteSounds(ctx.state.profile.uid, (rows) => {
        visibleSounds = rows;
        if (!rows.length) {
          listHost.innerHTML = emptyState("♥", "No saved tracks", "Tap Save on any track and it waits for you here.");
          return;
        }
        listHost.innerHTML = rows.map((s, i) => soundRowHtml(s, { isMine: ctx.state.profile?.uid === s.artistUid, favourite: true, contextIndex: i })).join("");
      });
      bindSoundList(ctx, listHost, () => visibleSounds);
      return;
    }

    if (activeTab === "history") {
      const rows = await getMyPlayHistory(ctx.state.profile?.uid, 20).catch(() => []);
      visibleSounds = rows;
      body.innerHTML = rows.length
        ? `<div class="sound-list">${rows.map((s, i) => soundRowHtml(s, { isMine: false, favourite: false, contextIndex: i })).join("")}</div>
           <p class="tab-note muted">Plays are counted once you've listened for 20 seconds — nothing is inflated.</p>`
        : emptyState("🕘", "Nothing played yet", "Press play on any track and it shows up here.");
      bindSoundList(ctx, body, () => visibleSounds);
      return;
    }

    body.innerHTML = emptyState("🧭", "Unknown tab", "Pick a tab above.");
  }


  /* ---- uploads tab (member audio, uploaded to Firebase Storage) ---- */
  async function paintUploads(root, body) {
    if (!ctx.state.profile) {
      body.innerHTML = emptyState("🎙", "Sign in to upload", "Your uploads are tied to your account and stored in your own Storage folder.");
      return;
    }
    const mine = await getUserSounds(ctx.state.profile.uid, 40).catch(() => []);
    body.innerHTML = `
      <div class="upload-card panel">
        <header class="panel-head"><h2>Add your own music</h2><span class="chip">MP3 up to 40 MB</span></header>
        <p class="tab-note">Only upload music you own or are licensed to share. Xacheus stores the file in your Storage folder and records the credit line on the sound, so reuse is traceable.</p>
        <form class="sound-upload-form" data-sound-form>
          <label class="create-drop" data-sound-drop>
            <input type="file" accept="audio/*" data-sound-file hidden />
            <span class="upload-drop-inner"><strong>Choose an audio file</strong><em data-sound-name>MP3, M4A, WAV or OGG</em></span>
          </label>
          <div class="upload-progress" data-sound-progress hidden><div class="upload-progress-bar" data-sound-bar></div></div>
          <div class="form-row">
            <label class="field"><span>Title</span><input type="text" maxlength="80" data-sound-title required /></label>
            <label class="field"><span>Genre</span><input type="text" maxlength="24" data-sound-genre placeholder="original" /></label>
            <label class="field"><span>BPM (optional)</span><input type="number" min="0" max="300" data-sound-bpm /></label>
          </div>
          <label class="field-check"><input type="checkbox" data-sound-free checked /><span>Mark as free to use by others (they must credit you)</span></label>
          <button class="btn btn-primary" type="submit" data-sound-submit disabled>Upload &amp; publish</button>
        </form>
      </div>
      <h3 class="strip-title">Your library</h3>
      <div class="sound-list" data-my-sounds>${mine.length ? "" : `<p class="panel-empty">Nothing uploaded yet.</p>`}</div>`;

    const listHost = body.querySelector("[data-my-sounds]");
    const renderMine = (rows) => {
      visibleSounds = rows;
      listHost.innerHTML = rows.length
        ? rows.map((s, i) => soundRowHtml(s, { isMine: true, favourite: false, contextIndex: i })).join("")
        : `<p class="panel-empty">Nothing uploaded yet.</p>`;
    };
    renderMine(mine);
    bindSoundList(ctx, listHost, () => visibleSounds);
    getFavoriteSoundIds(ctx.state.profile.uid).then((ids) => {
      visibleSounds.forEach((s) => s.__fav = ids.has(s.id));
      renderMine(visibleSounds);
    });

    const form = body.querySelector("[data-sound-form]");
    const file = body.querySelector("[data-sound-file]");
    const submit = body.querySelector("[data-sound-submit]");
    const bar = body.querySelector("[data-sound-bar]");
    const progress = body.querySelector("[data-sound-progress]");
    let picked = null;

    body.querySelector("[data-sound-drop]").addEventListener("click", () => file.click());
    file.addEventListener("change", () => {
      picked = file.files?.[0] || null;
      if (!picked) return;
      if (!/^audio\//.test(picked.type)) {
        toast("Pick an audio file.", "error");
        picked = null;
        return;
      }
      if (picked.size > 40 * 1024 * 1024) {
        toast("Audio uploads must be under 40 MB.", "error");
        picked = null;
        return;
      }
      body.querySelector("[data-sound-name]").textContent = `${picked.name} · ${Math.round(picked.size / 1024)} KB`;
      submit.disabled = false;
      const title = body.querySelector("[data-sound-title]");
      if (!title.value) title.value = String(picked.name).replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").slice(0, 80);
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!picked) return;
      submit.disabled = true;
      submit.textContent = "Uploading…";
      progress.hidden = false;
      bar.style.width = "3%";
      try {
        const uploaded = await uploadAudio(picked, { onProgress: (pct) => (bar.style.width = `${Math.max(3, pct)}%`) });
        await createSound(ctx.state.profile, {
          title: body.querySelector("[data-sound-title]").value.trim(),
          genre: body.querySelector("[data-sound-genre]").value.trim() || "original",
          bpm: Number(body.querySelector("[data-sound-bpm]").value) || 0,
          isFree: body.querySelector("[data-sound-free]").checked,
          audioUrl: uploaded.url,
          storagePath: uploaded.path,
          duration: uploaded.duration || 0,
        });
        toast("Sound published", "success");
        const rows = await getUserSounds(ctx.state.profile.uid, 40).catch(() => []);
        renderMine(rows);
        form.reset();
        body.querySelector("[data-sound-name]").textContent = "MP3, M4A, WAV or OGG";
      } catch (err) {
        toast(err?.message || "Upload failed", "error");
      } finally {
        submit.disabled = false;
        submit.textContent = "Upload & publish";
        progress.hidden = true;
      }
    });
  }

  /* ---- discover tab: the live catalogue ---- */
  async function paintCatalogue(root, body) {
    body.innerHTML = `
      <div class="catalogue-note panel">
        <strong>Real, licensed music</strong>
        <p>${esc(CATALOGUE_PROVIDER.licenceNote)}</p>
        <a class="link" href="${esc(CATALOGUE_PROVIDER.homepage)}" target="_blank" rel="noopener noreferrer">Open ${esc(CATALOGUE_PROVIDER.name)}</a>
        <span class="muted">· <a class="link" href="${esc(CATALOGUE_PROVIDER.terms)}" target="_blank" rel="noopener noreferrer">Archive terms</a></span>
      </div>
      <div class="chip-row catalogue-moods" data-moods>
        <button class="chip is-on" type="button" data-mood="">All</button>
        ${CATALOGUE_MOODS.map((m) => `<button class="chip" type="button" data-mood="${esc(m.id)}">${esc(m.label)}</button>`).join("")}
      </div>
      <div class="catalogue-sort">
        <label class="chip-toggle"><input type="checkbox" data-only-reusable ${catalogueState.licenceOnly ? "checked" : ""} /> Open licences only</label>
        <span class="grow"></span>
        <label class="field-inline"><span>Sort</span>
          <select data-sort>
            <option value="popular" ${catalogueState.sort === "popular" ? "selected" : ""}>Most played</option>
            <option value="new" ${catalogueState.sort === "new" ? "selected" : ""}>Newest</option>
            <option value="relevant" ${catalogueState.sort === "relevant" ? "selected" : ""}>Relevance</option>
          </select>
        </label>
        <span class="muted" data-result-count></span>
      </div>
      <div class="catalogue-results" data-results><div class="loader-row"><span class="spinner"></span> Searching the catalogue…</div></div>
      <div class="pager" data-pager></div>`;

    const results = body.querySelector("[data-results]");
    const pager = body.querySelector("[data-pager]");
    const countNode = body.querySelector("[data-result-count]");

    async function run(page = 1) {
      catalogueState.loading = true;
      catalogueState.error = "";
      catalogueState.page = page;
      results.innerHTML = `<div class="loader-row"><span class="spinner"></span> Searching ${esc(CATALOGUE_PROVIDER.name)}…</div>`;
      try {
        const { items, total } = await searchCatalogue({
          text: catalogueState.query || catalogueState.mood,
          page,
          rows: 12,
          sort: catalogueState.sort,
          licenceOnly: catalogueState.licenceOnly,
        });
        catalogueState.loading = false;
        catalogueState.items = items;
        catalogueState.total = total;
        countNode.textContent = total ? `${formatCount(total)} release${total === 1 ? "" : "s"}` : "";
        if (!items.length) {
          results.innerHTML = emptyState(
            "🎚",
            "Nothing matched",
            catalogueState.licenceOnly
              ? "Try a different mood, or untick “Open licences only” to search the full archive (those items can be previewed but not attached to posts)."
              : "Try another artist, label or genre."
          );
          pager.innerHTML = "";
          return;
        }
        results.innerHTML = items.map(releaseCard).join("");
        pager.innerHTML = pagerHtml(page, total, 12);
        bindResults(results, pager, run);
      } catch (err) {
        catalogueState.loading = false;
        catalogueState.error = err?.message || "The catalogue didn't answer.";
        results.innerHTML = `
          <div class="panel error-panel">
            <strong>Couldn't reach the music catalogue</strong>
            <p>${esc(catalogueState.error)}</p>
            <button class="btn btn-sm btn-primary" type="button" data-retry>Try again</button>
            <span class="muted">Xacheus never shows placeholder songs — if the catalogue is unreachable, this list stays empty.</span>
          </div>`;
        results.querySelector("[data-retry]")?.addEventListener("click", () => run(page));
      }
    }

    body.querySelector("[data-moods]").addEventListener("click", (event) => {
      const btn = event.target.closest("[data-mood]");
      if (!btn) return;
      catalogueState.mood = btn.dataset.mood;
      body.querySelectorAll("[data-mood]").forEach((c) => c.classList.toggle("is-on", c === btn));
      run(1);
    });
    body.querySelector("[data-sort]").addEventListener("change", (event) => {
      catalogueState.sort = event.target.value;
      run(1);
    });
    body.querySelector("[data-only-reusable]").addEventListener("change", (event) => {
      catalogueState.licenceOnly = event.target.checked;
      run(1);
    });

    if (!catalogueState.items.length && !catalogueState.query) {
      // First visit: seed with real, verified items (tracks are read live).
      const { loadSeedTracks } = await import("../music.js");
      const seeded = await loadSeedTracks({ perItem: 3 }).catch(() => []);
      if (seeded.length) {
        results.innerHTML = `<p class="tab-note">Verified starting points from ${esc(CATALOGUE_PROVIDER.name)} — every track below is fetched live from its archive item.</p>${seeded.map(seedCard).join("")}`;
        bindSeedCards(results, seeded);
      }
    }
    if (catalogueState.query || catalogueState.mood) run(catalogueState.page);
    else if (!catalogueState.items.length) {
      // no query yet and seeds failed → show the empty prompt instead of a spinner
      const { loadSeedTracks } = await import("../music.js");
      const seeded = await loadSeedTracks({ perItem: 2 }).catch(() => []);
      if (!seeded.length) {
        results.innerHTML = `<div class="panel"><strong>Pick a mood or search</strong><p class="muted">The catalogue holds tens of thousands of openly licensed releases. Choose a mood above, or search an artist or label.</p></div>`;
      } else bindSeedCards(results, seeded);
    }
  }

  function bindSeedCards(host, seeded) {
    host.querySelectorAll("[data-seed-item]").forEach((card) => {
      const identifier = card.dataset.seedItem;
      const seed = seeded.find((s) => s.item?.identifier === identifier) || {};
      const tracks = seed.tracks || [];
      card.querySelectorAll("[data-track-play]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const fresh = tracks.length ? { tracks } : await loadItemTracks(identifier).catch(() => ({ tracks: [] }));
          if (!fresh.tracks.length) return toast("No playable files on that item right now.", "error");
          playQueue(fresh.tracks, Number(btn.dataset.trackPlay) || 0);
        });
      });
      card.querySelectorAll("[data-track-attach]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const track = tracks[Number(btn.dataset.trackAttach) || 0] || (await loadItemTracks(identifier).then((r) => r.tracks[0]).catch(() => null));
          if (track) await attachTrackFlow(ctx, track);
        });
      });
      card.querySelector("[data-seed-open]")?.addEventListener("click", () => expandRelease(card, identifier, ctx));
    });
  }

  function bindResults(results, pager, run) {
    results.querySelectorAll("[data-release]").forEach((card) => {
      const identifier = card.dataset.release;
      card.querySelector("[data-release-open]")?.addEventListener("click", () => expandRelease(card, identifier, ctx));
      card.querySelector("[data-release-visit]")?.addEventListener("click", () => {
        /* native link */
      });
      card.querySelectorAll("[data-track-play]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const cached = catalogueState.expanded.get(identifier);
          const tracks = cached?.tracks || (await loadItemTracks(identifier).then((r) => r.tracks).catch(() => []));
          if (!tracks.length) return toast("No playable files on that item right now.", "error");
          playQueue(tracks, Number(btn.dataset.trackPlay) || 0);
        });
      });
      card.querySelectorAll("[data-track-attach]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const cached = catalogueState.expanded.get(identifier);
          const tracks = cached?.tracks || (await loadItemTracks(identifier).then((r) => r.tracks).catch(() => []));
          const track = tracks[Number(btn.dataset.trackAttach) || 0];
          if (!track) return;
          await attachTrackFlow(ctx, track);
        });
      });
    });
    pager.querySelectorAll("[data-page]").forEach((btn) => {
      btn.addEventListener("click", () => run(Number(btn.dataset.page)));
    });
  }

  async function expandRelease(card, identifier, ctx) {
    const host = card.querySelector("[data-tracks]");
    if (!host) return;
    if (catalogueState.expanded.has(identifier)) {
      host.hidden = !host.hidden;
      return;
    }
    host.innerHTML = `<div class="loader-row"><span class="spinner"></span> Reading this item's files…</div>`;
    host.hidden = false;
    try {
      const { item, tracks } = await loadItemTracks(identifier);
      if (!tracks.length) {
        host.innerHTML = `<p class="panel-empty">This item has no MP3 files, so Xacheus can't play it. Try another release.</p>`;
        return;
      }
      catalogueState.expanded.set(identifier, { item, tracks });
      host.innerHTML = tracks.map((t, i) => trackRow(t, i, item, ctx)).join("");
      host.querySelectorAll("[data-track-play]").forEach((btn) => {
        btn.addEventListener("click", () => playQueue(tracks, Number(btn.dataset.trackPlay) || 0));
      });
      host.querySelectorAll("[data-track-attach]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const track = tracks[Number(btn.dataset.trackAttach) || 0];
          if (track) await attachTrackFlow(ctx, track);
        });
      });
      host.querySelectorAll("[data-track-fav]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!ctx.state.profile) return ctx.requireAuth();
          const track = tracks[Number(btn.dataset.trackFav) || 0];
          try {
            const sound = await attachCatalogueSound(ctx.state.profile, track);
            const on = await toggleSoundFavorite(ctx.state.profile.uid, sound);
            btn.textContent = on ? "Saved" : "Save";
            btn.classList.toggle("btn-primary", on);
            toast(on ? "Saved to your favourites" : "Removed from favourites", "success", 1800);
          } catch (err) {
            toast(err?.message || "Could not save that track", "error");
          }
        });
      });
    } catch (err) {
      host.innerHTML = `<p class="panel-empty">${esc(err?.message || "Couldn't read that item.")}</p>`;
    }
  }

  function trackRow(track, i, item, ctx) {
    const licence = track.licence || describeLicence(track.licenseUrl);
    const canAttach = licence.reusable;
    void ctx;
    void item;
    return `
    <div class="track-row" data-track-row="${i}">
      <button class="sound-play" type="button" data-track-play="${i}" aria-label="Play ${esc(track.title)}">
        <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
      </button>
      <span class="track-main">
        <strong>${esc(track.title)}</strong>
        <em>${esc(track.artist)}${track.track ? ` · track ${track.track}` : ""}${track.duration ? ` · ${formatClock(track.duration)}` : ""}</em>
      </span>
      <a class="licence-chip" href="${esc(licence.url || "#")}" target="_blank" rel="noopener noreferrer" title="${esc(licence.note)}">${esc(licence.label)}</a>
      <span class="track-actions">
        <button class="btn btn-sm btn-ghost" type="button" data-track-fav="${i}">Save</button>
        ${canAttach
          ? `<button class="btn btn-sm btn-outline" type="button" data-track-attach="${i}">Use in a post</button>`
          : `<span class="licence-warn" title="${esc(licence.note)}">Listen only</span>`}
      </span>
    </div>`;
  }

  /** Import a catalogue track into `sounds` and offer it for a new post. */
  async function attachTrackFlow(ctx2, track) {
    const licence = track.licence || describeLicence(track.licenseUrl);
    if (!licence.reusable) {
      toast(`${licence.label} doesn't allow reuse in a post — you can still listen and share the original.`, "error", 5200);
      return;
    }
    if (!ctx2.state.profile) return ctx2.requireAuth();
    try {
      const sound = await attachCatalogueSound(ctx2.state.profile, track);
      await bumpSoundUse(sound.id).catch(() => {});
      openModal({
        title: "Track added",
        size: "sm",
        body: `<div class="import-card">
            <img src="${esc(track.artwork)}" alt="" />
            <div>
              <strong>${esc(track.title)}</strong>
              <em>${esc(track.artist)}</em>
              <p>${esc(licence.note)}</p>
              <a class="link" href="${esc(track.itemUrl)}" target="_blank" rel="noopener noreferrer">Original item on archive.org</a>
            </div>
          </div>
          <p class="modal-text muted">${esc(attributionLine(track))}</p>
          <div class="modal-actions">
            <a class="btn btn-primary" href="#/create?sound=${encodeURIComponent(sound.id)}">Use it in a post</a>
            <a class="btn btn-ghost" href="#/sound/${encodeURIComponent(sound.id)}">Open sound page</a>
          </div>`,
      });
      toast("Track imported with its licence", "success", 2200);
    } catch (err) {
      toast(err?.message || "Could not import that track", "error");
    }
  }

  function pagerHtml(page, total, rows) {
    const pages = Math.min(20, Math.max(1, Math.ceil(total / rows)));
    if (pages <= 1) return "";
    const list = [];
    for (let p = Math.max(1, page - 2); p <= Math.min(pages, page + 2); p += 1) {
      list.push(`<button class="btn btn-sm ${p === page ? "btn-primary" : "btn-outline"}" type="button" data-page="${p}">${p}</button>`);
    }
    return `<span class="muted">Page ${page} of ${pages}</span><span class="pager-buttons">${list.join("")}</span>`;
  }

  function releaseCard(item) {
    const licence = describeLicence(item.licenseUrl);
    return `
    <article class="release-card" data-release="${esc(item.identifier)}">
      <a class="release-art" href="${esc(item.itemUrl)}" target="_blank" rel="noopener noreferrer" data-release-visit>
        <img src="${esc(item.artwork)}" alt="" loading="lazy" onerror="this.classList.add('is-missing')" />
      </a>
      <div class="release-body">
        <header>
          <strong>${esc(item.title)}</strong>
          <em>${esc(item.creator)}${item.year ? ` · ${esc(item.year)}` : ""}</em>
        </header>
        <p>${esc(item.description || "No description supplied by the item.")}</p>
        <div class="release-meta">
          <a class="licence-chip" href="${esc(licence.url || item.itemUrl)}" target="_blank" rel="noopener noreferrer">${esc(licence.label)}</a>
          <span class="muted">${formatCount(item.downloads)} downloads on archive.org</span>
        </div>
        <div class="release-actions">
          <button class="btn btn-sm btn-primary" type="button" data-release-open>See tracks</button>
          <a class="btn btn-sm btn-outline" href="${esc(item.itemUrl)}" target="_blank" rel="noopener noreferrer">View original</a>
          ${licence.reusable ? "" : `<span class="licence-warn" title="${esc(licence.note)}">Listen only</span>`}
        </div>
        <div class="release-tracks" data-tracks hidden></div>
      </div>
    </article>`;
  }

  function seedCard(seed) {
    const item = seed.item || {};
    return `
    <article class="release-card is-seed" data-seed-item="${esc(item.identifier)}">
      <a class="release-art" href="${esc(item.itemUrl)}" target="_blank" rel="noopener noreferrer">
        <img src="${esc(item.artwork)}" alt="" loading="lazy" onerror="this.classList.add('is-missing')" />
      </a>
      <div class="release-body">
        <header><strong>${esc(item.title)}</strong><em>${esc(item.creator)}</em></header>
        <p>${esc(seed.note || item.note || "")}</p>
        <div class="release-tracks is-open">
          ${(seed.tracks || []).map((t, i) => trackRowPreview(t, i)).join("")}
        </div>
        <div class="release-actions">
          <button class="btn btn-sm btn-outline" type="button" data-seed-open>Load all tracks</button>
          <a class="btn btn-sm btn-ghost" href="${esc(item.itemUrl)}" target="_blank" rel="noopener noreferrer">View original</a>
        </div>
      </div>
    </article>`;
  }

  function trackRowPreview(track, i) {
    const licence = track.licence || describeLicence(track.licenseUrl);
    return `
      <div class="track-row">
        <button class="sound-play" type="button" data-track-play="${i}" aria-label="Play ${esc(track.title)}"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>
        <span class="track-main"><strong>${esc(track.title)}</strong><em>${esc(track.artist)}${track.duration ? ` · ${formatClock(track.duration)}` : ""}</em></span>
        <a class="licence-chip" href="${esc(licence.url || "#")}" target="_blank" rel="noopener noreferrer">${esc(licence.label)}</a>
        <span class="track-actions">
          ${licence.reusable ? `<button class="btn btn-sm btn-outline" type="button" data-track-attach="${i}">Use in a post</button>` : `<span class="licence-warn">Listen only</span>`}
        </span>
      </div>`;
  }

  /** Row actions for any list of `sounds` docs. */
  function bindSoundList(ctx2, host, getList) {
    host.addEventListener("click", async (event) => {
      const row = event.target.closest("[data-sound-row]");
      if (!row) return;
      const btn = event.target.closest("[data-act]");
      const id = row.dataset.soundRow;
      const list = getList() || [];
      const sound = list.find((s) => s.id === id) || (await getSound(id));
      if (!sound) return;

      if (!btn) {
        if (event.target.closest("a")) return;
        const index = list.findIndex((s) => s.id === id);
        if (isCurrentTrack(id)) toggleTrack(sound);
        else playQueue(list, Math.max(0, index));
        return;
      }
      const act = btn.dataset.act;
      if (act === "play") {
        const index = list.findIndex((s) => s.id === id);
        if (isCurrentTrack(id)) toggleTrack(sound);
        else playQueue(list, Math.max(0, index));
        return;
      }
      if (act === "fav") {
        if (!ctx2.state.profile) return ctx2.requireAuth();
        try {
          const on = await toggleSoundFavorite(ctx2.state.profile.uid, sound);
          btn.textContent = on ? "Saved" : "Save";
          btn.classList.toggle("btn-primary", on);
          btn.setAttribute("aria-pressed", String(on));
          toast(on ? "Saved to favourites" : "Removed from favourites", "success", 1800);
        } catch (err) {
          toast(err?.message || "Could not save that track", "error");
        }
        return;
      }
      if (act === "use") {
        if (!ctx2.state.profile) return ctx2.requireAuth();
        ctx2.navigate(`#/create?sound=${encodeURIComponent(sound.id)}`);
        return;
      }
      if (act === "delete-sound") {
        if (!ctx2.state.profile) return ctx2.requireAuth();
        const ok = await confirmDialogLocal(sound);
        if (!ok) return;
        try {
          await deleteSound(sound.id, ctx2.state.profile.uid);
          toast("Sound deleted", "success");
          row.remove();
        } catch (err) {
          toast(err?.message || "Could not delete that sound", "error");
        }
        return;
      }
      if (act === "share-sound") {
        const url = `${location.origin}${location.pathname}#/sound/${encodeURIComponent(sound.id)}`;
        const { copyText } = await import("../ui.js");
        copyText(url);
        return;
      }
      if (act === "report-sound") {
        if (!ctx2.state.profile) return ctx2.requireAuth();
        openReportModal(ctx2, {
          targetType: "sound",
          targetId: sound.id,
          targetOwnerUid: sound.artistUid || "",
          targetLabel: `${sound.title} — ${sound.artist}`,
        });
      }
    });
  }

  async function confirmDialogLocal(sound) {
    const { confirmDialog } = await import("../ui.js");
    return confirmDialog({
      title: "Delete this sound?",
      body: `"${sound.title}" and its audio file are removed. Posts that already use it keep playing it until the file is gone.`,
      confirmLabel: "Delete",
      danger: true,
    });
  }

  return {
    html,
    title: "Music",
    mount(root) {
      const bar = root.querySelector("[data-music-search]");
      bar?.addEventListener("submit", (event) => {
        event.preventDefault();
        const term = bar.querySelector("input[name=q]").value.trim();
        catalogueState.query = term;
        ctx.navigate(`#/music?tab=discover&q=${encodeURIComponent(term)}`);
        paint(root);
      });
      root.querySelector('[data-act="upload-open"]')?.addEventListener("click", () => {
        ctx.navigate("#/music?tab=uploads");
        paint(root);
      });
      root.querySelectorAll(".music-tabs .tab").forEach((btn) => {
        btn.addEventListener("click", () => ctx.navigate(`#/music?tab=${btn.dataset.tab}`));
      });
      paint(root);
    },
    destroy() {
      unsub?.();
      for (const off of cleanups.splice(0)) off();
    },
  };
}

/* ------------------------------------------------------------------ */
/* sound detail                                                        */
/* ------------------------------------------------------------------ */

export function soundDetailView(ctx, { soundId }) {
  const html = `
    <div class="view-head"><button class="icon-btn back-btn" type="button" data-act="back" aria-label="Back">←</button><h1>Sound</h1></div>
    <div id="sound-detail"><div class="loader-row"><span class="spinner"></span> Loading sound…</div></div>
  `;

  return {
    html,
    title: "Sound",
    async mount(root) {
      root.querySelector("[data-act='back']")?.addEventListener("click", () => history.back());
      const host = root.querySelector("#sound-detail");
      const sound = await getSound(soundId).catch(() => null);
      if (!sound) {
        host.innerHTML = emptyState(
          "🎵",
          "Sound unavailable",
          "This track was deleted, or its archive item no longer exists. Xacheus never keeps placeholder audio for a missing sound.",
          '<a class="btn btn-primary btn-sm" href="#/music">Browse music</a>'
        );
        return;
      }
      const [videos, favouriteIds] = await Promise.all([
        getVideosBySound(soundId, 20).catch(() => []),
        ctx.state.profile ? getFavoriteSoundIds(ctx.state.profile.uid).catch(() => new Set()) : Promise.resolve(new Set()),
      ]);
      const licence = sound.licenceUrl ? describeLicence(sound.licenceUrl) : null;
      const isMine = ctx.state.profile?.uid === sound.artistUid;
      const author = sound.artistUsername ? { username: sound.artistUsername, displayName: sound.artist } : null;

      host.innerHTML = `
        <div class="sound-hero panel">
          <div class="sound-hero-art">${sound.coverUrl ? `<img src="${esc(sound.coverUrl)}" alt="" />` : `<span>${esc((sound.title || "S").slice(0, 1).toUpperCase())}</span>`}</div>
          <div class="sound-hero-body">
            <h2>${esc(sound.title)}</h2>
            <p class="sound-hero-artist">${esc(sound.artist || "Unknown artist")}${sound.album ? ` · ${esc(sound.album)}` : ""}</p>
            <div class="sound-hero-stats">
              <span><strong>${formatCount(sound.useCount || 0)}</strong> posts</span>
              <span><strong>${formatCount(sound.playCount || 0)}</strong> plays</span>
              <span><strong>${formatCount(sound.favoriteCount || 0)}</strong> saved</span>
              ${sound.duration ? `<span>${formatClock(sound.duration)}</span>` : ""}
              ${sound.genre ? `<span class="chip">${esc(sound.genre)}</span>` : ""}
              ${sound.bpm ? `<span>${sound.bpm} BPM</span>` : ""}
            </div>
            <div class="sound-hero-actions">
              <button class="btn btn-primary" type="button" data-sd-act="play">Play</button>
              <button class="btn ${favouriteIds.has(soundId) ? "btn-primary" : "btn-outline"}" type="button" data-sd-act="fav">${favouriteIds.has(soundId) ? "Saved" : "Save"}</button>
              <a class="btn btn-outline" href="#/create?sound=${encodeURIComponent(soundId)}">Use in a post</a>
              <button class="icon-btn" type="button" data-sd-act="share" title="Copy link">🔗</button>
              <button class="icon-btn" type="button" data-sd-act="report" title="Report">⚑</button>
              ${isMine ? `<button class="btn btn-ghost danger" type="button" data-sd-act="delete">Delete</button>` : ""}
            </div>
          </div>
        </div>

        <div class="panel licence-panel">
          <h3>Licence &amp; credit</h3>
          <p>${esc(licence?.note || (sound.isOriginal ? "This member published the recording themselves. Credit @"+ (sound.artistUsername || "author") +" and ask before reusing it elsewhere." : "No licence recorded on this sound — treat it as the uploader's own work."))}</p>
          <ul class="credit-list">
            <li><strong>Title</strong><span>${esc(sound.title)}</span></li>
            <li><strong>Artist</strong><span>${esc(sound.artist || "Unknown")}</span></li>
            ${sound.album ? `<li><strong>Release</strong><span>${esc(sound.album)}</span></li>` : ""}
            ${licence ? `<li><strong>Licence</strong><span><a class="link" href="${esc(licence.url)}" target="_blank" rel="noopener noreferrer">${esc(licence.label)}</a></span></li>` : ""}
            ${sound.sourceId ? `<li><strong>Source item</strong><span><a class="link" href="${esc(sound.sourceUrl || `https://archive.org/details/${sound.sourceId}`)}" target="_blank" rel="noopener noreferrer">archive.org/details/${esc(sound.sourceId)}</a></span></li>` : ""}
            ${sound.artistUsername ? `<li><strong>Added by</strong><span><a class="link" href="#/u/${esc(sound.artistUsername)}">@${esc(sound.artistUsername)}</a></span></li>` : ""}
          </ul>
          <p class="muted small">${esc(attributionLine({ ...sound, licence }) || "")}</p>
        </div>

        <section class="panel">
          <header class="panel-head"><h3>Posts using this sound</h3><span class="chip">${videos.length}</span></header>
          ${videos.length
            ? `<div class="video-grid">${videos.map((v) => miniPost(v)).join("")}</div>`
            : `<p class="panel-empty">Nobody has posted with this sound yet.</p>`}
        </section>`;

      function miniPost(video) {
        const thumb = video.thumbnailUrl || (Array.isArray(video.images) ? video.images[0] : "");
        return `<button class="video-grid-card" type="button" data-goto-video="${esc(video.id)}">
          <span class="grid-thumb">${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy" />` : `<span class="grid-fallback"></span>`}
            <span class="grid-views"><span>❤️ ${formatCount(video.likeCount)}</span><span>💬 ${formatCount(video.commentCount)}</span></span>
          </span>
          <span class="grid-meta"><em>@${esc(video.username)} · ${timeAgo(video.createdAt)}</em></span>
        </button>`;
      }

      host.querySelectorAll("[data-goto-video]").forEach((btn) =>
        btn.addEventListener("click", () => ctx.navigate(`#/video/${btn.dataset.gotoVideo}`))
      );

      host.addEventListener("click", async (event) => {
        const btn = event.target.closest("[data-sd-act]");
        if (!btn) return;
        const act = btn.dataset.sdAct;
        if (act === "play") {
          if (isCurrentTrack(soundId)) toggleTrack(sound);
          else playQueue([sound]);
          return;
        }
        if (act === "fav") {
          if (!ctx.state.profile) return ctx.requireAuth();
          try {
            const on = await toggleSoundFavorite(ctx.state.profile.uid, sound);
            btn.textContent = on ? "Saved" : "Save";
            btn.classList.toggle("btn-primary", on);
          } catch (err) {
            toast(err?.message || "Could not save that track", "error");
          }
          return;
        }
        if (act === "share") {
          const { copyText } = await import("../ui.js");
          copyText(`${location.origin}${location.pathname}#/sound/${encodeURIComponent(soundId)}`);
          return;
        }
        if (act === "report") {
          if (!ctx.state.profile) return ctx.requireAuth();
          openReportModal(ctx, { targetType: "sound", targetId: soundId, targetOwnerUid: sound.artistUid || "", targetLabel: sound.title });
          return;
        }
        if (act === "delete") {
          const { confirmDialog } = await import("../ui.js");
          const ok = await confirmDialog({ title: "Delete this sound?", body: "The audio file and its library entry are removed.", confirmLabel: "Delete", danger: true });
          if (!ok) return;
          try {
            await deleteSound(soundId, ctx.state.profile.uid);
            toast("Sound deleted", "success");
            ctx.navigate("#/music?tab=uploads");
          } catch (err) {
            toast(err?.message || "Could not delete that sound", "error");
          }
        }
      });
      void author;
    },
    destroy() {},
  };
}

/** Small modal used by other views to let a member upload a sound. */
export function mountSoundUploadModal(ctx) {
  openModal({
    title: "Upload a sound",
    size: "sm",
    body: `
      <p class="modal-text">Only upload music you own or may share. Prefer an open-licence track? The <a class="link" href="#/music?tab=discover">Discover</a> tab has thousands with the licence shown.</p>
      <form class="form-grid" data-quick-sound>
        <label class="create-drop" data-qs-drop><input type="file" accept="audio/*" hidden data-qs-file /><span class="upload-drop-inner"><strong>Choose audio</strong><em data-qs-name>MP3 up to 40 MB</em></span></label>
        <label class="field"><span>Title</span><input maxlength="80" data-qs-title required /></label>
        <button class="btn btn-primary btn-block" type="submit" disabled data-qs-submit>Upload</button>
      </form>`,
    onMount(modal, close) {
      let file = null;
      modal.querySelector("[data-qs-drop]").addEventListener("click", () => modal.querySelector("[data-qs-file]").click());
      modal.querySelector("[data-qs-file]").addEventListener("change", (event) => {
        file = event.target.files?.[0] || null;
        if (!file) return;
        modal.querySelector("[data-qs-name]").textContent = `${file.name} · ${Math.round(file.size / 1024)} KB`;
        modal.querySelector("[data-qs-submit]").disabled = false;
      });
      modal.querySelector("[data-quick-sound]").addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!file) return;
        const submit = modal.querySelector("[data-qs-submit]");
        submit.disabled = true;
        submit.textContent = "Uploading…";
        try {
          const uploaded = await uploadAudio(file);
          const created = await createSound(ctx.state.profile, {
            title: modal.querySelector("[data-qs-title]").value.trim() || file.name,
            audioUrl: uploaded.url,
            storagePath: uploaded.path,
            duration: uploaded.duration,
          });
          toast("Sound published", "success");
          close();
          ctx.navigate(`#/sound/${created.id}`);
        } catch (err) {
          toast(err?.message || "Upload failed", "error");
          submit.disabled = false;
          submit.textContent = "Upload";
        }
      });
    },
  });
}

