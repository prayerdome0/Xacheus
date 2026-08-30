/**
 * Xacheus — global music player.
 *
 * One `<audio>` element, mounted outside the router view so playback survives
 * navigation (and the dock keeps its position while you scroll profiles, the
 * feed or messages). Every control does something real:
 *
 *   play/pause, seek (drag or click), next/prev, volume + mute, shuffle,
 *   repeat (off/all/one), queue, Media Session (OS media keys + lock screen),
 *   keyboard shortcuts, and a play event written to Firestore once a track has
 *   been listened to for 20 seconds.
 *
 * State that should come back after a refresh (volume, repeat mode, the last
 * track) lives in localStorage; everything user-visible that counts as *data*
 * (use counts, favourites, play counts) lives in Firestore.
 */

import { esc, toast, timeAgo } from "./ui.js";
import { attributionLine, CATALOGUE_PROVIDER } from "./music.js";
import { recordSoundPlay } from "./data.js";

const DOCK_ID = "player-dock";
const LS_KEYS = {
  volume: "xacheus.player.volume",
  muted: "xacheus.player.muted",
  repeat: "xacheus.player.repeat",
  last: "xacheus.player.last",
  queue: "xacheus.player.queue",
};

const listeners = new Set();
const LS_TTL = 60 * 60 * 1000 * 24 * 7;

let audio = null;
let els = {};
let queue = [];
let index = -1;
let playing = false;
let loadingId = "";
let shuffle = false;
let order = [];
let repeatMode = localStorage.getItem(LS_KEYS.repeat) || "off";
let volume = clamp01(Number(localStorage.getItem(LS_KEYS.volume) ?? 0.85));
let muted = localStorage.getItem(LS_KEYS.muted) === "1";
let startedAt = 0;
let countedPlay = false;
let dragProgress = false;
let lastErrorToast = 0;

