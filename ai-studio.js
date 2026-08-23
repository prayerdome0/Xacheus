/* Xacheus AI Studio — unified client for gen.pollinations.ai
   Text · Images · Video · Audio · Realtime voice · Embeddings
   Fully client-side: the API key lives in this browser's localStorage only. */

const GEN = "https://gen.pollinations.ai";
const MEDIA = "https://media.pollinations.ai";
const KEY_STORAGE = "xacheus_pollinations_key";

/* ---------------- static fallbacks (used if live model lists are unreachable) ---------------- */

const STATIC = {
  text: ["openai", "openai-fast", "openai-large", "gpt-oss", "mistral-small-3.2", "gemini-3-flash", "gemini-fast", "deepseek", "grok", "claude-fast", "qwen-coder", "kimi", "nova-fast", "llama"],
  image: ["flux", "seedream5", "seedream", "nanobanana-2", "gptimage", "krea", "kontext", "zimage", "ideogram-v4-turbo", "qwen-image", "grok-imagine", "recraft-v4.1-vector"],
  video: ["veo", "seedance-pro", "seedance-2.0", "seedance-2.0-fast", "wan", "wan-fast", "grok-imagine-video-1.5", "minimax-h3", "p-video", "nova-reel"],
  tts: ["openai-audio", "elevenlabs", "elevenflash", "kokoro", "grok-tts", "qwen-tts", "csm-1b", "elevenmusic", "lyria-3-clip", "stable-audio-3-medium"],
  embeddings: ["gemini-2", "openai-3-small", "openai-3-large", "cohere-embed-v4", "qwen3-embedding-8b"],
  voices: ["nova", "alloy", "echo", "fable", "onyx", "shimmer", "ash", "ballad", "coral", "sage", "verse",
    "rachel", "domi", "bella", "elli", "charlotte", "dorothy", "sarah", "emily", "lily", "matilda",
    "adam", "antoni", "arnold", "josh", "sam", "daniel", "charlie", "james", "fin", "callum", "liam", "george", "brian", "bill"],
};

/* ---------------- tiny helpers ---------------- */

const $ = (id) => document.getElementById(id);

function getKey() { return localStorage.getItem(KEY_STORAGE) || ""; }

function authHeaders() {
  const k = getKey();
  return k ? { Authorization: `Bearer ${k}` } : {};
}

function setStatus(el, msg, kind = "") {
  el.textContent = msg || "";
  el.className = "status-line" + (kind ? " " + kind : "");
}

async function apiError(res) {
  let detail = "";
  try {
    const t = await res.text();
    try { detail = JSON.parse(t)?.error?.message || JSON.parse(t)?.message || t; }
    catch { detail = t; }
  } catch { /* ignore */ }
  detail = String(detail || "").slice(0, 300);
  let hint = "";
  if (res.status === 401 || res.status === 403) hint = " — check that your API key is saved above and valid";
  if (res.status === 402) hint = " — insufficient Pollen balance, top up at enter.pollinations.ai";
  return new Error(`Request failed (HTTP ${res.status})${detail ? ": " + detail : ""}${hint}`);
}

function networkHelp(e) {
  const m = String(e && e.message || e);
  if (m.includes("Failed to fetch") || m.includes("NetworkError")) {
    return "Network/CORS error — could not reach gen.pollinations.ai from this browser. Check your connection, ad blockers, or VPN.";
  }
  if (m.includes("aborted")) return "Timed out waiting for the model — try a faster model or a simpler prompt.";
  return m;
}

function startTimer(el, base) {
  const t0 = Date.now();
  el.textContent = `${base} 0s`;
  const iv = setInterval(() => { el.textContent = `${base} ${Math.round((Date.now() - t0) / 1000)}s`; }, 1000);
  return (finalMsg, kind = "ok") => { clearInterval(iv); setStatus(el, finalMsg, kind); };
}

async function fetchBlob(url, timeoutMs = 300000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: authHeaders(), signal: ctrl.signal });
    if (!res.ok) throw await apiError(res);
    return await res.blob();
  } finally { clearTimeout(t); }
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

/* ---------------- model list loading ---------------- */

function normalizeModelList(data) {
  let arr = [];
  if (Array.isArray(data)) arr = data;
  else if (Array.isArray(data?.data)) arr = data.data;
  else if (Array.isArray(data?.models)) arr = data.models;
  else if (data && typeof data === "object") {
    arr = Object.entries(data).map(([k, v]) => (v && typeof v === "object" ? { id: k, ...v } : { id: k }));
  }
  return arr
    .map((m) => {
      if (typeof m === "string") return { id: m, raw: {} };
      const id = m.id || m.name || m.model || "";
      return { id: String(id), raw: m };
    })
    .filter((m) => m.id);
}

