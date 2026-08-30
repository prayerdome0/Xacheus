/**
 * Xacheus — Firebase Storage media uploads (replaces Cloudinary).
 *
 * All user media (images, photos, videos, audio, live segments and
 * thumbnails) live in Firebase Storage. This module exposes the same small
 * API the rest of the app used with Cloudinary — `uploadImage`,
 * `uploadVideo`, `uploadAudio` — so call sites needed only an import change.
 *
 * Storage layout:
 *   uploads/{uid}/{kind}/{timestamp}-{random}.{ext}
 *     kind: images | thumbnails | videos | audio
 *
 * Security lives in `storage.rules` (deployed with `firebase deploy`). We also
 * enforce a client-side size/type guard here as a courtesy — the rules are the
 * real gate. No secrets live in the client.
 */

import {
  getStorage,
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";
import { firebaseApp, auth } from "./firebase.js";

export const storage = getStorage(firebaseApp);

/* ------------------------------------------------------------------ */
/* path + type helpers                                                 */
/* ------------------------------------------------------------------ */

function safeExt(name, fallback) {
  const raw = String(name || "").split(".").pop() || "";
  const clean = raw.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return clean || fallback;
}

function ownerPrefix() {
  const uid = auth?.currentUser?.uid || "anon";
  return uid.replace(/[^a-zA-Z0-9_-]/g, "");
}

function mediaName(file, kind) {
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 10);
  const ext =
    kind === "images" || kind === "thumbnails" || kind === "stories"
      ? safeExt(file?.name, "jpg")
      : kind === "videos"
        ? safeExt(file?.name, "mp4")
        : kind === "documents"
          ? safeExt(file?.name, "bin")
          : safeExt(file?.name, "mp3");
  return `${stamp}-${rand}.${ext}`;
}

function mediaPath(file, kind) {
  return `uploads/${ownerPrefix()}/${kind}/${mediaName(file, kind)}`;
}

/* ------------------------------------------------------------------ */
/* core resumable uploader                                             */
/* ------------------------------------------------------------------ */

/**
 * Upload a File/Blob to Storage with progress. Resolves
 * { url, path } or rejects.
 */
function uploadResumable(file, kind, onProgress) {
  const path = mediaPath(file, kind);
  const fileRef = ref(storage, path);
  const task = uploadBytesResumable(fileRef, file, {
    contentType: file?.type || "application/octet-stream",
  });

  return new Promise((resolve, reject) => {
    task.on(
      "state_changed",
      (snap) => {
        if (onProgress && snap.totalBytes) {
          onProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
        }
      },
      (err) => {
        console.warn("[xacheus] storage upload error", err);
        reject(normaliseStorageError(err));
      },
      async () => {
        try {
          const url = await getDownloadURL(fileRef);
          resolve({ url, path });
        } catch (err) {
          reject(normaliseStorageError(err));
        }
      }
    );
  });
}

function normaliseStorageError(error) {
  const code = String(error?.code || "");
  const msg = String(error?.message || "");
  if (code === "storage/unauthorized" || msg.includes("Unauthorized")) {
    return new Error("Storage permission denied — deploy storage.rules to your Firebase project.");
  }
  if (code === "storage/quota-exceeded") {
    return new Error("Storage quota reached. Try a smaller file.");
  }
  if (code === "storage/retry-limit-exceeded" || code === "storage/server-file-wrong-size") {
    return new Error("Upload failed on a slow connection. Please try again.");
  }
  if (msg.includes("bucket") && msg.includes("not found")) {
    return new Error("Firebase Storage isn't enabled for this project yet. Enable it, then try again.");
  }
  if (msg.toLowerCase().includes("network")) {
    return new Error("Network error while uploading. Check your connection.");
  }
  return error instanceof Error ? error : new Error(msg || "Upload failed.");
}

/* ------------------------------------------------------------------ */
/* metadata helpers                                                    */
/* ------------------------------------------------------------------ */

function loadVideoMeta(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    let settled = false;
    const done = (data) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(data);
    };
    video.onloadedmetadata = () =>
      done({ duration: video.duration || 0, width: video.videoWidth || 0, height: video.videoHeight || 0 });
    video.onerror = () => done({ duration: 0, width: 0, height: 0 });
    video.src = url;
  });
}

function loadAudioDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(value);
    };
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? audio.duration : 0);
    audio.onerror = () => done(0);
    audio.src = url;
  });
}

/** Grab a representative JPEG frame from a video File, or null. */
function generateVideoThumbnail(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    let settled = false;
    const finish = (blob) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      video.remove();
      resolve(blob);
    };

    const draw = () => {
      try {
        const maxW = 640;
        const w = video.videoWidth || maxW;
        const h = video.videoHeight || maxW;
        const scale = Math.min(1, maxW / Math.max(1, w));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((b) => finish(b || null), "image/jpeg", 0.72);
      } catch {
        finish(null);
      }
    };

    video.onloadeddata = draw;
    video.onseeked = draw;
    video.onerror = () => finish(null);
    video.addEventListener("loadedmetadata", () => {
      // Seek a fraction into the clip so the poster isn't a black frame.
      const target = Math.min(0.5, Math.max(0.1, (video.duration || 1) * 0.05));
      try {
        video.currentTime = target;
      } catch {
        /* ignore */
      }
    });
    video.src = url;
  });
}

