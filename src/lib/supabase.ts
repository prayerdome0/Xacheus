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

/** Recursive chain interface so TypeScript accepts any query chain. */
function chainBuilder(_promiseValue?: unknown): any {
  const base = {
    select: (_columns?: string) => selectChain([]),
    insert: () => Promise.resolve({ data: null, error: null }),
    update: () => chainBuilder({ data: null, error: null }),
    delete: () => chainBuilder({ data: null, error: null }),
    upsert: () => Promise.resolve({ data: null, error: null }),
    rpc: () => Promise.resolve({ data: null, error: null }),
  };

  const selectChain = (val?: unknown) => ({
    eq: () => selectChain(val),
    is: () => selectChain(val),
    not: () => selectChain(val),
    or: () => selectChain(val),
    ilike: () => selectChain(val),
    in: () => selectChain(val),
    order: () => ({
      limit: () => Promise.resolve({ data: val !== undefined ? val : [], error: null }),
      maybeSingle: () => Promise.resolve({ data: val ?? null, error: null }),
      single: () => Promise.resolve({ data: val ?? null, error: null }),
    }),
    maybeSingle: () => Promise.resolve({ data: val ?? null, error: null }),
    single: () => Promise.resolve({ data: val ?? null, error: null }),
  });

  const deleteChain = {
    eq: () => ({
      then: () => Promise.resolve({ data: null, error: null }),
      catch: () => Promise.resolve({ data: null, error: null }),
    }),
  };

  return {
    ...base,
    select: (_columns?: string) => selectChain([]),
    update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
    delete: () => deleteChain,
    from: () => ({
      ...base,
      select: () => selectChain([]),
    }),
  };
}

function makeSupabaseClient() {
  return {
    from: (_table?: string) => chainBuilder([]),
    rpc: async (_fn?: string, _args?: Record<string, unknown>) => Promise.resolve({ data: null, error: null }),
    storage: {
      from: () => ({
        upload: async () => ({ data: { path: '' }, error: null }),
        createSignedUrl: () => Promise.resolve({ data: { signedUrl: null }, error: null }),
        remove: () => Promise.resolve({ data: null, error: null }),
        getPublicUrl: () => ({ data: { publicUrl: null } }),
      }),
    },
    auth: {
      signOut: async (_opts?: { scope?: string }) => ({ error: null }),
    },
    channel: () => ({
      on: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }),
    }),
    removeChannel: () => Promise.resolve(),
  };
}

export const supabase = makeSupabaseClient();