function fillSelect(sel, ids, preferred) {
  const prev = sel.value;
  sel.innerHTML = "";
  const list = ids && ids.length ? ids : [];
  for (const id of list) {
    const o = document.createElement("option");
    o.value = id;
    o.textContent = id;
    sel.appendChild(o);
  }
  if (preferred && list.includes(preferred)) sel.value = preferred;
  else if (prev && list.includes(prev)) sel.value = prev;
  else if (list.length) sel.value = list[0];
}

async function refreshModelSelects() {
  const jobs = [
    { path: "/text/models", fallback: STATIC.text, sel: $("text-model"), pref: "openai" },
    { path: "/image/models", fallback: STATIC.image, sel: $("image-model"), pref: "flux" },
    { path: "/video/models", fallback: STATIC.video, sel: $("video-model"), pref: "veo" },
  ];
  for (const job of jobs) {
    let ids = job.fallback;
    try {
      const res = await fetch(`${GEN}${job.path}`, { headers: authHeaders() });
      if (res.ok) {
        const list = normalizeModelList(await res.json()).map((m) => m.id);
        if (list.length) ids = list;
      }
    } catch { /* keep fallback */ }
    fillSelect(job.sel, ids, job.pref);
  }

  // TTS models + voices
  let ttsIds = STATIC.tts;
  let voices = [...STATIC.voices];
  try {
    const res = await fetch(`${GEN}/audio/models`, { headers: authHeaders() });
    if (res.ok) {
      const items = normalizeModelList(await res.json());
      const genModels = items
        .filter((m) => !/whisper|transcribe|scribe|universal/i.test(m.id))
        .map((m) => m.id);
      if (genModels.length) ttsIds = genModels;
      const union = new Set();
      for (const m of items) {
        const v = m.raw?.voices || m.raw?.supported_voices;
        if (Array.isArray(v)) v.forEach((x) => union.add(typeof x === "string" ? x : x?.id || x?.name));
        if (Array.isArray(m.raw?.input_modalities) && m.raw.input_modalities.includes("text") && !genModels.includes(m.id)) genModels.push(m.id);
      }
      const live = [...union].filter(Boolean);
      if (live.length) voices = [...new Set([...STATIC.voices.slice(0, 6), ...live])];
    }
  } catch { /* keep fallback */ }
  fillSelect($("tts-model"), ttsIds, "openai-audio");
  fillSelect($("tts-voice"), voices, "nova");
  const rtVoice = $("rt-voice");
  if (rtVoice) fillSelect(rtVoice, voices, "nova");

  // Embedding models
  let embIds = STATIC.embeddings;
  try {
    const res = await fetch(`${GEN}/embeddings/models`, { headers: authHeaders() });
    if (res.ok) {
      const list = normalizeModelList(await res.json()).map((m) => m.id);
      if (list.length) embIds = list;
    }
  } catch { /* keep fallback */ }
  fillSelect($("emb-model"), embIds, "openai-3-small");
}

/* ---------------- tabs ---------------- */

function initTabs() {
  const buttons = document.querySelectorAll(".studio-tabs button");
  const activate = (name) => {
    buttons.forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    document.querySelectorAll(".studio-panel").forEach((p) => p.classList.toggle("active", p.id === `panel-${name}`));
  };
  buttons.forEach((b) =>
    b.addEventListener("click", () => {
      activate(b.dataset.tab);
      history.replaceState(null, "", `#${b.dataset.tab}`);
    })
  );
  const hash = location.hash.slice(1);
  if (hash && $(`panel-${hash}`)) activate(hash);
}

/* ---------------- API key bar ---------------- */

