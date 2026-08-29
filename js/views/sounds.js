/** Xacheus — Sounds library Phase 1 */

import { watchSounds, watchTrendingSounds, getSounds, CURATED_FREE_SOUNDS } from "../data.js";
import { esc, emptyState } from "../ui.js";

export function soundsView(ctx, { q = "" } = {}) {
  const html = `
    <div class="view-head">
      <h1>Sounds</h1>
      <p class="view-sub">Royalty-free beats, gospel, afro vibes — no copyrighted YouTube tracks. All usable.</p>
    </div>

    <form class="discover-search" id="sounds-search">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
      <input type="search" name="q" placeholder="Search sounds… e.g. lo-fi, afrobeat, gospel" value="${esc(q)}" autocomplete="off" />
      <button class="btn btn-primary btn-sm" type="submit">Search</button>
    </form>

    <div class="tabs" role="tablist">
      <button class="tab is-active" data-tab="free">Free music</button>
      <button class="tab" data-tab="trending">Trending</button>
      <button class="tab" data-tab="original">Original sounds</button>
      <button class="tab" data-tab="all">All</button>
    </div>

    <div class="sounds-content" id="sounds-content">
      <div class="loader-row"><span class="spinner"></span> Loading sounds…</div>
    </div>

    <div class="panel" style="margin-top:20px">
      <h2 class="panel-title">Why free sounds only?</h2>
      <p class="panel-empty">We don't use copyrighted YouTube tracks. All sounds here are either original (your video's audio) or royalty-free from Pixabay/Mixkit free library — safe for creators, businesses and churches. No takedowns.</p>
    </div>
  `;

  let currentTab = "free";
  let unsub = null;
  let allSounds = CURATED_FREE_SOUNDS;

  function renderList(sounds, filter = "") {
    const content = document.querySelector("#sounds-content");
    if (!content) return;
    let list = sounds;
    if (filter) {
      const f = filter.toLowerCase();
      list = sounds.filter((s) => s.title.toLowerCase().includes(f) || (s.artist || "").toLowerCase().includes(f) || (s.genre || "").toLowerCase().includes(f));
    }
    if (!list.length) {
      content.innerHTML = emptyState("🎵", "No sounds found", `No results for "${esc(filter)}"`, "");
      return;
    }
    content.innerHTML = list.map((s) => `
      <div class="sound-row" data-sound-id="${esc(s.id)}">
        <div class="sound-row-main">
          <span class="sound-cover">${s.isFree ? "🆓" : "🎤"}</span>
          <span class="sound-meta">
            <strong>${esc(s.title)}</strong>
            <em>${esc(s.artist || "Unknown")} · ${esc(s.genre || "original")} · used ${s.useCount || 0} times ${s.isFree ? "· free" : ""}</em>
          </span>
        </div>
        <audio src="${esc(s.audioUrl)}" controls preload="none"></audio>
        <div class="sound-actions">
          <a class="btn btn-outline btn-sm" href="#/discover?q=${esc(s.id)}&tab=videos">Videos using this</a>
          <a class="btn btn-primary btn-sm" href="#/create">Use sound</a>
        </div>
      </div>
    `).join("");
  }

  async function loadTab(tab, filter = "") {
    currentTab = tab;
    document.querySelectorAll(".tabs .tab").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === tab));
    const content = document.querySelector("#sounds-content");
    content.innerHTML = `<div class="loader-row"><span class="spinner"></span> Loading…</div>`;

    if (unsub) { unsub(); unsub = null; }

    if (tab === "free") {
      allSounds = CURATED_FREE_SOUNDS;
      try {
        const db = await getSounds({ onlyFree: true, limitCount: 50 });
        const ids = new Set(allSounds.map((s) => s.id));
        db.forEach((s) => { if (!ids.has(s.id)) allSounds.push(s); });
      } catch {}
      renderList(allSounds.filter((s) => s.isFree), filter);
    } else if (tab === "trending") {
      unsub = watchTrendingSounds((sounds) => {
        allSounds = sounds;
        let list = [...sounds].sort((a, b) => (b.useCount || 0) - (a.useCount || 0));
        renderList(list, filter);
      });
    } else if (tab === "original") {
      unsub = watchSounds((sounds) => {
        allSounds = sounds.filter((s) => s.isOriginal);
        renderList(allSounds, filter);
      });
    } else {
      unsub = watchSounds((sounds) => {
        allSounds = sounds.length ? sounds : CURATED_FREE_SOUNDS;
        // merge curated if needed
        if (sounds.length) {
          const ids = new Set(sounds.map((s) => s.id));
          CURATED_FREE_SOUNDS.forEach((s) => { if (!ids.has(s.id)) allSounds.push(s); });
        }
        renderList(allSounds, filter);
      });
    }
  }

  return {
    html,
    title: "Sounds",
    mount(root) {
      const searchForm = root.querySelector("#sounds-search");
      const input = searchForm.querySelector("input");
      loadTab("free", q);

      searchForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const query = input.value.trim();
        renderList(allSounds, query);
        history.replaceState(null, "", `#/sounds?q=${encodeURIComponent(query)}`);
      });

      root.querySelectorAll(".tabs .tab").forEach((btn) => {
        btn.addEventListener("click", () => {
          loadTab(btn.dataset.tab, input.value.trim());
        });
      });
    },
    destroy() {
      if (unsub) unsub();
    },
  };
}