function clamp01(n) {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

/* ------------------------------------------------------------------ */
/* subscription                                                       */
/* ------------------------------------------------------------------ */

export function onPlayerChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function snapshot() {
  const track = queue[index] || null;
  return {
    track,
    queue,
    index,
    playing,
    loading: Boolean(loadingId),
    volume,
    muted,
    shuffle,
    repeat: repeatMode,
    currentTime: audio ? audio.currentTime : 0,
    duration: audio?.duration && Number.isFinite(audio.duration) ? audio.duration : track?.duration || 0,
    error: audio?.error ? "This recording couldn't be streamed right now." : "",
  };
}

function emit() {
  const state = snapshot();
  listeners.forEach((fn) => {
    try {
      fn(state);
    } catch (err) {
      console.warn("[player] listener failed", err);
    }
  });
}

/** App-wide options (data saver, autoplay previews) pushed by app.js. */
let options = { dataSaver: false };
export function setPlayerOptions(next = {}) {
  options = { ...options, ...next };
  if (audio && options.dataSaver) audio.preload = "none";
  else if (audio) audio.preload = "metadata";
}
export function getPlayerOptions() {
  return { ...options };
}

function announce(kind, track) {
  window.dispatchEvent(
    new CustomEvent("xacheus:nowplaying", {
      detail: { kind, track: track ? { id: track.id, title: track.title, artist: track.artist } : null },
    })
  );
}

/* ------------------------------------------------------------------ */
/* mount                                                             */
/* ------------------------------------------------------------------ */

export function mountPlayer() {
  if (document.getElementById(DOCK_ID)) {
    bindShortcuts();
    return;
  }

  audio = new Audio();
  audio.preload = "metadata";
  audio.volume = muted ? 0 : volume;

  const host = document.createElement("div");
  host.id = DOCK_ID;
  host.innerHTML = dockHtml();
  document.body.appendChild(host);

  els = {
    root: host,
    art: host.querySelector("[data-p=art]"),
    title: host.querySelector("[data-p=title]"),
    artist: host.querySelector("[data-p=artist]"),
    licence: host.querySelector("[data-p=licence]"),
    play: host.querySelector("[data-p=play]"),
    prev: host.querySelector("[data-p=prev]"),
    next: host.querySelector("[data-p=next]"),
    shuffleBtn: host.querySelector("[data-p=shuffle]"),
    repeatBtn: host.querySelector("[data-p=repeat]"),
    progress: host.querySelector("[data-p=progress]"),
    progressFill: host.querySelector("[data-p=progress-fill]"),
    timeNow: host.querySelector("[data-p=time-now]"),
    timeLeft: host.querySelector("[data-p=time-left]"),
    volumeSlider: host.querySelector("[data-p=volume]"),
    mute: host.querySelector("[data-p=mute]"),
    queueBtn: host.querySelector("[data-p=queue]"),
    queuePanel: host.querySelector("[data-p=queue-panel]"),
    close: host.querySelector("[data-p=close]"),
  };

  els.play.addEventListener("click", toggle);
  els.prev.addEventListener("click", () => skip(-1));
  els.next.addEventListener("click", () => skip(1));
  els.shuffleBtn.addEventListener("click", toggleShuffle);
  els.repeatBtn.addEventListener("click", cycleRepeat);
  els.mute.addEventListener("click", toggleMute);
  els.volumeSlider.addEventListener("input", (e) => setVolume(Number(e.target.value) / 100));
  els.queueBtn.addEventListener("click", toggleQueuePanel);
  els.close.addEventListener("click", stop);
  els.queuePanel.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-qi]");
    if (!btn) return;
    e.stopPropagation();
    playAt(Number(btn.dataset.qi));
  });

  bindSeek();

  audio.addEventListener("timeupdate", onTimeUpdate);
  audio.addEventListener("loadedmetadata", onTimeUpdate);
  audio.addEventListener("durationchange", onTimeUpdate);
  audio.addEventListener("play", () => {
    playing = true;
    startedAt = Date.now();
    render();
  });
  audio.addEventListener("pause", () => {
    playing = false;
    render();
  });
  audio.addEventListener("ended", onEnded);
  audio.addEventListener("error", () => {
    playing = false;
    loadingId = "";
    if (Date.now() - lastErrorToast > 8000) {
      lastErrorToast = Date.now();
      const track = queue[index];
      toast(`Can't stream ${track?.title ? `"${track.title}"` : "this track"} from ${CATALOGUE_PROVIDER.name}. It may be rate-limiting us — try again shortly.`, "error");
    }
    render();
  });

  els.volumeSlider.value = String(Math.round(volume * 100));
  bindShortcuts();
  restoreLastSession();
  render();
}

function dockHtml() {
  return `
  <div class="player-inner" role="region" aria-label="Music player">
    <button class="player-art" type="button" data-p="art-link" title="Open the sound page">
      <span class="player-art-img" data-p="art"></span>
      <span class="player-eq" data-p="eq" hidden><i></i><i></i><i></i><i></i></span>
    </button>
    <div class="player-meta">
      <strong class="player-title" data-p="title">Nothing playing</strong>
      <span class="player-artist" data-p="artist">Pick a track from Music, a post or a profile</span>
      <a class="player-licence" data-p="licence" hidden target="_blank" rel="noopener noreferrer"></a>
    </div>
    <div class="player-controls">
      <button class="icon-btn" type="button" data-p="prev" title="Previous (Shift + ←)" aria-label="Previous track">${icon("prev")}</button>
      <button class="player-play" type="button" data-p="play" title="Play / pause (Space)" aria-label="Play">${icon("play")}</button>
      <button class="icon-btn" type="button" data-p="next" title="Next (Shift + →)" aria-label="Next track">${icon("next")}</button>
    </div>
    <div class="player-progress">
      <span class="player-time" data-p="time-now">0:00</span>
      <div class="player-bar" data-p="progress" role="slider" tabindex="0" aria-label="Seek" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <div class="player-bar-fill" data-p="progress-fill"><span></span></div>
      </div>
      <span class="player-time" data-p="time-left">0:00</span>
    </div>
    <div class="player-extra">
      <button class="icon-btn ghost" type="button" data-p="shuffle" title="Shuffle" aria-pressed="false">${icon("shuffle")}</button>
      <button class="icon-btn ghost" type="button" data-p="repeat" title="Repeat: off" aria-pressed="false">${icon("repeat")}</button>
      <div class="player-volume">
        <button class="icon-btn ghost" type="button" data-p="mute" title="Mute" aria-label="Mute">${icon("volume")}</button>
        <input type="range" min="0" max="100" step="1" data-p="volume" aria-label="Volume" />
      </div>
      <button class="icon-btn ghost" type="button" data-p="queue" title="Queue" aria-expanded="false">${icon("queue")}</button>
      <button class="icon-btn ghost" type="button" data-p="close" title="Close player" aria-label="Close player">${icon("close")}</button>
    </div>
    <div class="player-queue" data-p="queue-panel" hidden></div>
  </div>`;
}

