import { isCloudinaryConfigured } from './env';
import { cloudinaryUpload } from './cloudinary';
import { BUCKETS, storagePath, uploadFile, removeFile, type Bucket } from './supabase';

/**
 * Upload abstraction.
 *
 * Media is uploaded to Cloudinary (unsigned preset, no folders) when the public
 * config is present, otherwise it falls back to the legacy Supabase Storage
 * bucket so a fresh clone with only Firebase still works. The DB stores the
 * returned `url`; `path` and `provider` let us remove the file later.
 */

export type MediaProvider = 'cloudinary' | 'supabase';

export interface MediaUpload {
  url: string;
  path: string;
  name: string;
  size: number;
  type?: string;
  provider: MediaProvider;
}

export async function uploadMediaFile(spec: {
  file: File;
  bucket: Bucket;
  scope: string;
  sub?: string;
}): Promise<MediaUpload> {
  if (isCloudinaryConfigured) {
    const res = await cloudinaryUpload(spec.file);
    return { ...res, provider: 'cloudinary' };
  }

  const path = storagePath(spec.scope, spec.sub ?? 'general', spec.file.name);
  const res = await uploadFile(spec.bucket, path, spec.file, { contentType: spec.file.type });
  if (!res.url) throw new Error('That bucket is private; images must go to a public bucket.');
  return { url: res.url, path: res.path, name: spec.file.name, size: spec.file.size, provider: 'supabase' };
}

/**
 * Remove a media object.
 *
 * Cloudinary unsigned uploads cannot be deleted from the browser (that needs
 * the API secret, which never ships to the client), so for Cloudinary we simply
 * drop the reference — the asset is garbage-collected by a server-side job
 * later. Supabase storage objects are removed as before.
 */
export async function removeMediaFile(u: {
  path: string;
  provider?: MediaProvider;
  bucket?: Bucket;
}): Promise<void> {
  if (u.provider === 'cloudinary') return;
  if (u.bucket) await removeFile(u.bucket, u.path);
}

export { BUCKETS, type Bucket };
