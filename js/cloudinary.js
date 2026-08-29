/**
 * Browser-safe image uploads.
 *
 * Xacheus Social posts, avatars and covers are uploaded straight from the
 * browser using an unsigned Cloudinary preset.
 *
 *   Cloud name   : dhad95cch
 *   Upload preset: xacheus   (signing mode: Unsigned)
 *
 * Only the cloud name and the preset name are public. Never put an API key,
 * an API secret, or CLOUDINARY_URL in this file or anywhere in the client.
 */

export const CLOUDINARY = Object.freeze({
  cloudName: "dhad95cch",
  uploadPreset: "xacheus",
});

const ENDPOINT = `https://api.cloudinary.com/v1_1/${CLOUDINARY.cloudName}/image/upload`;

/**
 * Upload an image File and resolve with its secure URL.
 * Falls back to a local object URL when the upload fails so the UI still works.
 */
export async function uploadImage(file, { onProgress } = {}) {
  if (!file) return null;

  const body = new FormData();
  body.append("file", file);
  body.append("upload_preset", CLOUDINARY.uploadPreset);

  try {
    const url = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", ENDPOINT);
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable && onProgress) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      });
      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const json = JSON.parse(xhr.responseText);
            resolve(json.secure_url || json.url || null);
          } catch (error) {
            reject(new Error("Cloudinary returned an unreadable response."));
          }
        } else {
          reject(new Error(`Upload failed (${xhr.status}).`));
        }
      });
      xhr.addEventListener("error", () => reject(new Error("Network error during upload.")));
      xhr.addEventListener("abort", () => reject(new Error("Upload cancelled.")));
      xhr.send(body);
    });

    if (url) return url;
  } catch (error) {
    console.warn("[xacheus] image upload failed:", error);
  }

  // Offline / misconfigured preset: still let the user post with a local preview.
  return URL.createObjectURL(file);
}