function icon(name) {
  const paths = {
    play: '<path d="M8 5.5v13l11-6.5z"/>',
    pause: '<path d="M9 5h3.2v14H9zM15.8 5H19v14h-3.2z"/>',
    prev: '<path d="M17.5 5.5v13L8.5 12zM7 5h2.2v14H7z"/>',
    next: '<path d="M6.5 5.5v13l9-6.5zM17.8 5H20v14h-2.2z"/>',
    shuffle:
      '<path d="M3 6.5h3.3l3 4.2-1 1.4L4.6 8H3zM14.6 6.5H18a2 2 0 0 1 2 2v1.2h-2V8.5h-3.1l-1.2 1.7-1.6-1.1zM3 15.5h1.6l7.1 5h3.3V18h2v2.5A2 2 0 0 1 15 22.5h-3.6L4.4 17.5H3z"/>',
    repeat: '<path d="M7 7h10a4 4 0 0 1 4 4v1h-2v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-1.6 3.2L3.7 14A4 4 0 0 1 7 5zM17 17H7a4 4 0 0 1-4-4V12h2v1a2 2 0 0 0 2 2h10a2 2 0 0 0 1.6-3.2l1.7-1.3A4 4 0 0 1 17 19z"/>',
    repeatOne:
      '<path d="M7 7h10a4 4 0 0 1 4 4v1h-2v-1a2 2 0 0 0-2-2H7a2 2 0 0 0-1.6 3.2L3.7 14A4 4 0 0 1 7 5zM17 17H7a4 4 0 0 1-4-4V12h2v1a2 2 0 0 0 2 2h10a2 2 0 0 0 1.6-3.2l1.7-1.3A4 4 0 0 1 17 19zM12.6 9.5h1.5v6h-1.5l-1.6-1.2v-1.4l1.4 1z"/>',
    volume: '<path d="M4 9.5h3l4-3.5v13l-4-3.5H4zM13.5 8.7a4.5 4.5 0 0 1 0 7.6v-2a2.6 2.6 0 0 0 0-3.6zM16 6.2a7.5 7.5 0 0 1 0 12.6v-2a5.5 5.5 0 0 0 0-8.6z"/><path d="M4 9.5h3l4-3.5v13l-4-3.5H4z" opacity=".25"/>',
    mute: '<path d="M4 9.5h3l4-3.5v13l-4-3.5H4z"/><path d="m14 9.5 5 5m0-5-5 5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
    queue: '<path d="M4 6h11v2H4zM4 11h11v2H4zM4 16h7v2H4zM17.5 9.5l3 2.5-3 2.5z"/>',
    close: '<path d="m7 8.4 1.4-1.4L13 11.6l4.6-4.6L19 8.4 14.4 13l4.6 4.6-1.4 1.4L13 14.4l-4.6 4.6L7 17.6 11.6 13z"/>',
  };
  return `<svg viewBox="0 0 24 22" aria-hidden="true" class="p-icon">${paths[name] || ""}</svg>`;
}

