/** Xacheus — Live streaming with gifts, stickers & real-time chat. */

import {
  LIVE_GIFTS,
  LIVE_REACTIONS,
  LIVE_SEGMENT_MS,
  LIVE_STALE_MS,
  LIVE_STICKERS,
  addLiveSegment,
  bumpLiveLike,
  bumpLiveShare,
  bumpLiveViewers,
  createLive,
  endLive,
  fetchLiveSegments,
  getGiftById,
  getLive,
  getLiveTopGifters,
  pingLive,
  sendLiveChat,
  sendLiveGift,
  sendLiveReaction,
  sendLiveSticker,
  setLiveThumbnail,
  watchActiveLives,
  watchLive,
  watchLiveChat,
  watchLiveGifts,
  watchLiveReactions,
} from "../data.js";
import { uploadImage, uploadVideo } from "../storage.js";
import { avatar, clear, emptyState, esc, formatCount, timeAgo, toast, copyText } from "../ui.js";
import { liveThumb } from "./components.js";

/* ------------------------------------------------------------------ */
/* shared helpers                                                      */
/* ------------------------------------------------------------------ */

function chatRowHtml(m) {
  const kind = m.kind || "text";
  if (kind === "gift") {
    return `
      <div class="live-chat-row is-gift">
        ${avatar({ username: m.username, displayName: m.displayName, photoURL: m.photoURL }, "xs")}
        <p>
          <strong>${esc(m.displayName || m.username || "viewer")}</strong>
          <span class="gift-chip">${esc(m.giftEmoji || "🎁")} ${esc(m.giftLabel || "Gift")}${m.giftCoins ? ` · ${m.giftCoins}` : ""}</span>
        </p>
      </div>`;
  }
  if (kind === "sticker") {
    return `
      <div class="live-chat-row is-sticker">
        ${avatar({ username: m.username, displayName: m.displayName, photoURL: m.photoURL }, "xs")}
        <p>
          <strong>${esc(m.displayName || m.username || "viewer")}</strong>
          <span class="sticker-bubble">${esc(m.stickerEmoji || m.text || "✨")}</span>
        </p>
      </div>`;
  }
  return `
    <div class="live-chat-row">
      ${avatar({ username: m.username, displayName: m.displayName, photoURL: m.photoURL }, "xs")}
      <p><strong>${esc(m.displayName || m.username || "viewer")}</strong> ${esc(m.text)}</p>
    </div>`;
}

function renderChatList(host, messages, emptyCopy) {
  if (!host) return;
  const nearBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 140 || !host.dataset.init;
  clear(host);
  host.innerHTML = messages.length
    ? messages.map(chatRowHtml).join("")
    : `<div class="live-chat-empty">${esc(emptyCopy || "Be first to say hello 👋")}</div>`;
  host.dataset.init = "1";
  if (nearBottom) host.scrollTop = host.scrollHeight;
}

function giftPickerHtml() {
  return `
    <div class="gift-picker" id="gift-picker" hidden>
      <header class="gift-picker-head">
        <strong>Send a gift</strong>
        <button class="icon-btn" type="button" data-act="close-gifts" aria-label="Close">✕</button>
      </header>
      <div class="gift-grid">
        ${LIVE_GIFTS.map(
          (g) => `
          <button class="gift-item" type="button" data-gift="${esc(g.id)}" title="${esc(g.label)}">
            <span class="gift-emoji">${g.emoji}</span>
            <span class="gift-label">${esc(g.label)}</span>
            <span class="gift-coins">🪙 ${g.coins}</span>
          </button>`
        ).join("")}
      </div>
    </div>`;
}

function stickerPickerHtml() {
  return `
    <div class="sticker-picker" id="sticker-picker" hidden>
      <div class="sticker-grid">
        ${LIVE_STICKERS.map(
          (s) => `
          <button class="sticker-item" type="button" data-sticker="${esc(s.id)}" title="${esc(s.label)}" aria-label="${esc(s.label)}">
            ${s.emoji}
          </button>`
        ).join("")}
      </div>
    </div>`;
}

function reactionBarHtml() {
  return `
    <div class="reaction-bar" id="reaction-bar">
      ${LIVE_REACTIONS.map(
        (r) => `<button class="reaction-btn" type="button" data-reaction="${esc(r.id)}" aria-label="React ${r.emoji}">${r.emoji}</button>`
      ).join("")}
    </div>`;
}