function initKeyBar() {
  const input = $("api-key-input");
  input.value = getKey();

  $("toggle-key-visibility").onclick = () => {
    input.type = input.type === "password" ? "text" : "password";
  };
  $("save-key").onclick = () => {
    const v = input.value.trim();
    if (!v) { setStatus($("key-status"), "Paste a key first — get one at enter.pollinations.ai/keys", "err"); return; }
    localStorage.setItem(KEY_STORAGE, v);
    input.value = v;
    setStatus($("key-status"), "✅ Key saved in this browser. All studio tools will use it automatically.", "ok");
  };
  $("clear-key").onclick = () => {
    localStorage.removeItem(KEY_STORAGE);
    input.value = "";
    setStatus($("key-status"), "Key removed from this browser.", "");
  };
  $("check-balance").onclick = async () => {
    const st = $("key-status");
    if (!getKey()) { setStatus(st, "Save your API key first.", "err"); return; }
    setStatus(st, "Checking…");
    try {
      const [bal, keyInfo] = await Promise.all([
        fetch(`${GEN}/account/balance`, { headers: authHeaders() }).then(async (r) => { if (!r.ok) throw await apiError(r); return r.json(); }),
        fetch(`${GEN}/account/key`, { headers: authHeaders() }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      const parts = [];
      if (bal.balance !== undefined) parts.push(`Balance: ${Number(bal.balance).toFixed(4)} pollen`);
      if (bal.accountBalance) {
        const ab = bal.accountBalance;
        parts.push(`(account total ${Number(ab.total ?? 0).toFixed(4)}, tier ${ab.tier ?? "?"}, paid ${Number(ab.paid ?? 0).toFixed(4)})`);
      }
      if (keyInfo) {
        const t = keyInfo.type || keyInfo.keyType || "";
        const perms = Array.isArray(keyInfo.permissions) ? keyInfo.permissions.join(", ") : "";
        parts.push(`Key: ${t}${perms ? ` · scopes: ${perms}` : ""}`);
      }
      setStatus(st, "✅ " + (parts.join(" ") || "Key is valid."), "ok");
    } catch (e) {
      setStatus(st, networkHelp(e), "err");
    }
  };
}

/* ---------------- TEXT chat ---------------- */

const chatState = { messages: [], busy: false };

function addBubble(role, text) {
  const log = $("chat-log");
  const empty = log.querySelector(".empty-state");
  if (empty) empty.remove();
  const div = document.createElement("div");
  div.className = `chat-bubble ${role}`;
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

function addMeta(text) {
  const log = $("chat-log");
  const div = document.createElement("div");
  div.className = "chat-meta";
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

async function sendChat() {
  const input = $("chat-input");
  const sendBtn = $("chat-send");
  const st = $("text-status");
  const content = input.value.trim();
  if (!content || chatState.busy) return;
  if (!getKey()) { setStatus(st, "Save your API key above first.", "err"); return; }

  chatState.busy = true;
  sendBtn.disabled = true;
  input.value = "";
  addBubble("user", content);
  chatState.messages.push({ role: "user", content });

  const sys = $("text-system").value.trim();
  const messages = [];
  if (sys) messages.push({ role: "system", content: sys });
  messages.push(...chatState.messages);

  const body = {
    model: $("text-model").value || "openai",
    messages,
    temperature: parseFloat($("text-temp").value),
    max_tokens: parseInt($("text-max-tokens").value, 10) || undefined,
    stream: $("text-stream").checked,
  };
  if (body.stream) body.stream_options = { include_usage: true };

  const bubble = addBubble("assistant", "");
  bubble.classList.add("typing-dots");
  setStatus(st, "Generating…");

  try {
    let usage = null;
    if (body.stream) {
      const res = await fetch(`${GEN}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw await apiError(res);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const j = JSON.parse(payload);
            const d = j.choices?.[0]?.delta?.content;
            if (d) {
              bubble.classList.remove("typing-dots");
              bubble.textContent += d;
              $("chat-log").scrollTop = $("chat-log").scrollHeight;
            }
            if (j.usage) usage = j.usage;
          } catch { /* partial JSON line */ }
        }
      }
    } else {
      const res = await fetch(`${GEN}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw await apiError(res);
      const j = await res.json();
      bubble.textContent = j.choices?.[0]?.message?.content || "(empty response)";
      usage = j.usage;
    }
    bubble.classList.remove("typing-dots");
    const reply = bubble.textContent.trim();
    if (reply) chatState.messages.push({ role: "assistant", content: reply });
    setStatus(
      st,
      usage
        ? `Done · model ${body.model} · tokens: ${usage.prompt_tokens ?? "?"} in / ${usage.completion_tokens ?? "?"} out${usage.total_tokens ? ` / ${usage.total_tokens} total` : ""}`
        : "Done.",
      "ok"
    );
  } catch (e) {
    bubble.classList.remove("typing-dots");
    if (!bubble.textContent) bubble.textContent = "⚠ " + networkHelp(e);
    setStatus(st, networkHelp(e), "err");
  } finally {
    chatState.busy = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

function initText() {
  $("text-temp").addEventListener("input", (e) => { $("text-temp-out").textContent = e.target.value; });
  $("chat-form").addEventListener("submit", (e) => { e.preventDefault(); sendChat(); });
  $("chat-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
  $("text-clear").onclick = () => {
    chatState.messages = [];
    $("chat-log").innerHTML = '<div class="empty-state">Conversation cleared. Ask anything…</div>';
    setStatus($("text-status"), "");
  };
  $("text-copy").onclick = () => {
    const t = chatState.messages.map((m) => `${m.role === "user" ? "You" : "AI"}: ${m.content}`).join("\n\n");
    navigator.clipboard.writeText(t || "");
    setStatus($("text-status"), "Transcript copied.", "ok");
  };
}

/* ---------------- IMAGE ---------------- */

const imageState = { blob: null, url: null, prompt: "" };

function buildParams(pairs) {
  const q = new URLSearchParams();
  for (const [k, v] of pairs) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    q.set(k, v === true ? "true" : String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

async function generateImage() {
  const st = $("image-status");
  const prompt = $("image-prompt").value.trim();
  if (!prompt) { setStatus(st, "Write a prompt first.", "err"); return; }
  if (!getKey()) { setStatus(st, "Save your API key above first.", "err"); return; }

  const params = buildParams([
    ["model", $("image-model").value],
    ["width", $("image-width").value],
    ["height", $("image-height").value],
    ["seed", $("image-seed").value],
    ["quality", $("image-quality").value],
    ["enhance", $("image-enhance").checked],
    ["nologo", $("image-nologo").checked],
    ["private", $("image-private").checked],
    ["safe", $("image-safe").checked],
    ["transparent", $("image-transparent").checked],
  ]);
  const url = `${GEN}/image/${encodeURIComponent(prompt)}${params}`;

  $("image-generate").disabled = true;
  const stop = startTimer(st, "🎨 Generating image…");

  try {
    const blob = await fetchBlob(url, 240000);
    if (!/^image\//.test(blob.type)) throw new Error(`Unexpected response type: ${blob.type || "unknown"}`);
    if (imageState.url) URL.revokeObjectURL(imageState.url);
    imageState.blob = blob;
    imageState.url = URL.createObjectURL(blob);
    imageState.prompt = prompt;

    const out = $("image-output");
    out.innerHTML = "";
    const img = document.createElement("img");
    img.src = imageState.url;
    img.alt = prompt;
    out.appendChild(img);

    const ext = blob.type.includes("png") ? "png" : blob.type.includes("svg") ? "svg" : "jpg";
    $("image-open").href = imageState.url;
    $("image-download").href = imageState.url;
    $("image-download").download = `xacheus-image.${ext}`;
    $("image-actions").hidden = false;
    stop(`✅ Image ready · ${(blob.size / 1024).toFixed(0)} KB · model ${$("image-model").value}`, "ok");
  } catch (e) {
    stop(networkHelp(e), "err");
  } finally {
    $("image-generate").disabled = false;
  }
}

async function uploadToMedia(blobOrFile, filename) {
  const fd = new FormData();
  fd.append("file", blobOrFile, filename);
  const res = await fetch(`${MEDIA}/upload`, { method: "POST", headers: authHeaders(), body: fd });
  if (!res.ok) throw await apiError(res);
  const j = await res.json();
  const url = j.url || j.mediaUrl || j.location || (j.id ? `${MEDIA}/${j.id}` : null);
  if (!url) throw new Error("Upload succeeded but no URL was returned.");
  return url;
}

function initImage() {
  $("image-generate").onclick = generateImage;
  $("image-to-video").onclick = async () => {
    if (!imageState.blob) return;
    const st = $("image-status");
    setStatus(st, "Uploading image as a video reference frame…");
    try {
      const url = await uploadToMedia(imageState.blob, "xacheus-image.png");
      videoState.refUrl = url;
      $("video-ref-status").textContent = `Reference image: ${url}`;
      if (imageState.prompt && !$("video-prompt").value.trim()) $("video-prompt").value = imageState.prompt;
      setStatus(st, "✅ Uploaded — switched to the Video tab.", "ok");
      document.querySelector('.studio-tabs [data-tab="video"]').click();
    } catch (e) {
      setStatus(st, networkHelp(e), "err");
    }
  };
}

/* ---------------- VIDEO ---------------- */

const videoState = { blob: null, url: null, refUrl: "" };

async function generateVideo() {
  const st = $("video-status");
  const prompt = $("video-prompt").value.trim();
  if (!prompt) { setStatus(st, "Write a prompt first.", "err"); return; }
  if (!getKey()) { setStatus(st, "Save your API key above first.", "err"); return; }

  // Upload a newly chosen reference file on demand
  const file = $("video-ref-file").files[0];
  if (file) {
    setStatus(st, "Uploading reference image…");
    try {
      videoState.refUrl = await uploadToMedia(file, file.name || "reference.png");
      $("video-ref-status").textContent = `Reference image: ${videoState.refUrl}`;
    } catch (e) {
      setStatus(st, networkHelp(e), "err");
      return;
    } finally {
      $("video-ref-file").value = "";
    }
  }

  const params = buildParams([
    ["model", $("video-model").value],
    ["duration", $("video-duration").value],
    ["aspectRatio", $("video-aspect").value],
    ["image", videoState.refUrl],
    ["nologo", true],
  ]);
  const url = `${GEN}/video/${encodeURIComponent(prompt)}${params}`;

  $("video-generate").disabled = true;
  const stop = startTimer(st, "🎬 Rendering video (can take several minutes)…");

  try {
    const blob = await fetchBlob(url, 600000);
    if (!/^video\//.test(blob.type)) throw new Error(`Unexpected response type: ${blob.type || "unknown"}`);
    if (videoState.url) URL.revokeObjectURL(videoState.url);
    videoState.blob = blob;
    videoState.url = URL.createObjectURL(blob);

    const out = $("video-output");
    out.innerHTML = "";
    const v = document.createElement("video");
    v.src = videoState.url;
    v.controls = true;
    v.loop = true;
    v.autoplay = true;
    v.muted = true;
    v.playsInline = true;
    out.appendChild(v);

    $("video-open").href = videoState.url;
    $("video-download").href = videoState.url;
    $("video-actions").hidden = false;
    stop(`✅ Video ready · ${(blob.size / 1048576).toFixed(1)} MB · model ${$("video-model").value}`, "ok");
  } catch (e) {
    stop(networkHelp(e), "err");
  } finally {
    $("video-generate").disabled = false;
  }
}

function initVideo() {
  $("video-generate").onclick = generateVideo;
  $("video-ref-file").addEventListener("change", () => {
    const f = $("video-ref-file").files[0];
    if (f) {
      videoState.refUrl = "";
      $("video-ref-status").textContent = `Selected "${f.name}" — it will be uploaded to media.pollinations.ai when you generate.`;
    }
  });
}

/* ---------------- AUDIO: TTS + STT ---------------- */

async function generateTTS() {
  const st = $("tts-status");
  const text = $("tts-text").value.trim();
  if (!text) { setStatus(st, "Enter text first.", "err"); return; }
  if (!getKey()) { setStatus(st, "Save your API key above first.", "err"); return; }

  const params = buildParams([
    ["model", $("tts-model").value],
    ["voice", $("tts-voice").value],
  ]);
  const url = `${GEN}/audio/${encodeURIComponent(text)}${params}`;

  $("tts-generate").disabled = true;
  const stop = startTimer(st, "🔊 Generating audio…");
  try {
    const blob = await fetchBlob(url, 300000);
    if (!/^(audio|video)\//.test(blob.type)) throw new Error(`Unexpected response type: ${blob.type || "unknown"}`);
    const objUrl = URL.createObjectURL(blob);
    const out = $("tts-output");
    out.innerHTML = "";
    const a = document.createElement("audio");
    a.controls = true;
    a.autoplay = true;
    a.src = objUrl;
    out.appendChild(a);
    const ext = blob.type.includes("wav") ? "wav" : blob.type.includes("ogg") ? "ogg" : "mp3";
    $("tts-download").href = objUrl;
    $("tts-download").download = `xacheus-audio.${ext}`;
    $("tts-actions").hidden = false;
    stop(`✅ Audio ready · ${(blob.size / 1024).toFixed(0)} KB`, "ok");
  } catch (e) {
    stop(networkHelp(e), "err");
  } finally {
    $("tts-generate").disabled = false;
  }
}

async function transcribe() {
  const st = $("stt-status");
  const file = $("stt-file").files[0];
  if (!file) { setStatus(st, "Choose an audio or video file first.", "err"); return; }
  if (!getKey()) { setStatus(st, "Save your API key above first.", "err"); return; }

  const fd = new FormData();
  fd.append("file", file, file.name);
  fd.append("model", $("stt-model").value);
  fd.append("response_format", "json");

  $("stt-transcribe").disabled = true;
  setStatus(st, "Transcribing…");
  try {
    const res = await fetch(`${GEN}/v1/audio/transcriptions`, { method: "POST", headers: authHeaders(), body: fd });
    if (!res.ok) throw await apiError(res);
    const j = await res.json();
    const text = j.text || j.transcript || JSON.stringify(j, null, 2);
    $("stt-output").textContent = text;
    $("stt-actions").hidden = false;
    setStatus(st, `✅ Transcribed ${(file.size / 1048576).toFixed(1)} MB with ${$("stt-model").value}.`, "ok");
  } catch (e) {
    setStatus(st, networkHelp(e), "err");
  } finally {
    $("stt-transcribe").disabled = false;
  }
}

function initAudio() {
  $("tts-generate").onclick = generateTTS;
  $("stt-transcribe").onclick = transcribe;
  $("stt-copy").onclick = () => {
    navigator.clipboard.writeText($("stt-output").textContent);
    setStatus($("stt-status"), "Copied.", "ok");
  };
}

/* ---------------- REALTIME voice ---------------- */

const rt = {
  ws: null,
  stream: null,
  captureCtx: null,
  source: null,
  worklet: null,
  playbackCtx: null,
  gain: null,
  nextTime: 0,
  activeSources: [],
  sessionReady: false,
  assistantBubble: null,
};

const RT_RATE = 24000;

function base64FromBytes(bytes) {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function resampleF32(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = pos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

function rtLog(role, text) {
  const log = $("rt-log");
  const empty = log.querySelector(".empty-state");
  if (empty) empty.remove();
  const div = document.createElement("div");
  div.className = `chat-bubble ${role}`;
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

function rtStopPlayback() {
  for (const s of rt.activeSources) { try { s.stop(); } catch { /* already ended */ } }
  rt.activeSources = [];
  rt.nextTime = 0;
  rt.assistantBubble = null;
}

function rtPlayDelta(b64) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const i16 = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  let f32 = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) f32[i] = Math.max(-1, i16[i] / 32768);
  f32 = resampleF32(f32, RT_RATE, rt.playbackCtx.sampleRate);
  if (!f32.length) return;
  const buf = rt.playbackCtx.createBuffer(1, f32.length, rt.playbackCtx.sampleRate);
  buf.copyToChannel(f32, 0);
  const src = rt.playbackCtx.createBufferSource();
  src.buffer = buf;
  src.connect(rt.gain);
  const t = Math.max(rt.playbackCtx.currentTime + 0.02, rt.nextTime);
  src.start(t);
  rt.nextTime = t + buf.duration;
  rt.activeSources.push(src);
  src.onended = () => { rt.activeSources = rt.activeSources.filter((x) => x !== src); };
}

async function rtConnect() {
  const st = $("rt-status");
  const key = getKey();
  if (!key) { setStatus(st, "Save your API key above first.", "err"); return; }
  if (rt.ws) return;

  setStatus(st, "Requesting microphone…");
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
  } catch {
    setStatus(st, "Microphone permission denied — allow mic access and try again.", "err");
    return;
  }
  rt.stream = stream;

  const transcriptionOnly = /scribe|transcribe/i.test($("rt-model").value);
  const model = $("rt-model").value;
  const wsUrl = `wss://gen.pollinations.ai/v1/realtime?model=${encodeURIComponent(model)}&key=${encodeURIComponent(key)}`;

  setStatus(st, "Connecting…");
  const ws = new WebSocket(wsUrl);
  rt.ws = ws;

  ws.onopen = () => {
    const session = {
      type: "realtime",
      instructions: $("rt-instructions").value.trim() || "You are a helpful voice assistant.",
      modalities: transcriptionOnly ? ["text"] : ["text", "audio"],
      voice: $("rt-voice").value || "nova",
      input_audio_format: "pcm16",
      output_audio_format: "pcm16",
      input_audio_transcription: { model: "gpt-transcribe" },
      turn_detection: { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 600 },
    };
    if (transcriptionOnly) session.type = "transcription";
    ws.send(JSON.stringify({ type: "session.update", session }));
  };

  ws.onerror = () => setStatus(st, "WebSocket error — check your key balance and connection.", "err");
  ws.onclose = (ev) => {
    setStatus(st, `Disconnected${ev.reason ? `: ${ev.reason}` : ""}.`);
    rtCleanup();
  };

  ws.onmessage = (msg) => {
    let ev;
    try { ev = JSON.parse(msg.data); } catch { return; }
    switch (ev.type) {
      case "session.created":
      case "session.updated":
        if (ev.type === "session.updated" && !rt.sessionReady) {
          rt.sessionReady = true;
          setStatus(st, "✅ Live — start talking. (barge-in supported)", "ok");
          $("rt-disconnect").disabled = false;
          $("rt-connect").disabled = true;
        }
        break;
      case "input_audio_buffer.speech_started":
        rtStopPlayback();
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (ev.transcript) rtLog("user", "🧑 " + ev.transcript);
        break;
      case "response.audio_transcript.delta":
      case "response.output_audio_transcript.delta":
        if (!rt.assistantBubble) rt.assistantBubble = rtLog("assistant", "🤖 ");
        rt.assistantBubble.textContent += ev.delta || "";
        $("rt-log").scrollTop = $("rt-log").scrollHeight;
        break;
      case "response.audio_transcript.done":
      case "response.output_audio_transcript.done":
        if (rt.assistantBubble && ev.transcript) rt.assistantBubble.textContent = "🤖 " + ev.transcript;
        rt.assistantBubble = null;
        break;
      case "response.audio.delta":
      case "response.output_audio.delta":
        if (ev.delta && rt.playbackCtx) rtPlayDelta(ev.delta);
        break;
      case "response.done":
        rt.assistantBubble = null;
        break;
      case "input_audio_buffer.committed":
      case "conversation.item.created":
        if (ev.type === "conversation.item.created" && ev.item?.role === "user" && ev.item?.formatted?.transcript) {
          rtLog("user", "🧑 " + ev.item.formatted.transcript);
        }
        break;
      case "error":
        rtLog("system-note", "⚠ " + (ev.error?.message || JSON.stringify(ev)));
        setStatus(st, ev.error?.message || "Realtime error", "err");
        break;
      default:
        break;
    }
  };

  // Capture pipeline: mic → AudioWorklet → downsample to 24kHz PCM16 → base64 → WS
  try {
    rt.captureCtx = new (window.AudioContext || window.webkitAudioContext)();
    const workletCode = `
      class PCMCapture extends AudioWorkletProcessor {
        process(inputs) {
          const ch = inputs[0] && inputs[0][0];
          if (ch && ch.length) this.port.postMessage(ch.slice(0));
          return true;
        }
      }
      registerProcessor("pcm-capture", PCMCapture);`;
    const workletUrl = URL.createObjectURL(new Blob([workletCode], { type: "application/javascript" }));
    await rt.captureCtx.audioWorklet.addModule(workletUrl);
    rt.source = rt.captureCtx.createMediaStreamSource(stream);
    rt.worklet = new AudioWorkletNode(rt.captureCtx, "pcm-capture");
    rt.source.connect(rt.worklet);
    rt.worklet.port.onmessage = (e) => {
      const samples = e.data;
      // mic level meter
      let sum = 0;
      for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
      const rms = Math.sqrt(sum / samples.length);
      $("rt-meter").style.width = Math.min(100, Math.round(rms * 400)) + "%";
      if (!rt.sessionReady || !rt.ws || rt.ws.readyState !== 1) return;
      const down = resampleF32(samples, rt.captureCtx.sampleRate, RT_RATE);
      const i16 = new Int16Array(down.length);
      for (let i = 0; i < down.length; i++) {
        const s = Math.max(-1, Math.min(1, down[i]));
        i16[i] = s < 0 ? s * 32768 : s * 32767;
      }
      rt.ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: base64FromBytes(new Uint8Array(i16.buffer)) }));
    };

    // Playback: PCM16 deltas → buffers → MediaStreamDestination → <audio> element
    // (the <audio> element is what the browser uses as the echo-cancellation reference)
    try { rt.playbackCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: RT_RATE }); }
    catch { rt.playbackCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    rt.gain = rt.playbackCtx.createGain();
    const dest = rt.playbackCtx.createMediaStreamDestination();
    rt.gain.connect(dest);
    const player = $("rt-player");
    player.srcObject = dest.stream;
    player.play().catch(() => {});
  } catch (e) {
    setStatus(st, "Audio setup failed in this browser: " + e.message, "err");
    rtCleanup();
  }
}

function rtCleanup() {
  rt.sessionReady = false;
  rt.assistantBubble = null;
  rtStopPlayback();
  if (rt.ws) { try { rt.ws.close(); } catch {} rt.ws = null; }
  if (rt.worklet) { try { rt.worklet.port.onmessage = null; rt.worklet.disconnect(); } catch {} rt.worklet = null; }
  if (rt.source) { try { rt.source.disconnect(); } catch {} rt.source = null; }
  if (rt.captureCtx) { try { rt.captureCtx.close(); } catch {} rt.captureCtx = null; }
  if (rt.playbackCtx) { try { rt.playbackCtx.close(); } catch {} rt.playbackCtx = null; }
  if (rt.stream) { rt.stream.getTracks().forEach((t) => t.stop()); rt.stream = null; }
  $("rt-meter").style.width = "0%";
  $("rt-disconnect").disabled = true;
  $("rt-connect").disabled = false;
  const player = $("rt-player");
  if (player) { player.srcObject = null; }
}

function initRealtime() {
  $("rt-connect").onclick = rtConnect;
  $("rt-disconnect").onclick = () => {
    if (rt.ws) rt.ws.close();
    rtCleanup();
    setStatus($("rt-status"), "Session ended.");
  };
  window.addEventListener("beforeunload", rtCleanup);
}

/* ---------------- EMBEDDINGS ---------------- */

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

async function runEmbeddings() {
  const st = $("emb-status");
  const lines = $("emb-input").value.split("\n").map((s) => s.trim()).filter(Boolean);
  if (!lines.length) { setStatus(st, "Enter at least one line of text.", "err"); return; }
  if (lines.length > 32) { setStatus(st, "Maximum 32 inputs per batch.", "err"); return; }
  if (!getKey()) { setStatus(st, "Save your API key above first.", "err"); return; }

  const model = $("emb-model").value;
  const body = { model, input: lines.length === 1 ? lines[0] : lines };
  const dims = parseInt($("emb-dimensions").value, 10);
  if (dims) body.dimensions = dims;
  const task = $("emb-task-type").value;
  if (task) {
    if (/cohere/i.test(model)) body.input_type = task.startsWith("RETRIEVAL_QUERY") ? "query" : task.startsWith("RETRIEVAL_DOCUMENT") ? "document" : undefined;
    else if (/gemini/i.test(model)) body.task_type = task;
  }

  $("emb-run").disabled = true;
  setStatus(st, "Embedding…");
  try {
    const res = await fetch(`${GEN}/v1/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await apiError(res);
    const j = await res.json();
    const data = (j.data || []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const vectors = data.map((d) => d.embedding);

    const out = $("emb-output");
    out.innerHTML = "";
    for (let i = 0; i < vectors.length; i++) {
      const v = vectors[i] || [];
      const div = document.createElement("div");
      div.className = "emb-vector";
      const preview = v.slice(0, 8).map((x) => Number(x).toFixed(4)).join(", ");
      div.innerHTML = `<div class="emb-label">#${i + 1} · ${esc(lines[i] || "")} <span class="muted">(${v.length} dimensions${dims ? `, requested ${dims}` : ""})</span></div><pre>[${preview}, …]</pre>`;
      out.appendChild(div);
    }

    if (vectors.length >= 2) {
      const wrap = document.createElement("div");
      let html = '<h4 style="margin:6px 0">Cosine similarity</h4><table class="sim-table"><thead><tr><th></th>';
      lines.forEach((l) => { html += `<th title="${esc(l)}">${esc(l.slice(0, 24))}${l.length > 24 ? "…" : ""}</th>`; });
      html += "</tr></thead><tbody>";
      for (let r = 0; r < vectors.length; r++) {
        html += `<tr><th title="${esc(lines[r])}">${esc(lines[r].slice(0, 24))}${lines[r].length > 24 ? "…" : ""}</th>`;
        for (let c = 0; c < vectors.length; c++) {
          const sim = cosine(vectors[r], vectors[c]);
          const alpha = Math.max(0, sim).toFixed(2);
          const color = r === c ? "rgba(124,167,255,0.25)" : `rgba(114,242,182,${0.08 + alpha * 0.55})`;
          html += `<td style="background:${color}">${sim.toFixed(3)}</td>`;
        }
        html += "</tr>";
      }
      html += "</tbody></table>";
      wrap.innerHTML = html;
      out.appendChild(wrap);
    }

    setStatus(st, `✅ ${vectors.length} embedding${vectors.length === 1 ? "" : "s"} from ${model}${j.usage ? ` · ${j.usage.total_tokens ?? j.usage.prompt_tokens ?? "?"} tokens` : ""}.`, "ok");
  } catch (e) {
    setStatus(st, networkHelp(e), "err");
  } finally {
    $("emb-run").disabled = false;
  }
}

function initEmbeddings() { $("emb-run").onclick = runEmbeddings; }

/* ---------------- MODELS catalog ---------------- */

function describeModel(m) {
  const r = m.raw || {};
  // modalities
  const mods = new Set();
  const push = (v) => v && mods.add(String(v));
  if (typeof r.type === "string") push(r.type);
  if (typeof r.category === "string") push(r.category);
  [r.modalities, r.input_modalities, r.output_modalities].forEach((x) => {
    if (Array.isArray(x)) x.forEach(push);
    else if (x && typeof x === "object") Object.entries(x).forEach(([k, v]) => { if (v && v !== false) push(k); });
  });
  if (r.owned_by && !mods.size) push(r.owned_by === "pollinations" ? "official" : "community");
  if (m.id.includes("/")) push("community");
  // capabilities
  const caps = [];
  const capSrc = r.capabilities || r.traits || {};
  if (Array.isArray(capSrc)) capSrc.forEach((c) => caps.push(c));
  else Object.entries(capSrc).forEach(([k, v]) => { if (v) caps.push(k.replace(/_/g, " ")); });
  ["tool_calling", "reasoning", "web_search", "code_execution", "vision"].forEach((k) => { if (r[k] === true) caps.push(k.replace(/_/g, " ")); });
  // pricing
  let pricing = "";
  const p = r.pricing || r.price || r.cost;
  if (p && typeof p === "object") {
    pricing = Object.entries(p)
      .filter(([, v]) => v !== null && v !== undefined && v !== false)
      .map(([k, v]) => `${k.replace(/_/g, " ")}: ${typeof v === "number" ? v.toPrecision(3) : v}`)
      .join(" · ");
  } else if (p !== undefined && p !== null) pricing = String(p);
  else if (r.free === true) pricing = "free";
  return { mods: [...mods], caps: [...new Set(caps)], pricing };
}

async function loadModelsTable() {
  const st = $("models-status");
  const tbody = $("models-tbody");
  const filter = $("models-filter").value;
  let url = `${GEN}/models`;
  if (filter === "official") url += "?community=false";
  if (filter === "community") url += "?community=true";
  setStatus(st, "Loading catalog…");
  tbody.innerHTML = '<tr><td colspan="4">Loading…</td></tr>';
  try {
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) throw await apiError(res);
    const models = normalizeModelList(await res.json());
    tbody.innerHTML = "";
    if (!models.length) {
      tbody.innerHTML = '<tr><td colspan="4">No models returned for this filter.</td></tr>';
    }
    for (const m of models) {
      const d = describeModel(m);
      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td>${esc(m.id)}</td>` +
        `<td>${d.mods.length ? d.mods.map((x) => `<span class="mod-chip">${esc(x)}</span>`).join("") : '<span class="muted">—</span>'}</td>` +
        `<td>${d.caps.length ? d.caps.map((x) => `<span class="cap-chip">${esc(x)}</span>`).join("") : '<span class="muted">—</span>'}</td>` +
        `<td class="muted">${esc(d.pricing || "see docs")}</td>`;
      tbody.appendChild(tr);
    }
    setStatus(st, `✅ ${models.length} model${models.length === 1 ? "" : "s"} loaded.`, "ok");
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="4">Could not load the catalog.</td></tr>';
    setStatus(st, networkHelp(e), "err");
  }
}

function initModels() {
  $("models-refresh").onclick = loadModelsTable;
  $("models-filter").addEventListener("change", loadModelsTable);
  document.querySelector('.studio-tabs [data-tab="models"]').addEventListener("click", loadModelsTable);
}

/* ---------------- boot ---------------- */

initTabs();
initKeyBar();
initText();
initImage();
initVideo();
initAudio();
initRealtime();
initEmbeddings();
initModels();
refreshModelSelects();