function bindSeek() {
  const bar = els.progress;
  const seekFromEvent = (event) => {
    const rect = bar.getBoundingClientRect();
    const ratio = clamp01((event.clientX - rect.left) / Math.max(1, rect.width));
    const duration = audio?.duration && Number.isFinite(audio.duration) ? audio.duration : 0;
    if (duration) {
      audio.currentTime = ratio * duration;
      els.progressFill.style.width = `${ratio * 100}%`;
      els.timeNow.textContent = fmt(ratio * duration);
    }
  };
  bar.addEventListener("pointerdown", (event) => {
    if (!audio?.src) return;
    dragProgress = true;
    bar.setPointerCapture?.(event.pointerId);
    seekFromEvent(event);
  });
  bar.addEventListener("pointermove", (event) => {
    if (dragProgress) seekFromEvent(event);
  });
  bar.addEventListener("pointerup", () => {
    dragProgress = false;
  });
  bar.addEventListener("keydown", (event) => {
    if (!audio?.src) return;
    const step = event.key === "ArrowRight" ? 5 : event.key === "ArrowLeft" ? -5 : 0;
    if (!step) return;
    event.preventDefault();
    seekBy(step);
  });
}

/* ------------------------------------------------------------------ */
/* transport                                                          */
/* ------------------------------------------------------------------ */

/** Normalise anything views can hand us into a playback descriptor. */
export function toPlayableTrack(input) {
  if (!input) return null;
  const url = input.audioUrl || input.url || input.streamUrl || "";
  if (!url) return null;
  return {
    id: String(input.id || input.soundId || url),
    title: input.title || "Untitled",
    artist: input.artist || input.username || "Unknown artist",
    album: input.album || "",
    art: input.artwork || input.coverUrl || input.thumbnailUrl || "",
    audioUrl: url,
    duration: Number(input.duration) || 0,
    itemUrl: input.itemUrl || input.sourceUrl || "",
    licenceLabel: input.licenceLabel || input.licence?.label || "",
    licenceUrl: input.licenceUrl || input.licence?.url || "",
    attribution: input.attribution || input.credit || "",
    provider: input.source || input.provider || "",
    // Only tracks backed by a `sounds` document can be counted — raw catalogue
    // previews have no library entry, so they must not invent a play.
    soundId: input.soundId || (!input.external || input.artistUid || input.createdAt ? input.id : "") || "",
    videoId: input.videoId || "",
    kind: input.kind || "sound",
  };
}

/**
 * Start (or replace the queue with) a track list. `tracks` may be sounds from
 * Firestore or catalogue tracks from js/music.js.
 */
export function playQueue(tracks, startIndex = 0, { autoplay = true } = {}) {
  const list = (tracks || []).map(toPlayableTrack).filter(Boolean);
  if (!list.length) {
    toast("That track has no audio file attached.", "error");
    return false;
  }
  queue = list;
  order = list.map((_, i) => i);
  index = Math.min(Math.max(0, startIndex), list.length - 1);
  countedPlay = false;
  if (autoplay) startCurrent();
  else render();
  persist();
  return true;
}

export function playTrack(track, options = {}) {
  const playable = toPlayableTrack(track);
  if (!playable) {
    toast("That track has no audio file attached.", "error");
    return false;
  }
  const existing = queue.findIndex((t) => t.id === playable.id);
  if (existing >= 0) return playAt(existing);

  queue = [...queue.slice(0, index + 1), playable, ...queue.slice(index + 1)];
  order = queue.map((_, i) => i);
  index = existing < 0 ? queue.indexOf(playable) : existing;
  countedPlay = false;
  startCurrent();
  persist();
  return true;
}

