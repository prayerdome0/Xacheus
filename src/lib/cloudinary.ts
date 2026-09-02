import { cloudinaryConfig, cloudinaryUploadUrl, isCloudinaryConfigured } from './env';

/**
 * Cloudinary media uploads (unsigned preset).
 *
 * Constraint from the user: Cloudinary has NO folders here. So we never send a
 * `folder` parameter, and the `public_id` we choose is flat (no `/`), which
 * means Cloudinary cannot create nested folders for these assets. The upload
 * preset is unsigned — the API secret never reaches the browser.
 */

export interface CloudinaryResult {
  url: string;
  path: string; // the public_id (flat, no folder)
  name: string;
  size: number;
  type?: string;
}

/** Produce a URL-safe, unambiguous public id with no slash (=> no folder). */
function flatPublicId(): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 12);
  return `sh_${stamp}_${rand}`;
}

export async function cloudinaryUpload(file: File): Promise<CloudinaryResult> {
  if (!isCloudinaryConfigured || !cloudinaryUploadUrl) {
    throw new Error('Cloudinary is not configured. Add VITE_CLOUDINARY_CLOUD_NAME and VITE_CLOUDINARY_PRESET.');
  }

  const form = new FormData();
  form.append('file', file);
  form.append('upload_preset', cloudinaryConfig.unsignedPreset);
  // No `folder` — Cloudinary is used without folders. The public_id has no
  // slash, so the asset always sits at the account root.
  form.append('public_id', flatPublicId());

  const res = await fetch(cloudinaryUploadUrl, { method: 'POST', body: form });
  const json = (await res.json().catch(() => ({}))) as {
    secure_url?: string;
    public_id?: string;
    error?: { message?: string };
  };

  if (!res.ok || json.error || !json.secure_url) {
    throw new Error(json.error?.message ?? 'Cloudinary upload failed. Please try again.');
  }

  return {
    url: json.secure_url,
    path: json.public_id ?? flatPublicId(),
    name: file.name,
    size: file.size,
    type: 'image',
  };
}
