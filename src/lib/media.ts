import { cloudinaryUpload } from './cloudinary';
import { isCloudinaryConfigured } from './env';

/**
 * Upload abstraction — Cloudinary only.
 *
 * Seedwel Hub keeps all public images/video on Cloudinary. The database stores
 * the Cloudinary URL of the finished asset; deleting an unsigned upload is a
 * server-side job (the API secret never ships to the browser), so removing a
 * media reference simply drops the URL.
 *
 * `BUCKETS` is kept as a vocabulary of logical media scopes (avatars, product
 * photos, business logos, documents…). Cloudinary's unsigned preset does not
 * need folders; the scope is used for the public_id prefix when the preset
 * allows it, and is otherwise descriptive.
 */

export const BUCKETS = {
  avatars: 'avatars',
  businesses: 'businesses',
  products: 'products',
  documents: 'documents',
  signatures: 'signatures',
  imports: 'imports',
  support: 'support',
  exports: 'exports',
} as const;

export type Bucket = (typeof BUCKETS)[keyof typeof BUCKETS];

/** A safe public_id fragment so the same file name never collides. */
export function storagePath(scope: string, sub: string, filename: string): string {
  const safe = filename.replace(/[^\w.-]+/g, '_').slice(-80);
  return `${scope}/${sub}/${Date.now()}-${safe}`;
}

export type MediaProvider = 'cloudinary';

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
  if (!isCloudinaryConfigured) {
    throw new Error('Cloudinary is not configured. Add VITE_CLOUDINARY_CLOUD_NAME and VITE_CLOUDINARY_PRESET to .env.');
  }
  const res = await cloudinaryUpload(spec.file);
  return {
    url: res.url,
    path: res.path ?? storagePath(spec.scope, spec.sub ?? 'general', spec.file.name),
    name: spec.file.name,
    size: spec.file.size,
    type: spec.file.type,
    provider: 'cloudinary',
  };
}

/**
 * Remove a media reference. Cloudinary unsigned uploads cannot be deleted from
 * the browser (that needs the API secret, which never ships to the client), so
 * we drop the reference only — a server-side job garbage-collects the asset.
 */
export async function removeMediaFile(_u: { path: string; provider?: string; bucket?: Bucket }): Promise<void> {
  return;
}