/** Toggle helper for row buttons: same track → pause, otherwise play. */
export function toggleTrack(track, contextTracks) {
  const playable = toPlayableTrack(track);
  if (!playable) return false;
  if (queue[index]?.id === playable.id) {
    toggle();
    return true;
  }
  if (Array.isArray(contextTracks) && contextTracks.length > 1) {
    const at = contextTracks.findIndex((t) => String(t?.id || t?.audioUrl) === playable.id);
    return playQueue(contextTracks, at < 0 ? 0 : at);
  }
  return playTrack(playable);
}

function playAt(i) {
  if (i < 0 || i >= queue.length) return false;
  index = i;
  countedPlay = false;
  startCurrent();
  persist();
  return true;
}

function startCurrent() {
  const track = queue[index];
  if (!track || !audio) return;
  loadingId = track.id;
  audio.src = track.audioUrl;
  audio.load();
  audio.play().catch((err) => {
    // Browsers block audio without a gesture; surface it instead of faking it.
    if (err?.name === "NotAllowedError") {
      toast("Tap play to start audio — your browser blocks autoplay.", "info");
    }
    loadingId = "";
    render();
  });
  updateMediaSession(track);
  render();
}

export function toggle() {
  if (!audio || !queue.length) {
    restoreLastSession();
    if (!queue.length) {
      toast("Choose a track in Music first.", "info");
      return;
    }
  }
  if (playing) audio.pause();
  else audio.play().catch(() => render());
  render();
}

export function pause() {
  audio?.pause();
}

export function stop() {
  audio?.pause();
  queue = [];
  index = -1;
  order = [];
  if (audio) {
    audio.removeAttribute("src");
    audio.load();
  }
  hideMediaSession();
  localStorage.removeItem(LS_KEYS.last);
  localStorage.removeItem(LS_KEYS.queue);
  announce("stopped", null);
  render();
  emit();
}

export function skip(direction) {
  if (!queue.length) return;
  let nextIndex = index;
  if (shuffle) {
    const remaining = order.filter((i) => i !== index);
    if (!remaining.length) {
      order = queue.map((_, i) => i);
      nextIndex = index;
    } else {
      const pool = order.slice(order.indexOf(index) + 1);
      nextIndex = pool.length ? pool[0] : remaining[Math.floor(Math.random() * remaining.length)];
    }
  } else {
    nextIndex = index + direction;
    if (nextIndex < 0) nextIndex = queue.length - 1;
    if (nextIndex >= queue.length) nextIndex = repeatMode === "all" ? 0 : queue.length - 1;
  }
  playAt(nextIndex);
}

function onEnded() {
  if (repeatMode === "one") {
    audio.currentTime = 0;
    audio.play().catch(() => {});
    return;
  }
  const isLast = index >= queue.length - 1;
  if (isLast && repeatMode === "off" && !shuffle) {
    playing = false;
    render();
    return;
  }
  skip(1);
}

export function seekTo(seconds) {
  if (!audio?.src) return;
  const duration = Number.isFinite(audio.duration) ? audio.duration : queue[index]?.duration || 0;
  audio.currentTime = Math.min(Math.max(0, seconds), Math.max(0, duration - 0.2));
  render();
}

export function seekBy(delta) {
  seekTo((audio?.currentTime || 0) + delta);
}

export function setVolume(value) {
  volume = clamp01(value);
  muted = volume <= 0;
  if (audio) audio.volume = volume;
  if (audio) audio.muted = muted;
  localStorage.setItem(LS_KEYS.volume, String(volume));
  localStorage.setItem(LS_KEYS.muted, muted ? "1" : "0");
  render();
}

export function toggleMute() {
  muted = !muted;
  if (audio) audio.muted = muted;
  localStorage.setItem(LS_KEYS.muted, muted ? "1" : "0");
  render();
}

