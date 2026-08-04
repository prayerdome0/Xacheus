// Public, browser-safe Cloudinary configuration for storefront media.
// The `website_store` upload preset controls the destination folder
// (`samples/ecommerce`) in Cloudinary. Never put an API secret in this file.
export const CLOUDINARY_CLOUD_NAME = "dhad95cch";
export const CLOUDINARY_UPLOAD_PRESET = "website_store";

const UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

/**
 * Upload an image directly from the browser using the unsigned store preset.
 * Returns the durable HTTPS delivery URL saved with the store record.
 */
export async function uploadStoreImage(file) {
  if (!(file instanceof File) || !file.type.startsWith("image/")) {
    throw new Error("Please choose a JPG, PNG, WebP, GIF, or other image file.");
  }
  if (file.size > MAX_IMAGE_SIZE) {
    throw new Error("Image files must be 10 MB or smaller.");
  }

  const body = new FormData();
  body.append("file", file);
  body.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

  const response = await fetch(UPLOAD_URL, { method: "POST", body });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.secure_url) {
    throw new Error(result.error?.message || "Image upload failed. Please try again.");
  }
  return result.secure_url;
}
