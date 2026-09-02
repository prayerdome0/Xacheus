/**
 * Transitional stub — the Supabase package has been removed and replaced with Firebase.
 * This stub keeps imports working for pages that have not yet been fully rewritten
 * to Firestore. It returns empty/default results so the UI does not crash.
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

export function storagePath(_scope: string, _sub: string, filename: string): string {
  const safe = filename.replace(/[^\w.\-]+/g, '_').slice(-80);
  return `${_scope}/${_sub}/${Date.now()}-${safe}`;
}

export async function uploadFile(
  _bucket: Bucket,
  _path: string,
  _file: File | Blob,
  _opts?: { upsert?: boolean; contentType?: string },
): Promise<{ path: string; url: string | null }> {
  return { path: _path, url: null };
}

export async function signedUrl(_bucket: Bucket, _path: string, _expiresSeconds?: number): Promise<string | null> {
  return null;
}

export async function removeFile(_bucket: Bucket, _path: string): Promise<void> {
  // best-effort no-op
}

export class RpcError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'RpcError';
  }
  get reason(): string { return this.message; }
  get isPermission(): boolean { return false; }
  get isNotFound(): boolean { return false; }
}

export async function rpc<T>(_fn: string, _args?: Record<string, unknown>): Promise<T> {
  throw new Error(`RPC ${_fn} is no longer available — the backend has moved to Firebase.`);
}

export const supabase = {
  from: () => ({
    select: () => ({
      eq: () => ({
        order: () => ({
          limit: () => Promise.resolve({ data: [], error: null }),
        }),
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        single: () => Promise.resolve({ data: null, error: null }),
      }),
      is: () => ({
        eq: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
      not: () => ({
        eq: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      }),
      or: () => ({
        eq: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      }),
      ilike: () => ({
        order: () => ({
          limit: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
    insert: () => Promise.resolve({ data: null, error: null }),
    update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
    delete: () => ({ eq: () => ({ then: () => Promise.resolve({ data: null, error: null }), catch: () => Promise.resolve({ data: null, error: null }) }) }),
    upsert: () => Promise.resolve({ data: null, error: null }),
    rpc: () => Promise.resolve({ data: null, error: null }),
  }),
  storage: {
    from: () => ({
      upload: async () => ({ data: { path: '' }, error: null }),
      createSignedUrl: () => Promise.resolve({ data: { signedUrl: null }, error: null }),
      remove: () => Promise.resolve({ data: null, error: null }),
      getPublicUrl: () => ({ data: { publicUrl: null } }),
    }),
  },
  auth: {
    signOut: async () => ({ error: null }),
  },
  channel: () => ({
    on: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }),
  }),
  removeChannel: () => Promise.resolve(),
};
