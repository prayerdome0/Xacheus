import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabaseAnonKey, supabaseUrl } from './env';

/** @deprecated Legacy Supabase data layer. Replaced by Firebase in Phase 1+. */

/**
 * Single Supabase client for the whole app.
 *
 * When credentials are missing (fresh clone, no .env) we still export a client
 * pointed at a placeholder URL so imports never crash. The app's FirebaseGate
 * blocks identity work before the legacy layer is reached. Nothing is faked.
 */
const placeholderUrl = 'https://not-configured.supabase.co';
const placeholderKey = 'not-configured-publishable-key';

export const supabase: SupabaseClient = createClient(
  isSupabaseConfigured ? supabaseUrl : placeholderUrl,
  isSupabaseConfigured ? supabaseAnonKey : placeholderKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'seedwel-hub-auth',
    },
    global: {
      headers: { 'x-seedwel-client': 'web' },
    },
    realtime: { params: { eventsPerSecond: 4 } },
  },
);

/** Storage buckets (created by supabase/sql/0011_seed.sql). */
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

/** Build the conventional object path: <scope>/<sub>/<filename>. */
export function storagePath(scope: string, sub: string, filename: string): string {
  const safe = filename.replace(/[^\w.\-]+/g, '_').slice(-80);
  return `${scope}/${sub}/${Date.now()}-${safe}`;
}

/** Upload a file and return its public URL (public buckets) or path (private). */
export async function uploadFile(
  bucket: Bucket,
  path: string,
  file: File | Blob,
  opts: { upsert?: boolean; contentType?: string } = {},
): Promise<{ path: string; url: string | null }> {
  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(path, file, {
      upsert: opts.upsert ?? true,
      contentType: opts.contentType ?? (file.type || 'application/octet-stream'),
      cacheControl: '3600',
    });

  if (error) throw new Error(`Upload failed: ${error.message}`);

  const isPublic = bucket === BUCKETS.avatars || bucket === BUCKETS.businesses || bucket === BUCKETS.products;
  const url = isPublic ? supabase.storage.from(bucket).getPublicUrl(data.path).data.publicUrl : null;
  return { path: data.path, url };
}

/** Signed URL for a private object (documents, signatures, exports). */
export async function signedUrl(bucket: Bucket, path: string, expiresSeconds = 900): Promise<string | null> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresSeconds);
  if (error) return null;
  return data.signedUrl;
}

export async function removeFile(bucket: Bucket, path: string): Promise<void> {
  await supabase.storage.from(bucket).remove([path]);
}

/**
 * Call a Postgres RPC and unwrap errors consistently. All business-critical
 * operations (stock, checkout, payments, documents, search) are RPCs so their
 * logic lives in the database, not in the browser.
 */
export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new RpcError(fn, error.message, error.code, error.details);
  return data as T;
}

export class RpcError extends Error {
  constructor(
    public readonly fn: string,
    message: string,
    public readonly code?: string,
    public readonly details?: string,
  ) {
    super(message);
    this.name = 'RpcError';
  }

  /** Postgres RAISE messages arrive as "exception: <text>"; strip the noise. */
  get reason(): string {
    return this.message.replace(/^.*?exception:\s*/i, '').trim();
  }

  get isPermission(): boolean {
    return /permission_denied|42501|row-level security/i.test(this.message);
  }

  get isNotFound(): boolean {
    return /_not_found|PGRST116/.test(this.message);
  }
}