export function toggleShuffle() {
  shuffle = !shuffle;
  if (shuffle) {
    const rest = queue.map((_, i) => i).filter((i) => i !== index);
    for (let i = rest.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    order = [index, ...rest];
  } else {
    order = queue.map((_, i) => i);
  }
  render();
  toast(shuffle ? "Shuffle on" : "Shuffle off", "info");
}

export function cycleRepeat() {
  repeatMode = repeatMode === "off" ? "all" : repeatMode === "all" ? "one" : "off";
  localStorage.setItem(LS_KEYS.repeat, repeatMode);
  render();
}

/* ------------------------------------------------------------------ */
/* rendering                                                          */
/* ------------------------------------------------------------------ */

function onTimeUpdate() {
  if (!dragProgress) updateProgress();
  maybeCountPlay();
}

function updateProgress() {
  if (!audio || !els.progressFill) return;
  const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : queue[index]?.duration || 0;
  const ratio = duration ? clamp01(audio.currentTime / duration) : 0;
  els.progressFill.style.width = `${ratio * 100}%`;
  els.progress.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
  els.timeNow.textContent = fmt(audio.currentTime);
  els.timeLeft.textContent = duration ? `-${fmt(Math.max(0, duration - audio.currentTime))}` : "0:00";
}

/** Credit a play once the listener has been here for 20 seconds. */
function maybeCountPlay() {
  if (countedPlay || !audio || !startedAt) return;
  if (Date.now() - startedAt < 20_000) return;
  const track = queue[index];
  if (!track) return;
  countedPlay = true;
  if (track.soundId) {
    // One real increment per listener per listen, written to Firestore.
    recordSoundPlay(track.soundId, audio?.duration ? Math.round(audio.duration) : track.duration).catch(() => {});
  }
}

function fmt(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  }
  return `${m}:${String(r).padStart(2, "0")}`;
}

export { fmt as formatClock };

function render() {
  const state = snapshot();
  if (!els.root) {
    emit();
    return;
  }
  const track = state.track;
  els.root.classList.toggle("is-active", Boolean(track));
  // Give the feed room so the dock never covers the last card.
  document.body.classList.toggle("has-player", Boolean(track));
  els.root.hidden = !track;

  if (track) {
    els.title.textContent = track.title;
    els.title.title = track.title;
    els.artist.innerHTML = track.artist
      ? `${esc(track.artist)}${track.album ? ` · <span>${esc(track.album)}</span>` : ""}`
      : "Uncredited recording";
    if (track.art) {
      els.art.style.backgroundImage = `url("${cssUrl(track.art)}")`;
      els.art.classList.add("has-art");
    } else {
      els.art.style.backgroundImage = "";
      els.art.classList.remove("has-art");
    }
    if (track.licenceUrl) {
      els.licence.hidden = false;
      els.licence.textContent = track.licenceLabel || "Licence";
      els.licence.href = track.licenceUrl;
      els.licence.title = attributionLine({ ...track, licence: { label: track.licenceLabel } }) || "View the licence";
    } else {
      els.licence.hidden = true;
    }
  } else {
    els.title.textContent = "Nothing playing";
    els.artist.textContent = "Pick a track from Music, a post or a profile";
    els.art.style.backgroundImage = "";
    els.art.classList.remove("has-art");
    els.licence.hidden = true;
  }

  els.play.innerHTML = state.playing ? icon("pause") : icon("play");
  els.play.setAttribute("aria-label", state.playing ? "Pause" : "Play");
  els.play.classList.toggle("is-playing", state.playing);
  els.root.classList.toggle("is-loading", state.loading);
  const eq = els.root.querySelector("[data-p=eq]");
  if (eq) eq.hidden = !state.playing;
  els.shuffleBtn.classList.toggle("is-on", state.shuffle);
  els.shuffleBtn.setAttribute("aria-pressed", String(state.shuffle));
  els.repeatBtn.classList.toggle("is-on", state.repeat !== "off");
  els.repeatBtn.setAttribute("aria-pressed", String(state.repeat !== "off"));
  els.repeatBtn.innerHTML = state.repeat === "one" ? icon("repeatOne") : icon("repeat");
  els.repeatBtn.title = `Repeat: ${state.repeat}`;
  els.mute.innerHTML = state.muted || state.volume === 0 ? icon("mute") : icon("volume");
  els.volumeSlider.value = String(Math.round(state.volume * 100));
  els.root.dataset.queue = String(queue.length);
  if (state.error) els.root.classList.add("has-error");
  else els.root.classList.remove("has-error");

  renderQueuePanel();
  updateProgress();
  emit();
}