/* ------------------------------------------------------------------ */
/* public uploads                                                      */
/* ------------------------------------------------------------------ */

/**
 * Upload an image -> secure download URL.
 * `strict: true` (the default) throws on failure so a broken `blob:` URL can
 * never be persisted to Firestore. `strict: false` falls back to a temporary
 * local object URL for one-shot previews only.
 */
export async function uploadImage(file, { onProgress, strict = true } = {}) {
  if (!file) return null;
  try {
    const res = await uploadResumable(file, "images", onProgress);
    return res.url;
  } catch (err) {
    console.warn("[xacheus] image upload failed", err);
    if (strict) throw err;
    return URL.createObjectURL(file);
  }
}

/**
 * Upload a video File -> { url, path, publicId, duration, width, height,
 * thumbnailUrl }. The thumbnail is generated client-side and uploaded to
 * Storage, so video cards never rely on a missing poster.
 */
export async function uploadVideo(file, { onProgress, noThumbnail = false } = {}) {
  if (!file) return null;

  // Upload the video itself.
  const videoRes = await uploadResumable(file, "videos", onProgress);

  if (noThumbnail) {
    return {
      url: videoRes.url,
      path: videoRes.path,
      publicId: videoRes.path,
      duration: 0,
      width: 0,
      height: 0,
      thumbnailUrl: videoRes.url,
      raw: { path: videoRes.path },
    };
  }

  // Read metadata so we can stamp duration / dimensions on the post.
  const meta = await loadVideoMeta(file).catch(() => ({ duration: 0, width: 0, height: 0 }));

  // Try to generate + upload a poster frame (best effort).
  let thumbnailUrl = "";
  try {
    const thumbBlob = await generateVideoThumbnail(file);
    if (thumbBlob) {
      const thumbRes = await uploadResumable(
        new File([thumbBlob], "poster.jpg", { type: "image/jpeg" }),
        "thumbnails"
      );
      thumbnailUrl = thumbRes.url;
    }
  } catch (err) {
    console.warn("[xacheus] video thumbnail failed", err);
  }

  return {
    url: videoRes.url,
    path: videoRes.path,
    publicId: videoRes.path,
    duration: meta.duration,
    width: meta.width,
    height: meta.height,
    thumbnailUrl: thumbnailUrl || videoRes.url,
    raw: { path: videoRes.path },
  };
}

/**
 * Upload an audio File -> { url, path, publicId, duration }.
 */
export async function uploadAudio(file, { onProgress } = {}) {
  if (!file) return null;
  const res = await uploadResumable(file, "audio", onProgress);
  const duration = await loadAudioDuration(file).catch(() => 0);
  return { url: res.url, path: res.path, publicId: res.path, duration, raw: { path: res.path } };
}

/**
 * Upload story media. Photos land in uploads/{uid}/stories, clips in
 * uploads/{uid}/videos (already covered by storage.rules) — either way the
 * path prefix belongs to this account only.
 */
export async function uploadStoryMedia(file, { onProgress } = {}) {
  if (!file) throw new Error("Choose a photo or video first.");
  const isVideo = String(file.type || "").startsWith("video/");
  const res = await uploadResumable(file, isVideo ? "videos" : "stories", onProgress);
  const meta = isVideo ? await loadVideoMeta(file).catch(() => ({ duration: 0, width: 0, height: 0 })) : { duration: 0, width: 0, height: 0 };
  return { url: res.url, path: res.path, kind: isVideo ? "video" : "photo", ...meta };
}

/**
 * Attach a file to a direct message (photo, clip, audio or document).
 * Documents get their real file name back so the bubble can show it.
 */
export async function uploadChatAttachment(file, { onProgress } = {}) {
  if (!file) throw new Error("Choose a file first.");
  const type = String(file.type || "");
  const kind = type.startsWith("image/")
    ? "images"
    : type.startsWith("video/")
      ? "videos"
      : type.startsWith("audio/")
        ? "audio"
        : "documents";
  const res = await uploadResumable(file, kind, onProgress);
  const meta =
    kind === "videos"
      ? await loadVideoMeta(file).catch(() => ({ duration: 0, width: 0, height: 0 }))
      : kind === "images"
        ? await loadImageMeta(file).catch(() => ({ width: 0, height: 0 }))
        : {};
  return {
    url: res.url,
    path: res.path,
    kind: kind === "images" ? "image" : kind === "videos" ? "video" : kind === "audio" ? "audio" : "file",
    name: String(file.name || "attachment").slice(0, 120),
    size: Number(file.size) || 0,
    mimeType: type,
    width: Number(meta.width) || 0,
    height: Number(meta.height) || 0,
    duration: Number(meta.duration) || 0,
  };
}

function loadImageMeta(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth || 0, height: img.naturalHeight || 0 });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unreadable image"));
    };
    img.src = url;
  });
}

/** Remove a file from Storage (e.g. when a post/sound is deleted). */
export async function removeObject(path) {
  if (!path) return;
  try {
    await deleteObject(ref(storage, path));
  } catch {
    /* already gone or not ours — ignore */
  }
}

export default { storage, uploadImage, uploadVideo, uploadAudio, uploadStoryMedia, uploadChatAttachment, removeObject };
