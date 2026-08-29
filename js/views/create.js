/** Xacheus — Create (video upload/record + photo posts) */

import { uploadVideo, uploadAudio, uploadImage } from "../cloudinary.js";
import { createVideo, createSound, getSounds, CURATED_FREE_SOUNDS } from "../data.js";
import { toast, esc, avatar } from "../ui.js";

export function createView(ctx) {
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
          <button class="tab is-active" type="button" data-ctype="video">🎬 Video</button>
          <button class="tab" type="button" data-ctype="photo">🖼️ Photo</button>
        </div>

        <div id="video-pane">
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
          </div>

          <div class="create-actions">
            <button class="btn btn-primary btn-block" type="submit" id="post-btn" disabled>Post video</button>
            <p class="fine-print">By posting you confirm you own this video and it doesn't violate copyright. We use only royalty-free sounds — no YouTube rips.</p>
          </div>
        </form>
        </div><!-- /video-pane -->

        <div id="photo-pane" hidden>
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
            <div class="create-actions">
              <button class="btn btn-primary btn-block" type="submit" id="photo-post-btn" disabled>Post photos</button>
              <p class="fine-print">By posting you confirm you own the rights to these photos.</p>
            </div>
          </form>
        </div><!-- /photo-pane -->
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
          </ul>
        </div>
        <div class="panel">
          <h2 class="panel-title">Cloudinary</h2>
          <p class="panel-empty">Videos upload directly from browser using unsigned preset <code>xacheus</code> (cloud <code>dhad95cch</code>). No secrets in frontend.</p>
          <p class="panel-empty">We use <code>auto</code> resource type so video, audio, image all work.</p>
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

  function renderSoundsMini() {
    const host = document.querySelector("#sounds-mini");
    if (!host) return;
    // show 3 curated
    host.innerHTML = CURATED_FREE_SOUNDS.slice(0, 3).map((s) => `
      <button class="sound-chip" type="button" data-sound-id="${esc(s.id)}">
        <span class="chip-icon">🎵</span>
        <span>${esc(s.title)}</span>
        <em>${esc(s.genre)}</em>
      </button>
    `).join("");

    host.querySelectorAll("[data-sound-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const sound = CURATED_FREE_SOUNDS.find((x) => x.id === btn.dataset.soundId);
        if (sound) selectSound(sound);
      });
    });
  }

  function selectSound(sound) {
    selectedSound = sound;
    const sel = document.querySelector("#sound-selected");
    const clearBtn = document.querySelector("#clear-sound");
    sel.innerHTML = `
      <span class="sound-icon">🎵</span>
      <span class="sound-info">
        <strong>${esc(sound.title)}</strong>
        <em>${esc(sound.artist || "Free Music")} · ${esc(sound.genre || "")}</em>
      </span>
      <audio src="${esc(sound.audioUrl)}" controls preload="none" style="height:28px;width:120px"></audio>
    `;
    clearBtn.hidden = false;
    toast(`Selected sound: ${sound.title}`, "success", 2000);
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
            <div class="sounds-tabs">
              <button class="tab is-active" data-tab="free">Free music (royalty-free)</button>
              <button class="tab" data-tab="trending">Trending sounds</button>
              <button class="tab" data-tab="original">Original sounds</button>
            </div>
            <div class="sounds-list" id="sounds-list"><div class="loader-row"><span class="spinner"></span> Loading…</div></div>
          </div>
        </div>
      </div>
    `;

    const list = host.querySelector("#sounds-list");
    let currentTab = "free";

    async function loadTab(tab) {
      currentTab = tab;
      host.querySelectorAll(".sounds-tabs .tab").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === tab));
      list.innerHTML = `<div class="loader-row"><span class="spinner"></span> Loading…</div>`;

      let sounds = [];
      if (tab === "free") {
        sounds = CURATED_FREE_SOUNDS;
        // also try fetch from DB
        try {
          const dbSounds = await getSounds({ onlyFree: true, limitCount: 20 });
          // merge
          const ids = new Set(sounds.map((s) => s.id));
          dbSounds.forEach((s) => { if (!ids.has(s.id)) sounds.push(s); });
        } catch {}
      } else {
        try {
          sounds = await getSounds({ limitCount: 30 });
        } catch {
          sounds = CURATED_FREE_SOUNDS;
        }
        if (tab === "trending") {
          sounds = [...sounds].sort((a, b) => (b.useCount || 0) - (a.useCount || 0));
        } else if (tab === "original") {
          sounds = sounds.filter((s) => s.isOriginal);
        }
      }

      if (!sounds.length) {
        list.innerHTML = `<p class="panel-empty">No sounds yet. Be first to upload original sound via video!</p>`;
        return;
      }

      list.innerHTML = sounds.map((s) => `
        <div class="sound-row" data-sound-id="${esc(s.id)}">
          <div class="sound-row-main">
            <span class="sound-cover">🎵</span>
            <span class="sound-meta">
              <strong>${esc(s.title)}</strong>
              <em>${esc(s.artist || "")} · ${esc(s.genre || "")} · used ${s.useCount || 0} times</em>
            </span>
          </div>
          <audio src="${esc(s.audioUrl)}" controls preload="none"></audio>
          <button class="btn btn-primary btn-sm" type="button" data-act="use-sound">Use</button>
        </div>
      `).join("");

      list.querySelectorAll("[data-act='use-sound']").forEach((btn) => {
        btn.addEventListener("click", () => {
          const row = btn.closest(".sound-row");
          const sound = sounds.find((x) => x.id === row.dataset.soundId);
          if (sound) {
            selectSound(sound);
            closeSoundsModal();
          }
        });
      });
    }

    host.querySelectorAll(".sounds-tabs .tab").forEach((tab) => {
      tab.addEventListener("click", () => loadTab(tab.dataset.tab));
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
            if (!url || url.startsWith("blob:")) throw new Error("Photo upload failed — check the Cloudinary preset.");
            urls.push(url);
          }

          btn.textContent = "Creating post…";
          await createVideo(ctx.state.profile, {
            mediaType: "photo",
            images: urls,
            caption: photoCaption.value.trim(),
          });

          toast("Photo post published!", "success");
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
            cloudinaryPublicId: result.publicId,
          });

          toast("Video posted!", "success");
          ctx.navigate("#/home");
        } catch (err) {
          console.warn("[xacheus] create video", err);
          toast(err?.message || "Failed to upload video. Check Cloudinary preset.", "error", 6000);
          postBtn.disabled = false;
          postBtn.textContent = "Post video";
          progressBar.hidden = true;
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