function renderQueuePanel() {
  if (!els.queuePanel || els.queuePanel.hidden) return;
  els.queuePanel.innerHTML = queue.length
    ? `<div class="pq-head"><strong>Up next</strong><span>${queue.length} track${queue.length === 1 ? "" : "s"}</span></div>
       <ol class="pq-list">${queue
         .map(
           (t, i) => `<li class="pq-row${i === index ? " is-current" : ""}">
             <button type="button" data-qi="${i}" class="pq-pick">
               <span class="pq-n">${i === index ? "▶" : i + 1}</span>
               <span class="pq-txt"><strong>${esc(t.title)}</strong><span>${esc(t.artist)}</span></span>
               <span class="pq-dur">${fmt(t.duration)}</span>
             </button>
           </li>`
         )
         .join("")}</ol>
       <p class="pq-note">Queue lives in this tab; likes, favourites and play counts are saved to your account.</p>`
    : `<p class="pq-empty">The queue is empty.</p>`;
}

function cssUrl(url) {
  return String(url).replace(/["'()\\]/g, "");
}

function toggleQueuePanel() {
  const open = els.queuePanel.hidden;
  els.queuePanel.hidden = !open;
  els.queueBtn.setAttribute("aria-expanded", String(open));
  if (open) {
    renderQueuePanel();
    const close = () => {
      if (els.queuePanel.hidden) return;
      els.queuePanel.hidden = true;
      els.queueBtn.setAttribute("aria-expanded", "false");
      document.removeEventListener("pointerdown", onDoc);
    };
    const onDoc = (event) => {
      if (!els.root.contains(event.target)) close();
    };
    setTimeout(() => document.addEventListener("pointerdown", onDoc), 0);
    els.queuePanel._close = close;
  } else {
    els.queuePanel._close?.();
  }
}

/* ------------------------------------------------------------------ */
/* media session + keyboard                                           */
/* ------------------------------------------------------------------ */

function updateMediaSession(track) {
  if (!("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album || CATALOGUE_PROVIDER.name,
      artwork: track.art ? [{ src: track.art, sizes: "256x256", type: "image/jpeg" }] : [],
    });
    navigator.mediaSession.setActionHandler("play", () => audio?.play());
    navigator.mediaSession.setActionHandler("pause", () => audio?.pause());
    navigator.mediaSession.setActionHandler("previoustrack", () => skip(-1));
    navigator.mediaSession.setActionHandler("nexttrack", () => skip(1));
    navigator.mediaSession.setActionHandler("seekbackward", () => seekBy(-10));
    navigator.mediaSession.setActionHandler("seekforward", () => seekBy(10));
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (typeof details.seekTime === "number") seekTo(details.seekTime);
    });
    navigator.mediaSession.playbackState = "playing";
  } catch {
    /* not supported on this browser — no visible difference */
  }
}

function hideMediaSession() {
  if (!("mediaSession" in navigator)) return;
  try {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = "none";
  } catch {
    /* ignore */
  }
}

