import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Tiny data-fetching hook for Supabase queries.
 *
 * Deliberately not a caching framework: Seedwel Hub data is live and private,
 * so every screen re-reads on mount and can be re-read explicitly. Realtime
 * subscriptions live in useRealtime.
 */

/** Anything thenable with the Supabase `{ data, error }` result shape. */
/**
 * Anything thenable with the Supabase `{ data, error }` result shape. Deliberately
 * loose: Postgrest's own builder types are generic over the whole client schema,
 * and every call site here selects a partial row shape.
 */
/**
 * Anything thenable with the Supabase `{ data, error }` result shape.
 *
 * The row type is intentionally not part of the contract: Postgrest's own
 * builder types are generic over the entire client schema and every call site
 * here selects a partial projection, so the awaited result is cast to `T[]`
 * below. The error shape is fixed because the hook reads `.message`.
 */
/**
 * Anything thenable with the Supabase `{ data, error }` result shape.
 *
 * The row type deliberately stays out of the contract: Postgrest's own builder
 * types are generic over the whole client schema, and every call site selects a
 * partial projection of a row. The hook casts the awaited payload to `T[]`, so
 * the generic only documents intent at the call site.
 */
export interface QueryError {
  message: string;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
}

export interface QueryBuilder<T = unknown> extends PromiseLike<{ data: unknown; error: QueryError | null }> {
  /** Phantom: carries the row type for the call site without constraining the builder. */
  readonly __row?: T;
}

export interface QueryState<T> {
  data: T[];
  loading: boolean;
  error: string | null;
  refreshing: boolean;
  refresh: () => Promise<void>;
  setData: (next: T[]) => void;
}

export function useQuery<T>(
  factory: () => QueryBuilder<T> | null,
  deps: unknown[] = [],
  opts: { enabled?: boolean; initial?: T[] } = {},
): QueryState<T> {
  const [data, setData] = useState<T[]>(opts.initial ?? []);
  const [loading, setLoading] = useState(opts.enabled !== false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const factoryRef = useRef(factory);
  factoryRef.current = factory;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const run = useCallback(async (isRefresh: boolean) => {
    if (opts.enabled === false) { setLoading(false); return; }
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const builder = factoryRef.current();
      if (!builder) { setData([]); setLoading(false); setRefreshing(false); return; }
      const res = await builder;
      if (!mounted.current) return;
      if (res.error) {
        // 42501 / PGRST204 mean RLS said no: report it honestly rather than
        // showing an empty screen that looks like "no data yet".
        setError(res.error.message);
        setData([]);
      } else {
        setData(((res.data ?? []) as unknown[]) as T[]);
      }
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof Error ? e.message : 'Could not load data.');
      setData([]);
    } finally {
      if (mounted.current) { setLoading(false); setRefreshing(false); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.enabled]);

  useEffect(() => { void run(false); }, [...deps, run]);

  return { data, loading, error, refreshing, refresh: () => run(true), setData };
}

/** Single-row variant. */
export function useSingle<T>(
  factory: () => QueryBuilder<T> | null,
  deps: unknown[] = [],
): { data: T | null; loading: boolean; error: string | null; refresh: () => Promise<void> } {
  const q = useQuery<T>(factory, deps);
  return { data: q.data[0] ?? null, loading: q.loading, error: q.error, refresh: q.refresh };
}
