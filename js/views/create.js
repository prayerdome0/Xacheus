/**
 * Xacheus — Create.
 *
 * Three real post types on one form: vertical video (upload or camera record),
 * a photo set (up to 6), and a story. Anything you attach as music comes from
 * the live library or the licensed catalogue — Xacheus never offers a song you
 * can't actually play.
 */

import { uploadVideo, uploadImage, uploadStoryMedia } from "../storage.js";
import {
  attachCatalogueSound,
  createVideo,
  getSound,
  getSounds,
  searchSounds,
  getSoundGenres,
  formatSoundDuration,
} from "../data.js";
import { toast, esc, avatar } from "../ui.js";
import { playQueue, toggleTrack, isCurrentTrack } from "../player.js";
import { describeLicence, loadItemTracks, searchCatalogue } from "../music.js";
import { addStory } from "../social.js";

export function createView(ctx, { soundId: initialSoundId = "", tab: initialTab = "" } = {}) {
  let selectedFile = null;
  let selectedSound = null;
  let recordedBlob = null;
  let mediaRecorder = null;
  let recordingStream = null;
  let recordingChunks = [];
  let isRecording = false;
  let uploadProgress = 0;
  let photoFiles = []; // File objects (max 6)
  let photoUrls = []; // object URLs for previews

  const html = `
    <div class="view-head">
      <h1>Create</h1>
      <p class="view-sub">Post a vertical video or a photo set. Add caption, hashtags and a free sound.</p>
    </div>

    <div class="create-layout">
      <div class="create-main">
        <div class="tabs create-tabs" role="tablist">
          <button class="tab ${initialTab === "video" || !initialTab ? "is-active" : ""}" type="button" data-ctype="video">🎬 Video</button>
          <button class="tab ${initialTab === "photo" || initialTab === "photos" ? "is-active" : ""}" type="button" data-ctype="photo">🖼️ Photo</button>
          <button class="tab ${initialTab === "text" ? "is-active" : ""}" type="button" data-ctype="text">✍️ Text</button>
        </div>

        <div id="video-pane" ${initialTab === "photo" || initialTab === "photos" || initialTab === "text" ? "hidden" : ""}>
        <div class="create-drop" id="drop-zone">
          <div class="drop-inner" id="drop-inner">
            <div class="drop-icon">🎬</div>
            <h3>Upload vertical video</h3>
            <p>MP4, MOV, WebM — up to 100MB, 15-180 seconds. Vertical 9:16 works best.</p>
            <label class="btn btn-primary">
              <input type="file" id="video-input" accept="video/*" hidden />
              Choose video
            </label>
            <p class="or">or</p>
            <button class="btn btn-outline" type="button" id="record-btn">● Record with camera</button>
          </div>

          <div class="video-preview-wrap" id="preview-wrap" hidden>
            <video id="preview-video" controls playsinline loop muted></video>
            <div class="preview-overlay">
              <span class="preview-badge" id="preview-duration"></span>
              <button class="icon-btn" type="button" id="remove-video" aria-label="Remove">✕</button>
            </div>
            <div class="upload-progress-bar" id="upload-progress" hidden>
              <span id="upload-progress-fill" style="width:0%"></span>
              <em id="upload-progress-text">0%</em>
            </div>
          </div>

          <div class="record-ui" id="record-ui" hidden>
            <video id="record-live" autoplay muted playsinline></video>
            <div class="record-controls">
              <span class="record-dot" id="record-dot"></span>
              <span id="record-timer">00:00</span>
              <button class="btn btn-danger btn-sm" type="button" id="stop-record">Stop</button>
              <button class="btn btn-ghost btn-sm" type="button" id="cancel-record">Cancel</button>
            </div>
          </div>
        </div>

        <form class="create-form" id="create-form" novalidate>
          <label class="field">
            <span>Caption <em>(optional)</em> — #hashtags and @mentions are linked</span>
            <textarea id="caption" rows="3" maxlength="1000" placeholder="Add a caption… e.g. My first video! #zambia #gospel"></textarea>
            <small class="field-hint"><span id="caption-count">0</span>/1000</small>
          </label>

          <div class="field">
            <span>Sound <em>(optional)</em> — pick a free sound or original audio</span>
            <div class="sound-picker">
              <div class="sound-selected" id="sound-selected">
                <span class="sound-none">Original audio (video's own sound)</span>
              </div>
              <button class="btn btn-outline btn-sm" type="button" id="choose-sound">Choose sound</button>
              <button class="btn btn-ghost btn-sm" type="button" id="clear-sound" hidden>Use original</button>
            </div>
            <div class="sounds-mini" id="sounds-mini"></div>
            <p class="field-hint sound-licence-note" id="sound-licence-note" hidden></p>
          </div>

          <label class="field-check">
            <input type="checkbox" id="video-as-story" />
            <span>Also put this clip in my <strong>story</strong> (gone after 24 hours)</span>
          </label>
          <div class="create-actions">
            <button class="btn btn-primary btn-block" type="submit" id="post-btn" disabled>Post video</button>
            <p class="fine-print">By posting you confirm you own this video and it doesn't violate copyright. We use only royalty-free sounds — no YouTube rips.</p>
          </div>
        </form>
        </div><!-- /video-pane -->

        <div id="photo-pane" ${initialTab === "photo" || initialTab === "photos" ? "" : "hidden"}>
          <div class="create-drop" id="photo-drop">
            <div class="drop-inner" id="photo-drop-inner">
              <div class="drop-icon">🖼️</div>
              <h3>Add photos</h3>
              <p>Up to 6 photos — JPG, PNG or WebP. They'll post as a swipeable photo set.</p>
              <label class="btn btn-primary">
                <input type="file" id="photo-input" accept="image/*" multiple hidden />
                Choose photos
              </label>
            </div>
            <div class="photo-previews" id="photo-previews"></div>
            <div class="upload-progress-bar" id="photo-progress" hidden>
              <span id="photo-progress-fill" style="width:0%"></span>
              <em id="photo-progress-text">0%</em>
            </div>
          </div>

          <form class="create-form" id="photo-form" novalidate>
            <label class="field">
              <span>Caption <em>(optional)</em> — #hashtags and @mentions are linked</span>
              <textarea id="photo-caption" rows="3" maxlength="1000" placeholder="Add a caption… e.g. Sunday service 🙏 #gospel #zambia"></textarea>
              <small class="field-hint"><span id="photo-caption-count">0</span>/1000</small>
            </label>
            <label class="field-check">
              <input type="checkbox" id="photo-as-story" />
              <span>Also put the first photo in my <strong>story</strong> (gone after 24 hours)</span>
            </label>
            <div class="create-actions">
              <button class="btn btn-primary btn-block" type="submit" id="photo-post-btn" disabled>Post photos</button>
              <p class="fine-print">By posting you confirm you own the rights to these photos.</p>
            </div>
          </form>
        </div><!-- /photo-pane -->

        <div id="text-pane" ${initialTab === "text" ? "" : "hidden"}>
          <form class="create-form" id="text-form" novalidate>
            <label class="field">
              <span>What's on your mind? <em>— #hashtags and @mentions are linked</em></span>
              <textarea id="text-caption" rows="6" maxlength="1000" placeholder="Share an update, ask a question, start a conversation… e.g. Who's going to the Lusaka show on Saturday? #zambia"></textarea>
              <small class="field-hint"><span id="text-caption-count">0</span>/1000</small>
            </label>
            <div class="create-actions">
              <button class="btn btn-primary btn-block" type="submit" id="text-post-btn" disabled>Post</button>
              <p class="fine-print">Text posts carry no media or sound — they show up in the feed alongside videos and photo sets.</p>
            </div>
          </form>
        </div><!-- /text-pane -->
      </div>

      <aside class="create-side">
        <div class="panel">
          <h2 class="panel-title">Tips for great videos</h2>
          <ul class="tip-list">
            <li>📱 Hold phone vertically (9:16)</li>
            <li>💡 Good lighting, clear audio</li>
            <li>🎵 Use free sounds from library</li>
            <li>#️⃣ Add 2-3 hashtags, not 20</li>
            <li>⏱️ Keep it 15-60s for best reach</li>
            <li>📡 Or go live for real-time chat & gifts</li>
          </ul>
        </div>
        <div class="panel">
          <h2 class="panel-title">More ways to post</h2>
          <ul class="tip-list">
            <li>🎬 Vertical short videos</li>
            <li>🖼️ Photo sets (up to 6)</li>
            <li>✍️ Text posts (updates, questions, threads)</li>
            <li>📡 Live streams with gifts & stickers</li>
          </ul>
          <a class="btn btn-outline btn-sm btn-block" href="#/live/go" style="margin-top:10px">Go live instead</a>
        </div>
      </aside>
    </div>

    <div class="sounds-modal-host" id="sounds-host" hidden></div>
  `;

  function updatePostButton() {
    const btn = document.querySelector("#post-btn");
    if (!btn) return;
    const hasVideo = !!(selectedFile || recordedBlob);
    btn.disabled = !hasVideo;
    btn.textContent = hasVideo ? "Post video" : "Choose a video first";
  }

  function formatTime(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2, "0");
    const s = Math.floor(sec % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  async function handleFile(file) {
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      toast("Please select a video file", "error");
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      toast("Video must be under 100MB", "error");
      return;
    }
    selectedFile = file;
    recordedBlob = null;

    const previewWrap = document.querySelector("#preview-wrap");
    const previewVideo = document.querySelector("#preview-video");
    const dropInner = document.querySelector("#drop-inner");
    const durationBadge = document.querySelector("#preview-duration");

    const url = URL.createObjectURL(file);
    previewVideo.src = url;
    previewWrap.hidden = false;
    dropInner.hidden = true;
    document.querySelector("#record-ui").hidden = true;

    previewVideo.onloadedmetadata = () => {
      durationBadge.textContent = formatTime(previewVideo.duration || 0);
      if (previewVideo.duration > 180) {
        toast("Video longer than 3 minutes — consider trimming", "info", 4000);
      }
    };

    updatePostButton();
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 1280 } },
        audio: true,
      });
      recordingStream = stream;
      const live = document.querySelector("#record-live");
      const recordUI = document.querySelector("#record-ui");
      const dropInner = document.querySelector("#drop-inner");
      const previewWrap = document.querySelector("#preview-wrap");

      live.srcObject = stream;
      recordUI.hidden = false;
      dropInner.hidden = true;
      previewWrap.hidden = true;

      recordingChunks = [];
      mediaRecorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9" });
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordingChunks.push(e.data);
      };
      mediaRecorder.onstop = () => {
        const blob = new Blob(recordingChunks, { type: "video/webm" });
        recordedBlob = blob;
        selectedFile = null;
        const previewWrap = document.querySelector("#preview-wrap");
        const previewVideo = document.querySelector("#preview-video");
        const url = URL.createObjectURL(blob);
        previewVideo.src = url;
        previewWrap.hidden = false;
        recordUI.hidden = true;
        document.querySelector("#drop-inner").hidden = true;
        document.querySelector("#preview-duration").textContent = formatTime(previewVideo.duration || 0);
        updatePostButton();
        // stop tracks
        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorder.start();
      isRecording = true;
      document.querySelector("#record-dot").classList.add("is-recording");
      let seconds = 0;
      const timer = document.querySelector("#record-timer");
      const interval = setInterval(() => {
        if (!isRecording) {
          clearInterval(interval);
          return;
        }
        seconds += 1;
        timer.textContent = formatTime(seconds);
        if (seconds >= 180) {
          stopRecording();
          clearInterval(interval);
        }
      }, 1000);
      document.querySelector("#stop-record").onclick = () => {
        stopRecording();
        clearInterval(interval);
      };
      document.querySelector("#cancel-record").onclick = () => {
        cancelRecording();
        clearInterval(interval);
      };
    } catch (e) {
      console.warn("[xacheus] camera", e);
      toast("Could not access camera/microphone. Check permissions.", "error", 5000);
    }
  }

  function stopRecording() {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
      isRecording = false;
      document.querySelector("#record-dot").classList.remove("is-recording");
    }
  }

  function cancelRecording() {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
      isRecording = false;
    }
    if (recordingStream) {
      recordingStream.getTracks().forEach((t) => t.stop());
    }
    document.querySelector("#record-ui").hidden = true;
    document.querySelector("#drop-inner").hidden = false;
    document.querySelector("#preview-wrap").hidden = true;
    recordedBlob = null;
    selectedFile = null;
    updatePostButton();
  }

  async function renderSoundsMini() {
    const host = document.querySelector("#sounds-mini");
    if (!host) return;
    let picks = [];
    try {
      picks = (await getSounds({ limitCount: 6 })).slice(0, 6);
    } catch (err) {
      console.warn("[xacheus] sound suggestions", err);
    }
    if (!picks.length) {
      host.innerHTML = `<p class="field-hint">No sounds in the library yet. Open <a class="link" href="#/music?tab=discover">Music → Discover</a> to import a licensed track, or upload your own.</p>`;
      return;
    }
    host.innerHTML = picks
      .map(
        (s) => `
      <button class="sound-chip" type="button" data-sound-id="${esc(s.id)}">
        <span class="chip-icon">🎵</span>
        <span>${esc(s.title)}</span>
        <em>${esc(s.genre || "")}${s.duration ? ` · ${formatSoundDuration(s.duration)}` : ""}</em>
      </button>`
      )
      .join("");

    host.querySelectorAll("[data-sound-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const sound =
          picks.find((x) => x.id === btn.dataset.soundId) || (await getSound(btn.dataset.soundId));
        if (sound) selectSound(sound);
      });
    });
  }

  function selectSound(sound) {
    selectedSound = sound;
    const sel = document.querySelector("#sound-selected");
    const clearBtn = document.querySelector("#clear-sound");
    const licence = sound.licenceUrl ? describeLicence(sound.licenceUrl) : null;
    sel.innerHTML = `
      <span class="sound-icon">🎵</span>
      <span class="sound-info">
        <strong>${esc(sound.title)}</strong>
        <em>${esc(sound.artist || "Unknown artist")} · ${esc(sound.genre || "")}${sound.duration ? ` · ${formatSoundDuration(sound.duration)}` : ""}</em>
        <small>${sound.external
          ? `Licensed · ${esc(licence?.label || "see source")} · credit is added to your post automatically`
          : sound.artistUsername
            ? `Sound by @${esc(sound.artistUsername)} — credit them when you reuse it`
            : "Member upload"}</small>
      </span>
      <button class="icon-btn" type="button" data-act="preview-sound" title="Preview in the player">▶</button>
    `;
    sel.querySelector("[data-act='preview-sound']").addEventListener("click", () => {
      if (isCurrentTrack(sound.id)) toggleTrack(sound);
      else playQueue([sound]);
    });
    clearBtn.hidden = false;
    const note = document.querySelector("#sound-licence-note");
    if (note) {
      note.hidden = !sound.external;
      note.textContent = sound.external
        ? `“${sound.title}” streams from its original source and keeps its licence line (${licence?.label || "see source"}). `
        : "";
    }
  }

  function clearSound() {
    selectedSound = null;
    document.querySelector("#sound-selected").innerHTML = `<span class="sound-none">Original audio (video's own sound)</span>`;
    document.querySelector("#clear-sound").hidden = true;
  }

  function openSoundsModal() {
    const host = document.querySelector("#sounds-host");
    host.hidden = false;
    host.innerHTML = `
      <div class="modal-backdrop is-in" role="presentation">
        <div class="modal modal-lg" role="dialog" aria-modal="true">
          <header class="modal-head">
            <h2>Choose a sound</h2>
            <button class="icon-btn" type="button" data-act="close-sounds">✕</button>
          </header>
          <div class="modal-body">
            <form class="discover-search" id="picker-search">
              <input type="search" id="picker-q" placeholder="Search free songs, artists, genres…" autocomplete="off" />
              <button class="btn btn-primary btn-sm" type="submit">Search</button>
            </form>
            <div class="genre-chips picker-genres">
              ${getSoundGenres()
                .slice(0, 10)
                .map(
                  (g, i) =>
                    `<button class="genre-chip ${i === 0 ? "is-active" : ""}" type="button" data-pg="${esc(g)}">${g === "all" ? "All" : esc(g)}</button>`
                )
                .join("")}
            </div>
            <div class="sounds-tabs">
              <button class="tab is-active" data-tab="library">Library</button>
              <button class="tab" data-tab="catalogue">Licensed catalogue</button>
              <button class="tab" data-tab="original">Your own</button>
            </div>
            <div class="sounds-list" id="sounds-list"><div class="loader-row"><span class="spinner"></span> Loading…</div></div>
            <p class="field-hint" style="margin-top:10px"><a class="link" href="#/sounds">Browse full library →</a></p>
          </div>
        </div>
      </div>
    `;

    const list = host.querySelector("#sounds-list");
    let currentTab = "free";
    let currentGenre = "all";
    let cache = [];

    function paint(sounds) {
      cache = sounds;
      if (!sounds.length) {
        list.innerHTML = `<p class="panel-empty">No sounds match. Try another search, or <a class="link" href="#/music?tab=uploads">upload your own</a>.</p>`;
        return;
      }
      list.innerHTML = sounds
        .map(
          (s) => `
        <div class="sound-row" data-sound-id="${esc(s.id)}">
          <div class="sound-row-main">
            <span class="sound-cover">🎵</span>
            <span class="sound-meta">
              <strong>${esc(s.title)}</strong>
              <em>${esc(s.artist || "")} · ${esc(s.genre || "")}${s.duration ? ` · ${formatSoundDuration(s.duration)}` : ""} · used ${s.useCount || 0}</em>
              ${s.licenceUrl ? `<small>${esc(describeLicence(s.licenceUrl).label)}</small>` : ""}
            </span>
          </div>
          <button class="icon-btn" type="button" data-act="preview" title="Preview in the player">▶</button>
          <button class="btn btn-primary btn-sm" type="button" data-act="use-sound">Use</button>
        </div>`
        )
        .join("");

      list.querySelectorAll("[data-act='preview']").forEach((btn) => {
        btn.addEventListener("click", () => {
          const row = btn.closest(".sound-row");
          const sound = cache.find((x) => x.id === row.dataset.soundId);
          if (!sound) return;
          if (isCurrentTrack(sound.id)) toggleTrack(sound);
          else playQueue(cache, cache.indexOf(sound));
        });
      });

      list.querySelectorAll("[data-act='use-sound']").forEach((btn) => {
        btn.addEventListener("click", () => {
          const row = btn.closest(".sound-row");
          const sound = cache.find((x) => x.id === row.dataset.soundId);
          if (sound) {
            selectSound(sound);
            closeSoundsModal();
          }
        });
      });
    }

    async function loadTab(tab, query = "") {
      currentTab = tab;
      host.querySelectorAll(".sounds-tabs .tab").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === tab));
      list.innerHTML = `<div class="loader-row"><span class="spinner"></span> Loading…</div>`;

      if (tab === "catalogue") {
        await loadCatalogue(query);
        return;
      }

      let sounds = [];
      try {
        if (query) {
          sounds = await searchSounds(query, {
            limitCount: 40,
            genre: currentGenre === "all" || currentGenre === "original" ? "" : currentGenre,
          });
        } else if (tab === "original") {
          sounds = await getSounds({ onlyOriginal: true, limitCount: 40 });
        } else {
          sounds = await getSounds({ limitCount: 40 });
        }
      } catch (err) {
        list.innerHTML = `<p class="panel-empty">${esc(err?.message || "Couldn't read the sound library right now.")}</p>`;
        return;
      }
      if (currentGenre && currentGenre !== "all") {
        if (currentGenre === "original") sounds = sounds.filter((s) => s.isOriginal);
        else sounds = sounds.filter((s) => String(s.genre || "").toLowerCase() === currentGenre);
      }
      paint(sounds);
    }

    /**
     * Live search of the licensed catalogue. Choosing a track imports it into
     * `sounds` first (so the post references a real document with a licence),
     * then selects it. Tracks whose licence forbids reuse are not offered.
     */
    async function loadCatalogue(query) {
      try {
        const { items } = await searchCatalogue({ text: query, rows: 12, licenceOnly: true });
        if (!items.length) {
          list.innerHTML = `<p class="panel-empty">No open-licence releases matched${query ? ` “${esc(query)}”` : ""}. Pick a release, then “Show tracks”, then Use.</p>`;
          return;
        }
        list.innerHTML = items
          .map(
            (item) => `
            <div class="sound-row" data-release-row="${esc(item.identifier)}">
              <div class="sound-row-main">
                <span class="sound-cover"><img src="${esc(item.artwork)}" alt="" loading="lazy" /></span>
                <span class="sound-meta">
                  <strong>${esc(item.title)}</strong>
                  <em>${esc(item.creator || "Unknown")} · ${esc(describeLicence(item.licenseUrl).label)}</em>
                </span>
              </div>
              <button class="btn btn-outline btn-sm" type="button" data-act="expand-release">Show tracks</button>
            </div>`
          )
          .join("");
        list.querySelectorAll("[data-act='expand-release']").forEach((btn) => {
          btn.addEventListener("click", async () => {
            const row = btn.closest("[data-release-row]");
            const identifier = row.dataset.releaseRow;
            const item = items.find((x) => x.identifier === identifier);
            btn.disabled = true;
            btn.textContent = "Reading…";
            let tracks = [];
            try {
              tracks = (await loadItemTracks(identifier)).tracks;
            } catch (err) {
              btn.disabled = false;
              btn.textContent = "Show tracks";
              toast(err?.message || "The archive didn't return any files", "error");
              return;
            }
            btn.disabled = false;
            btn.textContent = "Hide tracks";
            let host2 = row.querySelector("[data-release-tracks]");
            if (!host2) {
              host2 = document.createElement("div");
              host2.className = "release-tracks is-open";
              host2.dataset.releaseTracks = "";
              row.appendChild(host2);
            } else if (!host2.hidden) {
              host2.hidden = true;
              return;
            }
            host2.hidden = false;
            if (!tracks.length) {
              host2.innerHTML = `<p class="panel-empty">This release has no MP3 files, so there's nothing to attach.</p>`;
              return;
            }
            host2.innerHTML = tracks
              .map(
                (t, i) => `
                <div class="track-row is-compact">
                  <button class="sound-play" type="button" data-cat-play="${i}" aria-label="Play ${esc(t.title)}"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>
                  <span class="track-main"><strong>${esc(t.title)}</strong><em>${esc(t.artist)}</em></span>
                  <span class="track-actions"><button class="btn btn-sm btn-primary" type="button" data-cat-use="${i}">Use</button></span>
                </div>`
              )
              .join("");
            host2.querySelectorAll("[data-cat-play]").forEach((b) => {
              b.addEventListener("click", () => playQueue(tracks, Number(b.dataset.catPlay) || 0));
            });
            host2.querySelectorAll("[data-cat-use]").forEach((b) => {
              b.addEventListener("click", async () => {
                const track = tracks[Number(b.dataset.catUse) || 0];
                if (!track) return;
                if (!describeLicence(track.licenseUrl).reusable) {
                  toast("That track's licence doesn't allow reuse in a post.", "error", 4200);
                  return;
                }
                b.disabled = true;
                try {
                  const sound = await attachCatalogueSound(ctx.state.profile, track);
                  selectSound(sound);
                  closeSoundsModal();
                  toast("Track attached — its licence and credit travel with the post", "success", 3200);
                } catch (err) {
                  toast(err?.message || "Could not attach that track", "error");
                } finally {
                  b.disabled = false;
                }
                void item;
              });
            });
          });
        });
      } catch (err) {
        list.innerHTML = `<div class="panel error-panel"><strong>Catalogue unavailable</strong><p>${esc(err?.message || "The music catalogue could not be reached from this network.")}</p><p class="muted">Nothing is faked here: pick a sound from the Library tab instead, or try again in a moment.</p></div>`;
      }
    }

    host.querySelectorAll(".sounds-tabs .tab").forEach((tab) => {
      tab.addEventListener("click", () => loadTab(tab.dataset.tab, host.querySelector("#picker-q").value.trim()));
    });
    host.querySelectorAll("[data-pg]").forEach((chip) => {
      chip.addEventListener("click", () => {
        currentGenre = chip.dataset.pg;
        host.querySelectorAll("[data-pg]").forEach((c) => c.classList.toggle("is-active", c === chip));
        loadTab(currentTab, host.querySelector("#picker-q").value.trim());
      });
    });
    host.querySelector("#picker-search").addEventListener("submit", (e) => {
      e.preventDefault();
      loadTab(currentTab, host.querySelector("#picker-q").value.trim());
    });

    host.querySelector("[data-act='close-sounds']").addEventListener("click", closeSoundsModal);
    host.querySelector(".modal-backdrop").addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeSoundsModal();
    });

    function closeSoundsModal() {
      host.hidden = true;
      host.innerHTML = "";
    }

    loadTab("free");
  }

  return {
    html,
    title: "Create",
    mount(root) {
      renderSoundsMini();

      // Pre-select sound from #/create?sound=id (from library "Use" buttons)
      if (initialSoundId) {
        getSound(initialSoundId).then((s) => {
          if (s) selectSound(s);
        });
      }

      const videoInput = root.querySelector("#video-input");
      const dropZone = root.querySelector("#drop-zone");

      videoInput.addEventListener("change", () => {
        const file = videoInput.files?.[0];
        if (file) handleFile(file);
      });

      dropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropZone.classList.add("is-drag");
      });
      dropZone.addEventListener("dragleave", () => dropZone.classList.remove("is-drag"));
      dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropZone.classList.remove("is-drag");
        const file = e.dataTransfer.files?.[0];
        if (file) handleFile(file);
      });

      root.querySelector("#record-btn").addEventListener("click", startRecording);
      root.querySelector("#remove-video").addEventListener("click", () => {
        selectedFile = null;
        recordedBlob = null;
        root.querySelector("#preview-wrap").hidden = true;
        root.querySelector("#drop-inner").hidden = false;
        root.querySelector("#video-input").value = "";
        updatePostButton();
      });

      root.querySelector("#choose-sound").addEventListener("click", openSoundsModal);
      root.querySelector("#clear-sound").addEventListener("click", clearSound);

      const caption = root.querySelector("#caption");
      const count = root.querySelector("#caption-count");
      caption.addEventListener("input", () => {
        count.textContent = caption.value.length;
      });

      /* ---------------- photo posts ---------------- */

      root.querySelectorAll(".create-tabs .tab").forEach((tab) => {
        tab.addEventListener("click", () => {
          const kind = tab.dataset.ctype;
          root.querySelectorAll(".create-tabs .tab").forEach((t) => t.classList.toggle("is-active", t === tab));
          root.querySelector("#video-pane").hidden = kind !== "video";
          root.querySelector("#photo-pane").hidden = kind !== "photo";
          root.querySelector("#text-pane").hidden = kind !== "text";
        });
      });

      function renderPhotoPreviews() {
        const host = root.querySelector("#photo-previews");
        const inner = root.querySelector("#photo-drop-inner");
        host.innerHTML = photoUrls
          .map(
            (url, i) => `
          <div class="photo-preview">
            <img src="${url}" alt="" />
            <button class="icon-btn" type="button" data-remove-photo="${i}" aria-label="Remove photo">✕</button>
          </div>`
          )
          .join("");
        inner.hidden = photoFiles.length > 0;
        const btn = root.querySelector("#photo-post-btn");
        btn.disabled = photoFiles.length === 0;
        btn.textContent = photoFiles.length ? `Post ${photoFiles.length} photo${photoFiles.length > 1 ? "s" : ""}` : "Choose photos first";
      }

      root.querySelector("#photo-input").addEventListener("change", (event) => {
        const files = [...event.target.files];
        for (const file of files) {
          if (photoFiles.length >= 6) {
            toast("Photo posts hold up to 6 photos", "info");
            break;
          }
          if (!file.type.startsWith("image/")) {
            toast(`${file.name} isn't an image`, "error");
            continue;
          }
          if (file.size > 10 * 1024 * 1024) {
            toast(`${file.name} is over 10MB`, "error");
            continue;
          }
          photoFiles.push(file);
          photoUrls.push(URL.createObjectURL(file));
        }
        event.target.value = "";
        renderPhotoPreviews();
      });

      root.querySelector("#photo-previews").addEventListener("click", (event) => {
        const idx = event.target.closest("[data-remove-photo]")?.dataset.removePhoto;
        if (idx === undefined) return;
        const i = Number(idx);
        URL.revokeObjectURL(photoUrls[i]);
        photoFiles.splice(i, 1);
        photoUrls.splice(i, 1);
        renderPhotoPreviews();
      });

      const photoCaption = root.querySelector("#photo-caption");
      photoCaption.addEventListener("input", () => {
        root.querySelector("#photo-caption-count").textContent = photoCaption.value.length;
      });

      root.querySelector("#photo-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!ctx.state.profile) return ctx.requireAuth();
        if (!photoFiles.length) return toast("Choose photos first", "error");

        const btn = root.querySelector("#photo-post-btn");
        const bar = root.querySelector("#photo-progress");
        const fill = root.querySelector("#photo-progress-fill");
        const text = root.querySelector("#photo-progress-text");
        btn.disabled = true;
        bar.hidden = false;
        fill.style.width = "0%";
        text.textContent = "0%";

        try {
          const urls = [];
          for (let i = 0; i < photoFiles.length; i += 1) {
            const url = await uploadImage(photoFiles[i], {
              strict: true,
              onProgress: (p) => {
                const overall = Math.round(((i + p / 100) / photoFiles.length) * 100);
                fill.style.width = `${overall}%`;
                text.textContent = `${overall}%`;
              },
            });
            if (!url || url.startsWith("blob:")) throw new Error("Photo upload failed. Please try again.");
            urls.push(url);
          }

          btn.textContent = "Creating post…";
          await createVideo(ctx.state.profile, {
            mediaType: "photo",
            images: urls,
            caption: photoCaption.value.trim(),
          });

          const storyToggle = root.querySelector("#photo-as-story");
          if (storyToggle?.checked) {
            storyToggle.checked = false;
            storyToggle.disabled = true;
            try {
              const storyUpload = await uploadStoryMedia(photoFiles[0]);
              await addStory(ctx.state.profile, { url: storyUpload.url, storagePath: storyUpload.path, kind: "photo" });
              toast("Photo post published — and it's in your story", "success");
            } catch (err) {
              toast(`Story failed: ${err?.message || "try again"}`, "error", 4200);
            } finally {
              storyToggle.disabled = false;
            }
          } else {
            toast("Photo post published!", "success");
          }
          window.dispatchEvent(new Event("xacheus:feed-refresh"));
          ctx.navigate("#/home");
        } catch (err) {
          console.warn("[xacheus] photo post failed", err);
          toast(err?.message || "Couldn't post photos.", "error", 6000);
          btn.disabled = false;
          bar.hidden = true;
        }
      });

      root.querySelector("#create-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!ctx.state.profile) return ctx.requireAuth();
        const file = selectedFile || recordedBlob;
        if (!file) return toast("Choose a video first", "error");

        const postBtn = root.querySelector("#post-btn");
        postBtn.disabled = true;
        postBtn.textContent = "Uploading…";

        const progressBar = root.querySelector("#upload-progress");
        const progressFill = root.querySelector("#upload-progress-fill");
        const progressText = root.querySelector("#upload-progress-text");
        progressBar.hidden = false;

        try {
          const result = await uploadVideo(file instanceof Blob && !(file instanceof File) ? new File([file], "recorded.webm", { type: "video/webm" }) : file, {
            onProgress: (p) => {
              progressFill.style.width = `${p}%`;
              progressText.textContent = `${p}%`;
            },
          });

          postBtn.textContent = "Creating post…";

          const captionText = caption.value.trim();
          await createVideo(ctx.state.profile, {
            videoUrl: result.url,
            thumbnailUrl: result.thumbnailUrl,
            caption: captionText,
            soundId: selectedSound?.id || null,
            soundTitle: selectedSound?.title || "",
            soundUrl: selectedSound?.audioUrl || null,
            duration: result.duration,
            width: result.width,
            height: result.height,
            storagePath: result.path,
          });

          const storyToggle = root.querySelector("#video-as-story");
          if (storyToggle?.checked) {
            storyToggle.checked = false;
            storyToggle.disabled = true;
            try {
              const storyUpload = await uploadStoryMedia(file);
              await addStory(ctx.state.profile, {
                url: storyUpload.url,
                storagePath: storyUpload.path,
                kind: "video",
                duration: storyUpload.duration || result.duration || 0,
              });
              toast("Video posted — and it's in your story", "success");
            } catch (err) {
              toast(`Story failed: ${err?.message || "try again"}`, "error", 4200);
            } finally {
              storyToggle.disabled = false;
            }
          } else {
            toast("Video posted!", "success");
          }
          window.dispatchEvent(new Event("xacheus:feed-refresh"));
          ctx.navigate("#/home");
        } catch (err) {
          console.warn("[xacheus] create video", err);
          toast(err?.message || "Failed to upload video. Please try again.", "error", 6000);
          postBtn.disabled = false;
          postBtn.textContent = "Post video";
          progressBar.hidden = true;
        }
      });

      /* ---------------- text posts ---------------- */

      const textField = root.querySelector("#text-caption");
      const textCount = root.querySelector("#text-caption-count");
      const textBtn = root.querySelector("#text-post-btn");
      textField.addEventListener("input", () => {
        const len = textField.value.length;
        textCount.textContent = len;
        textBtn.disabled = textField.value.trim().length === 0;
      });

      root.querySelector("#text-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!ctx.state.profile) return ctx.requireAuth();
        const body = textField.value.trim();
        if (!body) return toast("Write something first", "error");
        textBtn.disabled = true;
        textBtn.textContent = "Posting…";
        try {
          await createVideo(ctx.state.profile, { mediaType: "text", caption: body });
          toast("Posted", "success");
          textField.value = "";
          textCount.textContent = "0";
          window.dispatchEvent(new Event("xacheus:feed-refresh"));
          ctx.navigate("#/home");
        } catch (err) {
          console.warn("[xacheus] create text post", err);
          toast(err?.message || "Could not post that", "error", 6000);
          textBtn.disabled = false;
          textBtn.textContent = "Post";
        }
      });

      updatePostButton();
    },
    destroy() {
      if (recordingStream) recordingStream.getTracks().forEach((t) => t.stop());
      if (mediaRecorder && isRecording) mediaRecorder.stop();
      photoUrls.forEach((url) => URL.revokeObjectURL(url));
    },
  };
}