/** Spawn a floating emoji over the player. */
function spawnFloatEmoji(container, emoji, { big = false, x } = {}) {
  if (!container) return;
  const el = document.createElement("span");
  el.className = `float-emoji${big ? " is-big" : ""}`;
  el.textContent = emoji;
  const left = typeof x === "number" ? x : 10 + Math.random() * 70;
  el.style.left = `${left}%`;
  el.style.setProperty("--drift", `${(Math.random() * 40 - 20).toFixed(1)}px`);
  container.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

/** Full-screen gift celebration overlay. */
function playGiftAnim(container, gift) {
  if (!container || !gift) return;
  const layer = container.querySelector(".gift-fx") || (() => {
    const n = document.createElement("div");
    n.className = "gift-fx";
    container.appendChild(n);
    return n;
  })();

  const banner = document.createElement("div");
  banner.className = `gift-banner anim-${gift.anim || "float"}`;
  banner.innerHTML = `<span class="gift-banner-emoji">${gift.emoji}</span><span class="gift-banner-label">${esc(gift.label)}</span>`;
  layer.appendChild(banner);

  const count = gift.anim === "rain" ? 18 : gift.anim === "burst" ? 10 : 4;
  for (let i = 0; i < count; i += 1) {
    setTimeout(() => spawnFloatEmoji(layer, gift.emoji, { big: gift.coins >= 100, x: Math.random() * 90 }), i * 60);
  }
  setTimeout(() => banner.remove(), 3200);
}

/* ------------------------------------------------------------------ */
/* live list                                                           */
/* ------------------------------------------------------------------ */

export function liveListView(ctx) {
  let unsubscribe = null;
  let destroyed = false;

  const html = `
    <div class="view-head">
      <h1>Live</h1>
      <button class="btn btn-primary btn-sm go-live-btn" type="button" data-act="go">
        <span class="live-dot"></span> Go live
      </button>
    </div>
    <div class="live-grid" id="live-grid" aria-live="polite">
      <div class="loader-row"><span class="spinner"></span> Checking who's live…</div>
    </div>`;

  function render(root, lives) {
    const grid = root.querySelector("#live-grid");
    if (!grid || destroyed) return;

    const now = Date.now();
    const active = lives.filter((l) => {
      const ping = l.lastPingAt?.toMillis ? l.lastPingAt.toMillis() : l.lastPingAt || 0;
      const started = l.startedAt?.toMillis ? l.startedAt.toMillis() : l.startedAt || 0;
      const stamp = ping || started;
      return !stamp || now - stamp < LIVE_STALE_MS;
    });

    clear(grid);
    if (!active.length) {
      grid.innerHTML = emptyState(
        "📡",
        "No one is live right now",
        "Be the first — go live from your camera. Viewers can watch, chat, react and send gifts.",
        ctx.state.profile
          ? '<button class="btn btn-primary btn-sm" type="button" data-act="go-empty">Start broadcasting</button>'
          : '<button class="btn btn-primary btn-sm" type="button" data-act="login">Log in to go live</button>'
      );
      return;
    }

    grid.innerHTML = active
      .map(
        (live) => `
      <a class="live-card" href="#/live/${esc(live.id)}">
        <span class="live-thumb">
          ${liveThumb(live)}
          <span class="live-badge"><span class="live-dot"></span>LIVE</span>
          ${live.giftCoins ? `<span class="live-gift-badge">🎁 ${formatCount(live.giftCoins)}</span>` : ""}
        </span>
        <span class="live-card-body">
          <strong>${esc(live.title || `${live.displayName || live.username} is live`)}</strong>
          <span class="live-card-meta">
            ${avatar({ username: live.username, displayName: live.displayName, photoURL: live.photoURL }, "xs")}
            <em>@${esc(live.username || "user")}</em>
            <span>👁 ${formatCount(live.viewerCount || 0)}</span>
            ${live.likeCount ? `<span>❤️ ${formatCount(live.likeCount)}</span>` : ""}
            <span>· ${timeAgo(live.startedAt)}</span>
          </span>
        </span>
      </a>`
      )
      .join("");
  }

  return {
    html,
    title: "Live",
    mount(root) {
      const goLive = () => {
        if (!ctx.state.profile) return ctx.requireAuth();
        ctx.navigate("#/live/go");
      };
      root.addEventListener("click", (event) => {
        const act = event.target.closest("[data-act]")?.dataset.act;
        if (act === "go" || act === "go-empty") return goLive();
        if (act === "login") return ctx.requireAuth();
      });

      unsubscribe = watchActiveLives((lives) => render(root, lives));
    },
    destroy() {
      destroyed = true;
      if (unsubscribe) unsubscribe();
    },
  };
}

/* ------------------------------------------------------------------ */
/* broadcaster                                                          */
/* ------------------------------------------------------------------ */

const SEGMENT_MIME_CANDIDATES = [
  'video/webm;codecs="vp9,opus"',
  'video/webm;codecs="vp8,opus"',
  "video/webm",
  "video/mp4",
];

export function liveBroadcastView(ctx) {
  let destroyed = false;
  let running = false;
  let stream = null;
  let recorder = null;
  let segmentTimer = null;
  let heartbeat = null;
  let clockTimer = null;
  let liveId = "";
  let seq = 0;
  let uploaded = 0;
  let dropped = 0;
  let uploadBusy = false;
  let pending = [];
  let startedAtMs = 0;
  let chatUnsub = null;
  let liveUnsub = null;
  let giftsUnsub = null;
  let reactionsUnsub = null;
  let viewerCount = 0;
  let giftCoins = 0;
  let giftCount = 0;
  let likeCount = 0;
  let seenGiftIds = new Set();
  let seenReactionIds = new Set();
  let giftsPrimed = false;
  let reactionsPrimed = false;

  const html = `
    <div class="view-head">
      <h1>Go live</h1>
    </div>

    <div class="broadcast-setup" id="broadcast-setup">
      <div class="broadcast-preview-box">
        <div class="broadcast-loading" id="broadcast-loading"><span class="spinner"></span> Starting camera…</div>
        <video id="broadcast-preview" autoplay muted playsinline></video>
      </div>
      <form class="broadcast-form" id="broadcast-form">
        <label class="field">
          <span>Title <em>(optional)</em></span>
          <input type="text" id="live-title" maxlength="120" placeholder="What's happening? e.g. Sunday service live 🙏" autocomplete="off" />
        </label>
        <p class="field-hint">You're live in ~4s chunks. Viewers watch with a short delay, chat, react and send gifts in real time.</p>
        <button class="btn btn-primary btn-block" type="submit" id="start-btn" disabled>
          <span class="live-dot"></span> Go live now
        </button>
      </form>
    </div>

    <div class="broadcast-live-ui" id="broadcast-live-ui" hidden>
      <div class="broadcast-preview-box is-on-air" id="broadcast-stage">
        <video id="broadcast-preview2" autoplay muted playsinline></video>
        <span class="live-badge"><span class="live-dot"></span>LIVE</span>
        <span class="broadcast-clock" id="broadcast-clock">00:00</span>
        <div class="gift-fx" aria-hidden="true"></div>
      </div>
      <div class="broadcast-stats">
        <span>👁 <strong id="stat-viewers">0</strong> watching</span>
        <span>❤️ <strong id="stat-likes">0</strong></span>
        <span>🎁 <strong id="stat-gifts">0</strong> · 🪙 <strong id="stat-coins">0</strong></span>
        <span>📦 <strong id="stat-segments">0</strong> chunks</span>
      </div>
      <div class="live-chat" id="broadcast-chat"></div>
      <form class="chat-form" id="broadcast-chat-form">
        <input type="text" id="broadcast-chat-input" placeholder="Say something to your viewers…" maxlength="300" autocomplete="off" aria-label="Chat" />
        <button class="btn btn-outline btn-sm" type="submit">Send</button>
      </form>
      <div class="live-top-gifters" id="top-gifters" hidden></div>
      <button class="btn btn-danger btn-block" type="button" id="end-btn">End stream</button>
    </div>`;

  function pickMime() {
    if (typeof MediaRecorder === "undefined") return "";
    for (const mime of SEGMENT_MIME_CANDIDATES) {
      if (MediaRecorder.isTypeSupported?.(mime)) return mime;
    }
    return "";
  }

  function updateStats() {
    const set = (id, v) => {
      const el = document.querySelector(id);
      if (el) el.textContent = typeof v === "number" ? formatCount(v) : String(v);
    };
    set("#stat-viewers", viewerCount);
    set("#stat-likes", likeCount);
    set("#stat-gifts", giftCount);
    set("#stat-coins", giftCoins);
    set("#stat-segments", uploaded);
  }

  function drainQueue() {
    if (uploadBusy || !running) return;
    uploadBusy = true;
    (async () => {
      while (pending.length && running) {
        const item = pending.shift();
        let ok = false;
        for (let attempt = 0; attempt < 2 && !ok; attempt += 1) {
          try {
            const file = new File([item.blob], `seg-${item.seq}.webm`, { type: item.blob.type || "video/webm" });
            const res = await uploadVideo(file, { noThumbnail: true });
            if (!res?.url) throw new Error("No URL from upload");
            await addLiveSegment(liveId, { seq: item.seq, url: res.url, duration: item.duration });
            uploaded += 1;
            ok = true;
          } catch (error) {
            console.warn("[xacheus] segment upload failed", item.seq, error);
          }
        }
        if (!ok) dropped += 1;
        updateStats();
      }
      uploadBusy = false;
    })();
  }

  function startSegmentLoop() {
    if (!running || !stream) return;
    const mime = pickMime();
    try {
      recorder = new MediaRecorder(stream, {
        ...(mime ? { mimeType: mime } : {}),
        videoBitsPerSecond: 900_000,
        audioBitsPerSecond: 96_000,
      });
    } catch (error) {
      console.warn("[xacheus] MediaRecorder unavailable", error);
      toast("This browser can't broadcast video.", "error", 6000);
      stopBroadcast(true);
      return;
    }

    const chunks = [];
    const segStart = Date.now();
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      if (chunks.length) {
        seq += 1;
        pending.push({
          seq,
          blob: new Blob(chunks, { type: mime || "video/webm" }),
          duration: Math.max(0.5, (Date.now() - segStart) / 1000),
        });
        drainQueue();
      }
      if (running) startSegmentLoop();
    };
    recorder.start();
    segmentTimer = setTimeout(() => {
      if (recorder?.state === "recording") recorder.stop();
    }, LIVE_SEGMENT_MS);
  }

  async function capturePoster() {
    try {
      const video = document.querySelector("#broadcast-preview");
      if (!video || !video.videoWidth) return;
      const canvas = document.createElement("canvas");
      canvas.width = 480;
      canvas.height = Math.round((480 * video.videoHeight) / video.videoWidth);
      canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.7));
      if (!blob) return;
      const url = await uploadImage(new File([blob], "poster.jpg", { type: "image/jpeg" }), { strict: true });
      if (url && !String(url).startsWith("blob:") && liveId) setLiveThumbnail(liveId, url);
    } catch {
      /* poster is optional */
    }
  }

  function startClock() {
    startedAtMs = Date.now();
    clockTimer = setInterval(() => {
      const el = document.querySelector("#broadcast-clock");
      if (!el) return;
      const sec = Math.floor((Date.now() - startedAtMs) / 1000);
      el.textContent = `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
    }, 1000);
  }

  async function refreshTopGifters() {
    if (!liveId) return;
    const list = await getLiveTopGifters(liveId, 5).catch(() => []);
    const host = document.querySelector("#top-gifters");
    if (!host) return;
    if (!list.length) {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    host.innerHTML = `
      <h3 class="top-gifters-title">Top gifters</h3>
      <div class="top-gifters-list">
        ${list
          .map(
            (g, i) => `
          <a class="top-gifter" href="#/u/${esc(g.username || "")}">
            <span class="rank">#${i + 1}</span>
            ${avatar(g, "xs")}
            <span class="name">${esc(g.displayName || g.username)}</span>
            <span class="coins">🪙 ${formatCount(g.coins)}</span>
          </a>`
          )
          .join("")}
      </div>`;
  }

  async function startBroadcast(titleText) {
    const me = ctx.state.profile;
    if (!me) return ctx.requireAuth();

    if (!stream) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 1280 } },
          audio: true,
        });
      } catch {
        toast("Could not access camera/microphone. Check permissions.", "error", 6000);
        return;
      }
    }

    const preview = document.querySelector("#broadcast-preview");
    if (preview) preview.srcObject = stream;
    const loading = document.querySelector("#broadcast-loading");
    if (loading) loading.hidden = true;
    const startBtn = document.querySelector("#start-btn");
    if (startBtn) startBtn.disabled = false;

    pending = [];
    liveId = await createLive(me, titleText);
    running = true;
    seq = 0;
    uploaded = 0;
    dropped = 0;
    seenGiftIds = new Set();
    seenReactionIds = new Set();
    giftsPrimed = false;
    reactionsPrimed = false;

    document.querySelector("#broadcast-setup").hidden = true;
    document.querySelector("#broadcast-live-ui").hidden = false;
    const livePreview = document.querySelector("#broadcast-preview2");
    livePreview.srcObject = stream;

    startSegmentLoop();
    startClock();
    heartbeat = setInterval(() => pingLive(liveId), 20_000);
    capturePoster();

    liveUnsub = watchLive(liveId, (live) => {
      viewerCount = live?.viewerCount || 0;
      giftCoins = live?.giftCoins || 0;
      giftCount = live?.giftCount || 0;
      likeCount = live?.likeCount || 0;
      updateStats();
      if (!live && !destroyed) {
        toast("Stream not found — it may have been ended.", "error");
        stopBroadcast(true);
      }
    });

    chatUnsub = watchLiveChat(liveId, (messages) => {
      renderChatList(document.querySelector("#broadcast-chat"), messages, "No chat yet — viewers will appear here 💬");
    });

    const stage = document.querySelector("#broadcast-stage");
    giftsUnsub = watchLiveGifts(liveId, (gifts) => {
      if (!giftsPrimed) {
        gifts.forEach((g) => seenGiftIds.add(g.id));
        giftsPrimed = true;
        refreshTopGifters();
        return;
      }
      gifts.forEach((g) => {
        if (seenGiftIds.has(g.id)) return;
        seenGiftIds.add(g.id);
        const gift = getGiftById(g.giftId) || { emoji: g.emoji, label: g.label, coins: g.coins, anim: g.anim };
        playGiftAnim(stage, gift);
        toast(`${g.displayName || g.username} sent ${g.emoji} ${g.label}`, "success", 2500);
      });
      refreshTopGifters();
    });

    reactionsUnsub = watchLiveReactions(liveId, (reactions) => {
      const fx = stage?.querySelector(".gift-fx") || stage;
      if (!reactionsPrimed) {
        reactions.forEach((r) => seenReactionIds.add(r.id));
        reactionsPrimed = true;
        return;
      }
      reactions.forEach((r) => {
        if (seenReactionIds.has(r.id)) return;
        seenReactionIds.add(r.id);
        spawnFloatEmoji(fx, r.emoji || "❤️");
      });
    });

    window.addEventListener("beforeunload", beforeUnloadEnd);
  }

  function beforeUnloadEnd() {
    if (liveId && ctx.state.profile) endLive(liveId, ctx.state.profile.uid);
  }

  async function stopBroadcast(silent = false) {
    const wasRunning = liveId && ctx.state.profile;
    running = false;
    clearTimeout(segmentTimer);
    clearInterval(heartbeat);
    clearInterval(clockTimer);
    window.removeEventListener("beforeunload", beforeUnloadEnd);
    liveUnsub?.();
    chatUnsub?.();
    giftsUnsub?.();
    reactionsUnsub?.();
    liveUnsub = null;
    chatUnsub = null;
    giftsUnsub = null;
    reactionsUnsub = null;

    try {
      if (recorder?.state === "recording") recorder.stop();
    } catch {}
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }

    if (wasRunning) await endLive(liveId, ctx.state.profile.uid).catch(() => {});
    liveId = "";

    if (!silent && !destroyed) {
      toast(dropped ? `Stream ended (${dropped} chunks lost)` : "Stream ended", dropped ? "info" : "success");
      ctx.navigate("#/live");
    }
  }

  return {
    html,
    title: "Go live",
    mount(root) {
      if (!ctx.state.profile) {
        clear(root);
        root.innerHTML = emptyState(
          "🔒",
          "Log in to go live",
          "Broadcasting requires an account so viewers know who is streaming.",
          '<button class="btn btn-primary btn-sm" type="button" data-act="login">Log in or sign up</button>'
        );
        root.addEventListener("click", (event) => {
          if (event.target.closest('[data-act="login"]')) ctx.requireAuth();
        });
        return;
      }

      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        clear(root);
        root.innerHTML = emptyState(
          "🚫",
          "Broadcasting isn't supported here",
          "This browser doesn't support camera recording. Try Chrome, Edge or Firefox."
        );
        return;
      }

      (async () => {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 1280 } },
            audio: true,
          });
          if (destroyed) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          const preview = document.querySelector("#broadcast-preview");
          if (preview) {
            preview.srcObject = stream;
            document.querySelector("#broadcast-loading").hidden = true;
            document.querySelector("#start-btn").disabled = false;
          }
        } catch {
          const loading = document.querySelector("#broadcast-loading");
          if (loading) loading.textContent = "Camera unavailable — check permissions and reload.";
        }
      })();

      root.querySelector("#broadcast-form").addEventListener("submit", (event) => {
        event.preventDefault();
        if (running) return;
        const title = root.querySelector("#live-title").value.trim();
        startBroadcast(title);
      });

      root.querySelector("#end-btn").addEventListener("click", () => stopBroadcast(false));

      root.querySelector("#broadcast-chat-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const input = root.querySelector("#broadcast-chat-input");
        const text = input.value.trim();
        if (!text || !liveId) return;
        input.value = "";
        try {
          await sendLiveChat(liveId, ctx.state.profile, text);
        } catch (error) {
          toast(error?.message || "Couldn't send that.", "error");
        }
      });
    },
    destroy() {
      destroyed = true;
      stopBroadcast(true);
    },
  };
}

/* ------------------------------------------------------------------ */
/* watcher                                                             */
/* ------------------------------------------------------------------ */

export function liveWatchView(ctx, { liveId }) {
  let destroyed = false;
  let unsubLive = null;
  let unsubChat = null;
  let unsubGifts = null;
  let unsubReactions = null;
  let pollTimer = null;
  let video = null;

  let latestSeq = 0;
  let queuedThrough = 0;
  let playingSeq = 0;
  let queue = [];
  let ended = false;
  let replayMode = false;
  let joined = false;
  let viewers = 0;
  let giftCoins = 0;
  let giftCount = 0;
  let likeCount = 0;
  let hostProfile = null;
  let seenGiftIds = new Set();
  let seenReactionIds = new Set();
  let giftsPrimed = false;
  let reactionsPrimed = false;
  let lastLikeTap = 0;

  const html = `
    <div class="live-watch" id="live-watch">
      <div class="live-player-box" id="live-stage">
        <span class="live-loading" id="live-loading"><span class="spinner"></span> Connecting to the stream…</span>
        <video id="live-player" autoplay playsinline muted></video>
        <button class="live-unmute" id="live-unmute" type="button">🔇 Tap for sound</button>
        <span class="live-badge"><span class="live-dot"></span>LIVE</span>
        <div class="gift-fx" aria-hidden="true"></div>
        ${reactionBarHtml()}
      </div>
      <aside class="live-side">
        <div class="live-info" id="live-info"></div>
        <div class="live-actions-row">
          <button class="btn btn-outline btn-sm" type="button" data-act="like-live">❤️ Like</button>
          <button class="btn btn-outline btn-sm" type="button" data-act="share-live">↗ Share</button>
          <button class="btn btn-primary btn-sm" type="button" data-act="open-gifts">🎁 Gift</button>
          <button class="btn btn-outline btn-sm" type="button" data-act="open-stickers">✨ Stickers</button>
        </div>
        ${giftPickerHtml()}
        ${stickerPickerHtml()}
        <div class="live-chat" id="live-chat"></div>
        <form class="chat-form" id="live-chat-form">
          <input type="text" id="live-chat-input" placeholder="Say something…" maxlength="300" autocomplete="off" aria-label="Live chat" />
          <button class="btn btn-outline btn-sm" type="submit">Send</button>
        </form>
        <div class="live-top-gifters" id="watch-top-gifters" hidden></div>
      </aside>
    </div>`;

  function updateViewerChip() {
    const info = document.querySelector("#live-info");
    if (!info) return;
    const chip = info.querySelector("[data-viewers]");
    if (chip) chip.textContent = `👁 ${formatCount(viewers)} watching`;
    const gifts = info.querySelector("[data-gifts]");
    if (gifts) gifts.textContent = giftCoins ? `🎁 ${formatCount(giftCoins)} coins` : "";
    const likes = info.querySelector("[data-likes]");
    if (likes) likes.textContent = likeCount ? `❤️ ${formatCount(likeCount)}` : "";
  }

  function renderInfo(live) {
    const host = document.querySelector("#live-info");
    if (!host || !live) return;
    hostProfile = live;
    host.innerHTML = `
      <a class="live-host" href="#/u/${esc(live.username || "")}">
        ${avatar({ username: live.username, displayName: live.displayName, photoURL: live.photoURL }, "sm")}
        <span>
          <strong>${esc(live.displayName || live.username || "Xacheus")}</strong>
          <em>@${esc(live.username || "user")}</em>
        </span>
      </a>
      ${live.title ? `<p class="live-title">${esc(live.title)}</p>` : ""}
      <div class="live-meta-row">
        <span data-viewers>👁 ${formatCount(live.viewerCount || 0)} watching</span>
        <span data-likes>${live.likeCount ? `❤️ ${formatCount(live.likeCount)}` : ""}</span>
        <span data-gifts>${live.giftCoins ? `🎁 ${formatCount(live.giftCoins)} coins` : ""}</span>
        <a class="link" href="#/live">All live</a>
      </div>`;
  }

  async function refreshTopGifters() {
    const list = await getLiveTopGifters(liveId, 5).catch(() => []);
    const host = document.querySelector("#watch-top-gifters");
    if (!host) return;
    if (!list.length) {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    host.innerHTML = `
      <h3 class="top-gifters-title">Top gifters</h3>
      <div class="top-gifters-list">
        ${list
          .map(
            (g, i) => `
          <a class="top-gifter" href="#/u/${esc(g.username || "")}">
            <span class="rank">#${i + 1}</span>
            ${avatar(g, "xs")}
            <span class="name">${esc(g.displayName || g.username)}</span>
            <span class="coins">🪙 ${formatCount(g.coins)}</span>
          </a>`
          )
          .join("")}
      </div>`;
  }

  function showEnded() {
    if (ended) return;
    ended = true;
    document.querySelector("#live-watch .live-badge")?.remove();
    const box = document.querySelector(".live-player-box");
    if (box && !box.querySelector(".live-ended")) {
      const note = document.createElement("div");
      note.className = "live-ended";
      note.innerHTML = `<p>${replayMode ? "End of replay" : "Stream ended"}</p>
        ${giftCoins ? `<p class="live-ended-gifts">🎁 ${formatCount(giftCoins)} coins received</p>` : ""}
        <a class="btn btn-primary btn-sm" href="#/live">Find another live</a>`;
      box.appendChild(note);
    }
  }

  function playNext() {
    if (destroyed || !video) return;
    if (!queue.length) {
      if (ended || replayMode) showEnded();
      return;
    }
    if (queue.length > 5) queue = queue.slice(-2);
    const seg = queue.shift();
    playingSeq = seg.seq;
    video.src = seg.url;
    video.play().catch(() => {});
    document.querySelector("#live-loading")?.remove();
  }

  async function loadMore() {
    if (destroyed || ended || !liveId) return;
    if (latestSeq <= queuedThrough) return;
    try {
      const segs = await fetchLiveSegments(liveId, queuedThrough, 4);
      segs.forEach((s) => {
        if (s.seq > queuedThrough) {
          queue.push({ seq: s.seq, url: s.url });
          queuedThrough = s.seq;
        }
      });
      if (video && !video.src && queue.length) playNext();
    } catch {
      /* transient */
    }
  }

  function startPlayback(initialLatest) {
    queuedThrough = Math.max(0, initialLatest - 1);
    loadMore();
    pollTimer = setInterval(loadMore, 2500);
  }

  function togglePicker(id, show) {
    const el = document.querySelector(id);
    if (!el) return;
    const next = typeof show === "boolean" ? show : el.hidden;
    el.hidden = !next;
    // close the other
    if (id === "#gift-picker" && next) {
      const s = document.querySelector("#sticker-picker");
      if (s) s.hidden = true;
    }
    if (id === "#sticker-picker" && next) {
      const g = document.querySelector("#gift-picker");
      if (g) g.hidden = true;
    }
  }

  return {
    html,
    title: "Live",
    mount(root) {
      video = root.querySelector("#live-player");
      const unmuteBtn = root.querySelector("#live-unmute");
      const stage = root.querySelector("#live-stage");

      unmuteBtn.addEventListener("click", () => {
        video.muted = !video.muted;
        unmuteBtn.textContent = video.muted ? "🔇 Tap for sound" : "🔊 Sound on";
      });
      video.addEventListener("ended", playNext);
      video.addEventListener("error", () => {
        if (video.src) playNext();
      });

      // Double-tap player to like + heart float
      let lastTap = 0;
      stage.addEventListener("click", (event) => {
        if (event.target.closest("button,a,input,.reaction-bar,.gift-picker,.sticker-picker")) return;
        const now = Date.now();
        if (now - lastTap < 320) {
          if (!ctx.state.profile) return ctx.requireAuth();
          if (now - lastLikeTap < 400) return;
          lastLikeTap = now;
          bumpLiveLike(liveId);
          spawnFloatEmoji(stage.querySelector(".gift-fx"), "❤️", { big: true, x: 40 + Math.random() * 20 });
        }
        lastTap = now;
      });

      if (!ctx.state.profile) {
        root.querySelector("#live-chat-form").innerHTML = `<p class="field-hint">Log in to chat, gift and react.</p>`;
      }

      (async () => {
        const live = await getLive(liveId).catch(() => null);
        if (destroyed) return;
        if (!live) {
          clear(root);
          root.innerHTML = emptyState("📡", "Stream not found", "This broadcast doesn't exist or was removed.", '<a class="btn btn-primary btn-sm" href="#/live">Back to Live</a>');
          return;
        }

        renderInfo(live);
        latestSeq = live.latestSeq || 0;
        viewers = live.viewerCount || 0;
        giftCoins = live.giftCoins || 0;
        giftCount = live.giftCount || 0;
        likeCount = live.likeCount || 0;

        if (live.status !== "live") {
          replayMode = true;
          document.querySelector("#live-watch .live-badge")?.remove();
          root.querySelector(".live-actions-row")?.remove();
          root.querySelector("#gift-picker")?.remove();
          root.querySelector("#sticker-picker")?.remove();
          root.querySelector("#reaction-bar")?.remove();
          const loadingNote = document.querySelector("#live-loading");
          if (loadingNote) loadingNote.innerHTML = "This broadcast is over — playing the replay…";
          if (!latestSeq) {
            clear(root);
            root.innerHTML = emptyState(
              "📼",
              "This stream is over",
              `${live.displayName || live.username || "They"} didn't publish any moments from this broadcast.`,
              '<a class="btn btn-primary btn-sm" href="#/live">Back to Live</a>'
            );
            return;
          }
          startPlayback(latestSeq + 1);
          // Still show gift totals + chat history for the replay.
          unsubChat = watchLiveChat(liveId, (messages) => {
            renderChatList(document.querySelector("#live-chat"), messages, "No chat from this stream.");
          });
          refreshTopGifters();
        } else {
          startPlayback(latestSeq);
          joined = true;
          bumpLiveViewers(liveId, 1);

          unsubLive = watchLive(liveId, (fresh) => {
            if (!fresh) return showEnded();
            latestSeq = Math.max(latestSeq, fresh.latestSeq || 0);
            viewers = fresh.viewerCount || 0;
            giftCoins = fresh.giftCoins || 0;
            giftCount = fresh.giftCount || 0;
            likeCount = fresh.likeCount || 0;
            updateViewerChip();
            if (fresh.status !== "live" && !queue.length) showEnded();
          });

          unsubChat = watchLiveChat(liveId, (messages) => {
            renderChatList(document.querySelector("#live-chat"), messages, "Be first to say hello 👋");
          });

          unsubGifts = watchLiveGifts(liveId, (gifts) => {
            if (!giftsPrimed) {
              gifts.forEach((g) => seenGiftIds.add(g.id));
              giftsPrimed = true;
              refreshTopGifters();
              return;
            }
            gifts.forEach((g) => {
              if (seenGiftIds.has(g.id)) return;
              seenGiftIds.add(g.id);
              const gift = getGiftById(g.giftId) || { emoji: g.emoji, label: g.label, coins: g.coins, anim: g.anim };
              playGiftAnim(stage, gift);
            });
            refreshTopGifters();
          });

          unsubReactions = watchLiveReactions(liveId, (reactions) => {
            const fx = stage.querySelector(".gift-fx");
            if (!reactionsPrimed) {
              reactions.forEach((r) => seenReactionIds.add(r.id));
              reactionsPrimed = true;
              return;
            }
            reactions.forEach((r) => {
              if (seenReactionIds.has(r.id)) return;
              seenReactionIds.add(r.id);
              // Don't re-animate own reactions already floated locally.
              if (ctx.state.profile && r.uid === ctx.state.profile.uid) return;
              spawnFloatEmoji(fx, r.emoji || "❤️");
            });
          });
        }
      })();

      root.querySelector("#live-chat-form")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!ctx.state.profile) return ctx.requireAuth();
        const input = root.querySelector("#live-chat-input");
        const text = input.value.trim();
        if (!text) return;
        input.value = "";
        try {
          await sendLiveChat(liveId, ctx.state.profile, text);
        } catch (error) {
          toast(error?.message || "Couldn't send that.", "error");
        }
      });

      root.addEventListener("click", async (event) => {
        const act = event.target.closest("[data-act]")?.dataset.act;
        const giftId = event.target.closest("[data-gift]")?.dataset.gift;
        const stickerId = event.target.closest("[data-sticker]")?.dataset.sticker;
        const reactionId = event.target.closest("[data-reaction]")?.dataset.reaction;

        if (act === "open-gifts") {
          if (!ctx.state.profile) return ctx.requireAuth();
          return togglePicker("#gift-picker");
        }
        if (act === "close-gifts") return togglePicker("#gift-picker", false);
        if (act === "open-stickers") {
          if (!ctx.state.profile) return ctx.requireAuth();
          return togglePicker("#sticker-picker");
        }
        if (act === "like-live") {
          if (!ctx.state.profile) return ctx.requireAuth();
          if (Date.now() - lastLikeTap < 400) return;
          lastLikeTap = Date.now();
          bumpLiveLike(liveId);
          spawnFloatEmoji(stage.querySelector(".gift-fx"), "❤️", { big: true });
          return;
        }
        if (act === "share-live") {
          const shareUrl = `${location.origin}${location.pathname}#/live/${liveId}`;
          const title = hostProfile?.title || `${hostProfile?.displayName || "Someone"} is live on Xacheus`;
          if (navigator.share) {
            navigator
              .share({ title, url: shareUrl, text: title })
              .then(() => bumpLiveShare(liveId).catch(() => {}))
              .catch(() => {});
          } else {
            copyText(shareUrl);
            bumpLiveShare(liveId).catch(() => {});
          }
          return;
        }

        if (giftId) {
          if (!ctx.state.profile) return ctx.requireAuth();
          const btn = event.target.closest("[data-gift]");
          if (btn) btn.disabled = true;
          try {
            const gift = await sendLiveGift(liveId, ctx.state.profile, giftId);
            playGiftAnim(stage, gift);
            toast(`You sent ${gift.emoji} ${gift.label}`, "success", 2200);
            togglePicker("#gift-picker", false);
          } catch (error) {
            toast(error?.message || "Couldn't send gift.", "error");
          } finally {
            if (btn) btn.disabled = false;
          }
          return;
        }

        if (stickerId) {
          if (!ctx.state.profile) return ctx.requireAuth();
          try {
            const sticker = await sendLiveSticker(liveId, ctx.state.profile, stickerId);
            spawnFloatEmoji(stage.querySelector(".gift-fx"), sticker.emoji, { big: true });
            togglePicker("#sticker-picker", false);
          } catch (error) {
            toast(error?.message || "Couldn't send sticker.", "error");
          }
          return;
        }

        if (reactionId) {
          if (!ctx.state.profile) return ctx.requireAuth();
          const reaction = LIVE_REACTIONS.find((r) => r.id === reactionId);
          if (reaction) spawnFloatEmoji(stage.querySelector(".gift-fx"), reaction.emoji);
          sendLiveReaction(liveId, ctx.state.profile, reactionId).catch(() => {});
        }
      });
    },
    destroy() {
      destroyed = true;
      unsubLive?.();
      unsubChat?.();
      unsubGifts?.();
      unsubReactions?.();
      clearInterval(pollTimer);
      if (video) {
        video.pause();
        video.removeAttribute("src");
        video.load?.();
      }
      if (joined && liveId) bumpLiveViewers(liveId, -1);
    },
  };
}
