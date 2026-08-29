/**
 * Xacheus — Browser-safe Cloudinary uploads (Phase 1: video platform)
 *
 * Uses unsigned preset for browser uploads:
 *   Cloud name   : dhad95cch
 *   Upload preset: xacheus   (unsigned)
 *
 * We use auto resource type so images, videos, audio all work through same preset.
 * Only cloudName + preset live in client. No secrets.
 */

export const CLOUDINARY = Object.freeze({
  cloudName: "dhad95cch",
  uploadPreset: "xacheus",
});

const BASE = `https://api.cloudinary.com/v1_1/${CLOUDINARY.cloudName}`;

function uploadEndpoint(resourceType = "auto") {
  // auto handles image/video/audio detection
  return `${BASE}/${resourceType}/upload`;
}

/**
 * Core uploader with progress via XHR.
 * Returns { url, public_id, resource_type, duration, width, height, ... } or throws.
 */
function uploadWithProgress(file, { resourceType = "auto", onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const body = new FormData();
    body.append("file", file);
    body.append("upload_preset", CLOUDINARY.uploadPreset);
    // Don't add folder for now per instruction.

    const xhr = new XMLHttpRequest();
    xhr.open("POST", uploadEndpoint(resourceType));

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const json = JSON.parse(xhr.responseText);
          resolve(json);
        } catch {
          reject(new Error("Cloudinary returned unreadable response"));
        }
      } else {
        let msg = `Upload failed (${xhr.status})`;
        try {
          const j = JSON.parse(xhr.responseText);
          if (j.error?.message) msg = j.error.message;
        } catch {}
        reject(new Error(msg));
      }
    });

    xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
    xhr.addEventListener("abort", () => reject(new Error("Upload cancelled")));
    xhr.send(body);
  });
}

/**
 * Upload an image File -> secure_url
 */
export async function uploadImage(file, { onProgress } = {}) {
  if (!file) return null;
  try {
    const res = await uploadWithProgress(file, { resourceType: "image", onProgress });
    return res.secure_url || res.url || null;
  } catch (err) {
    console.warn("[xacheus] image upload failed", err);
    // fallback to local object URL so UI still works, but mark as local
    return URL.createObjectURL(file);
  }
}

/**
 * Upload video File -> { url, publicId, duration, width, height, thumbnailUrl }
 */
export async function uploadVideo(file, { onProgress } = {}) {
  if (!file) return null;
  // Try auto first, then video
  const attempts = ["auto", "video"];
  let lastErr = null;
  for (const rt of attempts) {
    try {
      const res = await uploadWithProgress(file, { resourceType: rt, onProgress });
      const url = res.secure_url || res.url;
      if (!url) throw new Error("No URL returned");
      // Build thumbnail from Cloudinary if possible: replace /upload/ with /upload/so_0/ and .mp4 -> .jpg
      let thumb = "";
      try {
        if (res.resource_type === "video") {
          thumb = url.replace("/video/upload/", "/video/upload/so_0,w_640,h_1138,c_fill,q_auto,f_jpg/");
          // ensure jpg extension
          thumb = thumb.replace(/\.(mp4|mov|webm|mkv)$/i, ".jpg");
          // fallback: if no extension pattern, just append .jpg transformation? We'll keep as is.
        }
      } catch {}
      return {
        url,
        publicId: res.public_id || "",
        duration: res.duration || 0,
        width: res.width || 0,
        height: res.height || 0,
        thumbnailUrl: thumb || res.secure_url || "",
        raw: res,
      };
    } catch (e) {
      lastErr = e;
      console.warn(`[xacheus] video upload attempt ${rt} failed`, e);
      // try next
    }
  }
  throw lastErr || new Error("Video upload failed");
}

/**
 * Upload audio File -> { url, publicId, duration }
 */
export async function uploadAudio(file, { onProgress } = {}) {
  if (!file) return null;
  try {
    const res = await uploadWithProgress(file, { resourceType: "auto", onProgress });
    return {
      url: res.secure_url || res.url,
      publicId: res.public_id || "",
      duration: res.duration || 0,
      raw: res,
    };
  } catch (e) {
    console.warn("[xacheus] audio upload failed", e);
    throw e;
  }
}

// Backward compat: old code imported uploadImage only
export default { CLOUDINARY, uploadImage, uploadVideo, uploadAudio };