let shortcutsBound = false;
function bindShortcuts() {
  if (shortcutsBound) return;
  shortcutsBound = true;
  document.addEventListener("keydown", (event) => {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || document.activeElement?.isContentEditable) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.code === "Space" && queue.length) {
      event.preventDefault();
      toggle();
    } else if (event.key === "ArrowRight" && event.shiftKey) {
      seekBy(10);
    } else if (event.key === "ArrowLeft" && event.shiftKey) {
      seekBy(-10);
    } else if (event.key === "ArrowUp" && event.shiftKey) {
      event.preventDefault();
      setVolume(volume + 0.05);
    } else if (event.key === "ArrowDown" && event.shiftKey) {
      event.preventDefault();
      setVolume(volume - 0.05);
    } else if ((event.key === "n" || event.key === "N") && event.shiftKey) {
      skip(1);
    }
  });

  // Reflect external play() calls that happen without a user gesture failing.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && playing && audio?.ended) render();
  });
}

/* ------------------------------------------------------------------ */
/* persistence of *session* state (not account data)                  */
/* ------------------------------------------------------------------ */

function persist() {
  if (!queue.length || index < 0) return;
  try {
    const track = queue[index];
    localStorage.setItem(
      LS_KEYS.last,
      JSON.stringify({ at: Date.now(), id: track.id, currentTime: audio?.currentTime || 0 })
    );
    localStorage.setItem(LS_KEYS.queue, JSON.stringify(queue.slice(0, 40)));
    announce("updated", track);
  } catch {
    /* quota or private mode — the dock still works, it just won't restore */
  }
}

function restoreLastSession() {
  try {
    const raw = localStorage.getItem(LS_KEYS.queue);
    const lastRaw = localStorage.getItem(LS_KEYS.last);
    if (!raw || !lastRaw) return;
    const last = JSON.parse(lastRaw);
    const list = JSON.parse(raw);
    if (!Array.isArray(list) || !list.length || Date.now() - Number(last.at || 0) > LS_TTL) return;
    queue = list.map(toPlayableTrack).filter(Boolean);
    if (!queue.length) return;
    order = queue.map((_, i) => i);
    index = Math.max(0, queue.findIndex((t) => t.id === last.id));
    if (audio) {
      audio.src = queue[index].audioUrl;
      audio.load();
      const resume = Number(last.currentTime) || 0;
      audio.addEventListener(
        "loadedmetadata",
        () => {
          if (resume > 1 && Number.isFinite(audio.duration) && resume < audio.duration) audio.currentTime = resume;
        },
        { once: true }
      );
      audio.muted = muted;
      audio.volume = volume;
      updateMediaSession(queue[index]);
    }
    // Deliberately NOT auto-playing: browsers block it and a surprise track
    // mid-scroll is worse than pressing play again.
    announce("resumed", queue[index]);
  } catch {
    /* malformed storage: start clean */
  }
}

/* ------------------------------------------------------------------ */
/* helpers for views                                                  */
/* ------------------------------------------------------------------ */

export function isPlayingTrack(id) {
  return queue[index]?.id === String(id) && playing;
}

export function isCurrentTrack(id) {
  return queue[index]?.id === String(id);
}

export function currentTrack() {
  return queue[index] || null;
}

export function playerState() {
  return snapshot();
}

export { fmt as formatSeconds };

/** Row-level "playing" indicators (feed cards, sound rows, profile tabs). */
export function attachPlayingIndicators(root) {
  if (!root) return () => {};
  const paint = () => {
    root.querySelectorAll("[data-play-track]").forEach((btn) => {
      const id = btn.getAttribute("data-play-track");
      const current = isCurrentTrack(id);
      btn.classList.toggle("is-playing", current && playing);
      btn.setAttribute("aria-label", current && playing ? `Pause ${btn.dataset.title || "track"}` : `Play ${btn.dataset.title || "track"}`);
    });
  };
  paint();
  return onPlayerChange(paint);
}

export function lastPlayedLabel(at) {
  return at ? timeAgo(at) : "never";
}
